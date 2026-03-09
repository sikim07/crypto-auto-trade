import { getCandles } from "../data/candleWindow";
import {
  calculateRSI,
  calculateEMA,
  getVolumeRatio,
  linearRegressionSlope,
} from "../indicators";
import {
  RSI_PERIOD,
  STRATEGY_F_EMA_PERIOD,
  STRATEGY_F_PROXIMITY_PCT,
  STRATEGY_F_RSI_CROSS,
  STRATEGY_F_FIRST_GREEN_ONLY,
  STRATEGY_F_MIN_VWAP_CANDLES_1M,
  STRATEGY_F_MIN_VWAP_CANDLES_5M,
  STRATEGY_F_STOP_LOSS_PCT,
  STRATEGY_F_MAX_HOLD_MINUTES,
  STRATEGY_F_TRAILING_ACTIVATE_PCT,
  STRATEGY_F_TRAILING_OFFSET_PCT,
  STRATEGY_F_ENTRY_BREACH_PCT,
  STRATEGY_F_ENTRY_BREACH_GRACE_SEC,
  STRATEGY_F_VWAP_BUFFER_PCT,
  STRATEGY_F_VOLUME_RATIO_MIN,
  STRATEGY_F_VOLUME_AVG_PERIOD,
  STRATEGY_F_TRAILING_TIGHTEN_THRESHOLD,
  STRATEGY_F_TRAILING_TIGHTEN_OFFSET,
  STRATEGY_F_EMA_TOUCH_WINDOW,
  STRATEGY_F_EMA_TOUCH_BUFFER_PCT,
  STRATEGY_F_EMA_SLOPE_LOOKBACK,
  STRATEGY_F_EMA_SLOPE_MIN_PCT,
  COST_PCT,
} from "../config";
import type { BuySignalResult, SellSignalResult } from "./signal";
import type { BotPosition, UpbitCandle } from "../types";
import { logger } from "../logger";

const LOG_SOURCE = "strategyF";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

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

/** 당일 KST 기준 캔들 필터 후 VWAP 계산. 최소 캔들 미충족 또는 거래량 0 시 0 반환 */
const calcVwap = (candles: UpbitCandle[], minCandles: number): number => {
  const kstNow = new Date(Date.now() + KST_OFFSET_MS);
  const todayCandles = candles.filter((c) => {
    const kstCandle = new Date(c.timestamp + KST_OFFSET_MS);
    return (
      kstCandle.getUTCFullYear() === kstNow.getUTCFullYear() &&
      kstCandle.getUTCMonth() === kstNow.getUTCMonth() &&
      kstCandle.getUTCDate() === kstNow.getUTCDate()
    );
  });
  if (todayCandles.length < minCandles) return 0;
  const totalPrice = todayCandles.reduce(
    (s, c) => s + c.candle_acc_trade_price,
    0,
  );
  const totalVolume = todayCandles.reduce(
    (s, c) => s + c.candle_acc_trade_volume,
    0,
  );
  return totalVolume > 0 ? totalPrice / totalVolume : 0;
};

