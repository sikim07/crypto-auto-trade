import { getCandles } from "../data/candleWindow";
import { calculateRSI, calculateEMA } from "../indicators";
import {
  RSI_PERIOD,
  STRATEGY_F_EMA_PERIOD,
  STRATEGY_F_PROXIMITY_PCT,
  STRATEGY_F_RSI_CROSS,
  STRATEGY_F_MIN_VWAP_CANDLES_1M,
  STRATEGY_F_MIN_VWAP_CANDLES_5M,
  STRATEGY_F_STOP_LOSS_PCT,
  STRATEGY_F_MAX_HOLD_MINUTES,
  STRATEGY_F_TRAILING_ACTIVATE_PCT,
  STRATEGY_F_TRAILING_OFFSET_PCT,
  STRATEGY_F_ENTRY_BREACH_PCT,
  COST_PCT,
} from "../config";
import type { BuySignalResult, SellSignalResult } from "./signal";
import type { BotPosition, UpbitCandle } from "../types";
import { logger } from "../logger";

const LOG_SOURCE = "strategyF";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const pricesFromCandles = (candles: { trade_price: number }[]): number[] =>
  candles.map((c) => c.trade_price);
const volumesFromCandles = (
  candles: { candle_acc_trade_volume: number }[],
): number[] => candles.map((c) => c.candle_acc_trade_volume);

/** 순수익률 (비용 차감) */
const getNetProfitPct = (buyPrice: number, currentPrice: number): number => {
  const raw = ((currentPrice - buyPrice) / buyPrice) * 100;
  return raw - COST_PCT;
};

/** 당일 KST 기준 캔들 필터 후 VWAP 계산. 최소 캔들 미충족 또는 거래량 0 시 0 반환 */
const calcVwap = (candles: UpbitCandle[], minCandles: number): number => {
  const kstNow = new Date(Date.now() + KST_OFFSET_MS);
  const todayCandles = candles.filter((c) => {
    const kstCandle = new Date(c.timestamp + KST_OFFSET_MS);
    return (
      kstCandle.getUTCFullYear() === kstNow.getUTCFullYear() &&
      kstCandle.getUTCMonth() === kstNow.getUTCMonth() &&
      kstCandle.getUTCDate() === kstNow.getUTCDate()
    );
  });
  if (todayCandles.length < minCandles) return 0;
  const totalPrice = todayCandles.reduce(
    (s, c) => s + c.candle_acc_trade_price,
    0,
  );
  const totalVolume = todayCandles.reduce(
    (s, c) => s + c.candle_acc_trade_volume,
    0,
  );
  return totalVolume > 0 ? totalPrice / totalVolume : 0;
};

