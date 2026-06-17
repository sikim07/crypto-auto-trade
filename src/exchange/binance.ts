import * as crypto from "crypto";
import axios from "axios";
import WebSocket from "ws";
import { BINANCE_API_KEY, BINANCE_SECRET_KEY, BINANCE_BASE_URL, BINANCE_WS_URL } from "../common/config";
import { out, trade } from "../common/logger";

const LOG = "exchange/binance";

const api = axios.create({
  baseURL: BINANCE_BASE_URL,
  timeout: 10_000,
  headers: { "X-MBX-APIKEY": BINANCE_API_KEY },
});

// ── 서명 ──

const sign = (queryString: string): string => {
  return crypto.createHmac("sha256", BINANCE_SECRET_KEY)
    .update(queryString)
    .digest("hex");
};

const signedParams = (params: Record<string, string | number>): string => {
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  const timestamp = Date.now();
  const withTs = `${qs}&timestamp=${timestamp}`;
  const signature = sign(withTs);
  return `${withTs}&signature=${signature}`;
};

// ── 공개 API ──

export interface BinanceTicker {
  symbol: string;
  bidPrice: string;
  bidQty: string;
  askPrice: string;
  askQty: string;
}

export const getBookTicker = async (symbol: string): Promise<BinanceTicker> => {
  const { data } = await api.get<BinanceTicker>("/api/v3/ticker/bookTicker", {
    params: { symbol },
  });
  return data;
};

export const getPrice = async (symbol: string): Promise<number> => {
  const { data } = await api.get<{ symbol: string; price: string }>("/api/v3/ticker/price", {
    params: { symbol },
  });
  return parseFloat(data.price);
};

export interface BinanceExchangeInfo {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
  filters: { filterType: string; minQty?: string; stepSize?: string; minNotional?: string; tickSize?: string }[];
}

export const getExchangeInfo = async (symbol: string): Promise<BinanceExchangeInfo> => {
  const { data } = await api.get<{ symbols: BinanceExchangeInfo[] }>("/api/v3/exchangeInfo", {
    params: { symbol },
  });
  return data.symbols[0];
};

// ── 인증 API ──

export interface BinanceBalance {
  asset: string;
  free: string;
  locked: string;
}

export const getBalances = async (): Promise<BinanceBalance[]> => {
  const qs = signedParams({});
  const { data } = await api.get<{ balances: BinanceBalance[] }>(`/api/v3/account?${qs}`);
  return data.balances.filter((b) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);
};

export const getBalance = async (asset: string): Promise<number> => {
  const balances = await getBalances();
  const found = balances.find((b) => b.asset === asset);
  return found ? parseFloat(found.free) : 0;
};

export interface BinanceOrder {
  symbol: string;
  orderId: number;
  status: string;
  side: string;
  type: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  price: string;
}

export const placeMarketOrder = async (
  symbol: string,
  side: "BUY" | "SELL",
  quantity: number,
): Promise<BinanceOrder> => {
  const qs = signedParams({
    symbol,
    side,
    type: "MARKET",
    quantity: String(quantity),
  });
  const { data } = await api.post<BinanceOrder>(`/api/v3/order?${qs}`);
  return data;
};

export const placeQuoteOrder = async (
  symbol: string,
  side: "BUY" | "SELL",
  quoteOrderQty: number,
): Promise<BinanceOrder> => {
  const qs = signedParams({
    symbol,
    side,
    type: "MARKET",
    quoteOrderQty: String(quoteOrderQty),
  });
  const { data } = await api.post<BinanceOrder>(`/api/v3/order?${qs}`);
  return data;
};

// ── WebSocket ──

export type PriceCallback = (symbol: string, bid: number, ask: number) => void;

let ws: WebSocket | null = null;

export const subscribePrices = (symbols: string[], callback: PriceCallback): void => {
  if (ws) {
    try { ws.close(); } catch { /* ignore */ }
  }

  const streams = symbols.map((s) => `${s.toLowerCase()}@bookTicker`).join("/");
  const url = `${BINANCE_WS_URL}/${streams}`;

  out.info(LOG, "WebSocket 연결: %s개 심볼", String(symbols.length));
  const socket = new WebSocket(url);
  ws = socket;

  socket.on("open", () => {
    out.info(LOG, "WebSocket 연결 성공");
  });

  socket.on("message", (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString()) as { s: string; b: string; a: string };
      if (msg.s && msg.b && msg.a) {
        callback(msg.s, parseFloat(msg.b), parseFloat(msg.a));
      }
    } catch { /* ignore */ }
  });

  socket.on("error", (err) => {
    out.warn("binance-ws-err", LOG, "WebSocket 오류: %s", (err as Error).message);
  });

  socket.on("close", () => {
    out.warn("binance-ws-close", LOG, "WebSocket 종료, 5초 후 재연결");
    setTimeout(() => subscribePrices(symbols, callback), 5_000);
  });
};

export const unsubscribePrices = (): void => {
  if (ws) {
    try { ws.close(); } catch { /* ignore */ }
    ws = null;
  }
};

// ── 연결 확인 ──

export const verifyConnection = async (): Promise<boolean> => {
  try {
    const balances = await getBalances();
    const usdt = balances.find((b) => b.asset === "USDT");
    trade.system(LOG, "Binance API 연결 성공 | USDT: %s",
      usdt ? parseFloat(usdt.free).toFixed(2) : "0.00");
    return true;
  } catch (e) {
    const err = e as { response?: { data?: unknown }; message?: string };
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message ?? "unknown";
    trade.system(LOG, "Binance API 연결 실패: %s", detail);
    return false;
  }
};
