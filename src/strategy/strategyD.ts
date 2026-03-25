import { getCandles } from "../data/candleWindow";
import { calculateRSI, getVolumeRatio, calculateSMA } from "../indicators";
import {
  RSI_PERIOD,
  STRATEGY_D_RSI_CROSS,
  STRATEGY_D_RSI_MAX,
  STRATEGY_D_RSI_MIN_CROSS_STRENGTH,
  STRATEGY_D_VOLUME_RATIO,
  STRATEGY_D_VOLUME_RATIO_MAX,
  STRATEGY_D_VOLUME_AVG_PERIOD,
  STRATEGY_D_DISPLACEMENT_MAX,
  STRATEGY_D_DISPLACEMENT_MIN,
  STRATEGY_D_MA20_BREAK_BUFFER,
  STRATEGY_D_MAX_HOLD_MINUTES,
  STRATEGY_D_MA_PERIODS,
  STRATEGY_D_STOP_LOSS_PCT,
  STRATEGY_D_MIN_PROFIT_BEFORE_MA5_EXIT,
  STRATEGY_D_TRAILING_ACTIVATE_PCT,
  STRATEGY_D_TRAILING_OFFSET_PCT,
  COST_PCT,
} from "../config";
import type { BuySignalResult, SellSignalResult } from "./signal";
import type { BotPosition } from "../types";
import { logger } from "../logger";
import { logVolumeSkipTransition } from "./volumeSkipState";

const LOG_SOURCE = "strategyD";
const pricesFromCandles = (candles: { trade_price: number }[]): number[] =>
  candles.map((c) => c.trade_price);

/** 거래량 상한 초과 스킵 상태 (마켓별) — 전환 시점에만 로그 */
const volMaxSkipStateByMarket = new Map<string, boolean>();

function logVolMaxSkipTransition(
  market: string,
  isSkipping: boolean,
  volRatio: number,
): void {
  const wasSkipping = volMaxSkipStateByMarket.get(market) ?? false;
  if (isSkipping) {
    if (!wasSkipping) {
      logger.info(
        LOG_SOURCE,
        "[BT] D 매수 스킵 거래량상한초과 — 시작 volRatio=%s max=%s",
        volRatio.toFixed(2),
        String(STRATEGY_D_VOLUME_RATIO_MAX),
      );
      volMaxSkipStateByMarket.set(market, true);
    }
    return;
  }
  if (wasSkipping) {
    logger.info(
      LOG_SOURCE,
      "[BT] D 매수 스킵 거래량상한초과 해제 — 끝 volRatio=%s max=%s",
      volRatio.toFixed(2),
      String(STRATEGY_D_VOLUME_RATIO_MAX),
    );
    volMaxSkipStateByMarket.set(market, false);
  }
}

/**
 * RSI 상한 초과 스킵 상태 (마켓별) — 전환 시점에만 로그.
 * 매번 틱마다 "[BT] D 매수 스킵 RSI상한초과" 가 무수히 찍히는 것을 방지.
 */
const rsiMaxSkipStateByMarket = new Map<string, boolean>();

function logRsiMaxSkipTransition(
  market: string,
  isSkipping: boolean,
  rsiCur: number,
): void {
  const wasSkipping = rsiMaxSkipStateByMarket.get(market) ?? false;
  if (isSkipping) {
    if (!wasSkipping) {
      logger.info(
        LOG_SOURCE,
        "[BT] D 매수 스킵 RSI상한초과 — 시작 rsiCur=%s max=%s",
        rsiCur.toFixed(1),
        String(STRATEGY_D_RSI_MAX),
      );
      rsiMaxSkipStateByMarket.set(market, true);
    }
    return;
  }
  if (wasSkipping) {
    logger.info(
      LOG_SOURCE,
      "[BT] D 매수 스킵 RSI상한초과 해제 — 끝 rsiCur=%s max=%s",
      rsiCur.toFixed(1),
      String(STRATEGY_D_RSI_MAX),
    );
    rsiMaxSkipStateByMarket.set(market, false);
  }
}
const volumesFromCandles = (
  candles: { candle_acc_trade_volume: number }[],
): number[] => candles.map((c) => c.candle_acc_trade_volume);

const [MA5_PERIOD, MA10_PERIOD, MA20_PERIOD] = STRATEGY_D_MA_PERIODS;

/** 순수익률 (비용 차감) */
const getNetProfitPct = (buyPrice: number, currentPrice: number): number => {
  const raw = ((currentPrice - buyPrice) / buyPrice) * 100;
  return raw - COST_PCT;
};

