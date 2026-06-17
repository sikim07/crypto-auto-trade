import "dotenv/config";
import { getCandles } from "../api/rest";
import {
  setCandles,
  getCandles as getWindow,
  updateFromTicker,
} from "../data/candleWindow";
import { subscribeTicker, unsubscribeTicker } from "../ws/ticker";
import { logger } from "../logger";

const LOG_SOURCE = "scripts/testWsCandle";
const MARKETS = ["KRW-BTC", "KRW-ETH"];

const run = async (): Promise<void> => {
  logger.info(LOG_SOURCE, "REST로 1분봉 200개 로드 중...");
  for (const market of MARKETS) {
    const candles = await getCandles(market, 200, "minutes1");
    setCandles(market, candles);
    logger.info(
      LOG_SOURCE,
      "%s 캔들 개수: %s",
      market,
      getWindow(market).length,
    );
  }

  logger.info(LOG_SOURCE, "WebSocket 구독 시작 (10초 후 종료)");
  subscribeTicker(MARKETS, (data) => {
    const market = (data.market ?? data.code) as string;
    if (!MARKETS.includes(market)) return;
    updateFromTicker(market, data.trade_price, data.trade_timestamp);
    const list = getWindow(market);
    const last = list[list.length - 1];
    if (last)
      logger.info(
        LOG_SOURCE,
        "%s %s 캔들 수: %s",
        market,
        last.trade_price,
        list.length,
      );
  });

  await new Promise((r) => setTimeout(r, 10000));
  unsubscribeTicker();
  logger.info(LOG_SOURCE, "종료");
  process.exit(0);
};

run().catch((e) => {
  logger.error(LOG_SOURCE, "%s", (e as Error).message ?? e);
  process.exit(1);
});
