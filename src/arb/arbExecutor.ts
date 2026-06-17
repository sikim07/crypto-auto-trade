import { ARB } from "./arbConfig";
import { ArbOpportunity } from "./profitCalc";
import { placeQuoteOrder, placeMarketOrder, getBalance } from "../exchange/binance";
import { executeSwap } from "../exchange/dex/jupiter";
import { out, trade } from "../common/logger";

const LOG = "arb/exec";

// 솔라나 토큰 민트 주소
const MINT = {
  SOL: "So11111111111111111111111111111111111111112",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
};

// Binance 심볼 → 기초자산 매핑
const BASE_ASSET: Record<string, string> = {
  SOLUSDT: "SOL",
};

let consecutiveFails = 0;
let lastFailTime = 0;
let dailyLossUsd = 0;
let dailyTradeCount = 0;
let lastDayReset = new Date().toDateString();
let isExecuting = false; // 동시 실행 방지

const resetDailyIfNeeded = (): void => {
  const today = new Date().toDateString();
  if (today !== lastDayReset) {
    dailyLossUsd = 0;
    dailyTradeCount = 0;
    lastDayReset = today;
  }
};

const isOnCooldown = (): boolean => {
  if (consecutiveFails >= ARB.MAX_CONSECUTIVE_FAILS) {
    if (Date.now() - lastFailTime < ARB.FAIL_COOLDOWN_MS) return true;
    consecutiveFails = 0;
  }
  return false;
};

export interface TradeResult {
  success: boolean;
  direction: string;
  symbol: string;
  netPnl: number;
  cexOrderId?: string;
  dexTxId?: string;
  error?: string;
}

/**
 * 차익거래 실행
 *
 * 구조: 양쪽(Binance + Solana 지갑)에 자산을 미리 배치해두고
 * 동시에 반대 매매를 실행. 체인 간 전송 없이 즉시 체결.
 *
 * - dex_buy_cex_sell: DEX에서 USDT→SOL 매수 + Binance에서 SOL→USDT 매도
 *   → Solana 지갑의 USDT 감소/SOL 증가, Binance의 SOL 감소/USDT 증가
 *
 * - cex_buy_dex_sell: Binance에서 USDT→SOL 매수 + DEX에서 SOL→USDT 매도
 *   → Binance의 USDT 감소/SOL 증가, Solana 지갑의 SOL 감소/USDT 증가
 *
 * 주기적으로 양쪽 잔고 비율을 확인하고 필요시 수동 리밸런싱.
 */
export const executeTrade = async (opp: ArbOpportunity): Promise<TradeResult> => {
  resetDailyIfNeeded();

  if (isExecuting) {
    return { success: false, direction: opp.direction, symbol: opp.symbol, netPnl: 0, error: "already_executing" };
  }

  if (isOnCooldown()) {
    out.debug("cooldown", LOG, "쿨다운 중 — 스킵");
    return { success: false, direction: opp.direction, symbol: opp.symbol, netPnl: 0, error: "cooldown" };
  }

  if (dailyLossUsd <= -ARB.DAILY_MAX_LOSS_USD) {
    out.info(LOG, "일일 손실 한도 도달 ($%s) — 거래 중단", dailyLossUsd.toFixed(2));
    return { success: false, direction: opp.direction, symbol: opp.symbol, netPnl: 0, error: "daily_loss_limit" };
  }

  const baseAsset = BASE_ASSET[opp.symbol];
  if (!baseAsset) {
    return { success: false, direction: opp.direction, symbol: opp.symbol, netPnl: 0, error: "unsupported_symbol" };
  }

  isExecuting = true;
  try {
    // 잔고 확인
    const cexBalance = await getBalance(
      opp.direction === "dex_buy_cex_sell" ? baseAsset : "USDT"
    );
    const requiredCex = opp.direction === "dex_buy_cex_sell"
      ? ARB.TRADE_AMOUNT_USDT / opp.cexPrice  // SOL 수량
      : ARB.TRADE_AMOUNT_USDT;                  // USDT 금액

    if (cexBalance < requiredCex * 0.95) {
      trade.fill(LOG, "[SKIP] %s 잔고 부족: Binance %s=%s (필요: %s)",
        opp.symbol, opp.direction === "dex_buy_cex_sell" ? baseAsset : "USDT",
        cexBalance.toFixed(4), requiredCex.toFixed(4));
      return { success: false, direction: opp.direction, symbol: opp.symbol, netPnl: 0, error: "insufficient_balance" };
    }

    if (opp.direction === "dex_buy_cex_sell") {
      return await executeDexBuyCexSell(opp);
    } else {
      return await executeCexBuyDexSell(opp);
    }
  } catch (e) {
    consecutiveFails++;
    lastFailTime = Date.now();
    const msg = (e as Error).message;
    trade.fill(LOG, "[FAIL] %s %s: %s (연속실패: %s)", opp.symbol, opp.direction, msg, String(consecutiveFails));
    return { success: false, direction: opp.direction, symbol: opp.symbol, netPnl: 0, error: msg };
  } finally {
    isExecuting = false;
  }
};

