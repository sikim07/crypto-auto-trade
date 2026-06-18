/**
 * Upbit API 인증 모듈 (JWT 토큰 생성)
 *
 * Upbit Open API는 JWT(JSON Web Token) 기반 인증을 사용한다.
 * - 인증 불필요 API: 캔들, 호가, 티커 등 공개 데이터
 * - 인증 필요 API: 잔고 조회, 주문 배치/취소 등
 *
 * JWT 구조: Header.Payload.Signature (HS512 알고리즘)
 * - query_hash: 쿼리 파라미터의 SHA512 해시 (파라미터 변조 방지)
 *
 * 참고: https://docs.upbit.com/docs/create-authorization-token
 */
import * as crypto from "crypto";

const JWT_HEADER = Buffer.from(
  JSON.stringify({ alg: "HS512", typ: "JWT" }),
).toString("base64url");

const QUERY_HASH_ALG = "SHA512";

/** Buffer를 URL-safe Base64로 인코딩 */
const base64url = (buf: Buffer): string =>
  buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** HMAC-SHA512 서명 생성 */
const sign = (payload: string, secret: string): string => {
  const hmac = crypto.createHmac("sha512", secret);
  hmac.update(payload);
  return base64url(hmac.digest());
};

/**
 * GET/DELETE 요청용 JWT 토큰 생성
 * 쿼리 파라미터가 있으면 해시를 포함하여 서명한다.
 */
export const generateToken = (
  accessKey: string,
  secretKey: string,
  queryParams?: Record<string, string | string[]>,
): string => {
  const nonce = crypto.randomUUID();
  const payload: Record<string, string | number> = {
    access_key: accessKey,
    nonce,
  };

  if (queryParams && Object.keys(queryParams).length > 0) {
    // 쿼리 파라미터를 정렬된 문자열로 변환 후 SHA512 해시
    const parts: string[] = [];
    Object.entries(queryParams).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        // Upbit API 특이사항: states[] → state= (복수형→단수형)
        const singularKey = key === "states" ? "state" : key;
        const bracket = key === "states" ? "" : "[]";
        value.forEach((v) => {
          parts.push(`${singularKey}${bracket}=${encodeURIComponent(v)}`);
        });
      } else {
        parts.push(`${key}=${encodeURIComponent(value)}`);
      }
    });
    parts.sort();
    const query = parts.join("&");
    const queryHash = crypto
      .createHash(QUERY_HASH_ALG)
      .update(query, "utf8")
      .digest("hex");
    payload.query_hash = queryHash;
    payload.query_hash_alg = QUERY_HASH_ALG;
  }

  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const signature = sign(`${JWT_HEADER}.${payloadB64}`, secretKey);
  return `${JWT_HEADER}.${payloadB64}.${signature}`;
};

/**
 * POST 요청용 JWT 토큰 생성
 * Body 파라미터를 해시에 포함한다 (주문 배치 등).
 */
export const generateTokenWithBody = (
  accessKey: string,
  secretKey: string,
  bodyParams: Record<string, string>,
): string => {
  const nonce = crypto.randomUUID();
  const payload: Record<string, string | number> = {
    access_key: accessKey,
    nonce,
  };

  if (bodyParams && Object.keys(bodyParams).length > 0) {
    const query = Object.entries(bodyParams)
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    const queryHash = crypto
      .createHash(QUERY_HASH_ALG)
      .update(query, "utf8")
      .digest("hex");
    payload.query_hash = queryHash;
    payload.query_hash_alg = QUERY_HASH_ALG;
  }

  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const signature = sign(`${JWT_HEADER}.${payloadB64}`, secretKey);
  return `${JWT_HEADER}.${payloadB64}.${signature}`;
};
