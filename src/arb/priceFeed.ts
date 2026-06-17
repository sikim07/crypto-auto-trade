import { getBookTicker, subscribePrices, unsubscribePrices } from "../exchange/binance";
import { ARB } from "./arbConfig";
import { out } from "../common/logger";

const LOG = "arb/price";

// ── CEX 가격 (Binance, WebSocket 실시간) ──

interface CexPrice {
  bid: number;   // 매수 호가 (이 가격에 매도 가능)
  ask: number;   // 매도 호가 (이 가격에 매수 가능)
  updatedAt: number;
}

const cexPrices = new Map<string, CexPrice>();

export const getCexPrice = (symbol: string): CexPrice | undefined => cexPrices.get(symbol);

const cexFirstReceived = new Set<string>();

export const startCexFeed = (): void => {
  subscribePrices(ARB.SYMBOLS, (symbol, bid, ask) => {
    cexPrices.set(symbol, { bid, ask, updatedAt: Date.now() });
    if (!cexFirstReceived.has(symbol)) {
      cexFirstReceived.add(symbol);
      out.info(LOG, "%s CEX 가격 수신 시작: bid=%s ask=%s", symbol, bid.toFixed(4), ask.toFixed(4));
    }
  });
};

export const stopCexFeed = (): void => {
  unsubscribePrices();
};

// ── DEX 가격 (Jupiter API, 폴링) ──

// 솔라나 토큰 민트 주소
const MINT_MAP: Record<string, { base: string; quote: string; baseDecimals: number }> = {
  SOLUSDT: {
    base: "So11111111111111111111111111111111111111112",  // SOL
    quote: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT (Solana)
    baseDecimals: 9,
  },
  // ETHUSDT: Solana DEX에서 ETH 유동성 부족 → Binance 전용 모니터링
};

interface DexQuote {
  inputAmount: number;
  outputAmount: number;
  priceImpact: number;
  updatedAt: number;
}

const dexQuotes = new Map<string, { buy: DexQuote; sell: DexQuote }>();

export const getDexQuote = (symbol: string) => dexQuotes.get(symbol);

// Jupiter API로 스왑 견적 조회
const fetchJupiterQuote = async (
  inputMint: string,
  outputMint: string,
  amount: number,
  decimals: number,
): Promise<{ outAmount: number; priceImpact: number } | null> => {
  try {
    const { default: axios } = await import("axios");
    const lamports = Math.round(amount * Math.pow(10, decimals));
    const { data } = await axios.get("https://api.jup.ag/swap/v1/quote", {
      params: {
        inputMint,
        outputMint,
        amount: String(lamports),
        slippageBps: 50, // 0.5% 슬리피지 허용
      },
      timeout: 5_000,
    });

    return {
      outAmount: parseInt(data.outAmount) / Math.pow(10, decimals === 9 ? 6 : 9),
      priceImpact: parseFloat(data.priceImpactPct ?? "0"),
    };
  } catch (e) {
    out.warn("jupiter-quote", LOG, "Jupiter 견적 실패: %s", (e as Error).message);
    return null;
  }
};

let dexPollTimer: ReturnType<typeof setInterval> | null = null;

export const startDexFeed = (): void => {
  // 지원하지 않는 심볼 경고
  for (const symbol of ARB.SYMBOLS) {
    if (!MINT_MAP[symbol]) {
      out.info(LOG, "%s: Solana DEX 미지원 → CEX 전용 모니터링", symbol);
    }
  }

  const pollDex = async () => {
    for (const symbol of ARB.SYMBOLS) {
      const mints = MINT_MAP[symbol];
      if (!mints) continue;

      // DEX에서 매수 (USDT → SOL): USDT를 넣고 SOL을 받음
      const buyQuote = await fetchJupiterQuote(
        mints.quote, mints.base,
        ARB.TRADE_AMOUNT_USDT,
        6, // USDT decimals
      );

      // DEX에서 매도 (SOL → USDT): SOL을 넣고 USDT를 받음
      // 먼저 현재 SOL 가격으로 수량 추정
      const cex = cexPrices.get(symbol);
      if (!cex || !buyQuote) continue;

      const solAmount = ARB.TRADE_AMOUNT_USDT / cex.ask; // 대략적 SOL 수량
      const sellQuote = await fetchJupiterQuote(
        mints.base, mints.quote,
        solAmount,
        9, // SOL decimals
      );

      if (buyQuote && sellQuote) {
        dexQuotes.set(symbol, {
          buy: {
            inputAmount: ARB.TRADE_AMOUNT_USDT,
            outputAmount: buyQuote.outAmount,
            priceImpact: buyQuote.priceImpact,
            updatedAt: Date.now(),
          },
          sell: {
            inputAmount: solAmount,
            outputAmount: sellQuote.outAmount,
            priceImpact: sellQuote.priceImpact,
            updatedAt: Date.now(),
          },
        });
      }
    }
  };

  pollDex();
  dexPollTimer = setInterval(pollDex, ARB.PRICE_POLL_MS);
};

export const stopDexFeed = (): void => {
  if (dexPollTimer) {
    clearInterval(dexPollTimer);
    dexPollTimer = null;
  }
};