/**
 * 전략 F 매수: 5분봉 VWAP 위, 1분봉 VWAP+EMA21 위, 눌림목 위치, RSI 크로스, 마감봉 양봉.
 *
 * [1차 수정] RSI_CROSS 42→38 (반등 당김), PROXIMITY_PCT 0.4→0.5, FIRST_GREEN_ONLY=true 도입.
 *   이후 개선: RSI_CROSS 38→40 (허수 반등 빈발 대응 — 보수적 조정).
 *
 * [2차 수정] 네 가지 변경:
 *   (A) RSI_CROSS 40→38 복원: [조건 7] EMA21 확정 지지 조건이 추가됨으로써
 *       허수 반등 차단 역할을 EMA21 터치 확인이 대신하게 됨. RSI 조기 진입의
 *       단점(허수 반등)을 EMA21 터치 조건으로 상쇄하므로 반등 초입 타이밍 확보를
 *       위해 38로 복원.
 *   (B) [조건 7] EMA21 확정 지지 추가: 최근 N봉 내 저가(low_price)가 EMA21
 *       이하로 내려갔다가 종가(trade_price)가 EMA21 이상으로 회복한 봉이
 *       1개 이상 존재해야 진입. 단순히 "EMA21 위에 있다"가 아닌 "EMA21에서
 *       실제로 반등했다"를 확인하여 가짜 지지선(플로팅)에 진입하는 허수 반등 차단.
 *   (C) TRAILING_TIGHTEN_THRESHOLD 1.5→1.0: 최대수익 1.0% 달성 시 즉시
 *       타이트닝 오프셋(0.3%) 적용, 수익 보존 강화.
 *   (D) [조건 8] EMA21 기울기 필터 추가: 직전 N봉의 EMA21 값으로 선형회귀
 *       기울기를 산출해 EMA21이 수평/하향이면 진입 차단. EMA21이 수평인 박스권
 *       상단에서의 반복 진입 방지 (KITE 3회 연속 EMA21=456 수평 사례).
 *       조건 7(지지 확인)과 조건 8(방향 확인)이 함께 작동해 "반등 + 상승 추세"
 *       두 조건을 모두 만족할 때만 진입.
 *   확인할 것:
 *   - EMA21 터치 조건으로 진입 횟수가 얼마나 줄었는지 (신호 과소 시 TOUCH_BUFFER_PCT 완화).
 *   - RSI 38 복원 후 진입이탈 손절 빈도 변화 (38 단독 시절 대비 개선 여부).
 *   - 트레일링 타이트닝 1.0% 기준에서 조기 청산 vs 수익 보존 균형.
 *   - [BT] 로그 emaSlopePct 분포 확인 후 SLOPE_MIN_PCT 조정 (과소 신호 시 하향, 수평 진입 반복 시 상향).
 */
