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
  STRATEGY_F_RSI_UPPER,
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
  STRATEGY_F_RANGE_LOOKBACK,
  STRATEGY_F_RANGE_MAX_POSITION,
  STRATEGY_F_VWAP_BREACH_GRACE_SEC,
  COST_PCT,
} from "../config";
import type { BuySignalResult, SellSignalResult } from "./signal";
import type { BotPosition, UpbitCandle } from "../types";
import { logger } from "../logger";

const LOG_SOURCE = "strategyF";

/** [진단] 마켓별 현재 차단 조건 — C1~C8, 조건 변경 시에만 로그 */
const diagBlockedAt = new Map<string, string>();
/** [진단] 마켓별 마지막 진단 로그 시각 — C1~C3 경계 토글 노이즈 억제 */
const diagLastLogMs = new Map<string, number>();

/** 모든 조건 전환에 최소 간격 적용 — 1초 내 C3↔C5 등 반복 로그 방지 */
const DIAG_LOG_MIN_INTERVAL_MS = 30_000;

/** 조건 변경 시 1회 로그 후 null 반환 (checkBuySignalF early return용) */
const diagBlock = (
  market: string,
  code: string,
  fmt: string,
  ...args: (string | number)[]
): null => {
  const prev = diagBlockedAt.get(market) ?? "";
  if (prev === code) return null;

  const now = Date.now();
  const elapsed = now - (diagLastLogMs.get(market) ?? 0);

  diagBlockedAt.set(market, code);
  if (elapsed < DIAG_LOG_MIN_INTERVAL_MS) return null;

  diagLastLogMs.set(market, now);
  logger.info(LOG_SOURCE, fmt, market, ...args);
  return null;
};

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
 * 조건 C1~C8: 5mVWAP → 1mVWAP+EMA21 → 눌림목거리 → RSI → 양봉 → 거래량 → EMA터치 → EMA기울기
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
    if (lastClose5m <= vwap5m) {
      return diagBlock(
        market,
        "C1",
        "[진단] %s 차단→C1(5mVWAP) close5m=%s vwap5m=%s",
        lastClose5m.toFixed(0),
        vwap5m.toFixed(0),
      );
    }

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
    if (currentPrice <= vwap1m) {
      return diagBlock(
        market,
        "C2a",
        "[진단] %s 차단→C2a(VWAP1m) price=%s vwap1m=%s",
        currentPrice.toFixed(0),
        vwap1m.toFixed(0),
      );
    }

    const ema21 = calculateEMA(closedPrices, STRATEGY_F_EMA_PERIOD);
    if (currentPrice <= ema21) {
      return diagBlock(
        market,
        "C2b",
        "[진단] %s 차단→C2b(EMA21) price=%s ema21=%s",
        currentPrice.toFixed(0),
        ema21.toFixed(0),
      );
    }

    // [조건 3] 현재가 ≤ VWAP_1m × (1 + PROXIMITY_PCT/100) — 눌림목 위치
    // anchor를 vwap1m으로만 사용: EMA21은 실시간 갱신되어 가격 상승 시 자동으로
    // dist가 줄어드는 왜곡 발생. EMA21 근접 조건은 C2b가 이미 담당.
    const anchor = vwap1m;
    const proximityThreshold = anchor * (1 + STRATEGY_F_PROXIMITY_PCT / 100);
    if (currentPrice > proximityThreshold) {
      const distPct = ((currentPrice - anchor) / anchor * 100).toFixed(2);
      return diagBlock(
        market,
        "C3",
        "[진단] %s 차단→C3(눌림목이탈) price=%s anchor=%s dist=%s%% thr=%s%%",
        currentPrice.toFixed(0),
        anchor.toFixed(0),
        distPct,
        String(STRATEGY_F_PROXIMITY_PCT),
      );
    }

    // [조건 9] 레인지 위치 필터 — 최근 N봉 고저 레인지에서 현재가가 상단 X% 이상이면 차단
    // 목적: 박스권 상단에 올라간 뒤 뒤늦게 매수하는 패턴 방지
    // C3(VWAP 근접)과 역할 분리: C3은 VWAP 대비 거리, C9은 최근 가격 구조 내 위치
    if (closedCandles.length >= STRATEGY_F_RANGE_LOOKBACK) {
      const rangeCandles = closedCandles.slice(-STRATEGY_F_RANGE_LOOKBACK);
      const rangeHigh = Math.max(...rangeCandles.map((c) => c.high_price));
      const rangeLow = Math.min(...rangeCandles.map((c) => c.low_price));
      const rangeWidth = rangeHigh - rangeLow;
      if (rangeWidth > 0) {
        const rangePos = (currentPrice - rangeLow) / rangeWidth;
        if (rangePos > STRATEGY_F_RANGE_MAX_POSITION) {
          return diagBlock(
            market,
            "C9",
            "[진단] %s 차단→C9(레인지상단) pos=%s%% thr=%s%% high=%s low=%s",
            (rangePos * 100).toFixed(0),
            (STRATEGY_F_RANGE_MAX_POSITION * 100).toFixed(0),
            rangeHigh.toFixed(0),
            rangeLow.toFixed(0),
          );
        }
      }
    }

    // [조건 4] RSI 수준 조건 — 하한(RSI_CROSS) 이상 + 상한(RSI_UPPER) 미만
    // 하한: EMA21/VWAP 위에서 RSI<38은 사실상 불가능한 조합이므로 수준 조건으로 완화.
    // 상한: 이전봉 RSI가 RSI_UPPER(65) 이상이면 과열 구간으로 판단하여 진입 차단.
    //       눌림목 전략 특성상 RSI 65+ 구간은 이미 상승 끝 단계.
    const rsiPrices = closedPrices.slice(-(RSI_PERIOD + 2));
    const rsiPrev = calculateRSI(rsiPrices.slice(0, -1));
    const rsiCur = calculateRSI(rsiPrices);
    if (rsiCur < STRATEGY_F_RSI_CROSS || rsiCur >= STRATEGY_F_RSI_UPPER || rsiPrev >= STRATEGY_F_RSI_UPPER) {
      return diagBlock(
        market,
        "C4",
        "[진단] %s 차단→C4(RSI) rsi=%s thr=%s upper=%s",
        rsiCur.toFixed(1),
        String(STRATEGY_F_RSI_CROSS),
        String(STRATEGY_F_RSI_UPPER),
      );
    }

    // [조건 5] 마감봉 양봉: close > open. 반등 당김 시 FIRST_GREEN_ONLY면 직전봉 음봉/도지일 때만(첫 반등 양봉만)
    const lastClosed = closedCandles[closedCandles.length - 1];
    if (lastClosed.trade_price <= lastClosed.opening_price) {
      return diagBlock(
        market,
        "C5",
        "[진단] %s 차단→C5(양봉) close=%s open=%s",
        lastClosed.trade_price.toFixed(0),
        lastClosed.opening_price.toFixed(0),
      );
    }
    if (STRATEGY_F_FIRST_GREEN_ONLY && closedCandles.length >= 2) {
      const prevClosed = closedCandles[closedCandles.length - 2];
      if (prevClosed.trade_price > prevClosed.opening_price) {
        return diagBlock(
          market,
          "C5fg",
          "[진단] %s 차단→C5(첫양봉) 직전봉도 양봉 close=%s",
          prevClosed.trade_price.toFixed(0),
        );
      }
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
        return diagBlock(
          market,
          "C6",
          "[진단] %s 차단→C6(거래량) ratio=%s thr=%s",
          volumeRatio.toFixed(2),
          String(STRATEGY_F_VOLUME_RATIO_MIN),
        );
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
    if (!hasConfirmedBounce) {
      return diagBlock(
        market,
        "C7",
        "[진단] %s 차단→C7(EMA터치) window=%s봉 ema21=%s",
        String(STRATEGY_F_EMA_TOUCH_WINDOW),
        ema21.toFixed(0),
      );
    }

    // [v3.2.20260306] [조건 8] EMA21 기울기 필터
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
      if (emaSlopePct < STRATEGY_F_EMA_SLOPE_MIN_PCT) {
        return diagBlock(
          market,
          "C8",
          "[진단] %s 차단→C8(EMA기울기) slope=%s%%/봉 thr=%s",
          emaSlopePct.toFixed(4),
          String(STRATEGY_F_EMA_SLOPE_MIN_PCT),
        );
      }
    }

    // 거래량 비율 및 레인지 위치 계산 (로깅용)
    let volumeRatio = 0;
    if (volumes1m.length >= STRATEGY_F_VOLUME_AVG_PERIOD + 1) {
      const currentVolume = volumes1m[volumes1m.length - 1];
      volumeRatio = getVolumeRatio(
        currentVolume,
        volumes1m,
        STRATEGY_F_VOLUME_AVG_PERIOD,
      );
    }
    let rangePosLog = 0;
    if (closedCandles.length >= STRATEGY_F_RANGE_LOOKBACK) {
      const rc = closedCandles.slice(-STRATEGY_F_RANGE_LOOKBACK);
      const rh = Math.max(...rc.map((c) => c.high_price));
      const rl = Math.min(...rc.map((c) => c.low_price));
      const rw = rh - rl;
      if (rw > 0) rangePosLog = (currentPrice - rl) / rw;
    }

    diagBlockedAt.delete(market);
    diagLastLogMs.delete(market);

    const distPctBuyNum = ((currentPrice - anchor) / anchor) * 100;
    const distPctBuy = distPctBuyNum.toFixed(2);
    const proxTag = distPctBuyNum > 1.5 ? " [PROX확장]" : "";
    logger.info(
      LOG_SOURCE,
      "[시그널] %s | 매수 조건 충족%s | 가격 %s | VWAP1m %s (dist %s%%) | EMA21 %s (slope %s%%/봉) | RSI %s→%s | vol %s | 레인지 %s%%",
      market,
      proxTag,
      currentPrice.toFixed(0),
      vwap1m.toFixed(0),
      distPctBuy,
      ema21.toFixed(0),
      emaSlopePct.toFixed(4),
      rsiPrev.toFixed(1),
      rsiCur.toFixed(1),
      volumeRatio.toFixed(2),
      (rangePosLog * 100).toFixed(0),
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
          "[시그널] %s | 손절 (진입 수준 이탈) 현재가 %s < 진입가대비 %s%% 이하 (순수익 %s%%)",
          market,
          currentPrice.toFixed(0),
          STRATEGY_F_ENTRY_BREACH_PCT,
          netPct.toFixed(2),
        );
        return {
          shouldSell: true,
          reason: `전략F 손절 (진입 수준 이탈 현재가 ${currentPrice.toFixed(0)} < 진입가대비 ${STRATEGY_F_ENTRY_BREACH_PCT}% 이하)`,
        };
      }
    }

    // 3. VWAP 붕괴: 진입 120초 내 버퍼 2배 확대, 이후 기본 버퍼
    const candles1m = getCandles(market, 1);
    if (candles1m.length > 0) {
      const vwap1m = calcVwap(candles1m, STRATEGY_F_MIN_VWAP_CANDLES_1M);
      if (vwap1m > 0) {
        const holdSec = holdMs / 1000;
        const inGrace = holdSec < STRATEGY_F_VWAP_BREACH_GRACE_SEC;
        const effectiveBuffer = inGrace
          ? STRATEGY_F_VWAP_BUFFER_PCT * 2
          : STRATEGY_F_VWAP_BUFFER_PCT;
        const vwapBreachPrice = vwap1m * (1 - effectiveBuffer / 100);
        if (currentPrice < vwapBreachPrice) {
          logger.info(
            LOG_SOURCE,
            "[시그널] %s | 손절 (VWAP 붕괴) 현재가 %s < VWAP버퍼 %s (VWAP %s, 버퍼 %s%%, 순수익 %s%%)",
            market,
            currentPrice.toFixed(0),
            vwapBreachPrice.toFixed(0),
            vwap1m.toFixed(0),
            effectiveBuffer.toFixed(1),
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
        const holdSec = holdMs / 1000;
        const inGrace = holdSec < STRATEGY_F_VWAP_BREACH_GRACE_SEC;
        const effectiveBuffer = inGrace
          ? STRATEGY_F_VWAP_BUFFER_PCT * 2
          : STRATEGY_F_VWAP_BUFFER_PCT;
        const vwapBreachPrice = vwap1m * (1 - effectiveBuffer / 100);
        const lastClose = closedCandles[closedCandles.length - 1].trade_price;
        if (lastClose < vwapBreachPrice) {
          logger.info(
            LOG_SOURCE,
            "[시그널] %s | 손절 (VWAP 붕괴) 마감 종가 %s < VWAP버퍼 %s (VWAP %s, 버퍼 %s%%, 순수익 %s%%)",
            market,
            lastClose.toFixed(0),
            vwapBreachPrice.toFixed(0),
            vwap1m.toFixed(0),
            effectiveBuffer.toFixed(1),
            netPct.toFixed(2),
          );
          return {
            shouldSell: true,
            reason: `전략F 손절 (VWAP 붕괴 종가 ${lastClose.toFixed(0)} < VWAP버퍼 ${vwapBreachPrice.toFixed(0)})`,
          };
        }
      }
    }

    // 4. 트레일링 스톱 (가변형: 기본 0.5%, tighten 구간 0.3%)
    if (position.maxNetPct >= STRATEGY_F_TRAILING_ACTIVATE_PCT) {
      const trailingOffset =
        position.maxNetPct >= STRATEGY_F_TRAILING_TIGHTEN_THRESHOLD
          ? STRATEGY_F_TRAILING_TIGHTEN_OFFSET
          : STRATEGY_F_TRAILING_OFFSET_PCT;
      const trailingDropPct = position.maxNetPct - netPct;
      if (trailingDropPct >= trailingOffset) {
        const tighten = position.maxNetPct >= STRATEGY_F_TRAILING_TIGHTEN_THRESHOLD;
        logger.info(
          LOG_SOURCE,
          "[시그널] %s | 트레일링 스톱 (고점 %s%% → 현재 %s%%, 오프셋 %s%%%s)",
          market,
          position.maxNetPct.toFixed(2),
          netPct.toFixed(2),
          trailingOffset.toFixed(1),
          tighten ? " tighten" : "",
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
        "[시그널] %s | 시간초과 (보유 %s분, 순수익 %s%%, 고점 %s%%)",
        market,
        holdMin.toFixed(1),
        netPct.toFixed(2),
        position.maxNetPct.toFixed(2),
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
