/**
 * 전략 T1: BTC 1h 추세 추종 + 알트 EMA20 눌림목 진입
 *
 * [전략 개요]
 *   기존 1분봉 스캘핑(A~F)이 공개 지표 기반 정보 우위 부재로 손실을 누적한 문제를 해결.
 *   타임프레임을 1시간봉으로 상향해 트렌드 유효성을 확보하고, 손익비를 2:1(목표+5%, 손절-3%)로
 *   개선. 손익분기 승률 33%로 낮춰 구조적으로 수익 가능한 조건 확보.
 *
 * [매수 조건] — 전체 AND
 *   1. BTC 1h EMA20 > EMA50: BTC 상승 추세 (알트 전반적 상승 환경)
 *   2. BTC 1h RSI > 50: BTC 모멘텀 양성 (단순 배열이 아닌 실제 모멘텀 확인)
 *   3. Alt 1h EMA20 > EMA50: 알트 자체 상승 추세 (BTC와 독립 확인)
 *   4. Alt 현재가 ∈ [EMA20, EMA20 × (1 + EMA_PROXIMITY_PCT)]: 눌림목 위치
 *   5. Alt RSI ∈ [RSI_MIN, RSI_MAX]: 과매도/과매수 아닌 중간 반등 구간
 *   6. Alt 현재 1h 봉 거래량 < 직전 N봉 평균: 조용한 눌림 (급락/패닉 아님)
 *
 * [매도 조건] — 우선순위 순
 *   1. 손절: 순수익 < -3% (고정 손절, 즉시 실행)
 *   2. 최대 보유: 48시간 초과 (장기 횡보 시 기회비용 방지)
 *   3. BTC 추세 이탈: BTC EMA20 < EMA50 (장세 반전 시 즉시 청산)
 *   4. 트레일링 스톱: +2% 활성화 후 고점 대비 -1.5% 하락 (수익 보존)
 *   5. Alt EMA20 이탈: 현재가 < EMA20 × (1 - EMA_BREAK_PCT) (개별 추세 붕괴)
 *
 * [개선 방향]
 *   - 실전 10회+ 매매 후 손절/익절 분포 확인: RSI_MIN/MAX, EMA_PROXIMITY_PCT 조정
 *   - BTC RSI 기준(50)이 과도하게 신호를 차단하면 45로 완화 검토
 *   - 거래량 조건이 신호를 너무 줄이면 VOLUME_AVG_PERIOD를 10봉으로 축소
 *   - 손익비 데이터가 충분해지면 목표 수익률 기반 익절 조건 추가 고려
 */
import { getCandles1h } from "../../data/candleWindow1h";
import { calculateEMA, calculateRSI } from "../../indicators";
import {
  COST_PCT,
  RSI_PERIOD,
  STRATEGY_T1_EMA_SHORT,
  STRATEGY_T1_EMA_LONG,
  STRATEGY_T1_BTC_RSI_MIN,
  STRATEGY_T1_BTC_RSI_MAX,
  STRATEGY_T1_EMA_SPREAD_MIN_PCT,
  STRATEGY_T1_EMA_PROXIMITY_PCT,
  STRATEGY_T1_RSI_MIN,
  STRATEGY_T1_RSI_MAX,
  STRATEGY_T1_VOLUME_AVG_PERIOD,
  STRATEGY_T1_STOP_LOSS_PCT,
  STRATEGY_T1_MAX_HOLD_HOURS,
  STRATEGY_T1_TRAILING_ACTIVATE_PCT,
  STRATEGY_T1_TRAILING_OFFSET_PCT,
  STRATEGY_T1_EMA_BREAK_PCT,
} from "../../config";
import type { BuySignalResult, SellSignalResult } from "../signal";
import type { BotPosition } from "../../types";
import { logger } from "../../logger";

const LOG_SOURCE = "strategyT1";

const pricesFromCandles = (candles: { trade_price: number }[]): number[] =>
  candles.map((c) => c.trade_price);

const volumesFromCandles = (
  candles: { candle_acc_trade_volume: number }[],
): number[] => candles.map((c) => c.candle_acc_trade_volume);

