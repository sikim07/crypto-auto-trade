import { getCandles } from "../data/candleWindow";
import {
  calculateBollingerBands,
  calculateRSI,
  getVolumeRatio,
  linearRegressionSlope,
} from "../indicators";
import {
  BB_PERIOD,
  RSI_PERIOD,
  STRATEGY_E_BB_WIDTH_LOOKBACK,
  STRATEGY_E_SLOPE_THRESHOLD_RATIO,
  STRATEGY_E_BB_SLOPE_LOOKBACK,
  STRATEGY_E_RSI_OVERSOLD,
  STRATEGY_E_VOLUME_AVG_PERIOD,
  STRATEGY_E_VOLUME_EXCLUDE_RATIO,
  STRATEGY_E_STOP_BELOW_LOWER_RATIO,
} from "../config";
import type { BuySignalResult, SellSignalResult } from "./signal";
import type { BotPosition } from "../types";
import { logger } from "../logger";

const LOG_SOURCE = "strategyE";
const pricesFromCandles = (candles: { trade_price: number }[]): number[] =>
  candles.map((c) => c.trade_price);
const volumesFromCandles = (
  candles: { candle_acc_trade_volume: number }[],
): number[] => candles.map((c) => c.candle_acc_trade_volume);

/** 5분봉 BB Width = (upper - lower) / middle. 최근 lookback개 구간 평균에 필요한 최소 봉 수 */
const MIN_5M_FOR_WIDTH_AVG = STRATEGY_E_BB_WIDTH_LOOKBACK + BB_PERIOD;

/** 전략 E 매수: 5분봉 BB 폭 수축+수평, 1분봉 하단 터치+양봉+RSI40 상향, 거래량 2배 미만 */
export const checkBuySignalE = (
  market: string,
  currentPrice: number,
): (BuySignalResult & { strategy: "E" }) | null => {
  const candles1m = getCandles(market, 1);
  const candles5m = getCandles(market, 5);
  if (
    candles1m.length < BB_PERIOD + STRATEGY_E_VOLUME_AVG_PERIOD + 1 ||
    candles5m.length < MIN_5M_FOR_WIDTH_AVG
  )
    return null;

  try {
    const prices5m = pricesFromCandles(candles5m);
    const widths: number[] = [];
    for (let i = 0; i < STRATEGY_E_BB_WIDTH_LOOKBACK; i++) {
      const end = prices5m.length - i;
      const start = end - BB_PERIOD;
      if (start < 0) return null;
      const slice = prices5m.slice(start, end);
      const bb = calculateBollingerBands(slice);
      if (bb.middle <= 0) return null;
      widths.push((bb.upper - bb.lower) / bb.middle);
    }
    const avgWidth = widths.reduce((a, b) => a + b, 0) / widths.length;
    const currentSlice = prices5m.slice(-BB_PERIOD);
    const bbCurrent = calculateBollingerBands(currentSlice);
    if (bbCurrent.middle <= 0) return null;
    const currentWidth = (bbCurrent.upper - bbCurrent.lower) / bbCurrent.middle;
    if (currentWidth >= avgWidth) return null;

    const middlePrices: number[] = [];
    for (let i = 0; i < STRATEGY_E_BB_SLOPE_LOOKBACK; i++) {
      const end = prices5m.length - i;
      const start = end - BB_PERIOD;
      if (start < 0) return null;
      const slice = prices5m.slice(start, end);
      const bb = calculateBollingerBands(slice);
      middlePrices.push(bb.middle);
    }
    middlePrices.reverse();
    const slope = linearRegressionSlope(middlePrices);
    const midPrice =
      middlePrices.length > 0 ? middlePrices[middlePrices.length - 1] : 0;
    if (midPrice <= 0) return null;
    if (Math.abs(slope) >= midPrice * STRATEGY_E_SLOPE_THRESHOLD_RATIO)
      return null;

    const prices1m = pricesFromCandles(candles1m);
    const volumes1m = volumesFromCandles(candles1m);
    const isCurrentCandleOpen =
      volumes1m.length > 1 && volumes1m[volumes1m.length - 1] === 0;
    const closedCandles = isCurrentCandleOpen
      ? candles1m.slice(0, -1)
      : candles1m;
    const closedVolumes = isCurrentCandleOpen
      ? volumes1m.slice(0, -1)
      : volumes1m;
    if (closedCandles.length < BB_PERIOD + STRATEGY_E_VOLUME_AVG_PERIOD + 1)
      return null;

    const closedPrices = closedCandles.map((c) => c.trade_price);
    const bb1m = calculateBollingerBands(closedPrices.slice(-BB_PERIOD));
    const lastClosed = closedCandles[closedCandles.length - 1];
    const low = lastClosed.low_price;
    const close = lastClosed.trade_price;
    const open = lastClosed.opening_price;
    const high = lastClosed.high_price;
    if (high - low <= 0) return null;
    if (low > bb1m.lower) return null;
    if (close <= open) return null;

    if (closedPrices.length < RSI_PERIOD + 2) return null;
    const rsiPrices = closedPrices.slice(-(RSI_PERIOD + 2));
    const rsiPrev = calculateRSI(rsiPrices.slice(0, -1));
    const rsiCur = calculateRSI(rsiPrices);
    if (
      !(rsiPrev < STRATEGY_E_RSI_OVERSOLD && rsiCur >= STRATEGY_E_RSI_OVERSOLD)
    )
      return null;

    const lastVol = closedVolumes[closedVolumes.length - 1] ?? 0;
    const prevVols = closedVolumes.slice(0, -1);
    const avgVol5 =
      prevVols.length >= STRATEGY_E_VOLUME_AVG_PERIOD
        ? prevVols
            .slice(-STRATEGY_E_VOLUME_AVG_PERIOD)
            .reduce((a, b) => a + b, 0) / STRATEGY_E_VOLUME_AVG_PERIOD
        : 0;
    if (avgVol5 > 0 && lastVol > avgVol5 * STRATEGY_E_VOLUME_EXCLUDE_RATIO)
      return null;

    const volRatio = avgVol5 > 0 ? lastVol / avgVol5 : 0;
    logger.info(
      LOG_SOURCE,
      "[시그널] %s | 매수 조건 충족 | 가격 %s | BB하단 %s | RSI %s | 거래량비 %.2f",
      market,
      currentPrice.toFixed(0),
      bb1m.lower.toFixed(0),
      rsiCur.toFixed(1),
      volRatio,
    );
    logger.info(
      LOG_SOURCE,
      "[BT] E 매수 bbLower=%s RSI=%s volRatio=%s price=%s",
      bb1m.lower.toFixed(0),
      rsiCur.toFixed(1),
      volRatio.toFixed(2),
      currentPrice.toFixed(0),
    );
    return {
      shouldBuy: true,
      reason: "전략E: BB수축+수평+하단터치양봉+RSI40상향",
      strategy: "E",
    };
  } catch (e) {
    logger.error(
      LOG_SOURCE,
      "[오류] 전략E 매수 검토 중 예외: %s",
      (e as Error).message,
    );
    return null;
  }
};

