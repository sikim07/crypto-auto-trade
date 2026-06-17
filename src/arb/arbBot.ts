import { ARB } from "./arbConfig";
import { startCexFeed, stopCexFeed, startDexFeed, stopDexFeed, getCexPrice } from "./priceFeed";
import { findOpportunity, getSpreadSummary } from "./profitCalc";
import { executeTrade } from "./arbExecutor";
import { verifyConnection as verifyBinance } from "../exchange/binance";
import { verifySolanaConnection } from "../exchange/dex/jupiter";
import { out, trade } from "../common/logger";
import { BINANCE_API_KEY, BINANCE_SECRET_KEY, SOLANA_PRIVATE_KEY } from "../common/config";

const LOG = "arb/bot";

let pollTimer: ReturnType<typeof setInterval> | null = null;
let reportTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let dailyProfitUsd = 0;
let dailyTradeCount = 0;
let opportunitiesFound = 0;
let scanCount = 0;

const scan = (): void => {
  scanCount++;
  for (const symbol of ARB.SYMBOLS) {
    const opp = findOpportunity(symbol);
    if (!opp) continue;

    opportunitiesFound++;

    if (ARB.DRY_RUN) {
      trade.fill(LOG, "[DRY] %s %s spread=%.3f%% net=$%.2f (CEX=%.4f DEX=%.4f)",
        opp.symbol, opp.direction,
        opp.spreadPct, opp.netProfit,
        opp.cexPrice, opp.dexPrice);
    } else {
      // LIVE 모드: 실제 거래 실행
      executeTrade(opp).then((result) => {
        if (result.success) {
          dailyProfitUsd += result.netPnl;
          dailyTradeCount++;
        }
      }).catch((e) => {
        trade.fill(LOG, "[ERROR] 실행 실패: %s", (e as Error).message);
      });
    }
  }
};

const printHeartbeat = (): void => {
  const cexSymbols = ARB.SYMBOLS.filter(s => getCexPrice(s)).length;
  out.debug("heartbeat", LOG, "alive | scans=%s opp=%s cex=%s/%s",
    String(scanCount), String(opportunitiesFound),
    String(cexSymbols), String(ARB.SYMBOLS.length));
};

const printReport = (): void => {
  for (const symbol of ARB.SYMBOLS) {
    const summary = getSpreadSummary(symbol);
    if (summary) {
      out.important(LOG, "[ARB] %s | opp=%s", summary, String(opportunitiesFound));
    } else {
      const cex = getCexPrice(symbol);
      out.important(LOG, "[ARB] %s CEX=%s DEX=대기중 | opp=%s",
        symbol, cex ? `${cex.bid}/${cex.ask}` : "대기중", String(opportunitiesFound));
    }
  }
};

const shutdown = async (signal: string): Promise<void> => {
  trade.system(LOG, "%s 수신, 종료", signal);
  if (pollTimer) clearInterval(pollTimer);
  if (reportTimer) clearInterval(reportTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  stopCexFeed();
  stopDexFeed();
  process.exit(0);
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const main = async (): Promise<void> => {
  const banner = `\n▶▶▶ ARB BOT DEPLOY ▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶\n  PID: ${process.pid} | 모드: ${ARB.DRY_RUN ? "DRY RUN" : "LIVE"} | 대상: ${ARB.SYMBOLS.join(", ")} | $${ARB.TRADE_AMOUNT_USDT} | 최소 ${ARB.MIN_SPREAD_PCT}%\n▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶▶`;
  out.important(LOG, banner);
  trade.system(LOG, banner);

  // API 키 확인
  if (!BINANCE_API_KEY || !BINANCE_SECRET_KEY) {
    trade.system(LOG, "BINANCE API 키 미설정 — 60초 후 재시도");
    out.important(LOG, "BINANCE API 키 미설정 — 60초 대기 후 PM2가 재시작");
    await sleep(60_000);
    process.exit(1);
  }

  // Binance 연결 확인 (최대 3회 재시도)
  let connected = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    connected = await verifyBinance();
    if (connected) break;
    out.important(LOG, "Binance 연결 실패 (%s/3), %s초 후 재시도",
      String(attempt), String(attempt * 10));
    await sleep(attempt * 10_000);
  }

  if (!connected) {
    trade.system(LOG, "Binance 연결 3회 실패 — PM2 재시작 대기");
    out.important(LOG, "Binance 연결 3회 실패 — PM2가 재시작합니다");
    process.exit(1);
  }

  // LIVE 모드: Solana 연결 확인
  if (!ARB.DRY_RUN) {
    if (!SOLANA_PRIVATE_KEY) {
      trade.system(LOG, "SOLANA_PRIVATE_KEY 미설정 — DRY_RUN으로 전환");
      out.important(LOG, "SOLANA_PRIVATE_KEY 미설정 — DRY_RUN 모드로 동작");
      (ARB as { DRY_RUN: boolean }).DRY_RUN = true;
    } else {
      const solOk = await verifySolanaConnection();
      if (!solOk) {
        trade.system(LOG, "Solana 연결 실패 — DRY_RUN으로 전환");
        (ARB as { DRY_RUN: boolean }).DRY_RUN = true;
      }
    }
  }

  // CEX 가격 피드 시작
  out.info(LOG, "CEX 가격 피드 시작");
  startCexFeed();

  // DEX 피드는 CEX 가격이 들어온 후 시작
  setTimeout(() => {
    out.info(LOG, "DEX 가격 피드 시작");
    startDexFeed();
  }, 3_000);

  // 스캔 루프
  pollTimer = setInterval(scan, ARB.PRICE_POLL_MS);

  // 리포트 (30분마다 + 30초 후 첫 리포트)
  reportTimer = setInterval(printReport, ARB.REPORT_INTERVAL_MS);
  setTimeout(printReport, 30_000);

  // Heartbeat (10분마다)
  heartbeatTimer = setInterval(printHeartbeat, 10 * 60 * 1000);

  // 종료 시그널
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
};

main().catch((e) => {
  trade.system(LOG, "시작 실패: %s", (e as Error).message);
  // 즉시 종료하지 않고 대기 — PM2 restart_delay와 함께 작동
  setTimeout(() => process.exit(1), 5_000);
});