/** 순수익률 (비용 차감) */
const getNetProfitPct = (buyPrice: number, currentPrice: number): number => {
  const raw = ((currentPrice - buyPrice) / buyPrice) * 100;
  return raw - COST_PCT;
};

/**
 * 전략 T1 매수 신호 체크.
 *
 * [주의] currentPrice는 1분봉 실시간 틱 가격.
 *   1h EMA/RSI는 1h 캔들 기반이므로 시간당 1회만 실질적으로 바뀜.
 *   동일 조건이 같은 시간 내 반복 체크되지만 신호 중복 진입은
 *   index.ts의 단일 포지션 보호로 차단됨.
 *
 * [P2 개선 방향] EMA 계산 캐싱
 *   현재 매 틱마다 EMA(200봉) 재계산. 1h 캔들은 60초 주기 갱신이므로
 *   동일 캔들 배열에 대해 수십~수백 번 동일한 결과를 반복 계산.
 *   1h 캔들이 바뀐 시각을 추적해 변경 시에만 EMA를 재계산하고 캐시하면
 *   CPU 낭비를 제거 가능. 단, EMA 계산 자체는 O(n) 경량 연산이므로
 *   실전 성능 문제가 확인된 후 적용.
 */
export const checkBuySignalT1 = (
  market: string,
  currentPrice: number,
): (BuySignalResult & { strategy: "T1"; altEma20: number }) | null => {
  const btcCandles = getCandles1h("KRW-BTC");
  const altCandles = getCandles1h(market);

  // EMA/RSI 계산은 완성 봉만 사용 (마지막 봉 = 현재 미완성 봉 제외).
  // 미완성 봉의 trade_price가 실시간 틱 가격으로 갱신되면 EMA가 매 틱마다
  // 조금씩 달라져 손절 기준이 가격과 함께 흘러내리는 문제 방지.
  const completedBtcCandles = btcCandles.slice(0, -1);
  const completedAltCandles = altCandles.slice(0, -1);

  // 완성 봉 기준으로 길이 체크 (EMA50, RSI 계산에 필요한 최소 봉 수)
  const minLen = Math.max(STRATEGY_T1_EMA_LONG, RSI_PERIOD + 1);
  if (completedBtcCandles.length < minLen || completedAltCandles.length < minLen) {
    return null;
  }
  // 거래량 평균 계산: 현재 봉 + 직전 N봉 (전체 altCandles 사용)
  if (altCandles.length < STRATEGY_T1_VOLUME_AVG_PERIOD + 1) {
    return null;
  }

  try {
    const btcPrices = pricesFromCandles(completedBtcCandles);
    const altPrices = pricesFromCandles(completedAltCandles);
    const altVolumes = volumesFromCandles(altCandles);

    // ── 조건 1: BTC EMA20 > EMA50 (BTC 상승 추세) ──────────────────────────
    const btcEmaShort = calculateEMA(btcPrices, STRATEGY_T1_EMA_SHORT);
    const btcEmaLong = calculateEMA(btcPrices, STRATEGY_T1_EMA_LONG);
    if (btcEmaShort <= btcEmaLong) return null;

    // ── 조건 2: BTC RSI ∈ [RSI_MIN, RSI_MAX] (BTC 모멘텀 양성, 과매수 아님) ──
    const btcRsi = calculateRSI(
      btcPrices.slice(-(RSI_PERIOD + 1)),
      RSI_PERIOD,
    );
    if (btcRsi < STRATEGY_T1_BTC_RSI_MIN) return null;
    if (btcRsi > STRATEGY_T1_BTC_RSI_MAX) {
      logger.debug(
        LOG_SOURCE,
        "[BT][차단] %s | BTC RSI 과매수 차단 btcRsi=%s > max=%s",
        market,
        btcRsi.toFixed(1),
        String(STRATEGY_T1_BTC_RSI_MAX),
      );
      return null;
    }

    // ── 조건 3: Alt EMA20 > EMA50 + 스프레드 ≥ EMA_SPREAD_MIN_PCT ────────────
    const altEmaShort = calculateEMA(altPrices, STRATEGY_T1_EMA_SHORT);
    const altEmaLong = calculateEMA(altPrices, STRATEGY_T1_EMA_LONG);
    if (altEmaShort <= altEmaLong) return null;
    const emaSpreadPct = ((altEmaShort - altEmaLong) / altEmaLong) * 100;
    if (emaSpreadPct < STRATEGY_T1_EMA_SPREAD_MIN_PCT) {
      logger.debug(
        LOG_SOURCE,
        "[BT][차단] %s | Alt EMA 스프레드 부족 spread=%s%% < min=%s%%",
        market,
        emaSpreadPct.toFixed(2),
        String(STRATEGY_T1_EMA_SPREAD_MIN_PCT),
      );
      return null;
    }

    // ── 조건 3-추가: 직전 완성 봉 양봉 확인 (하락 중 진입 차단) ──────────────
    // altCandles[-1] = 현재 진행 중인 미완성 봉, altCandles[-2] = 마지막 완성 봉.
    // 완성 봉이 음봉이면 직전 1h 봉이 하락이었다는 의미 → 추세 하락 중 진입 차단.
    if (altCandles.length < 2) return null;
    const lastCompletedCandle = altCandles[altCandles.length - 2];
    const isPrevCandleBullish =
      lastCompletedCandle.trade_price > lastCompletedCandle.opening_price;
    if (!isPrevCandleBullish) {
      logger.debug(
        LOG_SOURCE,
        "[BT][차단] %s | 직전 완성 봉 음봉 차단 open=%s close=%s",
        market,
        lastCompletedCandle.opening_price.toFixed(0),
        lastCompletedCandle.trade_price.toFixed(0),
      );
      return null;
    }

    // ── 조건 4: 현재가가 EMA20 눌림목 구간 ──────────────────────────────────
    // [EMA20, EMA20 × (1 + PROXIMITY_PCT/100)] 이내이면 눌림목 위치로 판단
    const altEmaShortUpper =
      altEmaShort * (1 + STRATEGY_T1_EMA_PROXIMITY_PCT / 100);
    if (currentPrice < altEmaShort || currentPrice > altEmaShortUpper) {
      return null;
    }

    // ── 조건 5: Alt RSI ∈ [RSI_MIN, RSI_MAX] ──────────────────────────────
    const altRsi = calculateRSI(
      altPrices.slice(-(RSI_PERIOD + 1)),
      RSI_PERIOD,
    );
    if (altRsi < STRATEGY_T1_RSI_MIN || altRsi > STRATEGY_T1_RSI_MAX) {
      return null;
    }

    // ── 조건 6: 현재 봉 거래량 < 직전 N봉 평균 (조용한 눌림) ───────────────
    // 거래량이 평균보다 크면 급락/패닉 눌림으로 간주해 진입 차단
    const currentVol = altVolumes[altVolumes.length - 1];
    const prevVols = altVolumes.slice(
      -(STRATEGY_T1_VOLUME_AVG_PERIOD + 1),
      -1,
    );
    const avgVol = prevVols.reduce((a, b) => a + b, 0) / prevVols.length;
    if (avgVol > 0 && currentVol >= avgVol) return null;

    logger.info(
      LOG_SOURCE,
      "[시그널] %s | T1 매수 조건 충족 | 가격 %s | btcEma(%s>%s) btcRsi=%s(<%s) | altEma(%s>%s,spread=%s%%) altRsi=%s | prevBull=%s | vol(%s<%s)",
      market,
      currentPrice.toFixed(0),
      btcEmaShort.toFixed(0),
      btcEmaLong.toFixed(0),
      btcRsi.toFixed(1),
      String(STRATEGY_T1_BTC_RSI_MAX),
      altEmaShort.toFixed(0),
      altEmaLong.toFixed(0),
      emaSpreadPct.toFixed(2),
      altRsi.toFixed(1),
      isPrevCandleBullish ? "Y" : "N",
      currentVol.toFixed(2),
      avgVol.toFixed(2),
    );
    logger.info(
      LOG_SOURCE,
      "[BT] T1 매수 btcRsi=%s altRsi=%s altEma20=%s emaSpread=%s%% price=%s proximity=%s%%",
      btcRsi.toFixed(1),
      altRsi.toFixed(1),
      altEmaShort.toFixed(0),
      emaSpreadPct.toFixed(2),
      currentPrice.toFixed(0),
      (((currentPrice - altEmaShort) / altEmaShort) * 100).toFixed(2),
    );

    return {
      shouldBuy: true,
      reason: `전략T1: BTC상승추세+Alt EMA20눌림목(RSI${altRsi.toFixed(0)})`,
      strategy: "T1",
      altEma20: altEmaShort,
    };
  } catch (e) {
    logger.error(
      LOG_SOURCE,
      "[오류] T1 매수 검토 중 예외: %s",
      (e as Error).message,
    );
    return null;
  }
};

