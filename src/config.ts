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

/** 방향성 가중 변동성: 상승 종목 가중치 (rate × 이 값) */
export const SELECT_UPWARD_WEIGHT = 1.5;
/** 방향성 가중 변동성: 하락 종목 가중치 (|rate| × 이 값) */
export const SELECT_DOWNWARD_WEIGHT = 0.5;

/** 종목 선정 최대 하락률 필터 — 24h 등락률이 이 비율 이상 하락한 종목은 후보 제외 (10%) */
export const SELECT_MAX_DOWNWARD_RATE = 0.10;

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

/** RSI 익절 (순수익이 MIN_PCT 이상일 때만 RSI 70 하향 돌파 시 매도) */
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
/** 일일 잔여 여력 버퍼 — 잔여 여력이 이 값 미만이면 추가 매수 차단 (실질 차단선 = -5% + 1.5% = -3.5%) */
export const DAILY_LOSS_BUFFER_PCT = 1.5;

/** 전략별 ON/OFF — false면 매수 신호 차단 (매도 로직은 영향 없음) */
export const STRATEGY_A_ENABLED = false;
export const STRATEGY_B_ENABLED = false;
export const STRATEGY_C_ENABLED = false;
export const STRATEGY_D_ENABLED = false;
/** 전략 E 영구 비활성화 — BB하단 이탈 손절 구조상 손실 무제한. 유사 패턴 재추가 금지. */
export const STRATEGY_E_ENABLED = false;
export const STRATEGY_F_ENABLED = true;

/** 전략 A: 저점 정밀 타격 */
export const STRATEGY_A_AVOID_DOWNTEND = true;
export const STRATEGY_A_RSI_OVERSOLD = 30;
export const STRATEGY_A_VOLUME_AVG_PERIOD = 5;
/** 전략 A 손절: 진입가 - (ATR × 이 배수) 도달 시 손절 */
export const STRATEGY_A_ATR_STOP_MULTIPLIER = 1.5;
/** 전략 A 손절: 매수가 기준 최소 손절 거리 (%) — 이 값보다 가까운 손절가는 강제로 내림 */
/** 전략 A 손절: 매수가 기준 최소 손절 거리 (%) */
export const STRATEGY_A_MIN_STOP_DISTANCE_PCT = 1.3;
export const STRATEGY_A_MAX_HOLD_MINUTES = 10;
/** 전략 A 진입: BB 하단 기준 허용 버퍼 비율 — 1.01 = BB 하단 대비 1% 이내까지 허용 */
export const STRATEGY_A_BB_ENTRY_BUFFER = 1.01;
/** 전략 A 인트라캔들 RSI 조기 진입 임계값 — 마감봉 30보다 높게 설정해 노이즈 방지 */
export const STRATEGY_A_RSI_INTRACANDLE_THRESHOLD = 31;
export const STRATEGY_A_TRAILING_ACTIVATE_PCT = 0.8;
export const STRATEGY_A_TRAILING_OFFSET_PCT = 0.5;

/** 전략 B: MACD+RSI 모멘텀 */
export const STRATEGY_B_STOP_LOSS_PCT = -1.5;
export const STRATEGY_B_MAX_HOLD_MINUTES = 12;
/** 전략 B 단계별 쿨다운: 1회=10분, 2회=60분, 3회+=당일금지 */
export const STRATEGY_B_LOSS_COOLDOWN_2ND_MS = 60 * 60 * 1000;
export const STRATEGY_B_MAX_DAILY_LOSS_COUNT = 3;
export const STRATEGY_B_TRAILING_ACTIVATE_PCT = 0.8;
export const STRATEGY_B_TRAILING_OFFSET_PCT = 0.5;
/** 전략 B 손절 후 동일 종목 재진입 차단 시간(ms) */
export const STRATEGY_B_LOSS_COOLDOWN_MS = 10 * 60 * 1000;
/** 전략 B 매수 RSI 상한 — 과매수 끝물 진입 방지 */
export const STRATEGY_B_RSI_MAX = 65;
/** 전략 B MACD hist 최솟값 (현재가 대비 %) — 노이즈 골든크로스 차단 */
export const STRATEGY_B_HIST_MIN_PCT = 0.001;
/** 전략 B 데드크로스 손절 유예 시간(분) — 진입 직후 노이즈 방지. 하드 손절은 작동. */
export const STRATEGY_B_DEAD_CROSS_GRACE_MIN = 3;