// DEX에서 USDT→SOL 매수 + Binance에서 SOL 매도 (동시 실행)
const executeDexBuyCexSell = async (opp: ArbOpportunity): Promise<TradeResult> => {
  trade.fill(LOG, "[START] %s dex_buy→cex_sell spread=%.3f%% est=$%.2f",
    opp.symbol, opp.spreadPct, opp.netProfit);

  const solQty = ARB.TRADE_AMOUNT_USDT / opp.cexPrice;

  // 양쪽 동시 실행
  const [dexResult, cexOrder] = await Promise.all([
    executeSwap(MINT.USDT, MINT.SOL, ARB.TRADE_AMOUNT_USDT, 6, 9),
    placeMarketOrder(opp.symbol, "SELL", parseFloat(solQty.toFixed(3))),
  ]);

  const cexRevenue = parseFloat(cexOrder.cummulativeQuoteQty);
  const dexCost = ARB.TRADE_AMOUNT_USDT;
  const netPnl = cexRevenue - dexCost;

  dailyLossUsd += Math.min(netPnl, 0);
  dailyTradeCount++;
  consecutiveFails = 0;

  trade.fill(LOG, "[DONE] %s dex_buy→cex_sell | DEX: $%s→%sSOL | CEX: %sSOL→$%s | PnL: $%s",
    opp.symbol,
    dexCost.toFixed(2), dexResult.outputAmount.toFixed(6),
    cexOrder.executedQty, cexRevenue.toFixed(2),
    netPnl.toFixed(2));

  return {
    success: true, direction: opp.direction, symbol: opp.symbol, netPnl,
    cexOrderId: String(cexOrder.orderId), dexTxId: dexResult.txId,
  };
};

// Binance에서 USDT→SOL 매수 + DEX에서 SOL→USDT 매도 (동시 실행)
const executeCexBuyDexSell = async (opp: ArbOpportunity): Promise<TradeResult> => {
  trade.fill(LOG, "[START] %s cex_buy→dex_sell spread=%.3f%% est=$%.2f",
    opp.symbol, opp.spreadPct, opp.netProfit);

  const solQty = ARB.TRADE_AMOUNT_USDT / opp.cexPrice;

  // 양쪽 동시 실행
  const [cexOrder, dexResult] = await Promise.all([
    placeQuoteOrder(opp.symbol, "BUY", ARB.TRADE_AMOUNT_USDT),
    executeSwap(MINT.SOL, MINT.USDT, parseFloat(solQty.toFixed(6)), 9, 6),
  ]);

  const cexCost = parseFloat(cexOrder.cummulativeQuoteQty);
  const dexRevenue = dexResult.outputAmount;
  const netPnl = dexRevenue - cexCost;

  dailyLossUsd += Math.min(netPnl, 0);
  dailyTradeCount++;
  consecutiveFails = 0;

  trade.fill(LOG, "[DONE] %s cex_buy→dex_sell | CEX: $%s→%sSOL | DEX: %sSOL→$%s | PnL: $%s",
    opp.symbol,
    cexCost.toFixed(2), cexOrder.executedQty,
    solQty.toFixed(6), dexRevenue.toFixed(2),
    netPnl.toFixed(2));

  return {
    success: true, direction: opp.direction, symbol: opp.symbol, netPnl,
    cexOrderId: String(cexOrder.orderId), dexTxId: dexResult.txId,
  };
};

export const getDailyStats = () => ({
  dailyTradeCount,
  dailyLossUsd,
  consecutiveFails,
});
