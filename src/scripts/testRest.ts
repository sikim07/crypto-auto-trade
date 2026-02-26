import "dotenv/config";
import { getAllMarkets, getTicker, getCandles, getAccounts } from "../api/rest";

const run = async (): Promise<void> => {
  const accessKey = process.env.ACCESS_KEY;
  const secretKey = process.env.SECRET_KEY;

  if (!accessKey || !secretKey) {
    console.error("ACCESS_KEY, SECRET_KEY를 .env에 설정하세요.");
    process.exit(1);
  }

  try {
    const markets = await getAllMarkets();
    const krw = markets.filter((m) => m.market.startsWith("KRW-"));
    console.log(`마켓 조회: KRW 마켓 ${krw.length}개`);

    const sample = krw.slice(0, 3).map((m) => m.market);
    const tickers = await getTicker(sample);
    console.log(
      "ticker 샘플:",
      tickers.length,
      tickers[0]?.market,
      tickers[0]?.trade_price,
    );

    const candles = await getCandles("KRW-BTC", 5, "minutes1");
    console.log("캔들(1분봉 5개):", candles.length, candles[0]?.trade_price);

    const accounts = await getAccounts(accessKey, secretKey);
    const krwAccount = accounts.find((a) => a.currency === "KRW");
    console.log("계좌 KRW 잔고:", krwAccount?.balance ?? "0");
  } catch (e: unknown) {
    const err = e as { response?: { data?: unknown }; message?: string };
    console.error("REST 오류:", err.response?.data ?? err.message);
    process.exit(1);
  }
};

run();