/** 전략 C: 변동성 스퀴즈 */
export const STRATEGY_C_BB_SQUEEZE_RATIO = 0.02;
export const STRATEGY_C_VOLUME_RATIO = 2.5;
export const STRATEGY_C_VOLUME_AVG_PERIOD = 10;
export const STRATEGY_C_BODY_RATIO_MIN = 0.6;
export const STRATEGY_C_TRAILING_ACTIVATE_PCT = 0.8;
export const STRATEGY_C_TRAILING_OFFSET_PCT = 0.5;
export const STRATEGY_C_STOP_LOSS_PCT = -1.5;
export const STRATEGY_C_MAX_HOLD_MINUTES = 20;
/** 전략 C RSI 상한 — 과매수 거짓 돌파 차단 */
export const STRATEGY_C_RSI_MAX = 70;
/** 전략 C 손실 종목 쿨다운(ms) — 손절 후 30분 재진입 차단 */
export const STRATEGY_C_LOSS_COOLDOWN_MS = 30 * 60 * 1000;
/** 전략 C BB 중앙 손절 유예 시간(분) — 진입 직후 pull-back 허용 */
export const STRATEGY_C_BB_GRACE_MIN = 3;
/** 전략 C BB 중앙 손절 버퍼 (소수) — 중앙선 대비 이 비율 이상 하락해야 손절 발동 */
export const STRATEGY_C_BB_MIDDLE_BUFFER = 0.001;

/** 전략 D: 순추세 모멘텀 */
export const STRATEGY_D_RSI_CROSS = 60;
export const STRATEGY_D_VOLUME_RATIO = 2;
export const STRATEGY_D_VOLUME_AVG_PERIOD = 5;
export const STRATEGY_D_DISPLACEMENT_MAX = 1.02;
export const STRATEGY_D_DISPLACEMENT_MIN = 1.008;
/** 전략 D MA20 이탈 버퍼 — 하드 손절(-1.5%) 전에 추세 붕괴 감지 (0.3%) */
export const STRATEGY_D_MA20_BREAK_BUFFER = 0.003;
/** 종목 선정 최소 단가 — 저가 코인 틱 크기 문제 방지 (모든 전략에 일괄 적용) */
export const SELECT_MIN_PRICE = 200;

/** 종목 선정 눌림목 필터 — 24h 고점 대비 MIN~MAX% 눌린 종목 우선 (후보 없으면 폴백) */
export const SELECT_PULLBACK_MIN_PCT = 1.0;
export const SELECT_PULLBACK_MAX_PCT = 8.0;

export const STRATEGY_D_MAX_HOLD_MINUTES = 15;
export const STRATEGY_D_LOSS_COOLDOWN_MS = 30 * 60 * 1000;
export const STRATEGY_D_MA_PERIODS = [5, 10, 20] as const;
export const STRATEGY_D_STOP_LOSS_PCT = -1.5;
export const STRATEGY_D_MIN_PROFIT_BEFORE_MA5_EXIT = 0.5;
export const STRATEGY_D_TRAILING_ACTIVATE_PCT = 0.8;
export const STRATEGY_D_TRAILING_OFFSET_PCT = 0.5;
export const STRATEGY_D_RSI_MIN_CROSS_STRENGTH = 3;
export const STRATEGY_D_RSI_MAX = 75;

/** 전략 E: 박스권 (비활성화 — 참고용) */
export const STRATEGY_E_AVOID_DOWNTEND = true;
export const STRATEGY_E_BB_WIDTH_LOOKBACK = 100;
export const STRATEGY_E_SLOPE_THRESHOLD_RATIO = 0.0002;
export const STRATEGY_E_BB_SLOPE_LOOKBACK = 20;
export const STRATEGY_E_RSI_OVERSOLD = 40;
export const STRATEGY_E_VOLUME_AVG_PERIOD = 5;
export const STRATEGY_E_VOLUME_EXCLUDE_RATIO = 2;
export const STRATEGY_E_STOP_BELOW_LOWER_RATIO = 0.99;

/** 전략 F: VWAP 눌림목 반등 */
export const STRATEGY_F_EMA_PERIOD = 21;
/** VWAP 근접 허용 범위 (%) — VWAP 대비 이 이내이면 눌림목 위치 */
export const STRATEGY_F_PROXIMITY_PCT = 1.5;
/** RSI 반등 돌파 기준선 */
export const STRATEGY_F_RSI_CROSS = 38;
/** RSI 상한 — 과열 구간 진입 차단 */
export const STRATEGY_F_RSI_UPPER = 65;
/** 첫 반등 양봉만 진입 (true: 직전봉 음봉/도지 필수) */
export const STRATEGY_F_FIRST_GREEN_ONLY = false;
export const STRATEGY_F_MIN_VWAP_CANDLES_1M = 30;
export const STRATEGY_F_MIN_VWAP_CANDLES_5M = 6;
export const STRATEGY_F_STOP_LOSS_PCT = -1.5;
export const STRATEGY_F_MAX_HOLD_MINUTES = 15;
export const STRATEGY_F_TRAILING_ACTIVATE_PCT = 0.6;
export const STRATEGY_F_TRAILING_OFFSET_PCT = 0.5;
/**
 * 진입가 대비 이 % 이하로 떨어지면 진입 수준 이탈 손절
 * 0.4→0.7→1.0: 노이즈 내성 강화. 손절(-1.5%)과 0.5%p 간격으로 구조 이탈 신호 역할.
 */
