/**
 * AWS Signature Version 4 for S3-compatible stores (Cloudflare R2 among them),
 * small enough not to need the AWS SDK. Header-based signing only:
 * https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
 */
import { createHash, createHmac } from "node:crypto";

export interface SigV4Request {
  method: string;
  url: string;
  /** Headers to send and sign (Host is added from the URL). */
  headers?: Record<string, string>;
  /** Hex SHA-256 of the body (sha256Hex), or "UNSIGNED-PAYLOAD". */
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** R2 takes "auto". */
  region: string;
  service?: string;
  date?: Date;
}

export const sha256Hex = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

/** RFC 3986 encoding, as SigV4 wants it ("-_.~" stay, everything else is %XX). */
export const uriEncode = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** 20130524T000000Z */
export const amzDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** S3 signs the path as sent, each segment encoded once. */
const canonicalUri = (pathname: string) =>
  pathname
    .split("/")
    .map((seg) => uriEncode(decodeURIComponent(seg)))
    .join("/") || "/";

const canonicalQuery = (params: URLSearchParams) =>
  [...params.entries()]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

export interface SigV4Parts {
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
  /** Every header to send, Authorization included. */
  headers: Record<string, string>;
}

export function signV4(req: SigV4Request): SigV4Parts {
  const url = new URL(req.url);
  const service = req.service ?? "s3";
  const stamp = amzDate(req.date ?? new Date());
  const day = stamp.slice(0, 8);

  const send: Record<string, string> = {
    host: url.host,
    "x-amz-date": stamp,
    "x-amz-content-sha256": req.payloadHash,
  };
  for (const [k, v] of Object.entries(req.headers ?? {})) send[k.toLowerCase()] = v;

  const names = Object.keys(send).sort();
  const canonicalHeaders = names.map((n) => `${n}:${send[n].trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [
    req.method.toUpperCase(),
    canonicalUri(url.pathname),
    canonicalQuery(url.searchParams),
    canonicalHeaders,
    signedHeaders,
    req.payloadHash,
  ].join("\n");

  const scope = `${day}/${req.region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256Hex(canonicalRequest)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${req.secretAccessKey}`, day), req.region), service), "aws4_request");
  const signature = createHmac("sha256", key).update(stringToSign).digest("hex");

  return {
    canonicalRequest,
    stringToSign,
    signature,
    headers: {
      ...send,
      authorization: `AWS4-HMAC-SHA256 Credential=${req.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}
