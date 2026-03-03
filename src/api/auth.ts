import * as crypto from "crypto";

/** 업비트: HS512(HMAC with SHA-512) 사용 권장 */
const JWT_HEADER = Buffer.from(
  JSON.stringify({ alg: "HS512", typ: "JWT" }),
).toString("base64url");
const QUERY_HASH_ALG = "SHA512";

const base64url = (buf: Buffer): string =>
  buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const sign = (payload: string, secret: string): string => {
  const hmac = crypto.createHmac("sha512", secret);
  hmac.update(payload);
  return base64url(hmac.digest());
};

/**
 * GET 등 쿼리 파라미터용 JWT (query_hash = SHA512(쿼리스트링))
 * 쿼리스트링은 알파벳순 정렬, encodeURIComponent 적용.
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
    const parts: string[] = [];
    Object.entries(queryParams).forEach(([key, value]) => {
      if (Array.isArray(value)) {
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
 * POST body용 JWT (query_hash = SHA512(쿼리문자열))
 * 업비트: 실제 요청과 토큰의 문자열 구성 순서가 같아야 함. URL 인코딩 없이 Hash.
 * bodyParams의 키 순서(삽입 순서)를 유지하여 쿼리 문자열 생성.
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