export const checkBuySignalF = (
  market: string,
  currentPrice: number,
): (BuySignalResult & { strategy: "F" }) | null => {
  const candles1m = getCandles(market, 1);
  const candles5m = getCandles(market, 5);

  const minNeed1m = Math.max(
    STRATEGY_F_EMA_PERIOD,
    RSI_PERIOD + 2,
    STRATEGY_F_MIN_VWAP_CANDLES_1M,
  );
  if (
    candles1m.length < minNeed1m ||
    candles5m.length < STRATEGY_F_MIN_VWAP_CANDLES_5M
  )
    return null;

  try {
    // [조건 1] 5분봉 현재가 > VWAP_5m
    const vwap5m = calcVwap(candles5m, STRATEGY_F_MIN_VWAP_CANDLES_5M);
    if (vwap5m === 0) return null;
    const lastClose5m = candles5m[candles5m.length - 1].trade_price;
    if (lastClose5m <= vwap5m) return null;

    // closedCandles 처리 — 미완성 현재봉 제외
    const volumes1m = volumesFromCandles(candles1m);
    const isCurrentCandleOpen =
      volumes1m.length > 1 && volumes1m[volumes1m.length - 1] === 0;
    const closedCandles = isCurrentCandleOpen
      ? candles1m.slice(0, -1)
      : candles1m;
    const closedPrices = pricesFromCandles(closedCandles);
    if (closedPrices.length < RSI_PERIOD + 2) return null;

    // [조건 2] 1분봉 현재가 > VWAP_1m AND 현재가 > EMA21_1m
    const vwap1m = calcVwap(candles1m, STRATEGY_F_MIN_VWAP_CANDLES_1M);
    if (vwap1m === 0) return null;
    if (currentPrice <= vwap1m) return null;

    const ema21 = calculateEMA(closedPrices, STRATEGY_F_EMA_PERIOD);
    if (currentPrice <= ema21) return null;

    // [조건 3] 현재가 ≤ max(VWAP_1m, EMA21) × (1 + PROXIMITY_PCT/100) — 눌림목 위치
    const anchor = Math.max(vwap1m, ema21);
    const proximityThreshold = anchor * (1 + STRATEGY_F_PROXIMITY_PCT / 100);
    if (currentPrice > proximityThreshold) return null;

    // [조건 4] RSI 크로스 (2차 수정: 38로 복원 — EMA21 터치 조건[조건 7]이 품질 필터 역할을 대신하므로)
    const rsiPrices = closedPrices.slice(-(RSI_PERIOD + 2));
    const rsiPrev = calculateRSI(rsiPrices.slice(0, -1));
    const rsiCur = calculateRSI(rsiPrices);
    if (!(rsiPrev < STRATEGY_F_RSI_CROSS && rsiCur >= STRATEGY_F_RSI_CROSS))
      return null;

    // [조건 5] 마감봉 양봉: close > open. 반등 당김 시 FIRST_GREEN_ONLY면 직전봉 음봉/도지일 때만(첫 반등 양봉만)
    const lastClosed = closedCandles[closedCandles.length - 1];
    if (lastClosed.trade_price <= lastClosed.opening_price) return null;
    if (STRATEGY_F_FIRST_GREEN_ONLY && closedCandles.length >= 2) {
      const prevClosed = closedCandles[closedCandles.length - 2];
      if (prevClosed.trade_price > prevClosed.opening_price) return null;
    }

    // [조건 6] 거래량 필터: 현재 거래량이 직전 N개 봉 평균 대비 최소 비율 이상일 때만 진입
    // 목적: 눌림목 반등 시 거래량 증가를 확인하여 허수 반등 진입 방지
    // 이유: 거래량이 증가하지 않은 반등은 약한 반등일 가능성이 높음
    if (volumes1m.length >= STRATEGY_F_VOLUME_AVG_PERIOD + 1) {
      const currentVolume = volumes1m[volumes1m.length - 1];
      const volumeRatio = getVolumeRatio(
        currentVolume,
        volumes1m,
        STRATEGY_F_VOLUME_AVG_PERIOD,
      );
      if (volumeRatio < STRATEGY_F_VOLUME_RATIO_MIN) {
        // 거래량 부족으로 진입 차단 (로그는 생략하여 노이즈 감소)
        return null;
      }
    }

    // [조건 7] EMA21 확정 지지 확인 (2차 수정 신규)
    // 목적: "EMA21 위에 있다"가 아닌 "EMA21에서 실제로 반등했다"를 확인.
    //       가짜 지지선(플로팅)에 진입하는 허수 반등 차단.
    // 로직: 직전 TOUCH_WINDOW개 마감봉 중, 저가(low_price)가
    //       EMA21 × (1 + TOUCH_BUFFER_PCT/100) 이하이고
    //       종가(trade_price)가 EMA21 이상인 봉이 1개 이상 존재해야 통과.
    // 버퍼 이유: 현재봉 기준 EMA21과 과거봉 시점의 실제 EMA21 사이
    //           미세 차이를 흡수하기 위한 허용 범위.
    const emaUpperRef = ema21 * (1 + STRATEGY_F_EMA_TOUCH_BUFFER_PCT / 100);
    const touchCandleWindow = closedCandles.slice(
      -(STRATEGY_F_EMA_TOUCH_WINDOW + 1),
      -1,
    );
    const hasConfirmedBounce = touchCandleWindow.some(
      (c) => c.low_price <= emaUpperRef && c.trade_price >= ema21,
    );
    if (!hasConfirmedBounce) return null;

    // [조건 8] EMA21 기울기 필터 (2차 개선)
    // 목적: EMA21이 수평/하향인 박스권 상단에서의 반복 진입 차단.
    //       EMA21이 상승 중일 때만 진입해 "눌림목 반등" 조건 실질화.
    // 로직: 직전 SLOPE_LOOKBACK+1개 봉의 EMA21 값으로 선형회귀 기울기 산출.
    //       기울기를 EMA21 현재값으로 정규화(봉당 %) → 최소 상승률 미만이면 차단.
    // 사례: KITE 3회 연속 진입 시 EMA21=456 수평 → 기울기≈0 → 차단 대상
    //       (02:31 시간초과 -0.25%, 02:58 시간초과 -0.25%)
    // 조건 7과의 차이: 조건 7=지지 확인(저가 터치 후 회복), 조건 8=방향 확인(EMA 상승 중)
    let emaSlopePct = 0;
    const minForSlope = STRATEGY_F_EMA_PERIOD + STRATEGY_F_EMA_SLOPE_LOOKBACK;
    if (closedPrices.length >= minForSlope) {
      const emaHistory: number[] = [];
      for (let i = STRATEGY_F_EMA_SLOPE_LOOKBACK; i >= 0; i--) {
        const slice = closedPrices.slice(0, closedPrices.length - i);
        emaHistory.push(calculateEMA(slice, STRATEGY_F_EMA_PERIOD));
      }
      const emaSlope = linearRegressionSlope(emaHistory);
      emaSlopePct = ema21 > 0 ? (emaSlope / ema21) * 100 : 0;
      if (emaSlopePct < STRATEGY_F_EMA_SLOPE_MIN_PCT) return null;
    }

    // 거래량 비율 계산 (로깅용)
    let volumeRatio = 0;
    if (volumes1m.length >= STRATEGY_F_VOLUME_AVG_PERIOD + 1) {
      const currentVolume = volumes1m[volumes1m.length - 1];
      volumeRatio = getVolumeRatio(
        currentVolume,
        volumes1m,
        STRATEGY_F_VOLUME_AVG_PERIOD,
      );
    }

    logger.info(
      LOG_SOURCE,
      "[시그널] %s | 매수 조건 충족 | 가격 %s | VWAP1m %s | EMA21 %s | EMA기울기 %s%%/봉 | RSI %s→%s | 거래량비율 %s",
      market,
      currentPrice.toFixed(0),
      vwap1m.toFixed(0),
      ema21.toFixed(0),
      emaSlopePct.toFixed(4),
      rsiPrev.toFixed(1),
      rsiCur.toFixed(1),
      volumeRatio.toFixed(2),
    );
    logger.info(
      LOG_SOURCE,
      "[BT] F 매수 vwap1m=%s ema21=%s emaSlopePct=%s RSI=%s→%s proximityPct=%s volRatio=%s emaTouch=%s price=%s",
      vwap1m.toFixed(0),
      ema21.toFixed(4),
      emaSlopePct.toFixed(4),
      rsiPrev.toFixed(1),
      rsiCur.toFixed(1),
      String(STRATEGY_F_PROXIMITY_PCT),
      volumeRatio.toFixed(2),
      hasConfirmedBounce ? "Y" : "N",
      currentPrice.toFixed(0),
    );
    return {
      shouldBuy: true,
      reason: `전략F: VWAP눌림목+EMA21+RSI${STRATEGY_F_RSI_CROSS}상향+양봉`,
      strategy: "F",
    };
  } catch (e) {
    logger.error(
      LOG_SOURCE,
      "[오류] 전략F 매수 검토 중 예외: %s",
      (e as Error).message,
    );
    return null;
  }
};

