/**
 * 그리드 트레이딩 설정값
 *
 * 그리드 트레이딩이란:
 *   일정 가격 범위를 N단계로 나누고, 각 단계에 매수/매도 지정가 주문을 배치한다.
 *   가격이 오르면 매도되고, 내리면 매수되어, 횡보장에서 가격 왕복만으로 수익이 발생한다.
 *
 * 예시 (현재가 100,000,000원, ±2%, 5단계):
 *   하단: 98,000,000원 ~ 상단: 102,000,000원
 *   간격: (102,000,000 - 98,000,000) / 5 = 800,000원
 *   → 98,800,000에 매수 → 99,600,000에 매도 = 한 사이클 수익
 */
export const GRID = {
  // 거래 대상 종목 (Upbit KRW 마켓)
  MARKET: "KRW-BTC",

  // 그리드 범위 (0이면 현재가 기준 RANGE_PCT로 자동 계산)
  RANGE_UPPER: 0,
  RANGE_LOWER: 0,
  RANGE_PCT: 2,            // 현재가 대비 ±2% 범위

  // 그리드 단계 수 (간격 = 범위 / 단계수)
  GRID_COUNT: 5,

  // 총 투입 금액 (원) — 단계당 = TOTAL_INVEST_KRW / GRID_COUNT
  TOTAL_INVEST_KRW: 50_000,

  // 현재가 근처 ±N단계만 실제 주문 배치 (멀리 떨어진 주문은 대기)
  // API 호출 수 최소화 + 잔고 효율화 목적
  ACTIVE_LEVELS: 2,

  // 폴링 주기
  POLL_INTERVAL_MS: 10_000,       // 체결 확인 주기 (10초)
  STATE_SAVE_INTERVAL_MS: 30_000, // 상태 파일 백업 주기 (30초)

  // 안전장치
  DAILY_MAX_LOSS_KRW: 30_000,         // 일일 최대 손실 한도 → 초과 시 봇 중단
  MAX_CONSECUTIVE_SAME_SIDE: 5,       // 같은 방향 N회 연속 체결 시 일시 중단 (추세 감지)
  API_ERROR_THRESHOLD: 5,             // API 에러 N회 연속 시 완전 중단

  // Upbit 최소 주문 금액 (5,000원 미만은 주문 불가)
  MIN_ORDER_KRW: 5_000,

  // 수수료율 (Upbit: 매수/매도 각 0.05%)
  FEE_RATE: 0.0005,

  // 상태 백업 파일 경로 (프로세스 재시작 시 복구용)
  STATE_FILE: "grid-state.json",
};
