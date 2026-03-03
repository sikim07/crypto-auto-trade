import { getCandles } from "../data/candleWindow";
import { calculateBollingerBands, getVolumeRatio } from "../indicators";
import {
  BB_PERIOD,
  STRATEGY_C_BB_SQUEEZE_RATIO,
  STRATEGY_C_VOLUME_RATIO,
  STRATEGY_C_VOLUME_AVG_PERIOD,
  STRATEGY_C_BODY_RATIO_MIN,
  STRATEGY_C_TRAILING_ACTIVATE_PCT,
  STRATEGY_C_TRAILING_OFFSET_PCT,
  COST_PCT,
} from "../config";
import type { BuySignalResult, SellSignalResult } from "./signal";
import type { BotPosition } from "../types";
import { logger } from "../logger";

const LOG_SOURCE = "strategyC";
const pricesFromCandles = (candles: { trade_price: number }[]): number[] =>
  candles.map((c) => c.trade_price);
const volumesFromCandles = (
  candles: { candle_acc_trade_volume: number }[],
): number[] => candles.map((c) => c.candle_acc_trade_volume);

/** 전략 C 매수: 5분봉 BB 폭 수축, 1분봉 상단 돌파 + 거래량 200% + 마감 종가 상단 위 + 몸통비 > 0.6 */
export const checkBuySignalC = (
  market: string,
  currentPrice: number,
): (BuySignalResult & { strategy: "C" }) | null => {
  const candles1m = getCandles(market, 1);
  const candles5m = getCandles(market, 5);
  if (
    candles1m.length < BB_PERIOD + STRATEGY_C_VOLUME_AVG_PERIOD ||
    candles5m.length < BB_PERIOD
  )
    return null;

  try {
    const prices5m = pricesFromCandles(candles5m);
    const bb5m = calculateBollingerBands(prices5m.slice(-BB_PERIOD));
    const bandWidth = (bb5m.upper - bb5m.lower) / bb5m.middle;
    if (bandWidth >= STRATEGY_C_BB_SQUEEZE_RATIO) return null;

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
    if (closedCandles.length < BB_PERIOD + STRATEGY_C_VOLUME_AVG_PERIOD)
      return null;

    const closedPrices = closedCandles.map((c) => c.trade_price);
    const bbClosed = calculateBollingerBands(closedPrices.slice(-BB_PERIOD));
    if (currentPrice <= bbClosed.upper) return null;

    const lastClosed = closedCandles[closedCandles.length - 1];
    const close = lastClosed.trade_price;
    const open = lastClosed.opening_price;
    const high = lastClosed.high_price;
    const low = lastClosed.low_price;
    const range = high - low;
    if (range <= 0) return null;
    const bodyRatio = (close - open) / range;
    if (bodyRatio < STRATEGY_C_BODY_RATIO_MIN) return null;
    if (close <= bbClosed.upper) return null;

    const lastVol = closedVolumes[closedVolumes.length - 1];
    const prevVols = closedVolumes.slice(0, -1);
    const volRatio = getVolumeRatio(
      lastVol,
      prevVols,
      STRATEGY_C_VOLUME_AVG_PERIOD,
    );
    if (volRatio < STRATEGY_C_VOLUME_RATIO) return null;

    logger.info(
      LOG_SOURCE,
      "[시그널] %s | 매수 조건 충족 | 가격 %s | BB수축+상단돌파+거래량%.0f%%",
      market,
      currentPrice.toFixed(0),
      volRatio * 100,
    );
    return {
      shouldBuy: true,
      reason: "전략C: BB수축+상단돌파+거래량200%+몸통비",
      strategy: "C",
    };
  } catch (e) {
    logger.error(
      LOG_SOURCE,
      "[오류] 전략C 매수 검토 중 예외: %s",
      (e as Error).message,
    );
    return null;
  }
};

/** 순수익률 (비용 차감) */
const getNetProfitPct = (buyPrice: number, currentPrice: number): number => {
  const raw = ((currentPrice - buyPrice) / buyPrice) * 100;
  return raw - COST_PCT;
};

/** 전략 C 매도: 3% 도달 후 트레일링 -1.5%, 손절 BB 중앙선 하향 */
export const checkSellSignalC = (
  market: string,
  position: BotPosition,
  currentPrice: number,
): SellSignalResult => {
  const netPct = getNetProfitPct(position.buyPrice, currentPrice);

  const candles1m = getCandles(market, 1);
  if (candles1m.length >= BB_PERIOD) {
    const prices = pricesFromCandles(candles1m);
    const bb = calculateBollingerBands(prices);
    if (currentPrice < bb.middle) {
      logger.info(
        LOG_SOURCE,
        "[시그널] %s | 손절 (BB 중앙 하향) | 현재가 %s < 중앙 %s",
        market,
        currentPrice.toFixed(0),
        bb.middle.toFixed(0),
      );
      return {
        shouldSell: true,
        reason: `전략C 손절 (가격 ${currentPrice.toFixed(0)} < BB중앙 ${bb.middle.toFixed(0)})`,
      };
    }
  }

  if (position.trailingActivated && position.highestPrice != null) {
    const threshold =
      position.highestPrice * (1 - STRATEGY_C_TRAILING_OFFSET_PCT / 100);
    if (currentPrice <= threshold) {
      logger.info(
        LOG_SOURCE,
        "[시그널] %s | 익절 트레일링 | 고가 %s 대비 -%s%% 하락",
        market,
        position.highestPrice.toFixed(0),
        STRATEGY_C_TRAILING_OFFSET_PCT,
      );
      return {
        shouldSell: true,
        reason: `전략C 익절 트레일링 (고가 ${position.highestPrice.toFixed(0)} 대비 -${STRATEGY_C_TRAILING_OFFSET_PCT}%)`,
      };
    }
  }

  return { shouldSell: false };
};
