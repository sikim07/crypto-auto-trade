/**
 * 그리드 봇 메인 엔트리포인트
 *
 * 초기화 → 메인 루프 → 종료 처리의 전체 라이프사이클을 관리한다.
 *
 * 실행 흐름:
 *   1. Upbit API 연결 확인 + KRW 잔고 체크
 *   2. 저장된 상태 복구 또는 신규 그리드 생성
 *   3. 메인 루프 (10초 간격):
 *      - 현재가 조회 → 체결 확인 → 안전 체크 → 주문 배치
 *   4. SIGINT/SIGTERM 수신 시 미체결 주문 취소 후 상태 저장
 *
 * PM2로 운영: pm2 start ecosystem.config.js
 */
import { GRID } from "./gridConfig";
import { initGrid, loadState, saveState, getState, getDailyProfit, checkDailyReset } from "./gridState";
import { placeGridOrders, checkFilledOrders, cancelAllOrders } from "./gridOrders";
import { getGuardStatus, checkRangeBreak, checkDailyLoss, tryResume, recordApiError, resetApiError } from "./trendGuard";
import { printReport } from "./gridReport";
import { getAccounts, getTicker, getCoinBalance, placeMarketSellOrder } from "../upbit/rest";
import { out, trade } from "../common/logger";
import { UPBIT_ACCESS_KEY, UPBIT_SECRET_KEY } from "../common/config";

const LOG = "grid/bot";

let pollTimer: ReturnType<typeof setInterval> | null = null;
let saveTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let lastPrice = 0;
let isProcessing = false;  // 동시 실행 방지 (이전 tick이 완료되지 않았으면 스킵)

/** Upbit 티커 API로 현재가 조회 */
const getCurrentPrice = async (): Promise<number> => {
  const tickers = await getTicker([GRID.MARKET]);
  if (tickers.length === 0) throw new Error("티커 조회 실패");
  return tickers[0].trade_price;
};

/** 시작 시 API 연결 상태 및 잔고 확인 */
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

/**
 * 메인 루프 (10초마다 실행)
 *
 * 1. 현재가 조회
 * 2. 체결 확인 (STOPPED/PAUSED 상태에서도 수행 — 이미 배치된 주문의 체결은 처리해야 함)
 * 3. 안전 체크 (범위 이탈, 일일 손실)
 * 4. 주문 배치 (ACTIVE 상태에서만)
 */
const tick = async (): Promise<void> => {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const price = await getCurrentPrice();
    lastPrice = price;
    resetApiError();

    const guard = getGuardStatus();

    checkDailyReset();
    await checkFilledOrders(price);

    if (guard === "STOPPED" || guard === "PAUSED") {
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

    await placeGridOrders(price);

  } catch (e) {
    recordApiError();
    out.warn("tick-error", LOG, "tick 에러: %s", (e as Error).message);
  }

  isProcessing = false;
};

/** 종료 처리: 미체결 주문 전체 취소 + 상태 저장 */
const shutdown = async (signal: string): Promise<void> => {
  trade.system(LOG, "%s 수신, 종료 처리 중...", signal);
  out.info(LOG, "%s 수신, 종료 처리 중...", signal);

  if (pollTimer) clearInterval(pollTimer);
  if (saveTimer) clearInterval(saveTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);

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
  // ── 시작 배너 ──
  const banner = `\n>>> GRID BOT DEPLOY >>>>>>>>>>>>>>>>>>>>>>>\n  PID: ${process.pid} | 종목: ${GRID.MARKET} | 투입: ${GRID.TOTAL_INVEST_KRW.toLocaleString()}원 | 단계: ${GRID.GRID_COUNT} | 범위: +-${GRID.RANGE_PCT}%\n>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>`;
  out.important(LOG, banner);
  trade.system(LOG, banner);

  // ── API 키 확인 ──
  if (!UPBIT_ACCESS_KEY || !UPBIT_SECRET_KEY) {
    trade.system(LOG, "UPBIT API 키 미설정 -- 종료");
    process.exit(1);
  }

  // ── API 연결 확인 ──
  const connected = await verifyApiConnection();
  if (!connected) {
    trade.system(LOG, "API 연결 실패 -- 종료");
    process.exit(1);
  }

  // ── 상태 복구 또는 신규 초기화 ──
  const restored = loadState();
  if (!restored) {
    // 이전 그리드에서 남은 보유 코인이 있으면 시장가 매도로 정리
    const holding = await getCoinBalance(GRID.MARKET);
    if (holding.volume > 0) {
      const holdingValue = holding.volume * holding.avgPrice;
      trade.system(LOG, "기존 보유분 감지: %s %s (평균 %s원, 약 %s원) -- 시장가 매도",
        holding.volume.toFixed(8), GRID.MARKET,
        holding.avgPrice.toLocaleString(), Math.round(holdingValue).toLocaleString());
      try {
        await placeMarketSellOrder(GRID.MARKET, holding.volume);
        trade.fill(LOG, "[SELL-청산] %s | 수량 %s | 평균매수가 %s원 -- 시장가 매도 완료",
          GRID.MARKET, holding.volume.toFixed(8), holding.avgPrice.toLocaleString());
      } catch (e) {
        trade.system(LOG, "보유분 매도 실패: %s -- 수동 정리 필요", (e as Error).message);
      }
    }

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

  // ── 메인 루프 시작 ──
  pollTimer = setInterval(tick, GRID.POLL_INTERVAL_MS);
  saveTimer = setInterval(saveState, GRID.STATE_SAVE_INTERVAL_MS);
  heartbeatTimer = setInterval(() => {
    if (lastPrice > 0) printReport(lastPrice);
  }, 10 * 60 * 1000); // 10분마다 리포트

  if (lastPrice > 0) printReport(lastPrice);

  // 종료 시그널 핸들링
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
};

main().catch((e) => {
  trade.system(LOG, "시작 실패: %s", (e as Error).message);
  process.exit(1);
});
