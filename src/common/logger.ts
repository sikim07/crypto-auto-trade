const KST = "Asia/Seoul";

const timestamp = (): string => {
  const d = new Date();
  const datePart = d.toLocaleDateString("en-CA", { timeZone: KST });
  const timePart = d.toLocaleTimeString("en-GB", { timeZone: KST, hour12: false });
  const ms = String(d.getUTCMilliseconds()).padStart(3, "0");
  return `${datePart} ${timePart}.${ms}`;
};

const fmt = (prefix: string, src: string, msg: string, ...args: unknown[]): string => {
  let text = msg;
  for (const a of args) {
    const s = typeof a === "object" ? JSON.stringify(a) : String(a);
    text = text.includes("%s") ? text.replace("%s", s) : text + " " + s;
  }
  return `${timestamp()} [${prefix}] [${src}] ${text}`;
};

// ── 스로틀 관리 ──
const lastLogTime = new Map<string, number>();

const shouldThrottle = (key: string, intervalMs: number): boolean => {
  const now = Date.now();
  const last = lastLogTime.get(key) ?? 0;
  if (now - last < intervalMs) return true;
  lastLogTime.set(key, now);
  return false;
};

// ── 직접 write (버퍼 flush 보장) ──
const writeOut = (line: string): void => {
  process.stdout.write(line + "\n");
};

const writeErr = (line: string): void => {
  process.stderr.write(line + "\n");
};

/**
 * out 로그 (stdout → PM2 out.log)
 * 전략 모니터링/백테스트용, 스로틀 적용
 */
export const out = {
  info: (src: string, msg: string, ...args: unknown[]): void => {
    writeOut(fmt("INFO", src, msg, ...args));
  },

  debug: (key: string, src: string, msg: string, ...args: unknown[]): void => {
    if (shouldThrottle(key, 30_000)) return;
    writeOut(fmt("DEBUG", src, msg, ...args));
  },

  warn: (key: string, src: string, msg: string, ...args: unknown[]): void => {
    if (shouldThrottle(key, 10_000)) return;
    writeOut(fmt("WARN", src, msg, ...args));
  },

  important: (src: string, msg: string, ...args: unknown[]): void => {
    writeOut(fmt("INFO", src, msg, ...args));
  },
};

/**
 * trade 로그 (stderr → PM2 err.log)
 * 트레이드 이력 + 시스템 이벤트 전용, 스로틀 없음
 */
export const trade = {
  fill: (src: string, msg: string, ...args: unknown[]): void => {
    writeErr(fmt("TRADE", src, msg, ...args));
  },

  system: (src: string, msg: string, ...args: unknown[]): void => {
    writeErr(fmt("SYSTEM", src, msg, ...args));
  },
};

// 하위 호환
export const logger = {
  debug: (src: string, msg: string, ...args: unknown[]) => out.debug(src, src, msg, ...args),
  info: (src: string, msg: string, ...args: unknown[]) => out.info(src, msg, ...args),
  warn: (src: string, msg: string, ...args: unknown[]) => out.warn(src, src, msg, ...args),
  error: (src: string, msg: string, ...args: unknown[]) => writeErr(fmt("ERROR", src, msg, ...args)),
};
