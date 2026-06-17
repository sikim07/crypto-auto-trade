import { getCandles } from "../data/candleWindow";
import {
  calculateBollingerBands,
  getVolumeRatio,
  calculateRSI,
} from "../indicators";
import {
  BB_PERIOD,
  RSI_PERIOD,
  STRATEGY_C_BB_SQUEEZE_RATIO,
  STRATEGY_C_VOLUME_RATIO,
  STRATEGY_C_VOLUME_AVG_PERIOD,
  STRATEGY_C_BODY_RATIO_MIN,
  STRATEGY_C_RSI_MAX,
  STRATEGY_C_TRAILING_ACTIVATE_PCT,
  STRATEGY_C_TRAILING_OFFSET_PCT,
  STRATEGY_C_STOP_LOSS_PCT,
  STRATEGY_C_MAX_HOLD_MINUTES,
  STRATEGY_C_BB_GRACE_MIN,
  STRATEGY_C_BB_MIDDLE_BUFFER,
  COST_PCT,
} from "../config";
import type { BuySignalResult, SellSignalResult } from "./signal";
import type { BotPosition } from "../types";
import { logger } from "../logger";
import { logVolumeSkipTransition } from "./volumeSkipState";

const LOG_SOURCE = "strategyC";
/** BB 중앙 버퍼 유예 상태 (마켓별) — 전환 시점에만 로그 */
const bbMiddleBufferSaveState = new Map<string, boolean>();
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
    if (volRatio < STRATEGY_C_VOLUME_RATIO) {
      logVolumeSkipTransition(
        market,
        "C",
        true,
        volRatio,
        STRATEGY_C_VOLUME_RATIO,
      );
      return null;
    }
    logVolumeSkipTransition(
      market,
      "C",
      false,
      volRatio,
      STRATEGY_C_VOLUME_RATIO,
    );

    // [v3.6.20260317] RSI 상한 체크: 과매수 구간(> STRATEGY_C_RSI_MAX) 거짓 돌파 방지.
    // BT 로그에 rsiCur 포함 → 손절/익절 케이스별 RSI 분포 수집 후 임계값 조정 판단.
    // 데이터 부족 시 우선 상한만 적용, 이후 하한(약세 구간 돌파 차단) 추가 여부 검토.
    let rsiCurC: number | undefined;
    if (closedPrices.length >= RSI_PERIOD + 1) {
      rsiCurC = calculateRSI(closedPrices.slice(-(RSI_PERIOD + 1)));
      if (rsiCurC > STRATEGY_C_RSI_MAX) {
        return null;
      }
    }

    logger.info(
      LOG_SOURCE,
      "[시그널] %s | 매수 조건 충족 | 가격 %s | BB수축+상단돌파+거래량 %s",
      market,
      currentPrice.toFixed(0),
      volRatio * 100,
    );
    logger.info(
      LOG_SOURCE,
      "[BT] C 매수 bandWidth=%s volRatio=%s bodyRatio=%s rsiCur=%s price=%s",
      bandWidth.toFixed(4),
      volRatio.toFixed(2),
      bodyRatio.toFixed(2),
      rsiCurC != null ? rsiCurC.toFixed(1) : "N/A",
      currentPrice.toFixed(0),
    );
    return {
      shouldBuy: true,
      reason: "전략C: BB수축+상단돌파+거래량(배수)+몸통비",
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

/**
 * 전략 C 매도: 고정 손절 → 최대 보유 → 트레일링 스톱(신규 우선) → BB 중앙선(마감 봉 기준)
 *
 * [v3.3.20260310] 트레일링 체크 순서를 BB중앙 이전으로 이동 (config 파라미터 변경 연동)
 *   - TRAILING_ACTIVATE_PCT: 2% → 0.8% (실제 최대수익 구간인 0.8~1.2%에서 발동 가능)
 *   - TRAILING_OFFSET_PCT: 1.5% → 0.5% (수익 보존력 강화)
 *   - 순서 변경 이유: 기존에는 BB중앙 하향 체크가 먼저 실행되어, 트레일링이 활성화된
 *     상태에서도 BB중앙 조건이 먼저 매도를 발동시켜 수익을 환원하는 문제 발생.
 *     (2026-03-10: 최대 1.19% → BB중앙 하향으로 +0.01% 청산)
 *     이제 트레일링 발동 중이면 BB중앙은 트레일링 미발동 시의 안전장치로만 작동.
 */
export const checkSellSignalC = (
  market: string,
  position: BotPosition,
  currentPrice: number,
): SellSignalResult => {
  const netPct = getNetProfitPct(position.buyPrice, currentPrice);

  if (netPct <= STRATEGY_C_STOP_LOSS_PCT) {
    logger.info(
      LOG_SOURCE,
      "[시그널] %s | 손절 (순수익 %s%)",
      market,
      netPct.toFixed(2),
    );
    logger.info(
      LOG_SOURCE,
      "[BT] C 매도 type=손절 netPct=%s thr=%s",
      netPct.toFixed(2),
      String(STRATEGY_C_STOP_LOSS_PCT),
    );
    return {
      shouldSell: true,
      reason: `전략C 손절 (순수익 ${netPct.toFixed(2)}%)`,
    };
  }

  const holdMin = (Date.now() - position.buyTime) / 60_000;
  if (holdMin >= STRATEGY_C_MAX_HOLD_MINUTES) {
    logger.info(
      LOG_SOURCE,
      "[시그널] %s | 최대 보유시간 초과 (%s분, 순수익 %s%)",
      market,
      holdMin.toFixed(0),
      netPct.toFixed(2),
    );
    logger.info(
      LOG_SOURCE,
      "[BT] C 매도 type=최대보유 holdMin=%s netPct=%s maxHold=%s",
      holdMin.toFixed(0),
      netPct.toFixed(2),
      String(STRATEGY_C_MAX_HOLD_MINUTES),
    );
    return {
      shouldSell: true,
      reason: `전략C 최대 보유시간 초과 (${holdMin.toFixed(0)}분, 순수익 ${netPct.toFixed(2)}%)`,
    };
  }

  // [v3.3.20260310] 트레일링 스톱을 BB중앙 체크보다 먼저 실행
  // trailingActivated는 index.ts에서 maxNetPct >= STRATEGY_C_TRAILING_ACTIVATE_PCT(0.8%) 시 설정
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
      logger.info(
        LOG_SOURCE,
        "[BT] C 매도 type=트레일링 high=%s offsetPct=%s netPct=%s",
        position.highestPrice.toFixed(0),
        String(STRATEGY_C_TRAILING_OFFSET_PCT),
        netPct.toFixed(2),
      );
      return {
        shouldSell: true,
        reason: `전략C 익절 트레일링 (고가 ${position.highestPrice.toFixed(0)} 대비 -${STRATEGY_C_TRAILING_OFFSET_PCT}%)`,
      };
    }
  }

  // [v3.8.20260320] BB 중앙 손절 grace period: 진입 후 STRATEGY_C_BB_GRACE_MIN분 이내 유예
  // BB 상단 돌파 직후 정상적인 pull-back은 3분 이내에 회복되는 것이 일반적.
  // "824 < 중앙 824" 같은 반올림 오차 수준의 즉시 손절 방지. 하드 손절(-1.5%)은 그대로 작동.
  if (holdMin < STRATEGY_C_BB_GRACE_MIN) return { shouldSell: false };

  // BB중앙 하향: 트레일링 미발동(수익 0.8% 미만) 구간에서의 안전장치
  const candles1m = getCandles(market, 1);
  const volumes1m = volumesFromCandles(candles1m);
  const isCurrentCandleOpen =
    volumes1m.length > 1 && volumes1m[volumes1m.length - 1] === 0;
  const closedCandles = isCurrentCandleOpen
    ? candles1m.slice(0, -1)
    : candles1m;
  // [v3.9.20260322] BB 중앙 손절 버퍼: 중앙선 대비 STRATEGY_C_BB_MIDDLE_BUFFER(0.1%) 이상 하락해야 발동.
  // grace period(3분)와 조합해 2중 보호: 초기 조정 유예 + 미세 오차 손절 방지.
  if (closedCandles.length >= BB_PERIOD) {
    const closedPrices = closedCandles.map((c) => c.trade_price);
    const bb = calculateBollingerBands(closedPrices.slice(-BB_PERIOD));
    const bbMiddleThreshold = bb.middle * (1 - STRATEGY_C_BB_MIDDLE_BUFFER);
    if (currentPrice < bbMiddleThreshold) {
      bbMiddleBufferSaveState.set(market, false);
      logger.info(
        LOG_SOURCE,
        "[시그널] %s | 손절 (BB 중앙 하향, 마감봉 기준) | 현재가 %s < 기준 %s (중앙 %s)",
        market,
        currentPrice.toFixed(0),
        bbMiddleThreshold.toFixed(0),
        bb.middle.toFixed(0),
      );
      logger.info(
        LOG_SOURCE,
        "[BT] C 매도 type=BB중앙하향 price=%s bbMiddle=%s thr=%s netPct=%s holdMin=%s",
        currentPrice.toFixed(0),
        bb.middle.toFixed(0),
        bbMiddleThreshold.toFixed(0),
        netPct.toFixed(2),
        holdMin.toFixed(1),
      );
      return {
        shouldSell: true,
        reason: `전략C 손절 (가격 ${currentPrice.toFixed(0)} < BB중앙버퍼 ${bbMiddleThreshold.toFixed(0)})`,
      };
    }
    // [v3.9.20260322] 버퍼 유예 상태 전환 로그 (price < middle 이지만 버퍼 이내 — 손절 유예 중)
    const inBufferZone = currentPrice < bb.middle;
    const wasInBufferZone = bbMiddleBufferSaveState.get(market) ?? false;
    if (inBufferZone && !wasInBufferZone) {
      logger.info(
        LOG_SOURCE,
        "[BT] C BB버퍼 유예 — 시작 price=%s bbMiddle=%s thr=%s netPct=%s holdMin=%s",
        currentPrice.toFixed(0),
        bb.middle.toFixed(0),
        bbMiddleThreshold.toFixed(0),
        netPct.toFixed(2),
        holdMin.toFixed(1),
      );
    } else if (!inBufferZone && wasInBufferZone) {
      logger.info(
        LOG_SOURCE,
        "[BT] C BB버퍼 유예 — 끝 (회복) price=%s bbMiddle=%s netPct=%s holdMin=%s",
        currentPrice.toFixed(0),
        bb.middle.toFixed(0),
        netPct.toFixed(2),
        holdMin.toFixed(1),
      );
    }
    bbMiddleBufferSaveState.set(market, inBufferZone);
  }

  return { shouldSell: false };
};
