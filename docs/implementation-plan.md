# 구현 계획: 그리드 트레이딩 + DEX-CEX 차익거래

## 프로젝트 구조

```
crypto-auto-trade/
├── src/
│   ├── _legacy/                  # 기존 전략 A~F 코드 (빌드 제외, 보관용)
│   │
│   ├── common/                   # 공통 모듈
│   │   ├── types.ts              # 공통 타입 정의
│   │   ├── logger.ts             # 로거
│   │   └── config.ts             # 환경변수 로딩 (.env)
│   │
│   ├── grid/                     # Phase 1: 그리드 트레이딩 봇
│   │   ├── gridBot.ts            # 메인 루프
│   │   ├── gridConfig.ts         # 그리드 설정 (범위, 간격, 종목)
│   │   ├── gridState.ts          # 그리드 상태 관리 (주문 추적)
│   │   ├── gridOrders.ts         # 지정가 주문 배치/취소/갱신
│   │   ├── trendGuard.ts         # 추세 감지 → 그리드 중단
│   │   └── gridReport.ts         # 수익 리포트
│   │
│   ├── arb/                      # Phase 2: DEX-CEX 차익거래 봇
│   │   ├── arbBot.ts             # 메인 루프
│   │   ├── arbConfig.ts          # 차익 설정 (토큰, 체인, 임계값)
│   │   ├── priceFeed.ts          # CEX/DEX 가격 수집
│   │   ├── profitCalc.ts         # 수익성 계산 (수수료, 가스비 포함)
│   │   ├── cexTrade.ts           # CEX 매매 실행
│   │   ├── dexSwap.ts            # DEX 스왑 실행
│   │   └── rebalancer.ts         # 자금 리밸런싱
│   │
│   ├── upbit/                    # Upbit API (그리드용, _legacy에서 추출)
│   │   ├── auth.ts               # 인증 (JWT)
│   │   ├── rest.ts               # REST API 호출
│   │   └── ws.ts                 # WebSocket (틱/체결 감시)
│   │
│   └── exchange/                 # 해외 거래소 + DEX (차익용)
│       ├── binance.ts            # Binance API
│       └── dex/
│           ├── jupiter.ts        # Jupiter (솔라나) 스왑
│           └── uniswap.ts        # Uniswap (Arbitrum) 스왑
│
├── ecosystem.config.js           # PM2 설정 (grid-bot, arb-bot)
├── package.json
├── tsconfig.json
└── .env                          # API 키, 지갑 키 등
```

---

## Phase 1: 그리드 트레이딩 봇 (Upbit)

### 목표
- Upbit KRW 마켓에서 지정가 주문 기반 그리드 트레이딩
- 횡보 구간에서 가격 왕복 움직임으로 수익 수확
- 추세 감지 시 자동 중단

### 예상 기간: 2주

---

### Step 1-1: 공통 모듈 + Upbit API 재구성 (2일)

#### 목적
기존 _legacy에서 재사용 가능한 코드를 추출하여 깔끔하게 재구성.

#### 작업 내용

**common/types.ts**
```typescript
// 주문 관련
interface LimitOrder {
  market: string;          // "KRW-BTC"
  side: 'bid' | 'ask';    // 매수/매도
  price: number;           // 지정가
  volume: number;          // 수량
  uuid?: string;           // Upbit 주문 UUID (배치 후)
  status: 'pending' | 'placed' | 'filled' | 'cancelled';
  createdAt: number;       // 배치 시각
  filledAt?: number;       // 체결 시각
}

// 그리드 단계
interface GridLevel {
  price: number;           // 이 가격에 주문
  side: 'bid' | 'ask';    // 현재가 기준 아래=bid, 위=ask
  order?: LimitOrder;      // 연결된 주문
  filledCount: number;     // 누적 체결 횟수
}

// 캔들
interface Candle {
  market: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
```

**common/logger.ts**
```
- _legacy/logger.ts 기반으로 단순화
- stdout/stderr 분리 유지
- 타임스탬프 KST
```

