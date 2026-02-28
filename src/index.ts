import "dotenv/config";
import { getCandles as fetchCandles } from "./api/rest";
import { setCandles, getCandles, updateFromTicker } from "./data/candleWindow";
import { subscribeTicker, unsubscribeTicker } from "./ws/ticker";
import { selectTopMarkets } from "./strategy/selectMarkets";
import {
  checkBuySignal,
  checkSellSignal,
  getNetProfitPct,
} from "./strategy/signal";
import {
  executeMarketBuy,
  executeMarketSell,
  fetchVolume,
  fetchAvgBuyPrice,
  fetchKrwBalance,
} from "./execution/order";
import {
  CANDLE_WINDOW_SIZE,
  CANDLE_REFRESH_INTERVAL_MS,
  RE_SELECT_AFTER_NO_BUY_MINUTES,
  DAILY_MAX_LOSS_PCT,
} from "./config";
import { logger } from "./logger";

const LOG_SOURCE = "index";
const ACCESS_KEY = process.env.ACCESS_KEY!;
const SECRET_KEY = process.env.SECRET_KEY!;

interface Position {
  market: string;
  buyPrice: number;
  volume: string;
  buyTime: number;
  maxNetPct: number;
}

let position: Position | null = null;
let currentMarkets: string[] = [];
let isBuying = false;

let dailyLossPct = 0;
let lastResetDate = new Date().toDateString();

const resetDailyLossIfNewDay = (): void => {
  const today = new Date().toDateString();
  if (today !== lastResetDate) {
    dailyLossPct = 0;
    lastResetDate = today;
    logger.info(LOG_SOURCE, "일일 손실 카운터 초기화");
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
    const markets = await selectTopMarkets();
    if (markets.length === 0) {
      logger.error(LOG_SOURCE, "치명적: 선정된 종목이 없습니다.");
      return [];
    }
    logger.info(LOG_SOURCE, "종목 선정: %s", markets.join(", "));
    for (const market of markets) {
      const candles = await fetchCandles(
        market,
        CANDLE_WINDOW_SIZE,
        "minutes1",
      );
      setCandles(market, candles);
    }
    return markets;
  };

  currentMarkets = await selectAndLoad();
  if (currentMarkets.length === 0) process.exit(1);

  /** 마지막 종목 선정 시각 (재선정 주기 판단용) */
  let lastSelectTime = Date.now();

  /** 주기: 캔들 REST 갱신(거래량 보정) + 매수 없을 때 N분 경과 시 종목 재선정 */
  setInterval(async () => {
    try {
      for (const market of currentMarkets) {
        const candles = await fetchCandles(
          market,
          CANDLE_WINDOW_SIZE,
          "minutes1",
        );
        setCandles(market, candles);
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
          subscribeTicker(currentMarkets, handleTicker);
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
  }): Promise<void> => {
    const market = (data.market ?? data.code) as string;
    if (!market) return;
    updateFromTicker(market, data.trade_price, data.trade_timestamp);
    const price = data.trade_price;

    resetDailyLossIfNewDay();

    if (position) {
      if (position.market !== market) return;

      const curNetPct = getNetProfitPct(position.buyPrice, price);
      if (curNetPct > position.maxNetPct) {
        position.maxNetPct = curNetPct;
      }

      const sellSignal = checkSellSignal(
        position.market,
        position.buyPrice,
        price,
        { buyTime: position.buyTime, maxNetPct: position.maxNetPct },
      );
      if (sellSignal.shouldSell) {
        logger.info(LOG_SOURCE, "매도 신호: %s", sellSignal.reason);
        const res = await executeMarketSell(
          ACCESS_KEY,
          SECRET_KEY,
          position.market,
          position.volume,
        );
        if (res.ok) {
          const finalNetPct = getNetProfitPct(position.buyPrice, price);
          dailyLossPct += finalNetPct;
          logger.info(
            LOG_SOURCE,
            "매도 체결: %s %s (순수익 %s%%, 일일 누적 %s%%)",
            position.market,
            position.volume,
            finalNetPct.toFixed(2),
            dailyLossPct.toFixed(2),
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
          subscribeTicker(currentMarkets, handleTicker);
        } else {
          logger.error(LOG_SOURCE, "매도 실패: %s", res.message);
        }
      }
      return;
    }

    if (!currentMarkets.includes(market)) return;
    if (isBuying) return;

    if (dailyLossPct <= DAILY_MAX_LOSS_PCT) {
      logger.warn(
        LOG_SOURCE,
        "일일 최대 손실 한도 도달 (누적 %s%%), 매수 중단",
        dailyLossPct.toFixed(2),
      );
      return;
    }

    const buySignal = checkBuySignal(market, price);
    if (!buySignal.shouldBuy) return;
    isBuying = true;
    try {
      logger.info(LOG_SOURCE, "매수 신호: %s", buySignal.reason);
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
          "매수 체결: %s %s 원 %s",
          market,
          buyPriceForPosition.toFixed(0),
          avgBuyPrice > 0 ? "(체결평균가)" : "(신호가)",
        );
        position = {
          market,
          buyPrice: buyPriceForPosition,
          volume: vol,
          buyTime: Date.now(),
          maxNetPct: 0,
        };
        currentMarkets = [market];
        unsubscribeTicker();
        subscribeTicker([market], handleTicker);
      } else {
        logger.error(LOG_SOURCE, "매수 실패: %s", res.message);
      }
    } finally {
      isBuying = false;
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