/** 전략 F 매수: 5분봉 VWAP 위, 1분봉 VWAP+EMA21 위, 눌림목 위치, RSI 크로스, 마감봉 양봉 */
export const checkBuySignalF = (
  market: string,
  currentPrice: number,
): (BuySignalResult & { strategy: "F" }) | null => {
  const candles1m = getCandles(market, 1);
  const candles5m = getCandles(market, 5);

  const minNeed1m = Math.max(
    STRATEGY_F_EMA_PERIOD,
    RSI_PERIOD + 2,
    STRATEGY_F_MIN_VWAP_CANDLES_1M,
  );
  if (
    candles1m.length < minNeed1m ||
    candles5m.length < STRATEGY_F_MIN_VWAP_CANDLES_5M
  )
    return null;

  try {
    // [조건 1] 5분봉 현재가 > VWAP_5m
    const vwap5m = calcVwap(candles5m, STRATEGY_F_MIN_VWAP_CANDLES_5M);
    if (vwap5m === 0) return null;
    const lastClose5m = candles5m[candles5m.length - 1].trade_price;
    if (lastClose5m <= vwap5m) return null;

    // closedCandles 처리 — 미완성 현재봉 제외
    const volumes1m = volumesFromCandles(candles1m);
    const isCurrentCandleOpen =
      volumes1m.length > 1 && volumes1m[volumes1m.length - 1] === 0;
    const closedCandles = isCurrentCandleOpen
      ? candles1m.slice(0, -1)
      : candles1m;
    const closedPrices = pricesFromCandles(closedCandles);
    if (closedPrices.length < RSI_PERIOD + 2) return null;

    // [조건 2] 1분봉 현재가 > VWAP_1m AND 현재가 > EMA21_1m
    const vwap1m = calcVwap(candles1m, STRATEGY_F_MIN_VWAP_CANDLES_1M);
    if (vwap1m === 0) return null;
    if (currentPrice <= vwap1m) return null;

    const ema21 = calculateEMA(closedPrices, STRATEGY_F_EMA_PERIOD);
    if (currentPrice <= ema21) return null;

    // [조건 3] 현재가 ≤ max(VWAP_1m, EMA21) × (1 + PROXIMITY_PCT/100) — 눌림목 위치
    const anchor = Math.max(vwap1m, ema21);
    const proximityThreshold = anchor * (1 + STRATEGY_F_PROXIMITY_PCT / 100);
    if (currentPrice > proximityThreshold) return null;

    // [조건 4] RSI 크로스: rsiPrev < RSI_CROSS AND rsiCur ≥ RSI_CROSS
    const rsiPrices = closedPrices.slice(-(RSI_PERIOD + 2));
    const rsiPrev = calculateRSI(rsiPrices.slice(0, -1));
    const rsiCur = calculateRSI(rsiPrices);
    if (!(rsiPrev < STRATEGY_F_RSI_CROSS && rsiCur >= STRATEGY_F_RSI_CROSS))
      return null;

    // [조건 5] 마감봉 양봉: close > open
    const lastClosed = closedCandles[closedCandles.length - 1];
    if (lastClosed.trade_price <= lastClosed.opening_price) return null;

    logger.info(
      LOG_SOURCE,
      "[시그널] %s | 매수 조건 충족 | 가격 %s | VWAP1m %s | EMA21 %s | RSI %s→%s",
      market,
      currentPrice.toFixed(0),
      vwap1m.toFixed(0),
      ema21.toFixed(0),
      rsiPrev.toFixed(1),
      rsiCur.toFixed(1),
    );
    return {
      shouldBuy: true,
      reason: `전략F: VWAP눌림목+EMA21+RSI${STRATEGY_F_RSI_CROSS}상향+양봉`,
      strategy: "F",
    };
  } catch (e) {
    logger.error(
      LOG_SOURCE,
      "[오류] 전략F 매수 검토 중 예외: %s",
      (e as Error).message,
    );
    return null;
  }
};

