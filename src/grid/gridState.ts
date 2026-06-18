import * as fs from "fs";
import * as path from "path";
import { GRID } from "./gridConfig";
import { out } from "../common/logger";
import type { GridState, GridLevel, GridTradeRecord } from "../common/types";

const LOG = "grid/state";
const stateFilePath = path.resolve(process.cwd(), GRID.STATE_FILE);

let state: GridState | null = null;

const getKstDate = (): string => {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
};

export const getState = (): GridState | null => state;

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

export const recordTrade = (profit: number, fee: number, record: GridTradeRecord): void => {
  if (!state) return;
  state.totalRealizedProfit += profit;
  state.totalFees += fee;
  state.tradeCount += 1;
  state.dailyRealizedProfit += profit;
  state.tradeHistory.push(record);
  if (state.tradeHistory.length > 200) {
    state.tradeHistory = state.tradeHistory.slice(-200);
  }
  state.lastUpdatedAt = Date.now();
};

export const saveState = (): void => {
  if (!state) return;
  try {
    fs.writeFileSync(stateFilePath, JSON.stringify(state, null, 2));
  } catch (e) {
    out.warn("state-save", LOG, "상태 저장 실패: %s", (e as Error).message);
  }
};

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

    // 기존 state 마이그레이션 (dailyDate, tradeHistory 없는 경우)
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
