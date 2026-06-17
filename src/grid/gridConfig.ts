export const GRID = {
  // 종목
  MARKET: "KRW-BTC",

  // 범위 (0이면 현재가 기준 RANGE_PCT로 자동 계산)
  RANGE_UPPER: 0,
  RANGE_LOWER: 0,
  RANGE_PCT: 2,

  // 그리드 단계 수 (간격 = 범위 / 단계수)
  GRID_COUNT: 5,

  // 투입 금액 (원)
  TOTAL_INVEST_KRW: 50_000,

  // 현재가 근처 ±N단계만 실제 주문 배치 (API 호출 최소화)
  ACTIVE_LEVELS: 2,

  // 주기 (ms)
  POLL_INTERVAL_MS: 10_000,
  STATE_SAVE_INTERVAL_MS: 30_000,

  // 안전장치
  DAILY_MAX_LOSS_KRW: 30_000,
  MAX_CONSECUTIVE_SAME_SIDE: 5,
  API_ERROR_THRESHOLD: 5,

  // Upbit 최소 주문
  MIN_ORDER_KRW: 5_000,

  // 수수료율 (매수+매도 각 0.05%)
  FEE_RATE: 0.0005,

  // 상태 파일 경로
  STATE_FILE: "grid-state.json",
};
