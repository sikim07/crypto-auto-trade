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
import {
  executeMarketBuy,
  executeMarketSell,
  fetchVolume,
  fetchAvgBuyPrice,
} from "./execution/order";
import { calculateATR } from "./indicators";
import {
  CANDLE_WINDOW_SIZE,
  CANDLE_WINDOW_SIZE_5M,
  CANDLE_REFRESH_INTERVAL_MS,
  RE_SELECT_AFTER_NO_BUY_MINUTES,
  DAILY_MAX_LOSS_PCT,
  STRATEGY_C_TRAILING_ACTIVATE_PCT,
  STRATEGY_D_LOSS_COOLDOWN_MS,
} from "./config";
import { logger } from "./logger";
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

/** 전략 D 손실 종목 쿨다운 (종목별 마지막 손실 거래 시각) */
const lossCooldown: Record<string, number> = {};

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
    logger.info(LOG_SOURCE, "일일 카운터 초기화 (새 날짜: %s)", today);
  }
};

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

const run = async (): Promise<void> => {
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

    const markets = await selectTopMarkets();
    if (markets.length === 0) {
      logger.error(LOG_SOURCE, "치명적: 선정된 종목이 없습니다.");
      return [];
    }
    logger.info(LOG_SOURCE, "종목 선정: %s", markets.join(", "));
    for (const market of markets) {
      const [candles1m, candles5m] = await Promise.all([
        fetchCandles(market, CANDLE_WINDOW_SIZE, "minutes1"),
        fetchCandles(market, CANDLE_WINDOW_SIZE_5M, "minutes5"),
      ]);
      setCandles(market, candles1m, 1);
      setCandles(market, candles5m, 5);
    }
    return markets;
  };

  currentMarkets = await selectAndLoad();
  if (currentMarkets.length === 0) process.exit(1);

  /** 마지막 종목 선정 시각 (재선정 주기 판단용) */
  let lastSelectTime = Date.now();

  /** 주기: 캔들 REST 갱신(거래량 보정) + 포지션 상태 로그 + 매수 없을 때 N분 경과 시 종목 재선정 */
  setInterval(async () => {
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
      }

      if (position) {
        const curPrice = lastPrices[position.market];
        if (curPrice) {
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
      } else {
        const dailyProfitStr =
          dailyProfitKrw >= 0
            ? `+${Math.round(dailyProfitKrw).toLocaleString()}원`
            : `${Math.round(dailyProfitKrw).toLocaleString()}원`;
        logger.info(
          LOG_SOURCE,
          "[대기] 관심종목 %s | 일일 누적 %s% %s (%s회 매매)",
          currentMarkets.join(", "),
          dailyLossPct.toFixed(2),
          dailyProfitStr,
          String(dailyTradeCount),
        );
      }

      if (
        position === null &&
        Date.now() - lastSelectTime >=
          RE_SELECT_AFTER_NO_BUY_MINUTES * 60 * 1000
      ) {
        const next = await selectAndLoad();
        if (next.length > 0) {
          currentMarkets = next;
          lastSelectTime = Date.now();
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
      }
    } catch (e) {
      logger.error(LOG_SOURCE, "주기 작업 오류: %s", (e as Error).message);
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

              // 전략 D 손실 종목 쿨다운 등록
              if (strategyTag === "D" && finalNetPct < 0) {
                lossCooldown[position.market] = Date.now();
                logger.info(
                  LOG_SOURCE,
                  "[쿨다운] 전략D 손실 종목 등록: %s (순수익 %s%%)",
                  position.market,
                  finalNetPct.toFixed(2),
                );
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
              const strategyParts = (["A", "B", "C", "D", "E"] as const)
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
              console.error(
                `${tradeLogTimestamp()} [매매기록] 매도 | 전략${strategyTag} | ${position.market} | 수량 ${position.volume} | 순수익 ${finalNetPct.toFixed(2)}% ${tradeProfitStr} | 일일 누적 ${dailyLossPct.toFixed(2)}% ${dailyProfitStr} (${dailyTradeCount}회) | 전체 누적 ${totalCumulativePct.toFixed(2)}% ${totalProfitStr} (${totalTradeCount}회)${strategyCumulativeStr}`,
              );
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

      if (dailyLossPct <= DAILY_MAX_LOSS_PCT) {
        if (!dailyLimitLogged) {
          logger.warn(
            LOG_SOURCE,
            "일일 최대 손실 한도 도달 (누적 %s%), 매수 중단",
            dailyLossPct.toFixed(2),
          );
          dailyLimitLogged = true;
        }
        return;
      }

      const regime = getMarketRegime();
      if (regime.crashing) {
        logger.warn(
          LOG_SOURCE,
          "[레짐 차단] BTC 급락/쿨다운 중, 전략 무관 매수 중단",
        );
        return;
      }
      if (regime.panicVolume) {
        logger.warn(
          LOG_SOURCE,
          "[레짐 차단] BTC 패닉 볼륨 감지, 전략 무관 매수 중단",
        );
        return;
      }

      const buyB = checkBuySignalB(market, price);
      const buyA = buyB?.shouldBuy ? null : checkBuySignalA(market, price);
      const buyC =
        buyB?.shouldBuy || buyA?.shouldBuy
          ? null
          : checkBuySignalC(market, price);

      // 전략 D 쿨다운 체크
      let buyD = null;
      if (!(buyB?.shouldBuy || buyA?.shouldBuy || buyC?.shouldBuy)) {
        const cooldownTime = lossCooldown[market];
        if (
          cooldownTime &&
          Date.now() - cooldownTime < STRATEGY_D_LOSS_COOLDOWN_MS
        ) {
          const remainingMin = Math.ceil(
            (STRATEGY_D_LOSS_COOLDOWN_MS - (Date.now() - cooldownTime)) /
              60_000,
          );
          logger.debug(
            LOG_SOURCE,
            "[쿨다운] 전략D 진입 차단: %s (남은 시간 %s분)",
            market,
            remainingMin,
          );
        } else {
          // 쿨다운 만료된 경우 맵에서 제거
          if (cooldownTime) {
            delete lossCooldown[market];
          }
          buyD = checkBuySignalD(market, price);
        }
      }
      const buyE =
        buyB?.shouldBuy || buyA?.shouldBuy || buyC?.shouldBuy || buyD?.shouldBuy
          ? null
          : checkBuySignalE(market, price);
      const buySignal = buyB ?? buyA ?? buyC ?? buyD ?? buyE;
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
        const res = await executeMarketBuy(ACCESS_KEY, SECRET_KEY, market);
        if (res.ok && res.order) {
          let vol = await fetchVolume(ACCESS_KEY, SECRET_KEY, market);
          if (parseFloat(vol) <= 0) {
            await sleep(300);
            vol = await fetchVolume(ACCESS_KEY, SECRET_KEY, market);
            if (parseFloat(vol) <= 0) {
              logger.warn(
                LOG_SOURCE,
                "매수 체결 후 보유 수량 0 - 계정 반영 지연. 수량 재조회 실패.",
              );
            }
          }
          const avgBuyPrice = await fetchAvgBuyPrice(
            ACCESS_KEY,
            SECRET_KEY,
            market,
          );
          const buyPriceForPosition = avgBuyPrice > 0 ? avgBuyPrice : price;
          logger.info(
            LOG_SOURCE,
            "[매수] [전략%s] 체결: %s | %s 원 %s",
            strategy ?? "legacy",
            market,
            buyPriceForPosition.toFixed(0),
            avgBuyPrice > 0 ? "(체결평균가)" : "(신호가)",
          );
          const dailyStrBuy =
            dailyProfitKrw >= 0
              ? `+${Math.round(dailyProfitKrw).toLocaleString()}원`
              : `${Math.round(dailyProfitKrw).toLocaleString()}원`;
          const totalStrBuy =
            totalCumulativeKrw >= 0
              ? `+${Math.round(totalCumulativeKrw).toLocaleString()}원`
              : `${Math.round(totalCumulativeKrw).toLocaleString()}원`;
          console.error(
            `${tradeLogTimestamp()} [매매기록] 매수 | 전략${strategy ?? "legacy"} | ${market} | ${buyPriceForPosition.toFixed(0)} 원 | 일일 누적 ${dailyLossPct.toFixed(2)}% ${dailyStrBuy} (${dailyTradeCount}회) | 전체 누적 ${totalCumulativePct.toFixed(2)}% ${totalStrBuy} (${totalTradeCount}회)`,
          );

          const buyTimeMs = Date.now();
          let entryLow: number | undefined;
          let entryAtr: number | undefined;
          if (strategy === "A") {
            const candles1m = getCandles(market, 1);
            const entryMinuteStart = minuteStart(buyTimeMs);
            const entryCandle = candles1m.find(
              (c) => c.timestamp === entryMinuteStart,
            );
            if (entryCandle) entryLow = entryCandle.low_price;
            if (candles1m.length >= 15) {
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
            highestPrice: strategy === "C" ? price : undefined,
            trailingActivated: strategy === "C" ? false : undefined,
          };
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

run().catch((e) => {
  logger.error(LOG_SOURCE, "치명적: %s", (e as Error).message);
  process.exit(1);
});