/** 전략 D 매수: 5분봉 정배열+가격>MA20, 1분봉 RSI60 상향+거래량 150%, 이격도 2% 이내 */
export const checkBuySignalD = (
  market: string,
  currentPrice: number,
): (BuySignalResult & { strategy: "D" }) | null => {
  const candles1m = getCandles(market, 1);
  const candles5m = getCandles(market, 5);
  const need5m = MA20_PERIOD;
  const need1m = RSI_PERIOD + 2;
  if (candles1m.length < need1m + MA20_PERIOD || candles5m.length < need5m)
    return null;

  try {
    const prices5m = pricesFromCandles(candles5m);
    const lastClose5m = prices5m[prices5m.length - 1];
    const ma20_5m = calculateSMA(prices5m.slice(-MA20_PERIOD), MA20_PERIOD);
    if (lastClose5m <= ma20_5m) return null;

    const ma5_5m = calculateSMA(prices5m.slice(-MA5_PERIOD), MA5_PERIOD);
    const ma10_5m = calculateSMA(prices5m.slice(-MA10_PERIOD), MA10_PERIOD);
    if (!(ma5_5m > ma10_5m && ma10_5m > ma20_5m)) return null;

    const prices1m = pricesFromCandles(candles1m);
    const volumes1m = volumesFromCandles(candles1m);
    const isCurrentCandleOpen =
      volumes1m.length > 1 && volumes1m[volumes1m.length - 1] === 0;
    const closedPrices = isCurrentCandleOpen ? prices1m.slice(0, -1) : prices1m;
    const closedVolumes = isCurrentCandleOpen
      ? volumes1m.slice(0, -1)
      : volumes1m;
    if (closedPrices.length < need1m) return null;

    const rsiPrices = closedPrices.slice(-(RSI_PERIOD + 2));
    const rsiPrev = calculateRSI(rsiPrices.slice(0, -1));
    const rsiCur = calculateRSI(rsiPrices);
    if (!(rsiPrev < STRATEGY_D_RSI_CROSS && rsiCur >= STRATEGY_D_RSI_CROSS))
      return null;
    // 방안 B: 단순 경계 터치(예: 59→60)가 아닌 최소 3p 이상 상향 돌파만 유효 신호로 인정
    if (rsiCur - rsiPrev < STRATEGY_D_RSI_MIN_CROSS_STRENGTH) return null;
    // 과매수 구간 진입 차단: RSI가 상한(75) 초과 시 매수하지 않음. 과열 끝물 진입을 줄여 진입 직후 조정으로 인한 손절/휩쏘를 감소시키기 위함.
    if (rsiCur > STRATEGY_D_RSI_MAX) {
      logRsiMaxSkipTransition(market, true, rsiCur);
      return null;
    }
    // RSI 상한 초과 상태 해제 — 전환 로그
    logRsiMaxSkipTransition(market, false, rsiCur);

    const lastClosedVol = closedVolumes[closedVolumes.length - 1] ?? 0;
    const prevVols = closedVolumes.slice(0, -1);
    const volRatio = getVolumeRatio(
      lastClosedVol,
      prevVols,
      STRATEGY_D_VOLUME_AVG_PERIOD,
    );
    if (volRatio <= STRATEGY_D_VOLUME_RATIO) {
      logVolumeSkipTransition(
        market,
        "D",
        true,
        volRatio,
        STRATEGY_D_VOLUME_RATIO,
      );
      return null;
    }
    logVolumeSkipTransition(
      market,
      "D",
      false,
      volRatio,
      STRATEGY_D_VOLUME_RATIO,
    );

    // 거래량 상한 필터: 급등 끝물 진입 차단 — 전환 시점에만 로그 (rsiMaxSkipStateByMarket 패턴과 동일)
    // volRatio가 STRATEGY_D_VOLUME_RATIO_MAX 초과이면 이미 급등이 마감된 상태로 판단.
    // 수집 목적: [BT] D 매수 로그 volRatio 분포에서 손실 케이스와 대조해 임계값 정밀화.
    if (volRatio > STRATEGY_D_VOLUME_RATIO_MAX) {
      logVolMaxSkipTransition(market, true, volRatio);
      return null;
    }
    logVolMaxSkipTransition(market, false, volRatio);

    // [v3.4.20260312] 저가 코인 필터는 selectMarkets.ts(SELECT_MIN_PRICE)로 이관. 여기선 체크 불필요.

    const ma20_1m = calculateSMA(closedPrices.slice(-MA20_PERIOD), MA20_PERIOD);
    if (ma20_1m <= 0) return null;

    // 방안 D: 1분봉 단기 정배열 — MA5 > MA10이어야 1분봉 자체가 상승 방향임을 확인
    const ma5_1m = calculateSMA(closedPrices.slice(-MA5_PERIOD), MA5_PERIOD);
    const ma10_1m = calculateSMA(closedPrices.slice(-MA10_PERIOD), MA10_PERIOD);
    if (!(ma5_1m > ma10_1m)) return null;

    const displacement = currentPrice / ma20_1m;
    // 이격도 상한 체크
    if (displacement > STRATEGY_D_DISPLACEMENT_MAX) return null;
    // 이격도 하한 체크 (MA20에서 충분히 이격된 상태에서만 진입)
    if (displacement < STRATEGY_D_DISPLACEMENT_MIN) return null;

    logger.info(
      LOG_SOURCE,
      "[시그널] %s | 매수 조건 충족 | 가격 %s | MA20_1m %s | 이격도 %s | RSI %s→%s",
      market,
      currentPrice.toFixed(0),
      ma20_1m.toFixed(0),
      displacement.toFixed(4),
      rsiPrev.toFixed(1),
      rsiCur.toFixed(1),
    );
    logger.info(
      LOG_SOURCE,
      "[BT] D 매수 displacement=%s RSI=%s→%s volRatio=%s price=%s",
      displacement.toFixed(4),
      rsiPrev.toFixed(1),
      rsiCur.toFixed(1),
      volRatio.toFixed(2),
      currentPrice.toFixed(0),
    );
    return {
      shouldBuy: true,
      reason: "전략D: 정배열+1분봉정배열+RSI60상향+거래량(배수)+이격도범위",
      strategy: "D",
    };
  } catch (e) {
    logger.error(
      LOG_SOURCE,
      "[오류] 전략D 매수 검토 중 예외: %s",
      (e as Error).message,
    );
    return null;
  }
};

