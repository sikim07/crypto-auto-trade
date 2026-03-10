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

/**
 * ──────────────────────────────────────────────────────────────
 * [수정 이유] 2026-03-06~08 분석 결과, 6개 전략이 동시 운용되면서
 *   서로 다른 방향의 신호가 동일 종목에 중복 진입하는 문제 발생.
 *   (ex. KAVA에 전략 D·F 동시, STEEM에 A·B·F 혼재)
 *
 * [목적] 전략별 ON/OFF 플래그를 통해
 *   - 성과 부진 전략을 코드 수정 없이 즉시 비활성화
 *   - 검증된 1~2개 전략에 집중해 손익비 개선
 *   - 단계적 전략 추가·제거 테스트 가능
 *
 * [사용법] false 로 바꾸면 해당 전략 매수 신호 전면 차단
 *   → 매도 로직은 영향 없음 (이미 진입한 포지션은 그대로 청산됨)
 *
 * [앞으로 확인할 것]
 *   - 3일 이상 실전 관찰 후 전략별 승률·손익 비교
 *   - 특정 전략 false 후 매매 횟수가 줄었는지 로그로 확인
 *   - E전략: 신호 발생 빈도가 극히 낮으므로 false 후 효과 관찰 권장
 * ──────────────────────────────────────────────────────────────
 */
export const STRATEGY_A_ENABLED = true;
export const STRATEGY_B_ENABLED = true;
export const STRATEGY_C_ENABLED = true;
export const STRATEGY_D_ENABLED = true;
export const STRATEGY_E_ENABLED = true;
export const STRATEGY_F_ENABLED = true;

/** 전략 A: 저점 정밀 타격 — RSI 과매도 기준, 거래량 평균 봉 수 */
/** 역추세 전략 A: 하락장 진입 차단 — 5분봉 MA5 < MA20 이면 매수 스킵 (횡보/상승에서만 동작) */
export const STRATEGY_A_AVOID_DOWNTEND = true;
export const STRATEGY_A_RSI_OVERSOLD = 30;
export const STRATEGY_A_VOLUME_AVG_PERIOD = 5;
/** 전략 A 손절: 진입가 - (ATR × 이 배수) 도달 시 손절 */
export const STRATEGY_A_ATR_STOP_MULTIPLIER = 1.5;
/** 전략 A 손절: 매수가 기준 최소 손절 거리 (%) — 이 값보다 가까운 손절가는 강제로 내림 */
/**
 * [3차 개선] 1.0 → 1.3
 * 이유: SLIPPAGE_PCT 현실화(0.15→추후 0.30) 대응 및 1분봉 단기 변동성 흡수 공간 확보.
 *      이전 1.0% 기준에서 "최소거리보장" 손절이 진입 20초 만에 발동하는 사례 확인
 *      (2026-03-10 11:21: 87원 매수 → 86원 즉시 손절).
 *      1.3%로 넓혀 정상 변동성 내 노이즈 손절 감소 목적.
 * 확인할 것:
 *   - 손절 사유가 "최소거리보장"인 케이스 감소 여부 로그 모니터링.
 *   - 반대로 손실이 1.3% 이상으로 커지는 케이스가 증가하면 1.1~1.2%로 재조정.
 */
export const STRATEGY_A_MIN_STOP_DISTANCE_PCT = 1.3;
/**
 * [3차 개선] 7 → 10
 * 이유: 역추세 반등 사이클이 완성되려면 7분으로는 부족한 케이스 반복 확인.
 *      (2026-03-10 14:04: 최대 +0.41% 도달 후 7분 시간초과 -0.14% 손실 마감).
 *      10분으로 연장해 BB 중앙 도달 가능성 확보. 단, 과도한 연장은 손실 누적 위험.
 * 확인할 것:
 *   - 7~10분 사이에 BB 중앙 도달하여 익절하는 케이스 증가 여부.
 *   - 오히려 10분간 하락이 지속되는 케이스가 많으면 8~9분으로 조정.
 */
