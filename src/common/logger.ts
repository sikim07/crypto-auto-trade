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

const format = (level: string, src: string, msg: string, ...args: unknown[]): string => {
  let text = msg;
  for (const a of args) {
    const s = typeof a === "object" ? JSON.stringify(a) : String(a);
    text = text.includes("%s") ? text.replace("%s", s) : text + " " + s;
  }
  return `${timestamp()} [${level}] [${src}] ${text}`;
};

export const logger = {
  debug: (src: string, msg: string, ...args: unknown[]): void => {
    if (currentLevel <= LOG_LEVELS.DEBUG)
      console.log(format("DEBUG", src, msg, ...args));
  },
  info: (src: string, msg: string, ...args: unknown[]): void => {
    if (currentLevel <= LOG_LEVELS.INFO)
      console.log(format("INFO", src, msg, ...args));
  },
  warn: (src: string, msg: string, ...args: unknown[]): void => {
    if (currentLevel <= LOG_LEVELS.WARN)
      console.warn(format("WARN", src, msg, ...args));
  },
  error: (src: string, msg: string, ...args: unknown[]): void => {
    if (currentLevel <= LOG_LEVELS.ERROR)
      console.error(format("ERROR", src, msg, ...args));
  },
};
