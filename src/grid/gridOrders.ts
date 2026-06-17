import { GRID } from "./gridConfig";
import { getState, recordTrade } from "./gridState";
import { placeLimitOrder, cancelOrder, getOrder, roundPrice, getKrwBalance } from "../upbit/rest";
import { out, trade } from "../common/logger";
import type { GridLevel, GridTradeRecord } from "../common/types";

const LOG = "grid/orders";

// 주문 실패 시 재시도 방지 (레벨별 쿨다운)
const failedLevels = new Map<number, number>(); // index → 실패 시각
const FAIL_COOLDOWN_MS = 5 * 60 * 1000; // 5분

const isOnCooldown = (index: number): boolean => {
  const failedAt = failedLevels.get(index);
  if (!failedAt) return false;
  if (Date.now() - failedAt > FAIL_COOLDOWN_MS) {
    failedLevels.delete(index);
    return false;
  }
  return true;
};

const findClosestLevelIndex = (price: number): number => {
  const state = getState();
  if (!state) return -1;
  let closest = 0;
  let minDist = Infinity;
  for (let i = 0; i < state.levels.length; i++) {
    const dist = Math.abs(state.levels[i].price - price);
    if (dist < minDist) { minDist = dist; closest = i; }
  }
  return closest;
};

export const placeGridOrders = async (currentPrice: number): Promise<void> => {
  const state = getState();
  if (!state) return;

  const centerIdx = findClosestLevelIndex(currentPrice);
  const investPerLevel = GRID.TOTAL_INVEST_KRW / GRID.GRID_COUNT;

  // 매수 예정 레벨 수 확인 → 잔고 1회 조회로 판단
  const buyTargets = state.levels.filter((l) => {
    if (l.status !== "idle" || l.price >= currentPrice) return false;
    if (Math.abs(l.index - centerIdx) > GRID.ACTIVE_LEVELS) return false;
    if (isOnCooldown(l.index)) return false;
    return true;
  });

  let availableKrw = Infinity;
  if (buyTargets.length > 0) {
    try {
      availableKrw = await getKrwBalance();
    } catch {
      out.warn("balance-check", LOG, "잔고 조회 실패, 매수 스킵");
      availableKrw = 0;
    }
  }

  for (const level of state.levels) {
    const dist = Math.abs(level.index - centerIdx);
    if (dist > GRID.ACTIVE_LEVELS) continue;
    if (isOnCooldown(level.index)) continue;

    if (level.status === "idle") {
      if (level.price < currentPrice) {
        if (availableKrw < investPerLevel) {
          out.debug("krw-low", LOG, "KRW 잔고 부족(%s원), 매수 스킵", Math.round(availableKrw).toLocaleString());
          continue;
        }
        await placeBuyOrder(level);
        availableKrw -= investPerLevel;
      }
    } else if (level.status === "holding") {
      const sellPrice = roundPrice(level.price + state.gridInterval);
      if (sellPrice > currentPrice) {
        await placeSellOrder(level);
      }
    }
  }
};

const placeBuyOrder = async (level: GridLevel): Promise<void> => {
  const investPerLevel = GRID.TOTAL_INVEST_KRW / GRID.GRID_COUNT;
  if (investPerLevel < GRID.MIN_ORDER_KRW) {
    out.warn("invest-low", LOG, "단계당 금액 부족: %s원", investPerLevel.toFixed(0));
    return;
  }

  const price = roundPrice(level.price);
  const volume = investPerLevel / price;

  try {
    const order = await placeLimitOrder(GRID.MARKET, "bid", price, volume);
    level.status = "buy_placed";
    level.orderUuid = order.uuid;
    out.info(LOG, "[BUY 배치] idx=%s 가격=%s 수량=%s",
      String(level.index), price.toLocaleString(), volume.toFixed(8));
  } catch (e) {
    failedLevels.set(level.index, Date.now());
    out.info(LOG, "[BUY 실패] idx=%s 가격=%s: %s (5분 쿨다운)",
      String(level.index), price.toLocaleString(), (e as Error).message);
  }
};

const placeSellOrder = async (level: GridLevel): Promise<void> => {
  if (!level.buyVolume || level.buyVolume <= 0) return;

  const state = getState();
  if (!state) return;
  const sellPrice = roundPrice(level.price + state.gridInterval);

  try {
    const order = await placeLimitOrder(GRID.MARKET, "ask", sellPrice, level.buyVolume);
    level.status = "sell_placed";
    level.orderUuid = order.uuid;
    out.info(LOG, "[SELL 배치] idx=%s 매수가=%s 매도가=%s",
      String(level.index), level.price.toLocaleString(), sellPrice.toLocaleString());
  } catch (e) {
    failedLevels.set(level.index, Date.now());
    out.info(LOG, "[SELL 실패] idx=%s: %s (5분 쿨다운)",
      String(level.index), (e as Error).message);
  }
};

