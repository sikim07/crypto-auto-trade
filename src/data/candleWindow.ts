import { CANDLE_WINDOW_SIZE } from "../config";
import type { UpbitCandle } from "../types";

const MINUTE_MS = 60 * 1000;

const candleStorage = new Map<string, UpbitCandle[]>();

const minuteStart = (ts: number): number =>
  Math.floor(ts / MINUTE_MS) * MINUTE_MS;

/** 초기 200개 캔들로 채움 (REST에서 가져온 배열 그대로 저장, 시간순 정렬 후 끝 200개만) */
export const setCandles = (market: string, candles: UpbitCandle[]): void => {
  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  const trimmed = sorted.slice(-CANDLE_WINDOW_SIZE);
  candleStorage.set(market, trimmed);
};

/** 최근 200개 캔들 반환 */
export const getCandles = (market: string): UpbitCandle[] => {
  return candleStorage.get(market) ?? [];
};

/** ticker 수신 시 실시간 갱신: 같은 분이면 마지막 캔들 high/low/close/volume 갱신, 새 분이면 캔들 추가 후 200개 유지 */
export const updateFromTicker = (
  market: string,
  tradePrice: number,
  tradeTimestamp: number,
  tradeVolume?: number,
): void => {
  let list = candleStorage.get(market);
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
    candle_acc_trade_price: 0,
    candle_acc_trade_volume: tradeVolume ?? 0,
  };
  list = [...list, newCandle];
  if (list.length > CANDLE_WINDOW_SIZE) {
    list = list.slice(-CANDLE_WINDOW_SIZE);
  }
  candleStorage.set(market, list);
};
