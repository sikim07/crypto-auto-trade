import "dotenv/config";
import { getCandles } from "../api/rest";
import {
  setCandles,
  getCandles as getWindow,
  updateFromTicker,
} from "../data/candleWindow";
import { subscribeTicker, unsubscribeTicker } from "../ws/ticker";

const MARKETS = ["KRW-BTC", "KRW-ETH"];

const run = async (): Promise<void> => {
  console.log("REST로 1분봉 200개 로드 중...");
  for (const market of MARKETS) {
    const candles = await getCandles(market, 200, "minutes1");
    setCandles(market, candles);
    console.log(market, "캔들 개수:", getWindow(market).length);
  }

  console.log("WebSocket 구독 시작 (10초 후 종료)");
  subscribeTicker(MARKETS, (data) => {
    const market = (data.market ?? data.code) as string;
    if (!MARKETS.includes(market)) return;
    updateFromTicker(market, data.trade_price, data.trade_timestamp);
    const list = getWindow(market);
    const last = list[list.length - 1];
    if (last) console.log(market, last.trade_price, "캔들 수:", list.length);
  });

  await new Promise((r) => setTimeout(r, 10000));
  unsubscribeTicker();
  console.log("종료");
  process.exit(0);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
