/**
 * Sealed answer tokens. The correct answer + explanation are AES-256-GCM
 * encrypted server-side and shipped to the client as an opaque token; the
 * client posts the token back with its chosen option to learn the verdict.
 * Correct answers therefore never appear in any client-readable payload.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const TOKEN_TTL_MS = 30 * 60 * 1000; // generous: a full quiz + reading time

export interface AnswerPayload {
  /** correct answer (must be one of the shipped options) */
  a: string;
  /** explanation shown after answering */
  e: string;
  /** expiry, ms epoch */
  x: number;
}

// A stable secret keeps tokens valid across serverless instances; the random
// fallback still works for single-process dev, where tokens stay in-process.
const secret =
  process.env.QUIZ_TOKEN_SECRET ?? randomBytes(32).toString("hex");
const key = createHash("sha256").update(secret).digest();

export function sealAnswer(answer: string, explanation: string): string {
  const payload: AnswerPayload = {
    a: answer,
    e: explanation,
    x: Date.now() + TOKEN_TTL_MS,
  };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

export function openAnswer(token: string): AnswerPayload | null {
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 12 + 16 + 2) return null;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
    const payload = JSON.parse(plaintext) as AnswerPayload;
    if (
      typeof payload.a !== "string" ||
      typeof payload.e !== "string" ||
      typeof payload.x !== "number"
    ) {
      return null;
    }
    if (payload.x < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
