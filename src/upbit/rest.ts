import axios from "axios";
import { UPBIT_BASE_URL, REST_TIMEOUT_MS, UPBIT_ACCESS_KEY, UPBIT_SECRET_KEY } from "../common/config";
import { generateToken, generateTokenWithBody } from "./auth";
import type { UpbitCandle, UpbitAccount, UpbitOrder, UpbitOrderDetail, UpbitOrderbook, UpbitTicker } from "../common/types";

const api = axios.create({
  baseURL: UPBIT_BASE_URL,
  timeout: REST_TIMEOUT_MS,
  headers: { "Content-Type": "application/json" },
});

const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });

// ── 인증 불필요 ──

export const getCandles = async (
  market: string,
  unit: number,
  count: number,
): Promise<UpbitCandle[]> => {
  const { data } = await api.get<UpbitCandle[]>(`/candles/minutes/${unit}`, {
    params: { market, count },
  });
  return data;
};

export const getOrderbook = async (market: string): Promise<UpbitOrderbook> => {
  const { data } = await api.get<UpbitOrderbook[]>("/orderbook", {
    params: { markets: market },
  });
  return data[0];
};

export const getTicker = async (markets: string[]): Promise<UpbitTicker[]> => {
  if (markets.length === 0) return [];
  const { data } = await api.get<UpbitTicker[]>("/ticker", {
    params: { markets: markets.join(",") },
  });
  return data;
};

// ── 인증 필요 ──

export const getAccounts = async (): Promise<UpbitAccount[]> => {
  const token = generateToken(UPBIT_ACCESS_KEY, UPBIT_SECRET_KEY);
  const { data } = await api.get<UpbitAccount[]>("/accounts", {
    headers: authHeader(token),
  });
  return data;
};

export const getKrwBalance = async (): Promise<number> => {
  const accounts = await getAccounts();
  const krw = accounts.find((a) => a.currency === "KRW");
  return krw ? parseFloat(krw.balance) : 0;
};

export const getCoinBalance = async (market: string): Promise<{ volume: number; avgPrice: number }> => {
  const currency = market.replace("KRW-", "");
  const accounts = await getAccounts();
  const account = accounts.find((a) => a.currency === currency);
  return {
    volume: account ? parseFloat(account.balance) : 0,
    avgPrice: account ? parseFloat(account.avg_buy_price) : 0,
  };
};

export const placeLimitOrder = async (
  market: string,
  side: "bid" | "ask",
  price: number,
  volume: number,
): Promise<UpbitOrderDetail> => {
  const bodyParams: Record<string, string> = {
    market,
    side,
    ord_type: "limit",
    price: String(price),
    volume: String(volume),
  };
  const token = generateTokenWithBody(UPBIT_ACCESS_KEY, UPBIT_SECRET_KEY, bodyParams);
  const { data } = await api.post<UpbitOrderDetail>("/orders", bodyParams, {
    headers: authHeader(token),
  });
  return data;
};

export const cancelOrder = async (uuid: string): Promise<UpbitOrder> => {
  const queryParams = { uuid };
  const token = generateToken(UPBIT_ACCESS_KEY, UPBIT_SECRET_KEY, queryParams);
  const { data } = await api.delete<UpbitOrder>("/order", {
    params: queryParams,
    headers: authHeader(token),
  });
  return data;
};

export const getOrder = async (uuid: string): Promise<UpbitOrderDetail> => {
  const queryParams = { uuid };
  const token = generateToken(UPBIT_ACCESS_KEY, UPBIT_SECRET_KEY, queryParams);
  const { data } = await api.get<UpbitOrderDetail>("/order", {
    params: queryParams,
    headers: authHeader(token),
  });
  return data;
};

export const getOpenOrders = async (market: string): Promise<UpbitOrder[]> => {
  const queryParams: Record<string, string | string[]> = {
    market,
    states: ["wait", "watch"],
  };
  const token = generateToken(UPBIT_ACCESS_KEY, UPBIT_SECRET_KEY, queryParams);
  const { data } = await api.get<UpbitOrder[]>("/orders", {
    params: { market, states: ["wait", "watch"] },
    headers: authHeader(token),
  });
  return data;
};

export const placeMarketSellOrder = async (
  market: string,
  volume: number,
): Promise<UpbitOrderDetail> => {
  const bodyParams: Record<string, string> = {
    market,
    side: "ask",
    ord_type: "market",
    volume: String(volume),
  };
  const token = generateTokenWithBody(UPBIT_ACCESS_KEY, UPBIT_SECRET_KEY, bodyParams);
  const { data } = await api.post<UpbitOrderDetail>("/orders", bodyParams, {
    headers: authHeader(token),
  });
  return data;
};
