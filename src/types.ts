/**
 * Upbit API 응답 타입 (snake_case 유지)
 */

export type ChangeType = "RISE" | "FALL" | "EVEN";

export interface UpbitMarket {
  market: string;
  korean_name: string;
  english_name: string;
}

export interface UpbitTicker {
  market: string;
  trade_date: string;
  trade_time: string;
  trade_date_kst: string;
  trade_time_kst: string;
  trade_timestamp: number;
  opening_price: number;
  high_price: number;
  low_price: number;
  trade_price: number;
  prev_closing_price: number;
  change: ChangeType;
  change_price: number;
  change_rate: number;
  signed_change_price: number;
  signed_change_rate: number;
  trade_volume: number;
  acc_trade_price: number;
  acc_trade_price_24h: number;
  acc_trade_volume: number;
  acc_trade_volume_24h: number;
  highest_52_week_price: number;
  highest_52_week_date: string;
  lowest_52_week_price: number;
  lowest_52_week_date: string;
  timestamp: number;
}

export interface UpbitCandle {
  market: string;
  candle_date_time_utc: string;
  candle_date_time_kst: string;
  opening_price: number;
  high_price: number;
  low_price: number;
  trade_price: number;
  timestamp: number;
  candle_acc_trade_price: number;
  candle_acc_trade_volume: number;
  unit?: number;
}

export interface UpbitAccount {
  currency: string;
  balance: string;
  locked: string;
  avg_buy_price: string;
  avg_buy_price_modified: boolean;
  unit_currency: string;
}

export type OrderSide = "bid" | "ask";

export type OrderState = "wait" | "watch" | "done" | "cancel";

export interface UpbitOrder {
  uuid: string;
  side: OrderSide;
  ord_type: string;
  price: string;
  state: OrderState;
  market: string;
  created_at: string;
  volume: string;
  remaining_volume: string;
  reserved_fee: string;
  remaining_fee: string;
  paid_fee: string;
  locked: string;
  executed_volume: string;
  trades_count: number;
}

export interface UpbitOrderDetail extends UpbitOrder {
  trades?: {
    market: string;
    uuid: string;
    price: string;
    volume: string;
    funds: string;
    side: OrderSide;
    created_at: string;
  }[];
}

/** 봇 포지션 (전략별 매도용 공통 타입) */
export interface BotPosition {
  market: string;
  buyPrice: number;
  volume: string;
  buyTime: number;
  maxNetPct: number;
  strategy?: "A" | "B" | "C" | "D" | "E" | "F" | "T1";
  entryLow?: number;
  entryAtr?: number;
  highestPrice?: number;
  trailingActivated?: boolean;
  lastRsi?: number;
}
