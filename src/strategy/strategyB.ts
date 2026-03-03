import { getCandles } from "../data/candleWindow";
import { calculateRSI, calculateMACD } from "../indicators";
import { RSI_PERIOD, MACD_SLOW, MACD_SIGNAL } from "../config";
import type { BuySignalResult, SellSignalResult } from "./signal";
import type { BotPosition } from "../types";
import { logger } from "../logger";

const LOG_SOURCE = "strategyB";
const pricesFromCandles = (candles: { trade_price: number }[]): number[] =>
  candles.map((c) => c.trade_price);

const RSI_50 = 50;
const RSI_40_DIVERGENCE = 40;
const RSI_70 = 70;
const DIVERGENCE_LOOKBACK = 25;

/** 최근 lookback 봉 내에서 상승 다이버전스(가격 저점 하락, RSI 저점 상승) 존재 여부 */
function hasBullishDivergence(
  prices: number[],
  rsiValues: number[],
  lookback: number,
): boolean {
  if (prices.length < lookback || rsiValues.length < lookback) return false;
  const p = prices.slice(-lookback);
  const r = rsiValues.slice(-lookback);
  let firstLowIdx = 0;
  let secondLowIdx = 0;
  for (let i = 1; i < p.length - 1; i++) {
    if (p[i] <= p[i - 1] && p[i] <= p[i + 1]) {
      firstLowIdx = secondLowIdx;
      secondLowIdx = i;
    }
  }
  if (firstLowIdx >= secondLowIdx) return false;
  if (p[secondLowIdx] >= p[firstLowIdx]) return false;
  if (r[secondLowIdx] <= r[firstLowIdx]) return false;
  return true;
}

/** 전략 B 매수: 5분봉 MACD hist>0, 1분봉 골든크로스 + RSI 50 상향(또는 다이버전스 시 RSI 40 상향) */
export const checkBuySignalB = (
  market: string,
  currentPrice: number,
): (BuySignalResult & { strategy: "B" }) | null => {
  const candles1m = getCandles(market, 1);
  const candles5m = getCandles(market, 5);
  const min1m = MACD_SLOW + MACD_SIGNAL + 2;
  const min5m = MACD_SLOW + MACD_SIGNAL;
  if (candles1m.length < min1m || candles5m.length < min5m) return null;

  try {
    const prices5m = pricesFromCandles(candles5m);
    const macd5m = calculateMACD(prices5m);
    if (macd5m.histogram <= 0) return null;

    const prices1m = pricesFromCandles(candles1m);
    const macd1m = calculateMACD(prices1m);
    const goldenCross =
      macd1m.prevMacd <= macd1m.prevSignal && macd1m.macd > macd1m.signal;
    if (!goldenCross) return null;

    const rsiPeriod = RSI_PERIOD + 2;
    if (prices1m.length < rsiPeriod) return null;
    const rsiPrices = prices1m.slice(-rsiPeriod);
    const rsiPrev = calculateRSI(rsiPrices.slice(0, -1));
    const rsiCur = calculateRSI(rsiPrices);
    const rsiThreshold = 50;

    const divergencePrices = prices1m.slice(-DIVERGENCE_LOOKBACK - RSI_PERIOD);
    const rsiForBars: number[] = [];
    for (
      let j = divergencePrices.length - DIVERGENCE_LOOKBACK;
      j < divergencePrices.length;
      j++
    ) {
      if (j >= RSI_PERIOD) {
        rsiForBars.push(calculateRSI(divergencePrices.slice(0, j + 1)));
      }
    }
    const withDivergence =
      rsiForBars.length === DIVERGENCE_LOOKBACK &&
      hasBullishDivergence(
        divergencePrices.slice(-DIVERGENCE_LOOKBACK),
        rsiForBars,
        DIVERGENCE_LOOKBACK,
      );
    const threshold = withDivergence ? RSI_40_DIVERGENCE : RSI_50;
    if (rsiPrev >= threshold || rsiCur < threshold) return null;

    logger.info(
      LOG_SOURCE,
      "[시그널] %s | 매수 조건 충족 | 가격 %s | 골든크로스+RSI%s상향 %s",
      market,
      currentPrice.toFixed(0),
      String(threshold),
      withDivergence ? "(다이버전스)" : "",
    );
    return {
      shouldBuy: true,
      reason: withDivergence
        ? "전략B: 골든크로스+RSI40상향(다이버전스)"
        : "전략B: 골든크로스+RSI50상향",
      strategy: "B",
    };
  } catch (e) {
    logger.error(
      LOG_SOURCE,
      "[오류] 전략B 매수 검토 중 예외: %s",
      (e as Error).message,
    );
    return null;
  }
};

/** 전략 B 매도: 익절 RSI 70 하향 돌파, 손절 MACD 데드크로스. lastRsi 반환으로 호출자가 position.lastRsi 갱신. */
export const checkSellSignalB = (
  market: string,
  position: BotPosition,
  currentPrice: number,
): SellSignalResult => {
  const candles1m = getCandles(market, 1);
  const prices = pricesFromCandles(candles1m);
  let rsiCur: number | undefined;
  if (prices.length >= RSI_PERIOD + 1) {
    rsiCur = calculateRSI(prices.slice(-(RSI_PERIOD + 1)));
  }

  const minLen = MACD_SLOW + MACD_SIGNAL + 1;
  if (candles1m.length >= minLen) {
    const macd = calculateMACD(prices);
    if (macd.prevMacd >= macd.prevSignal && macd.macd < macd.signal) {
      logger.info(LOG_SOURCE, "[시그널] %s | 손절 (MACD 데드크로스)", market);
      return {
        shouldSell: true,
        reason: "전략B 손절 (MACD 데드크로스)",
        ...(typeof rsiCur === "number" && { lastRsi: rsiCur }),
      };
    }
  }

  const prevRsi = position.lastRsi ?? 0;
  if (typeof rsiCur === "number") {
    if (prevRsi >= RSI_70 && rsiCur < RSI_70) {
      logger.info(
        LOG_SOURCE,
        "[시그널] %s | 익절 (RSI 70 하향 돌파) %s → %s",
        market,
        prevRsi.toFixed(1),
        rsiCur.toFixed(1),
      );
      return {
        shouldSell: true,
        reason: `전략B 익절 (RSI 70 하향 돌파 ${prevRsi.toFixed(1)} → ${rsiCur.toFixed(1)})`,
        lastRsi: rsiCur,
      };
    }
    return { shouldSell: false, lastRsi: rsiCur };
  }

  return { shouldSell: false };
};
