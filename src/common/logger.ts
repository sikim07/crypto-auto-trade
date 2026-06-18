/**
 * 로거 모듈
 *
 * PM2 환경에서 stdout과 stderr를 분리하여 로그를 관리한다.
 * - stdout (out.log): 모니터링/디버그 로그 (스로틀 적용)
 * - stderr (err.log): 거래 체결/시스템 이벤트 로그 (스로틀 없음, 모든 이벤트 기록)
 *
 * 스로틀: 같은 키의 로그가 일정 시간 내 반복되면 무시 (노이즈 감소)
 */

const KST = "Asia/Seoul";

/** KST 기준 타임스탬프 문자열 생성 (예: "2026-06-18 14:30:00.123") */
const timestamp = (): string => {
  const d = new Date();
  const datePart = d.toLocaleDateString("en-CA", { timeZone: KST });
  const timePart = d.toLocaleTimeString("en-GB", { timeZone: KST, hour12: false });
  const ms = String(d.getUTCMilliseconds()).padStart(3, "0");
  return `${datePart} ${timePart}.${ms}`;
};

/** 로그 메시지 포맷팅 ("[타임스탬프] [레벨] [출처] 메시지") */
const fmt = (prefix: string, src: string, msg: string, ...args: unknown[]): string => {
  let text = msg;
  for (const a of args) {
    const s = typeof a === "object" ? JSON.stringify(a) : String(a);
    text = text.includes("%s") ? text.replace("%s", s) : text + " " + s;
  }
  return `${timestamp()} [${prefix}] [${src}] ${text}`;
};

// ── 스로틀 관리 ──
// 키별로 마지막 로그 시각을 기록하여 일정 시간 내 중복 로그 억제
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
 * 전략 모니터링/디버그용. debug와 warn은 스로틀 적용.
 */
export const out = {
  info: (src: string, msg: string, ...args: unknown[]): void => {
    writeOut(fmt("INFO", src, msg, ...args));
  },

  /** debug: 30초 간격 스로틀 */
  debug: (key: string, src: string, msg: string, ...args: unknown[]): void => {
    if (shouldThrottle(key, 30_000)) return;
    writeOut(fmt("DEBUG", src, msg, ...args));
  },

  /** warn: 10초 간격 스로틀 */
  warn: (key: string, src: string, msg: string, ...args: unknown[]): void => {
    if (shouldThrottle(key, 10_000)) return;
    writeOut(fmt("WARN", src, msg, ...args));
  },

  /** 항상 출력 (스로틀 없음) — 리포트 등 중요 정보 */
  important: (src: string, msg: string, ...args: unknown[]): void => {
    writeOut(fmt("INFO", src, msg, ...args));
  },
};

/**
 * trade 로그 (stderr → PM2 err.log)
 * 거래 체결과 시스템 이벤트 전용. 스로틀 없이 모든 이벤트를 기록.
 */
export const trade = {
  /** 매수/매도 체결 기록 */
  fill: (src: string, msg: string, ...args: unknown[]): void => {
    writeErr(fmt("TRADE", src, msg, ...args));
  },

  /** 시스템 이벤트 (시작/종료/에러 등) */
  system: (src: string, msg: string, ...args: unknown[]): void => {
    writeErr(fmt("SYSTEM", src, msg, ...args));
  },
};

/** 범용 로거 (하위 호환) */
export const logger = {
  debug: (src: string, msg: string, ...args: unknown[]) => out.debug(src, src, msg, ...args),
  info: (src: string, msg: string, ...args: unknown[]) => out.info(src, msg, ...args),
  warn: (src: string, msg: string, ...args: unknown[]) => out.warn(src, src, msg, ...args),
  error: (src: string, msg: string, ...args: unknown[]) => writeErr(fmt("ERROR", src, msg, ...args)),
};