**common/config.ts**
```
- dotenv 로딩
- UPBIT_ACCESS_KEY, UPBIT_SECRET_KEY
- (Phase 2) BINANCE_API_KEY, BINANCE_SECRET, WALLET_PRIVATE_KEY 등
```

**upbit/auth.ts**
```
- _legacy/api/auth.ts에서 그대로 추출
- JWT 생성 로직 (변경 없음)
```

**upbit/rest.ts**
```
- _legacy/api/rest.ts에서 추출
- 필요한 API만 포함:
  - getAccounts(): 잔고 조회
  - getCandles(market, unit, count): 캔들 조회
  - getOrderbook(market): 호가 조회
  - placeLimitOrder(market, side, price, volume): 지정가 주문
  - cancelOrder(uuid): 주문 취소
  - getOrder(uuid): 주문 상태 조회
  - getOpenOrders(market): 미체결 주문 목록
```

**upbit/ws.ts**
```
- _legacy/ws/ticker.ts에서 추출
- 체결(trade) 이벤트 구독 → 그리드 체결 감지용
```

#### 완료 기준
- `npm run build` 성공
- Upbit API로 잔고 조회, 호가 조회 동작 확인

---

### Step 1-2: 그리드 핵심 로직 (3일)

#### 목적
그리드 계산, 주문 배치, 체결 감시, 재배치 로직 구현.

#### 작업 내용

**gridConfig.ts**
```typescript
const GRID_CONFIG = {
  // 종목
  MARKET: 'KRW-BTC',

  // 범위
  RANGE_UPPER: 0,           // 0이면 자동 계산 (현재가 + RANGE_PCT%)
  RANGE_LOWER: 0,           // 0이면 자동 계산 (현재가 - RANGE_PCT%)
  RANGE_PCT: 5,             // 자동 계산 시 현재가 대비 ±%

  // 그리드
  GRID_COUNT: 20,           // 그리드 단계 수
  // → 간격 = (상단-하단) / GRID_COUNT
  // → 예: ±5% 범위, 20단계 = 0.5% 간격

  // 자금
  TOTAL_INVEST_KRW: 200000, // 총 투입 금액 (원)
  // → 단계당 = TOTAL_INVEST_KRW / GRID_COUNT

  // 안전장치
  MAX_OPEN_ORDERS: 10,      // 최대 동시 미체결 주문 수 (API 제한 고려)
  ORDER_REFRESH_SEC: 30,    // 미체결 주문 상태 확인 주기
  PRICE_CHECK_SEC: 10,      // 현재가 확인 주기
};
```

**gridState.ts**
```
역할: 그리드의 현재 상태를 메모리에 유지 + 파일로 백업

상태 구조:
{
  market: string,
  rangeUpper: number,
  rangeLower: number,
  gridInterval: number,
  levels: GridLevel[],         // 각 단계별 상태
  totalRealizedProfit: number, // 누적 실현 수익
  totalFees: number,           // 누적 수수료
  startedAt: number,
  lastUpdatedAt: number,
}

기능:
- initGrid(currentPrice): 현재가 기준 그리드 초기화
- updateLevel(price, status): 특정 단계 상태 갱신
- saveState(): JSON 파일로 저장 (재시작 시 복구용)
- loadState(): 저장된 상태 복구
- getStats(): 수익/체결 통계 반환
```

**gridOrders.ts**
```
역할: Upbit API를 사용한 실제 주문 관리

기능:
- placeGridOrders(levels): 미체결 단계에 지정가 주문 배치
  - 현재가 아래 단계 → 매수 주문
  - 현재가 위 단계 → 매도 주문
  - MAX_OPEN_ORDERS 초과 시 현재가에서 먼 주문은 보류

- checkFilled(): 미체결 주문 상태 확인
  - 체결된 주문 발견 시:
    - 매수 체결 → 해당 단계를 '보유' 상태로 변경
                → 한 단계 위에 매도 주문 배치
    - 매도 체결 → 수익 기록
                → 한 단계 아래에 매수 주문 배치

- cancelAllOrders(): 그리드 중단 시 전체 취소

- rebalanceOrders(currentPrice): 가격 이동에 따라 주문 재배치
  - 현재가 근처 ±N단계만 실제 주문, 먼 단계는 대기
  - API 호출 최소화
```

