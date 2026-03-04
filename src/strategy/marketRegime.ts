import { getCandles } from "../data/candleWindow";
import {
  REGIME_CRASH_LOOKBACK,
  REGIME_CRASH_PCT,
  REGIME_CRASH_COOLDOWN_MS,
  REGIME_PANIC_VOLUME_RATIO,
  REGIME_PANIC_VOLUME_LOOKBACK,
  REGIME_CACHE_MS,
} from "../config";
import { logger } from "../logger";

const LOG_SOURCE = "marketRegime";

/** 마지막으로 급락이 감지된 시각 (쿨다운 계산용) */
let lastCrashDetectedAt = 0;

/** 캐시된 레짐 상태 */
let regimeCache: {
  crashing: boolean;
  panicVolume: boolean;
  updatedAt: number;
} = { crashing: false, panicVolume: false, updatedAt: 0 };

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

  const newRegime = {
    crashing: crashingNow || inCooldown,
    panicVolume: isBtcPanicVolume(),
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
