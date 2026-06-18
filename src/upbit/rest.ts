/**
 * Upbit REST API 래퍼
 *
 * Upbit Open API의 주요 엔드포인트를 TypeScript 함수로 래핑한다.
 * - 공개 API: 캔들, 호가, 티커 (인증 불필요)
 * - 비공개 API: 잔고 조회, 주문 배치/취소/조회 (JWT 인증 필요)
 *
 * 참고: https://docs.upbit.com/reference
 */
import axios, { AxiosError } from "axios";
import { UPBIT_BASE_URL, REST_TIMEOUT_MS, UPBIT_ACCESS_KEY, UPBIT_SECRET_KEY } from "../common/config";
import { generateToken, generateTokenWithBody } from "./auth";
import type { UpbitCandle, UpbitAccount, UpbitOrder, UpbitOrderDetail, UpbitOrderbook, UpbitTicker } from "../common/types";

/**
 * Upbit KRW 마켓 호가 단위 (가격대별 주문 가격 단위)
 *
 * Upbit은 가격대에 따라 주문 가능한 최소 가격 단위가 다르다.
 * 예: BTC가 1억원대이면 1,000원 단위, 100만원대이면 500원 단위로만 주문 가능.
 * 이 단위에 맞지 않는 가격으로 주문하면 API 에러 발생.
 */
export const getPriceUnit = (price: number): number => {
  if (price >= 2_000_000) return 1_000;
  if (price >= 1_000_000) return 500;
  if (price >= 500_000) return 100;
  if (price >= 100_000) return 50;
  if (price >= 10_000) return 10;
  if (price >= 1_000) return 5;
  if (price >= 100) return 1;
  if (price >= 10) return 0.1;
  if (price >= 1) return 0.01;
  return 0.001;
};

/** 가격을 Upbit 호가 단위에 맞게 내림 */
export const roundPrice = (price: number): number => {
  const unit = getPriceUnit(price);
  return Math.floor(price / unit) * unit;
};

/** Axios 에러에서 Upbit 응답 메시지 추출 */
const extractErrorMsg = (e: unknown): string => {
  const err = e as AxiosError<{ error?: { message?: string; name?: string } }>;
  if (err.response?.data?.error) {
    const { name, message } = err.response.data.error;
    return `${err.response.status} ${name ?? ""}: ${message ?? ""}`.trim();
  }
  return (e as Error).message ?? "unknown";
};

const api = axios.create({
  baseURL: UPBIT_BASE_URL,
  timeout: REST_TIMEOUT_MS,
  headers: { "Content-Type": "application/json" },
});

const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });

// ── 공개 API (인증 불필요) ──

/** 분봉 캔들 조회 */
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

/** 호가창 조회 (매수/매도 호가 목록) */
export const getOrderbook = async (market: string): Promise<UpbitOrderbook> => {
  const { data } = await api.get<UpbitOrderbook[]>("/orderbook", {
    params: { markets: market },
  });
  return data[0];
};

/** 현재가 조회 (여러 종목 동시 가능) */
export const getTicker = async (markets: string[]): Promise<UpbitTicker[]> => {
  if (markets.length === 0) return [];
  const { data } = await api.get<UpbitTicker[]>("/ticker", {
    params: { markets: markets.join(",") },
  });
  return data;
};

// ── 비공개 API (JWT 인증 필요) ──

/** 전체 계좌 잔고 조회 */
export const getAccounts = async (): Promise<UpbitAccount[]> => {
  const token = generateToken(UPBIT_ACCESS_KEY, UPBIT_SECRET_KEY);
  const { data } = await api.get<UpbitAccount[]>("/accounts", {
    headers: authHeader(token),
  });
  return data;
};

/** KRW 잔고만 조회 */
export const getKrwBalance = async (): Promise<number> => {
  const accounts = await getAccounts();
  const krw = accounts.find((a) => a.currency === "KRW");
  return krw ? parseFloat(krw.balance) : 0;
};

/** 특정 코인 보유량 및 평균 매수가 조회 */
export const getCoinBalance = async (market: string): Promise<{ volume: number; avgPrice: number }> => {
  const currency = market.replace("KRW-", "");
  const accounts = await getAccounts();
  const account = accounts.find((a) => a.currency === currency);
  return {
    volume: account ? parseFloat(account.balance) : 0,
    avgPrice: account ? parseFloat(account.avg_buy_price) : 0,
  };
};

/**
 * 지정가 주문 배치
 * price는 자동으로 Upbit 호가 단위에 맞게 내림 처리된다.
 */
export const placeLimitOrder = async (
  market: string,
  side: "bid" | "ask",
  price: number,
  volume: number,
): Promise<UpbitOrderDetail> => {
  const adjustedPrice = roundPrice(price);
  const bodyParams: Record<string, string> = {
    market,
    side,
    ord_type: "limit",
    price: String(adjustedPrice),
    volume: String(volume),
  };
  try {
    const token = generateTokenWithBody(UPBIT_ACCESS_KEY, UPBIT_SECRET_KEY, bodyParams);
    const { data } = await api.post<UpbitOrderDetail>("/orders", bodyParams, {
      headers: authHeader(token),
    });
    return data;
  } catch (e) {
    throw new Error(extractErrorMsg(e));
  }
};

/** 주문 취소 */
export const cancelOrder = async (uuid: string): Promise<UpbitOrder> => {
  const queryParams = { uuid };
  const token = generateToken(UPBIT_ACCESS_KEY, UPBIT_SECRET_KEY, queryParams);
  const { data } = await api.delete<UpbitOrder>("/order", {
    params: queryParams,
    headers: authHeader(token),
  });
  return data;
};

/** 주문 상태 조회 (체결 여부 확인용) */
export const getOrder = async (uuid: string): Promise<UpbitOrderDetail> => {
  const queryParams = { uuid };
  const token = generateToken(UPBIT_ACCESS_KEY, UPBIT_SECRET_KEY, queryParams);
  const { data } = await api.get<UpbitOrderDetail>("/order", {
    params: queryParams,
    headers: authHeader(token),
  });
  return data;
};

/** 미체결 주문 목록 조회 */
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

/** 시장가 매도 주문 (긴급 청산용) */
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
