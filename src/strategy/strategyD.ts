import { getCandles } from "../data/candleWindow";
import { calculateRSI, getVolumeRatio, calculateSMA } from "../indicators";
import {
  RSI_PERIOD,
  STRATEGY_D_RSI_CROSS,
  STRATEGY_D_VOLUME_RATIO,
  STRATEGY_D_VOLUME_AVG_PERIOD,
  STRATEGY_D_DISPLACEMENT_MAX,
  STRATEGY_D_MA_PERIODS,
  STRATEGY_D_STOP_LOSS_PCT,
  COST_PCT,
} from "../config";
import type { BuySignalResult, SellSignalResult } from "./signal";
import type { BotPosition } from "../types";
import { logger } from "../logger";

const LOG_SOURCE = "strategyD";
const pricesFromCandles = (candles: { trade_price: number }[]): number[] =>
  candles.map((c) => c.trade_price);
const volumesFromCandles = (
  candles: { candle_acc_trade_volume: number }[],
): number[] => candles.map((c) => c.candle_acc_trade_volume);

const [MA5_PERIOD, MA10_PERIOD, MA20_PERIOD] = STRATEGY_D_MA_PERIODS;

/** 순수익률 (비용 차감) */
const getNetProfitPct = (buyPrice: number, currentPrice: number): number => {
  const raw = ((currentPrice - buyPrice) / buyPrice) * 100;
  return raw - COST_PCT;
};

/** 전략 D 매수: 5분봉 정배열+가격>MA20, 1분봉 RSI60 상향+거래량 150%, 이격도 2% 이내 */
export const checkBuySignalD = (
  market: string,
  currentPrice: number,
): (BuySignalResult & { strategy: "D" }) | null => {
  const candles1m = getCandles(market, 1);
  const candles5m = getCandles(market, 5);
  const need5m = MA20_PERIOD;
  const need1m = RSI_PERIOD + 2;
  if (candles1m.length < need1m + MA20_PERIOD || candles5m.length < need5m)
    return null;

  try {
    const prices5m = pricesFromCandles(candles5m);
    const lastClose5m = prices5m[prices5m.length - 1];
    const ma20_5m = calculateSMA(prices5m.slice(-MA20_PERIOD), MA20_PERIOD);
    if (lastClose5m <= ma20_5m) return null;

    const ma5_5m = calculateSMA(prices5m.slice(-MA5_PERIOD), MA5_PERIOD);
    const ma10_5m = calculateSMA(prices5m.slice(-MA10_PERIOD), MA10_PERIOD);
    if (!(ma5_5m > ma10_5m && ma10_5m > ma20_5m)) return null;

    const prices1m = pricesFromCandles(candles1m);
    const volumes1m = volumesFromCandles(candles1m);
    const isCurrentCandleOpen =
      volumes1m.length > 1 && volumes1m[volumes1m.length - 1] === 0;
    const closedPrices = isCurrentCandleOpen ? prices1m.slice(0, -1) : prices1m;
    const closedVolumes = isCurrentCandleOpen
      ? volumes1m.slice(0, -1)
      : volumes1m;
    if (closedPrices.length < need1m) return null;

    const rsiPrices = closedPrices.slice(-(RSI_PERIOD + 2));
    const rsiPrev = calculateRSI(rsiPrices.slice(0, -1));
    const rsiCur = calculateRSI(rsiPrices);
    if (!(rsiPrev < STRATEGY_D_RSI_CROSS && rsiCur >= STRATEGY_D_RSI_CROSS))
      return null;

    const lastClosedVol = closedVolumes[closedVolumes.length - 1] ?? 0;
    const prevVols = closedVolumes.slice(0, -1);
    const volRatio = getVolumeRatio(
      lastClosedVol,
      prevVols,
      STRATEGY_D_VOLUME_AVG_PERIOD,
    );
    if (volRatio <= STRATEGY_D_VOLUME_RATIO) return null;

    const ma20_1m = calculateSMA(closedPrices.slice(-MA20_PERIOD), MA20_PERIOD);
    if (ma20_1m <= 0) return null;
    if (currentPrice / ma20_1m > STRATEGY_D_DISPLACEMENT_MAX) return null;

    const displacement = currentPrice / ma20_1m;
    logger.info(
      LOG_SOURCE,
      "[시그널] %s | 매수 조건 충족 | 가격 %s | MA20_1m %s | 이격도 %.2f",
      market,
      currentPrice.toFixed(0),
      ma20_1m.toFixed(0),
      displacement,
    );
    return {
      shouldBuy: true,
      reason: "전략D: 정배열+RSI60상향+거래량150%+이격도2%이내",
      strategy: "D",
    };
  } catch (e) {
    logger.error(
      LOG_SOURCE,
      "[오류] 전략D 매수 검토 중 예외: %s",
      (e as Error).message,
    );
    return null;
  }
};

/** 전략 D 매도: 익절 MA5 하향 이탈(마감 봉), 손절 MA20 하향 또는 -1.5% */
export const checkSellSignalD = (
  market: string,
  position: BotPosition,
  currentPrice: number,
): SellSignalResult => {
  try {
    const buyPrice = position.buyPrice;
    const lossPct = getNetProfitPct(buyPrice, currentPrice);
    if (lossPct <= STRATEGY_D_STOP_LOSS_PCT) {
      logger.info(
        LOG_SOURCE,
        "[시그널] %s | 손절 (순수익 %s%%)",
        market,
        lossPct.toFixed(2),
      );
      return {
        shouldSell: true,
        reason: `전략D 손절 (순수익 ${lossPct.toFixed(2)}%)`,
      };
    }

    const candles1m = getCandles(market, 1);
    const prices1m = pricesFromCandles(candles1m);
    const volumes1m = volumesFromCandles(candles1m);
    const isCurrentCandleOpen =
      volumes1m.length > 1 && volumes1m[volumes1m.length - 1] === 0;
    const closedPrices = isCurrentCandleOpen ? prices1m.slice(0, -1) : prices1m;
    if (closedPrices.length >= MA20_PERIOD) {
      const ma20_1m = calculateSMA(
        closedPrices.slice(-MA20_PERIOD),
        MA20_PERIOD,
      );
      if (currentPrice < ma20_1m) {
        logger.info(
          LOG_SOURCE,
          "[시그널] %s | 손절 (가격 %s < MA20 %s)",
          market,
          currentPrice.toFixed(0),
          ma20_1m.toFixed(0),
        );
        return {
          shouldSell: true,
          reason: `전략D 손절 (가격 ${currentPrice.toFixed(0)} < MA20 ${ma20_1m.toFixed(0)})`,
        };
      }
    }
    if (closedPrices.length >= MA5_PERIOD) {
      const lastClose = closedPrices[closedPrices.length - 1];
      const ma5_1m = calculateSMA(closedPrices.slice(-MA5_PERIOD), MA5_PERIOD);
      if (lastClose < ma5_1m) {
        logger.info(
          LOG_SOURCE,
          "[시그널] %s | 익절 (MA5 하향 이탈) 종가 %s < MA5 %s",
          market,
          lastClose.toFixed(0),
          ma5_1m.toFixed(0),
        );
        return {
          shouldSell: true,
          reason: `전략D 익절 (MA5 하향 이탈 ${lastClose.toFixed(0)} < ${ma5_1m.toFixed(0)})`,
        };
      }
    }

    return { shouldSell: false };
  } catch (e) {
    logger.error(
      LOG_SOURCE,
      "[오류] 전략D 매도 검토 중 예외: %s",
      (e as Error).message,
    );
    return { shouldSell: false };
  }
};