export const STRATEGY_A_MAX_HOLD_MINUTES = 10;
/** 전략 A 진입: BB 하단 기준 허용 버퍼 비율 — 1.01 = BB 하단 대비 1% 이내까지 허용 */
export const STRATEGY_A_BB_ENTRY_BUFFER = 1.01;
/** 전략 A 인트라캔들 RSI 조기 진입 임계값 — 마감봉 30보다 높게 설정해 노이즈 방지 */
export const STRATEGY_A_RSI_INTRACANDLE_THRESHOLD = 31;
/**
 * ──────────────────────────────────────────────────────────────
 * [3차 개선 신규] 전략 A 트레일링 스톱
 *
 * [수정 이유]
 *   기존 A 전략 익절 조건이 "BB 중앙 도달" 단일 조건이어서,
 *   BB 중앙 미도달 시 최대보유 시간초과로만 청산 → 수익 기회 낭비.
 *   (2026-03-10 14:04: 최대 +0.41%를 찍고 7분 시간초과 -0.14% 마감)
 *
 * [목적]
 *   +0.8% 도달 시 트레일링 스톱 활성화 → 고점 대비 0.5% 하락 시 익절.
 *   BB 중앙까지 못 가더라도 일정 수익 구간에서 수익을 보존.
 *   BB 중앙 도달 익절은 그대로 유지 (트레일링 미발동 시 기존 흐름 유지).
 *
 * [앞으로 확인할 것]
 *   - [BT] A 매도 type=트레일링 로그 빈도 모니터링.
 *   - 트레일링 청산 후 실제로 추가 상승이 있었는지 사후 확인
 *     (있으면 TRAILING_ACTIVATE_PCT 상향 또는 TRAILING_OFFSET_PCT 완화 검토).
 *   - 트레일링이 너무 자주 발동해 BB 중앙 익절보다 낮은 수익으로 마감되면
 *     TRAILING_ACTIVATE_PCT 1.0~1.2%로 상향 검토.
 * ──────────────────────────────────────────────────────────────
 */
/** 전략 A 트레일링 스톱 활성화 임계값(%) — 순수익이 이 값 이상 도달 시 트레일링 시작 */
export const STRATEGY_A_TRAILING_ACTIVATE_PCT = 0.8;
/** 전략 A 트레일링 스톱 허용 낙폭(%p) — 고점 순수익 대비 이 값 이상 하락 시 청산 */
export const STRATEGY_A_TRAILING_OFFSET_PCT = 0.5;

/** 전략 B: 멀티타임프레임 MACD+RSI 모멘텀 — 손절, 최대 보유 */
export const STRATEGY_B_STOP_LOSS_PCT = -1.5;
export const STRATEGY_B_MAX_HOLD_MINUTES = 12;

/** 전략 C: 변동성 스퀴즈 — BB 폭 수축 상한, 거래량 비율, 몸통 비율, 트레일링, 손절, 최대 보유 */
export const STRATEGY_C_BB_SQUEEZE_RATIO = 0.02;
/** 직전 평균 대비 이 배수 이상일 때만 진입 (2.5 = 250%, 압도적 거래량 돌파 시에만) */
export const STRATEGY_C_VOLUME_RATIO = 2.5;
export const STRATEGY_C_VOLUME_AVG_PERIOD = 10;
export const STRATEGY_C_BODY_RATIO_MIN = 0.6;
/**
 * [3차 개선] TRAILING_ACTIVATE_PCT: 2 → 0.8, TRAILING_OFFSET_PCT: 1.5 → 0.5
 *
 * [수정 이유]
 *   기존 활성화 기준 2%는 실제 최대 수익(0.8~1.2% 구간)보다 높아 트레일링이 한 번도
 *   발동하지 않는 문제 확인. BB 중앙 하향 조건이 먼저 발동해 수익을 환원.
 *   (2026-03-10 05:25: 최대 +0.81% → BB중앙 하향 -0.12% 손절)
 *   (2026-03-10 06:13: 최대 +1.19% → BB중앙 하향 +0.01% 청산)
 *   또한 checkSellSignalC 내 트레일링 체크 순서를 BB중앙 체크보다 앞으로 이동.
 *   수익 중에는 BB중앙 하향보다 트레일링이 우선 발동하도록 구조 변경.
 *
 * [목적]
 *   +0.8% 도달 시 즉시 트레일링 활성화 → 고점 대비 0.5% 하락 시 익절 청산.
 *   (예: 최대 1.19% → 트레일링 발동 시 약 +0.69%로 마감 ← 기존 +0.01% 대비 대폭 개선)
 *
 * [앞으로 확인할 것]
 *   - [BT] C 매도 type=트레일링 vs BB중앙하향 비율 모니터링.
 *     트레일링 비율이 높아지면 진입 품질 개선 확인됨.
 *   - 트레일링 발동 후 추가 상승이 자주 있으면 TRAILING_OFFSET_PCT 0.6~0.8%로 완화 검토.
 *   - 0.8% 미만 수익에서 BB중앙 하향으로 손절 나가는 케이스가 줄었는지 확인.
 */