/** 전략 E 매도: 익절 BB 상단 터치(실시간), 손절 하단 1% 이탈(마감 봉 종가) */
export const checkSellSignalE = (
  market: string,
  position: BotPosition,
  currentPrice: number,
): SellSignalResult => {
  try {
    const candles1m = getCandles(market, 1);
    const prices1m = pricesFromCandles(candles1m);
    const volumes1m = volumesFromCandles(candles1m);
    const isCurrentCandleOpen =
      volumes1m.length > 1 && volumes1m[volumes1m.length - 1] === 0;
    const closedPrices = isCurrentCandleOpen ? prices1m.slice(0, -1) : prices1m;

    if (prices1m.length >= BB_PERIOD) {
      const bb = calculateBollingerBands(prices1m.slice(-BB_PERIOD));
      if (currentPrice >= bb.upper) {
        logger.info(
          LOG_SOURCE,
          "[시그널] %s | 익절 (BB 상단 터치) | 현재가 %s >= 상단 %s",
          market,
          currentPrice.toFixed(0),
          bb.upper.toFixed(0),
        );
        logger.info(
          LOG_SOURCE,
          "[BT] E 매도 type=익절 price=%s bbUpper=%s",
          currentPrice.toFixed(0),
          bb.upper.toFixed(0),
        );
        return {
          shouldSell: true,
          reason: `전략E 익절 (BB 상단 터치 ${currentPrice.toFixed(0)} >= ${bb.upper.toFixed(0)})`,
        };
      }
    }

    if (closedPrices.length >= BB_PERIOD) {
      const bbClosed = calculateBollingerBands(closedPrices.slice(-BB_PERIOD));
      const lastClose = closedPrices[closedPrices.length - 1];
      const threshold = bbClosed.lower * STRATEGY_E_STOP_BELOW_LOWER_RATIO;
      if (bbClosed.lower > 0 && lastClose < threshold) {
        logger.info(
          LOG_SOURCE,
          "[시그널] %s | 손절 (하단 1%% 이탈) 종가 %s < %s",
          market,
          lastClose.toFixed(0),
          threshold.toFixed(0),
        );
        logger.info(
          LOG_SOURCE,
          "[BT] E 매도 type=하단이탈 close=%s thr=%s ratio=%s",
          lastClose.toFixed(0),
          threshold.toFixed(0),
          String(STRATEGY_E_STOP_BELOW_LOWER_RATIO),
        );
        return {
          shouldSell: true,
          reason: `전략E 손절 (하단 이탈 종가 ${lastClose.toFixed(0)} < ${threshold.toFixed(0)})`,
        };
      }
    }

    return { shouldSell: false };
  } catch (e) {
    logger.error(
      LOG_SOURCE,
      "[오류] 전략E 매도 검토 중 예외: %s",
      (e as Error).message,
    );
    return { shouldSell: false };
  }
};
