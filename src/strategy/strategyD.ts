import { getCandles } from "../data/candleWindow";
import { calculateRSI, getVolumeRatio, calculateSMA } from "../indicators";
import {
  RSI_PERIOD,
  STRATEGY_D_RSI_CROSS,
  STRATEGY_D_VOLUME_RATIO,
  STRATEGY_D_VOLUME_AVG_PERIOD,
  STRATEGY_D_DISPLACEMENT_MAX,
  STRATEGY_D_DISPLACEMENT_MIN,
  STRATEGY_D_MA20_BREAK_BUFFER,
  STRATEGY_D_MIN_PRICE,
  STRATEGY_D_MAX_HOLD_MINUTES,
  STRATEGY_D_MA_PERIODS,
  STRATEGY_D_STOP_LOSS_PCT,
  STRATEGY_D_MIN_PROFIT_BEFORE_MA5_EXIT,
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

    // 저가 코인 필터
    if (currentPrice < STRATEGY_D_MIN_PRICE) return null;

    const ma20_1m = calculateSMA(closedPrices.slice(-MA20_PERIOD), MA20_PERIOD);
    if (ma20_1m <= 0) return null;
    
    const displacement = currentPrice / ma20_1m;
    // 이격도 상한 체크
    if (displacement > STRATEGY_D_DISPLACEMENT_MAX) return null;
    // 이격도 하한 체크 (너무 가까이서 진입 시 노이즈 손절 방지)
    if (displacement < STRATEGY_D_DISPLACEMENT_MIN) return null;

    logger.info(
      LOG_SOURCE,
      "[시그널] %s | 매수 조건 충족 | 가격 %s | MA20_1m %s | 이격도 %s",
      market,
      currentPrice.toFixed(0),
      ma20_1m.toFixed(0),
      displacement.toFixed(4),
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

/** 전략 D 매도: 손절/MA20 추세 붕괴 최우선, 익절은 최소 수익 구간 넘은 뒤 MA5 하향 이탈 시에만 */
export const checkSellSignalD = (
  market: string,
  position: BotPosition,
  currentPrice: number,
): SellSignalResult => {
  try {
    const buyPrice = position.buyPrice;
    const netProfitPct = getNetProfitPct(buyPrice, currentPrice);

    // 1. 손절: 수익률과 관계없이 최우선
    if (netProfitPct <= STRATEGY_D_STOP_LOSS_PCT) {
      logger.info(
        LOG_SOURCE,
        "[시그널] %s | 손절 (순수익 %s%%)",
        market,
        netProfitPct.toFixed(2),
      );
      return {
        shouldSell: true,
        reason: `전략D 손절 (순수익 ${netProfitPct.toFixed(2)}%)`,
      };
    }

    // 최대 보유 시간 체크
    const holdMin = (Date.now() - position.buyTime) / 60_000;
    if (holdMin >= STRATEGY_D_MAX_HOLD_MINUTES) {
      logger.info(
        LOG_SOURCE,
        "[시그널] %s | 시간초과 (보유 %s분, 순수익 %s%%)",
        market,
        holdMin.toFixed(0),
        netProfitPct.toFixed(2),
      );
      return {
        shouldSell: true,
        reason: `전략D 시간초과 (${holdMin.toFixed(0)}분)`,
      };
    }

    const candles1m = getCandles(market, 1);
    const prices1m = pricesFromCandles(candles1m);
    const volumes1m = volumesFromCandles(candles1m);
    const isCurrentCandleOpen =
      volumes1m.length > 1 && volumes1m[volumes1m.length - 1] === 0;
    const closedPrices = isCurrentCandleOpen ? prices1m.slice(0, -1) : prices1m;

    // 2. 추세 붕괴(현재가 < MA20 × (1 - 버퍼)): 수익률과 관계없이 즉시 매도
    if (closedPrices.length >= MA20_PERIOD) {
      const ma20_1m = calculateSMA(
        closedPrices.slice(-MA20_PERIOD),
        MA20_PERIOD,
      );
      const ma20BreakThreshold = ma20_1m * (1 - STRATEGY_D_MA20_BREAK_BUFFER);
      if (currentPrice < ma20BreakThreshold) {
        logger.info(
          LOG_SOURCE,
          "[시그널] %s | 손절 (가격 %s < MA20 버퍼 기준 %s)",
          market,
          currentPrice.toFixed(0),
          ma20BreakThreshold.toFixed(0),
        );
        return {
          shouldSell: true,
          reason: `전략D 손절 (가격 ${currentPrice.toFixed(0)} < MA20 버퍼 기준 ${ma20BreakThreshold.toFixed(0)})`,
        };
      }
    }

    // 3. 익절: 마감 봉 MA5 하향 이탈 + 최소 수익 구간 도달 시에만
    if (closedPrices.length >= MA5_PERIOD) {
      const lastClose = closedPrices[closedPrices.length - 1];
      const ma5_1m = calculateSMA(closedPrices.slice(-MA5_PERIOD), MA5_PERIOD);
      const isMa5Broken = lastClose < ma5_1m;
      const isMinProfitReached =
        netProfitPct > STRATEGY_D_MIN_PROFIT_BEFORE_MA5_EXIT;

      if (isMa5Broken && isMinProfitReached) {
        logger.info(
          LOG_SOURCE,
          "[시그널] %s | 익절 (MA5 하향 이탈) 종가 %s < MA5 %s | 순수익 %s%%",
          market,
          lastClose.toFixed(0),
          ma5_1m.toFixed(0),
          netProfitPct.toFixed(2),
        );
        return {
          shouldSell: true,
          reason: `전략D 익절 (MA5 하향 이탈 ${lastClose.toFixed(0)} < ${ma5_1m.toFixed(0)}, 순수익 ${netProfitPct.toFixed(2)}%)`,
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
