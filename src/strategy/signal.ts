import { getCandles } from "../data/candleWindow";
import {
  calculateBollingerBands,
  calculateRSI,
  calculateMACD,
  getVolumeRatio,
} from "../indicators";
import {
  VOLUME_SURGE_RATIO,
  VOLUME_AVG_PERIOD,
  COST_PCT,
  TAKE_PROFIT_PCT_MIN,
  TAKE_PROFIT_PCT_MAX,
  STOP_LOSS_PCT_MAX,
  RSI_TAKE_PROFIT,
  RSI_TAKE_PROFIT_MIN_PCT,
  RSI_MIN_BOUNCE,
  MAX_HOLD_MINUTES,
  TRAILING_STOP_ACTIVATE_PCT,
  TRAILING_STOP_OFFSET_PCT,
} from "../config";
import { logger } from "../logger";

const LOG_SOURCE = "signal";

const pricesFromCandles = (candles: { trade_price: number }[]): number[] =>
  candles.map((c) => c.trade_price);
const volumesFromCandles = (
  candles: { candle_acc_trade_volume: number }[],
): number[] => candles.map((c) => c.candle_acc_trade_volume);

export interface BuySignalResult {
  shouldBuy: boolean;
  reason?: string;
}

export interface SellSignalResult {
  shouldSell: boolean;
  reason?: string;
}

/** 매수: BB 하단 터치, RSI 32 이하 상승 반전, MACD 히스토그램 상승 또는 골든크로스, 거래량 급증(마지막 마감 봉 기준) */
export const checkBuySignal = (
  market: string,
  currentPrice: number,
): BuySignalResult => {
  const candles = getCandles(market);
  const needLen = 50;
  if (candles.length < needLen)
    return { shouldBuy: false, reason: "캔들 부족" };

  try {
    const prices = pricesFromCandles(candles);
    const volumes = volumesFromCandles(candles);
    const bb = calculateBollingerBands(prices);
    const rsi = calculateRSI(prices);
    const rsiPrev = calculateRSI(prices.slice(0, -1));
    const macd = calculateMACD(prices);

    const isCurrentCandleOpen =
      volumes.length > 1 && volumes[volumes.length - 1] === 0;
    const closedVolumes = isCurrentCandleOpen ? volumes.slice(0, -1) : volumes;
    const lastClosedVolume =
      closedVolumes.length > 0 ? closedVolumes[closedVolumes.length - 1] : 0;
    const prevVolumes = closedVolumes.slice(0, -1);
    const volRatio = getVolumeRatio(
      lastClosedVolume,
      prevVolumes,
      VOLUME_AVG_PERIOD,
    );

    const condBB = currentPrice <= bb.lower;
    const condRsi = rsiPrev <= 32 && rsi > rsiPrev + RSI_MIN_BOUNCE;
    const condMacd =
      (macd.histogram > macd.prevHistogram && macd.prevHistogram < 0) ||
      (macd.prevMacd <= macd.prevSignal && macd.macd > macd.signal);
    const condVol = volRatio >= VOLUME_SURGE_RATIO;

    const metCount = [condBB, condRsi, condMacd, condVol].filter(
      Boolean,
    ).length;

    logger.debug(
      LOG_SOURCE,
      "[매수검토] %s | 가격 %s | BB하단 %s (%s) | RSI %s→%s (%s) | MACD hist %s→%s (%s) | 거래량비 %s (%s) | 충족 %s/4",
      market,
      currentPrice.toFixed(0),
      bb.lower.toFixed(0),
      condBB ? "O" : "X",
      rsiPrev.toFixed(1),
      rsi.toFixed(1),
      condRsi ? "O" : "X",
      macd.prevHistogram.toFixed(4),
      macd.histogram.toFixed(4),
      condMacd ? "O" : "X",
      volRatio.toFixed(2),
      condVol ? "O" : "X",
      String(metCount),
    );

    if (metCount >= 3 && metCount < 4) {
      const missed = [
        !condBB && "BB",
        !condRsi && "RSI",
        !condMacd && "MACD",
        !condVol && "거래량",
      ]
        .filter(Boolean)
        .join(",");
      logger.info(
        LOG_SOURCE,
        "[근접신호] %s | 3/4 충족, 미충족: %s",
        market,
        missed,
      );
    }

    if (condBB && condRsi && condMacd && condVol) {
      return { shouldBuy: true, reason: "BB+RSI+MACD+거래량 충족" };
    }
    return { shouldBuy: false };
  } catch {
    return { shouldBuy: false, reason: "지표 계산 오류" };
  }
};