**핵심 로직 흐름:**
```
초기화:
  현재가 조회 → 범위 계산 → 그리드 단계 생성 → 주문 배치

메인 루프 (10초 간격):
  1. 현재가 조회
  2. 미체결 주문 상태 확인 (체결 감지)
  3. 체결된 주문 처리 (반대 방향 주문 배치)
  4. 추세 감지 체크 (trendGuard)
  5. 필요 시 주문 재배치

체결 처리 상세:
  매수 체결 (가격 P에서):
    → state에서 해당 level을 'holding'으로 변경
    → P + gridInterval 가격에 매도 지정가 주문 배치
    → 로그: "[GRID] BUY filled @ {P}, 매도 주문 배치 @ {P+interval}"

  매도 체결 (가격 P에서):
    → 수익 = 매도가 - 매수가 - 수수료(왕복)
    → state에 수익 기록
    → P - gridInterval 가격에 매수 지정가 주문 배치
    → 로그: "[GRID] SELL filled @ {P}, 순익 {profit}원, 매수 주문 배치 @ {P-interval}"
```

#### 완료 기준
- 그리드 초기화 시 올바른 단계/가격 계산
- 지정가 주문 배치/취소 동작 확인
- 체결 감지 → 반대 주문 배치 로직 동작 확인

---

### Step 1-3: 추세 감지 + 안전장치 (2일)

#### 목적
한 방향 추세 시 그리드를 중단하여 큰 손실 방지.

#### 작업 내용

**trendGuard.ts**
```
역할: 현재 시장이 횡보인지 추세인지 판단

판단 기준 (복수 조건 OR):
  1. 범위 이탈: 현재가가 그리드 범위 상단/하단 돌파
  2. 연속 체결: 같은 방향(매수만 or 매도만) N회 연속 체결
  3. 변동성 급증: ATR(14) > 기준값 (급격한 움직임)

상태:
  - ACTIVE: 그리드 정상 운영
  - PAUSED: 추세 감지 → 신규 주문 중단, 기존 주문 유지 or 취소
  - STOPPED: 범위 이탈 → 전체 주문 취소, 포지션 정리

일시 중단(PAUSED) 시:
  - 신규 주문 배치 안 함
  - 기존 미체결 주문은 유지 (체결되면 처리)
  - 조건 해소 시 자동 재개

완전 중단(STOPPED) 시:
  - 모든 미체결 주문 취소
  - 보유 중인 코인은 시장가 매도 (선택 가능)
  - 수동 재시작 필요
  - 로그: "[GUARD] 그리드 중단 - 사유: {reason}, 누적 수익: {profit}"
```

**안전장치 (gridBot.ts에 포함):**
```
1. 일일 손실 한도
   - 당일 실현 손실이 DAILY_MAX_LOSS(예: -3만원)에 도달 시 중단
   - KST 0시 리셋

2. API 에러 핸들링
   - 주문 실패 시 3회 재시도 후 해당 단계 스킵
   - 연속 5회 API 에러 시 전체 중단 + 알림

3. 잔고 확인
   - 주문 배치 전 KRW/코인 잔고 확인
   - 잔고 부족 시 해당 방향 주문 스킵

4. 상태 백업
   - 30초마다 gridState를 JSON 파일로 저장
   - 프로세스 재시작 시 파일에서 복구
   - 복구 시: 미체결 주문 UUID로 실제 상태 재확인
```

#### 완료 기준
- 범위 이탈 시 그리드 중단 동작
- 연속 같은 방향 체결 시 일시 중단 동작
- 프로세스 재시작 후 상태 복구 동작

---

### Step 1-4: 리포트 + 실전 테스트 (3일)

#### 목적
수익 추적, 로그 정리, 소액 실전 테스트.

#### 작업 내용

