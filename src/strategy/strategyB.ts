import { getCandles, minuteStart } from "../data/candleWindow";
import { calculateRSI, calculateMACD } from "../indicators";
import {
  RSI_PERIOD,
  MACD_SLOW,
  MACD_SIGNAL,
  COST_PCT,
  STRATEGY_B_STOP_LOSS_PCT,
  STRATEGY_B_MAX_HOLD_MINUTES,
  STRATEGY_B_TRAILING_ACTIVATE_PCT,
  STRATEGY_B_TRAILING_OFFSET_PCT,
  RSI_TAKE_PROFIT_MIN_PCT,
} from "../config";
import type { BuySignalResult, SellSignalResult } from "./signal";
import type { BotPosition } from "../types";
import { logger } from "../logger";
import type { UpbitCandle } from "../types";

const LOG_SOURCE = "strategyB";
const pricesFromCandles = (candles: { trade_price: number }[]): number[] =>
  candles.map((c) => c.trade_price);

/** 현재 분과 같은 1분봉(미완성)을 제외하고 마감된 1분봉만 반환. 휩쏘 방지용 */
function getClosed1mCandles(market: string): UpbitCandle[] {
  const candles = getCandles(market, 1);
  if (candles.length === 0) return [];
  const last = candles[candles.length - 1];
  if (minuteStart(Date.now()) <= minuteStart(last.timestamp)) {
    return candles.slice(0, -1);
  }
  return candles;
}

/** 순수익률 (비용 차감) */
const getNetProfitPct = (buyPrice: number, currentPrice: number): number => {
  const raw = ((currentPrice - buyPrice) / buyPrice) * 100;
  return raw - COST_PCT;
};

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

