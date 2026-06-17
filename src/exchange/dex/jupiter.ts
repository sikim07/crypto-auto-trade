import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import axios from "axios";
import bs58 from "bs58";
import { SOLANA_PRIVATE_KEY, SOLANA_RPC_URL } from "../../common/config";
import { out, trade } from "../../common/logger";

const LOG = "dex/jupiter";
const JUPITER_API = "https://api.jup.ag/swap/v1";

let connection: Connection | null = null;
let wallet: Keypair | null = null;

const getConnection = (): Connection => {
  if (!connection) connection = new Connection(SOLANA_RPC_URL, "confirmed");
  return connection;
};

const getWallet = (): Keypair => {
  if (!wallet) {
    if (!SOLANA_PRIVATE_KEY) throw new Error("SOLANA_PRIVATE_KEY 미설정");
    wallet = Keypair.fromSecretKey(bs58.decode(SOLANA_PRIVATE_KEY));
  }
  return wallet;
};

export const getWalletAddress = (): string => {
  return getWallet().publicKey.toBase58();
};

export interface SwapResult {
  txId: string;
  inputAmount: number;
  outputAmount: number;
}

export const executeSwap = async (
  inputMint: string,
  outputMint: string,
  amount: number,
  inputDecimals: number,
  outputDecimals: number,
  slippageBps: number = 100,
): Promise<SwapResult> => {
  const lamports = Math.round(amount * Math.pow(10, inputDecimals));

  // 1. 견적 조회
  const { data: quote } = await axios.get(`${JUPITER_API}/quote`, {
    params: {
      inputMint,
      outputMint,
      amount: String(lamports),
      slippageBps,
    },
    timeout: 10_000,
  });

  out.info(LOG, "견적: %s → %s (impact: %s%%)",
    quote.inAmount, quote.outAmount, quote.priceImpactPct ?? "0");

  // 2. 스왑 트랜잭션 생성
  const { data: swapData } = await axios.post(`${JUPITER_API}/swap`, {
    quoteResponse: quote,
    userPublicKey: getWallet().publicKey.toBase58(),
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: "auto",
  }, { timeout: 10_000 });

  // 3. 트랜잭션 서명 및 전송
  const txBuf = Buffer.from(swapData.swapTransaction, "base64");
  const tx = VersionedTransaction.deserialize(txBuf);
  tx.sign([getWallet()]);

  const conn = getConnection();
  const txId = await conn.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 2,
  });

  // 4. 확인 대기
  const confirmation = await conn.confirmTransaction(txId, "confirmed");
  if (confirmation.value.err) {
    throw new Error(`트랜잭션 실패: ${JSON.stringify(confirmation.value.err)}`);
  }

  const outputAmount = parseInt(quote.outAmount) / Math.pow(10, outputDecimals);

  trade.fill(LOG, "스왑 완료 tx=%s in=%s out=%s", txId, quote.inAmount, quote.outAmount);

  return {
    txId,
    inputAmount: amount,
    outputAmount,
  };
};

export const verifySolanaConnection = async (): Promise<boolean> => {
  try {
    const w = getWallet();
    const conn = getConnection();
    const balance = await conn.getBalance(w.publicKey);
    const solBalance = balance / 1e9;
    trade.system(LOG, "Solana 연결 성공 | 지갑: %s | SOL: %s",
      w.publicKey.toBase58().slice(0, 8) + "...", solBalance.toFixed(4));
    return true;
  } catch (e) {
    trade.system(LOG, "Solana 연결 실패: %s", (e as Error).message);
    return false;
  }
};