/** 순수익률 (비용 차감): (현재가-매수가)/매수가*100 - COST_PCT */
export const getNetProfitPct = (
  buyPrice: number,
  currentPrice: number,
): number => {
  const raw = ((currentPrice - buyPrice) / buyPrice) * 100;
  return raw - COST_PCT;
};

export interface SellOptions {
  buyTime?: number;
  maxNetPct?: number;
}

/** 매도: 손절 → 익절 → 트레일링 스톱 → 최대 보유시간 → RSI 익절 */
export const checkSellSignal = (
  market: string,
  buyPrice: number,
  currentPrice: number,
  options?: SellOptions,
): SellSignalResult => {
  const netPct = getNetProfitPct(buyPrice, currentPrice);
  const holdMin = options?.buyTime
    ? (Date.now() - options.buyTime) / 60_000
    : 0;

  logger.debug(
    LOG_SOURCE,
    "[매도검토] %s | 매수가 %s | 현재가 %s | 순수익 %s%% | 보유 %s분 | 최대순수익 %s%%",
    market,
    buyPrice.toFixed(0),
    currentPrice.toFixed(0),
    netPct.toFixed(2),
    holdMin.toFixed(1),
    (options?.maxNetPct ?? 0).toFixed(2),
  );

  if (netPct <= STOP_LOSS_PCT_MAX) {
    return { shouldSell: true, reason: `손절 (순수익 ${netPct.toFixed(2)}%)` };
  }

  if (netPct >= TAKE_PROFIT_PCT_MIN) {
    const inBand =
      netPct >= TAKE_PROFIT_PCT_MIN && netPct <= TAKE_PROFIT_PCT_MAX;
    return {
      shouldSell: true,
      reason: inBand
        ? `익절 (순수익 ${netPct.toFixed(2)}%)`
        : `익절 상한 돌파 (순수익 ${netPct.toFixed(2)}%)`,
    };
  }

  if (
    options?.maxNetPct !== undefined &&
    options.maxNetPct >= TRAILING_STOP_ACTIVATE_PCT &&
    netPct <= options.maxNetPct - TRAILING_STOP_OFFSET_PCT
  ) {
    return {
      shouldSell: true,
      reason: `트레일링 스톱 (고점 ${options.maxNetPct.toFixed(2)}% → 현재 ${netPct.toFixed(2)}%)`,
    };
  }

  if (options?.buyTime !== undefined) {
    const holdMinutes = (Date.now() - options.buyTime) / 60_000;
    if (holdMinutes >= MAX_HOLD_MINUTES) {
      return {
        shouldSell: true,
        reason: `최대 보유시간 초과 (${holdMinutes.toFixed(0)}분, 순수익 ${netPct.toFixed(2)}%)`,
      };
    }
  }

  const candles = getCandles(market);
  if (candles.length >= 20 && netPct >= RSI_TAKE_PROFIT_MIN_PCT) {
    const prices = pricesFromCandles(candles);
    const rsi = calculateRSI(prices);
    if (rsi >= RSI_TAKE_PROFIT) {
      return {
        shouldSell: true,
        reason: `RSI 익절 (${rsi.toFixed(1)}, 순수익 ${netPct.toFixed(2)}%)`,
      };
    }
  }

  return { shouldSell: false };
};
