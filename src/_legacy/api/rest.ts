import axios, { AxiosError } from "axios";
import { UPBIT_BASE_URL, REST_TIMEOUT_MS } from "../config";
import { generateToken, generateTokenWithBody } from "./auth";
import type {
  UpbitMarket,
  UpbitTicker,
  UpbitCandle,
  UpbitAccount,
  UpbitOrderDetail,
} from "../types";

const request = axios.create({
  baseURL: UPBIT_BASE_URL,
  timeout: REST_TIMEOUT_MS,
  headers: { "Content-Type": "application/json" },
});

export const getAllMarkets = async (): Promise<UpbitMarket[]> => {
  const { data } = await request.get<UpbitMarket[]>("/market/all");
  return data;
};

export const getTicker = async (markets: string[]): Promise<UpbitTicker[]> => {
  if (markets.length === 0) return [];
  const { data } = await request.get<UpbitTicker[]>("/ticker", {
    params: { markets: markets.join(",") },
  });
  return data;
};

const CANDLES_MINUTES_1 = "minutes1";

export const getCandles = async (
  market: string,
  count: number,
  unit: string = CANDLES_MINUTES_1,
): Promise<UpbitCandle[]> => {
  const match = unit.match(/^minutes(\d+)$/);
  if (!match) throw new Error(`Unsupported candle unit: ${unit}`);
  const { data } = await request.get<UpbitCandle[]>(
    `/candles/minutes/${match[1]}`,
    {
      params: { market, count },
    },
  );
  return data;
};

export const getAccounts = async (
  accessKey: string,
  secretKey: string,
): Promise<UpbitAccount[]> => {
  const token = generateToken(accessKey, secretKey);
  const { data } = await request.get<UpbitAccount[]>("/accounts", {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
};

export const postMarketBuyOrder = async (
  accessKey: string,
  secretKey: string,
  market: string,
  priceKrw: number,
): Promise<UpbitOrderDetail> => {
  const bodyParams: Record<string, string> = {
    market,
    side: "bid",
    ord_type: "price",
    price: String(priceKrw),
  };
  const token = generateTokenWithBody(accessKey, secretKey, bodyParams);
  const { data } = await request.post<UpbitOrderDetail>("/orders", bodyParams, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
};

export const postMarketSellOrder = async (
  accessKey: string,
  secretKey: string,
  market: string,
  volume: string,
): Promise<UpbitOrderDetail> => {
  const bodyParams: Record<string, string> = {
    market,
    side: "ask",
    ord_type: "market",
    volume,
  };
  const token = generateTokenWithBody(accessKey, secretKey, bodyParams);
  const { data } = await request.post<UpbitOrderDetail>("/orders", bodyParams, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
};