/** 전략 F 매도: 하드손절 → 진입저점 이탈 → VWAP 붕괴 → 트레일링 스톱(D방식) → 최대 보유 */
export const checkSellSignalF = (
  market: string,
  position: BotPosition,
  currentPrice: number,
): SellSignalResult => {
  try {
    const netPct = getNetProfitPct(position.buyPrice, currentPrice);

    // 1. 하드 손절
    if (netPct <= STRATEGY_F_STOP_LOSS_PCT) {
      logger.info(
        LOG_SOURCE,
        "[시그널] %s | 손절 (순수익 %s%%)",
        market,
        netPct.toFixed(2),
      );
      logger.info(
        LOG_SOURCE,
        "[BT] F 매도 type=손절 netPct=%s thr=%s",
        netPct.toFixed(2),
        String(STRATEGY_F_STOP_LOSS_PCT),
      );
      return {
        shouldSell: true,
        reason: `전략F 손절 (순수익 ${netPct.toFixed(2)}%)`,
      };
    }

    // 2. 진입 수준 이탈 (진입가 대비 -ENTRY_BREACH_PCT% 이하, 유예 시간 경과 후만 적용)
    const holdMs = Date.now() - position.buyTime;
    if (holdMs >= STRATEGY_F_ENTRY_BREACH_GRACE_SEC * 1000) {
      const entryBreachPrice =
        position.buyPrice * (1 - STRATEGY_F_ENTRY_BREACH_PCT / 100);
      if (currentPrice < entryBreachPrice) {
        logger.info(
          LOG_SOURCE,
          "[시그널] %s | 손절 (진입 수준 이탈) 현재가 %s < 진입가대비 %s%% 이하",
          market,
          currentPrice.toFixed(0),
          STRATEGY_F_ENTRY_BREACH_PCT,
        );
        logger.info(
          LOG_SOURCE,
          "[BT] F 매도 type=진입이탈 price=%s breachPct=%s netPct=%s",
          currentPrice.toFixed(0),
          String(STRATEGY_F_ENTRY_BREACH_PCT),
          netPct.toFixed(2),
        );
        return {
          shouldSell: true,
          reason: `전략F 손절 (진입 수준 이탈 현재가 ${currentPrice.toFixed(0)} < 진입가대비 ${STRATEGY_F_ENTRY_BREACH_PCT}% 이하)`,
        };
      }
    }

    // 3. VWAP 붕괴: 현재가 < VWAP_1m × (1 - VWAP_BUFFER_PCT/100) 또는 마감봉 종가 < VWAP_1m × (1 - VWAP_BUFFER_PCT/100)
    // [개선] VWAP 버퍼 추가
    // 목적: 일시적인 가격 하락(꼬리 달기, Under-shooting)에 대한 방어
    // 이유: 로그 분석 결과 VWAP와 정확히 같거나 약간 하회하는 일시적 하락으로 즉시 손절되는 문제 발생
    const candles1m = getCandles(market, 1);
    if (candles1m.length > 0) {
      const vwap1m = calcVwap(candles1m, STRATEGY_F_MIN_VWAP_CANDLES_1M);
      if (vwap1m > 0) {
        const vwapBreachPrice = vwap1m * (1 - STRATEGY_F_VWAP_BUFFER_PCT / 100);
        if (currentPrice < vwapBreachPrice) {
          logger.info(
            LOG_SOURCE,
            "[시그널] %s | 손절 (VWAP 붕괴) 현재가 %s < VWAP버퍼 %s (VWAP %s)",
            market,
            currentPrice.toFixed(0),
            vwapBreachPrice.toFixed(0),
            vwap1m.toFixed(0),
          );
          logger.info(
            LOG_SOURCE,
            "[BT] F 매도 type=VWAP붕괴 price=%s vwap1m=%s vwapBreach=%s bufferPct=%s netPct=%s",
            currentPrice.toFixed(0),
            vwap1m.toFixed(0),
            vwapBreachPrice.toFixed(0),
            String(STRATEGY_F_VWAP_BUFFER_PCT),
            netPct.toFixed(2),
          );
          return {
            shouldSell: true,
            reason: `전략F 손절 (VWAP 붕괴 현재가 ${currentPrice.toFixed(0)} < VWAP버퍼 ${vwapBreachPrice.toFixed(0)})`,
          };
        }
      }
      const volumes1m = volumesFromCandles(candles1m);
      const isCurrentCandleOpen =
        volumes1m.length > 1 && volumes1m[volumes1m.length - 1] === 0;
      const closedCandles = isCurrentCandleOpen
        ? candles1m.slice(0, -1)
        : candles1m;
      if (closedCandles.length > 0 && vwap1m > 0) {
        const vwapBreachPrice = vwap1m * (1 - STRATEGY_F_VWAP_BUFFER_PCT / 100);
        const lastClose = closedCandles[closedCandles.length - 1].trade_price;
        if (lastClose < vwapBreachPrice) {
          logger.info(
            LOG_SOURCE,
            "[시그널] %s | 손절 (VWAP 붕괴) 마감 종가 %s < VWAP버퍼 %s (VWAP %s)",
            market,
            lastClose.toFixed(0),
            vwapBreachPrice.toFixed(0),
            vwap1m.toFixed(0),
          );
          logger.info(
            LOG_SOURCE,
            "[BT] F 매도 type=VWAP붕괴(종가) close=%s vwap1m=%s vwapBreach=%s bufferPct=%s netPct=%s",
            lastClose.toFixed(0),
            vwap1m.toFixed(0),
            vwapBreachPrice.toFixed(0),
            String(STRATEGY_F_VWAP_BUFFER_PCT),
            netPct.toFixed(2),
          );
          return {
            shouldSell: true,
            reason: `전략F 손절 (VWAP 붕괴 종가 ${lastClose.toFixed(0)} < VWAP버퍼 ${vwapBreachPrice.toFixed(0)})`,
          };
        }
      }
    }

    // 4. 트레일링 스톱 (D 방식 — maxNetPct 기반, index.ts에서 공통 갱신)
    // [개선] 가변형 트레일링 스톱 도입
    // 목적: 높은 수익 구간에서 수익 보존 강화
    // 이유: 로그 분석 결과 최대 수익이 높을 때도 고정 오프셋으로 인해 수익이 많이 줄어드는 문제 발생
    if (position.maxNetPct >= STRATEGY_F_TRAILING_ACTIVATE_PCT) {
      // 최대 수익이 타이트닝 기준을 돌파하면 오프셋을 좁혀 수익을 더 타이트하게 보존
      const trailingOffset =
        position.maxNetPct >= STRATEGY_F_TRAILING_TIGHTEN_THRESHOLD
          ? STRATEGY_F_TRAILING_TIGHTEN_OFFSET
          : STRATEGY_F_TRAILING_OFFSET_PCT;
      const trailingDropPct = position.maxNetPct - netPct;
      if (trailingDropPct >= trailingOffset) {
        logger.info(
          LOG_SOURCE,
          "[시그널] %s | 트레일링 스톱 (고점 %s%% → 현재 %s%%, 오프셋 %s%%)",
          market,
          position.maxNetPct.toFixed(2),
          netPct.toFixed(2),
          trailingOffset.toFixed(1),
        );
        logger.info(
          LOG_SOURCE,
          "[BT] F 매도 type=트레일링 maxPct=%s curPct=%s offsetPct=%s tighten=%s",
          position.maxNetPct.toFixed(2),
          netPct.toFixed(2),
          String(trailingOffset),
          position.maxNetPct >= STRATEGY_F_TRAILING_TIGHTEN_THRESHOLD
            ? "Y"
            : "N",
        );
        return {
          shouldSell: true,
          reason: `전략F 트레일링 스톱 (고점 ${position.maxNetPct.toFixed(2)}% → 현재 ${netPct.toFixed(2)}%, 오프셋 ${trailingOffset.toFixed(1)}%)`,
        };
      }
    }

    // 5. 최대 보유 시간 초과
    const holdMin = (Date.now() - position.buyTime) / 60_000;
    if (holdMin >= STRATEGY_F_MAX_HOLD_MINUTES) {
      logger.info(
        LOG_SOURCE,
        "[시그널] %s | 시간초과 (보유 %s분, 순수익 %s%%)",
        market,
        holdMin.toFixed(1),
        netPct.toFixed(2),
      );
      logger.info(
        LOG_SOURCE,
        "[BT] F 매도 type=시간초과 holdMin=%s netPct=%s maxHold=%s",
        holdMin.toFixed(1),
        netPct.toFixed(2),
        String(STRATEGY_F_MAX_HOLD_MINUTES),
      );
      return {
        shouldSell: true,
        reason: `전략F 시간초과 (${holdMin.toFixed(1)}분, 순수익 ${netPct.toFixed(2)}%)`,
      };
    }

    return { shouldSell: false };
  } catch (e) {
    logger.error(
      LOG_SOURCE,
      "[오류] 전략F 매도 검토 중 예외: %s",
      (e as Error).message,
    );
    return { shouldSell: false };
  }
};
