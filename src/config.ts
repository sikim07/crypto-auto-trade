/**
 * 봇 설정 상수 (하드코딩 금지, 여기서만 관리)
 */

/** 캔들/데이터 */
export const CANDLE_WINDOW_SIZE = 200;
export const CANDLE_WINDOW_SIZE_5M = 250;
export const CANDLE_UNIT_MINUTES = 1;

/** REST API */
export const UPBIT_BASE_URL = "https://api.upbit.com/v1";
export const REST_TIMEOUT_MS = 10000;

/** WebSocket */
export const WS_URL = "wss://api.upbit.com/websocket/v1";
export const WATCHDOG_TIMEOUT_MS = 60000;

/** 종목 선정 */
export const TARGET_MARKET_COUNT = 2;
/** 매수 없이 이 시간(분) 경과 시 종목 재선정 */
export const RE_SELECT_AFTER_NO_BUY_MINUTES = 60;
/** 캔들 거래량 보정용 REST 갱신 주기(ms) */
export const CANDLE_REFRESH_INTERVAL_MS = 60 * 1000;

/** 주문/잔고 */
/** @deprecated 매수 금액은 POSITION_PCT 기준으로 계산. 참고용 유지 */
export const BALANCE_USAGE_RATIO = 0.999;
export const MIN_RESERVE_KRW = 10000;
export const MIN_ORDER_KRW = 5000;
/** 매수 시 사용할 잔고 비율 (사용 가능 금액의 N%) */
export const POSITION_PCT = 0.03;

/** 수수료 (업비트 KRW 마켓 기본 0.05%, 쿠폰 미적용 시 0.25%) */
export const FEE_BUY_PCT = 0.05;
export const FEE_SELL_PCT = 0.05;
/** 시장가 슬리피지 예상치 (고변동 코인은 상향 조정 권장) */
export const SLIPPAGE_PCT = 0.15;
/** 총 거래 비용 = 왕복 수수료 + 슬리피지 */
export const COST_PCT = FEE_BUY_PCT + FEE_SELL_PCT + SLIPPAGE_PCT;
/** 익절 구간: 순수익이 이 구간 안에 있을 때 익절 */
export const TAKE_PROFIT_PCT_MIN = 1.5;
export const TAKE_PROFIT_PCT_MAX = 2.0;
/** 손절: 순수익이 이 값 이하일 때 손절 (상한 -2% 넘지 않도록 -1.5에서 절단) */
export const STOP_LOSS_PCT_MAX = -1.5;

/** RSI 익절 (순수익이 이 이상일 때만 RSI 70 이상에서 매도) */
export const RSI_TAKE_PROFIT = 70;
export const RSI_TAKE_PROFIT_MIN_PCT = 0.5;

/** 상태 확정 */
export const ORDER_WAIT_MS = 500;
export const CONFIRM_RETRY_MAX = 3;
export const CONFIRM_RETRY_INTERVAL_MS = 300;

/** 지표 기간 */
export const BB_PERIOD = 20;
export const BB_STD_MULT = 2;
export const RSI_PERIOD = 14;
export const ATR_PERIOD = 14;
export const MACD_FAST = 12;
export const MACD_SLOW = 26;
export const MACD_SIGNAL = 9;

/** 거래량 급증 비율 (직전 평균 대비) */
export const VOLUME_SURGE_RATIO = 1.5;
export const VOLUME_AVG_PERIOD = 20;

/** RSI 과매도 기준 (Wilder's RSI 기반, 1분봉 스캘핑용 완화) */
export const RSI_OVERSOLD = 35;
/** RSI 계산에 사용할 최근 캔들 수 (전체 200개 중 최근 N개만 사용하여 반응성 확보) */
export const RSI_LOOKBACK = 50;
/** RSI 반등 최소 증가폭 (직전 봉 대비) */
export const RSI_MIN_BOUNCE = 2;

/** 최대 보유 시간 (분) — 초과 시 강제 청산 */
export const MAX_HOLD_MINUTES = 30;

/** 트레일링 스톱: 순수익이 이 값 이상 도달 후 활성화 */
export const TRAILING_STOP_ACTIVATE_PCT = 0.8;
/** 트레일링 스톱: 고점 대비 이 폭만큼 하락 시 매도 */
export const TRAILING_STOP_OFFSET_PCT = 0.5;

/** 일일 최대 누적 손실(%) — 초과 시 당일 매매 중단 */
export const DAILY_MAX_LOSS_PCT = -5;

/** 전략 A: 저점 정밀 타격 — RSI 과매도 기준, 거래량 평균 봉 수 */
export const STRATEGY_A_RSI_OVERSOLD = 30;
export const STRATEGY_A_VOLUME_AVG_PERIOD = 5;
export const STRATEGY_A_ATR_STOP_MULT = 1.5;

/** 전략 C: 변동성 스퀴즈 — BB 폭 수축 상한, 거래량 비율, 몸통 비율, 트레일링 */
export const STRATEGY_C_BB_SQUEEZE_RATIO = 0.02;
export const STRATEGY_C_VOLUME_RATIO = 2;
export const STRATEGY_C_VOLUME_AVG_PERIOD = 10;
export const STRATEGY_C_BODY_RATIO_MIN = 0.6;
export const STRATEGY_C_TRAILING_ACTIVATE_PCT = 3;
export const STRATEGY_C_TRAILING_OFFSET_PCT = 1.5;

/** 전략 D: 순추세 모멘텀 — RSI 상향 돌파, 이격도, MA 기간, 손절 */
export const STRATEGY_D_RSI_CROSS = 60;
export const STRATEGY_D_VOLUME_RATIO = 1.5;
export const STRATEGY_D_VOLUME_AVG_PERIOD = 5;
export const STRATEGY_D_DISPLACEMENT_MAX = 1.02;
export const STRATEGY_D_MA_PERIODS = [5, 10, 20] as const;
export const STRATEGY_D_STOP_LOSS_PCT = -1.5;

/** 전략 E: 박스권 — BB 폭, 수평 기울기, RSI, 거래량 제외, 손절 */
export const STRATEGY_E_BB_WIDTH_LOOKBACK = 100;
export const STRATEGY_E_SLOPE_THRESHOLD_RATIO = 0.0002;
export const STRATEGY_E_BB_SLOPE_LOOKBACK = 20;
export const STRATEGY_E_RSI_OVERSOLD = 40;
export const STRATEGY_E_VOLUME_AVG_PERIOD = 5;
export const STRATEGY_E_VOLUME_EXCLUDE_RATIO = 2;
export const STRATEGY_E_STOP_BELOW_LOWER_RATIO = 0.99;
