import * as fs from "fs";
import * as path from "path";
import { GRID } from "./gridConfig";
import { out } from "../common/logger";
import type { GridState, GridLevel } from "../common/types";

const LOG = "grid/state";
const stateFilePath = path.resolve(process.cwd(), GRID.STATE_FILE);

let state: GridState | null = null;

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
    startedAt: Date.now(),
    lastUpdatedAt: Date.now(),
  };

  out.info(LOG, "그리드 초기화: %s ~ %s, 간격 %s원, %s단계",
    lower.toLocaleString(), upper.toLocaleString(),
    interval.toLocaleString(), String(GRID.GRID_COUNT));

  return state;
};

export const recordTrade = (profit: number, fee: number): void => {
  if (!state) return;
  state.totalRealizedProfit += profit;
  state.totalFees += fee;
  state.tradeCount += 1;
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
    state = JSON.parse(raw) as GridState;
    out.info(LOG, "상태 복구: %s건 거래, 누적 수익 %s원",
      String(state.tradeCount), state.totalRealizedProfit.toFixed(0));
    return state;
  } catch (e) {
    out.warn("state-load", LOG, "상태 복구 실패: %s", (e as Error).message);
    return null;
  }
};

export const getDailyProfit = (): number => {
  if (!state) return 0;
  return state.totalRealizedProfit;
};

export const resetState = (): void => {
  state = null;
};
