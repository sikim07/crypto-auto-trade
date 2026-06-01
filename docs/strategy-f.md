# 전략 F — VWAP 눌림목 반등

## 전략 컨셉

"상승 추세 중 VWAP 근처로 눌린 종목이 EMA21 지지를 받으며 반등하는 시점"에 진입하는 스캘핑 전략.

핵심 가정: VWAP는 당일 시장 참여자의 평균 단가이므로, 상승 추세에서 VWAP 근처까지 눌렸다가 반등하면 추가 상승 가능성이 높다.

## 진입 조건 (C1~C8, 순차 검사)

모든 조건을 통과해야 매수 신호 발생. 하나라도 실패하면 해당 조건 코드(C1~C8)로 차단.

| 조건 | 코드 | 데이터 | 검사 내용 |
|------|------|--------|----------|
| 1 | C1 | 5분봉 | 5분봉 마지막 종가 > VWAP_5m (대추세 상승 확인) |
| 2a | C2a | 1분봉 | 현재가 > VWAP_1m (소추세 상승 확인) |
| 2b | C2b | 1분봉 | 현재가 > EMA21 (단기 지지선 위) |
| 3 | C3 | 1분봉 | 현재가 ≤ VWAP_1m × (1 + PROXIMITY_PCT%) (눌림목 위치, VWAP에서 너무 멀면 차단) |
| 4 | C4 | 1분봉 | RSI_CROSS ≤ RSI < RSI_UPPER (반등 구간, 과열 아님) |
| 5 | C5 | 1분봉 | 마감봉 양봉 (close > open). FIRST_GREEN_ONLY=true면 직전봉 음봉 필수 |
| 6 | C6 | 1분봉 | 거래량 ≥ 직전 N봉 평균 × VOLUME_RATIO_MIN (반등에 거래량 동반) |
| 7 | C7 | 1분봉 | 최근 TOUCH_WINDOW봉 내 EMA21 터치 후 회복 봉 존재 (실제 지지 확인) |
| 8 | C8 | 1분봉 | EMA21 선형회귀 기울기 ≥ SLOPE_MIN_PCT%/봉 (EMA 상승 방향) |

### 조건 간 관계

```
C1(대추세) → C2(소추세+지지) → C3(눌림목 거리) → C4(RSI 적정) → C5(양봉) → C6(거래량) → C7(EMA 지지 확인) → C8(EMA 방향)
```

- C1~C3: 가격 위치 필터 (VWAP/EMA 대비)
- C4~C6: 기술적 조건 (RSI, 캔들, 거래량)
- C7~C8: EMA21 품질 필터 (지지 확인 + 방향 확인)

### VWAP 계산

- KST 0시 기준 당일 캔들만 사용
- VWAP = 누적(가격×거래량) / 누적(거래량)
- 최소 캔들 수 미충족 시 0 반환 → 조건 스킵 (1분봉 30개, 5분봉 6개)
- 미완성 현재봉은 closedCandles에서 제외 (거래량=0으로 판단)

### 진단 로그 (diagBlock)

차단 조건이 **변경될 때만** 1회 로그. 같은 조건 반복 차단 시 무시.
C1~C3 내부 전환은 30초 최소 간격 적용 (노이즈 토글 억제).

## 매도 조건 (우선순위 순)

| 순서 | 유형 | 조건 | 비고 |
|------|------|------|------|
| 1 | 하드 손절 | 순수익 ≤ STOP_LOSS_PCT (-1.5%) | 무조건 즉시 |
| 2 | 진입 이탈 | 현재가 < 진입가 × (1 - ENTRY_BREACH_PCT%) | GRACE_SEC(120초) 경과 후만 |
| 3 | VWAP 붕괴 | 현재가 or 마감종가 < VWAP × (1 - buffer%) | grace 120초 내 버퍼 2배 |
| 4 | 트레일링 | 고점 대비 OFFSET% 하락 | ACTIVATE_PCT 도달 후 활성화 |
| 5 | 시간초과 | 보유 ≥ MAX_HOLD_MINUTES | 마지막 안전장치 |

### 트레일링 스톱 상세

