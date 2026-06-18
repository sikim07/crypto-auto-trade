/**
 * 그리드 상태 관리
 *
 * 그리드 봇의 전체 상태를 메모리에 유지하고, JSON 파일로 주기적 백업한다.
 * PM2 재시작이나 서버 리부팅 시 파일에서 상태를 복구하여 연속 운영이 가능하다.
 *
 * 주요 기능:
 *   - initGrid(): 현재가 기준으로 그리드 레벨(가격 단계) 생성
 *   - recordTrade(): 매수/매도 체결 시 수익/수수료 기록
 *   - saveState() / loadState(): JSON 파일로 백업/복구
 *   - checkDailyReset(): KST 자정 기준 일일 손익 리셋
 */
import * as fs from "fs";
import * as path from "path";
import { GRID } from "./gridConfig";
import { out } from "../common/logger";
import type { GridState, GridLevel, GridTradeRecord } from "../common/types";

const LOG = "grid/state";
const stateFilePath = path.resolve(process.cwd(), GRID.STATE_FILE);

let state: GridState | null = null;

/** KST 기준 오늘 날짜 문자열 ("YYYY-MM-DD") */
const getKstDate = (): string => {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
};

export const getState = (): GridState | null => state;

/**
 * 그리드 초기화: 현재가를 중심으로 상하 범위를 계산하고 레벨 배열 생성
 *
 * 예: 현재가 1억, ±2%, 5단계
 *   → 하단 98,000,000 ~ 상단 102,000,000
 *   → 간격 800,000원
 *   → levels[0]=98,000,000, levels[1]=98,800,000, ..., levels[5]=102,000,000
 */
export const initGrid = (currentPrice: number): GridState => {
  const upper = GRID.RANGE_UPPER || Math.round(currentPrice * (1 + GRID.RANGE_PCT / 100));
  const lower = GRID.RANGE_LOWER || Math.round(currentPrice * (1 - GRID.RANGE_PCT / 100));
  const interval = Math.round((upper - lower) / GRID.GRID_COUNT);

  const levels: GridLevel[] = [];
  for (let i = 0; i <= GRID.GRID_COUNT; i++) {
    const price = lower + interval * i;
    levels.push({
      index: i,
      price,
      status: "idle",
      filledCount: 0,
    });
  }

  state = {
    market: GRID.MARKET,
    rangeUpper: upper,
    rangeLower: lower,
    gridInterval: interval,
    levels,
    totalRealizedProfit: 0,
    totalFees: 0,
    tradeCount: 0,
    dailyRealizedProfit: 0,
    dailyDate: getKstDate(),
    tradeHistory: [],
    startedAt: Date.now(),
    lastUpdatedAt: Date.now(),
  };

  out.info(LOG, "그리드 초기화: %s ~ %s, 간격 %s원, %s단계",
    lower.toLocaleString(), upper.toLocaleString(),
    interval.toLocaleString(), String(GRID.GRID_COUNT));

  return state;
};

/** KST 자정이 지나면 일일 손익을 0으로 리셋 */
export const checkDailyReset = (): void => {
  if (!state) return;
  const today = getKstDate();
  if (state.dailyDate !== today) {
    out.info(LOG, "일일 손익 리셋: %s원 → 0 (날짜 %s → %s)",
      state.dailyRealizedProfit.toFixed(0), state.dailyDate, today);
    state.dailyRealizedProfit = 0;
    state.dailyDate = today;
  }
};

/** 거래 결과 기록 (수익, 수수료, 이력) */
export const recordTrade = (profit: number, fee: number, record: GridTradeRecord): void => {
  if (!state) return;
  state.totalRealizedProfit += profit;
  state.totalFees += fee;
  state.tradeCount += 1;
  state.dailyRealizedProfit += profit;
  state.tradeHistory.push(record);
  // 최근 200건만 유지 (메모리/파일 크기 관리)
  if (state.tradeHistory.length > 200) {
    state.tradeHistory = state.tradeHistory.slice(-200);
  }
  state.lastUpdatedAt = Date.now();
};

/** 상태를 JSON 파일로 저장 (재시작 시 복구용) */
export const saveState = (): void => {
  if (!state) return;
  try {
    fs.writeFileSync(stateFilePath, JSON.stringify(state, null, 2));
  } catch (e) {
    out.warn("state-save", LOG, "상태 저장 실패: %s", (e as Error).message);
  }
};

/**
 * 저장된 상태 파일에서 복구
 * 종목이나 단계 수가 변경되었으면 null 반환 (새 그리드 생성 유도)
 */
export const loadState = (): GridState | null => {
  try {
    if (!fs.existsSync(stateFilePath)) return null;
    const raw = fs.readFileSync(stateFilePath, "utf-8");
    const saved = JSON.parse(raw) as GridState;

    // 설정 불일치 감지: 종목, 단계 수가 바뀌면 새 그리드 생성
    if (saved.market !== GRID.MARKET || saved.levels.length !== GRID.GRID_COUNT + 1) {
      out.info(LOG, "설정 변경 감지 (종목: %s→%s, 단계: %s→%s) — 새 그리드 생성",
        saved.market, GRID.MARKET,
        String(saved.levels.length - 1), String(GRID.GRID_COUNT));
      return null;
    }

    // 기존 state 마이그레이션 (이전 버전에 없던 필드 보정)
    if (!saved.dailyDate) saved.dailyDate = getKstDate();
    if (saved.dailyRealizedProfit === undefined) saved.dailyRealizedProfit = 0;
    if (!saved.tradeHistory) saved.tradeHistory = [];

    state = saved;
    checkDailyReset();
    out.info(LOG, "상태 복구: %s건 거래, 누적 수익 %s원, 금일 수익 %s원",
      String(state.tradeCount), state.totalRealizedProfit.toFixed(0),
      state.dailyRealizedProfit.toFixed(0));
    return state;
  } catch (e) {
    out.warn("state-load", LOG, "상태 복구 실패: %s", (e as Error).message);
    return null;
  }
};

export const getDailyProfit = (): number => {
  if (!state) return 0;
  checkDailyReset();
  return state.dailyRealizedProfit;
};

export const resetState = (): void => {
  state = null;
};
