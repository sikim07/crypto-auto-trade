/**
 * 세션 기반 거래 파일 로거
 *
 * 봇 기동 시각을 파일명으로 사용해 재배포 단위로 로그 파일이 분리된다.
 * 파일 위치: <프로젝트루트>/logs/trades_<YYYY-MM-DDTHH-mm-ss>.log
 *
 * 기존 pm2 out/error 로그 활용 방식은 그대로 유지하고,
 * [매매기록] 라인을 이 파일에도 동시 기록한다.
 */
import fs from "fs";
import path from "path";

const sessionId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19); // "2026-03-05T14-30-22"

const logDir = path.resolve(process.cwd(), "logs");

if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const logPath = path.join(logDir, `trades_${sessionId}.log`);

/** 세션 헤더를 파일 첫 줄에 기록한다 */
const header = [
  "=".repeat(60),
  `  BOOT : ${sessionId}`,
  `  PID  : ${process.pid}`,
  "=".repeat(60),
  "",
].join("\n");

fs.appendFileSync(logPath, header);

/**
 * 거래 로그 한 줄을 세션 파일에 기록한다.
 * console.error([매매기록]) 와 동일한 라인을 넘기면 된다.
 */
export const writeTradeLog = (line: string): void => {
  try {
    fs.appendFileSync(logPath, line + "\n");
  } catch {
    // 파일 기록 실패는 봇 동작에 영향 없이 무시
  }
};

/** 현재 세션 로그 파일 경로 (디버깅/배너용) */
export const tradeLogPath = logPath;