```
maxNetPct ≥ 0.6% → 트레일링 활성화
  maxNetPct < 1.5% → 기본 오프셋 0.5% (고점 대비 0.5% 하락 시 매도)
  maxNetPct ≥ 1.5% → 타이트 오프셋 0.3% (수익 보존 강화)
```

### VWAP 붕괴 grace 상세

```
보유 < 120초 → VWAP 버퍼 0.6% (기본 0.3% × 2)
  → VWAP 재계산으로 인한 미세 이탈 무시
  → 큰 이탈(0.6% 초과)은 즉시 손절
보유 ≥ 120초 → VWAP 버퍼 0.3% (기본)
```

## 현재 파라미터

| 파라미터 | 값 | 역할 |
|----------|-----|------|
| EMA_PERIOD | 21 | EMA 산출 기간 |
| PROXIMITY_PCT | 1.5% | VWAP 대비 최대 거리 |
| RSI_CROSS | 38 | RSI 하한 |
| RSI_UPPER | 65 | RSI 상한 |
| FIRST_GREEN_ONLY | false | 첫 양봉 필터 |
| MIN_VWAP_CANDLES_1M | 30 | 1분봉 VWAP 최소 캔들 |
| MIN_VWAP_CANDLES_5M | 6 | 5분봉 VWAP 최소 캔들 |
| STOP_LOSS_PCT | -1.5% | 하드 손절 |
| MAX_HOLD_MINUTES | 15 | 최대 보유 시간 |
| TRAILING_ACTIVATE_PCT | 0.6% | 트레일링 활성화 |
| TRAILING_OFFSET_PCT | 0.5% | 트레일링 기본 오프셋 |
| TRAILING_TIGHTEN_THRESHOLD | 1.5% | 타이트닝 기준 |
| TRAILING_TIGHTEN_OFFSET | 0.3% | 타이트닝 오프셋 |
| ENTRY_BREACH_PCT | 1.0% | 진입 이탈 기준 |
| ENTRY_BREACH_GRACE_SEC | 120초 | 진입 이탈 유예 |
| VWAP_BUFFER_PCT | 0.3% | VWAP 붕괴 기본 버퍼 |
| VWAP_BREACH_GRACE_SEC | 120초 | VWAP 붕괴 grace (버퍼 2배) |
| VOLUME_RATIO_MIN | 1.2 | 거래량 필터 최소 비율 |
| VOLUME_AVG_PERIOD | 3 | 거래량 비교 기간 |
| EMA_TOUCH_WINDOW | 5봉 | EMA 터치 확인 창 |
| EMA_TOUCH_BUFFER_PCT | 0.2% | EMA 터치 허용 버퍼 |
| EMA_SLOPE_LOOKBACK | 5봉 | EMA 기울기 산출 기간 |
| EMA_SLOPE_MIN_PCT | 0.01%/봉 | EMA 최소 상승률 |
| COOLDOWN_MS | 5분 | 매도 후 재진입 쿨다운 |
| LOSS_COOLDOWN_MS | 30분 | 손실 매도 후 쿨다운 |
| MAX_DAILY_TRADES_PER_TICKER | 2회 | 종목별 일일 매매 제한 |

## 외부 연동 (index.ts)

- **maxNetPct 갱신**: 매 틱마다 `index.ts`에서 현재 순수익과 비교해 최대값 갱신
- **쿨다운 3중 구조**:
  1. 매도 후 5분 쿨다운 (수익/손실 무관)
  2. 손실 매도 후 30분 쿨다운 (이중 적용)
  3. 종목별 일일 2회 제한 (KST 0시 리셋)
- **레짐 필터**: crashing → panicVolume → bearTrend 순 체크 후 통과해야 매수 신호 검사
- **우선순위**: B→A→C→D→E→F 중 앞 전략이 신호 발생하면 F는 검사 생략

## 알려진 약점

1. VWAP는 장 초반(0시~0:30) 캔들 수 부족으로 불안정 → MIN_VWAP_CANDLES로 30분 보장
2. 같은 종목 반복 매매 시 후반부 승률 급감 → MAX_DAILY_TRADES_PER_TICKER로 제한
3. 진입 직후 VWAP 재계산으로 미세 이탈 → VWAP_BREACH_GRACE_SEC로 완화
4. RSI 38은 허수 반등 위험 있으나 C7(EMA 터치), C8(EMA 기울기)이 보완
