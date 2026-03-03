import { getCandles } from "../data/candleWindow";
import {
  calculateBollingerBands,
  calculateRSI,
  getVolumeRatio,
  calculateSMA,
} from "../indicators";
import {
  BB_PERIOD,
  RSI_PERIOD,
  STRATEGY_A_RSI_OVERSOLD,
  STRATEGY_A_VOLUME_AVG_PERIOD,
  STRATEGY_A_ATR_STOP_MULTIPLIER,
} from "../config";
import type { BuySignalResult, SellSignalResult } from "./signal";
import type { BotPosition } from "../types";
import { logger } from "../logger";

const LOG_SOURCE = "strategyA";
const pricesFromCandles = (candles: { trade_price: number }[]): number[] =>
  candles.map((c) => c.trade_price);
const volumesFromCandles = (
  candles: { candle_acc_trade_volume: number }[],
): number[] => candles.map((c) => c.candle_acc_trade_volume);
const MA200_PERIOD = 200;

/** 전략 A 매수: 5분봉 가격 > MA200, 1분봉 BB 하단 + RSI<30 + 거래량>5봉평균, RSI 30 상향 돌파 */
export const checkBuySignalA = (
  market: string,
  currentPrice: number,
): (BuySignalResult & { strategy: "A" }) | null => {
  const candles1m = getCandles(market, 1);
  const candles5m = getCandles(market, 5);
  const need1m = 50;
  const need5m = MA200_PERIOD;
  if (candles1m.length < need1m || candles5m.length < need5m) return null;

  try {
    const prices5m = pricesFromCandles(candles5m);
    const ma200 = calculateSMA(prices5m.slice(-MA200_PERIOD), MA200_PERIOD);
    const lastClose5m = prices5m[prices5m.length - 1];
    if (lastClose5m <= ma200) return null;

    const prices1m = pricesFromCandles(candles1m);
    const volumes1m = volumesFromCandles(candles1m);
    const bb = calculateBollingerBands(prices1m);
    const condBB = currentPrice <= bb.lower;
    if (!condBB) return null;

    const isCurrentCandleOpen =
      volumes1m.length > 1 && volumes1m[volumes1m.length - 1] === 0;
    const closedPrices = isCurrentCandleOpen ? prices1m.slice(0, -1) : prices1m;
    const closedVolumes = isCurrentCandleOpen
      ? volumes1m.slice(0, -1)
      : volumes1m;
    if (closedPrices.length < RSI_PERIOD + 2) return null;

    const rsiPrices = closedPrices.slice(-(RSI_PERIOD + 2));
    const rsiPrev = calculateRSI(rsiPrices.slice(0, -1));
    const rsiCur = calculateRSI(rsiPrices);
    const condRsiOversold = rsiPrev < STRATEGY_A_RSI_OVERSOLD;
    const condRsiCrossUp = rsiCur >= STRATEGY_A_RSI_OVERSOLD;
    if (!condRsiOversold || !condRsiCrossUp) return null;

    const lastClosedVol =
      closedVolumes.length > 0 ? closedVolumes[closedVolumes.length - 1] : 0;
    const prevVolumes = closedVolumes.slice(0, -1);
    const volRatio = getVolumeRatio(
      lastClosedVol,
      prevVolumes,
      STRATEGY_A_VOLUME_AVG_PERIOD,
    );
    if (volRatio <= 1) return null;

    logger.info(
      LOG_SOURCE,
      "[시그널] %s | 매수 조건 충족 | 가격 %s | BB하단·RSI30상향·거래량",
      market,
      currentPrice.toFixed(0),
    );
    return {
      shouldBuy: true,
      reason: "전략A: BB하단+RSI30상향돌파+거래량",
      strategy: "A",
    };
  } catch (e) {
    logger.error(
      LOG_SOURCE,
      "[오류] 전략A 매수 검토 중 예외: %s",
      (e as Error).message,
    );
    return null;
  }
};

/** 전략 A 매도: 익절 BB 중앙 터치, 손절 = 진입캔들 저점 이탈 또는 진입가-ATR×배수 도달(둘 중 먼저) */
export const checkSellSignalA = (
  market: string,
  position: BotPosition,
  currentPrice: number,
): SellSignalResult => {
  const buyPrice = position.buyPrice;
  const entryCandleLow = position.entryLow;
  const entryAtr = position.entryAtr ?? 0;
  const atrStopPrice = buyPrice - entryAtr * STRATEGY_A_ATR_STOP_MULTIPLIER;

  const stopPrice =
    entryCandleLow !== undefined && entryAtr > 0
      ? Math.max(entryCandleLow, atrStopPrice)
      : entryCandleLow !== undefined
        ? entryCandleLow
        : entryAtr > 0
          ? atrStopPrice
          : buyPrice;

  if (currentPrice <= stopPrice) {
    const triggeredByEntryLow =
      entryCandleLow !== undefined && stopPrice === entryCandleLow;
    const stopReason = triggeredByEntryLow ? "진입캔들 저점 이탈" : "ATR 손절";
    logger.info(
      LOG_SOURCE,
      "[시그널] %s | 손절(%s) | 현재가 %s <= 손절가 %s",
      market,
      stopReason,
      currentPrice.toFixed(0),
      stopPrice.toFixed(0),
    );
    return {
      shouldSell: true,
      reason: `전략A 손절 (${stopReason} 가격 ${currentPrice.toFixed(0)} <= ${stopPrice.toFixed(0)})`,
    };
  }

  const candles1m = getCandles(market, 1);
  if (candles1m.length >= BB_PERIOD) {
    const prices = pricesFromCandles(candles1m);
    const bb = calculateBollingerBands(prices);
    if (currentPrice >= bb.middle) {
      logger.info(
        LOG_SOURCE,
        "[시그널] %s | 익절 (BB 중앙) | 현재가 %s >= 중앙선 %s",
        market,
        currentPrice.toFixed(0),
        bb.middle.toFixed(0),
      );
      return {
        shouldSell: true,
        reason: `전략A 익절 (BB 중앙선 터치 ${currentPrice.toFixed(0)} >= ${bb.middle.toFixed(0)})`,
      };
    }
  }

  return { shouldSell: false };
};
