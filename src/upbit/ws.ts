/**
 * Upbit WebSocket 클라이언트
 *
 * 실시간 시세 데이터를 수신하기 위한 WebSocket 연결 관리.
 * - 구독 요청: ticker(현재가) 이벤트를 종목별로 수신
 * - 워치독: 60초간 메시지가 없으면 자동 재연결
 * - 에러 복구: 연결 끊김 시 자동 재연결 시도
 *
 * 참고: https://docs.upbit.com/docs/upbit-quotation-websocket
 */
import WebSocket from "ws";
import { UPBIT_WS_URL, WS_WATCHDOG_MS } from "../common/config";
import { out } from "../common/logger";

const LOG = "upbit/ws";

export interface TickerMessage {
  market?: string;
  code?: string;           // market과 동일 (Upbit WS 응답 필드명)
  trade_price: number;     // 최근 체결가
  trade_timestamp: number;
  [key: string]: unknown;
}

export type TickerCallback = (data: TickerMessage) => void;

let ws: WebSocket | null = null;
let watchdog: ReturnType<typeof setTimeout> | null = null;
let currentMarkets: string[] = [];
let currentCallback: TickerCallback | null = null;

/** 워치독 타이머 리셋 — 메시지 수신할 때마다 호출 */
const resetWatchdog = (): void => {
  if (watchdog) clearTimeout(watchdog);
  watchdog = setTimeout(() => {
    out.warn("ws-watchdog", LOG, "무응답 감지, 재연결");
    connect(currentMarkets, currentCallback!);
  }, WS_WATCHDOG_MS);
};

/** WebSocket 연결 및 구독 */
const connect = (markets: string[], callback: TickerCallback): void => {
  if (ws) {
    try { ws.close(1000, "재연결"); } catch { /* ignore */ }
    ws = null;
  }

  out.info(LOG, "WebSocket 연결: %s개 종목", String(markets.length));
  const socket = new WebSocket(UPBIT_WS_URL);
  ws = socket;
  currentMarkets = markets;
  currentCallback = callback;

  socket.on("open", () => {
    out.info(LOG, "연결 성공, 구독 요청");
    // Upbit WS 프로토콜: ticket(세션ID) + type(데이터 종류) + codes(종목)
    socket.send(JSON.stringify([
      { ticket: `grid-${Date.now()}` },
      { type: "ticker", codes: markets, isOnlyRealtime: true },
    ]));
    resetWatchdog();
  });

  socket.on("message", (data: Buffer) => {
    resetWatchdog();
    try {
      const parsed = JSON.parse(data.toString()) as TickerMessage;
      if (callback && (parsed.market || parsed.code)) callback(parsed);
    } catch { /* ignore */ }
  });

  socket.on("error", (err) => {
    out.warn("ws-error", LOG, "WebSocket 오류: %s", (err as Error).message);
  });

  socket.on("close", (code) => {
    if (code !== 1000) out.warn("ws-close", LOG, "연결 종료 (code: %s)", String(code));
    ws = null;
    if (watchdog) { clearTimeout(watchdog); watchdog = null; }
  });
};

/** 종목 구독 시작 */
export const subscribe = (markets: string[], callback: TickerCallback): void => {
  if (markets.length === 0) return;
  connect(markets, callback);
};

/** 구독 해제 및 연결 종료 */
export const unsubscribe = (): void => {
  if (watchdog) { clearTimeout(watchdog); watchdog = null; }
  if (ws) {
    try { ws.close(1000, "구독 해제"); } catch { /* ignore */ }
    ws = null;
  }
  currentMarkets = [];
  currentCallback = null;
};
