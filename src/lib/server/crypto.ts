import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Server secrets + token primitives.
 *
 * - Signed tokens (HMAC-SHA256) carry session state, results and challenge
 *   links statelessly: the client can read them but can't forge or alter
 *   them, so scores are server-authoritative without a database.
 * - Question RNG seeds are HMAC(secret, publicSeed): the generator is open
 *   source and the public seed is visible, but without the secret nobody can
 *   precompute a session's answers.
 * - Media tokens are AES-256-GCM encrypted so silhouette / cry URLs leak
 *   neither the Pokédex number nor the asset kind.
 */

const DEV_SECRET = "pokeiq-dev-secret-do-not-use-in-production";
let warned = false;

/** False when running on the public dev secret (POKEIQ_SECRET unset or < 16 chars). */
export function secretIsSecure(): boolean {
  const value = process.env.POKEIQ_SECRET;
  return Boolean(value && value.length >= 16);
}

function secret(): string {
  const value = process.env.POKEIQ_SECRET;
  if (value && secretIsSecure()) return value;
  if (!warned && process.env.NODE_ENV === "production") {
    console.warn("[pokeiq] POKEIQ_SECRET is unset or too short — using the public dev secret. Set it in production! Leaderboard submissions are disabled until you do.");
  }
  warned = true;
  return DEV_SECRET;
}

const b64url = (buf: Buffer) => buf.toString("base64url");

export function hmac(purpose: string, data: string): Buffer {
  return createHmac("sha256", secret()).update(`${purpose}\u0000${data}`).digest();
}

/** Opaque, per-purpose deterministic seed. */
export function deriveSeed(purpose: string, publicSeed: string): string {
  return b64url(hmac(`seed:${purpose}`, publicSeed));
}

export function randomId(bytes = 9): string {
  return b64url(randomBytes(bytes));
}

// ---------------------------------------------------------------------------
// Signed tokens: base64url(JSON) "." base64url(HMAC[0..16])
// ---------------------------------------------------------------------------

const SIG_BYTES = 16;

export function signToken(kind: string, payload: unknown): string {
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(hmac(`token:${kind}`, body).subarray(0, SIG_BYTES));
  return `${body}.${sig}`;
}

export function verifyToken<T>(kind: string, token: unknown): T | null {
  if (typeof token !== "string" || token.length > 16384) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1), "base64url");
  const expected = hmac(`token:${kind}`, body).subarray(0, SIG_BYTES);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Encrypted media tokens
// ---------------------------------------------------------------------------

function mediaKey(): Buffer {
  return createHash("sha256").update(`${secret()}:media`).digest();
}

export function encryptJson(payload: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", mediaKey(), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return b64url(Buffer.concat([iv, cipher.getAuthTag(), ct]));
}

export function decryptJson<T>(token: string): T | null {
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", mediaKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const pt = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
    return JSON.parse(pt.toString("utf8")) as T;
  } catch {
    return null;
  }
}
