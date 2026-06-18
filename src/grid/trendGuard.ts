/**
 * 추세 감지 모듈 (Trend Guard)
 *
 * 그리드 트레이딩은 횡보장에서만 유효하다.
 * 한 방향 추세가 발생하면 한쪽 주문만 계속 체결되어 손실이 누적된다.
 * 이 모듈은 추세를 감지하여 그리드를 자동 중단/재개한다.
 *
 * 상태 전이:
 *   ACTIVE → PAUSED: 범위 이탈 또는 같은 방향 연속 체결 감지
 *   ACTIVE → STOPPED: API 에러 연속 또는 일일 손실 한도 도달
 *   PAUSED → ACTIVE: 가격이 그리드 범위 내로 복귀하면 자동 재개
 *   STOPPED → (수동 재시작 필요)
 */
import { GRID } from "./gridConfig";
import { getState } from "./gridState";
import { out, trade } from "../common/logger";

const LOG = "grid/guard";

export type GuardStatus = "ACTIVE" | "PAUSED" | "STOPPED";

let status: GuardStatus = "ACTIVE";
let consecutiveSameSide = 0;          // 같은 방향 연속 체결 카운터
let lastSide: "buy" | "sell" | null = null;
let apiErrorCount = 0;                // API 에러 연속 카운터

export const getGuardStatus = (): GuardStatus => status;

/**
 * 체결 기록 — 같은 방향(매수만/매도만)이 N회 연속되면 추세로 판단
 * 예: 매수만 5회 연속 = 하락 추세 → 그리드 일시 중단
 */
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

/** API 에러 연속 카운터 증가 — 임계값 도달 시 봇 완전 중단 */
export const recordApiError = (): void => {
  apiErrorCount++;
  if (apiErrorCount >= GRID.API_ERROR_THRESHOLD) {
    status = "STOPPED";
    trade.system(LOG, "API 에러 %s회 연속 → STOPPED", String(apiErrorCount));
  }
};

/** API 성공 시 에러 카운터 리셋 */
export const resetApiError = (): void => {
  apiErrorCount = 0;
};

/** 현재가가 그리드 범위(상단/하단)를 벗어났는지 확인 */
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

/** 일일 손실 한도 체크 */
export const checkDailyLoss = (dailyProfit: number): void => {
  if (dailyProfit <= -GRID.DAILY_MAX_LOSS_KRW) {
    status = "STOPPED";
    trade.system(LOG, "일일 손실 한도 도달 (%s원) → STOPPED",
      dailyProfit.toFixed(0));
  }
};

/** PAUSED 상태에서 가격이 범위 내로 복귀하면 자동 재개 */
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

/** 강제 재개 (수동 개입용) */
export const forceResume = (): void => {
  status = "ACTIVE";
  consecutiveSameSide = 0;
  lastSide = null;
  apiErrorCount = 0;
  trade.system(LOG, "강제 ACTIVE 복귀");
};

/** 강제 중단 (수동 개입용) */
export const forceStop = (): void => {
  status = "STOPPED";
  trade.system(LOG, "강제 STOPPED");
};