**gridReport.ts**
```
역할: 그리드 운영 현황 리포트

출력 내용 (1시간 간격 또는 일일):
  - 총 체결 횟수 (매수/매도 각각)
  - 실현 수익 (수수료 차감 후)
  - 미실현 손익 (보유 코인 평가)
  - 순수익 (실현 + 미실현)
  - 범위 대비 현재가 위치 (%)
  - 추세 감지 상태

로그 형식:
  [GRID REPORT] 2026-06-18 15:00 KST
  종목: KRW-BTC | 범위: 97,000,000 ~ 103,000,000
  체결: 매수 12회 / 매도 10회
  실현수익: +18,400원 (수수료 -3,200원)
  미실현: -5,200원 (BTC 0.00012 보유)
  순수익: +13,200원
  상태: ACTIVE | 현재가 위치: 62% (범위 내)
```

**gridBot.ts (메인)**
```
전체 흐름:

1. 초기화
   - 환경변수 로딩
   - Upbit API 연결 확인
   - 저장된 상태 복구 시도
   - 없으면 새 그리드 초기화

2. 메인 루프 (setInterval)
   - 10초 간격: 현재가 조회 + 체결 확인
   - 30초 간격: 주문 재배치 검토
   - 60분 간격: 리포트 출력
   - 30초 간격: 상태 백업

3. 종료 처리
   - SIGINT/SIGTERM 핸들링
   - 상태 저장
   - (선택) 미체결 주문 전체 취소
```

**실전 테스트 계획:**
```
1일차: 최소 자금 테스트 (5만원)
  - BTC 그리드: 5만원, 10단계
  - 주문 배치/취소/체결 동작 확인
  - 로그 확인

2~3일차: 관찰
  - 체결 빈도 확인 (일 몇 회?)
  - 추세 감지 정확도 확인
  - 수수료 대비 순수익 확인
  - 에러/예외 상황 확인

4~5일차: 파라미터 조정
  - 간격 최적화 (0.3% vs 0.5% vs 0.7%)
  - 범위 최적화 (±3% vs ±5% vs ±7%)
  - 추세 감지 민감도 조정

이후: 자금 증액 판단
  - 테스트 결과가 양호하면 20만원 → 50만원 단계적 증액
```

#### 완료 기준
- PM2로 그리드 봇 안정 운영
- 24시간 무중단 운영 확인
- 실전 수익/손실 데이터 확보

---

## Phase 2: DEX-CEX 차익거래 봇

### 목표
- 해외 CEX(Binance)와 DEX(Jupiter/Uniswap) 간 가격 차이 감지 및 수확
- 소액($300~500)으로 시작
- 그리드 봇과 완전 독립 운영

### 예상 기간: 3~4주
### 전제 조건: Binance 계정 + 암호화폐 지갑 준비

---

### Step 2-1: CEX 연동 — Binance API (3일)

#### 목적
Binance에서 가격 조회, 주문 실행 기능 구현.

#### 작업 내용

**exchange/binance.ts**
```
필요 기능:
  - getPrice(symbol): 현재가 조회 (REST)
  - subscribePrices(symbols, callback): 실시간 가격 구독 (WebSocket)
  - placeMarketOrder(symbol, side, quantity): 시장가 주문
  - getBalance(asset): 잔고 조회

API 특이사항:
  - HMAC-SHA256 서명 (Upbit JWT와 다름)
  - 타임스탬프 동기화 필요
  - Rate limit 주의 (1200 req/min)

라이브러리:
  - 직접 구현 (axios) 또는 ccxt 사용 검토
  - ccxt: 다중 거래소 지원 라이브러리, 편하지만 의존성 큼
  - 권장: 직접 구현 (Upbit와 동일한 패턴, axios 재사용)
```

**arb/priceFeed.ts**
```
역할: CEX와 DEX 가격을 동시에 수집하여 비교

구조:
  - Binance WebSocket → 실시간 CEX 가격
  - DEX 가격 조회 (RPC 또는 API) → 주기적 폴링

출력:
  {
    token: 'SOL',
    cexPrice: 150.25,        // Binance USDT 가격
    dexPrice: 149.80,        // Jupiter 스왑 예상가
    spreadPct: 0.30,         // 차이 %
    timestamp: 1718600000,
  }
```

