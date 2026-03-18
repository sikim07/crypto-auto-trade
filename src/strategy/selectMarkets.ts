import { getAllMarkets, getTicker } from "../api/rest";
import {
  TARGET_MARKET_COUNT,
  SELECT_MIN_PRICE,
  SELECT_UPWARD_WEIGHT,
  SELECT_DOWNWARD_WEIGHT,
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
  const top = byTradePrice
    .slice(0, topCount)
    .filter((t) => (t.trade_price ?? 0) >= SELECT_MIN_PRICE);

  // [v3.7.20260318] 방향성 가중 변동성: 상승 × UPWARD_WEIGHT / 하락 × DOWNWARD_WEIGHT
  // 기존 절대값 정렬은 -15% 하락 종목과 +15% 상승 종목을 동일 취급 → 하락 종목 반복 선정 문제.
  // score로 정렬해 상승 종목 우선 선정. 실제 rate는 로그에 그대로 표시(가중 점수 미표시).
  const byVolatility = top
    .map((t) => {
      const rate = t.signed_change_rate ?? 0;
      const score =
        rate >= 0
          ? rate * SELECT_UPWARD_WEIGHT
          : Math.abs(rate) * SELECT_DOWNWARD_WEIGHT;
      return { market: t.market, score, rate };
    })
    .sort((a, b) => b.score - a.score);

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
  // [BT] 방향가중 상위 후보 — 선정 종목 + 탈락 상위 2개를 함께 출력해 가중치 효과 추적.
  // 가중점수(선정 기준)와 실제등락률을 모두 표시.
  // 수집 목적: 기존 절대값 정렬이었다면 다르게 선정됐을 종목이 얼마나 있는지 확인.
  //            UPWARD_WEIGHT/DOWNWARD_WEIGHT 조정 판단 근거로 활용.
  const btCandidates = byVolatility.slice(
    0,
    Math.min(TARGET_MARKET_COUNT + 2, byVolatility.length),
  );
  logger.info(
    LOG_SOURCE,
    "[BT] 방향가중 후보: %s",
    btCandidates
      .map(
        (x) =>
          `${x.market}(점수${(x.score * 100).toFixed(1)}pt/${(x.rate * 100).toFixed(2)}%)`,
      )
      .join(", "),
  );

  return selected.map((x) => x.market).filter(Boolean);
};
