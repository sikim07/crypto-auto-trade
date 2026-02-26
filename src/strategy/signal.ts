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
  STOP_LOSS_PCT_MIN,
  STOP_LOSS_PCT_MAX,
  RSI_TAKE_PROFIT,
} from "../config";

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
    // 마지막 봉이 진행 중(거래량 0)이면 직전 마감 봉 기준으로 거래량 비율 계산
    const isCurrentCandleOpen =
      volumes.length > 1 && volumes[volumes.length - 1] === 0;
    const closedVolumes = isCurrentCandleOpen ? volumes.slice(0, -1) : volumes;
    const lastClosedVolume =
      closedVolumes.length > 0 ? closedVolumes[closedVolumes.length - 1] : 0;
    const volRatio = getVolumeRatio(
      lastClosedVolume,
      closedVolumes,
      VOLUME_AVG_PERIOD,
    );

    const condBB = currentPrice <= bb.lower;
    const condRsi = rsiPrev <= 32 && rsi > rsiPrev;
    const condMacd =
      macd.histogram > macd.prevHistogram ||
      (macd.prevMacd <= macd.prevSignal && macd.macd > macd.signal);
    const condVol = volRatio >= VOLUME_SURGE_RATIO;

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

/** 매도: 손절(최우선), 익절, RSI 70 이상 */
export const checkSellSignal = (
  market: string,
  buyPrice: number,
  currentPrice: number,
): SellSignalResult => {
  const netPct = getNetProfitPct(buyPrice, currentPrice);

  if (netPct <= STOP_LOSS_PCT_MAX) {
    return { shouldSell: true, reason: `손절 (순수익 ${netPct.toFixed(2)}%)` };
  }
  if (netPct >= TAKE_PROFIT_PCT_MIN) {
    return { shouldSell: true, reason: `익절 (순수익 ${netPct.toFixed(2)}%)` };
  }

  const candles = getCandles(market);
  if (candles.length >= 20) {
    const prices = pricesFromCandles(candles);
    const rsi = calculateRSI(prices);
    if (rsi >= RSI_TAKE_PROFIT) {
      return { shouldSell: true, reason: `RSI 익절 (${rsi.toFixed(1)})` };
    }
  }

  return { shouldSell: false };
};
