import "dotenv/config";
import { getCandles as fetchCandles } from "./api/rest";
import {
  setCandles,
  getCandles,
  updateFromTicker,
  minuteStart,
} from "./data/candleWindow";
import { subscribeTicker, unsubscribeTicker } from "./ws/ticker";
import { selectTopMarkets } from "./strategy/selectMarkets";
import { checkSellSignal, getNetProfitPct } from "./strategy/signal";
import { checkBuySignalB } from "./strategy/strategyB";
import { checkBuySignalA, checkSellSignalA } from "./strategy/strategyA";
import { checkSellSignalB } from "./strategy/strategyB";
import { checkBuySignalC, checkSellSignalC } from "./strategy/strategyC";
import { checkBuySignalD, checkSellSignalD } from "./strategy/strategyD";
import { checkBuySignalE, checkSellSignalE } from "./strategy/strategyE";
import { checkBuySignalF, checkSellSignalF } from "./strategy/strategyF";
import { checkBuySignalT1, checkSellSignalT1 } from "./strategy/trend/strategyT1";
import { setCandles1h } from "./data/candleWindow1h";
import {
  executeMarketBuy,
  executeMarketSell,
  fetchVolume,
  fetchAvgBuyPrice,
} from "./execution/order";
import { executeMarketBuyT1 } from "./execution/orderT1";
import { calculateATR } from "./indicators";
import {
  CANDLE_WINDOW_SIZE,
  CANDLE_WINDOW_SIZE_5M,
  CANDLE_REFRESH_INTERVAL_MS,
  RE_SELECT_AFTER_NO_BUY_MINUTES,
  DAILY_MAX_LOSS_PCT,
  DAILY_LOSS_BUFFER_PCT,
  STRATEGY_B_TRAILING_ACTIVATE_PCT,
  STRATEGY_B_LOSS_COOLDOWN_MS,
  STRATEGY_B_LOSS_COOLDOWN_2ND_MS,
  STRATEGY_B_MAX_DAILY_LOSS_COUNT,
  STRATEGY_C_TRAILING_ACTIVATE_PCT,
  STRATEGY_C_LOSS_COOLDOWN_MS,
  STRATEGY_D_LOSS_COOLDOWN_MS,
  STRATEGY_D_MAX_DAILY_LOSS_COUNT,
  STRATEGY_F_COOLDOWN_MS,
  STRATEGY_F_LOSS_COOLDOWN_MS,
  STRATEGY_A_ENABLED,
  STRATEGY_B_ENABLED,
  STRATEGY_C_ENABLED,
  STRATEGY_D_ENABLED,
  STRATEGY_E_ENABLED,
  STRATEGY_F_ENABLED,
  STRATEGY_T1_ENABLED,
  CANDLE_WINDOW_SIZE_1H,
  STRATEGY_T1_TRAILING_ACTIVATE_PCT,
  STRATEGY_B_STOP_LOSS_PCT,
  STRATEGY_C_STOP_LOSS_PCT,
  STRATEGY_D_STOP_LOSS_PCT,
  STRATEGY_F_STOP_LOSS_PCT,
  STRATEGY_T1_STOP_LOSS_PCT,
} from "./config";
import { logger } from "./logger";
import { writeTradeLog, tradeLogPath } from "./tradeLogger";
import { getMarketRegime } from "./strategy/marketRegime";

const LOG_SOURCE = "index";
const ACCESS_KEY = process.env.ACCESS_KEY!;
const SECRET_KEY = process.env.SECRET_KEY!;

import type { BotPosition } from "./types";
type Position = BotPosition;

let position: Position | null = null;
let currentMarkets: string[] = [];
let isBuying = false;
let isSelling = false;

let dailyLossPct = 0;
let dailyTradeCount = 0;
let dailyProfitKrw = 0;
let totalCumulativePct = 0;
let totalCumulativeKrw = 0;
let totalTradeCount = 0;
/** 전략별 누적 수익률·수익액 (매도 시에만 갱신, 매매기록 error 로그용) */
const strategyCumulativePct: Record<string, number> = {};
const strategyCumulativeKrw: Record<string, number> = {};
let lastResetDate = new Date().toDateString();
let dailyLimitLogged = false;

/** 마지막으로 수신한 종목별 가격 (포지션 모니터링용) */
const lastPrices: Record<string, number> = {};

/**
 * [v3.6.20260317] 전략 B 손실 종목 쿨다운 (종목별 마지막 손실 거래 시각)
 * 손절 후 10분간 동일 종목 B 재진입 차단. 급락 중 골든크로스 연속 루프 방지.
 * 수집: "[쿨다운] 전략B 손실 종목 등록" 로그 빈도로 차단 효과 확인.
 *
 * [v3.7.20260318] strategyBLossCount와 연동해 단계별 쿨다운 시간 적용.
 *   1회: STRATEGY_B_LOSS_COOLDOWN_MS(10분)  ← 기존 동일
 *   2회: STRATEGY_B_LOSS_COOLDOWN_2ND_MS(60분)
 *   3회+: 당일 진입 금지 (strategyBLossCount >= STRATEGY_B_MAX_DAILY_LOSS_COUNT)
 */
const strategyBLossCooldown: Record<string, number> = {};
/**
 * [v3.7.20260318] 전략 B 당일 종목별 누적 손절 횟수
 * 일일 카운터 초기화(09:00 KST) 시 strategyBLossCooldown과 함께 초기화.
 * 수집: 카운트가 2 이상인 종목이 재선정되는 빈도 확인 → UPWARD_WEIGHT와 조합 효과 검증.
 */
const strategyBLossCount: Record<string, number> = {};
/** [v3.5.20260315] 전략 C 손실 종목 쿨다운 (종목별 마지막 손실 거래 시각) */
const strategyCLossCooldown: Record<string, number> = {};
/** 전략 C 쿨다운 차단 로그 쓰로틀 (종목별 마지막 로그 시각) */
const strategyCLossCooldownLastLog: Record<string, number> = {};
/** 전략 D 손실 종목 쿨다운 (종목별 마지막 손실 거래 시각) */
const lossCooldown: Record<string, number> = {};
/** 전략 D 쿨다운 차단 로그 쓰로틀 (종목별 마지막 로그 시각) */
const lossCooldownLastLog: Record<string, number> = {};
/**
 * 전략 D 당일 종목별 누적 손절 횟수
 * 일일 카운터 초기화(09:00 KST) 시 lossCooldown과 함께 초기화.
 * STRATEGY_D_MAX_DAILY_LOSS_COUNT 이상이면 당일 재진입 금지.
 */
const strategyDLossCount: Record<string, number> = {};
/** 전략 F 매도 종목 쿨다운 (종목별 F 매도 시각) */
const strategyFCooldown: Record<string, number> = {};
/** 전략 F 쿨다운 차단 로그 쓰로틀 (종목별 마지막 로그 시각) */
const strategyFCooldownLastLog: Record<string, number> = {};
/**
 * 전략 F 손실 종목 쿨다운 [2차 수정] — 손실 매도 후 15분 재진입 차단
 * 수익 매도는 기존 strategyFCooldown(5분)만 적용, 손실 매도는 두 쿨다운 모두 적용.
 */
const strategyFLossCooldown: Record<string, number> = {};

/** 레짐 차단 로그: 급락/쿨다운 구간에 진입했는지 (시작/종료만 로그용) */
let regimeBlockCrashingActive = false;
/** 레짐 차단 로그: 패닉 볼륨 구간에 진입했는지 (시작/종료만 로그용) */
let regimeBlockPanicVolumeActive = false;
/**
 * 레짐 차단 로그: BTC MA 하락 추세 구간 진입 여부 (시작/종료만 로그용)
 *
 * [수정 이유] BTC 5분봉 MA5 < MA20(하락 추세)일 때 매수 차단 로직 추가.
 *   기존 급락 감지(-2%)보다 완화된 기준으로, 완만한 하락 추세도 조기 차단.
 *   하락 추세 종목에 전략 무관 반복 매수 → 손절 남발 문제를 방어하기 위함.
 *
 * [역할] 상태 플래그로 중복 로그 방지
 *   false → true (하락 추세 진입 시): "[레짐 차단] BTC MA 하락 추세... (시작)" 1회
 *   true → false (하락 추세 해제 시): "[레짐 차단] BTC MA 하락 추세 해제 (종료)" 1회
 *
 * [앞으로 확인할 것]
 *   - 차단 빈도가 너무 높으면 config의 REGIME_BTC_MA_SLOW를 30~50으로 조정
 *   - 차단 구간과 실제 BTC 가격 흐름을 대조해 필터 적절성 검증
 */
