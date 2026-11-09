import "server-only";
import { z } from "zod";
import { emailEnabled, emailSiteUrl, postalAddress } from "./config";
import { sendEmail, type SendResult } from "./send";
import { emailStore, type EmailStore, type EmailSub } from "./store";
import { confirmEmail, type Message } from "./templates";
import { confirmToken, verifyConfirmToken, verifyUnsubscribeToken } from "./tokens";
import type { EmailSettingsView } from "@/lib/email-types";

/**
 * Saving an address, the double opt-in and unsubscribing. Saving a new
 * address (or asking again) sends "Confirm your email"; nothing daily goes
 * out until its link is opened.
 */

export const EMAIL_MAX = 254;
const emailSchema = z.string().trim().toLowerCase().max(EMAIL_MAX).email();

/** A clean lower-case address, or null if it isn't one. */
export function normalizeEmail(raw: unknown): string | null {
  const parsed = emailSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** A confirmation email waits this long before another can be sent to the same trainer. */
export const CONFIRM_RESEND_MS = 60_000;

export interface ServiceDeps {
  store: EmailStore;
  send(m: Message): Promise<SendResult>;
  now(): number;
}

export const defaultServiceDeps = (): ServiceDeps => ({ store: emailStore(), send: (m) => sendEmail(m), now: () => Date.now() });

export function viewOf(sub: EmailSub | null, suggestion: string | null): EmailSettingsView {
  return {
    email: sub?.email ?? null,
    verified: !!sub?.verifiedAt,
    dailyEmail: !!sub?.dailyEmail,
    streakNudge: !!sub?.streakNudge,
    suggestion: sub ? null : suggestion,
  };
}

export function confirmMessage(to: string, profileId: string, username: string, now = Date.now()): Message {
  const url = `${emailSiteUrl()}/email/confirm?token=${encodeURIComponent(confirmToken(profileId, to, now))}`;
  return confirmEmail({ to, username, confirmUrl: url, postalAddress: postalAddress() });
}

export interface SaveInput {
  email?: string | null;
  dailyEmail?: boolean;
  streakNudge?: boolean;
  /** Send the confirmation again. */
  resend?: boolean;
}

export type SaveOutcome =
  | { ok: true; sub: EmailSub; confirm: "sent" | "throttled" | "failed" | null }
  | { ok: false; error: string; status: number };

export async function saveSettings(user: { id: string; username: string }, input: SaveInput, deps: ServiceDeps = defaultServiceDeps()): Promise<SaveOutcome> {
  const now = deps.now();
  const iso = new Date(now).toISOString();
  const existing = await deps.store.get(user.id);
  let email: string | null = existing?.email ?? null;
  if (input.email !== undefined && input.email !== null && input.email !== "") {
    email = normalizeEmail(input.email);
    if (!email) return { ok: false, error: "That doesn't look like an email address.", status: 400 };
  }
  if (!email) return { ok: false, error: "Add your email address first.", status: 400 };

  const changed = !existing || existing.email !== email;
  const sub: EmailSub = {
    profileId: user.id,
    email,
    verifiedAt: existing && !changed ? existing.verifiedAt : null,
    dailyEmail: input.dailyEmail ?? existing?.dailyEmail ?? false,
    streakNudge: input.streakNudge ?? existing?.streakNudge ?? false,
    lastSentOn: existing?.lastSentOn ?? null,
    confirmSentAt: existing && !changed ? existing.confirmSentAt : null,
    createdAt: existing?.createdAt ?? iso,
    updatedAt: iso,
  };

  let confirm: "sent" | "throttled" | "failed" | null = null;
  if (!sub.verifiedAt && (changed || input.resend)) {
    if (sub.confirmSentAt && now - Date.parse(sub.confirmSentAt) < CONFIRM_RESEND_MS) confirm = "throttled";
    else {
      const sent = await deps.send(confirmMessage(email, user.id, user.username, now));
      confirm = sent.ok ? "sent" : "failed";
      if (sent.ok) sub.confirmSentAt = iso;
      else console.error("[email] confirmation failed:", sent.status, sent.error);
    }
  }
  await deps.store.save(sub);
  return { ok: true, sub, confirm };
}

export type ConfirmOutcome = "confirmed" | "invalid" | "stale";

/** Opens a confirm link: "stale" when the trainer has since changed address (or removed it). */
export async function confirmByToken(token: unknown, deps: Pick<ServiceDeps, "store" | "now"> = defaultServiceDeps()): Promise<ConfirmOutcome> {
  const claim = verifyConfirmToken(token, deps.now());
  if (!claim) return "invalid";
  const sub = await deps.store.get(claim.profileId);
  if (!sub || sub.email !== claim.email) return "stale";
  if (!sub.verifiedAt) await deps.store.save({ ...sub, verifiedAt: new Date(deps.now()).toISOString(), updatedAt: new Date(deps.now()).toISOString() });
  return "confirmed";
}

/** One-click unsubscribe: turns the daily email off (fine to repeat). */
export async function unsubscribeByToken(token: unknown, deps: Pick<ServiceDeps, "store" | "now"> = defaultServiceDeps()): Promise<boolean> {
  const id = verifyUnsubscribeToken(token);
  if (!id) return false;
  const sub = await deps.store.get(id);
  if (sub?.dailyEmail) await deps.store.save({ ...sub, dailyEmail: false, updatedAt: new Date(deps.now()).toISOString() });
  return true;
}

/**
 * The sign-up forms' optional address and "Email me when new dailies drop"
 * box. Never fails the sign-up: a bad address or a send error is logged and
 * the trainer can fix it in Settings. Ignored while email is switched off.
 */
export async function optInAtSignup(
  user: { id: string; username: string },
  input: { email?: unknown; dailyEmail?: unknown },
  deps?: ServiceDeps
): Promise<"saved" | "skipped" | "failed"> {
  if (!emailEnabled() || typeof input.email !== "string" || !input.email.trim()) return "skipped";
  if (!normalizeEmail(input.email)) return "failed";
  try {
    const out = await saveSettings(user, { email: input.email, dailyEmail: input.dailyEmail === true }, deps);
    return out.ok ? "saved" : "failed";
  } catch (err) {
    console.error("[email] sign-up opt-in failed:", err);
    return "failed";
  }
}
