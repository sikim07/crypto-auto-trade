import { GRID } from "./gridConfig";
import { initGrid, loadState, saveState, getState, getDailyProfit } from "./gridState";
import { placeGridOrders, checkFilledOrders, cancelAllOrders } from "./gridOrders";
import { getGuardStatus, checkRangeBreak, checkDailyLoss, tryResume, recordApiError, resetApiError } from "./trendGuard";
import { printReport } from "./gridReport";
import { getAccounts, getTicker } from "../upbit/rest";
import { out, trade } from "../common/logger";
import { UPBIT_ACCESS_KEY, UPBIT_SECRET_KEY } from "../common/config";

const LOG = "grid/bot";

let pollTimer: ReturnType<typeof setInterval> | null = null;
let saveTimer: ReturnType<typeof setInterval> | null = null;
let reportTimer: ReturnType<typeof setInterval> | null = null;
let lastPrice = 0;
let isProcessing = false;

const getCurrentPrice = async (): Promise<number> => {
  const tickers = await getTicker([GRID.MARKET]);
  if (tickers.length === 0) throw new Error("티커 조회 실패");
  return tickers[0].trade_price;
};

const verifyApiConnection = async (): Promise<boolean> => {
  try {
    const accounts = await getAccounts();
    const krw = accounts.find((a) => a.currency === "KRW");
    const balance = krw ? parseFloat(krw.balance) : 0;

    trade.system(LOG, "Upbit API 연결 성공 | KRW 잔고: %s원", balance.toLocaleString());
    out.info(LOG, "Upbit API 연결 확인 완료");

    if (balance < GRID.MIN_ORDER_KRW) {
      trade.system(LOG, "경고: KRW 잔고(%s원)가 최소 주문(%s원) 미만",
        balance.toLocaleString(), GRID.MIN_ORDER_KRW.toLocaleString());
    }
    return true;
  } catch (e) {
    const err = e as { response?: { data?: unknown }; message?: string };
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message ?? "unknown";
    trade.system(LOG, "Upbit API 연결 실패: %s", detail);
    return false;
  }
};

const tick = async (): Promise<void> => {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const price = await getCurrentPrice();
    lastPrice = price;
    resetApiError();

    const guard = getGuardStatus();

    if (guard === "STOPPED") {
      isProcessing = false;
      return;
    }

    if (guard === "PAUSED") {
      tryResume(price);
      isProcessing = false;
      return;
    }

    // 안전 체크
    checkRangeBreak(price);
    checkDailyLoss(getDailyProfit());
    if (getGuardStatus() !== "ACTIVE") {
      out.info(LOG, "안전장치 작동, 주문 취소 중...");
      await cancelAllOrders();
      saveState();
      isProcessing = false;
      return;
    }

    // 체결 확인 + 주문 배치
    await checkFilledOrders();
    await placeGridOrders(price);

  } catch (e) {
    recordApiError();
    out.warn("tick-error", LOG, "tick 에러: %s", (e as Error).message);
  }

  isProcessing = false;
};

const shutdown = async (signal: string): Promise<void> => {
  trade.system(LOG, "%s 수신, 종료 처리 중...", signal);
  out.info(LOG, "%s 수신, 종료 처리 중...", signal);

  if (pollTimer) clearInterval(pollTimer);
  if (saveTimer) clearInterval(saveTimer);
  if (reportTimer) clearInterval(reportTimer);

  try {
    await cancelAllOrders();
  } catch (e) {
    out.info(LOG, "종료 시 주문 취소 실패: %s", (e as Error).message);
  }

  saveState();
  if (lastPrice > 0) printReport(lastPrice);

  const state = getState();
  trade.system(LOG, "그리드 봇 종료 | 누적 거래: %s건 | 누적 수익: %s원",
    String(state?.tradeCount ?? 0),
    (state?.totalRealizedProfit ?? 0).toFixed(0));

  process.exit(0);
};

const main = async (): Promise<void> => {
  // ── 시작 배너 (양쪽 로그 모두) ──
  const banner = [
    "════════════════════════════════════════",
    `  그리드 봇 시작 (PID: ${process.pid})`,
    `  종목: ${GRID.MARKET} | 투입: ${GRID.TOTAL_INVEST_KRW.toLocaleString()}원`,
    `  단계: ${GRID.GRID_COUNT} | 범위: ±${GRID.RANGE_PCT}%`,
    "════════════════════════════════════════",
  ].join("\n");
  out.important(LOG, banner);
  trade.system(LOG, banner);

  // ── API 키 확인 ──
  if (!UPBIT_ACCESS_KEY || !UPBIT_SECRET_KEY) {
    trade.system(LOG, "UPBIT API 키 미설정 — 종료");
    process.exit(1);
  }

  // ── API 연결 확인 ──
  const connected = await verifyApiConnection();
  if (!connected) {
    trade.system(LOG, "API 연결 실패 — 종료");
    process.exit(1);
  }

  // ── 상태 복구 또는 신규 초기화 ──
  const restored = loadState();
  if (!restored) {
    const price = await getCurrentPrice();
    lastPrice = price;
    initGrid(price);
    out.info(LOG, "현재가 %s 기준 신규 그리드 생성", price.toLocaleString());
    trade.system(LOG, "신규 그리드 생성 | 현재가: %s", price.toLocaleString());
  } else {
    lastPrice = await getCurrentPrice();
    trade.system(LOG, "기존 상태 복구 | 거래: %s건 | 누적수익: %s원",
      String(restored.tradeCount), restored.totalRealizedProfit.toFixed(0));
  }

  saveState();

  // ── 메인 루프 ──
  pollTimer = setInterval(tick, GRID.POLL_INTERVAL_MS);
  saveTimer = setInterval(saveState, GRID.STATE_SAVE_INTERVAL_MS);
  reportTimer = setInterval(() => {
    if (lastPrice > 0) printReport(lastPrice);
  }, GRID.REPORT_INTERVAL_MS);

  // 즉시 첫 리포트
  if (lastPrice > 0) printReport(lastPrice);

  // 종료 시그널
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
};

main().catch((e) => {
  trade.system(LOG, "시작 실패: %s", (e as Error).message);
  process.exit(1);
});