export const checkFilledOrders = async (currentPrice: number): Promise<void> => {
  const state = getState();
  if (!state) return;

  for (const level of state.levels) {
    if (!level.orderUuid) continue;
    if (level.status !== "buy_placed" && level.status !== "sell_placed") continue;

    try {
      const order = await getOrder(level.orderUuid);

      if (order.state === "done") {
        if (level.status === "buy_placed") {
          handleBuyFilled(level, order, currentPrice);
        } else if (level.status === "sell_placed") {
          handleSellFilled(level, order, currentPrice);
        }
      } else if (order.state === "cancel") {
        level.status = level.buyVolume ? "holding" : "idle";
        level.orderUuid = undefined;
      }
    } catch (e) {
      out.warn("check-fill-" + level.index, LOG, "[체결확인 실패] idx=%s: %s",
        String(level.index), (e as Error).message);
    }
  }
};

const handleBuyFilled = (level: GridLevel, order: { executed_volume: string; paid_fee: string }, currentPrice: number): void => {
  const executedVolume = parseFloat(order.executed_volume);
  const fee = parseFloat(order.paid_fee);
  const totalCost = level.price * executedVolume;

  const record: GridTradeRecord = {
    timestamp: Date.now(), side: "buy", levelIndex: level.index,
    price: level.price, volume: executedVolume, fee, currentPrice,
  };

  level.status = "holding";
  level.orderUuid = undefined;
  level.buyPrice = level.price;
  level.buyVolume = executedVolume;
  level.filledCount += 1;

  // 매수는 손익 0, 이력만 기록
  recordTrade(0, 0, record);

  trade.fill(LOG, "[BUY] %s | %s원 × %s = %s원 | 수수료 %s원",
    GRID.MARKET, level.price.toLocaleString(), executedVolume.toFixed(8),
    Math.round(totalCost).toLocaleString(), Math.round(fee).toLocaleString());
};

const handleSellFilled = (level: GridLevel, order: { executed_volume: string; paid_fee: string }, currentPrice: number): void => {
  const state = getState();
  if (!state) return;

  const sellPrice = level.price + state.gridInterval;
  const buyPrice = level.buyPrice ?? level.price;
  const volume = parseFloat(order.executed_volume);
  const fee = parseFloat(order.paid_fee);
  const buyFee = buyPrice * volume * GRID.FEE_RATE;
  const grossProfit = (sellPrice - buyPrice) * volume;
  const netProfit = grossProfit - fee - buyFee;
  const totalBuy = buyPrice * volume;
  const profitRate = totalBuy > 0 ? (netProfit / totalBuy * 100) : 0;

  const record: GridTradeRecord = {
    timestamp: Date.now(), side: "sell", levelIndex: level.index,
    price: sellPrice, volume, fee: fee + buyFee, profit: netProfit, currentPrice,
  };
  recordTrade(netProfit, fee + buyFee, record);

  level.status = "idle";
  level.orderUuid = undefined;
  level.buyPrice = undefined;
  level.buyVolume = undefined;
  level.filledCount += 1;

  trade.fill(LOG, "[SELL] %s | 매수 %s → 매도 %s원 | 수수료 %s원 | 순익 %s원(%s%%) | 누적 %s원/%s건 | 금일 %s원",
    GRID.MARKET, buyPrice.toLocaleString(), sellPrice.toLocaleString(),
    Math.round(fee + buyFee).toLocaleString(),
    (netProfit >= 0 ? "+" : "") + netProfit.toFixed(0),
    (profitRate >= 0 ? "+" : "") + profitRate.toFixed(2),
    (state.totalRealizedProfit >= 0 ? "+" : "") + state.totalRealizedProfit.toFixed(0),
    String(state.tradeCount),
    (state.dailyRealizedProfit >= 0 ? "+" : "") + state.dailyRealizedProfit.toFixed(0));
};

export const cancelAllOrders = async (): Promise<number> => {
  const state = getState();
  if (!state) return 0;

  let cancelled = 0;
  for (const level of state.levels) {
    if (level.orderUuid && (level.status === "buy_placed" || level.status === "sell_placed")) {
      try {
        await cancelOrder(level.orderUuid);
        level.status = level.buyVolume ? "holding" : "idle";
        level.orderUuid = undefined;
        cancelled++;
      } catch (e) {
        out.warn("cancel-" + level.index, LOG, "[취소 실패] idx=%s: %s",
          String(level.index), (e as Error).message);
      }
    }
  }

  if (cancelled > 0) out.info(LOG, "%s건 주문 취소", String(cancelled));
  return cancelled;
};

export const getPlacedCount = (): { buys: number; sells: number } => {
  const state = getState();
  if (!state) return { buys: 0, sells: 0 };
  let buys = 0, sells = 0;
  for (const level of state.levels) {
    if (level.status === "buy_placed") buys++;
    if (level.status === "sell_placed") sells++;
  }
  return { buys, sells };
};
