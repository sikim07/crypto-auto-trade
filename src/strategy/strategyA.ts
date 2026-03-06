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
  STRATEGY_A_AVOID_DOWNTEND,
  STRATEGY_A_RSI_OVERSOLD,
  STRATEGY_A_VOLUME_AVG_PERIOD,
  STRATEGY_A_ATR_STOP_MULTIPLIER,
  STRATEGY_A_MIN_STOP_DISTANCE_PCT,
  STRATEGY_A_MAX_HOLD_MINUTES,
  STRATEGY_A_BB_ENTRY_BUFFER,
  STRATEGY_A_RSI_INTRACANDLE_THRESHOLD,
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
const MA5_5M_PERIOD = 5;
const MA20_5M_PERIOD = 20;

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

    // Phase 3: 단기 추세 필터 — MA200(장기) 위이면서 MA20(단기)도 위여야 당일 하락 추세 배제
    const ma20_5m = calculateSMA(
      prices5m.slice(-MA20_5M_PERIOD),
      MA20_5M_PERIOD,
    );
    if (lastClose5m <= ma20_5m) return null;

    // 역추세: 하락장 진입 차단 — 5분봉 MA5 < MA20 이면 횡보가 아니므로 스킵
    if (STRATEGY_A_AVOID_DOWNTEND) {
      const ma5_5m = calculateSMA(
        prices5m.slice(-MA5_5M_PERIOD),
        MA5_5M_PERIOD,
      );
      if (ma5_5m < ma20_5m) {
        logger.info(
          LOG_SOURCE,
          "[BT] A 매수 스킵 하락추세(MA5<MA20) ma5=%s ma20=%s",
          ma5_5m.toFixed(2),
          ma20_5m.toFixed(2),
        );
        return null;
      }
    }

    const prices1m = pricesFromCandles(candles1m);
    const volumes1m = volumesFromCandles(candles1m);
    const bb = calculateBollingerBands(prices1m);

    // Phase 2a: BB 거리 제한 — 두 진입 경로 공통 최대 허용 거리: bb.lower * 1.01 초과는 차단
    // (마감봉 경로는 이후 엄격한 조건으로 재확인, 인트라캔들 경로는 이 버퍼까지 허용)
    const condBBBuffer = currentPrice <= bb.lower * STRATEGY_A_BB_ENTRY_BUFFER;
    if (!condBBBuffer) return null;

    const isCurrentCandleOpen =
      volumes1m.length > 1 && volumes1m[volumes1m.length - 1] === 0;
    const closedPrices = isCurrentCandleOpen ? prices1m.slice(0, -1) : prices1m;
    const closedVolumes = isCurrentCandleOpen
      ? volumes1m.slice(0, -1)
      : volumes1m;
    if (closedPrices.length < RSI_PERIOD + 2) return null;

    // Phase 2a: 최근 BB 이탈 확인 — 최근 3개 마감봉 중 하나라도 BB 하단 이탈이 있어야 유효
    // RSI 돌파가 오래된 저점 기반(반등이 수 분 이상 진행)이면 차단
    const RECENT_BB_BREAK_LOOKBACK = 3;
    const recentBBBreak = closedPrices
      .slice(-RECENT_BB_BREAK_LOOKBACK)
      .some((p) => p <= bb.lower);
    if (!recentBBBreak) return null;

    const rsiPrices = closedPrices.slice(-(RSI_PERIOD + 2));
    const rsiPrev = calculateRSI(rsiPrices.slice(0, -1));
    const rsiCur = calculateRSI(rsiPrices);
    const condRsiOversold = rsiPrev < STRATEGY_A_RSI_OVERSOLD;
    const condRsiCrossUp = rsiCur >= STRATEGY_A_RSI_OVERSOLD;

    // rsiPrev >= 30이면 과매도 구간 진입 자체가 없었음 → 차단
    if (!condRsiOversold) return null;

    let isIntraEntry = false;
    if (!condRsiCrossUp) {
      // Phase 2b: 마감봉 RSI가 아직 30 미달 → 인트라캔들(미완성 봉 포함) RSI로 조기 진입 시도
      // 인트라캔들 경로: 현재 봉이 반등 중이므로 bb.lower * 1.01 이내(condBBBuffer)까지 허용
      const rsiIntra = calculateRSI(prices1m.slice(-(RSI_PERIOD + 1)));
      if (rsiIntra < STRATEGY_A_RSI_INTRACANDLE_THRESHOLD) return null;
      // 인트라캔들 RSI >= 31 확인 → 마감봉 기다리지 않고 진입 허용 (최대 1분 조기 진입)
      isIntraEntry = true;
    } else {
      // 마감봉 경로: 반등이 이미 확인된 상태이므로 현재가가 bb.lower 이하여야 함 (엄격)
      if (currentPrice > bb.lower) return null;
    }

    const lastClosedVol =
      closedVolumes.length > 0 ? closedVolumes[closedVolumes.length - 1] : 0;
    const prevVolumes = closedVolumes.slice(0, -1);
    const volRatio = getVolumeRatio(
      lastClosedVol,
      prevVolumes,
      STRATEGY_A_VOLUME_AVG_PERIOD,
    );
    if (volRatio <= 1) return null;

    const entryMode = isIntraEntry ? "인트라캔들RSI조기" : "마감봉RSI돌파";
    logger.info(
      LOG_SOURCE,
      "[시그널] %s | 매수 조건 충족 | 가격 %s | BB하단·RSI30상향(%s)·거래량",
      market,
      currentPrice.toFixed(0),
      entryMode,
    );
    logger.info(
      LOG_SOURCE,
      "[BT] A 매수 RSI=%s volRatio=%s entry=%s price=%s",
      rsiCur.toFixed(1),
      volRatio.toFixed(2),
      entryMode,
      currentPrice.toFixed(0),
    );
    return {
      shouldBuy: true,
      reason: `전략A: BB하단+RSI30상향돌파(${entryMode})+거래량`,
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

  // rawStop: 기존 두 손절선 중 더 높은 쪽 (진입캔들 저점 vs ATR 기반)
  const rawStop =
    entryCandleLow !== undefined && entryAtr > 0
      ? Math.max(entryCandleLow, atrStopPrice)
      : entryCandleLow !== undefined
        ? entryCandleLow
        : entryAtr > 0
          ? atrStopPrice
          : buyPrice;

  // minStop: 매수가 기준 최소 손절 거리 보장 — rawStop이 너무 가까우면 내려서 숨 쉴 공간 확보
  const minStop = buyPrice * (1 - STRATEGY_A_MIN_STOP_DISTANCE_PCT / 100);
  const stopPrice = Math.min(rawStop, minStop);

  // 최대 보유 시간 초과 체크 (손절보다 먼저 확인)
  const holdMin = (Date.now() - position.buyTime) / 60_000;
  if (holdMin >= STRATEGY_A_MAX_HOLD_MINUTES) {
    logger.info(
      LOG_SOURCE,
      "[시그널] %s | 최대보유 초과 (%s분) | 현재가 %s",
      market,
      holdMin.toFixed(1),
      currentPrice.toFixed(0),
    );
    logger.info(
      LOG_SOURCE,
      "[BT] A 매도 type=최대보유 holdMin=%s price=%s maxHold=%s",
      holdMin.toFixed(1),
      currentPrice.toFixed(0),
      String(STRATEGY_A_MAX_HOLD_MINUTES),
    );
    return {
      shouldSell: true,
      reason: `전략A 최대보유 초과 (${holdMin.toFixed(1)}분, 현재가 ${currentPrice.toFixed(0)})`,
    };
  }

  if (currentPrice <= stopPrice) {
    const usedMinStop = rawStop > minStop;
    const stopReason = usedMinStop
      ? "최소거리보장"
      : entryCandleLow !== undefined && stopPrice === entryCandleLow
        ? "진입캔들 저점 이탈"
        : "ATR 손절";
    logger.info(
      LOG_SOURCE,
      "[시그널] %s | 손절(%s) | 현재가 %s <= 손절가 %s",
      market,
      stopReason,
      currentPrice.toFixed(0),
      stopPrice.toFixed(0),
    );
    logger.info(
      LOG_SOURCE,
      "[BT] A 매도 type=손절 stopPrice=%s price=%s reason=%s",
      stopPrice.toFixed(0),
      currentPrice.toFixed(0),
      stopReason,
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
      logger.info(
        LOG_SOURCE,
        "[BT] A 매도 type=익절 price=%s bbMiddle=%s",
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
