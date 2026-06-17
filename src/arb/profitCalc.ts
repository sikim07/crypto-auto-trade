import { ARB } from "./arbConfig";
import { getCexPrice, getDexQuote } from "./priceFeed";
import { out } from "../common/logger";

const LOG = "arb/calc";

export interface ArbOpportunity {
  symbol: string;
  direction: "dex_buy_cex_sell" | "cex_buy_dex_sell";
  spreadPct: number;
  grossProfit: number;
  totalCost: number;
  netProfit: number;
  cexPrice: number;
  dexPrice: number;
  timestamp: number;
}

/**
 * 양방향 차익 기회 계산
 *
 * Direction A: DEX에서 매수 → CEX에서 매도
 *   DEX에 USDT 넣고 토큰 받음 → Binance에서 토큰 매도
 *
 * Direction B: CEX에서 매수 → DEX에서 매도
 *   Binance에서 토큰 매수 → DEX에 토큰 넣고 USDT 받음
 */
export const findOpportunity = (symbol: string): ArbOpportunity | null => {
  const cex = getCexPrice(symbol);
  const dex = getDexQuote(symbol);

  if (!cex || !dex) return null;

  // 데이터 신선도 확인 (5초 이내)
  const now = Date.now();
  if (now - cex.updatedAt > 5_000 || now - dex.buy.updatedAt > 10_000) return null;

  // ── Direction A: DEX 매수 → CEX 매도 ──
  // DEX에서 USDT로 토큰 매수: dex.buy.outputAmount 개의 토큰을 받음
  // CEX에서 토큰 매도: cex.bid 가격으로 매도
  const dexBuyTokens = dex.buy.outputAmount;
  const cexSellRevenue = dexBuyTokens * cex.bid;
  const dirA_gross = cexSellRevenue - ARB.TRADE_AMOUNT_USDT;
  const dirA_cexFee = cexSellRevenue * (ARB.BINANCE_FEE_PCT / 100);
  const dirA_dexFee = 0; // Jupiter 수수료는 이미 outputAmount에 반영
  const dirA_cost = dirA_cexFee + ARB.EST_GAS_USD;
  const dirA_net = dirA_gross - dirA_cost;
  const dirA_spread = (dirA_gross / ARB.TRADE_AMOUNT_USDT) * 100;

  // ── Direction B: CEX 매수 → DEX 매도 ──
  // CEX에서 토큰 매수: cex.ask 가격으로 매수
  const cexBuyTokens = ARB.TRADE_AMOUNT_USDT / cex.ask;
  const cexBuyCost = ARB.TRADE_AMOUNT_USDT;
  // DEX에서 토큰 매도: dex.sell.outputAmount USDT를 받음
  const dexSellRevenue = dex.sell.outputAmount;
  const dirB_gross = dexSellRevenue - cexBuyCost;
  const dirB_cexFee = cexBuyCost * (ARB.BINANCE_FEE_PCT / 100);
  const dirB_cost = dirB_cexFee + ARB.EST_GAS_USD;
  const dirB_net = dirB_gross - dirB_cost;
  const dirB_spread = (dirB_gross / ARB.TRADE_AMOUNT_USDT) * 100;

  // 더 유리한 방향 선택
  const bestDir = dirA_net >= dirB_net ? "A" : "B";
  const best: ArbOpportunity = bestDir === "A"
    ? {
        symbol,
        direction: "dex_buy_cex_sell",
        spreadPct: dirA_spread,
        grossProfit: dirA_gross,
        totalCost: dirA_cost,
        netProfit: dirA_net,
        cexPrice: cex.bid,
        dexPrice: ARB.TRADE_AMOUNT_USDT / dexBuyTokens,
        timestamp: now,
      }
    : {
        symbol,
        direction: "cex_buy_dex_sell",
        spreadPct: dirB_spread,
        grossProfit: dirB_gross,
        totalCost: dirB_cost,
        netProfit: dirB_net,
        cexPrice: cex.ask,
        dexPrice: dexSellRevenue / cexBuyTokens,
        timestamp: now,
      };

  // 임계값 체크
  if (best.spreadPct >= ARB.MIN_SPREAD_PCT && best.netProfit >= ARB.MIN_PROFIT_USD) {
    return best;
  }

  return null;
};

/** 현재 스프레드 로그용 요약 */
export const getSpreadSummary = (symbol: string): string | null => {
  const cex = getCexPrice(symbol);
  const dex = getDexQuote(symbol);
  if (!cex || !dex) return null;

  const dexBuyPrice = ARB.TRADE_AMOUNT_USDT / dex.buy.outputAmount;
  const dexSellPrice = dex.sell.outputAmount / dex.sell.inputAmount;

  const spreadA = ((cex.bid - dexBuyPrice) / dexBuyPrice * 100).toFixed(3);
  const spreadB = ((dexSellPrice - cex.ask) / cex.ask * 100).toFixed(3);

  return `${symbol} CEX bid=${cex.bid.toFixed(4)} ask=${cex.ask.toFixed(4)} | DEX buy@${dexBuyPrice.toFixed(4)} sell@${dexSellPrice.toFixed(4)} | spread A=${spreadA}% B=${spreadB}%`;
};
