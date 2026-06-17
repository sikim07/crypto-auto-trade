import WebSocket from "ws";
import { WS_URL, WATCHDOG_TIMEOUT_MS } from "../config";
import { logger } from "../logger";

const LOG_SOURCE = "ws/ticker";

export interface TickerMessage {
  market?: string;
  code?: string;
  trade_price: number;
  trade_timestamp: number;
  trade_volume?: number;
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
    connect(subscribedMarkets, onTicker!, "무응답 감지로 Socket 재연결");
  }, WATCHDOG_TIMEOUT_MS);
};

const connect = (
  markets: string[],
  callback: TickerCallback,
  reasonForClosingExisting?: string,
): void => {
  if (ws) {
    logger.info(LOG_SOURCE, "기존 WebSocket 연결 종료 후 재연결");
    try {
      ws.close(1000, reasonForClosingExisting ?? "재연결");
    } catch {
      /* ignore */
    }
    ws = null;
  }

  logger.info(
    LOG_SOURCE,
    "WebSocket 연결 시도: %s (%s개 종목)",
    markets.join(", "),
    String(markets.length),
  );

  const socket = new WebSocket(WS_URL);
  ws = socket;
  subscribedMarkets = markets;
  onTicker = callback;

  socket.on("open", () => {
    logger.info(LOG_SOURCE, "WebSocket 연결 성공, 티커 구독 요청");
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
      logger.debug(LOG_SOURCE, "메시지 파싱 실패");
    }
  });

  socket.on("error", (err) => {
    logger.error(LOG_SOURCE, "WebSocket 오류: %s", (err as Error).message);
  });

  socket.on("close", (code, reason) => {
    const msg = "WebSocket 연결 종료 (code: %s, reason: %s)";
    const args = [String(code), reason?.toString() ?? "없음"];
    if (code === 1000) {
      logger.debug(LOG_SOURCE, msg, ...args);
    } else {
      logger.warn(LOG_SOURCE, msg, ...args);
    }
    ws = null;
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
  });
};

/** 구독 시작 (기존 연결 있으면 재연결). reasonForReconnect는 기존 연결 종료 시 close reason으로 사용 */
export const subscribeTicker = (
  markets: string[],
  callback: TickerCallback,
  reasonForReconnect?: string,
): void => {
  if (markets.length === 0) return;
  connect(markets, callback, reasonForReconnect);
};

/** 구독 해제. reason은 close 시 로그용 */
export const unsubscribeTicker = (reason?: string): void => {
  if (watchdogTimer) {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }
  if (ws) {
    try {
      ws.close(1000, reason ?? "구독 해제");
    } catch {
      /* ignore */
    }
    ws = null;
  }
  subscribedMarkets = [];
  onTicker = null;
};