/** 전략 F 매도: 하드손절 → 진입저점 이탈 → VWAP 붕괴 → 트레일링 스톱(D방식) → 최대 보유 */
export const checkSellSignalF = (
  market: string,
  position: BotPosition,
  currentPrice: number,
): SellSignalResult => {
  try {
    const netPct = getNetProfitPct(position.buyPrice, currentPrice);

    // 1. 하드 손절
    if (netPct <= STRATEGY_F_STOP_LOSS_PCT) {
      logger.info(
        LOG_SOURCE,
        "[시그널] %s | 손절 (순수익 %s%%)",
        market,
        netPct.toFixed(2),
      );
      return {
        shouldSell: true,
        reason: `전략F 손절 (순수익 ${netPct.toFixed(2)}%)`,
      };
    }

    // 2. 진입 수준 이탈 (진입가 대비 -ENTRY_BREACH_PCT% 이하)
    const entryBreachPrice =
      position.buyPrice * (1 - STRATEGY_F_ENTRY_BREACH_PCT / 100);
    if (currentPrice < entryBreachPrice) {
      logger.info(
        LOG_SOURCE,
        "[시그널] %s | 손절 (진입 수준 이탈) 현재가 %s < 진입가대비 %s%% 이하",
        market,
        currentPrice.toFixed(0),
        STRATEGY_F_ENTRY_BREACH_PCT,
      );
      return {
        shouldSell: true,
        reason: `전략F 손절 (진입 수준 이탈 현재가 ${currentPrice.toFixed(0)} < 진입가대비 ${STRATEGY_F_ENTRY_BREACH_PCT}% 이하)`,
      };
    }

    // 3. VWAP 붕괴: 현재가 < VWAP_1m 또는 마감봉 종가 < VWAP_1m
    const candles1m = getCandles(market, 1);
    if (candles1m.length > 0) {
      const vwap1m = calcVwap(candles1m, STRATEGY_F_MIN_VWAP_CANDLES_1M);
      if (vwap1m > 0 && currentPrice < vwap1m) {
        logger.info(
          LOG_SOURCE,
          "[시그널] %s | 손절 (VWAP 붕괴) 현재가 %s < VWAP %s",
          market,
          currentPrice.toFixed(0),
          vwap1m.toFixed(0),
        );
        return {
          shouldSell: true,
          reason: `전략F 손절 (VWAP 붕괴 현재가 ${currentPrice.toFixed(0)} < ${vwap1m.toFixed(0)})`,
        };
      }
      const volumes1m = volumesFromCandles(candles1m);
      const isCurrentCandleOpen =
        volumes1m.length > 1 && volumes1m[volumes1m.length - 1] === 0;
      const closedCandles = isCurrentCandleOpen
        ? candles1m.slice(0, -1)
        : candles1m;
      if (closedCandles.length > 0) {
        const lastClose = closedCandles[closedCandles.length - 1].trade_price;
        if (lastClose < vwap1m) {
          logger.info(
            LOG_SOURCE,
            "[시그널] %s | 손절 (VWAP 붕괴) 마감 종가 %s < VWAP %s",
            market,
            lastClose.toFixed(0),
            vwap1m.toFixed(0),
          );
          return {
            shouldSell: true,
            reason: `전략F 손절 (VWAP 붕괴 종가 ${lastClose.toFixed(0)} < ${vwap1m.toFixed(0)})`,
          };
        }
      }
    }

    // 4. 트레일링 스톱 (D 방식 — maxNetPct 기반, index.ts에서 공통 갱신)
    if (position.maxNetPct >= STRATEGY_F_TRAILING_ACTIVATE_PCT) {
      const trailingDropPct = position.maxNetPct - netPct;
      if (trailingDropPct >= STRATEGY_F_TRAILING_OFFSET_PCT) {
        logger.info(
          LOG_SOURCE,
          "[시그널] %s | 트레일링 스톱 (고점 %s%% → 현재 %s%%)",
          market,
          position.maxNetPct.toFixed(2),
          netPct.toFixed(2),
        );
        return {
          shouldSell: true,
          reason: `전략F 트레일링 스톱 (고점 ${position.maxNetPct.toFixed(2)}% → 현재 ${netPct.toFixed(2)}%)`,
        };
      }
    }

    // 5. 최대 보유 시간 초과
    const holdMin = (Date.now() - position.buyTime) / 60_000;
    if (holdMin >= STRATEGY_F_MAX_HOLD_MINUTES) {
      logger.info(
        LOG_SOURCE,
        "[시그널] %s | 시간초과 (보유 %s분, 순수익 %s%%)",
        market,
        holdMin.toFixed(1),
        netPct.toFixed(2),
      );
      return {
        shouldSell: true,
        reason: `전략F 시간초과 (${holdMin.toFixed(1)}분, 순수익 ${netPct.toFixed(2)}%)`,
      };
    }

    return { shouldSell: false };
  } catch (e) {
    logger.error(
      LOG_SOURCE,
      "[오류] 전략F 매도 검토 중 예외: %s",
      (e as Error).message,
    );
    return { shouldSell: false };
  }
};
