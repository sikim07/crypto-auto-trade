// ── Upbit API 응답 타입 ──

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

export interface UpbitOrderbook {
  market: string;
  timestamp: number;
  total_ask_size: number;
  total_bid_size: number;
  orderbook_units: {
    ask_price: number;
    bid_price: number;
    ask_size: number;
    bid_size: number;
  }[];
}

export interface UpbitTicker {
  market: string;
  trade_price: number;
  trade_timestamp: number;
  acc_trade_price_24h: number;
  acc_trade_volume_24h: number;
  signed_change_rate: number;
  [key: string]: unknown;
}

// ── 그리드 봇 타입 ──

export type GridLevelStatus = "idle" | "buy_placed" | "holding" | "sell_placed";

export interface GridLevel {
  index: number;
  price: number;
  status: GridLevelStatus;
  orderUuid?: string;
  buyPrice?: number;
  buyVolume?: number;
  filledCount: number;
}

export interface GridState {
  market: string;
  rangeUpper: number;
  rangeLower: number;
  gridInterval: number;
  levels: GridLevel[];
  totalRealizedProfit: number;
  totalFees: number;
  tradeCount: number;
  startedAt: number;
  lastUpdatedAt: number;
}
