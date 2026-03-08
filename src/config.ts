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
/** 직전 평균 대비 이 배수 이상일 때만 진입 (2.5 = 250%, 압도적 거래량 돌파 시에만) */
export const STRATEGY_C_VOLUME_RATIO = 2.5;
export const STRATEGY_C_VOLUME_AVG_PERIOD = 10;
export const STRATEGY_C_BODY_RATIO_MIN = 0.6;
export const STRATEGY_C_TRAILING_ACTIVATE_PCT = 2;
export const STRATEGY_C_TRAILING_OFFSET_PCT = 1.5;
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
 * 기존 42(반등 확인 후 진입). 반등 당김: 38 사용 — 모멘텀 상향 전환을 더 이른 시점에 포착.
 * 
 * [개선] 38 → 40으로 상향 조정 (보수적 설정)
 * 목적: 너무 이른 진입으로 인한 허수 반등 진입 방지, 진입 품질 개선
 * 이유: 로그 분석 결과 RSI 38 진입 시 진입이탈 손절이 빈번하게 발생.
 *      40으로 상향하여 추세 전환의 확신이 더 생기는 구간에서 진입하도록 조정.
 *      백테스트 후 필요시 42까지 상향 조정 가능.
 */
export const STRATEGY_F_RSI_CROSS = 40;
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
 * [신규 추가] (보수적 설정)
 * 목적: 높은 수익 구간에서 수익 보존 강화
 * 이유: 로그 분석 결과 AGLD가 최대 2.17%까지 갔으나 1.51%에서 매도됨(0.66% 하락).
 *      최대 수익이 1.5%를 돌파하면 트레일링 오프셋을 0.5%에서 0.3%로 좁혀 수익을 더 타이트하게 보존.
 *      백테스트 후 필요시 기준을 1.0% 또는 오프셋을 0.4%로 조정 가능.
 */
export const STRATEGY_F_TRAILING_TIGHTEN_THRESHOLD = 1.5;
export const STRATEGY_F_TRAILING_TIGHTEN_OFFSET = 0.3;

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
 * BTC 5분봉 장기 MA 기간 (20봉 = 100분)
 * → 조정: 차단이 너무 잦으면 30~50으로 늘려 필터 완화
 */
export const REGIME_BTC_MA_SLOW = 20;
