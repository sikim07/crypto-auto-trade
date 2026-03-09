import { getCandles } from "../data/candleWindow";
import {
  REGIME_CRASH_LOOKBACK,
  REGIME_CRASH_PCT,
  REGIME_CRASH_COOLDOWN_MS,
  REGIME_PANIC_VOLUME_RATIO,
  REGIME_PANIC_VOLUME_LOOKBACK,
  REGIME_CACHE_MS,
  REGIME_TREND_FILTER_ENABLED,
  REGIME_BTC_MA_FAST,
  REGIME_BTC_MA_SLOW,
} from "../config";
import { calculateSMA } from "../indicators";
import { logger } from "../logger";

const LOG_SOURCE = "marketRegime";

/** 마지막으로 급락이 감지된 시각 (쿨다운 계산용) */
let lastCrashDetectedAt = 0;

/**
 * BTC MA 추세 필터: 직전 bearTrend 상태 저장
 * - 전환 시(false→true, true→false)에만 로그 1회 출력해 로그 노이즈 방지
 * - 프로세스 재기동 시 false로 초기화되므로 기동 직후 추세 상태 로그가 1회 찍힘
 */
let prevBearTrend = false;

/** 캐시된 레짐 상태 */
let regimeCache: {
  crashing: boolean;
  panicVolume: boolean;
  bearTrend: boolean;
  updatedAt: number;
} = { crashing: false, panicVolume: false, bearTrend: false, updatedAt: 0 };

/** 레이어 1: BTC 30분 급락 감지 (하드 차단) */
const isBtcCrashing = (): boolean => {
  const candles5m = getCandles("KRW-BTC", 5);
  if (candles5m.length < REGIME_CRASH_LOOKBACK + 1) return false;

  const prices = candles5m.map((c) => c.trade_price);
  const priceNow = prices[prices.length - 1];
  const priceThen = prices[prices.length - 1 - REGIME_CRASH_LOOKBACK];
  if (priceThen <= 0) return false;

  const change = ((priceNow - priceThen) / priceThen) * 100;
  return change <= REGIME_CRASH_PCT;
};

/**
 * ──────────────────────────────────────────────────────────────
 * 레이어 1.5: BTC 5분봉 MA 추세 감지 (소프트 차단)
 *
 * [수정 이유]
 *   기존 isBtcCrashing()은 30분 내 -2% 급락만 차단.
 *   완만한 하락 추세(시간당 -0.5~-1.5%)에서는 차단이 전혀 없어
 *   하락 종목에 계속 매수 신호가 발생하고 반복 손절 발생.
 *
 * [판단 기준]
 *   BTC 5분봉 MA5(25분) < MA20(100분) → 하락 추세로 판단
 *   - MA5가 MA20 아래 = 단기 평균이 중기 평균보다 낮음 = 가격 하락 중
 *   - 크로스 기반이라 단순 가격 비교보다 노이즈에 강함
 *
 * [REGIME_TREND_FILTER_ENABLED=false 시]
 *   이 함수는 항상 false 반환 → bearTrend 차단 비활성화
 *   (테스트 목적으로 필터를 끄고 싶을 때 config에서 변경)
 *
 * [앞으로 확인할 것]
 *   - REGIME_CACHE_MS(60초)마다 갱신 → 최대 60초 지연 있음
 *   - BTC 5분봉 캔들이 REGIME_BTC_MA_SLOW(20개) 미만이면 false 반환
 *     (봇 초기 기동 직후 약 100분간 판단 보류)
 * ──────────────────────────────────────────────────────────────
 */
const isBtcBearTrend = (): boolean => {
  if (!REGIME_TREND_FILTER_ENABLED) return false;
  const candles5m = getCandles("KRW-BTC", 5);
  if (candles5m.length < REGIME_BTC_MA_SLOW) return false;

  const prices = candles5m.map((c) => c.trade_price);
  const maFast = calculateSMA(prices.slice(-REGIME_BTC_MA_FAST), REGIME_BTC_MA_FAST);
  const maSlow = calculateSMA(prices.slice(-REGIME_BTC_MA_SLOW), REGIME_BTC_MA_SLOW);
  return maFast < maSlow;
};

