import { getAllMarkets, getTicker } from "../api/rest";
import { TARGET_MARKET_COUNT } from "../config";
import { logger } from "../logger";

const LOG_SOURCE = "selectMarkets";

const SELECT_TOP_BY_TRADE_PRICE = 50;

/**
 * KRW 마켓 중 거래대금 상위권에서 변동성(절대 등락률) 상위 N종목 선정
 */
export const selectTopMarkets = async (): Promise<string[]> => {
  const markets = await getAllMarkets();
  const krw = markets.filter((m) => m.market.startsWith("KRW-"));
  if (krw.length === 0) {
    logger.warn(LOG_SOURCE, "KRW 마켓이 없습니다.");
    return [];
  }

  const marketCodes = krw.map((m) => m.market);
  const tickers = await getTicker(marketCodes);
  if (tickers.length === 0) {
    logger.warn(LOG_SOURCE, "티커 조회 결과가 없습니다.");
    return [];
  }

  const byTradePrice = [...tickers].sort(
    (a, b) => (b.acc_trade_price_24h ?? 0) - (a.acc_trade_price_24h ?? 0),
  );
  const topCount = Math.min(SELECT_TOP_BY_TRADE_PRICE, byTradePrice.length);
  const top = byTradePrice.slice(0, topCount);

  const byVolatility = top
    .map((t) => ({
      market: t.market,
      absRate: Math.abs(t.signed_change_rate ?? 0),
      rate: t.signed_change_rate ?? 0,
    }))
    .sort((a, b) => b.absRate - a.absRate);

  const selected = byVolatility.slice(0, TARGET_MARKET_COUNT);
  logger.info(
    LOG_SOURCE,
    "거래대금 상위 %s개 중 변동성 상위 %s개 선정: %s",
    String(topCount),
    String(TARGET_MARKET_COUNT),
    selected
      .map((x) => `${x.market}(${(x.rate * 100).toFixed(2)}%)`)
      .join(", "),
  );

  return selected.map((x) => x.market).filter(Boolean);
};
