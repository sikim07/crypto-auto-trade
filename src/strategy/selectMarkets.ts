import { getAllMarkets, getTicker } from "../api/rest";
import {
  TARGET_MARKET_COUNT,
  SELECT_MIN_PRICE,
  SELECT_UPWARD_WEIGHT,
  SELECT_MAX_DOWNWARD_RATE,
} from "../config";
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
  // [v3.8.20260320] 폭락 종목 절대 차단: 24h 등락률 -SELECT_MAX_DOWNWARD_RATE 이하 제외
  // 방향가중만으로는 -43% 폭락 종목이 여전히 1위 선정되는 구조적 문제 해결 (BARD 3회 손절 사례)
  const top = byTradePrice
    .slice(0, topCount)
    .filter((t) => (t.trade_price ?? 0) >= SELECT_MIN_PRICE)
    .filter((t) => (t.signed_change_rate ?? 0) > -SELECT_MAX_DOWNWARD_RATE);

  // [v3.10.20260323] 상방 변동성 전용 선정: rate > 0 종목만 후보로 허용.
  // v3.9까지 DOWNWARD_WEIGHT로 하락 종목 가중치를 낮췄으나 score > 0이므로
  // 상방 후보 부족 시 여전히 선정됨. 필터로 완전 제거해 의도를 명확히 함.
  // SELECT_MAX_DOWNWARD_RATE(-10%) 필터 이후 추가 적용 → -10%~0% 구간도 차단.
  const positiveOnly = top.filter((t) => (t.signed_change_rate ?? 0) > 0);

  // [BT] 상방/하락 현황 — posCount=0 빈도로 하락장 공백 구간 파악.
  // 수집 목적: 레짐 차단과 중복 여부, 단일 종목 운영 빈도 집계.
  const negCount = top.length - positiveOnly.length;
  if (positiveOnly.length < TARGET_MARKET_COUNT) {
    logger.info(
      LOG_SOURCE,
      "[BT] 상방 후보 %s개 / 전체 %s개 (하락·보합 제외 %s개)",
      String(positiveOnly.length),
      String(top.length),
      String(negCount),
    );
  }

  if (positiveOnly.length === 0) {
    logger.warn(LOG_SOURCE, "상방 변동성 종목 없음 — 선정 생략");
    return [];
  }

  const byVolatility = positiveOnly
    .map((t) => {
      const rate = t.signed_change_rate ?? 0;
      const score = rate * SELECT_UPWARD_WEIGHT;
      return { market: t.market, score, rate };
    })
    .sort((a, b) => b.score - a.score);

  const selected = byVolatility.slice(0, TARGET_MARKET_COUNT);
  logger.info(
    LOG_SOURCE,
    "거래대금 상위 %s개 중 상방 변동성 상위 %s개 선정: %s",
    String(topCount),
    String(selected.length),
    selected
      .map((x) => `${x.market}(${(x.rate * 100).toFixed(2)}%)`)
      .join(", "),
  );
  // [BT] 상방 후보 — 선정 종목 + 탈락 상위 2개를 함께 출력해 선정 기준 추적.
  // 수집 목적: 상방 종목 내 경쟁 현황, 단일 종목 운영 구간 비율 파악.
  const btCandidates = byVolatility.slice(
    0,
    Math.min(TARGET_MARKET_COUNT + 2, byVolatility.length),
  );
  logger.info(
    LOG_SOURCE,
    "[BT] 상방 후보: %s",
    btCandidates
      .map(
        (x) =>
          `${x.market}(점수${(x.score * 100).toFixed(1)}pt/${(x.rate * 100).toFixed(2)}%)`,
      )
      .join(", "),
  );

  return selected.map((x) => x.market).filter(Boolean);
};