/** 레이어 2: BTC 패닉 거래량 감지 (하드 차단) */
const isBtcPanicVolume = (): boolean => {
  const candles5m = getCandles("KRW-BTC", 5);
  const needed = REGIME_PANIC_VOLUME_LOOKBACK + 1;
  if (candles5m.length < needed) return false;

  const last = candles5m[candles5m.length - 1];
  if (last.trade_price >= last.opening_price) return false;

  const volumes = candles5m.map((c) => c.candle_acc_trade_volume);
  const prevVols = volumes.slice(-needed, -1);
  const avgVol = prevVols.reduce((a, b) => a + b, 0) / prevVols.length;
  const lastVol = volumes[volumes.length - 1];

  return avgVol > 0 && lastVol > avgVol * REGIME_PANIC_VOLUME_RATIO;
};

export interface MarketRegime {
  crashing: boolean;
  panicVolume: boolean;
  /** BTC 5분봉 MA 하락 추세 여부 (REGIME_TREND_FILTER_ENABLED=true 일 때만 유효) */
  bearTrend: boolean;
}

export const getMarketRegime = (): MarketRegime => {
  const now = Date.now();
  if (now - regimeCache.updatedAt <= REGIME_CACHE_MS) {
    return regimeCache;
  }

  const crashingNow = isBtcCrashing();
  if (crashingNow) {
    lastCrashDetectedAt = now;
    logger.warn(LOG_SOURCE, "BTC 급락 감지됨");
  }

  const inCooldown =
    lastCrashDetectedAt > 0 &&
    now - lastCrashDetectedAt < REGIME_CRASH_COOLDOWN_MS;

  if (inCooldown && !crashingNow) {
    const remainMin = Math.ceil(
      (REGIME_CRASH_COOLDOWN_MS - (now - lastCrashDetectedAt)) / 60_000,
    );
    logger.debug(LOG_SOURCE, "BTC 급락 쿨다운 중 (잔여 %s분)", remainMin);
  }

  // BTC MA 추세 필터: 전환 시에만 로그
  // prevBearTrend와 비교해 상태가 바뀔 때(하락→상승, 상승→하락)만 warn 로그 1회 출력
  // → 매 틱마다 같은 로그가 반복되는 노이즈 방지
  const bearTrendNow = isBtcBearTrend();
  if (bearTrendNow && !prevBearTrend) {
    logger.debug(
      LOG_SOURCE,
      "[MA추세] BTC 5분봉 MA%s < MA%s — 하락 추세 감지, 매수 차단 (시작)",
      String(REGIME_BTC_MA_FAST),
      String(REGIME_BTC_MA_SLOW),
    );
  } else if (!bearTrendNow && prevBearTrend) {
    logger.debug(
      LOG_SOURCE,
      "[MA추세] BTC 5분봉 MA%s > MA%s — 하락 추세 해제, 매수 재개 (종료)",
      String(REGIME_BTC_MA_FAST),
      String(REGIME_BTC_MA_SLOW),
    );
  }
  prevBearTrend = bearTrendNow;

  const newRegime = {
    crashing: crashingNow || inCooldown,
    panicVolume: isBtcPanicVolume(),
    bearTrend: bearTrendNow,
    updatedAt: now,
  };

  if (newRegime.crashing) {
    const remainMin = Math.ceil(
      (REGIME_CRASH_COOLDOWN_MS - (now - lastCrashDetectedAt)) / 60_000,
    );
    logger.debug(
      LOG_SOURCE,
      "BTC 급락 중 — 매수 차단 (쿨다운 잔여 %s분)",
      remainMin,
    );
  }

  regimeCache = newRegime;
  return newRegime;
};
