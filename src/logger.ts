/**
 * 공통 로거: 타임스탬프, 출처(source), 레벨(INFO/WARN/ERROR) 포함
 */
const timestamp = (): string => new Date().toISOString();

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
  info: (source: LogSource, message: string, ...args: unknown[]): void => {
    console.log(format("INFO", source, message, ...args));
  },
  warn: (source: LogSource, message: string, ...args: unknown[]): void => {
    console.warn(format("WARN", source, message, ...args));
  },
  error: (source: LogSource, message: string, ...args: unknown[]): void => {
    console.error(format("ERROR", source, message, ...args));
  },
};
