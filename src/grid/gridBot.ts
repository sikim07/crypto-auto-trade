import { GRID } from "./gridConfig";
import { initGrid, loadState, saveState, getState, getDailyProfit } from "./gridState";
import { placeGridOrders, checkFilledOrders, cancelAllOrders } from "./gridOrders";
import { getGuardStatus, checkRangeBreak, checkDailyLoss, tryResume, recordApiError, resetApiError } from "./trendGuard";
import { printReport } from "./gridReport";
import { getTicker } from "../upbit/rest";
import { logger } from "../common/logger";
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
      logger.warn(LOG, "안전장치 작동, 주문 취소 중...");
      await cancelAllOrders();
      saveState();
      isProcessing = false;
      return;
    }

    // 체결 확인
    await checkFilledOrders();

    // 주문 배치/갱신
    await placeGridOrders(price);

  } catch (e) {
    recordApiError();
    logger.error(LOG, "tick 에러: %s", (e as Error).message);
  }

  isProcessing = false;
};

const shutdown = async (signal: string): Promise<void> => {
  logger.info(LOG, "%s 수신, 종료 처리 중...", signal);

  if (pollTimer) clearInterval(pollTimer);
  if (saveTimer) clearInterval(saveTimer);
  if (reportTimer) clearInterval(reportTimer);

  try {
    await cancelAllOrders();
  } catch (e) {
    logger.error(LOG, "종료 시 주문 취소 실패: %s", (e as Error).message);
  }

  saveState();
  if (lastPrice > 0) printReport(lastPrice);

  logger.info(LOG, "그리드 봇 종료");
  process.exit(0);
};

const main = async (): Promise<void> => {
  logger.info(LOG, "════════════════════════════════════════");
  logger.info(LOG, "  그리드 봇 시작 (PID: %s)", String(process.pid));
  logger.info(LOG, "  종목: %s | 투입: %s원", GRID.MARKET, GRID.TOTAL_INVEST_KRW.toLocaleString());
  logger.info(LOG, "════════════════════════════════════════");

  // 키 확인
  if (!UPBIT_ACCESS_KEY || !UPBIT_SECRET_KEY) {
    logger.error(LOG, "UPBIT_ACCESS_KEY / UPBIT_SECRET_KEY 미설정");
    process.exit(1);
  }

  // 상태 복구 또는 신규 초기화
  const restored = loadState();
  if (!restored) {
    const price = await getCurrentPrice();
    lastPrice = price;
    initGrid(price);
    logger.info(LOG, "현재가 %s 기준 신규 그리드 생성", price.toLocaleString());
  } else {
    lastPrice = await getCurrentPrice();
  }

  saveState();

  // 메인 루프
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
  logger.error(LOG, "시작 실패: %s", (e as Error).message);
  process.exit(1);
});
