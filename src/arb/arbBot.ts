import { ARB } from "./arbConfig";
import { startCexFeed, stopCexFeed, startDexFeed, stopDexFeed, getCexPrice } from "./priceFeed";
import { findOpportunity, getSpreadSummary } from "./profitCalc";
import { verifyConnection as verifyBinance } from "../exchange/binance";
import { out, trade } from "../common/logger";
import { BINANCE_API_KEY, BINANCE_SECRET_KEY } from "../common/config";

const LOG = "arb/bot";

let pollTimer: ReturnType<typeof setInterval> | null = null;
let reportTimer: ReturnType<typeof setInterval> | null = null;
let consecutiveFails = 0;
let failCooldownUntil = 0;
let dailyProfitUsd = 0;
let dailyTradeCount = 0;
let opportunitiesFound = 0;

const scan = (): void => {
  const now = Date.now();

  // 쿨다운 체크
  if (now < failCooldownUntil) return;

  // 일일 손실 한도
  if (dailyProfitUsd <= -ARB.DAILY_MAX_LOSS_USD) return;

  for (const symbol of ARB.SYMBOLS) {
    const opp = findOpportunity(symbol);
    if (!opp) continue;

    opportunitiesFound++;

    if (ARB.DRY_RUN) {
      // 모니터링 전용 — 실행하지 않고 로그만
      trade.fill(LOG, "[DRY] %s %s 스프레드=%.3f%% 순익=$%.2f (CEX=%.4f DEX=%.4f)",
        opp.symbol, opp.direction,
        opp.spreadPct, opp.netProfit,
        opp.cexPrice, opp.dexPrice);
    } else {
      // TODO: Phase 2-4에서 실제 실행 구현
      trade.fill(LOG, "[EXEC] %s %s 스프레드=%.3f%% 순익=$%.2f",
        opp.symbol, opp.direction,
        opp.spreadPct, opp.netProfit);
    }
  }
};

const printReport = (): void => {
  const lines: string[] = [
    "",
    "════════════════════════════════════════",
    `  [ARB REPORT] ${ARB.DRY_RUN ? "(DRY RUN)" : "(LIVE)"}`,
    `  모니터링: ${ARB.SYMBOLS.join(", ")}`,
    `  거래: ${dailyTradeCount}건 | 기회 감지: ${opportunitiesFound}건`,
    `  일일 손익: $${dailyProfitUsd.toFixed(2)}`,
    `  임계값: 스프레드 ≥${ARB.MIN_SPREAD_PCT}% / 순익 ≥$${ARB.MIN_PROFIT_USD}`,
  ];

  // 현재 스프레드 상태
  for (const symbol of ARB.SYMBOLS) {
    const summary = getSpreadSummary(symbol);
    if (summary) lines.push(`  ${summary}`);
    else {
      const cex = getCexPrice(symbol);
      lines.push(`  ${symbol}: CEX=${cex ? `bid=${cex.bid} ask=${cex.ask}` : "대기중"} | DEX=대기중`);
    }
  }

  lines.push("════════════════════════════════════════");
  lines.push("");

  out.important(LOG, lines.join("\n"));
};

const shutdown = async (signal: string): Promise<void> => {
  trade.system(LOG, "%s 수신, 종료 중...", signal);

  if (pollTimer) clearInterval(pollTimer);
  if (reportTimer) clearInterval(reportTimer);

  stopCexFeed();
  stopDexFeed();

  printReport();
  trade.system(LOG, "차익거래 봇 종료 | 거래: %s건 | 손익: $%s",
    String(dailyTradeCount), dailyProfitUsd.toFixed(2));

  process.exit(0);
};

const main = async (): Promise<void> => {
  const banner = [
    "════════════════════════════════════════",
    `  차익거래 봇 시작 (PID: ${process.pid})`,
    `  모드: ${ARB.DRY_RUN ? "DRY RUN (모니터링 전용)" : "LIVE"}`,
    `  대상: ${ARB.SYMBOLS.join(", ")}`,
    `  거래 금액: $${ARB.TRADE_AMOUNT_USDT} | 최소 스프레드: ${ARB.MIN_SPREAD_PCT}%`,
    "════════════════════════════════════════",
  ].join("\n");
  out.important(LOG, banner);
  trade.system(LOG, banner);

  // API 키 확인
  if (!BINANCE_API_KEY || !BINANCE_SECRET_KEY) {
    trade.system(LOG, "BINANCE API 키 미설정 — 종료");
    process.exit(1);
  }

  // Binance 연결 확인
  const connected = await verifyBinance();
  if (!connected) {
    trade.system(LOG, "Binance 연결 실패 — 종료");
    process.exit(1);
  }

  // 가격 피드 시작
  out.info(LOG, "CEX 가격 피드 시작 (Binance WebSocket)");
  startCexFeed();

  // DEX 피드는 CEX 가격이 들어온 후 시작 (2초 대기)
  setTimeout(() => {
    out.info(LOG, "DEX 가격 피드 시작 (Jupiter API)");
    startDexFeed();
  }, 2_000);

  // 스캔 루프 (CEX는 실시간, DEX 폴링 주기에 맞춤)
  pollTimer = setInterval(scan, ARB.PRICE_POLL_MS);

  // 리포트
  reportTimer = setInterval(printReport, ARB.REPORT_INTERVAL_MS);

  // 10초 후 첫 리포트
  setTimeout(printReport, 10_000);

  // 종료 시그널
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
};

main().catch((e) => {
  trade.system(LOG, "시작 실패: %s", (e as Error).message);
  process.exit(1);
});
