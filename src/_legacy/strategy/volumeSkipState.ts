/**
 * 추세/돌파 전략(C·D) 거래량부족 스킵: 마켓·전략별로 스킵 구간 시작/끝에만 한 번씩 로그 (중복 방지).
 */
import { logger } from "../logger";

const LOG_SOURCE = "strategy";

const volumeSkipStateByKey = new Map<string, boolean>();

function stateKey(market: string, strategyId: string): string {
  return `${market}:${strategyId}`;
}

/**
 * 거래량부족 스킵 전환 시에만 로그.
 * 스킵 구간 진입 시 "시작", 해제 시 "끝" 1회만 출력.
 */
export function logVolumeSkipTransition(
  market: string,
  strategyId: "C" | "D",
  isSkipping: boolean,
  volRatio: number,
  required: number,
): void {
  const key = stateKey(market, strategyId);
  const wasSkipping = volumeSkipStateByKey.get(key) ?? false;

  if (isSkipping) {
    if (!wasSkipping) {
      logger.info(
        LOG_SOURCE,
        "[BT] %s 매수 스킵 거래량부족 — 시작 volRatio=%s 필요=%s",
        strategyId,
        volRatio.toFixed(2),
        String(required),
      );
      volumeSkipStateByKey.set(key, true);
    }
    return;
  }
  if (wasSkipping) {
    logger.info(
      LOG_SOURCE,
      "[BT] %s 매수 스킵 거래량부족 해제 — 끝 volRatio=%s 필요=%s",
      strategyId,
      volRatio.toFixed(2),
      String(required),
    );
    volumeSkipStateByKey.set(key, false);
  }
}