export const STRATEGY_C_TRAILING_ACTIVATE_PCT = 0.8;
export const STRATEGY_C_TRAILING_OFFSET_PCT = 0.5;
export const STRATEGY_C_STOP_LOSS_PCT = -1.5;
export const STRATEGY_C_MAX_HOLD_MINUTES = 20;

/** 전략 D: 순추세 모멘텀 — RSI 상향 돌파, 이격도, MA 기간, 손절 */
export const STRATEGY_D_RSI_CROSS = 60;
/** 직전 평균 대비 이 배수 초과일 때만 진입 (2 = 200%, 압도적 거래량 시에만) */
export const STRATEGY_D_VOLUME_RATIO = 2;
export const STRATEGY_D_VOLUME_AVG_PERIOD = 5;
export const STRATEGY_D_DISPLACEMENT_MAX = 1.02;
/** 전략 D 이격도 최소값 — MA20 대비 이 비율 이상이어야 진입 (노이즈 청산 허용 범위 확보) */
export const STRATEGY_D_DISPLACEMENT_MIN = 1.008;
/** 전략 D MA20 이탈 버퍼 — MA20 대비 이 비율만큼 하락해야 추세 붕괴로 판단. 0.008로 완화해 휩쏘 감소(진입 이격도 대비 과도한 손절 방지). */
export const STRATEGY_D_MA20_BREAK_BUFFER = 0.008;
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
/** 전략 D 소수익 보호 트레일링 스톱 활성화 임계(%) — 순수익이 이 값 이상 도달 시 트레일링 시작. 0.8로 상향해 1분봉 노이즈에 과도하게 걸리지 않게 하고, 손절 폭의 절반 이상 수익 확보 후 트레일링으로 손익비 개선 목적. */
export const STRATEGY_D_TRAILING_ACTIVATE_PCT = 0.8;
/** 전략 D 소수익 보호 트레일링 허용 낙폭(%p) — 고점 대비 이 값 이상 하락 시 청산. 0.5로 완화해 일시 조정에 덜 잘려나가도록. */
export const STRATEGY_D_TRAILING_OFFSET_PCT = 0.5;
/** 전략 D RSI 크로스 최소 강도 — rsiCur - rsiPrev 가 이 값 이상이어야 유효 돌파로 인정 */
export const STRATEGY_D_RSI_MIN_CROSS_STRENGTH = 3;
/** 전략 D RSI 상한 — 이 값 초과 시 매수하지 않음. 과매수 끝물 진입을 막아 진입 직후 조정으로 MA20 이탈/휩쏘에 휩쓸리는 비율 감소 목적. */
export const STRATEGY_D_RSI_MAX = 75;

/** 전략 E: 박스권 — BB 폭, 수평 기울기, RSI, 거래량 제외, 손절 */
/** 역추세 전략 E: 하락장 진입 차단 — 5분봉 MA5 < MA20 이면 매수 스킵 (횡보에서만 동작) */
export const STRATEGY_E_AVOID_DOWNTEND = true;
export const STRATEGY_E_BB_WIDTH_LOOKBACK = 100;
export const STRATEGY_E_SLOPE_THRESHOLD_RATIO = 0.0002;
export const STRATEGY_E_BB_SLOPE_LOOKBACK = 20;
export const STRATEGY_E_RSI_OVERSOLD = 40;
export const STRATEGY_E_VOLUME_AVG_PERIOD = 5;
export const STRATEGY_E_VOLUME_EXCLUDE_RATIO = 2;
export const STRATEGY_E_STOP_BELOW_LOWER_RATIO = 0.99;