#### 완료 기준
- Binance 실시간 가격 수신 동작
- 시장가 주문 테스트 (최소 금액)
- CEX-DEX 가격 차이 실시간 모니터링 로그 출력

---

### Step 2-2: DEX 연동 — 체인 선택 및 스왑 구현 (5일)

#### 목적
DEX에서 토큰 스왑 실행 기능 구현.

#### 체인 선택 기준

```
| 체인     | 가스비      | DEX         | 장점           | 단점              |
|----------|------------|-------------|---------------|-------------------|
| 솔라나   | $0.001     | Jupiter     | 가스비 최저      | 네트워크 불안정     |
| Arbitrum | $0.1~0.5   | Uniswap v3  | 안정적, 유동성   | 가스비 솔라나보다 높음 |
| Base     | $0.01~0.1  | Aerodrome   | 저렴            | 유동성 상대적 적음   |

권장: 솔라나(Jupiter)로 시작
  - 가스비가 무시할 수준 → 소액 차익도 수익
  - Jupiter API가 REST로 호출 가능 → Web3 깊은 지식 없이 시작 가능
  - 실패 시 Arbitrum으로 전환
```

**exchange/dex/jupiter.ts (솔라나 선택 시)**
```
Jupiter API 활용:
  - GET /quote: 스왑 견적 (입력 토큰, 출력 토큰, 금액)
    → 예상 출력량, 가격 영향, 수수료 확인
  - POST /swap: 스왑 트랜잭션 생성
    → 서명 후 솔라나 네트워크에 제출

필요 기능:
  - getQuote(inputMint, outputMint, amount): 스왑 견적
  - executeSwap(quote, wallet): 스왑 실행
  - getTokenBalance(wallet, mint): 토큰 잔고 조회

필요 라이브러리:
  - @solana/web3.js: 솔라나 트랜잭션 처리
  - @solana/spl-token: SPL 토큰 잔고 조회
  - bs58: 키 인코딩
```

**exchange/dex/uniswap.ts (Arbitrum 선택 시)**
```
Uniswap v3 Router 활용:
  - exactInputSingle(): 정확한 입력량으로 스왑
  - quoteExactInputSingle(): 스왑 견적

필요 라이브러리:
  - ethers.js (v6): 트랜잭션 처리
  - Uniswap v3 ABI (컨트랙트 인터페이스)
```

#### 완료 기준
- DEX에서 소액 스왑 실행 성공
- 스왑 견적과 실제 체결가 비교 (슬리피지 확인)
- 가스비 실측

---

### Step 2-3: 차익 감지 + 수익성 계산 (3일)

#### 목적
실시간으로 차익 기회를 감지하고, 수수료/가스비를 제외한 순수익을 계산.

#### 작업 내용

**arb/profitCalc.ts**
```
입력:
  - cexPrice: CEX 매도/매수 가격
  - dexPrice: DEX 스왑 예상 출력 (슬리피지 포함)
  - tradeAmount: 거래 금액 (USDT)

비용 계산:
  - cexFee: Binance 수수료 (0.1%, BNB 사용 시 0.075%)
  - dexFee: DEX 스왑 수수료 (0.3% 또는 풀에 따라)
  - gasFee: 온체인 가스비 (체인별 상이)
  - slippage: 예상 슬리피지 (견적 vs 실제)

순수익 계산:
  direction A (DEX에서 매수 → CEX에서 매도):
    profit = (cexBidPrice × (1 - cexFee)) - (dexAskPrice × (1 + dexFee)) - gasFee

  direction B (CEX에서 매수 → DEX에서 매도):
    profit = (dexBidPrice × (1 - dexFee)) - (cexAskPrice × (1 + cexFee)) - gasFee

최소 수익 임계값:
  - MIN_PROFIT_PCT = 0.1% (이 이상이어야 실행)
  - MIN_PROFIT_USD = 0.5 (절대 금액 기준)
```

