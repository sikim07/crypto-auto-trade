/**
 * 그리드 운영 현황 리포트
 *
 * 10분마다 자동 출력 + 봇 종료 시 최종 리포트.
 * 현재가 위치, 거래 건수, 누적/금일 손익, 미체결 주문 수를 한 줄로 요약.
 */
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

  // 미실현 손익: 보유 중인 코인의 (현재가 - 매수가) x 수량
  const holdingValue = state.levels
    .filter((l) => l.status === "holding")
    .reduce((sum, l) => sum + (l.buyVolume ?? 0) * currentPrice, 0);
  const holdingCost = state.levels
    .filter((l) => l.status === "holding")
    .reduce((sum, l) => sum + (l.buyVolume ?? 0) * (l.buyPrice ?? l.price), 0);
  const unrealized = holdingValue - holdingCost;

  // 현재가가 그리드 범위 내 어디 위치하는지 (0%=하단, 100%=상단)
  const rangePosition = state.rangeUpper === state.rangeLower
    ? 0
    : ((currentPrice - state.rangeLower) / (state.rangeUpper - state.rangeLower)) * 100;

  const net = state.totalRealizedProfit + unrealized;
  out.important(LOG, "[GRID] %s | %s원 (범위 %s%%) | %s | 거래 %s건 | 누적 %s원 | 금일 %s원 | 미체결 B%s/S%s",
    GRID.MARKET, currentPrice.toLocaleString(), rangePosition.toFixed(0),
    guard, String(state.tradeCount),
    (net >= 0 ? "+" : "") + net.toFixed(0),
    (state.dailyRealizedProfit >= 0 ? "+" : "") + (state.dailyRealizedProfit ?? 0).toFixed(0),
    String(buys), String(sells));
};