/** 전략 F: VWAP 눌림목 반등 (반등 시점 당김 적용) */
export const STRATEGY_F_EMA_PERIOD = 21;
/**
 * VWAP/EMA21 근접 허용 범위 (%) — 이 이내이면 눌림목 위치로 판단.
 * 기존 0.4. 반등 당김: 0.5로 완화해 지지 터치 직후 진입 여지 확대.
 */
export const STRATEGY_F_PROXIMITY_PCT = 0.5;
/**
 * RSI 반등 돌파 기준선 — rsiPrev < 이 값 → rsiCur ≥ 이 값.
 *
 * [1차 수정] 42 → 38 (반등 당김): 모멘텀 상향 전환을 더 이른 시점에 포착.
 *   이후 38 → 40으로 상향 (보수적 조정): RSI 38 진입 시 허수 반등 손절 빈발.
 *
 * [2차 수정] 40 → 38 복원
 *   이유: 40 상향 이후 [조건 7] EMA21 확정 지지 조건이 추가됨으로써
 *         허수 반등 차단 역할을 EMA21 터치 확인이 대신하게 됨.
 *         RSI 조기 진입의 단점(허수 반등)을 EMA21 터치 조건으로 상쇄하므로
 *         반등 초입 타이밍 확보를 위해 38로 복원.
 *   목적: 눌림목 반등의 초입(RSI 38 크로스)에서 진입해 상승 여력 최대화.
 *   확인할 것:
 *   - [조건 7]과 함께 진입이탈 손절 빈도가 감소하는지 확인 (38 단독 시절과 비교).
 *   - RSI 38 복원 후에도 손절이 빈번하면 39~40으로 재상향 검토.
 */
export const STRATEGY_F_RSI_CROSS = 38;
/**
 * true: 직전 마감봉이 음봉 또는 도지(close ≤ open)일 때만 마감봉 양봉 인정 → "첫 반등 양봉"만 진입.
 * false: 마감봉 양봉이기만 하면 진입(기존). 반등 당김 시 true 권장.
 */
export const STRATEGY_F_FIRST_GREEN_ONLY = true;
/** 1분봉 VWAP 유효성 최소 당일 캔들 수 (30분 경과 보장) */
export const STRATEGY_F_MIN_VWAP_CANDLES_1M = 30;
/** 5분봉 VWAP 유효성 최소 당일 캔들 수 (5분봉 6개 = 30분 경과 보장) */
export const STRATEGY_F_MIN_VWAP_CANDLES_5M = 6;
export const STRATEGY_F_STOP_LOSS_PCT = -1.5;
export const STRATEGY_F_MAX_HOLD_MINUTES = 15;
export const STRATEGY_F_TRAILING_ACTIVATE_PCT = 1.0;
export const STRATEGY_F_TRAILING_OFFSET_PCT = 0.5;
/**
 * 진입가 대비 이 % 이하로 떨어지면 진입 수준 이탈 손절 (진입봉 저가 대신 사용)
 * 
 * [개선] 0.4% → 0.7%로 완화 (보수적 설정)
 * 목적: 정상적인 가격 변동성에 대한 여유를 주어 조기 손절 방지
 * 이유: 로그 분석 결과 진입이탈 손절이 3회 발생(-0.77%, -0.65%, -0.77%).
 *      0.4% 기준이 변동성 큰 시장에서 너무 좁아 정상 변동에도 손절되는 문제 발생.
 *      0.7%로 완화하여 변동성 흡수 가능하도록 조정. 백테스트 후 필요시 0.8%까지 완화 가능.
 */