export const STRATEGY_F_ENTRY_BREACH_PCT = 1.0;
/** 진입 후 이 초 동안은 진입 수준 이탈 손절 미적용 */
export const STRATEGY_F_ENTRY_BREACH_GRACE_SEC = 120;
/** F 매도 후 같은 종목 재진입 차단 시간(ms) — 수익/손실 무관 */
export const STRATEGY_F_COOLDOWN_MS = 5 * 60 * 1000;
/** F 손실 매도 후 동일 종목 재진입 차단 시간(ms) — 이중 쿨다운 */
export const STRATEGY_F_LOSS_COOLDOWN_MS = 30 * 60 * 1000;

/** EMA21 터치 확인 창 (봉 수) */
export const STRATEGY_F_EMA_TOUCH_WINDOW = 5;
/** EMA21 터치 허용 버퍼 (%) — EMA21보다 이 비율 위까지 터치로 인정 */
export const STRATEGY_F_EMA_TOUCH_BUFFER_PCT = 0.2;
/** VWAP 붕괴 손절 버퍼 (%) — VWAP 대비 이 비율 하락 시 VWAP 붕괴 판단 */
export const STRATEGY_F_VWAP_BUFFER_PCT = 0.3;
/** 거래량 필터 최소 비율 — 직전 N개 봉 평균 대비 */
export const STRATEGY_F_VOLUME_RATIO_MIN = 1.2;
export const STRATEGY_F_VOLUME_AVG_PERIOD = 3;
/** 트레일링 타이트닝: 최대 수익 ≥ 이 값이면 오프셋을 TIGHTEN_OFFSET으로 축소 */
export const STRATEGY_F_TRAILING_TIGHTEN_THRESHOLD = 1.5;
export const STRATEGY_F_TRAILING_TIGHTEN_OFFSET = 0.3;

/** EMA21 기울기 필터 — 직전 N+1봉 EMA 선형회귀로 수평/하향 판단 */
export const STRATEGY_F_EMA_SLOPE_LOOKBACK = 5;
/** EMA21 봉당 최소 상승률 (%) — 미만이면 수평/하향으로 진입 차단 */
export const STRATEGY_F_EMA_SLOPE_MIN_PCT = 0.01;

/** 레인지 위치 필터 — 최근 N봉 고저 레인지 내 현재가 위치로 상단 진입 차단 */
export const STRATEGY_F_RANGE_LOOKBACK = 20;
/** 레인지 내 최대 허용 위치 (0~1) — 이 값 초과 시 레인지 상단으로 판단해 진입 차단 */
export const STRATEGY_F_RANGE_MAX_POSITION = 0.70;

/**
 * VWAP 붕괴 유예 시간 (초) — 진입 후 이 시간 내에는 VWAP 버퍼를 2배로 확대
 *
 * 목적: 진입 직후 VWAP 재계산(새 캔들 close 반영)으로 인한 미세 이탈 방지
 * 로직: holdSec < 이 값이면 VWAP_BUFFER_PCT × 2 적용, 이후 기본 버퍼 복원
 * 급락 시: 확대 버퍼를 넘는 큰 이탈은 즉시 손절 (entry breach / hard stop 동작)
 */
export const STRATEGY_F_VWAP_BREACH_GRACE_SEC = 120;

/**
 * 종목별 일일 최대 매매 횟수 (전략 F) — KST 0시 기준 리셋
 *
 * 목적: 같은 종목 수익→재진입→손실 반복 패턴 방지
 * 근거: 로그 분석 결과 같은 종목 3회차 이후 매매는 전부 손실
 *       (PUNDIX 7회, PRL 5회 — 후반부 전패)
 * 손실 쿨다운(30분)과 역할 분리: 쿨다운은 손실 후만 적용,
 *   이 제한은 수익 매도 후 재진입 반복도 차단
 */
export const STRATEGY_F_MAX_DAILY_TRADES_PER_TICKER = 2;

/** 레짐 필터: 급락·패닉·BTC MA 추세 */
export const REGIME_CRASH_LOOKBACK = 6;
export const REGIME_CRASH_PCT = -2.0;
export const REGIME_CRASH_COOLDOWN_MS = 30 * 60 * 1000;
export const REGIME_PANIC_VOLUME_RATIO = 3.0;
export const REGIME_PANIC_VOLUME_LOOKBACK = 19;
export const REGIME_CACHE_MS = 60 * 1000;

/** BTC MA 추세 필터 — MA5 < MA30이면 하락 추세로 매수 전면 차단 */
export const REGIME_TREND_FILTER_ENABLED = true;
export const REGIME_BTC_MA_FAST = 5;
export const REGIME_BTC_MA_SLOW = 30;
/** 히스테리시스 밴드 (0.2%) — 차단/해제 토글 방지 */
export const REGIME_BTC_MA_HYSTERESIS_BAND = 0.002;