/** 전략 B 매수: 5분봉 MACD hist>0, 1분봉 골든크로스 + RSI 50 상향(또는 다이버전스 시 RSI 40 상향). 1분봉은 마감된 봉만 사용(휩쏘 방지). */
export const checkBuySignalB = (
  market: string,
  currentPrice: number,
): (BuySignalResult & { strategy: "B" }) | null => {
  const candles1m = getClosed1mCandles(market);
  const candles5m = getCandles(market, 5);
  const min1m = MACD_SLOW + MACD_SIGNAL + 2;
  const min5m = MACD_SLOW + MACD_SIGNAL + 1;
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
    // histPct = 5분봉 MACD_hist / 현재가 × 100 (%).
    // 제안 1(MACD_hist 정규화 필터) 임계값 결정을 위한 수집 데이터.
    // 매수 신호 발동 시에만 찍히므로 로그 빈도 증가 없음.
    // 수집 후 손익 결과와 대조해 손실 케이스의 histPct 상한을 임계값으로 설정.
    const histPct = (macd5m.histogram / currentPrice) * 100;
    logger.info(
      LOG_SOURCE,
      "[BT] B 매수 MACD_hist=%s histPct=%s%% RSI=%s thr=%s div=%s price=%s",
      macd5m.histogram.toFixed(6),
      histPct.toFixed(4),
      rsiCur.toFixed(1),
      String(threshold),
      withDivergence ? "1" : "0",
      currentPrice.toFixed(0),
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

/** 전략 B 매도: 하드 손절 → 최대 보유 시간 → MACD 데드크로스+RSI 50 미만 손절 → RSI 70 하향 익절. 1분봉은 마감된 봉만 사용. */
export const checkSellSignalB = (
  market: string,
  position: BotPosition,
  currentPrice: number,
): SellSignalResult => {
  const netPct = getNetProfitPct(position.buyPrice, currentPrice);

  if (netPct <= STRATEGY_B_STOP_LOSS_PCT) {
    logger.info(
      LOG_SOURCE,
      "[시그널] %s | 손절 (순수익 %s%%)",
      market,
      netPct.toFixed(2),
    );
    logger.info(
      LOG_SOURCE,
      "[BT] B 매도 type=손절 netPct=%s thr=%s",
      netPct.toFixed(2),
      String(STRATEGY_B_STOP_LOSS_PCT),
    );
    return {
      shouldSell: true,
      reason: `전략B 손절 (순수익 ${netPct.toFixed(2)}%)`,
    };
  }

  const holdMin = (Date.now() - position.buyTime) / 60_000;
  if (holdMin >= STRATEGY_B_MAX_HOLD_MINUTES) {
    logger.info(
      LOG_SOURCE,
      "[시그널] %s | 최대 보유시간 초과 (%s분, 순수익 %s%%)",
      market,
      holdMin.toFixed(0),
      netPct.toFixed(2),
    );
    logger.info(
      LOG_SOURCE,
      "[BT] B 매도 type=최대보유 holdMin=%s netPct=%s maxHold=%s",
      holdMin.toFixed(0),
      netPct.toFixed(2),
      String(STRATEGY_B_MAX_HOLD_MINUTES),
    );
    return {
      shouldSell: true,
      reason: `전략B 최대 보유시간 초과 (${holdMin.toFixed(0)}분, 순수익 ${netPct.toFixed(2)}%)`,
    };
  }

  // [5차 개선] 트레일링 스톱 — +0.8% 도달 후 고점 대비 0.5% 하락 시 익절
  // RSI 70 익절보다 먼저 체크해 수익 구간에서 더 빠른 청산 가능
  if (position.trailingActivated && position.highestPrice != null) {
    const threshold =
      position.highestPrice * (1 - STRATEGY_B_TRAILING_OFFSET_PCT / 100);
    if (currentPrice <= threshold) {
      logger.info(
        LOG_SOURCE,
        "[시그널] %s | 트레일링 스톱 (고점 %s%% → 현재 %s%%)",
        market,
        getNetProfitPct(position.buyPrice, position.highestPrice).toFixed(2),
        netPct.toFixed(2),
      );
      logger.info(
        LOG_SOURCE,
        "[BT] B 매도 type=트레일링 maxPct=%s curPct=%s offsetPct=%s",
        getNetProfitPct(position.buyPrice, position.highestPrice).toFixed(2),
        netPct.toFixed(2),
        String(STRATEGY_B_TRAILING_OFFSET_PCT),
      );
      return {
        shouldSell: true,
        reason: `전략B 트레일링 스톱 (고점 ${getNetProfitPct(position.buyPrice, position.highestPrice).toFixed(2)}% → 현재 ${netPct.toFixed(2)}%)`,
      };
    }
  }

  const candles1m = getClosed1mCandles(market);
  const prices = pricesFromCandles(candles1m);
  let rsiCur: number | undefined;
  if (prices.length >= RSI_PERIOD + 1) {
    rsiCur = calculateRSI(prices.slice(-(RSI_PERIOD + 1)));
  }

  const minLen = MACD_SLOW + MACD_SIGNAL + 1;
  if (candles1m.length >= minLen) {
    const macd = calculateMACD(prices);
    const deadCross =
      macd.prevMacd >= macd.prevSignal && macd.macd < macd.signal;
    /*
     * [4차 개선 검토 보류] 데드크로스 손절 조건 강화 — SELECT_MIN_PRICE=200 적용 후 재관찰 예정
     *
     * [배경]
     *   로그 분석에서 ICX(58~59원) 데드크로스 손절 3연속 발생 (RSI 45.5, 45.8, 46.7).
     *   이 케이스들은 SELECT_MIN_PRICE=200 필터로 ICX 자체가 종목 선정에서 제외되어
     *   4차 개선 이후 재발 가능성이 낮아짐. 별도 조건 강화 없이 경과 관찰.
     *
     * [검토했던 대안 3가지]
     *   A. RSI 임계값 낮춤 (< 50 → < 45)
     *      - 구현 단순. RSI 45~49 구간 데드크로스 차단.
     *      - 위험: 차단 후 RSI가 계속 하락하면 하드손절(-1.5%)까지 손실 확대.
     *
     *   B. 진입 후 N분 이내 데드크로스 무시 ("쿨인" 기간, 권장 3분)
     *      - 매수 직후 노이즈성 데드크로스 차단. 하드손절은 그대로 작동해 하한 보호.
     *      - const DEAD_CROSS_GRACE_MIN = 3; holdMin >= DEAD_CROSS_GRACE_MIN 조건 추가.
     *      - 위험: 쿨인 기간 중 실제 추세 전환 시 손실이 더 깊어질 수 있음.
     *
     *   C. 연속 2봉 데드크로스 확인
     *      - 1봉 허수 크로스 제거 효과 가장 큼.
     *      - calculateMACD가 prevPrevMacd를 반환하지 않아 indicators 수정 필요.
     *      - 1봉 지연으로 손실이 0.5~1% 더 깊어질 수 있음.
     *
     * [재검토 시점]
     *   SELECT_MIN_PRICE=200 적용 후에도 200원 이상 종목에서 데드크로스 손절이
     *   반복된다면 대안 B(쿨인 기간)를 우선 검토.
     */
    if (deadCross && typeof rsiCur === "number" && rsiCur < RSI_50) {
      logger.info(
        LOG_SOURCE,
        "[시그널] %s | 손절 (MACD 데드크로스 + RSI %s)",
        market,
        rsiCur.toFixed(1),
      );
      logger.info(
        LOG_SOURCE,
        "[BT] B 매도 type=데드크로스 RSI=%s netPct=%s",
        rsiCur.toFixed(1),
        netPct.toFixed(2),
      );
      return {
        shouldSell: true,
        reason: `전략B 손절 (MACD 데드크로스 + RSI ${rsiCur.toFixed(1)})`,
        lastRsi: rsiCur,
      };
    }
  }

  const prevRsi = position.lastRsi ?? 0;
  if (typeof rsiCur === "number") {
    if (prevRsi >= RSI_70 && rsiCur < RSI_70) {
      // [4차 개선] RSI 70 하향 돌파 익절 시 최소 순수익 조건 추가 (RSI_TAKE_PROFIT_MIN_PCT = 0.5%).
      // 기존: 순수익 무관하게 RSI 70 하향만으로 매도 → "익절" 로그에도 실제 순수익 음수 케이스 발생.
      // (로그 분석: RSI 71.4→67.9 순수익 -0.25%, RSI 75.0→64.3 순수익 -0.61% 등 4건)
      // 공통 signal.ts의 checkSellSignal에는 이미 적용되어 있었으나 checkSellSignalB에서 누락됨.
      // 수정: 순수익 0.5% 미만 시 RSI 익절 미발동, 계속 홀딩하여 시간초과 또는 데드크로스 대기.
      if (netPct < RSI_TAKE_PROFIT_MIN_PCT) {
        return { shouldSell: false, lastRsi: rsiCur };
      }
      logger.info(
        LOG_SOURCE,
        "[시그널] %s | 익절 (RSI 70 하향 돌파) %s → %s",
        market,
        prevRsi.toFixed(1),
        rsiCur.toFixed(1),
      );
      logger.info(
        LOG_SOURCE,
        "[BT] B 매도 type=익절 RSI=%s→%s netPct=%s",
        prevRsi.toFixed(1),
        rsiCur.toFixed(1),
        netPct.toFixed(2),
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
