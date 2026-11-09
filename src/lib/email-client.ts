"use client";

import type { EmailSettingsView } from "./email-types";

/** Client side of daily reminder emails (only called while they're switched on). */

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export const getEmailSettings = () => api<EmailSettingsView>("/api/email/settings");

export type SaveResult = EmailSettingsView & { confirm: "sent" | "throttled" | "failed" | null };

export const saveEmailSettings = (body: { email?: string; dailyEmail?: boolean; streakNudge?: boolean; resend?: boolean }) =>
  api<SaveResult>("/api/email/settings", { method: "PUT", body: JSON.stringify(body) });

/** A loose shape check before sending: the server has the final say. */
export const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
