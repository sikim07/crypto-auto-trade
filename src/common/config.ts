/**
 * 환경변수 로딩 및 전역 설정
 *
 * .env 파일에서 API 키를 로드하고, Upbit API 연결에 필요한 상수를 정의한다.
 * ACCESS_KEY / SECRET_KEY: Upbit Open API에서 발급받은 인증 키
 */
import * as dotenv from "dotenv";
dotenv.config();

// Upbit API 인증 키 (UPBIT_ 접두사 우선, 하위호환으로 ACCESS_KEY도 지원)
export const UPBIT_ACCESS_KEY = process.env.UPBIT_ACCESS_KEY ?? process.env.ACCESS_KEY ?? "";
export const UPBIT_SECRET_KEY = process.env.UPBIT_SECRET_KEY ?? process.env.SECRET_KEY ?? "";

// Upbit API 엔드포인트
export const UPBIT_BASE_URL = "https://api.upbit.com/v1";
export const UPBIT_WS_URL = "wss://api.upbit.com/websocket/v1";

// 네트워크 설정
export const REST_TIMEOUT_MS = 10_000;   // REST API 타임아웃 (10초)
export const WS_WATCHDOG_MS = 60_000;    // WebSocket 무응답 감지 (60초 → 자동 재연결)
