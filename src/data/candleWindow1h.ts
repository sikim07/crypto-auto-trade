/**
 * 1시간봉 캔들 저장소 (전략 T1 전용)
 *
 * [목적]
 *   기존 candleWindow.ts(1분봉/5분봉)와 분리된 독립 저장소.
 *   전략 T1은 1h EMA/RSI 기반 추세 추종 전략으로 타임프레임이 달라 별도 관리.
 *   1분봉처럼 ticker로 실시간 갱신하지 않고, REST API 폴링으로 주기 갱신.
 *
 * [갱신 주기]
 *   index.ts의 setInterval(CANDLE_REFRESH_INTERVAL_MS=60s)에서 호출.
 *   1h 전략 특성상 60초 갱신 주기로 충분 (최대 60초 지연 허용).
 *
 * [개선 방향]
 *   - 캔들 수가 부족해 EMA50 계산 실패가 잦으면 CANDLE_WINDOW_SIZE_1H(200) 확인.
 *   - 향후 실시간 갱신이 필요하면 WebSocket 1h 캔들 스트림 연결 고려.
 */
import { CANDLE_WINDOW_SIZE_1H } from "../config";
import type { UpbitCandle } from "../types";

const candleStorage1h = new Map<string, UpbitCandle[]>();

/**
 * 1h 캔들 초기화/갱신.
 * REST에서 가져온 배열을 타임스탬프 오름차순 정렬 후 최신 CANDLE_WINDOW_SIZE_1H개만 유지.
 */
export const setCandles1h = (market: string, candles: UpbitCandle[]): void => {
  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  candleStorage1h.set(market, sorted.slice(-CANDLE_WINDOW_SIZE_1H));
};

/** 저장된 1h 캔들 반환. 미초기화 시 빈 배열 반환 */
export const getCandles1h = (market: string): UpbitCandle[] => {
  return candleStorage1h.get(market) ?? [];
};
