import "server-only";
import path from "node:path";
import { secretIsSecure } from "../crypto";

/**
 * The email switch. Daily reminder emails are on only when the server has a
 * Resend key, a From address and a real POKEIQ_SECRET (confirm and
 * unsubscribe links are signed with it). Until then every email control is
 * hidden, the email API answers 404 and the cron job does nothing, so the
 * code is safe to deploy with no key. See docs/email.md.
 */
export function emailEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim() && secretIsSecure());
}

export function emailFrom(): string {
  const from = process.env.EMAIL_FROM?.trim() ?? "";
  // "daily@playpokeiq.com" alone shows as a bare address: give it the site's name.
  return from.includes("<") ? from : `PokéIQ <${from}>`;
}

/** The postal address CAN-SPAM wants in a US marketing email's footer, or null (left out). */
export function postalAddress(): string | null {
  return process.env.EMAIL_POSTAL_ADDRESS?.trim() || null;
}

/** The site the emails link to (buttons, the picture, confirm and unsubscribe links). */
export function emailSiteUrl(): string {
  return (process.env.EMAIL_SITE_URL?.trim() || "https://playpokeiq.com").replace(/\/+$/, "");
}

/**
 * Test mode: EMAIL_TEST_CAPTURE=1 (or a file path) writes every outgoing
 * message to a JSON-lines file instead of calling Resend. For e2e tests and
 * local previews only.
 */
export function captureFile(): string | null {
  const v = process.env.EMAIL_TEST_CAPTURE?.trim();
  if (!v || v === "0") return null;
  return v === "1" ? path.join(process.cwd(), ".data", "email-capture.jsonl") : path.resolve(v);
}
