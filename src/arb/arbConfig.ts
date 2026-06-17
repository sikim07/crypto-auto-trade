export const ARB = {
  // 모니터링 대상 (Binance 심볼)
  SYMBOLS: ["SOLUSDT", "ETHUSDT"],

  // 수익 임계값
  MIN_SPREAD_PCT: 0.15,         // 최소 스프레드 % (이 이상이어야 실행)
  MIN_PROFIT_USD: 0.30,         // 최소 순이익 $ (수수료/가스 차감 후)

  // 거래 금액 (USDT)
  TRADE_AMOUNT_USDT: 50,        // 건당 거래 금액

  // 수수료
  BINANCE_FEE_PCT: 0.10,        // Binance 수수료 % (BNB 할인 미적용 기본값)
  DEX_FEE_PCT: 0.30,            // DEX 스왑 수수료 % (Uniswap/Jupiter 기본)
  EST_GAS_USD: 0.01,            // 예상 가스비 $ (솔라나 기준)

  // 주기
  PRICE_POLL_MS: 10_000,        // DEX 가격 조회 주기 (ms)
  REPORT_INTERVAL_MS: 30 * 60 * 1000, // 리포트 주기 (30분)

  // 안전장치
  DAILY_MAX_LOSS_USD: 10,       // 일일 최대 손실 $
  MAX_CONSECUTIVE_FAILS: 3,     // 연속 실패 시 쿨다운
  FAIL_COOLDOWN_MS: 10 * 60 * 1000, // 실패 쿨다운 (10분)

  // 모드
  DRY_RUN: true,                // true면 실행 안 하고 로그만 (시작은 모니터링 전용)
};