**모니터링 루프 (priceFeed.ts 확장):**
```
1초 간격:
  1. CEX 가격 업데이트 (WebSocket → 실시간)
  2. DEX 견적 조회 (REST → 1~2초 간격)
  3. 양방향 수익성 계산
  4. 임계값 초과 시 → 실행 판단

로그 (기회 감지 시):
  [ARB] SOL 기회 감지
  CEX bid: $150.25 | DEX ask: $149.50
  차이: 0.50% | 비용: 0.35% | 순익: 0.15% ($0.45)
  → 실행 조건 충족
```

#### 완료 기준
- 실시간 차익 기회 감지 동작
- 수익성 계산 정확도 검증 (수동 계산과 비교)
- 기회 빈도 로그 (하루 동안 몇 건 감지되는지)

---

### Step 2-4: 실행 엔진 + 안전장치 (3일)

#### 목적
차익 기회 감지 시 양쪽 거래를 실행하고, 리스크를 관리.

#### 작업 내용

**arb/arbBot.ts (메인)**
```
실행 흐름:
  1. 기회 감지 (profitCalc에서 신호)
  2. 잔고 확인 (양쪽 충분한지)
  3. 동시 실행:
     - CEX 시장가 주문 (즉시 체결)
     - DEX 스왑 트랜잭션 (블록 확인 대기)
  4. 결과 확인:
     - 양쪽 모두 체결 → 수익 기록
     - 한쪽만 체결 → 에러 처리 (아래 참조)
  5. 잔고 업데이트

한쪽만 체결 시 (Leg Risk 처리):
  - CEX 체결, DEX 실패:
    → CEX에서 반대 주문으로 원복 (시장가)
    → 슬리피지 손실 감수 (소액이므로 미미)
  - DEX 체결, CEX 실패:
    → DEX에서 반대 스왑으로 원복
    → 가스비 추가 발생

안전장치:
  1. 동시 실행 건수 제한: 1건 (직렬 실행)
     → 완료 후 다음 기회 검토
  2. 일일 손실 한도: $10 (소액 테스트 기간)
  3. 연속 실패 시 중단: 3회 연속 실패 → 10분 쿨다운
  4. 잔고 불균형 경고: 한쪽에 80% 이상 쏠리면 로그 경고
```

**arb/rebalancer.ts**
```
역할: 한 방향 차익만 계속될 때 자금 리밸런싱

조건: 한쪽 잔고가 전체의 80% 이상
방법:
  - 자동: 반대 방향 차익이 나올 때까지 대기 (수동 리밸런싱 불필요)
  - 수동: CEX 출금 → 온체인 입금 (또는 반대)
  - 수동 트리거 시 로그 알림만 출력 (자동 송금은 위험)

실제로는:
  - 소액 운영 시 자연 리밸런싱으로 충분할 가능성 높음
  - 한 방향 기회만 나오면 그 방향 자금이 소진되어 자연 중단
  - 로그로 현재 잔고 비율만 표시하고, 판단은 사용자에게 위임
```

#### 완료 기준
- 차익 기회 감지 → 양쪽 동시 실행 동작
- Leg risk 처리 동작 확인
- 24시간 무중단 모니터링

---

### Step 2-5: 실전 테스트 + 최적화 (4일)

#### 목적
소액으로 실전 차익 거래 실행, 수익성 검증.

#### 테스트 계획

```
1~2일차: 모니터링 전용 (실행 안 함)
  - 차익 기회 감지 빈도 확인
  - 수익성 계산 정확도 검증
  - CEX/DEX 가격 지연 측정

3~4일차: 소액 실행 ($50~100)
  - 건당 $50 이하로 제한
  - 체결 속도 측정
  - 실제 수익 vs 예상 수익 비교
  - 슬리피지 실측

5~7일차: 파라미터 조정
  - 최소 수익 임계값 조정
  - 토큰 선택 최적화 (어떤 토큰에서 기회가 많은지)
  - 거래 금액 최적화

이후: 증액 판단
  - 기회 빈도 × 건당 수익 → 일 예상 수익 산출
  - 양성이면 $200 → $500 단계적 증액
```

