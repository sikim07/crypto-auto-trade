import WebSocket from "ws";
import { UPBIT_WS_URL, WS_WATCHDOG_MS } from "../common/config";
import { logger } from "../common/logger";

const LOG = "upbit/ws";

export interface TickerMessage {
  market?: string;
  code?: string;
  trade_price: number;
  trade_timestamp: number;
  [key: string]: unknown;
}

export type TickerCallback = (data: TickerMessage) => void;

let ws: WebSocket | null = null;
let watchdog: ReturnType<typeof setTimeout> | null = null;
let currentMarkets: string[] = [];
let currentCallback: TickerCallback | null = null;

const resetWatchdog = (): void => {
  if (watchdog) clearTimeout(watchdog);
  watchdog = setTimeout(() => {
    logger.warn(LOG, "무응답 감지, 재연결");
    connect(currentMarkets, currentCallback!);
  }, WS_WATCHDOG_MS);
};

const connect = (markets: string[], callback: TickerCallback): void => {
  if (ws) {
    try { ws.close(1000, "재연결"); } catch { /* ignore */ }
    ws = null;
  }

  logger.info(LOG, "WebSocket 연결: %s개 종목", String(markets.length));
  const socket = new WebSocket(UPBIT_WS_URL);
  ws = socket;
  currentMarkets = markets;
  currentCallback = callback;

  socket.on("open", () => {
    logger.info(LOG, "연결 성공, 구독 요청");
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
    logger.error(LOG, "WebSocket 오류: %s", (err as Error).message);
  });

  socket.on("close", (code) => {
    if (code !== 1000) logger.warn(LOG, "연결 종료 (code: %s)", String(code));
    ws = null;
    if (watchdog) { clearTimeout(watchdog); watchdog = null; }
  });
};

export const subscribe = (markets: string[], callback: TickerCallback): void => {
  if (markets.length === 0) return;
  connect(markets, callback);
};

export const unsubscribe = (): void => {
  if (watchdog) { clearTimeout(watchdog); watchdog = null; }
  if (ws) {
    try { ws.close(1000, "구독 해제"); } catch { /* ignore */ }
    ws = null;
  }
  currentMarkets = [];
  currentCallback = null;
};
