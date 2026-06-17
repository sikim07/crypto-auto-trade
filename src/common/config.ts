import * as dotenv from "dotenv";
dotenv.config();

// Upbit API
export const UPBIT_ACCESS_KEY = process.env.UPBIT_ACCESS_KEY ?? process.env.ACCESS_KEY ?? "";
export const UPBIT_SECRET_KEY = process.env.UPBIT_SECRET_KEY ?? process.env.SECRET_KEY ?? "";
export const UPBIT_BASE_URL = "https://api.upbit.com/v1";
export const UPBIT_WS_URL = "wss://api.upbit.com/websocket/v1";
export const REST_TIMEOUT_MS = 10_000;
export const WS_WATCHDOG_MS = 60_000;
