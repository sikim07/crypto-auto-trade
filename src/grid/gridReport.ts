import { GRID } from "./gridConfig";
import { getState } from "./gridState";
import { getGuardStatus } from "./trendGuard";
import { getPlacedCount } from "./gridOrders";
import { out } from "../common/logger";

const LOG = "grid/report";

export const printReport = (currentPrice: number): void => {
  const state = getState();
  if (!state) return;

  const guard = getGuardStatus();
  const { buys, sells } = getPlacedCount();

  const holdingValue = state.levels
    .filter((l) => l.status === "holding")
    .reduce((sum, l) => sum + (l.buyVolume ?? 0) * currentPrice, 0);
  const holdingCost = state.levels
    .filter((l) => l.status === "holding")
    .reduce((sum, l) => sum + (l.buyVolume ?? 0) * (l.buyPrice ?? l.price), 0);
  const unrealized = holdingValue - holdingCost;

  const rangePosition = state.rangeUpper === state.rangeLower
    ? 0
    : ((currentPrice - state.rangeLower) / (state.rangeUpper - state.rangeLower)) * 100;

  const net = state.totalRealizedProfit + unrealized;
  out.important(LOG, "[GRID] %s | %s원 (범위 %s%%) | %s | 거래 %s건 | 순익 %s원 | 미체결 B%s/S%s",
    GRID.MARKET, currentPrice.toLocaleString(), rangePosition.toFixed(0),
    guard, String(state.tradeCount),
    (net >= 0 ? "+" : "") + net.toFixed(0),
    String(buys), String(sells));
};