export const STRATEGY_F_ENTRY_BREACH_PCT = 0.7;
/** 진입 후 이 초 동안은 진입 수준 이탈 손절 미적용 */
export const STRATEGY_F_ENTRY_BREACH_GRACE_SEC = 90;
/** F 매도 후 같은 종목 F 재진입 차단 시간(ms) */
export const STRATEGY_F_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * 전략 F 손실 종목 쿨다운 (ms) — 손실 매도 후 동일 종목 F 재진입 차단 시간
 *
 * [2차 신규] 기존 단일 쿨다운(5분, 손익 무관)에서 손실 전용 쿨다운 분리.
 *   이유: 로그 분석 결과 5분 쿨다운 만료 후 동일 종목에 손실이 반복되는 패턴 확인
 *         (KRW-KITE 4회 연속 진입, 2회 손절 + 2회 시간초과).
 *         손실 거래는 해당 종목 시장이 약세임을 의미하므로 더 긴 관망 구간 필요.
 *   목적: 손실 후 15분 차단으로 반복 진입 방지. 수익 후는 기존 5분 유지
 *         (시장 강세 시 재진입 기회 허용).
 *   확인할 것:
 *   - 15분 이내에 같은 종목 반등이 유효한 진입 기회를 제공하는지 사후 확인.
 *   - 차단이 과도해 수익 기회가 줄면 10분으로 단축 검토.
 */
export const STRATEGY_F_LOSS_COOLDOWN_MS = 15 * 60 * 1000;

/**
 * EMA21 터치 확인 창 (봉 수) — [조건 7] 체크에 사용할 직전 마감봉 수
 *
 * [2차 신규] EMA21 확정 지지 조건 도입.
 *   이 값을 늘리면 더 오래된 터치도 인정해 신호 빈도 증가,
 *   줄이면 최근 터치만 인정해 신호 빈도 감소.
 */
/** EMA21 터치 확인 창 (봉 수) — 직전 마감봉 수. 3→5: 터치 인정 범위 확장, 신호 과소 개선 */
export const STRATEGY_F_EMA_TOUCH_WINDOW = 5;

/**
 * EMA21 터치 허용 버퍼 (%) — 저가가 EMA21 × (1 + 이 값/100) 이하이면 터치로 판정
 *
 * [2차 신규] 현재봉 기준 EMA21과 과거봉 시점의 실제 EMA21 사이 미세 차이 흡수.
 *   0.2%: EMA21보다 0.2% 위까지의 저가도 "터치"로 인정.
 *   확인할 것:
 *   - 버퍼가 너무 크면 터치 조건이 유명무실해짐 (0.1%로 축소 검토).
 *   - 신호 발생 빈도가 과도하게 줄면 0.3~0.5%로 완화.
 */
export const STRATEGY_F_EMA_TOUCH_BUFFER_PCT = 0.2;

/**
 * VWAP 붕괴 손절 버퍼 (%) — VWAP 대비 이 비율만큼 하락해야 VWAP 붕괴로 판단
 * 
 * [신규 추가] (보수적 설정)
 * 목적: 일시적인 가격 하락(꼬리 달기, Under-shooting)에 대한 방어
 * 이유: 로그 분석 결과 VWAP=69, 현재가=69로 즉시 손절되는 사례 발생.
 *      VWAP와 정확히 같거나 약간 하회하는 일시적 하락을 허용하여 불필요한 손절 방지.
 *      0.3% 버퍼로 설정. 백테스트 후 필요시 0.2% 또는 0.4%로 조정 가능.
 */
export const STRATEGY_F_VWAP_BUFFER_PCT = 0.3;

/**
 * 거래량 필터 최소 비율 — 1분봉 현재 거래량이 직전 N개 봉 평균 대비 이 비율 이상일 때만 진입
 * 
 * [신규 추가] (보수적 설정)
 * 목적: 눌림목 반등 시 거래량 증가를 확인하여 허수 반등 진입 방지
 * 이유: 거래량이 증가하지 않은 반등은 약한 반등일 가능성이 높음.
 *      직전 3개 봉 평균 대비 1.2배 이상일 때만 진입하여 진입 품질 개선.
 *      백테스트 후 필요시 1.0(필터 해제) 또는 1.5로 조정 가능.
 */
export const STRATEGY_F_VOLUME_RATIO_MIN = 1.2;
export const STRATEGY_F_VOLUME_AVG_PERIOD = 3; // 직전 N개 봉 평균

