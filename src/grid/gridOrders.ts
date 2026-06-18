/**
 * 그리드 주문 관리
 *
 * Upbit API를 사용하여 그리드 레벨별로 지정가 주문을 관리한다.
 *
 * 핵심 로직:
 *   1. placeGridOrders(): 현재가 기준으로 아래에 매수, 위에 매도 지정가 주문 배치
 *   2. checkFilledOrders(): 주기적으로 주문 상태를 확인하여 체결 감지
 *   3. 매수 체결 → 한 단계 위에 매도 주문 배치 (수익 실현 대기)
 *   4. 매도 체결 → 수익 기록 + 원래 단계를 idle로 복귀 (재매수 대기)
 *
 * 안전 기능:
 *   - ACTIVE_LEVELS: 현재가 근처 ±N단계만 실제 주문 (API 호출/잔고 효율화)
 *   - 주문 실패 시 5분 쿨다운 (무한 재시도 방지)
 *   - 범위 밖 미체결 주문 자동 취소 (잔고 잠금 해제)
 */
import { GRID } from "./gridConfig";
import { getState, recordTrade } from "./gridState";
import { recordFill } from "./trendGuard";
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

/** 현재가에 가장 가까운 그리드 레벨 인덱스 반환 */
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

/**
 * 현재가 기준으로 그리드 주문 배치
 *
 * - 현재가 아래 idle 레벨 → 매수 지정가 주문
 * - holding 레벨 → 한 단계 위 가격에 매도 지정가 주문
 * - ACTIVE_LEVELS 범위 밖 미체결 주문은 자동 취소
 */
export const placeGridOrders = async (currentPrice: number): Promise<void> => {
  const state = getState();
  if (!state) return;

  const centerIdx = findClosestLevelIndex(currentPrice);
  const investPerLevel = GRID.TOTAL_INVEST_KRW / GRID.GRID_COUNT;

  // 매수 대상 레벨 확인 → KRW 잔고를 1회만 조회하여 효율화
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

  // ACTIVE 범위 밖 미체결 주문 자동 취소 (잔고 잠금 해제)
  for (const level of state.levels) {
    const dist = Math.abs(level.index - centerIdx);
    if (dist > GRID.ACTIVE_LEVELS && level.orderUuid &&
        (level.status === "buy_placed" || level.status === "sell_placed")) {
      try {
        await cancelOrder(level.orderUuid);
        level.status = level.buyVolume ? "holding" : "idle";
        level.orderUuid = undefined;
        out.info(LOG, "[범위외 취소] idx=%s 가격=%s", String(level.index), level.price.toLocaleString());
      } catch (e) {
        out.warn("cancel-oor-" + level.index, LOG, "[범위외 취소 실패] idx=%s: %s",
          String(level.index), (e as Error).message);
      }
    }
  }

  // ACTIVE 범위 내 레벨에 주문 배치
  for (const level of state.levels) {
    const dist = Math.abs(level.index - centerIdx);
    if (dist > GRID.ACTIVE_LEVELS) continue;
    if (isOnCooldown(level.index)) continue;

    if (level.status === "idle") {
      // 현재가보다 낮은 레벨에 매수 주문
      if (level.price < currentPrice) {
        if (availableKrw < investPerLevel) {
          out.debug("krw-low", LOG, "KRW 잔고 부족(%s원), 매수 스킵", Math.round(availableKrw).toLocaleString());
          continue;
        }
        await placeBuyOrder(level);
        availableKrw -= investPerLevel;
      }
    } else if (level.status === "holding") {
      // 보유 중인 레벨 → 한 단계 위 가격에 매도 주문
      const sellPrice = roundPrice(level.price + state.gridInterval);
      if (sellPrice > currentPrice) {
        await placeSellOrder(level);
      }
    }
  }
};

/** 매수 지정가 주문 배치 */
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

/** 매도 지정가 주문 배치 (매수 체결 후 한 단계 위 가격으로) */
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

/**
 * 미체결 주문의 체결 여부 확인
 * Upbit API로 각 주문의 상태를 폴링하여 체결(done)을 감지한다.
 */
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
        // 외부에서 취소된 주문 처리
        level.status = level.buyVolume ? "holding" : "idle";
        level.orderUuid = undefined;
      }
    } catch (e) {
      out.warn("check-fill-" + level.index, LOG, "[체결확인 실패] idx=%s: %s",
        String(level.index), (e as Error).message);
    }
  }
};

/** 매수 체결 처리: 레벨을 holding 상태로 전환, 체결 정보 저장 */
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

  // 매수는 손익 0, 이력만 기록 (매도 시 수익 계산)
  recordTrade(0, 0, record);
  recordFill("buy");

  trade.fill(LOG, "[BUY] %s | %s원 x %s = %s원 | 수수료 %s원",
    GRID.MARKET, level.price.toLocaleString(), executedVolume.toFixed(8),
    Math.round(totalCost).toLocaleString(), Math.round(fee).toLocaleString());
};

/**
 * 매도 체결 처리: 수익 계산 후 기록, 레벨을 idle로 복귀
 *
 * 수익 = (매도가 - 매수가) x 수량 - 왕복 수수료
 */
const handleSellFilled = (level: GridLevel, order: { executed_volume: string; paid_fee: string }, currentPrice: number): void => {
  const state = getState();
  if (!state) return;

  const sellPrice = level.price + state.gridInterval;
  const buyPrice = level.buyPrice ?? level.price;
  const volume = parseFloat(order.executed_volume);
  const fee = parseFloat(order.paid_fee);
  const buyFee = buyPrice * volume * GRID.FEE_RATE;    // 매수 시 수수료 추정
  const grossProfit = (sellPrice - buyPrice) * volume;  // 세전 수익
  const netProfit = grossProfit - fee - buyFee;          // 순수익
  const totalBuy = buyPrice * volume;
  const profitRate = totalBuy > 0 ? (netProfit / totalBuy * 100) : 0;

  const record: GridTradeRecord = {
    timestamp: Date.now(), side: "sell", levelIndex: level.index,
    price: sellPrice, volume, fee: fee + buyFee, profit: netProfit, currentPrice,
  };
  recordTrade(netProfit, fee + buyFee, record);
  recordFill("sell");

  // 레벨을 idle로 복귀 → 다음 매수 주문 대기
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

/** 모든 미체결 주문 취소 (봇 종료/중단 시) */
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

/** 현재 배치된 매수/매도 주문 수 반환 */
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
