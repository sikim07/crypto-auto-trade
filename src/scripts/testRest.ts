import "dotenv/config";
import { getAllMarkets, getTicker, getCandles, getAccounts } from "../api/rest";
import { logger } from "../logger";

const LOG_SOURCE = "scripts/testRest";

const run = async (): Promise<void> => {
  const accessKey = process.env.ACCESS_KEY;
  const secretKey = process.env.SECRET_KEY;

  if (!accessKey || !secretKey) {
    logger.error(LOG_SOURCE, "ACCESS_KEY, SECRET_KEY를 .env에 설정하세요.");
    process.exit(1);
  }

  try {
    const markets = await getAllMarkets();
    const krw = markets.filter((m) => m.market.startsWith("KRW-"));
    logger.info(LOG_SOURCE, "마켓 조회: KRW 마켓 %s개", krw.length);

    const sample = krw.slice(0, 3).map((m) => m.market);
    const tickers = await getTicker(sample);
    logger.info(
      LOG_SOURCE,
      "ticker 샘플: %s %s %s",
      tickers.length,
      tickers[0]?.market ?? "",
      tickers[0]?.trade_price ?? "",
    );

    const candles = await getCandles("KRW-BTC", 5, "minutes1");
    logger.info(
      LOG_SOURCE,
      "캔들(1분봉 5개): %s %s",
      candles.length,
      candles[0]?.trade_price ?? "",
    );

    const accounts = await getAccounts(accessKey, secretKey);
    const krwAccount = accounts.find((a) => a.currency === "KRW");
    logger.info(LOG_SOURCE, "계좌 KRW 잔고: %s", krwAccount?.balance ?? "0");
  } catch (e: unknown) {
    const err = e as { response?: { data?: unknown }; message?: string };
    logger.error(
      LOG_SOURCE,
      "REST 오류: %s",
      err.response?.data ?? err.message,
    );
    process.exit(1);
  }
};

run();
