import * as dotenv from "dotenv";
dotenv.config();

// Upbit API
// Upbit
export const UPBIT_ACCESS_KEY = process.env.UPBIT_ACCESS_KEY ?? process.env.ACCESS_KEY ?? "";
export const UPBIT_SECRET_KEY = process.env.UPBIT_SECRET_KEY ?? process.env.SECRET_KEY ?? "";
export const UPBIT_BASE_URL = "https://api.upbit.com/v1";
export const UPBIT_WS_URL = "wss://api.upbit.com/websocket/v1";
export const REST_TIMEOUT_MS = 10_000;
export const WS_WATCHDOG_MS = 60_000;

// Binance
export const BINANCE_API_KEY = process.env.BINANCE_API_KEY ?? "";
export const BINANCE_SECRET_KEY = process.env.BINANCE_SECRET_KEY ?? "";
export const BINANCE_BASE_URL = "https://api.binance.com";
export const BINANCE_WS_URL = "wss://stream.binance.com:9443/ws";

// Solana (DEX-CEX 차익용)
export const SOLANA_PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY ?? "";
export const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