/**
 * 전략 T1 매도 신호 체크.
 *
 * [매도 순서 설계 이유]
 *   손절(-3%) → 시간초과(48h) → BTC 추세 이탈 → 트레일링 → Alt EMA 이탈
 *
 *   BTC 추세 이탈을 트레일링보다 앞에 배치:
 *     BTC가 하락 전환하면 알트도 동반 하락하므로 트레일링 활성화 전이라도 즉시 청산.
 *     트레일링은 상승 구간 수익 보존에만 집중.
 *
 *   Alt EMA20 이탈을 마지막에 배치:
 *     BTC 추세가 유지되는 상황에서 알트 개별 이탈 시 청산.
 *     트레일링 활성화 후에는 트레일링이 우선 발동되므로 EMA 이탈은 보조 안전장치 역할.
 */
export const checkSellSignalT1 = (
  market: string,
  position: BotPosition,
  currentPrice: number,
): SellSignalResult => {
  const netPct = getNetProfitPct(position.buyPrice, currentPrice);

  // ── 1. 고정 손절 (-3%) ───────────────────────────────────────────────────
  if (netPct <= STRATEGY_T1_STOP_LOSS_PCT) {
    logger.info(
      LOG_SOURCE,
      "[시그널] %s | T1 손절 | 순수익 %s%% (<= %s%%)",
      market,
      netPct.toFixed(2),
      String(STRATEGY_T1_STOP_LOSS_PCT),
    );
    logger.info(
      LOG_SOURCE,
      "[BT] T1 매도 type=손절 netPct=%s thr=%s holdH=%s",
      netPct.toFixed(2),
      String(STRATEGY_T1_STOP_LOSS_PCT),
      ((Date.now() - position.buyTime) / 3_600_000).toFixed(1),
    );
    return {
      shouldSell: true,
      reason: `전략T1 손절 (순수익 ${netPct.toFixed(2)}%)`,
    };
  }

  // ── 2. 최대 보유 시간 (48시간) ────────────────────────────────────────────
  const holdHours = (Date.now() - position.buyTime) / 3_600_000;
  if (holdHours >= STRATEGY_T1_MAX_HOLD_HOURS) {
    logger.info(
      LOG_SOURCE,
      "[시그널] %s | T1 최대보유 초과 | %sh (순수익 %s%%)",
      market,
      holdHours.toFixed(1),
      netPct.toFixed(2),
    );
    logger.info(
      LOG_SOURCE,
      "[BT] T1 매도 type=최대보유 holdH=%s netPct=%s maxH=%s",
      holdHours.toFixed(1),
      netPct.toFixed(2),
      String(STRATEGY_T1_MAX_HOLD_HOURS),
    );
    return {
      shouldSell: true,
      reason: `전략T1 최대보유 초과 (${holdHours.toFixed(1)}h, 순수익 ${netPct.toFixed(2)}%)`,
    };
  }

  // ── 3. BTC 추세 이탈 (EMA20 < EMA50) ─────────────────────────────────────
  // [개선 방향] BTC 추세 이탈 기준을 단순 EMA 교차에서 hysteresis(±0.2%)로 변경 고려.
  //   현재 단순 교차로 구현 → 실전에서 BTC EMA 교차 직후 빠르게 회복하는 사례 수집 후 판단.
  //   노이즈 청산 비율(BTC 추세 이탈 → 이후 1h 내 EMA 재교차 횟수)을 [BT] 로그로 추적.
  //   10회 이상 매매 후 "type=BTC추세이탈" 매도 중 손실 비율이 50% 초과 시 hysteresis 적용.
  const btcCandles = getCandles1h("KRW-BTC");
  if (btcCandles.length >= STRATEGY_T1_EMA_LONG) {
    const btcPrices = pricesFromCandles(btcCandles);
    const btcEmaShort = calculateEMA(btcPrices, STRATEGY_T1_EMA_SHORT);
    const btcEmaLong = calculateEMA(btcPrices, STRATEGY_T1_EMA_LONG);
    if (btcEmaShort < btcEmaLong) {
      logger.info(
        LOG_SOURCE,
        "[시그널] %s | T1 BTC 추세 이탈 | EMA%s(%s) < EMA%s(%s) | 순수익 %s%%",
        market,
        String(STRATEGY_T1_EMA_SHORT),
        btcEmaShort.toFixed(0),
        String(STRATEGY_T1_EMA_LONG),
        btcEmaLong.toFixed(0),
        netPct.toFixed(2),
      );
      logger.info(
        LOG_SOURCE,
        "[BT] T1 매도 type=BTC추세이탈 btcEmaShort=%s btcEmaLong=%s netPct=%s holdH=%s",
        btcEmaShort.toFixed(0),
        btcEmaLong.toFixed(0),
        netPct.toFixed(2),
        holdHours.toFixed(1),
      );
      return {
        shouldSell: true,
        reason: `전략T1 BTC 추세 이탈 (EMA${STRATEGY_T1_EMA_SHORT} ${btcEmaShort.toFixed(0)} < EMA${STRATEGY_T1_EMA_LONG} ${btcEmaLong.toFixed(0)}, 순수익 ${netPct.toFixed(2)}%)`,
      };
    }
  }

  // ── 4. 트레일링 스톱 (+2% 활성화 후 고점 대비 -1.5%) ─────────────────────
  // trailingActivated / highestPrice: index.ts에서 maxNetPct >= TRAILING_ACTIVATE_PCT 시 설정
  if (position.trailingActivated && position.highestPrice != null) {
    const threshold =
      position.highestPrice * (1 - STRATEGY_T1_TRAILING_OFFSET_PCT / 100);
    if (currentPrice <= threshold) {
      logger.info(
        LOG_SOURCE,
        "[시그널] %s | T1 트레일링 스톱 | 고가 %s 대비 -%s%% | 순수익 %s%%",
        market,
        position.highestPrice.toFixed(0),
        String(STRATEGY_T1_TRAILING_OFFSET_PCT),
        netPct.toFixed(2),
      );
      logger.info(
        LOG_SOURCE,
        "[BT] T1 매도 type=트레일링 high=%s offsetPct=%s netPct=%s holdH=%s",
        position.highestPrice.toFixed(0),
        String(STRATEGY_T1_TRAILING_OFFSET_PCT),
        netPct.toFixed(2),
        holdHours.toFixed(1),
      );
      return {
        shouldSell: true,
        reason: `전략T1 트레일링 스톱 (고가 ${position.highestPrice.toFixed(0)} 대비 -${STRATEGY_T1_TRAILING_OFFSET_PCT}%, 순수익 ${netPct.toFixed(2)}%)`,
      };
    }
  }

  // ── 5. Alt EMA20 이탈 (개별 추세 붕괴) ──────────────────────────────────
  // [Phase2 수정] EMA20 손절 기준을 진입 시점 고정값(position.ema20AtBuy)으로 판단.
  // 기존: 매 틱 live EMA 재계산 → 가격 하락 시 EMA도 같이 내려가 손절선이 흘러내림.
  // 수정: 진입 시점 EMA20을 저장해두고 이 값으로 threshold 고정.
  //   live EMA는 검증 로그([BT] drift)에만 사용해 실제 EMA와의 괴리를 추적.
  const altCandles = getCandles1h(market);
  const ema20Base = position.ema20AtBuy;
  if (ema20Base != null) {
    const emaBreachThreshold = ema20Base * (1 - STRATEGY_T1_EMA_BREAK_PCT / 100);
    // 검증용: 현재 live EMA와 고정값의 괴리 추적
    let liveEmaStr = "N/A";
    let driftStr = "N/A";
    if (altCandles.length >= STRATEGY_T1_EMA_SHORT) {
      const liveEma = calculateEMA(
        pricesFromCandles(altCandles.slice(0, -1)),
        STRATEGY_T1_EMA_SHORT,
      );
      liveEmaStr = liveEma.toFixed(0);
      driftStr = (((liveEma - ema20Base) / ema20Base) * 100).toFixed(2);
    }
    logger.debug(
      LOG_SOURCE,
      "[BT] T1 EMA이탈체크 %s | fixed=%s liveEma=%s drift=%s%% thr=%s price=%s",
      market,
      ema20Base.toFixed(0),
      liveEmaStr,
      driftStr,
      emaBreachThreshold.toFixed(0),
      currentPrice.toFixed(0),
    );
    if (currentPrice < emaBreachThreshold) {
      logger.info(
        LOG_SOURCE,
        "[시그널] %s | T1 Alt EMA%s 이탈 | 현재가 %s < 기준 %s (고정EMA%s %s) | 순수익 %s%%",
        market,
        String(STRATEGY_T1_EMA_SHORT),
        currentPrice.toFixed(0),
        emaBreachThreshold.toFixed(0),
        String(STRATEGY_T1_EMA_SHORT),
        ema20Base.toFixed(0),
        netPct.toFixed(2),
      );
      logger.info(
        LOG_SOURCE,
        "[BT] T1 매도 type=EMA이탈 altEma20Fixed=%s liveEma=%s drift=%s%% thr=%s price=%s netPct=%s holdH=%s",
        ema20Base.toFixed(0),
        liveEmaStr,
        driftStr,
        emaBreachThreshold.toFixed(0),
        currentPrice.toFixed(0),
        netPct.toFixed(2),
        holdHours.toFixed(1),
      );
      return {
        shouldSell: true,
        reason: `전략T1 Alt EMA${STRATEGY_T1_EMA_SHORT} 이탈 (${currentPrice.toFixed(0)} < ${emaBreachThreshold.toFixed(0)}, 순수익 ${netPct.toFixed(2)}%)`,
      };
    }
  } else if (altCandles.length >= STRATEGY_T1_EMA_SHORT) {
    // ema20AtBuy 없는 구버전 포지션 폴백: live EMA 사용 (로그로 구분)
    const altPrices = pricesFromCandles(altCandles.slice(0, -1));
    const altEmaShort = calculateEMA(altPrices, STRATEGY_T1_EMA_SHORT);
    const emaBreachThreshold = altEmaShort * (1 - STRATEGY_T1_EMA_BREAK_PCT / 100);
    logger.debug(
      LOG_SOURCE,
      "[BT] T1 EMA이탈체크(폴백) %s | liveEma=%s thr=%s price=%s",
      market,
      altEmaShort.toFixed(0),
      emaBreachThreshold.toFixed(0),
      currentPrice.toFixed(0),
    );
    if (currentPrice < emaBreachThreshold) {
      logger.info(
        LOG_SOURCE,
        "[시그널] %s | T1 Alt EMA%s 이탈(폴백) | 현재가 %s < 기준 %s (liveEMA %s) | 순수익 %s%%",
        market,
        String(STRATEGY_T1_EMA_SHORT),
        currentPrice.toFixed(0),
        emaBreachThreshold.toFixed(0),
        altEmaShort.toFixed(0),
        netPct.toFixed(2),
      );
      logger.info(
        LOG_SOURCE,
        "[BT] T1 매도 type=EMA이탈(폴백) altEma20Live=%s thr=%s price=%s netPct=%s holdH=%s",
        altEmaShort.toFixed(0),
        emaBreachThreshold.toFixed(0),
        currentPrice.toFixed(0),
        netPct.toFixed(2),
        holdHours.toFixed(1),
      );
      return {
        shouldSell: true,
        reason: `전략T1 Alt EMA${STRATEGY_T1_EMA_SHORT} 이탈 (${currentPrice.toFixed(0)} < ${emaBreachThreshold.toFixed(0)}, 순수익 ${netPct.toFixed(2)}%)`,
      };
    }
  }

  return { shouldSell: false };
};

