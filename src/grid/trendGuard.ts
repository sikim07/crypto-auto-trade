import { GRID } from "./gridConfig";
import { getState } from "./gridState";
import { out, trade } from "../common/logger";

const LOG = "grid/guard";

export type GuardStatus = "ACTIVE" | "PAUSED" | "STOPPED";

let status: GuardStatus = "ACTIVE";
let consecutiveSameSide = 0;
let lastSide: "buy" | "sell" | null = null;
let apiErrorCount = 0;

export const getGuardStatus = (): GuardStatus => status;

export const recordFill = (side: "buy" | "sell"): void => {
  if (side === lastSide) {
    consecutiveSameSide++;
  } else {
    consecutiveSameSide = 1;
    lastSide = side;
  }

  if (consecutiveSameSide >= GRID.MAX_CONSECUTIVE_SAME_SIDE) {
    status = "PAUSED";
    trade.system(LOG, "같은 방향 %s회 연속 → PAUSED (%s)",
      String(consecutiveSameSide), side);
  }
};

export const recordApiError = (): void => {
  apiErrorCount++;
  if (apiErrorCount >= GRID.API_ERROR_THRESHOLD) {
    status = "STOPPED";
    trade.system(LOG, "API 에러 %s회 연속 → STOPPED", String(apiErrorCount));
  }
};

export const resetApiError = (): void => {
  apiErrorCount = 0;
};

export const checkRangeBreak = (currentPrice: number): void => {
  const state = getState();
  if (!state) return;

  if (currentPrice > state.rangeUpper || currentPrice < state.rangeLower) {
    status = "PAUSED";
    const direction = currentPrice > state.rangeUpper ? "상단" : "하단";
    trade.system(LOG, "범위 %s 이탈 (현재가: %s) → PAUSED (범위 복귀 시 자동재개)",
      direction, currentPrice.toLocaleString());
  }
};

export const checkDailyLoss = (dailyProfit: number): void => {
  if (dailyProfit <= -GRID.DAILY_MAX_LOSS_KRW) {
    status = "STOPPED";
    trade.system(LOG, "일일 손실 한도 도달 (%s원) → STOPPED",
      dailyProfit.toFixed(0));
  }
};

export const tryResume = (currentPrice: number): boolean => {
  if (status !== "PAUSED") return false;

  const state = getState();
  if (!state) return false;

  if (currentPrice >= state.rangeLower && currentPrice <= state.rangeUpper) {
    status = "ACTIVE";
    consecutiveSameSide = 0;
    lastSide = null;
    trade.system(LOG, "범위 복귀 (현재가: %s) → ACTIVE", currentPrice.toLocaleString());
    return true;
  }
  return false;
};

export const forceResume = (): void => {
  status = "ACTIVE";
  consecutiveSameSide = 0;
  lastSide = null;
  apiErrorCount = 0;
  trade.system(LOG, "강제 ACTIVE 복귀");
};

export const forceStop = (): void => {
  status = "STOPPED";
  trade.system(LOG, "강제 STOPPED");
};
