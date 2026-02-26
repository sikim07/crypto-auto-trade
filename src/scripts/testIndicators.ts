import {
  calculateBollingerBands,
  calculateRSI,
  calculateMACD,
  getVolumeRatio,
} from "../indicators";

const run = (): void => {
  const len = 50;
  const prices = Array.from(
    { length: len },
    (_, i) => 100 + Math.sin(i / 5) * 5 + i * 0.1,
  );
  const volumes = Array.from({ length: len }, () => 1000 + Math.random() * 500);

  const bb = calculateBollingerBands(prices);
  console.log("BB:", {
    upper: bb.upper.toFixed(2),
    middle: bb.middle.toFixed(2),
    lower: bb.lower.toFixed(2),
  });

  const rsi = calculateRSI(prices);
  console.log("RSI:", rsi.toFixed(2));

  const macd = calculateMACD(prices);
  console.log("MACD:", {
    macd: macd.macd.toFixed(4),
    signal: macd.signal.toFixed(4),
    histogram: macd.histogram.toFixed(4),
  });

  const volRatio = getVolumeRatio(volumes[volumes.length - 1], volumes, 20);
  console.log("Volume ratio:", volRatio.toFixed(2));
};

run();
