import WebSocket from "ws";
import { WS_URL, WATCHDOG_TIMEOUT_MS } from "../config";
import { logger } from "../logger";

const LOG_SOURCE = "ws/ticker";

export interface TickerMessage {
  market?: string;
  code?: string;
  trade_price: number;
  trade_timestamp: number;
  acc_trade_volume_24h?: number;
  [key: string]: unknown;
}

export type TickerCallback = (data: TickerMessage) => void;

let ws: WebSocket | null = null;
let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
let subscribedMarkets: string[] = [];
let onTicker: TickerCallback | null = null;

const resetWatchdog = (): void => {
  if (watchdogTimer) clearTimeout(watchdogTimer);
  watchdogTimer = setTimeout(() => {
    logger.warn(LOG_SOURCE, "무응답 감지, WebSocket 재연결");
    connect(subscribedMarkets, onTicker!);
  }, WATCHDOG_TIMEOUT_MS);
};

const connect = (markets: string[], callback: TickerCallback): void => {
  if (ws) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    ws = null;
  }

  const socket = new WebSocket(WS_URL);
  ws = socket;
  subscribedMarkets = markets;
  onTicker = callback;

  socket.on("open", () => {
    const message = [
      { ticket: `ticket-${Date.now()}` },
      { type: "ticker", codes: markets, isOnlyRealtime: true },
    ];
    socket.send(JSON.stringify(message));
    resetWatchdog();
  });

  socket.on("message", (data: Buffer) => {
    resetWatchdog();
    try {
      const parsed = JSON.parse(data.toString()) as TickerMessage;
      if (onTicker && (parsed.market || parsed.code)) onTicker(parsed);
    } catch {
      // ignore parse error
    }
  });

  socket.on("error", (err) => {
    logger.error(LOG_SOURCE, "WebSocket 오류: %s", (err as Error).message);
  });

  socket.on("close", () => {
    ws = null;
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
  });
};

/** 구독 시작 (기존 연결 있으면 재연결) */
export const subscribeTicker = (
  markets: string[],
  callback: TickerCallback,
): void => {
  if (markets.length === 0) return;
  connect(markets, callback);
};

/** 구독 해제 */
export const unsubscribeTicker = (): void => {
  if (watchdogTimer) {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }
  if (ws) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    ws = null;
  }
  subscribedMarkets = [];
  onTicker = null;
};
