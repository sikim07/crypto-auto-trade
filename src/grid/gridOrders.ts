import { GRID } from "./gridConfig";
import { getState, recordTrade } from "./gridState";
import { placeLimitOrder, cancelOrder, getOrder, getOpenOrders } from "../upbit/rest";
import { logger } from "../common/logger";
import type { GridLevel } from "../common/types";

const LOG = "grid/orders";

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

  for (const level of state.levels) {
    const dist = Math.abs(level.index - centerIdx);
    if (dist > GRID.ACTIVE_LEVELS) continue;

    if (level.status === "idle") {
      if (level.price < currentPrice) {
        await placeBuyOrder(level);
      }
    } else if (level.status === "holding") {
      if (level.price >= currentPrice || level.index < state.levels.length - 1) {
        await placeSellOrder(level);
      }
    }
  }
};

const placeBuyOrder = async (level: GridLevel): Promise<void> => {
  const investPerLevel = GRID.TOTAL_INVEST_KRW / GRID.GRID_COUNT;
  if (investPerLevel < GRID.MIN_ORDER_KRW) {
    logger.warn(LOG, "단계당 금액 부족: %s원", investPerLevel.toFixed(0));
    return;
  }

  const volume = investPerLevel / level.price;
  try {
    const order = await placeLimitOrder(GRID.MARKET, "bid", level.price, volume);
    level.status = "buy_placed";
    level.orderUuid = order.uuid;
    logger.info(LOG, "[BUY 배치] idx=%s 가격=%s",
      String(level.index), level.price.toLocaleString());
  } catch (e) {
    logger.error(LOG, "[BUY 실패] idx=%s: %s",
      String(level.index), (e as Error).message);
  }
};

const placeSellOrder = async (level: GridLevel): Promise<void> => {
  if (!level.buyVolume || level.buyVolume <= 0) return;

  const state = getState();
  if (!state) return;
  const sellPrice = level.price + state.gridInterval;

  try {
    const order = await placeLimitOrder(GRID.MARKET, "ask", sellPrice, level.buyVolume);
    level.status = "sell_placed";
    level.orderUuid = order.uuid;
    logger.info(LOG, "[SELL 배치] idx=%s 매수가=%s 매도가=%s",
      String(level.index), level.price.toLocaleString(), sellPrice.toLocaleString());
  } catch (e) {
    logger.error(LOG, "[SELL 실패] idx=%s: %s",
      String(level.index), (e as Error).message);
  }
};

export const checkFilledOrders = async (): Promise<void> => {
  const state = getState();
  if (!state) return;

  for (const level of state.levels) {
    if (!level.orderUuid) continue;
    if (level.status !== "buy_placed" && level.status !== "sell_placed") continue;

    try {
      const order = await getOrder(level.orderUuid);

      if (order.state === "done") {
        if (level.status === "buy_placed") {
          handleBuyFilled(level, order);
        } else if (level.status === "sell_placed") {
          handleSellFilled(level, order);
        }
      } else if (order.state === "cancel") {
        level.status = "idle";
        level.orderUuid = undefined;
      }
    } catch (e) {
      logger.error(LOG, "[체결확인 실패] idx=%s: %s",
        String(level.index), (e as Error).message);
    }
  }
};

const handleBuyFilled = (level: GridLevel, order: { executed_volume: string; paid_fee: string; price: string }): void => {
  const executedVolume = parseFloat(order.executed_volume);
  const fee = parseFloat(order.paid_fee);

  level.status = "holding";
  level.orderUuid = undefined;
  level.buyPrice = level.price;
  level.buyVolume = executedVolume;
  level.filledCount += 1;

  logger.info(LOG, "[BUY 체결] idx=%s 가격=%s 수량=%s 수수료=%s원",
    String(level.index), level.price.toLocaleString(),
    executedVolume.toFixed(8), fee.toFixed(0));
};

const handleSellFilled = (level: GridLevel, order: { executed_volume: string; paid_fee: string }): void => {
  const state = getState();
  if (!state) return;

  const sellPrice = level.price + state.gridInterval;
  const buyPrice = level.buyPrice ?? level.price;
  const volume = parseFloat(order.executed_volume);
  const fee = parseFloat(order.paid_fee);
  const buyFee = buyPrice * volume * GRID.FEE_RATE;
  const grossProfit = (sellPrice - buyPrice) * volume;
  const netProfit = grossProfit - fee - buyFee;

  recordTrade(netProfit, fee + buyFee);

  level.status = "idle";
  level.orderUuid = undefined;
  level.buyPrice = undefined;
  level.buyVolume = undefined;
  level.filledCount += 1;

  logger.info(LOG, "[SELL 체결] idx=%s 매수=%s 매도=%s 순익=%s원 (누적: %s원)",
    String(level.index), buyPrice.toLocaleString(), sellPrice.toLocaleString(),
    netProfit.toFixed(0), state.totalRealizedProfit.toFixed(0));
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
        logger.error(LOG, "[취소 실패] idx=%s: %s",
          String(level.index), (e as Error).message);
      }
    }
  }

  logger.info(LOG, "%s건 주문 취소", String(cancelled));
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
