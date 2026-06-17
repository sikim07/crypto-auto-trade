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

/**
 * out 로그 (stdout) — 전략 모니터링/백테스트용
 * - PM2가 out.log 파일로 수집
 * - 스로틀 적용 가능
 */
export const out = {
  /** 일반 로그 (스로틀 없음) */
  info: (src: string, msg: string, ...args: unknown[]): void => {
    console.log(fmt("INFO", src, msg, ...args));
  },

  /** 디버그 로그 — 스로틀 30초 (같은 key에 대해) */
  debug: (key: string, src: string, msg: string, ...args: unknown[]): void => {
    if (shouldThrottle(key, 30_000)) return;
    console.log(fmt("DEBUG", src, msg, ...args));
  },

  /** 경고 로그 — 스로틀 10초 */
  warn: (key: string, src: string, msg: string, ...args: unknown[]): void => {
    if (shouldThrottle(key, 10_000)) return;
    console.log(fmt("WARN", src, msg, ...args));
  },

  /** 스로틀 없는 중요 로그 (시작/종료/리포트 등) */
  important: (src: string, msg: string, ...args: unknown[]): void => {
    console.log(fmt("INFO", src, msg, ...args));
  },
};

/**
 * err 로그 (stderr) — 트레이드 이력 전용
 * - PM2가 err.log 파일로 수집
 * - 스로틀 없음 (매매는 모두 기록)
 */
export const trade = {
  /** 매수/매도 체결 기록 */
  fill: (src: string, msg: string, ...args: unknown[]): void => {
    console.error(fmt("TRADE", src, msg, ...args));
  },

  /** 시스템 이벤트 (시작/종료/API 연결) */
  system: (src: string, msg: string, ...args: unknown[]): void => {
    console.error(fmt("SYSTEM", src, msg, ...args));
  },
};

// 하위 호환용 (마이그레이션 편의)
export const logger = {
  debug: (src: string, msg: string, ...args: unknown[]) => out.debug(src, src, msg, ...args),
  info: (src: string, msg: string, ...args: unknown[]) => out.info(src, msg, ...args),
  warn: (src: string, msg: string, ...args: unknown[]) => out.warn(src, src, msg, ...args),
  error: (src: string, msg: string, ...args: unknown[]) => console.error(fmt("ERROR", src, msg, ...args)),
};
