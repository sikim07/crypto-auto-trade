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
/** 전략 A 손절: 진입가 - (ATR × 이 배수) 도달 시 손절 */
export const STRATEGY_A_ATR_STOP_MULTIPLIER = 1.5;
/** 전략 A 손절: 매수가 기준 최소 손절 거리 (%) — 이 값보다 가까운 손절가는 강제로 내림 */
export const STRATEGY_A_MIN_STOP_DISTANCE_PCT = 1.0;
/** 전략 A 최대 보유 시간 (분) — 초과 시 BB 중앙 미도달이어도 현재가 청산 */
export const STRATEGY_A_MAX_HOLD_MINUTES = 7;
/** 전략 A 진입: BB 하단 기준 허용 버퍼 비율 — 1.01 = BB 하단 대비 1% 이내까지 허용 */
export const STRATEGY_A_BB_ENTRY_BUFFER = 1.01;
/** 전략 A 인트라캔들 RSI 조기 진입 임계값 — 마감봉 30보다 높게 설정해 노이즈 방지 */
export const STRATEGY_A_RSI_INTRACANDLE_THRESHOLD = 31;

/** 전략 B: 멀티타임프레임 MACD+RSI 모멘텀 — 손절, 최대 보유 */
export const STRATEGY_B_STOP_LOSS_PCT = -1.5;
export const STRATEGY_B_MAX_HOLD_MINUTES = 12;

/** 전략 C: 변동성 스퀴즈 — BB 폭 수축 상한, 거래량 비율, 몸통 비율, 트레일링, 손절, 최대 보유 */
export const STRATEGY_C_BB_SQUEEZE_RATIO = 0.02;
export const STRATEGY_C_VOLUME_RATIO = 2;
export const STRATEGY_C_VOLUME_AVG_PERIOD = 10;
export const STRATEGY_C_BODY_RATIO_MIN = 0.6;
export const STRATEGY_C_TRAILING_ACTIVATE_PCT = 2;
export const STRATEGY_C_TRAILING_OFFSET_PCT = 1.5;
export const STRATEGY_C_STOP_LOSS_PCT = -1.5;
export const STRATEGY_C_MAX_HOLD_MINUTES = 20;

/** 전략 D: 순추세 모멘텀 — RSI 상향 돌파, 이격도, MA 기간, 손절 */
export const STRATEGY_D_RSI_CROSS = 60;
export const STRATEGY_D_VOLUME_RATIO = 1.5;
export const STRATEGY_D_VOLUME_AVG_PERIOD = 5;
export const STRATEGY_D_DISPLACEMENT_MAX = 1.02;
/** 전략 D 이격도 최소값 — MA20 대비 이 비율 이상이어야 진입 (노이즈 청산 허용 범위 확보) */
export const STRATEGY_D_DISPLACEMENT_MIN = 1.008;
/** 전략 D MA20 이탈 버퍼 — MA20 대비 이 비율만큼 하락해야 추세 붕괴로 판단 (정상 노이즈 청산 방지) */
export const STRATEGY_D_MA20_BREAK_BUFFER = 0.005;
/** 전략 D 최소 가격 — 이 가격 미만 코인은 진입 차단 (저가 코인 호가 단위 문제 방지) */
export const STRATEGY_D_MIN_PRICE = 100;
/** 전략 D 최대 보유 시간(분) — 초과 시 강제 매도 */
export const STRATEGY_D_MAX_HOLD_MINUTES = 15;
/** 전략 D 손실 종목 쿨다운(ms) — 손실 거래 후 이 시간 동안 재진입 차단 */
export const STRATEGY_D_LOSS_COOLDOWN_MS = 30 * 60 * 1000;
export const STRATEGY_D_MA_PERIODS = [5, 10, 20] as const;
export const STRATEGY_D_STOP_LOSS_PCT = -1.5;
/** MA5 하향 이탈 시 익절로 매도하려면 넘어야 할 최소 순수익률(%) — 수수료·슬리피지 안전 마진 */
export const STRATEGY_D_MIN_PROFIT_BEFORE_MA5_EXIT = 0.5;
/** 전략 D 소수익 보호 트레일링 스톱 활성화 임계(%) — 순수익이 이 값 이상 도달 시 트레일링 시작 */
export const STRATEGY_D_TRAILING_ACTIVATE_PCT = 0.3;
/** 전략 D 소수익 보호 트레일링 허용 낙폭(%p) — 고점 대비 이 값 이상 하락 시 청산 */
export const STRATEGY_D_TRAILING_OFFSET_PCT = 0.4;
/** 전략 D RSI 크로스 최소 강도 — rsiCur - rsiPrev 가 이 값 이상이어야 유효 돌파로 인정 */
export const STRATEGY_D_RSI_MIN_CROSS_STRENGTH = 3;