#### 토큰 선정 기준
```
1차 후보:
  - SOL: 솔라나 네이티브, Jupiter에서 유동성 최대
  - ETH: 두 거래소 모두 유동성 충분
  - 주요 알트: BONK, JUP, WIF 등 (솔라나 기반, 변동성 높아 괴리 자주 발생)

선정 기준:
  - Binance + Jupiter 양쪽에서 거래 가능
  - 일 거래량 $1M+ (유동성)
  - 변동성 중간 이상 (괴리 발생 빈도)
```

---

## PM2 설정 (ecosystem.config.js)

```javascript
module.exports = {
  apps: [
    {
      name: "grid-bot",
      script: "dist/grid/gridBot.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "200M",
      env: { NODE_ENV: "production" },
    },
    {
      name: "arb-bot",
      script: "dist/arb/arbBot.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "200M",
      env: { NODE_ENV: "production" },
    },
  ],
};
```

---

## .env 확장

```
# Upbit (그리드)
UPBIT_ACCESS_KEY=xxx
UPBIT_SECRET_KEY=xxx

# Binance (차익)
BINANCE_API_KEY=xxx
BINANCE_SECRET_KEY=xxx

# 솔라나 지갑 (차익 - DEX)
SOLANA_PRIVATE_KEY=xxx
# 또는 Arbitrum
# ETH_PRIVATE_KEY=xxx
```

---

## 의존성 추가 (package.json)

```json
{
  "dependencies": {
    "axios": "^1.6.0",       // 기존 유지
    "dotenv": "^16.3.1",     // 기존 유지
    "ws": "^8.14.2",         // 기존 유지
    "@solana/web3.js": "^1.95.0",    // Phase 2: 솔라나
    "@solana/spl-token": "^0.4.0",   // Phase 2: SPL 토큰
    "bs58": "^6.0.0"                 // Phase 2: 키 인코딩
  }
}
```

---

## 전체 일정

```
Phase 1 (그리드):
  Step 1-1: 공통 모듈 + Upbit API     2일
  Step 1-2: 그리드 핵심 로직           3일
  Step 1-3: 추세 감지 + 안전장치       2일
  Step 1-4: 리포트 + 실전 테스트       3일 (+ 지속 운영)
  ────────────────────────────────
  소계: 10일 (실전 테스트 포함 2주)

Phase 2 (DEX-CEX):
  Step 2-1: Binance API               3일
  Step 2-2: DEX 연동                   5일
  Step 2-3: 차익 감지 + 수익성 계산     3일
  Step 2-4: 실행 엔진 + 안전장치       3일
  Step 2-5: 실전 테스트               4일 (+ 지속 운영)
  ────────────────────────────────
  소계: 18일 (실전 테스트 포함 3~4주)

Phase 1과 Phase 2는 순차 진행.
Phase 1 실전 테스트 중 Phase 2 학습/준비 병행 가능.
```

---

## 성공 기준

### Phase 1 (그리드)
- [ ] 24시간 무중단 운영
- [ ] 일 체결 5회 이상
- [ ] 일 순수익 양수 (수수료 차감 후)
- [ ] 추세 감지 → 자동 중단 → 손실 제한 동작
- [ ] 1주일 누적 순수익 양수

### Phase 2 (DEX-CEX)
- [ ] 차익 기회 일 10건 이상 감지
- [ ] 실행 성공률 90% 이상
- [ ] 건당 순수익 양수 (가스비+수수료 차감 후)
- [ ] Leg risk 발생 시 원복 동작
- [ ] 1주일 누적 순수익 양수

### 전체
- [ ] 그리드 + 차익 병렬 운영 안정성
- [ ] 월 순수익률 5%+ (목표, 보장 아님)
- [ ] 자금 대비 최대 손실 -10% 이내
