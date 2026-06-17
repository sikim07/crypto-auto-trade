/**
 * 공통 로거: 타임스탬프, 출처(source), 레벨(DEBUG/INFO/WARN/ERROR) 포함
 * LOG_LEVEL 환경변수로 최소 출력 레벨 제어 (기본: INFO)
 */
const LOG_LEVELS: Record<string, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const currentLevel: number =
  LOG_LEVELS[(process.env.LOG_LEVEL ?? "INFO").toUpperCase()] ??
  LOG_LEVELS.INFO;

const KST = "Asia/Seoul";

/** 한국시간(KST) 기준 타임스탬프: YYYY-MM-DD HH:mm:ss.SSS */
const timestamp = (): string => {
  const d = new Date();
  const datePart = d.toLocaleDateString("en-CA", { timeZone: KST });
  const timePart = d.toLocaleTimeString("en-GB", {
    timeZone: KST,
    hour12: false,
  });
  const ms = String(d.getUTCMilliseconds()).padStart(3, "0");
  return `${datePart} ${timePart}.${ms}`;
};

const format = (
  level: string,
  source: string,
  message: string,
  ...args: unknown[]
): string => {
  let text = message;
  for (const a of args) {
    const s = typeof a === "object" ? JSON.stringify(a) : String(a);
    text = text.includes("%s") ? text.replace("%s", s) : text + " " + s;
  }
  return `${timestamp()} [${level}] [${source}] ${text}`;
};

export type LogSource = string;

export const logger = {
  debug: (source: LogSource, message: string, ...args: unknown[]): void => {
    if (currentLevel <= LOG_LEVELS.DEBUG)
      console.log(format("DEBUG", source, message, ...args));
  },
  info: (source: LogSource, message: string, ...args: unknown[]): void => {
    if (currentLevel <= LOG_LEVELS.INFO)
      console.log(format("INFO", source, message, ...args));
  },
  warn: (source: LogSource, message: string, ...args: unknown[]): void => {
    if (currentLevel <= LOG_LEVELS.WARN)
      console.warn(format("WARN", source, message, ...args));
  },
  error: (source: LogSource, message: string, ...args: unknown[]): void => {
    if (currentLevel <= LOG_LEVELS.ERROR)
      console.error(format("ERROR", source, message, ...args));
  },
};
