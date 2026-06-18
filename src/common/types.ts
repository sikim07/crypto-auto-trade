// ── Upbit API 응답 타입 ──
// Upbit REST API가 반환하는 JSON 구조를 TypeScript 인터페이스로 정의

/** 분봉 캔들 데이터 (GET /candles/minutes/{unit}) */
export interface UpbitCandle {
  market: string;
  candle_date_time_utc: string;
  candle_date_time_kst: string;
  opening_price: number;
  high_price: number;
  low_price: number;
  trade_price: number;          // 종가 (해당 캔들의 마지막 체결 가격)
  timestamp: number;
  candle_acc_trade_price: number;  // 캔들 내 누적 거래대금
  candle_acc_trade_volume: number; // 캔들 내 누적 거래량
  unit?: number;
}

/** 계좌 잔고 (GET /accounts) */
export interface UpbitAccount {
  currency: string;        // "KRW", "BTC" 등
  balance: string;         // 사용 가능 잔고
  locked: string;          // 주문에 묶인 잔고
  avg_buy_price: string;   // 평균 매수가
  avg_buy_price_modified: boolean;
  unit_currency: string;   // "KRW"
}

export type OrderSide = "bid" | "ask";    // bid=매수, ask=매도
export type OrderState = "wait" | "watch" | "done" | "cancel";

/** 주문 정보 (GET /orders, DELETE /order) */
export interface UpbitOrder {
  uuid: string;                // 주문 고유 ID
  side: OrderSide;
  ord_type: string;            // "limit", "market" 등
  price: string;
  state: OrderState;           // wait=미체결, done=체결완료, cancel=취소
  market: string;
  created_at: string;
  volume: string;              // 주문 수량
  remaining_volume: string;    // 미체결 잔량
  reserved_fee: string;
  remaining_fee: string;
  paid_fee: string;            // 실제 납부 수수료
  locked: string;
  executed_volume: string;     // 체결된 수량
  trades_count: number;
}

/** 주문 상세 (체결 내역 포함, GET /order?uuid=...) */
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

/** 호가창 (GET /orderbook) */
export interface UpbitOrderbook {
  market: string;
  timestamp: number;
  total_ask_size: number;    // 총 매도 잔량
  total_bid_size: number;    // 총 매수 잔량
  orderbook_units: {
    ask_price: number;       // 매도 호가
    bid_price: number;       // 매수 호가
    ask_size: number;
    bid_size: number;
  }[];
}

/** 현재가 (GET /ticker) */
export interface UpbitTicker {
  market: string;
  trade_price: number;           // 최근 체결가
  trade_timestamp: number;
  acc_trade_price_24h: number;   // 24시간 누적 거래대금
  acc_trade_volume_24h: number;
  signed_change_rate: number;    // 부호 있는 변화율
  [key: string]: unknown;
}

// ── 그리드 봇 타입 ──
// 그리드 트레이딩 봇의 내부 상태 관리를 위한 타입 정의

/**
 * 그리드 레벨의 상태 전이:
 *   idle → buy_placed → holding → sell_placed → idle (한 사이클 완료)
 *
 *   - idle: 주문 없음, 새 매수 주문 배치 가능
 *   - buy_placed: 매수 지정가 주문 배치됨, 체결 대기 중
 *   - holding: 매수 체결 완료, 코인 보유 중 (매도 주문 배치 대기)
 *   - sell_placed: 매도 지정가 주문 배치됨, 체결 대기 중
 */
export type GridLevelStatus = "idle" | "buy_placed" | "holding" | "sell_placed";

/** 그리드의 개별 가격 단계 */
export interface GridLevel {
  index: number;           // 단계 번호 (0 = 최하단, N = 최상단)
  price: number;           // 이 단계의 기준 가격
  status: GridLevelStatus;
  orderUuid?: string;      // 현재 배치된 주문의 Upbit UUID
  buyPrice?: number;       // 실제 매수 체결가 (매도 시 수익 계산용)
  buyVolume?: number;      // 매수 체결 수량
  filledCount: number;     // 이 단계에서 누적 체결 횟수
}

/** 개별 거래 이력 (매수/매도) */
export interface GridTradeRecord {
  timestamp: number;
  side: "buy" | "sell";
  levelIndex: number;
  price: number;
  volume: number;
  fee: number;
  profit?: number;       // sell 시에만 (매도가 - 매수가 - 수수료)
  currentPrice: number;  // 체결 시점 시장가
}

/** 그리드 봇의 전체 상태 (JSON 파일로 백업/복구) */
export interface GridState {
  market: string;
  rangeUpper: number;         // 그리드 상단 가격
  rangeLower: number;         // 그리드 하단 가격
  gridInterval: number;       // 단계 간 가격 간격
  levels: GridLevel[];
  totalRealizedProfit: number; // 누적 실현 수익 (원)
  totalFees: number;           // 누적 수수료 (원)
  tradeCount: number;          // 총 거래 횟수
  dailyRealizedProfit: number; // 당일 실현 수익 (KST 0시 리셋)
  dailyDate: string;           // "YYYY-MM-DD" KST
  tradeHistory: GridTradeRecord[]; // 최근 200건 거래 이력
  startedAt: number;
  lastUpdatedAt: number;
}