/** 전략 D 매도: 손절/MA20 추세 붕괴 최우선, 익절은 최소 수익 구간 넘은 뒤 MA5 하향 이탈 시에만 */
export const checkSellSignalD = (
  market: string,
  position: BotPosition,
  currentPrice: number,
): SellSignalResult => {
  try {
    const buyPrice = position.buyPrice;
    const netProfitPct = getNetProfitPct(buyPrice, currentPrice);

    // 1. 손절: 수익률과 관계없이 최우선
    if (netProfitPct <= STRATEGY_D_STOP_LOSS_PCT) {
      logger.info(
        LOG_SOURCE,
        "[시그널] %s | 손절 (순수익 %s%%)",
        market,
        netProfitPct.toFixed(2),
      );
      logger.info(
        LOG_SOURCE,
        "[BT] D 매도 type=손절 netPct=%s thr=%s",
        netProfitPct.toFixed(2),
        String(STRATEGY_D_STOP_LOSS_PCT),
      );
      return {
        shouldSell: true,
        reason: `전략D 손절 (순수익 ${netProfitPct.toFixed(2)}%)`,
      };
    }

    // 1-1. 방안 C: 소수익 보호 트레일링 스톱
    // 순수익이 한 번이라도 활성화 임계(STRATEGY_D_TRAILING_ACTIVATE_PCT) 이상 도달 시, 고점 대비 오프셋(STRATEGY_D_TRAILING_OFFSET_PCT) 하락 시 청산
    // maxNetPct 는 index.ts 에서 모든 전략 공통으로 자동 갱신됨 (types.ts 변경 불필요)
    if (position.maxNetPct >= STRATEGY_D_TRAILING_ACTIVATE_PCT) {
      const trailingDropPct = position.maxNetPct - netProfitPct;
      if (trailingDropPct >= STRATEGY_D_TRAILING_OFFSET_PCT) {
        logger.info(
          LOG_SOURCE,
          "[시그널] %s | 트레일링 스톱 (고점 %s%% → 현재 %s%%)",
          market,
          position.maxNetPct.toFixed(2),
          netProfitPct.toFixed(2),
        );
        logger.info(
          LOG_SOURCE,
          "[BT] D 매도 type=트레일링 maxPct=%s curPct=%s offsetPct=%s",
          position.maxNetPct.toFixed(2),
          netProfitPct.toFixed(2),
          String(STRATEGY_D_TRAILING_OFFSET_PCT),
        );
        return {
          shouldSell: true,
          reason: `전략D 트레일링 스톱 (고점 ${position.maxNetPct.toFixed(2)}% → 현재 ${netProfitPct.toFixed(2)}%)`,
        };
      }
    }

    // 최대 보유 시간 체크
    const holdMin = (Date.now() - position.buyTime) / 60_000;
    if (holdMin >= STRATEGY_D_MAX_HOLD_MINUTES) {
      logger.info(
        LOG_SOURCE,
        "[시그널] %s | 시간초과 (보유 %s분, 순수익 %s%%)",
        market,
        holdMin.toFixed(0),
        netProfitPct.toFixed(2),
      );
      logger.info(
        LOG_SOURCE,
        "[BT] D 매도 type=시간초과 holdMin=%s netPct=%s maxHold=%s",
        holdMin.toFixed(0),
        netProfitPct.toFixed(2),
        String(STRATEGY_D_MAX_HOLD_MINUTES),
      );
      return {
        shouldSell: true,
        reason: `전략D 시간초과 (${holdMin.toFixed(0)}분)`,
      };
    }

    const candles1m = getCandles(market, 1);
    const prices1m = pricesFromCandles(candles1m);
    const volumes1m = volumesFromCandles(candles1m);
    const isCurrentCandleOpen =
      volumes1m.length > 1 && volumes1m[volumes1m.length - 1] === 0;
    const closedPrices = isCurrentCandleOpen ? prices1m.slice(0, -1) : prices1m;

    // 2. 추세 붕괴: MA20 이탈은 종가 기준으로만 판단. 봉 도중 꼬리만 닿았다가 복귀하는 휩쏘를 줄이고, 확정 이탈 시에만 손절하기 위함.
    if (closedPrices.length >= MA20_PERIOD) {
      const ma20_1m = calculateSMA(
        closedPrices.slice(-MA20_PERIOD),
        MA20_PERIOD,
      );
      const ma20BreakThreshold = ma20_1m * (1 - STRATEGY_D_MA20_BREAK_BUFFER);
      const lastClose = closedPrices[closedPrices.length - 1];
      if (lastClose < ma20BreakThreshold) {
        logger.info(
          LOG_SOURCE,
          "[시그널] %s | 손절 (종가 기준 %s < MA20 버퍼 기준 %s)",
          market,
          lastClose.toFixed(0),
          ma20BreakThreshold.toFixed(0),
        );
        logger.info(
          LOG_SOURCE,
          "[BT] D 매도 type=MA20이탈 close=%s ma20Thr=%s netPct=%s",
          lastClose.toFixed(0),
          ma20BreakThreshold.toFixed(0),
          netProfitPct.toFixed(2),
        );
        return {
          shouldSell: true,
          reason: `전략D 손절 (종가 기준 ${lastClose.toFixed(0)} < MA20 버퍼 기준 ${ma20BreakThreshold.toFixed(0)})`,
        };
      }
    }

    // 3. 익절: 마감 봉 MA5 하향 이탈 + 최소 수익 구간 도달 시에만
    if (closedPrices.length >= MA5_PERIOD) {
      const lastClose = closedPrices[closedPrices.length - 1];
      const ma5_1m = calculateSMA(closedPrices.slice(-MA5_PERIOD), MA5_PERIOD);
      const isMa5Broken = lastClose < ma5_1m;
      const isMinProfitReached =
        netProfitPct > STRATEGY_D_MIN_PROFIT_BEFORE_MA5_EXIT;

      if (isMa5Broken && isMinProfitReached) {
        logger.info(
          LOG_SOURCE,
          "[시그널] %s | 익절 (MA5 하향 이탈) 종가 %s < MA5 %s | 순수익 %s%%",
          market,
          lastClose.toFixed(0),
          ma5_1m.toFixed(0),
          netProfitPct.toFixed(2),
        );
        logger.info(
          LOG_SOURCE,
          "[BT] D 매도 type=MA5이탈 close=%s ma5=%s netPct=%s minProfitThr=%s",
          lastClose.toFixed(0),
          ma5_1m.toFixed(0),
          netProfitPct.toFixed(2),
          String(STRATEGY_D_MIN_PROFIT_BEFORE_MA5_EXIT),
        );
        return {
          shouldSell: true,
          reason: `전략D 익절 (MA5 하향 이탈 ${lastClose.toFixed(0)} < ${ma5_1m.toFixed(0)}, 순수익 ${netProfitPct.toFixed(2)}%)`,
        };
      }
    }

    return { shouldSell: false };
  } catch (e) {
    logger.error(
      LOG_SOURCE,
      "[오류] 전략D 매도 검토 중 예외: %s",
      (e as Error).message,
    );
    return { shouldSell: false };
  }
};