let regimeBlockBearTrendActive = false;
/** bearTrend가 처음 감지된 시각. 해제 시 재선정 여부 판단용 (5분 미만 진동은 노이즈로 간주) */
let regimeBlockBearTrendStartTime = 0;

/** [대기] 로그: 직전에 출력한 상태(상황이 바뀔 때만 재출력) */
let lastWaitLogSnapshot: string | null = null;

/** 매매기록 PM2 error 로그용 KST 타임스탬프 */
const tradeLogTimestamp = (): string => {
  const d = new Date();
  const datePart = d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const timePart = d.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Seoul",
    hour12: false,
  });
  const ms = String(d.getUTCMilliseconds()).padStart(3, "0");
  return `${datePart} ${timePart}.${ms}`;
};

const resetDailyLossIfNewDay = (): void => {
  const today = new Date().toDateString();
  if (today !== lastResetDate) {
    dailyLossPct = 0;
    dailyTradeCount = 0;
    dailyProfitKrw = 0;
    dailyLimitLogged = false;
    lastResetDate = today;
    // [v3.7.20260318] 전략 B 당일 손절 카운터 및 쿨다운 초기화
    // 새 날짜 시작 시 전일 손절 횟수·쿨다운 모두 리셋 → 종목에 대해 당일 제한 없이 재시작.
    for (const k of Object.keys(strategyBLossCount)) delete strategyBLossCount[k];
    for (const k of Object.keys(strategyBLossCooldown)) delete strategyBLossCooldown[k];
    // 전략 D 당일 손절 카운터 및 쿨다운 초기화
    for (const k of Object.keys(strategyDLossCount)) delete strategyDLossCount[k];
    for (const k of Object.keys(lossCooldown)) delete lossCooldown[k];
    logger.info(LOG_SOURCE, "일일 카운터 초기화 (새 날짜: %s)", today);
  }
};

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

const printStartupBanner = (): void => {
  const line = "=".repeat(60);
  const now = new Date().toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  // stdout (out.log)
  console.log(line);
  console.log(`  🚀 CRYPTO AUTO TRADE BOT 기동`);
  console.log(`  시각: ${now} (KST)`);
  console.log(`  PID : ${process.pid}`);
  console.log(`  로그: ${tradeLogPath}`);
  console.log(line);
  // stderr (error.log) — 재기동 시 에러 로그에도 구분점이 보이도록
  console.error("");
  console.error("▼".repeat(60));
  console.error(`  ♻️  BOT 재기동 / 기동`);
  console.error(`  시각: ${now} (KST)`);
  console.error(`  PID : ${process.pid}`);
  console.error("▼".repeat(60));
};

