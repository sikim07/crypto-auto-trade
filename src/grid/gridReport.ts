import { GRID } from "./gridConfig";
import { getState } from "./gridState";
import { getGuardStatus } from "./trendGuard";
import { getPlacedCount } from "./gridOrders";
import { logger } from "../common/logger";

const LOG = "grid/report";

export const printReport = (currentPrice: number): void => {
  const state = getState();
  if (!state) return;

  const guard = getGuardStatus();
  const { buys, sells } = getPlacedCount();

  const holdingLevels = state.levels.filter((l) => l.status === "holding");
  const holdingValue = holdingLevels.reduce((sum, l) => {
    return sum + (l.buyVolume ?? 0) * currentPrice;
  }, 0);
  const holdingCost = holdingLevels.reduce((sum, l) => {
    return sum + (l.buyVolume ?? 0) * (l.buyPrice ?? l.price);
  }, 0);
  const unrealized = holdingValue - holdingCost;

  const rangePosition = state.rangeUpper === state.rangeLower
    ? 0
    : ((currentPrice - state.rangeLower) / (state.rangeUpper - state.rangeLower)) * 100;

  const elapsed = Date.now() - state.startedAt;
  const hours = (elapsed / (1000 * 60 * 60)).toFixed(1);

  logger.info(LOG, [
    "",
    "════════════════════════════════════════",
    `  [GRID REPORT] ${GRID.MARKET}`,
    `  범위: ${state.rangeLower.toLocaleString()} ~ ${state.rangeUpper.toLocaleString()} (간격: ${state.gridInterval.toLocaleString()}원)`,
    `  현재가: ${currentPrice.toLocaleString()} (범위 내 ${rangePosition.toFixed(1)}%)`,
    `  거래: ${state.tradeCount}건 | 보유: ${holdingLevels.length}단계`,
    `  미체결: 매수 ${buys}건 / 매도 ${sells}건`,
    `  실현수익: ${state.totalRealizedProfit >= 0 ? "+" : ""}${state.totalRealizedProfit.toFixed(0)}원 (수수료: -${state.totalFees.toFixed(0)}원)`,
    `  미실현: ${unrealized >= 0 ? "+" : ""}${unrealized.toFixed(0)}원`,
    `  순수익: ${(state.totalRealizedProfit + unrealized) >= 0 ? "+" : ""}${(state.totalRealizedProfit + unrealized).toFixed(0)}원`,
    `  상태: ${guard} | 운영시간: ${hours}시간`,
    "════════════════════════════════════════",
    "",
  ].join("\n"));
};
