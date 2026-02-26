import * as crypto from "crypto";

const JWT_HEADER = Buffer.from(
  JSON.stringify({ alg: "HS256", typ: "JWT" }),
).toString("base64url");
const QUERY_HASH_ALG = "SHA512";

const base64url = (buf: Buffer): string =>
  buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const sign = (payload: string, secret: string): string => {
  const hmac = crypto.createHmac("sha256", secret);
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
 * POST body용 JWT (query_hash = SHA512(키=값&... 알파벳순))
 * Body는 JSON으로 전송하지만, 해시는 query string 형식으로 계산.
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
    const parts = Object.entries(bodyParams)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
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