const run = async (): Promise<void> => {
  printStartupBanner();

  if (!ACCESS_KEY || !SECRET_KEY) {
    logger.error(
      LOG_SOURCE,
      "치명적: ACCESS_KEY, SECRET_KEY가 .env에 설정되지 않았습니다.",
    );
    process.exit(1);
  }

  const selectAndLoad = async (): Promise<string[]> => {
    try {
      const [btcCandles1m, btcCandles5m] = await Promise.all([
        fetchCandles("KRW-BTC", CANDLE_WINDOW_SIZE, "minutes1"),
        fetchCandles("KRW-BTC", CANDLE_WINDOW_SIZE_5M, "minutes5"),
      ]);
      setCandles("KRW-BTC", btcCandles1m, 1);
      setCandles("KRW-BTC", btcCandles5m, 5);
    } catch (e) {
      logger.warn(
        LOG_SOURCE,
        "BTC 캔들 사전 적재 실패: %s",
        (e as Error).message,
      );
    }
    if (STRATEGY_T1_ENABLED) {
      try {
        const btcCandles1h = await fetchCandles("KRW-BTC", CANDLE_WINDOW_SIZE_1H, "minutes60");
        setCandles1h("KRW-BTC", btcCandles1h);
      } catch (e) {
        logger.warn(LOG_SOURCE, "BTC 1h 캔들 사전 적재 실패: %s", (e as Error).message);
      }
    }

    const markets = await selectTopMarkets();
    if (markets.length === 0) {
      logger.error(LOG_SOURCE, "치명적: 선정된 종목이 없습니다.");
      return [];
    }
    const marketsChanged =
      markets.length !== currentMarkets.length ||
      markets.some((m) => !currentMarkets.includes(m));
    if (marketsChanged) {
      logger.info(LOG_SOURCE, "종목 선정 (변경): %s", markets.join(", "));
    } else {
      logger.debug(LOG_SOURCE, "종목 선정 (유지): %s", markets.join(", "));
    }
    for (const market of markets) {
      const [candles1m, candles5m] = await Promise.all([
        fetchCandles(market, CANDLE_WINDOW_SIZE, "minutes1"),
        fetchCandles(market, CANDLE_WINDOW_SIZE_5M, "minutes5"),
      ]);
      setCandles(market, candles1m, 1);
      setCandles(market, candles5m, 5);
      if (STRATEGY_T1_ENABLED) {
        try {
          const candles1h = await fetchCandles(market, CANDLE_WINDOW_SIZE_1H, "minutes60");
          setCandles1h(market, candles1h);
        } catch (e) {
          logger.warn(LOG_SOURCE, "1h 캔들 사전 적재 실패 (%s): %s", market, (e as Error).message);
        }
      }
    }
    return markets;
  };

  currentMarkets = await selectAndLoad();
  if (currentMarkets.length === 0) process.exit(1);

  /** 마지막 종목 선정 시각 (재선정 주기 판단용) */
  let lastSelectTime = Date.now();

  /**
   * setInterval 중복 실행 방지 플래그.
   * setInterval은 이전 async 콜백이 끝나지 않아도 다음을 실행하므로,
   * REST 호출이 느릴 때(최대 10s×7건=70s) 두 번째 interval이 겹쳐
   * API 요청이 폭발적으로 증가해 429를 유발할 수 있음.
   */
  let isIntervalRunning = false;

  /** 주기: 캔들 REST 갱신(거래량 보정) + 포지션 상태 로그 + 매수 없을 때 N분 경과 시 종목 재선정 */
  setInterval(async () => {
    if (isIntervalRunning) return;
    isIntervalRunning = true;
    try {
      try {
        const [btcCandles1m, btcCandles5m] = await Promise.all([
          fetchCandles("KRW-BTC", CANDLE_WINDOW_SIZE, "minutes1"),
          fetchCandles("KRW-BTC", CANDLE_WINDOW_SIZE_5M, "minutes5"),
        ]);
        setCandles("KRW-BTC", btcCandles1m, 1);
        setCandles("KRW-BTC", btcCandles5m, 5);
      } catch (e) {
        logger.warn(LOG_SOURCE, "BTC 캔들 갱신 실패: %s", (e as Error).message);
      }
      if (STRATEGY_T1_ENABLED) {
        try {
          const btcCandles1h = await fetchCandles("KRW-BTC", CANDLE_WINDOW_SIZE_1H, "minutes60");
          setCandles1h("KRW-BTC", btcCandles1h);
        } catch (e) {
          logger.warn(LOG_SOURCE, "BTC 1h 캔들 갱신 실패: %s", (e as Error).message);
        }
      }

      for (const market of currentMarkets) {
        try {
          const candles = await fetchCandles(
            market,
            CANDLE_WINDOW_SIZE,
            "minutes1",
          );
          setCandles(market, candles, 1);
        } catch (e) {
          logger.warn(
            LOG_SOURCE,
            "캔들 갱신 실패 (%s): %s",
            market,
            (e as Error).message,
          );
        }
        if (STRATEGY_T1_ENABLED) {
          try {
            const candles1h = await fetchCandles(market, CANDLE_WINDOW_SIZE_1H, "minutes60");
            setCandles1h(market, candles1h);
          } catch (e) {
            logger.warn(LOG_SOURCE, "1h 캔들 갱신 실패 (%s): %s", market, (e as Error).message);
          }
        }
      }

      // ── 캔들 고가 기반 highestPrice 보정 ──────────────────────────
      // WebSocket 공백(재연결, 네트워크 단절 등) 중 틱을 수신하지 못한 경우
      // position.highestPrice 추적이 끊겨 트레일링 활성화를 놓칠 수 있음.
      // setInterval이 60초마다 1m 캔들을 REST로 갱신하므로, 캔들 고가로 보정.
      // 대상: B, C, T1 (trailingActivated + highestPrice 사용 전략)
      if (
        position &&
        (position.strategy === "B" ||
          position.strategy === "C" ||
          position.strategy === "T1")
      ) {
        const candles1m = getCandles(position.market, 1);
        // 매수한 분(minute)은 제외: 매수 직전 같은 분의 고가가 포함되면
        // 실제로 도달하지 않은 가격으로 trailingActivated가 오작동할 수 있음.
        // 매수 다음 분봉부터만 신뢰할 수 있는 고가로 간주.
        const nextMinuteAfterBuy = minuteStart(position.buyTime) + 60_000;
        const candlesSinceBuy = candles1m.filter(
          (c) => c.timestamp >= nextMinuteAfterBuy,
        );
        if (candlesSinceBuy.length > 0) {
          const candleHigh = Math.max(
            ...candlesSinceBuy.map((c) => c.high_price),
          );
          if (
            position.highestPrice == null ||
            candleHigh > position.highestPrice
          ) {
            position.highestPrice = candleHigh;
            const netPctAtHigh = getNetProfitPct(
              position.buyPrice,
              candleHigh,
            );
            const activatePct =
              position.strategy === "T1"
                ? STRATEGY_T1_TRAILING_ACTIVATE_PCT
                : position.strategy === "B"
                  ? STRATEGY_B_TRAILING_ACTIVATE_PCT
                  : STRATEGY_C_TRAILING_ACTIVATE_PCT;
            if (!position.trailingActivated && netPctAtHigh >= activatePct) {
              position.trailingActivated = true;
              logger.info(
                LOG_SOURCE,
                "[포지션 보정] %s 트레일링 활성화 (캔들 고가 보정): 고가 %s, 순수익 %s%%",
                position.market,
                candleHigh.toFixed(0),
                netPctAtHigh.toFixed(2),
              );
            }
          }
        }
      }

      // ── 캔들 저가 기반 손절 소급 보정 ──────────────────────────────────
      // WebSocket 공백 중 손절선을 일시 이탈했다가 회복한 경우, 틱 기반 손절이 누락됨.
      // 캔들 저가로 소급 확인해 손절 조건 충족 시 즉시 매도.
      // 대상: B, C, D, F, T1 (% 기반 단순 손절); A는 ATR 기반이라 소급 불가.
      if (position && !isSelling) {
        const stopLossPct =
          position.strategy === "T1" ? STRATEGY_T1_STOP_LOSS_PCT
          : position.strategy === "B" ? STRATEGY_B_STOP_LOSS_PCT
          : position.strategy === "C" ? STRATEGY_C_STOP_LOSS_PCT
          : position.strategy === "D" ? STRATEGY_D_STOP_LOSS_PCT
          : position.strategy === "F" ? STRATEGY_F_STOP_LOSS_PCT
          : null; // A: ATR 기반, 소급 불가

        if (stopLossPct != null) {
          const candles1mForStop = getCandles(position.market, 1);
          const nextMinuteAfterBuyStop = minuteStart(position.buyTime) + 60_000;
          const candlesSinceBuyStop = candles1mForStop.filter(
            (c) => c.timestamp >= nextMinuteAfterBuyStop,
          );
          if (candlesSinceBuyStop.length > 0) {
            const candleLow = Math.min(
              ...candlesSinceBuyStop.map((c) => c.low_price),
            );
            const netPctAtLow = getNetProfitPct(position.buyPrice, candleLow);
            if (netPctAtLow <= stopLossPct) {
              isSelling = true;
              const strategyTag = position.strategy ?? "legacy";
              const curPrice = lastPrices[position.market] ?? candleLow;
              logger.warn(
                LOG_SOURCE,
                "[손절 소급] [전략%s] %s 캔들 저가 %s 손절선 도달 (저가 순수익 %s%%, 기준 %s%%) — 현재가 %s로 매도",
                strategyTag,
                position.market,
                candleLow.toFixed(0),
                netPctAtLow.toFixed(2),
                String(stopLossPct),
                curPrice.toFixed(0),
              );
              try {
                const res = await executeMarketSell(
                  ACCESS_KEY,
                  SECRET_KEY,
                  position.market,
                  position.volume,
                );
                if (res.ok) {
                  const finalNetPct = getNetProfitPct(
                    position.buyPrice,
                    curPrice,
                  );
                  const tradeProfitKrw =
                    (finalNetPct / 100) *
                    (position.buyPrice * parseFloat(position.volume));
                  dailyLossPct += finalNetPct;
                  dailyProfitKrw += tradeProfitKrw;
                  dailyTradeCount += 1;
                  totalCumulativePct += finalNetPct;
                  totalCumulativeKrw += tradeProfitKrw;
                  totalTradeCount += 1;
                  strategyCumulativePct[strategyTag] =
                    (strategyCumulativePct[strategyTag] ?? 0) + finalNetPct;
                  strategyCumulativeKrw[strategyTag] =
                    (strategyCumulativeKrw[strategyTag] ?? 0) + tradeProfitKrw;
                  // 전략별 쿨다운 등록 (손절이므로 finalNetPct < 0 확정)
                  if (strategyTag === "B") {
                    strategyBLossCooldown[position.market] = Date.now();
                    strategyBLossCount[position.market] =
                      (strategyBLossCount[position.market] ?? 0) + 1;
                  }
                  if (strategyTag === "C") {
                    strategyCLossCooldown[position.market] = Date.now();
                  }
                  if (strategyTag === "D") {
                    lossCooldown[position.market] = Date.now();
                    strategyDLossCount[position.market] =
                      (strategyDLossCount[position.market] ?? 0) + 1;
                  }
                  if (strategyTag === "F") {
                    strategyFCooldown[position.market] = Date.now();
                    strategyFLossCooldown[position.market] = Date.now();
                  }
                  const tradeProfitStr =
                    tradeProfitKrw >= 0
                      ? `+${Math.round(tradeProfitKrw).toLocaleString()}원`
                      : `${Math.round(tradeProfitKrw).toLocaleString()}원`;
                  const dailyProfitStr2 =
                    dailyProfitKrw >= 0
                      ? `+${Math.round(dailyProfitKrw).toLocaleString()}원`
                      : `${Math.round(dailyProfitKrw).toLocaleString()}원`;
                  const totalProfitStr =
                    totalCumulativeKrw >= 0
                      ? `+${Math.round(totalCumulativeKrw).toLocaleString()}원`
                      : `${Math.round(totalCumulativeKrw).toLocaleString()}원`;
                  logger.info(
                    LOG_SOURCE,
                    "[매도] [전략%s] 체결(소급): %s 수량 %s | 순수익 %s% %s | 일일 누적 %s% %s | 오늘 %s회차",
                    strategyTag,
                    position.market,
                    position.volume,
                    finalNetPct.toFixed(2),
                    tradeProfitStr,
                    dailyLossPct.toFixed(2),
                    dailyProfitStr2,
                    String(dailyTradeCount),
                  );
                  const strategyParts = (
                    ["A", "B", "C", "D", "E", "F", "T1"] as const
                  )
                    .filter((s) => strategyCumulativePct[s] != null)
                    .map((s) => {
                      const pct = strategyCumulativePct[s];
                      const krw = strategyCumulativeKrw[s] ?? 0;
                      const krwStr =
                        krw >= 0
                          ? `+${Math.round(krw).toLocaleString()}원`
                          : `${Math.round(krw).toLocaleString()}원`;
                      return `${s}:${pct.toFixed(2)}% ${krwStr}`;
                    });
                  const strategyCumulativeStr =
                    strategyParts.length > 0
                      ? ` | 전략별 누적 ${strategyParts.join(" ")}`
                      : "";
                  const sellTradeLog = `${tradeLogTimestamp()} [매매기록] 매도(소급) | 전략${strategyTag} | ${position.market} | 수량 ${position.volume} | 순수익 ${finalNetPct.toFixed(2)}% ${tradeProfitStr} | 일일 누적 ${dailyLossPct.toFixed(2)}% ${dailyProfitStr2} (${dailyTradeCount}회) | 전체 누적 ${totalCumulativePct.toFixed(2)}% ${totalProfitStr} (${totalTradeCount}회)${strategyCumulativeStr}`;
                  console.error(sellTradeLog);
                  writeTradeLog(sellTradeLog);
                  position = null;
                  currentMarkets = await selectAndLoad();
                  if (currentMarkets.length === 0) {
                    logger.warn(
                      LOG_SOURCE,
                      "매도(소급) 후 종목 선정 없음, 30초 후 재시도...",
                    );
                    await sleep(30000);
                    currentMarkets = await selectAndLoad();
                  }
                  if (currentMarkets.length === 0) {
                    logger.error(
                      LOG_SOURCE,
                      "치명적: 재시도 후에도 종목 선정 실패. 프로세스 종료.",
                    );
                    process.exit(1);
                  }
                  lastSelectTime = Date.now();
                  subscribeTicker(
                    currentMarkets,
                    handleTicker,
                    "손절 소급 체결로 인한 종목 재선정(재연결)",
                  );
                } else {
                  logger.error(
                    LOG_SOURCE,
                    "[매도 소급] [전략%s] 실패: %s",
                    strategyTag,
                    res.message,
                  );
                }
              } catch (e) {
                logger.error(
                  LOG_SOURCE,
                  "[매도 소급] [전략%s] 실행 중 오류: %s",
                  strategyTag,
                  (e as Error).message,
                );
              } finally {
                isSelling = false;
              }
            }
          }
        }
      }

      if (!position) {
        const marketsStr = currentMarkets.join(", ");
        const dailyProfitStr =
          dailyProfitKrw >= 0
            ? `+${Math.round(dailyProfitKrw).toLocaleString()}원`
            : `${Math.round(dailyProfitKrw).toLocaleString()}원`;
        const waitSnapshot = `${marketsStr}|${dailyLossPct.toFixed(2)}|${dailyProfitStr}|${dailyTradeCount}`;
        if (lastWaitLogSnapshot !== waitSnapshot) {
          lastWaitLogSnapshot = waitSnapshot;
          logger.info(
            LOG_SOURCE,
            "[대기] 관심종목 %s | 일일 누적 %s% %s (%s회 매매)",
            marketsStr,
            dailyLossPct.toFixed(2),
            dailyProfitStr,
            String(dailyTradeCount),
          );
        }
      }

      if (
        position === null &&
        Date.now() - lastSelectTime >=
          RE_SELECT_AFTER_NO_BUY_MINUTES * 60 * 1000
      ) {
        // lastSelectTime 선행 갱신: selectAndLoad가 429로 실패해도 매분 재시도 방지
        lastSelectTime = Date.now();
        try {
          const next = await selectAndLoad();
          if (next.length > 0) {
            currentMarkets = next;
            subscribeTicker(
              currentMarkets,
              handleTicker,
              "매수 대기 시간 초과로 인한 종목 재선정(재연결)",
            );
            logger.info(
              LOG_SOURCE,
              "매수 없음 주기 경과, 종목 재선정: %s",
              currentMarkets.join(", "),
            );
          }
        } catch (e) {
          logger.warn(
            LOG_SOURCE,
            "주기 재선정 실패 (다음 주기에 재시도): %s",
            (e as Error).message,
          );
        }
      }
    } catch (e) {
      logger.error(LOG_SOURCE, "주기 작업 오류: %s", (e as Error).message);
    } finally {
      isIntervalRunning = false;
    }
  }, CANDLE_REFRESH_INTERVAL_MS);

  const handleTicker = async (data: {
    market?: string;
    code?: string;
    trade_price: number;
    trade_timestamp: number;
    trade_volume?: number;
  }): Promise<void> => {
    try {
      const market = (data.market ?? data.code) as string;
      if (!market) return;
      updateFromTicker(
        market,
        data.trade_price,
        data.trade_timestamp,
        data.trade_volume,
      );
      const price = data.trade_price;

      resetDailyLossIfNewDay();
      lastPrices[market] = price;

      if (position) {
        if (position.market !== market) return;
        if (isSelling) return;

        const curNetPct = getNetProfitPct(position.buyPrice, price);
        if (curNetPct > position.maxNetPct) {
          position.maxNetPct = curNetPct;
        }

        if (position.strategy === "C") {
          if (curNetPct >= STRATEGY_C_TRAILING_ACTIVATE_PCT) {
            position.trailingActivated = true;
            if (
              position.highestPrice == null ||
              price > position.highestPrice
            ) {
              position.highestPrice = price;
            }
          }
        }
        // [v3.5.20260315] 전략 B 트레일링 스톱 — 포지션 고점 추적
        // 검증 포인트: [BT] B 트레일링 활성화 로그가 +0.8% 근처에서 찍히는지, 이후 트레일링 매도로
        //   연결되는지 확인. 트레일링 vs RSI70 익절 vs 데드크로스 매도 비율을 로그로 비교 가능.
        if (position.strategy === "B") {
          if (curNetPct >= STRATEGY_B_TRAILING_ACTIVATE_PCT) {
            if (!position.trailingActivated) {
              // 최초 활성화 시 1회만 로그 — 이후 실제 트레일링 매도([BT] B 매도 type=트레일링)와 대조
              logger.info(
                LOG_SOURCE,
                "[BT] B 트레일링 활성화: %s 순수익 %s%% (기준 %s%%)",
                market,
                curNetPct.toFixed(2),
                String(STRATEGY_B_TRAILING_ACTIVATE_PCT),
              );
              position.trailingActivated = true;
            }
            if (
              position.highestPrice == null ||
              price > position.highestPrice
            ) {
              position.highestPrice = price;
            }
          }
        }
        if (position.strategy === "T1") {
          if (curNetPct >= STRATEGY_T1_TRAILING_ACTIVATE_PCT) {
            if (!position.trailingActivated) {
              logger.info(
                LOG_SOURCE,
                "[BT] T1 트레일링 활성화: %s 순수익 %s%% (기준 %s%%)",
                market,
                curNetPct.toFixed(2),
                String(STRATEGY_T1_TRAILING_ACTIVATE_PCT),
              );
              position.trailingActivated = true;
            }
            if (
              position.highestPrice == null ||
              price > position.highestPrice
            ) {
              position.highestPrice = price;
            }
          }
        }

        let sellSignal: {
          shouldSell: boolean;
          reason?: string;
          lastRsi?: number;
        };
        const regimeForSell = getMarketRegime();
        if (regimeForSell.crashing && curNetPct < 0) {
          logger.warn(
            LOG_SOURCE,
            "[긴급 청산] BTC 급락 중 손실 포지션 강제 청산: %s (순수익 %s%)",
            position.market,
            curNetPct.toFixed(2),
          );
          sellSignal = {
            shouldSell: true,
            reason: `BTC 급락 중 긴급 청산 (순수익 ${curNetPct.toFixed(2)}%)`,
          };
        } else if (position.strategy === "A") {
          sellSignal = checkSellSignalA(position.market, position, price);
        } else if (position.strategy === "B") {
          sellSignal = checkSellSignalB(position.market, position, price);
          if (typeof sellSignal.lastRsi === "number") {
            position.lastRsi = sellSignal.lastRsi;
          }
        } else if (position.strategy === "C") {
          sellSignal = checkSellSignalC(position.market, position, price);
        } else if (position.strategy === "D") {
          sellSignal = checkSellSignalD(position.market, position, price);
        } else if (position.strategy === "E") {
          sellSignal = checkSellSignalE(position.market, position, price);
        } else if (position.strategy === "F") {
          sellSignal = checkSellSignalF(position.market, position, price);
        } else if (position.strategy === "T1") {
          sellSignal = checkSellSignalT1(position.market, position, price);
        } else {
          sellSignal = checkSellSignal(
            position.market,
            position.buyPrice,
            price,
            { buyTime: position.buyTime, maxNetPct: position.maxNetPct },
          );
        }

        if (sellSignal.shouldSell) {
          isSelling = true;
          const strategyTag = position.strategy ?? "legacy";
          try {
            {
              const curPrice = lastPrices[position.market] ?? price;
              const netPct = getNetProfitPct(position.buyPrice, curPrice);
              const holdMin = (Date.now() - position.buyTime) / 60_000;
              logger.info(
                LOG_SOURCE,
                "[포지션] %s | 매수가 %s | 현재가 %s | 순수익 %s% | 최대 %s% | 보유 %s분",
                position.market,
                position.buyPrice.toFixed(0),
                curPrice.toFixed(0),
                netPct.toFixed(2),
                position.maxNetPct.toFixed(2),
                holdMin.toFixed(1),
              );
            }
            logger.info(
              LOG_SOURCE,
              "[매도] [전략%s] 신호: %s",
              strategyTag,
              sellSignal.reason,
            );
            const res = await executeMarketSell(
              ACCESS_KEY,
              SECRET_KEY,
              position.market,
              position.volume,
            );
            if (res.ok) {
              const finalNetPct = getNetProfitPct(position.buyPrice, price);
              const tradeProfitKrw =
                (finalNetPct / 100) *
                (position.buyPrice * parseFloat(position.volume));
              dailyLossPct += finalNetPct;
              dailyProfitKrw += tradeProfitKrw;
              dailyTradeCount += 1;
              totalCumulativePct += finalNetPct;
              totalCumulativeKrw += tradeProfitKrw;
              totalTradeCount += 1;
              strategyCumulativePct[strategyTag] =
                (strategyCumulativePct[strategyTag] ?? 0) + finalNetPct;
              strategyCumulativeKrw[strategyTag] =
                (strategyCumulativeKrw[strategyTag] ?? 0) + tradeProfitKrw;

              // [v3.6.20260317] 전략 B 손실 종목 쿨다운 등록
              // [v3.7.20260318] 손절 횟수 누적 카운트 추가 → 단계별 쿨다운 적용
              //   1회: 10분, 2회: 60분, 3회+: 당일 진입 금지 (일일 카운터 리셋까지)
              if (strategyTag === "B" && finalNetPct < 0) {
                strategyBLossCooldown[position.market] = Date.now();
                strategyBLossCount[position.market] =
                  (strategyBLossCount[position.market] ?? 0) + 1;
                const bCount = strategyBLossCount[position.market]!;
                const isDailyBlocked =
                  bCount >= STRATEGY_B_MAX_DAILY_LOSS_COUNT;
                const nextCooldownMin = isDailyBlocked
                  ? "당일 진입 금지"
                  : bCount >= 2
                    ? `${STRATEGY_B_LOSS_COOLDOWN_2ND_MS / 60_000}분`
                    : `${STRATEGY_B_LOSS_COOLDOWN_MS / 60_000}분`;
                logger.info(
                  LOG_SOURCE,
                  "[쿨다운] 전략B 손실 종목 등록: %s (순수익 %s%%, 누적 %s회 → 다음쿨다운 %s)",
                  position.market,
                  finalNetPct.toFixed(2),
                  String(bCount),
                  nextCooldownMin,
                );
              }
              // [v3.5.20260315] 전략 C 손실 종목 쿨다운 등록 — 손실 매도 후 30분 재진입 차단
              if (strategyTag === "C" && finalNetPct < 0) {
                strategyCLossCooldown[position.market] = Date.now();
                logger.info(
                  LOG_SOURCE,
                  "[쿨다운] 전략C 손실 종목 등록: %s (순수익 %s%%)",
                  position.market,
                  finalNetPct.toFixed(2),
                );
              }
              // 전략 D 손실 종목 쿨다운 등록
              if (strategyTag === "D" && finalNetPct < 0) {
                lossCooldown[position.market] = Date.now();
                strategyDLossCount[position.market] =
                  (strategyDLossCount[position.market] ?? 0) + 1;
                const dCount = strategyDLossCount[position.market]!;
                const isDDailyBlocked =
                  dCount >= STRATEGY_D_MAX_DAILY_LOSS_COUNT;
                logger.info(
                  LOG_SOURCE,
                  "[쿨다운] 전략D 손실 종목 등록: %s (순수익 %s%%, 누적 %s회 → %s)",
                  position.market,
                  finalNetPct.toFixed(2),
                  String(dCount),
                  isDDailyBlocked
                    ? "당일 진입 금지"
                    : `다음쿨다운 ${STRATEGY_D_LOSS_COOLDOWN_MS / 60_000}분`,
                );
              }
              // 전략 F 쿨다운 등록 [2차 수정]
              // - 기존: 손익 무관 단일 5분 쿨다운
              // - 변경: 수익→5분(재진입 허용), 손실→15분(재진입 차단) 이중 구조로 분리
              //   이유: 손실 후 5분만 지나면 동일 종목 재진입해 손실 반복되는 패턴 방지
              if (strategyTag === "F") {
                strategyFCooldown[position.market] = Date.now();
                logger.info(
                  LOG_SOURCE,
                  "[쿨다운] 전략F 종목 등록: %s",
                  position.market,
                );
                if (finalNetPct < 0) {
                  strategyFLossCooldown[position.market] = Date.now();
                  logger.info(
                    LOG_SOURCE,
                    "[쿨다운] 전략F 손실 종목 등록: %s (순수익 %s%%)",
                    position.market,
                    finalNetPct.toFixed(2),
                  );
                }
              }
              const tradeProfitStr =
                tradeProfitKrw >= 0
                  ? `+${Math.round(tradeProfitKrw).toLocaleString()}원`
                  : `${Math.round(tradeProfitKrw).toLocaleString()}원`;
              const dailyProfitStr =
                dailyProfitKrw >= 0
                  ? `+${Math.round(dailyProfitKrw).toLocaleString()}원`
                  : `${Math.round(dailyProfitKrw).toLocaleString()}원`;
              const totalProfitStr =
                totalCumulativeKrw >= 0
                  ? `+${Math.round(totalCumulativeKrw).toLocaleString()}원`
                  : `${Math.round(totalCumulativeKrw).toLocaleString()}원`;
              logger.info(
                LOG_SOURCE,
                "[매도] [전략%s] 체결: %s 수량 %s | 순수익 %s% %s | 일일 누적 %s% %s | 오늘 %s회차",
                strategyTag,
                position.market,
                position.volume,
                finalNetPct.toFixed(2),
                tradeProfitStr,
                dailyLossPct.toFixed(2),
                dailyProfitStr,
                String(dailyTradeCount),
              );
              const strategyParts = (["A", "B", "C", "D", "E", "F", "T1"] as const)
                .filter((s) => strategyCumulativePct[s] != null)
                .map((s) => {
                  const pct = strategyCumulativePct[s];
                  const krw = strategyCumulativeKrw[s] ?? 0;
                  const krwStr =
                    krw >= 0
                      ? `+${Math.round(krw).toLocaleString()}원`
                      : `${Math.round(krw).toLocaleString()}원`;
                  return `${s}:${pct.toFixed(2)}% ${krwStr}`;
                });
              const strategyCumulativeStr =
                strategyParts.length > 0
                  ? ` | 전략별 누적 ${strategyParts.join(" ")}`
                  : "";
              const sellTradeLog = `${tradeLogTimestamp()} [매매기록] 매도 | 전략${strategyTag} | ${position.market} | 수량 ${position.volume} | 순수익 ${finalNetPct.toFixed(2)}% ${tradeProfitStr} | 일일 누적 ${dailyLossPct.toFixed(2)}% ${dailyProfitStr} (${dailyTradeCount}회) | 전체 누적 ${totalCumulativePct.toFixed(2)}% ${totalProfitStr} (${totalTradeCount}회)${strategyCumulativeStr}`;
              console.error(sellTradeLog);
              writeTradeLog(sellTradeLog);
              position = null;
              currentMarkets = await selectAndLoad();
              if (currentMarkets.length === 0) {
                logger.warn(
                  LOG_SOURCE,
                  "매도 후 종목 선정 없음, 30초 후 재시도...",
                );
                await sleep(30000);
                currentMarkets = await selectAndLoad();
              }
              if (currentMarkets.length === 0) {
                logger.error(
                  LOG_SOURCE,
                  "치명적: 재시도 후에도 종목 선정 실패. 프로세스 종료.",
                );
                process.exit(1);
              }
              lastSelectTime = Date.now();
              subscribeTicker(
                currentMarkets,
                handleTicker,
                "매도 체결로 인한 종목 재선정(재연결)",
              );
            } else {
              logger.error(
                LOG_SOURCE,
                "[매도] [전략%s] 실패: %s",
                strategyTag,
                res.message,
              );
            }
          } catch (e) {
            logger.error(
              LOG_SOURCE,
              "[매도] [전략%s] 실행 중 오류: %s",
              strategyTag,
              (e as Error).message,
            );
          } finally {
            isSelling = false;
          }
        }
        return;
      }

      if (!currentMarkets.includes(market)) return;
      if (isBuying) return;

      // [v3.6.20260317] 일일 손실 한도 + 잔여 여력 버퍼 이중 체크
      // - 하드 한도: dailyLossPct <= DAILY_MAX_LOSS_PCT(-5%)
      // - 버퍼 체크: 잔여 여력이 DAILY_LOSS_BUFFER_PCT(1.5%p) 미만이면 추가 차단
      //   실질 차단선 = -5% + 1.5% = -3.5%
      //   이유: -4.90% 상태에서 진입 허용 → 손절 -1.61% → -6.51% 초과 사례 방지
      const remainingDailyPct = dailyLossPct - DAILY_MAX_LOSS_PCT;
      if (
        dailyLossPct <= DAILY_MAX_LOSS_PCT ||
        remainingDailyPct < DAILY_LOSS_BUFFER_PCT
      ) {
        if (!dailyLimitLogged) {
          if (dailyLossPct <= DAILY_MAX_LOSS_PCT) {
            logger.warn(
              LOG_SOURCE,
              "일일 최대 손실 한도 도달 (누적 %s%), 매수 중단",
              dailyLossPct.toFixed(2),
            );
          } else {
            logger.warn(
              LOG_SOURCE,
              "일일 잔여 여력 부족 (누적 %s%%, 잔여 %s%%p < 버퍼 %s%%), 매수 중단",
              dailyLossPct.toFixed(2),
              remainingDailyPct.toFixed(2),
              String(DAILY_LOSS_BUFFER_PCT),
            );
          }
          dailyLimitLogged = true;
        }
        return;
      }

      const regime = getMarketRegime();
      if (regime.crashing) {
        if (!regimeBlockCrashingActive) {
          regimeBlockCrashingActive = true;
          logger.warn(
            LOG_SOURCE,
            "[레짐 차단] BTC 급락/쿨다운 중, 전략 무관 매수 중단 (시작)",
          );
        }
        return;
      }
      if (regimeBlockCrashingActive) {
        regimeBlockCrashingActive = false;
        logger.warn(LOG_SOURCE, "[레짐 차단] BTC 급락/쿨다운 해제 (종료)");
      }
      if (regime.panicVolume) {
        if (!regimeBlockPanicVolumeActive) {
          regimeBlockPanicVolumeActive = true;
          logger.warn(
            LOG_SOURCE,
            "[레짐 차단] BTC 패닉 볼륨 감지, 전략 무관 매수 중단 (시작)",
          );
        }
        return;
      }
      if (regimeBlockPanicVolumeActive) {
        regimeBlockPanicVolumeActive = false;
        logger.warn(LOG_SOURCE, "[레짐 차단] BTC 패닉 볼륨 해제 (종료)");
      }
      // ── BTC MA 하락 추세 차단 ──────────────────────────────────────
      // [수정 이유] BTC 5분봉 MA5 < MA20이면 전체 매수 중단.
      //   기존 급락(-2%) 필터만으로는 완만한 하락 추세를 걸러내지 못해
      //   하락 중인 종목에 전략 A~F 모두 반복 진입 → 손절 반복.
      // [우선순위] crashing → panicVolume → bearTrend 순으로 체크.
      //   bearTrend는 가장 완화된 기준이므로 하드 차단(급락/패닉) 이후에 배치.
      // [T1 예외] T1은 BTC 1h EMA20/EMA50 추세를 자체적으로 확인하므로 bearTrend 면제.
      //   T1만 활성화된 경우(A~F 모두 비활성화) bearTrend에도 T1 신호 체크를 허용.
      //   A~F 중 하나라도 활성화되어 있으면 기존대로 전체 차단 유지.
      // [앞으로 확인할 것]
      //   로그에서 "(시작)/(종료)" 빈도를 보고 차단이 과도하면
      //   config.ts의 REGIME_BTC_MA_SLOW 값을 30~50으로 상향 조정.
      if (regime.bearTrend) {
        const onlyT1Active =
          STRATEGY_T1_ENABLED &&
          !STRATEGY_A_ENABLED &&
          !STRATEGY_B_ENABLED &&
          !STRATEGY_C_ENABLED &&
          !STRATEGY_D_ENABLED &&
          !STRATEGY_E_ENABLED &&
          !STRATEGY_F_ENABLED;
        if (!regimeBlockBearTrendActive) {
          regimeBlockBearTrendActive = true;
          regimeBlockBearTrendStartTime = Date.now();
          logger.debug(
            LOG_SOURCE,
            onlyT1Active
              ? "[레짐 차단] BTC MA 하락 추세 감지 (T1 전용 모드: 1h 자체 필터로 대체, 차단 제외)"
              : "[레짐 차단] BTC MA 하락 추세, 전략 무관 매수 중단 (시작)",
          );
        }
        if (!onlyT1Active) return;
      }
      if (regimeBlockBearTrendActive) {
        regimeBlockBearTrendActive = false;
        const bearTrendActiveDurationMs = Date.now() - regimeBlockBearTrendStartTime;
        logger.debug(LOG_SOURCE, "[레짐 차단] BTC MA 하락 추세 해제 (활성 %s분)", Math.floor(bearTrendActiveDurationMs / 60_000).toFixed(0));
        // [v3.7.20260318] 레짐 해제 시 즉시 종목 재선정
        //
        // [수정 이유]
        //   기존: bearTrend 해제 후 차단 직전 구독 종목을 그대로 유지.
        //   문제: 레짐 차단 기간(수 시간) 동안 기존 종목이 추가 하락해 있어도,
        //         해제 직후 해당 종목에서 기술적 신호(골든크로스 등)가 나오면 즉시 진입.
        //         (2026-03-17 08:41 해제 → 08:51 EDGE 진입 → 09:00 손절 -1.55%:
        //          차단 중 EDGE가 추가 하락했으나 재선정 없이 그대로 진입)
        //
        // [debounce] 5분 미만 활성은 노이즈로 간주해 재선정 생략.
        //   BTC MA5 ≈ MA20 구간에서 1분 단위로 true↔false 진동 시
        //   매분 selectAndLoad 호출(API 낭비 + 로그 폭증) 방지.
        //   5분 이상 지속된 추세 이탈만 실질적 하락 추세로 판단해 재선정.
        if (bearTrendActiveDurationMs < 5 * 60_000) {
          logger.info(
            LOG_SOURCE,
            "[레짐 해제] bearTrend %s분 활성 → 5분 미만 노이즈, 종목 재선정 생략",
            Math.floor(bearTrendActiveDurationMs / 60_000).toFixed(0),
          );
        }
        if (bearTrendActiveDurationMs >= 5 * 60_000) {
          const nextMarkets = await selectAndLoad();
          if (nextMarkets.length > 0) {
            currentMarkets = nextMarkets;
            lastSelectTime = Date.now();
            subscribeTicker(
              currentMarkets,
              handleTicker,
              "레짐해제 종목 재선정(재연결)",
            );
            logger.info(
              LOG_SOURCE,
              "[레짐 해제] 종목 재선정 완료: %s (bearTrend 활성 %s분)",
              currentMarkets.join(", "),
              Math.floor(bearTrendActiveDurationMs / 60_000).toFixed(0),
            );
          }
        }
        return; // 현재 틱 이벤트 종료, 다음 틱부터 정상 처리
      }

      // ── 전략별 매수 신호 검사 ──────────────────────────────────────
      // [수정 이유] 6개 전략이 동시 운용되며 같은 종목에 중복 진입하는 문제.
      //   (KAVA에 전략 D·F 동일 종목 동일 날 4회 진입 등)
      //   각 전략에 ENABLED 플래그를 추가해 코드 수정 없이 즉시 비활성화 가능.
      // [우선순위] F → A → B → C → D → E 순으로 하나만 진입.
      //   앞 전략이 신호를 내면 뒤 전략은 체크 생략 (단기 스캘핑에서 중복 포지션 방지).
      // [앞으로 확인할 것]
      //   - 성과가 좋은 전략만 남기고 나머지는 false로 전환
      //   - false로 바꿔도 이미 진입한 포지션의 매도 로직에는 영향 없음
      //   - 전략 우선순위 변경 이유(v3.8): F가 로그상 유일하게 꾸준히 양수 수익을 기록.
      //     F를 1순위로 올려 B/C/D 신호와 겹칠 때 F가 우선 진입하도록 변경.
      //     추후 백데이터로 F 자체 우위인지, B/C/D 타이밍을 뒤집어쓴 효과인지 검증 필요.

      // 전략 F 쿨다운 체크 후 F 매수 신호 검사 (1순위)
      // [2차 수정] 이중 쿨다운 체크
      // - winCooldown: 수익/손실 무관 5분 (빠른 재진입 허용)
      // - lossCooldown: 손실 후 15분 (반복 손실 방지)
      // 손실 매도 시 두 쿨다운이 모두 등록되므로 15분이 사실상 우선 적용됨
      let buyF: ReturnType<typeof checkBuySignalF> = null;
      if (STRATEGY_F_ENABLED) {
        const fWinCooldownTime = strategyFCooldown[market];
        const fLossCooldownTime = strategyFLossCooldown[market];
        const winBlocked =
          !!fWinCooldownTime &&
          Date.now() - fWinCooldownTime < STRATEGY_F_COOLDOWN_MS;
        const lossBlocked =
          !!fLossCooldownTime &&
          Date.now() - fLossCooldownTime < STRATEGY_F_LOSS_COOLDOWN_MS;

        if (winBlocked || lossBlocked) {
          // 쿨다운 중 — 진입 차단 (만료 시 아래 else에서 로그)
        } else {
          // 만료된 쿨다운 맵에서 정리
          if (fWinCooldownTime) {
            delete strategyFCooldown[market];
            delete strategyFCooldownLastLog[market];
          }
          if (fLossCooldownTime) {
            delete strategyFLossCooldown[market];
          }
          buyF = checkBuySignalF(market, price);
        }
      }

      const buyA =
        buyF?.shouldBuy || !STRATEGY_A_ENABLED
          ? null
          : checkBuySignalA(market, price);

      // [v3.6.20260317] 전략 B 쿨다운 체크 — 손실 매도 후 재진입 차단
      // [v3.7.20260318] 단계별 쿨다운: 1회(10분) → 2회(60분) → 3회+(당일 금지)
      // 만료 시 "[BT] B 쿨다운 만료" 로그에 횟수 포함 → 어느 단계 쿨다운이 만료됐는지 추적.
      let buyB = null;
      if (STRATEGY_B_ENABLED && !(buyF?.shouldBuy || buyA?.shouldBuy)) {
        const bCooldownTime = strategyBLossCooldown[market];
        const bLossCount = strategyBLossCount[market] ?? 0;
        // 당일 진입 금지 체크 (3회 이상 손절)
        const isBDailyBlocked =
          bLossCount >= STRATEGY_B_MAX_DAILY_LOSS_COUNT;
        // 단계별 쿨다운 시간: 1회=10분, 2회=60분 (3회+는 위 당일금지로 처리)
        const bCooldownMs =
          bLossCount >= 2
            ? STRATEGY_B_LOSS_COOLDOWN_2ND_MS
            : STRATEGY_B_LOSS_COOLDOWN_MS;
        const isBCooldownActive =
          !isBDailyBlocked &&
          !!bCooldownTime &&
          Date.now() - bCooldownTime < bCooldownMs;

        if (isBDailyBlocked || isBCooldownActive) {
          // 차단 중 — 진입 스킵 (만료 시 아래 else에서 로그)
        } else {
          if (bCooldownTime) {
            logger.info(
              LOG_SOURCE,
              "[BT] B 쿨다운 만료 재진입 허용: %s (누적손절 %s회, %s분 경과)",
              market,
              String(bLossCount),
              Math.floor((Date.now() - bCooldownTime) / 60_000).toFixed(0),
            );
            delete strategyBLossCooldown[market];
          }
          buyB = checkBuySignalB(market, price);
        }
      }

      // [v3.5.20260315] 전략 C 쿨다운 체크 — 손실 매도 후 30분 재진입 차단
      let buyC = null;
      if (
        STRATEGY_C_ENABLED &&
        !(buyF?.shouldBuy || buyA?.shouldBuy || buyB?.shouldBuy)
      ) {
        const cCooldownTime = strategyCLossCooldown[market];
        if (
          cCooldownTime &&
          Date.now() - cCooldownTime < STRATEGY_C_LOSS_COOLDOWN_MS
        ) {
        } else {
          // 쿨다운 만료 시 맵에서 제거 후 재진입 허용 — [BT] 로그로 쿨다운 효과 검증 가능
          if (cCooldownTime) {
            logger.info(
              LOG_SOURCE,
              "[BT] C 쿨다운 만료 재진입 허용: %s",
              market,
            );
            delete strategyCLossCooldown[market];
            delete strategyCLossCooldownLastLog[market];
          }
          buyC = checkBuySignalC(market, price);
        }
      }

      // 전략 D 쿨다운 체크
      // [v3.11] 당일 손절 횟수 기반 블랙리스트 추가 — 전략 B 패턴과 동일.
      //   STRATEGY_D_MAX_DAILY_LOSS_COUNT(2회) 이상 손절 시 당일 재진입 금지.
      let buyD = null;
      if (
        STRATEGY_D_ENABLED &&
        !(buyF?.shouldBuy || buyA?.shouldBuy || buyB?.shouldBuy || buyC?.shouldBuy)
      ) {
        const dLossCount = strategyDLossCount[market] ?? 0;
        const isDDailyBlocked = dLossCount >= STRATEGY_D_MAX_DAILY_LOSS_COUNT;
        const cooldownTime = lossCooldown[market];
        const isCooldownActive =
          !isDDailyBlocked &&
          !!cooldownTime &&
          Date.now() - cooldownTime < STRATEGY_D_LOSS_COOLDOWN_MS;
        if (isDDailyBlocked || isCooldownActive) {
          // 당일 금지 또는 쿨다운 중 — 전환 시점에만 1회 로그 (매 틱 스팸 방지)
          const lastLog = lossCooldownLastLog[market] ?? 0;
          if (Date.now() - lastLog > 60_000) {
            lossCooldownLastLog[market] = Date.now();
            logger.info(
              LOG_SOURCE,
              "[BT] D 매수 스킵 %s: %s (누적손절 %s회)",
              isDDailyBlocked ? "당일진입금지" : "쿨다운",
              market,
              String(dLossCount),
            );
          }
        } else {
          // 쿨다운 만료 시 재진입 허용 — 만료 시점 1회 로그
          if (cooldownTime) {
            logger.info(
              LOG_SOURCE,
              "[BT] D 쿨다운 만료 재진입 허용: %s (누적손절 %s회, %s분 경과)",
              market,
              String(dLossCount),
              Math.floor((Date.now() - cooldownTime) / 60_000).toFixed(0),
            );
            delete lossCooldown[market];
            delete lossCooldownLastLog[market];
          }
          buyD = checkBuySignalD(market, price);
        }
      }
      const buyE =
        buyF?.shouldBuy ||
        buyA?.shouldBuy ||
        buyB?.shouldBuy ||
        buyC?.shouldBuy ||
        buyD?.shouldBuy ||
        !STRATEGY_E_ENABLED
          ? null
          : checkBuySignalE(market, price);

      const buyT1 =
        buyF?.shouldBuy ||
        buyA?.shouldBuy ||
        buyB?.shouldBuy ||
        buyC?.shouldBuy ||
        buyD?.shouldBuy ||
        buyE?.shouldBuy ||
        !STRATEGY_T1_ENABLED
          ? null
          : checkBuySignalT1(market, price);

      const buySignal = buyF ?? buyA ?? buyB ?? buyC ?? buyD ?? buyE ?? buyT1;
      if (!buySignal?.shouldBuy) return;
      isBuying = true;
      const strategy = buySignal.strategy ?? undefined;
      try {
        logger.info(
          LOG_SOURCE,
          "[매수] [전략%s] 신호: %s | %s 원",
          strategy ?? "legacy",
          buySignal.reason,
          price.toFixed(0),
        );
        const res =
          strategy === "T1"
            ? await executeMarketBuyT1(ACCESS_KEY, SECRET_KEY, market)
            : await executeMarketBuy(ACCESS_KEY, SECRET_KEY, market);
        if (res.ok && res.order) {
          /**
           * ──────────────────────────────────────────────────────────────
           * [v3.5.20260315] 매수 후 수량 0 포지션 잠금 방지
           *
           * [수정 이유]
           *   기존 코드: fetchVolume 2회 재조회 후 여전히 0이어도 경고 로그만 찍고
           *   volume="0" 상태로 포지션을 생성. 이후 매도 신호 발생 시
           *   executeMarketSell(volume:"0") → order.ts에서 "매도 수량 0" 반환(ok:false) →
           *   오류 로그만 출력하고 포지션 유지 → 다음 틱에서 동일 반복 → 영구 잠금.
           *   봇 재기동 없이는 해제 불가 (실제 코인은 계좌에 있으나 매도 불가 상태).
           *
           * [변경 내용]
           *   1. 재조회 1차(300ms), 2차(1000ms): 총 3회 시도로 확장
           *      (업비트 API 반영 지연이 최대 1~2초 수준인 점을 감안)
           *   2. 3회 후에도 0이면 → error 로그 + return으로 포지션 생성 자체를 중단
           *      (코인은 계좌에 존재하므로 수동 매도 필요 — 로그에 안내 포함)
           *
           * [주의]
           *   이 return은 finally { isBuying = false } 를 거쳐 정상 종료됨.
           *   포지션이 생성되지 않으므로 다음 매수 신호는 정상적으로 처리됨.
           *   단, 실제로 매수된 코인이 계좌에 있으므로 Upbit 앱에서 수동 매도 필요.
           *
           * [앞으로 확인할 것]
           *   - "[매수] ... 수량 확인 실패" error 로그 빈도 모니터링.
           *   - 로그가 자주 발생하면 대기 시간을 추가하거나 재조회 횟수 증가 검토.
           * ──────────────────────────────────────────────────────────────
           */
          let vol = await fetchVolume(ACCESS_KEY, SECRET_KEY, market);
          if (parseFloat(vol) <= 0) {
            await sleep(300);
            vol = await fetchVolume(ACCESS_KEY, SECRET_KEY, market);
          }
          if (parseFloat(vol) <= 0) {
            await sleep(1000);
            vol = await fetchVolume(ACCESS_KEY, SECRET_KEY, market);
          }
          if (parseFloat(vol) <= 0) {
            logger.error(
              LOG_SOURCE,
              "[매수] [전략%s] 체결 후 보유 수량 확인 실패: %s — 포지션 미등록. Upbit 앱에서 수동 매도 필요.",
              strategy ?? "legacy",
              market,
            );
            return;
          }
          const avgBuyPrice = await fetchAvgBuyPrice(
            ACCESS_KEY,
            SECRET_KEY,
            market,
          );
          // avgBuyPrice 신뢰성 검증: 신호가 대비 10% 초과 괴리는 이전 세션 잔량 혼입으로
          // 판단해 신호가를 사용. (예: 이전 세션에서 838원에 산 FLOW가 계좌에 잔존하면
          // avg_buy_price가 838로 반환되어 손절 오트리거 및 P&L 오염 발생)
          const AVG_PRICE_SANITY_PCT = 10;
          const isSane =
            avgBuyPrice > 0 &&
            Math.abs(avgBuyPrice - price) / price <= AVG_PRICE_SANITY_PCT / 100;
          const buyPriceForPosition = isSane ? avgBuyPrice : price;
          logger.info(
            LOG_SOURCE,
            "[매수] [전략%s] 체결: %s | %s 원 %s",
            strategy ?? "legacy",
            market,
            buyPriceForPosition.toFixed(0),
            isSane && avgBuyPrice > 0
              ? "(체결평균가)"
              : avgBuyPrice > 0
                ? `(신호가 — avgBuyPrice ${avgBuyPrice.toFixed(0)}원 괴리 과다)`
                : "(신호가)",
          );
          const dailyStrBuy =
            dailyProfitKrw >= 0
              ? `+${Math.round(dailyProfitKrw).toLocaleString()}원`
              : `${Math.round(dailyProfitKrw).toLocaleString()}원`;
          const totalStrBuy =
            totalCumulativeKrw >= 0
              ? `+${Math.round(totalCumulativeKrw).toLocaleString()}원`
              : `${Math.round(totalCumulativeKrw).toLocaleString()}원`;
          const buyTradeLog = `${tradeLogTimestamp()} [매매기록] 매수 | 전략${strategy ?? "legacy"} | ${market} | ${buyPriceForPosition.toFixed(0)} 원 | 일일 누적 ${dailyLossPct.toFixed(2)}% ${dailyStrBuy} (${dailyTradeCount}회) | 전체 누적 ${totalCumulativePct.toFixed(2)}% ${totalStrBuy} (${totalTradeCount}회)`;
          console.error(buyTradeLog);
          writeTradeLog(buyTradeLog);

          const buyTimeMs = Date.now();
          let entryLow: number | undefined;
          let entryAtr: number | undefined;
          if (strategy === "A" || strategy === "F") {
            const candles1m = getCandles(market, 1);
            const entryMinuteStart = minuteStart(buyTimeMs);
            const entryCandle = candles1m.find(
              (c) => c.timestamp === entryMinuteStart,
            );
            if (entryCandle) entryLow = entryCandle.low_price;
            if (strategy === "A" && candles1m.length >= 15) {
              const highs = candles1m.slice(-15).map((c) => c.high_price);
              const lows = candles1m.slice(-15).map((c) => c.low_price);
              const closes = candles1m.slice(-15).map((c) => c.trade_price);
              entryAtr = calculateATR(highs, lows, closes);
            }
          }

          position = {
            market,
            buyPrice: buyPriceForPosition,
            volume: vol,
            buyTime: buyTimeMs,
            maxNetPct: 0,
            strategy,
            entryLow,
            entryAtr,
            highestPrice:
              strategy === "C" || strategy === "B" || strategy === "T1" ? price : undefined,
            trailingActivated:
              strategy === "C" || strategy === "B" || strategy === "T1" ? false : undefined,
          };
          logger.info(
            LOG_SOURCE,
            "[포지션] %s | 매수가 %s | 현재가 %s | 순수익 %s% | 최대 %s% | 보유 %s분",
            market,
            buyPriceForPosition.toFixed(0),
            price.toFixed(0),
            getNetProfitPct(buyPriceForPosition, price).toFixed(2),
            (0).toFixed(2),
            (0).toFixed(1),
          );
          currentMarkets = [market];
          unsubscribeTicker("매수 체결로 인한 종목 구독 해제");
          subscribeTicker(
            [market],
            handleTicker,
            "매수 체결로 매수 종목만 티커 구독(재연결)",
          );
        } else {
          logger.error(
            LOG_SOURCE,
            "[매수] [전략%s] 실패: %s",
            strategy ?? "legacy",
            res.message,
          );
        }
      } catch (e) {
        logger.error(
          LOG_SOURCE,
          "[매수] [전략%s] 실행 중 오류: %s",
          strategy ?? "legacy",
          (e as Error).message,
        );
      } finally {
        isBuying = false;
      }
    } catch (e) {
      logger.error(
        LOG_SOURCE,
        "[오류] 티커 처리 중 예외: %s",
        (e as Error).message,
      );
    }
  };

  subscribeTicker(currentMarkets, handleTicker);
  logger.info(
    LOG_SOURCE,
    "봇 기동 완료. WebSocket 구독: %s",
    currentMarkets.join(", "),
  );
};

const printShutdownBanner = (reason: string): void => {
  const line = "=".repeat(60);
  const now = new Date().toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  console.error(line);
  console.error(`  ⛔ CRYPTO AUTO TRADE BOT 종료`);
  console.error(`  사유: ${reason}`);
  console.error(`  시각: ${now} (KST)`);
  console.error(`  PID : ${process.pid}`);
  console.error(line);
};

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    printShutdownBanner(`시그널(${sig}) 수신`);
    process.exit(0);
  });
}

run().catch((e) => {
  logger.error(LOG_SOURCE, "치명적: %s", (e as Error).message);
  printShutdownBanner(`치명적 오류: ${(e as Error).message}`);
  process.exit(1);
});
