# crypto-auto-trade

Upbit Open API 기반의 암호화폐 자동매매 프로젝트입니다.

실시간 시세 수집부터 종목 선정, 전략 실행, 주문 관리, 상태 복구까지 자동매매에 필요한 전체 흐름을 구현했습니다.

프로젝트는 단기 수익을 목표로 한 1분봉 스캘핑 전략에서 시작했으며, 백테스트와 실전 운영 데이터를 기반으로 전략을 반복적으로 검증한 결과 방향 예측 기반 전략의 한계를 확인했습니다. 이후 방향성 예측 의존도를 줄인 Grid Trading 구조로 전환하여 현재 구조를 구성했습니다.

> 이전 프로젝트인 **upbit-trade-bot**에서 대시보드와 시뮬레이션 기능을 개발했으며, 본 프로젝트에서는 자동매매 엔진만 독립적으로 분리하여 개발했습니다.

---

# Tech Stack

- TypeScript
- Node.js
- Upbit Open API (REST / WebSocket)
- PM2
- Axios
- ws

---

# Features

- Upbit REST / WebSocket API Wrapper
- JWT(HS512) 인증
- 거래대금 기반 종목 선정
- 전략 기반 자동매매
- Grid Trading
- Trend Guard
- 주문 상태(State Machine) 관리
- JSON 기반 상태 백업 및 복구
- 운영 로그 생성

---

# Project Structure

```
src/
├── common/
├── upbit/
├── grid/
│   ├── gridBot.ts
│   ├── gridOrders.ts
│   ├── gridState.ts
│   ├── trendGuard.ts
│   └── gridReport.ts
└── _legacy/
```

기존 스캘핑 전략은 `_legacy`로 분리하여 보관하고 있으며, 현재는 Grid Trading만 운영 대상으로 유지합니다.

---

# Trading Flow

자동매매는 다음 순서로 동작합니다.

```
Market Selection
        │
        ▼
 WebSocket 수신
        │
        ▼
 Strategy
        │
        ▼
 Order
        │
        ▼
State Update
        │
        ▼
 Recovery
```

- 거래대금 상위 종목을 선별
- WebSocket으로 실시간 체결 데이터 수신
- 전략 조건 만족 여부 판단
- 주문 실행
- 주문 상태 저장
- 프로세스 재시작 시 상태 복구

---

# Coin Selection

초기에는 KRW 마켓 전체를 대상으로 전략을 수행했지만, API 호출량 증가와 실시간 처리 비용이 커지는 문제가 있었습니다.

현재는 거래대금과 거래량을 기준으로 거래 가능성이 높은 종목만 선별하여 감시 대상으로 사용합니다.

또한 일정 시간 동안 매매가 발생하지 않으면 감시 종목을 다시 선정하여 시장 변화에 대응하도록 구성했습니다.

이를 통해 API 호출량을 줄이면서도 실시간 대응 성능을 유지했습니다.

---

# Strategy Evolution

프로젝트는 하나의 전략을 계속 수정하기보다 여러 가설을 독립적으로 구현하고 검증하는 방식으로 진행했습니다.

| Strategy | 목적             | 결과                                       |
| -------- | ---------------- | ------------------------------------------ |
| A        | 기본 추세 추종   | 노이즈 구간 진입이 많아 폐기               |
| B        | 거래량 필터 추가 | 진입 시점이 늦어 기대수익 감소             |
| C        | 변동성 돌파      | 횡보장에서 손실 증가                       |
| D        | 과매도 반등      | 하락 추세에서 성능 저하                    |
| E        | 다중 필터        | 과최적화로 실전 거래 감소                  |
| F        | VWAP 눌림목      | 가장 오래 운영했으나 수수료 구조 극복 실패 |
| Grid     | 방향성 제거      | 현재 운영 구조                             |

각 전략은 백테스트와 실전 운영 결과를 함께 비교하여 유지 여부를 결정했습니다.

---

# Architecture

## API Wrapper

REST와 WebSocket을 공통 모듈로 분리하여 전략과 거래소 API를 분리했습니다.

공통 계층에서

- JWT 인증
- Query Hash 생성
- Rate Limit 대응
- 호가 단위 보정

을 처리하도록 구현하여 전략 변경 시 API 계층을 수정하지 않도록 구성했습니다.

---

## Grid Trading

Grid Trading은 일정 가격 범위를 여러 단계로 나누고 각 구간에 지정가 주문을 배치하는 방식입니다.

주문 상태는 State Machine으로 관리하며

```
idle
 ↓
buyPlaced
 ↓
holding
 ↓
sellPlaced
 ↓
idle
```

순서로 동작합니다.

---

## Trend Guard

Grid Trading은 강한 추세장에서 한 방향 주문만 체결되는 문제가 있습니다.

이를 방지하기 위해 가격 이탈, 연속 체결 패턴, API 오류 등을 감지하여 자동으로 매매를 중단하거나 재개하는 Trend Guard를 구현했습니다.

---

## State Management

주문 상태는 JSON 파일에 저장됩니다.

프로세스가 종료되더라도 현재 주문 정보를 복구하여 동일한 상태에서 다시 운영할 수 있도록 설계했습니다.

---

# Development Notes

프로젝트는 AI를 구현 보조 도구로 활용하여 개발했습니다.

기능 구현이나 리팩토링 초안을 생성한 뒤 직접 검토 및 수정했으며, 모든 변경 사항은 TypeScript 타입 검증과 실제 실행 결과를 기준으로 검증했습니다.

전략 개선 과정에서는 백테스트 결과만 사용하지 않고 실전 운영 로그와 기대값(Expected Value)을 함께 분석하여 다음 전략의 방향을 결정했습니다.

---

# Future Work

- Binance 등 낮은 수수료 거래소 지원
- 데이터 기반 백테스트 자동화
- 전략 플러그인 구조 개선
- DEX 연동 실험

---

# Run

```bash
npm install

cp .env.example .env

npm run build

npm start

# or

pm2 start ecosystem.config.js
```