/** 전략 E: 박스권 — BB 폭, 수평 기울기, RSI, 거래량 제외, 손절 */
export const STRATEGY_E_BB_WIDTH_LOOKBACK = 100;
export const STRATEGY_E_SLOPE_THRESHOLD_RATIO = 0.0002;
export const STRATEGY_E_BB_SLOPE_LOOKBACK = 20;
export const STRATEGY_E_RSI_OVERSOLD = 40;
export const STRATEGY_E_VOLUME_AVG_PERIOD = 5;
export const STRATEGY_E_VOLUME_EXCLUDE_RATIO = 2;
export const STRATEGY_E_STOP_BELOW_LOWER_RATIO = 0.99;

/** 전략 F: VWAP 눌림목 반등 */
export const STRATEGY_F_EMA_PERIOD = 21;
/** VWAP/EMA21 근접 허용 범위 (%) — 이 이내이면 눌림목 위치로 판단 */
export const STRATEGY_F_PROXIMITY_PCT = 0.5;
/** RSI 반등 돌파 기준선 — rsiPrev < 이 값 → rsiCur ≥ 이 값 */
export const STRATEGY_F_RSI_CROSS = 40;
/** 1분봉 VWAP 유효성 최소 당일 캔들 수 (30분 경과 보장) */
export const STRATEGY_F_MIN_VWAP_CANDLES_1M = 30;
/** 5분봉 VWAP 유효성 최소 당일 캔들 수 (5분봉 6개 = 30분 경과 보장) */
export const STRATEGY_F_MIN_VWAP_CANDLES_5M = 6;
export const STRATEGY_F_STOP_LOSS_PCT = -1.5;
export const STRATEGY_F_MAX_HOLD_MINUTES = 15;
export const STRATEGY_F_TRAILING_ACTIVATE_PCT = 1.0;
export const STRATEGY_F_TRAILING_OFFSET_PCT = 0.5;
/** 진입가 대비 이 % 이하로 떨어지면 진입 수준 이탈 손절 (진입봉 저가 대신 사용) */
export const STRATEGY_F_ENTRY_BREACH_PCT = 0.3;

/** 레짐: 하드 차단만 (급락·패닉 시 매수 중단, downtrend+RS 미사용) */
/** 급락 감지 lookback (5분봉 개수, 6개 = 30분) */
export const REGIME_CRASH_LOOKBACK = 6;
/** 30분 내 BTC 낙폭이 이 값 이하이면 급락으로 판단 (%) */
export const REGIME_CRASH_PCT = -2.0;
/** 급락 감지 후 매수 재개까지의 쿨다운(ms) */
export const REGIME_CRASH_COOLDOWN_MS = 30 * 60 * 1000;
/** 패닉 거래량: 직전 평균 대비 이 배수 초과 시 패닉 */
export const REGIME_PANIC_VOLUME_RATIO = 3.0;
/** 패닉 볼륨 평균 산출에 사용할 직전 5분봉 수 */
export const REGIME_PANIC_VOLUME_LOOKBACK = 19;
/** 레짐 캐시 유효 시간(ms) */
export const REGIME_CACHE_MS = 60 * 1000;