/**
 * 트레일링 스톱 타이트닝 기준 (%) — 최대 수익이 이 값을 돌파하면 트레일링 스톱 오프셋을 타이트하게 조정
 *
 * [1차 수정] 신규 도입: 최대수익 1.5% 이상 시 오프셋 0.5% → 0.3%로 타이트닝.
 *   목적: 높은 수익 구간에서 수익 보존 강화.
 *   이유: 로그 분석 결과 AGLD 최대 2.17%까지 갔으나 1.51%에서 청산(0.66% 하락).
 *
 * [2차 수정] 1.5 → 1.0
 *   이유: 1.5% 기준은 발동 빈도가 너무 낮음. 로그 분석에서 최대수익이
 *         1.0~1.3% 구간에 머무는 경우 기본 오프셋 0.5% 그대로 적용되어
 *         고점 대비 0.5%p 손실 후 청산되는 패턴 확인
 *         (예: 1회차 KRW-PLUME 최대 1.27% → 0.77% 청산, 0.5% 손실).
 *   목적: 최대수익 1.0% 도달 즉시 타이트 오프셋(0.3%) 적용, 수익 보존 강화.
 *   확인할 것:
 *   - 타이트닝으로 인한 조기 청산 빈도 모니터링.
 *   - 최대수익 1.0~1.5% 구간에서 청산 후 추가 상승 여부 사후 확인.
 *   - 조기 청산이 빈번하면 1.2%로 재상향 검토.
 */
export const STRATEGY_F_TRAILING_TIGHTEN_THRESHOLD = 1.0;
export const STRATEGY_F_TRAILING_TIGHTEN_OFFSET = 0.3;

/**
 * ──────────────────────────────────────────────────────────────
 * [2차 개선] EMA21 기울기 필터
 *
 * [수정 이유]
 *   로그 분석 결과 KRW-KITE에 3회 연속 진입 시 매번 EMA21이 수평(456원 고정) 상태.
 *   EMA21이 수평이면 가격을 밀어올리는 힘이 없어 "VWAP 눌림목 반등"이 아닌
 *   박스권 상단 매수와 동일한 패턴이 반복됨:
 *     02:31 진입: price=456, EMA21=456(수평) → 15분 횡보 시간초과 (-0.25%)
 *     02:58 진입: price=456, EMA21=456(수평) → 15분 횡보 시간초과 (-0.25%)
 *   반면 성공 케이스(04:23 KITE +0.81%)는 EMA21이 470으로 상승 중이었음.
 *
 * [판단 기준]
 *   직전 LOOKBACK개 봉의 EMA21 값을 구해 선형회귀 기울기 산출.
 *   기울기를 EMA21 현재값으로 정규화(봉당 %) → 최소 상승률 미만이면 수평/하향으로 판단해 차단.
 *
 * [기존 조건 7(EMA21 터치 확인)과의 차이]
 *   조건 7: EMA21에 저가가 닿았다가 종가가 회복했는지 (지지 확인)
 *   조건 8(기울기): EMA21 자체가 상승 방향인지 (추세 방향 확인)
 *   두 조건이 함께 적용되면, EMA21에서 반등했고(조건 7) + EMA21도 오르는 중(조건 8)인
 *   진정한 눌림목 반등만 진입 허용.
 *
 * [트레이드오프]
 *   급반등 초기 구간(EMA가 아직 꺾이지 않음)에서 신호 누락 가능.
 *   SLOPE_MIN_PCT를 너무 높이면 초기 반등을 놓침 → 0.01%로 보수 설정.
 *
 * [앞으로 확인할 것]
 *   - [BT] 로그의 emaSlopePct 분포를 보고 임계값 조정
 *     (차단이 너무 잦으면 0.005%로 하향, 여전히 수평 진입 시 0.02~0.05%로 상향)
 *   - SLOPE_LOOKBACK을 3으로 줄이면 기울기 반응이 빨라지나 노이즈 증가
 * ──────────────────────────────────────────────────────────────
 */
