import { getAllMarkets, getTicker } from "../api/rest";
import { TARGET_MARKET_COUNT } from "../config";
import type { UpbitTicker } from "../types";

/**
 * KRW 마켓 중 거래대금 상위권에서 변동성 높은 2종목 선정
 */
export const selectTopMarkets = async (): Promise<string[]> => {
  const markets = await getAllMarkets();
  const krw = markets.filter((m) => m.market.startsWith("KRW-"));
  if (krw.length === 0) return [];

  const marketCodes = krw.map((m) => m.market);
  const tickers = await getTicker(marketCodes);
  if (tickers.length === 0) return [];

  const byTradePrice = [...tickers].sort(
    (a, b) => (b.acc_trade_price_24h ?? 0) - (a.acc_trade_price_24h ?? 0),
  );
  const topCount = Math.min(50, byTradePrice.length);
  const top = byTradePrice.slice(0, topCount);

  const withVolatility = top.map((t): { market: string; vol: number } => ({
    market: t.market,
    vol: Math.abs(t.signed_change_rate ?? 0),
  }));
  withVolatility.sort((a, b) => b.vol - a.vol);

  return withVolatility
    .slice(0, TARGET_MARKET_COUNT)
    .map((x) => x.market)
    .filter(Boolean);
};
