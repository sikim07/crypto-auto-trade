import { getAllMarkets, getTicker } from "../api/rest";
import { TARGET_MARKET_COUNT, SELECT_MIN_PRICE } from "../config";
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
  // [v3.4.20260312] 최소 단가 필터: SELECT_MIN_PRICE(200원) 미만 코인 제외.
  // 기존 전략 D에서만 적용하던 저가 코인 차단을 종목 선정 단계로 이관해 전략 무관하게 일괄 적용.
  // 200원 미만 코인은 1원 틱이 수익률 0.5~1.7%에 해당하여 수수료 구조상 안정적 수익이 어려움.
  // (기준값·이관 근거 상세: config.ts SELECT_MIN_PRICE 주석 참조)
  const top = byTradePrice
    .slice(0, topCount)
    .filter((t) => (t.trade_price ?? 0) >= SELECT_MIN_PRICE);

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
