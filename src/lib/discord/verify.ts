import { createPublicKey, verify } from "node:crypto";

/** DER prefix of an Ed25519 SubjectPublicKeyInfo; the 32 raw key bytes follow. */
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** Verifies Discord's Ed25519 request signature over `timestamp + rawBody`. Never throws. */
export function verifyDiscordSignature(rawBody: string, signature: string | null, timestamp: string | null, publicKeyHex: string | undefined): boolean {
  if (!signature || !timestamp || !publicKeyHex) return false;
  if (!/^[0-9a-fA-F]{128}$/.test(signature) || !/^[0-9a-fA-F]{64}$/.test(publicKeyHex)) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKeyHex, "hex")]), format: "der", type: "spki" });
    return verify(null, Buffer.from(timestamp + rawBody), key, Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}
