import { CANDLE_WINDOW_SIZE, CANDLE_WINDOW_SIZE_5M } from "../config";
import type { UpbitCandle } from "../types";

const MINUTE_MS = 60 * 1000;
const FIVE_MINUTE_MS = 5 * 60 * 1000;

const candleStorage = new Map<string, UpbitCandle[]>();

const storageKey = (market: string, unit: number): string =>
  `${market}:${unit}`;

/** 타임스탬프(ms)가 속한 분의 시작 시각(ms). 진입봉 식별용 */
export const minuteStart = (ts: number): number =>
  Math.floor(ts / MINUTE_MS) * MINUTE_MS;

/** 직전 5개 1분봉으로 5분봉 1개 생성하여 5분봉 저장소에 append */
const append5mCandleFrom1m = (market: string, list1m: UpbitCandle[]): void => {
  if (list1m.length < 5) return;
  const lastFive = list1m.slice(-5);
  const open = lastFive[0].opening_price;
  const high = Math.max(...lastFive.map((c) => c.high_price));
  const low = Math.min(...lastFive.map((c) => c.low_price));
  const close = lastFive[lastFive.length - 1].trade_price;
  const volume = lastFive.reduce((s, c) => s + c.candle_acc_trade_volume, 0);
  const accTradePrice = lastFive.reduce(
    (s, c) => s + c.candle_acc_trade_price,
    0,
  );
  const timestamp = lastFive[0].timestamp;

  const key5 = storageKey(market, 5);
  const list5 = candleStorage.get(key5) ?? [];
  const newCandle5: UpbitCandle = {
    market,
    candle_date_time_utc: "",
    candle_date_time_kst: "",
    opening_price: open,
    high_price: high,
    low_price: low,
    trade_price: close,
    timestamp,
    candle_acc_trade_price: accTradePrice,
    candle_acc_trade_volume: volume,
  };
  const next = [...list5, newCandle5].slice(-CANDLE_WINDOW_SIZE_5M);
  candleStorage.set(key5, next);
};

/** 초기 캔들로 채움 (REST에서 가져온 배열 시간순 정렬 후 unit별 최대 개수만 유지) */
export const setCandles = (
  market: string,
  candles: UpbitCandle[],
  unit: number = 1,
): void => {
  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  const maxLen = unit === 5 ? CANDLE_WINDOW_SIZE_5M : CANDLE_WINDOW_SIZE;
  const trimmed = sorted.slice(-maxLen);
  candleStorage.set(storageKey(market, unit), trimmed);
};

/** 최근 캔들 반환 (unit 기본 1 = 1분봉) */
export const getCandles = (market: string, unit: number = 1): UpbitCandle[] => {
  return candleStorage.get(storageKey(market, unit)) ?? [];
};

/** ticker 수신 시 실시간 갱신: 1분봉만 갱신 (같은 분이면 마지막 캔들 갱신, 새 분이면 캔들 추가 후 200개 유지) */
export const updateFromTicker = (
  market: string,
  tradePrice: number,
  tradeTimestamp: number,
  tradeVolume?: number,
): void => {
  const key = storageKey(market, 1);
  let list = candleStorage.get(key);
  if (!list || list.length === 0) return;

  const minStart = minuteStart(tradeTimestamp);
  const last = list[list.length - 1];
  const lastMinStart = minuteStart(last.timestamp);

  if (lastMinStart === minStart) {
    last.trade_price = tradePrice;
    last.high_price = Math.max(last.high_price, tradePrice);
    last.low_price = Math.min(last.low_price, tradePrice);
    if (tradeVolume !== undefined && tradeVolume > 0) {
      last.candle_acc_trade_volume += tradeVolume;
      last.candle_acc_trade_price += tradePrice * tradeVolume;
    }
    return;
  }

  const newCandle: UpbitCandle = {
    market,
    candle_date_time_utc: "",
    candle_date_time_kst: "",
    opening_price: last.trade_price,
    high_price: tradePrice,
    low_price: tradePrice,
    trade_price: tradePrice,
    timestamp: minStart,
    candle_acc_trade_price:
      tradeVolume !== undefined && tradeVolume > 0
        ? tradePrice * tradeVolume
        : 0,
    candle_acc_trade_volume: tradeVolume ?? 0,
  };
  list = [...list, newCandle];
  if (list.length > CANDLE_WINDOW_SIZE) {
    list = list.slice(-CANDLE_WINDOW_SIZE);
  }
  candleStorage.set(key, list);

  /* 새 1분봉이 5분 경계(첫 분)일 때 직전 5개 1분봉으로 5분봉 1개 합성 */
  if (minStart % FIVE_MINUTE_MS === 0 && list.length >= 5) {
    append5mCandleFrom1m(market, list.slice(0, -1));
  }
};