/** EMA21 기울기 계산에 사용할 과거 봉 수 (직전 N+1봉의 EMA 값으로 회귀선 기울기 산출) */
export const STRATEGY_F_EMA_SLOPE_LOOKBACK = 5;
/** EMA21 봉당 최소 상승률 (%) — 이 값 미만이면 수평/하향으로 판단해 진입 차단 */
export const STRATEGY_F_EMA_SLOPE_MIN_PCT = 0.01;

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

/**
 * ──────────────────────────────────────────────────────────────
 * [수정 이유] 기존 레짐 필터는 BTC 30분 낙폭 -2% 이상(급락)일 때만 차단.
 *   이 기준이 너무 극단적이어서 완만한 하락 추세(-0.5~-1.5%/h)에서도
 *   모든 전략이 계속 매수 신호를 내고 반복 손절되는 문제 발생.
 *   (2026-03-07: KAVA·AKT·STEEM 등 하락 추세 종목에 16회 매매 중 손절 11회)
 *
 * [목적] BTC 5분봉 MA 추세 필터로 완만한 하락 추세도 조기 차단.
 *   - MA 단기(5봉=25분) < MA 장기(20봉=100분) 이면 하락 추세로 판단
 *   - 전략 A·B·C·D·E·F 무관하게 매수 신호 전면 차단
 *   - 추세 전환 시(MA 복귀) 자동 해제
 *
 * [적용 흐름]
 *   marketRegime.ts → isBtcBearTrend() → getMarketRegime().bearTrend
 *   index.ts → regime.bearTrend 체크 → return (매수 중단)
 *
 * [앞으로 확인할 것]
 *   - 로그에서 "[MA추세] BTC 5분봉 MA5 < MA20 — 하락 추세 감지" 빈도 체크
 *     → 너무 자주 차단되면 MA_SLOW를 30~50으로 높여 필터 완화
 *     → 반대로 차단이 거의 없으면 MA_FAST/SLOW 조합 재검토
 *   - 차단 구간에서 개별 종목이 실제로 하락했는지 사후 확인 필수
 *   - bearTrend 차단 중에도 급반등(BTC MA 골든크로스) 시 즉시 해제되는지 확인
 * ──────────────────────────────────────────────────────────────
 */
export const REGIME_TREND_FILTER_ENABLED = true;
/**
 * BTC 5분봉 단기 MA 기간 (5봉 = 25분)
 * → 조정: 반응이 너무 예민하면 10으로 늘림
 */
export const REGIME_BTC_MA_FAST = 5;
/**
 * BTC 5분봉 장기 MA 기간 (30봉 = 150분)
 * → 20봉(100분)에서 상향: 오늘 로그 기준 하루 3시간+ 과차단 확인,
 *   30봉으로 완화해 완만한 단기 하락 추세는 허용.
 */
export const REGIME_BTC_MA_SLOW = 30;
/**
 * [3차 개선 신규] BTC MA 추세 필터 히스테리시스 밴드
 *
 * [수정 이유]
 *   기존: maFast < maSlow 이면 차단, maFast >= maSlow 이면 즉시 해제 — 동일 기준선.
 *   MA5 ≈ MA30 구간에서 매 캔들마다 교차가 반복되어 1분 간격으로 차단↔해제 토글 확인.
 *   (2026-03-10 13:37~13:41: 1분마다 4회 전환, 매수 기회 손실 + 불필요한 재연결 발생)
 *
 * [목적]
 *   차단 조건: maFast < maSlow × (1 - 이 값) → 명확한 하락일 때만 차단
 *   해제 조건: maFast > maSlow × (1 + 이 값) → 명확한 상승일 때만 해제
 *   그 사이 구간: 이전 상태 유지 (토글 방지)
 *   0.1%(0.001)로 설정 — 너무 크면 추세 전환 지연, 너무 작으면 효과 미미.
 *
 * [앞으로 확인할 것]
 *   - 차단/해제 로그 전환 빈도 감소 여부 모니터링.
 *   - MA 교차 직후 실제 추세 방향과 차단 상태가 일치하는지 사후 확인.
 *   - 토글이 여전히 자주 발생하면 0.002(0.2%)로 상향 검토.
 */
export const REGIME_BTC_MA_HYSTERESIS_BAND = 0.001;
