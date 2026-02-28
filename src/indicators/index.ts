import {
  BB_PERIOD,
  BB_STD_MULT,
  RSI_PERIOD,
  MACD_FAST,
  MACD_SLOW,
  MACD_SIGNAL,
} from "../config";

/** 볼린저 밴드 결과 */
export interface BollingerBands {
  upper: number;
  middle: number;
  lower: number;
}

/** MACD 결과 (최근 값 + 이전 값으로 골든크로스/히스토그램 상승 판별용) */
export interface MACDResult {
  macd: number;
  signal: number;
  histogram: number;
  prevMacd: number;
  prevSignal: number;
  prevHistogram: number;
}

const sum = (arr: number[]): number => arr.reduce((a, b) => a + b, 0);

export const calculateSMA = (data: number[], period: number): number => {
  if (data.length < period)
    throw new Error(`SMA: need ${period}, got ${data.length}`);
  return sum(data.slice(-period)) / period;
};

export const calculateStdDev = (data: number[], mean?: number): number => {
  const m = mean ?? sum(data) / data.length;
  const sq = data.map((x) => (x - m) ** 2);
  return Math.sqrt(sum(sq) / data.length);
};

export const calculateBollingerBands = (
  prices: number[],
  period: number = BB_PERIOD,
  stdMult: number = BB_STD_MULT,
): BollingerBands => {
  if (prices.length < period)
    throw new Error(`BB: need ${period}, got ${prices.length}`);
  const slice = prices.slice(-period);
  const middle = sum(slice) / period;
  const std = calculateStdDev(slice, middle);
  return {
    upper: middle + stdMult * std,
    middle,
    lower: middle - stdMult * std,
  };
};

/** Wilder's Smoothed RSI (표준 RSI) */
export const calculateRSI = (
  prices: number[],
  period: number = RSI_PERIOD,
): number => {
  if (prices.length < period + 1)
    throw new Error(`RSI: need ${period + 1}, got ${prices.length}`);

  const changes: number[] = [];
  for (let i = 1; i < prices.length; i++)
    changes.push(prices[i] - prices[i - 1]);

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += -changes[i];
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? -changes[i] : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
};

/** EMA 한 값 (배열 끝 기준) */
const emaOne = (prices: number[], period: number): number => {
  if (prices.length < period) return NaN;
  const k = 2 / (period + 1);
  let ema = sum(prices.slice(0, period)) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
};

export const calculateMACD = (
  prices: number[],
  fast: number = MACD_FAST,
  slow: number = MACD_SLOW,
  signalPeriod: number = MACD_SIGNAL,
): MACDResult => {
  const minLen = slow + signalPeriod;
  if (prices.length < minLen + 1)
    throw new Error(`MACD: need ${minLen + 1}, got ${prices.length}`);

  const emaFastArr: number[] = [];
  const emaSlowArr: number[] = [];
  for (let i = slow; i <= prices.length; i++) {
    const slice = prices.slice(0, i);
    emaFastArr.push(emaOne(slice, fast));
    emaSlowArr.push(emaOne(slice, slow));
  }
  const macdLine: number[] = [];
  for (let i = 0; i < emaFastArr.length; i++) {
    macdLine.push(emaFastArr[i] - emaSlowArr[i]);
  }
  const signalLine: number[] = [];
  if (macdLine.length >= signalPeriod) {
    const k = 2 / (signalPeriod + 1);
    let ema = sum(macdLine.slice(0, signalPeriod)) / signalPeriod;
    signalLine.push(ema);
    for (let i = signalPeriod; i < macdLine.length; i++) {
      ema = macdLine[i] * k + ema * (1 - k);
      signalLine.push(ema);
    }
  }
  const histogram: number[] = macdLine
    .slice(signalPeriod - 1)
    .map((m, i) => m - signalLine[i]);

  const len = histogram.length;
  return {
    macd: macdLine[macdLine.length - 1],
    signal: signalLine[signalLine.length - 1],
    histogram: histogram[len - 1],
    prevMacd: macdLine[macdLine.length - 2],
    prevSignal: signalLine[signalLine.length - 2],
    prevHistogram: histogram[len - 2],
  };
};

/** 직전 N개 거래량 평균 대비 현재 거래량 비율 */
export const getVolumeRatio = (
  currentVolume: number,
  volumes: number[],
  period: number,
): number => {
  if (volumes.length < period) return 1;
  const avg = sum(volumes.slice(-period)) / period;
  if (avg === 0) return 1;
  return currentVolume / avg;
};
