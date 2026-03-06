/**
 * 역추세 전략(A·E) 공통: 5분봉 MA5 < MA20 일 때 매수 스킵.
 * 마켓별로 스킵 구간 시작/끝에만 한 번씩 로그 (중복 방지).
 */
import { logger } from "../logger";

const LOG_SOURCE = "strategy";

const downtrendSkipStateByMarket = new Map<string, boolean>();

/**
 * 하락추세(MA5 < MA20) 여부에 따라 스킵 여부 반환.
 * 전환 시에만 "[BT] 역추세(A,E) 매수 스킵 ... — 시작/끝" 로그 1회.
 * @returns true 이면 매수 스킵(역추세 A·E 모두 동일 조건으로 막음)
 */
export function shouldSkipDowntrend(
  market: string,
  isDowntrend: boolean,
  ma5: number,
  ma20: number,
): boolean {
  if (isDowntrend) {
    const wasSkipping = downtrendSkipStateByMarket.get(market) ?? false;
    if (!wasSkipping) {
      logger.info(
        LOG_SOURCE,
        "[BT] 역추세(A,E) 매수 스킵 하락추세(MA5<MA20) — 시작 ma5=%s ma20=%s",
        ma5.toFixed(2),
        ma20.toFixed(2),
      );
      downtrendSkipStateByMarket.set(market, true);
    }
    return true;
  }
  const wasSkipping = downtrendSkipStateByMarket.get(market) ?? false;
  if (wasSkipping) {
    logger.info(
      LOG_SOURCE,
      "[BT] 역추세(A,E) 매수 스킵 하락추세(MA5<MA20) 해제 — 끝 ma5=%s ma20=%s",
      ma5.toFixed(2),
      ma20.toFixed(2),
    );
    downtrendSkipStateByMarket.set(market, false);
  }
  return false;
}
