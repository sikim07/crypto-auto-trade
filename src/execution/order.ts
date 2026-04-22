import {
  MIN_RESERVE_KRW,
  MIN_ORDER_KRW,
  POSITION_PCT,
  ORDER_WAIT_MS,
  CONFIRM_RETRY_MAX,
  CONFIRM_RETRY_INTERVAL_MS,
} from "../config";
import {
  getAccounts,
  postMarketBuyOrder,
  postMarketSellOrder,
} from "../api/rest";
import type { UpbitAccount, UpbitOrderDetail } from "../types";

/** 사용 가능 매수 금액: (잔고 - 예비금) * POSITION_PCT. 5천원 미만이면 0 반환 */
export const getBuyAmountKrw = (krwBalance: number): number => {
  if (krwBalance <= MIN_RESERVE_KRW) return 0;
  const amount = Math.floor((krwBalance - MIN_RESERVE_KRW) * POSITION_PCT);
  if (amount < MIN_ORDER_KRW) return 0;
  return amount;
};

/** KRW 잔고 조회 */
export const fetchKrwBalance = async (
  accessKey: string,
  secretKey: string,
): Promise<number> => {
  const accounts = await getAccounts(accessKey, secretKey);
  const krw = accounts.find((a) => a.currency === "KRW");
  return krw ? parseFloat(krw.balance) : 0;
};

/** 계좌 스냅샷 (재조회 비교용) */
const accountsSnapshot = (accounts: UpbitAccount[]): string =>
  accounts
    .map((a) => `${a.currency}:${a.balance}`)
    .sort()
    .join("|");

/** 주문 후 대기 → 자산 재조회하여 이전과 다를 때까지 최대 3회 */
export const confirmOrderWithRetry = async (
  accessKey: string,
  secretKey: string,
): Promise<UpbitAccount[]> => {
  await new Promise((r) => setTimeout(r, ORDER_WAIT_MS));
  let accounts = await getAccounts(accessKey, secretKey);
  let prev = accountsSnapshot(accounts);
  let retries = 0;
  while (retries < CONFIRM_RETRY_MAX) {
    await new Promise((r) => setTimeout(r, CONFIRM_RETRY_INTERVAL_MS));
    accounts = await getAccounts(accessKey, secretKey);
    const curr = accountsSnapshot(accounts);
    if (curr !== prev) return accounts;
    retries += 1;
  }
  return accounts;
};

export interface BuyResult {
  ok: boolean;
  order?: UpbitOrderDetail;
  /** confirmOrderWithRetry 후 계좌에서 확인된 코인 잔고 */
  executedVolume?: string;
  /** confirmOrderWithRetry 후 계좌에서 확인된 평균 매수가 */
  avgBuyPrice?: number;
  message?: string;
}

/** 시장가 매수 실행 (잔고 보호 적용). 5천원 미만이면 주문 안 함 */
export const executeMarketBuy = async (
  accessKey: string,
  secretKey: string,
  market: string,
): Promise<BuyResult> => {
  const balance = await fetchKrwBalance(accessKey, secretKey);
  const amount = getBuyAmountKrw(balance);
  if (amount < MIN_ORDER_KRW) {
    return {
      ok: false,
      message: `주문 금액 부족 (잔고: ${balance.toFixed(0)}원)`,
    };
  }
  // 주문 체결과 체결 확인을 분리: 주문 실패만 ok:false, 확인 실패는 ok:true + vol=0
  let order: UpbitOrderDetail;
  try {
    order = await postMarketBuyOrder(accessKey, secretKey, market, amount);
  } catch (e: unknown) {
    const err = e as {
      response?: { data?: { error?: { message?: string } } };
      message?: string;
    };
    const msg = err.response?.data?.error?.message ?? err.message ?? "unknown";
    return { ok: false, message: String(msg) };
  }

  let executedVolume = "0";
  let avgBuyPrice = 0;
  try {
    const accounts = await confirmOrderWithRetry(accessKey, secretKey);
    const currency = market.replace("KRW-", "");
    const account = accounts.find((a) => a.currency === currency);
    executedVolume = account?.balance ?? "0";
    avgBuyPrice = account?.avg_buy_price ? parseFloat(account.avg_buy_price) : 0;
  } catch {
    // 확인 실패 — 주문은 체결됐으므로 ok:true, vol=0으로 index.ts에서 failLog 처리
  }
  return { ok: true, order, executedVolume, avgBuyPrice };
};

/** 보유 수량 조회 (특정 마켓 코인) */
export const fetchVolume = async (
  accessKey: string,
  secretKey: string,
  market: string,
): Promise<string> => {
  const currency = market.replace("KRW-", "");
  const accounts = await getAccounts(accessKey, secretKey);
  const account = accounts.find((a) => a.currency === currency);
  return account?.balance ?? "0";
};

/** 매수 평균 단가 조회 (체결가 기준, 해당 마켓 코인) */
export const fetchAvgBuyPrice = async (
  accessKey: string,
  secretKey: string,
  market: string,
): Promise<number> => {
  const currency = market.replace("KRW-", "");
  const accounts = await getAccounts(accessKey, secretKey);
  const account = accounts.find((a) => a.currency === currency);
  if (!account?.avg_buy_price) return 0;
  return parseFloat(account.avg_buy_price);
};

export interface SellResult {
  ok: boolean;
  order?: UpbitOrderDetail;
  message?: string;
}

/** 시장가 매도 실행 */
export const executeMarketSell = async (
  accessKey: string,
  secretKey: string,
  market: string,
  volume: string,
): Promise<SellResult> => {
  const vol = parseFloat(volume);
  if (!(vol > 0)) {
    return { ok: false, message: "매도 수량 0" };
  }
  // 주문 체결과 체결 확인을 분리: 주문 실패만 ok:false, 확인 실패는 ok:true
  let order: UpbitOrderDetail;
  try {
    order = await postMarketSellOrder(accessKey, secretKey, market, volume);
  } catch (e: unknown) {
    const err = e as {
      response?: { data?: { error?: { message?: string } } };
      message?: string;
    };
    const msg = err.response?.data?.error?.message ?? err.message ?? "unknown";
    return { ok: false, message: String(msg) };
  }

  try {
    await confirmOrderWithRetry(accessKey, secretKey);
  } catch {
    // 확인 실패 — 매도는 체결됐으므로 ok:true
  }
  return { ok: true, order };
};
