import "server-only";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { captureFile, emailFrom } from "./config";
import type { Message } from "./templates";

/**
 * Sending, with Resend's REST API (no SDK): one message, or a batch of up to
 * RESEND_BATCH_MAX. In test mode (EMAIL_TEST_CAPTURE) messages go to a file
 * instead.
 */

const RESEND_API = "https://api.resend.com";
/** Resend's batch endpoint takes at most 100 emails per call. */
export const RESEND_BATCH_MAX = 100;

export type SendResult = { ok: true } | { ok: false; status: number; error: string };

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const payload = (m: Message) => ({
  from: emailFrom(),
  to: [m.to],
  subject: m.subject,
  html: m.html,
  text: m.text,
  ...(m.headers && { headers: m.headers }),
});

function capture(messages: Message[], file: string): SendResult {
  mkdirSync(path.dirname(file), { recursive: true });
  const at = new Date().toISOString();
  appendFileSync(file, messages.map((m) => JSON.stringify({ at, ...payload(m) })).join("\n") + "\n");
  return { ok: true };
}

async function post(url: string, body: unknown, idempotencyKey: string | undefined, fetchImpl: FetchLike): Promise<SendResult> {
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY?.trim() ?? ""}`,
        "Content-Type": "application/json",
        ...(idempotencyKey && { "Idempotency-Key": idempotencyKey.slice(0, 256) }),
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return { ok: true };
    const detail = (await res.json().catch(() => null)) as { message?: unknown; name?: unknown } | null;
    return { ok: false, status: res.status, error: typeof detail?.message === "string" ? detail.message.slice(0, 300) : `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : "network error" };
  }
}

export async function sendEmail(m: Message, opts: { idempotencyKey?: string; fetchImpl?: FetchLike } = {}): Promise<SendResult> {
  const file = captureFile();
  if (file) return capture([m], file);
  return post(`${RESEND_API}/emails`, payload(m), opts.idempotencyKey, opts.fetchImpl ?? fetch);
}

export async function sendBatch(messages: Message[], opts: { idempotencyKey?: string; fetchImpl?: FetchLike } = {}): Promise<SendResult> {
  if (!messages.length) return { ok: true };
  if (messages.length > RESEND_BATCH_MAX) throw new Error(`a batch holds at most ${RESEND_BATCH_MAX} emails`);
  const file = captureFile();
  if (file) return capture(messages, file);
  return post(`${RESEND_API}/emails/batch`, messages.map(payload), opts.idempotencyKey, opts.fetchImpl ?? fetch);
}
