import {
  calculateBollingerBands,
  calculateRSI,
  calculateMACD,
  getVolumeRatio,
} from "../indicators";
import { logger } from "../logger";

const LOG_SOURCE = "scripts/testIndicators";

const run = (): void => {
  const len = 50;
  const prices = Array.from(
    { length: len },
    (_, i) => 100 + Math.sin(i / 5) * 5 + i * 0.1,
  );
  const volumes = Array.from({ length: len }, () => 1000 + Math.random() * 500);

  const bb = calculateBollingerBands(prices);
  logger.info(
    LOG_SOURCE,
    "BB: upper=%s middle=%s lower=%s",
    bb.upper.toFixed(2),
    bb.middle.toFixed(2),
    bb.lower.toFixed(2),
  );

  const rsi = calculateRSI(prices);
  logger.info(LOG_SOURCE, "RSI: %s", rsi.toFixed(2));

  const macd = calculateMACD(prices);
  logger.info(
    LOG_SOURCE,
    "MACD: macd=%s signal=%s histogram=%s",
    macd.macd.toFixed(4),
    macd.signal.toFixed(4),
    macd.histogram.toFixed(4),
  );

  const volRatio = getVolumeRatio(volumes[volumes.length - 1], volumes, 20);
  logger.info(LOG_SOURCE, "Volume ratio: %s", volRatio.toFixed(2));
};

run();
