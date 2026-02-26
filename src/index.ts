import "dotenv/config";
import { getCandles as fetchCandles } from "./api/rest";
import { setCandles, getCandles, updateFromTicker } from "./data/candleWindow";
import { subscribeTicker, unsubscribeTicker } from "./ws/ticker";
import { selectTopMarkets } from "./strategy/selectMarkets";
import { checkBuySignal, checkSellSignal } from "./strategy/signal";
import {
  executeMarketBuy,
  executeMarketSell,
  fetchVolume,
  fetchAvgBuyPrice,
  fetchKrwBalance,
} from "./execution/order";
import { CANDLE_WINDOW_SIZE } from "./config";

const ACCESS_KEY = process.env.ACCESS_KEY!;
const SECRET_KEY = process.env.SECRET_KEY!;

interface Position {
  market: string;
  buyPrice: number;
  volume: string;
}

let position: Position | null = null;
let currentMarkets: string[] = [];
/** 동시 매수 신호로 인한 중복 매수 방지 */
let isBuying = false;

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

const run = async (): Promise<void> => {
  if (!ACCESS_KEY || !SECRET_KEY) {
    console.error(
      "치명적: ACCESS_KEY, SECRET_KEY가 .env에 설정되지 않았습니다.",
    );
    process.exit(1);
  }

  const selectAndLoad = async (): Promise<string[]> => {
    const markets = await selectTopMarkets();
    if (markets.length === 0) {
      console.error("치명적: 선정된 종목이 없습니다.");
      return [];
    }
    console.log("종목 선정:", markets.join(", "));
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

    if (position) {
      if (position.market !== market) return;
      const sellSignal = checkSellSignal(
        position.market,
        position.buyPrice,
        price,
      );
      if (sellSignal.shouldSell) {
        console.log("매도 신호:", sellSignal.reason);
        const res = await executeMarketSell(
          ACCESS_KEY,
          SECRET_KEY,
          position.market,
          position.volume,
        );
        if (res.ok) {
          console.log("매도 체결:", position.market, position.volume);
          position = null;
          currentMarkets = await selectAndLoad();
          if (currentMarkets.length === 0) {
            console.warn("매도 후 종목 선정 없음, 30초 후 재시도...");
            await sleep(30000);
            currentMarkets = await selectAndLoad();
          }
          if (currentMarkets.length === 0) {
            console.error(
              "치명적: 재시도 후에도 종목 선정 실패. 프로세스 종료.",
            );
            process.exit(1);
          }
          subscribeTicker(currentMarkets, handleTicker);
        } else {
          console.error("매도 실패:", res.message);
        }
      }
      return;
    }

    if (!currentMarkets.includes(market)) return;
    if (isBuying) return;
    const buySignal = checkBuySignal(market, price);
    if (!buySignal.shouldBuy) return;
    isBuying = true;
    try {
      console.log("매수 신호:", buySignal.reason);
      const res = await executeMarketBuy(ACCESS_KEY, SECRET_KEY, market);
      if (res.ok && res.order) {
        let vol = await fetchVolume(ACCESS_KEY, SECRET_KEY, market);
        if (parseFloat(vol) <= 0) {
          await sleep(300);
          vol = await fetchVolume(ACCESS_KEY, SECRET_KEY, market);
          if (parseFloat(vol) <= 0) {
            console.warn(
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
        console.log(
          "매수 체결:",
          market,
          buyPriceForPosition.toFixed(0),
          "원",
          avgBuyPrice > 0 ? "(체결평균가)" : "(신호가)",
        );
        position = { market, buyPrice: buyPriceForPosition, volume: vol };
        currentMarkets = [market];
        unsubscribeTicker();
        subscribeTicker([market], handleTicker);
      } else {
        console.error("매수 실패:", res.message);
      }
    } finally {
      isBuying = false;
    }
  };

  subscribeTicker(currentMarkets, handleTicker);
  console.log("봇 기동 완료. WebSocket 구독:", currentMarkets.join(", "));
};

run().catch((e) => {
  console.error("치명적:", (e as Error).message);
  process.exit(1);
});
