/**
 * 전략 T1 전용 매수 실행 모듈
 *
 * [목적]
 *   T1은 손절 -3%로 기존 스캘핑(-1.5%)의 2배이므로 포지션 크기를 절반(1.5%)으로 축소.
 *   동일 자본 기준 최대 손실 금액을 기존과 유사하게 유지하면서 넓은 손절 공간 확보.
 *   기존 executeMarketBuy(POSITION_PCT=3%)와 완전히 분리해 T1 비활성화 시 영향 없음.
 *
 * [개선 방향]
 *   - T1 포지션 크기 조정: STRATEGY_T1_POSITION_PCT(config.ts)만 수정하면 됨.
 *   - 실전 손실 금액이 기존 대비 지나치게 크거나 작으면 POSITION_PCT 값 조정.
 */
import {
  MIN_RESERVE_KRW,
  MIN_ORDER_KRW,
  STRATEGY_T1_POSITION_PCT,
  ORDER_WAIT_MS,
  CONFIRM_RETRY_MAX,
  CONFIRM_RETRY_INTERVAL_MS,
} from "../config";
import {
  getAccounts,
  postMarketBuyOrder,
} from "../api/rest";
import type { UpbitAccount, UpbitOrderDetail } from "../types";

/** T1 사용 가능 매수 금액: (잔고 - 예비금) * STRATEGY_T1_POSITION_PCT. 5천원 미만이면 0 반환 */
export const getBuyAmountKrwT1 = (krwBalance: number): number => {
  if (krwBalance <= MIN_RESERVE_KRW) return 0;
  const amount = Math.floor(
    (krwBalance - MIN_RESERVE_KRW) * STRATEGY_T1_POSITION_PCT,
  );
  if (amount < MIN_ORDER_KRW) return 0;
  return amount;
};

/** KRW 잔고 조회 */
const fetchKrwBalance = async (
  accessKey: string,
  secretKey: string,
): Promise<number> => {
  const accounts = await getAccounts(accessKey, secretKey);
  const krw = accounts.find((a: UpbitAccount) => a.currency === "KRW");
  return krw ? parseFloat(krw.balance) : 0;
};

/** 주문 후 대기 → 자산 재조회 (기존 confirmOrderWithRetry와 동일 로직) */
const confirmOrderWithRetry = async (
  accessKey: string,
  secretKey: string,
): Promise<void> => {
  await new Promise((r) => setTimeout(r, ORDER_WAIT_MS));
  let accounts = await getAccounts(accessKey, secretKey);
  const snapshot = (accs: UpbitAccount[]) =>
    accs
      .map((a) => `${a.currency}:${a.balance}`)
      .sort()
      .join("|");
  let prev = snapshot(accounts);
  let retries = 0;
  while (retries < CONFIRM_RETRY_MAX) {
    await new Promise((r) => setTimeout(r, CONFIRM_RETRY_INTERVAL_MS));
    accounts = await getAccounts(accessKey, secretKey);
    const curr = snapshot(accounts);
    if (curr !== prev) return;
    prev = curr;
    retries += 1;
  }
};

export interface BuyResultT1 {
  ok: boolean;
  order?: UpbitOrderDetail;
  message?: string;
}

/**
 * T1 시장가 매수 실행.
 * STRATEGY_T1_POSITION_PCT(1.5%) 적용. 잔고 부족 시 주문 안 함.
 */
export const executeMarketBuyT1 = async (
  accessKey: string,
  secretKey: string,
  market: string,
): Promise<BuyResultT1> => {
  const balance = await fetchKrwBalance(accessKey, secretKey);
  const amount = getBuyAmountKrwT1(balance);
  if (amount < MIN_ORDER_KRW) {
    return {
      ok: false,
      message: `T1 주문 금액 부족 (잔고: ${balance.toFixed(0)}원, 포지션: ${(STRATEGY_T1_POSITION_PCT * 100).toFixed(1)}%)`,
    };
  }
  try {
    const order = await postMarketBuyOrder(accessKey, secretKey, market, amount);
    await confirmOrderWithRetry(accessKey, secretKey);
    return { ok: true, order };
  } catch (e: unknown) {
    const err = e as {
      response?: { data?: { error?: { message?: string } } };
      message?: string;
    };
    const msg = err.response?.data?.error?.message ?? err.message ?? "unknown";
    return { ok: false, message: String(msg) };
  }
};
