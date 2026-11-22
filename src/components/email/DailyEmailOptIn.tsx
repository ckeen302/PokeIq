"use client";

import { useId } from "react";
import type { SignupEmail } from "@/lib/account";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import email from "@/messages/email";

export const EMAIL_FIELD =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:border-screen/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The sign-up forms' optional email and the unticked "Email me when new
 * dailies drop" box (prefilled with the Discord / Google address when there
 * is one). Renders nothing while daily emails are switched off.
 */
export function DailyEmailOptIn({
  enabled,
  value,
  onChange,
  className,
}: {
  enabled: boolean;
  value: SignupEmail;
  onChange: (next: SignupEmail) => void;
  className?: string;
}) {
  const id = useId();
  const t = useT(email);
  if (!enabled) return null;
  return (
    <div className={cn("space-y-2", className)} data-testid="signup-email">
      <label className="block space-y-1" htmlFor={`${id}-email`}>
        <span className="hud-label">
          {t("optIn.email")} <span className="normal-case tracking-normal text-muted-foreground">{t("optIn.optional")}</span>
        </span>
        <input
          id={`${id}-email`}
          className={EMAIL_FIELD}
          type="email"
          inputMode="email"
          value={value.email}
          onChange={(e) => onChange({ ...value, email: e.target.value })}
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={254}
          data-testid="signup-email-input"
        />
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0"
          checked={value.dailyEmail}
          onChange={(e) => onChange({ ...value, dailyEmail: e.target.checked })}
          data-testid="signup-daily-email"
        />
        <span>
          {t("optIn.box")}
          <span className="block text-xs text-muted-foreground">{t("optIn.confirmFirst")}</span>
        </span>
      </label>
    </div>
  );
}

/**
 * The sign-up check: a ticked box needs an address. Returns what's wrong (the form says it: "needEmail", "Add your
 * email to get the daily emails."; "badEmail", "That doesn't look like an email address."), or null.
 */
export function optInError(value: SignupEmail): "needEmail" | "badEmail" | null {
  if (value.dailyEmail && !value.email.trim()) return "needEmail";
  if (value.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email.trim())) return "badEmail";
  return null;
}
