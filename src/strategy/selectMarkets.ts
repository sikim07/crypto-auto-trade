import { getAllMarkets, getTicker } from "../api/rest";
import { TARGET_MARKET_COUNT } from "../config";
import type { UpbitTicker } from "../types";
import { logger } from "../logger";

const LOG_SOURCE = "selectMarkets";

/**
 * KRW 마켓 중 거래대금 상위권에서 하락 변동성 높은 2종목 선정
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
  const topCount = Math.min(50, byTradePrice.length);
  const top = byTradePrice.slice(0, topCount);

  logger.debug(
    LOG_SOURCE,
    "거래대금 상위 %s개 중 하락 종목 탐색",
    String(topCount),
  );

  const dropping = top
    .filter((t) => (t.signed_change_rate ?? 0) < 0)
    .map((t) => ({
      market: t.market,
      changeRate: t.signed_change_rate ?? 0,
    }))
    .sort((a, b) => a.changeRate - b.changeRate);

  if (dropping.length >= TARGET_MARKET_COUNT) {
    const selected = dropping.slice(0, TARGET_MARKET_COUNT);
    logger.info(
      LOG_SOURCE,
      "하락 종목 선정: %s (하락 %s개 중)",
      selected
        .map((x) => `${x.market}(${(x.changeRate * 100).toFixed(2)}%)`)
        .join(", "),
      String(dropping.length),
    );
    return selected.map((x) => x.market).filter(Boolean);
  }

  logger.info(
    LOG_SOURCE,
    "하락 종목 부족 (%s개), 변동률 절대값 기준 폴백",
    String(dropping.length),
  );

  const byAbsChange = top
    .map((t) => ({
      market: t.market,
      vol: Math.abs(t.signed_change_rate ?? 0),
      rate: t.signed_change_rate ?? 0,
    }))
    .sort((a, b) => b.vol - a.vol);

  const selected = byAbsChange.slice(0, TARGET_MARKET_COUNT);
  logger.info(
    LOG_SOURCE,
    "폴백 선정: %s",
    selected
      .map((x) => `${x.market}(${(x.rate * 100).toFixed(2)}%)`)
      .join(", "),
  );

  return selected.map((x) => x.market).filter(Boolean);
};
