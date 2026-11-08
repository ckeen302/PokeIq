"use client";

import { useEffect, useState } from "react";
import { CalendarDays, Flame, Loader2, Mail, MailX } from "lucide-react";
import { setAccountDailyEmail, useAccount } from "@/lib/account";
import { getEmailSettings, looksLikeEmail, saveEmailSettings, type SaveResult } from "@/lib/email-client";
import type { EmailSettingsView } from "@/lib/email-types";
import { Button } from "@/components/ui/button";
import { Row, Segmented } from "@/components/settings/SiteSettings";
import { EMAIL_FIELD } from "./DailyEmailOptIn";

/**
 * Settings: "Daily reminder emails" on / off, the address (with a field when
 * none is on file, prefilled from Discord / Google), the confirm-your-email
 * state and "only when a streak is at risk". Signed-in trainers only, and
 * only while daily emails are switched on.
 */
export function EmailSettings() {
  const account = useAccount();
  const signedIn = account.status === "ready" && !!account.user && account.emailEnabled;
  if (!signedIn) return null;
  return <EmailSettingsPanel />;
}

function confirmNote(r: SaveResult): string | null {
  if (r.verified) return null;
  if (r.confirm === "sent") return `We sent a confirmation link to ${r.email}.`;
  if (r.confirm === "throttled") return "A confirmation link went out a moment ago: check your inbox.";
  if (r.confirm === "failed") return "We couldn't send the confirmation email. Try Resend in a minute.";
  return null;
}

function EmailSettingsPanel() {
  const [view, setView] = useState<EmailSettingsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getEmailSettings()
      .then((v) => {
        if (!live) return;
        setView(v);
        setDraft(v.email ?? v.suggestion ?? "");
      })
      .catch((err) => live && setLoadError(err instanceof Error ? err.message : "Couldn't load your email settings."));
    return () => {
      live = false;
    };
  }, []);

  async function save(body: Parameters<typeof saveEmailSettings>[0]) {
    setBusy(true);
    setError(null);
    try {
      const r = await saveEmailSettings(body);
      setView(r);
      setDraft(r.email ?? "");
      setEditing(false);
      setNote(confirmNote(r));
      setAccountDailyEmail(r.dailyEmail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that.");
    } finally {
      setBusy(false);
    }
  }

  const needsAddress = !view?.email || editing;
  function toggle(on: boolean) {
    if (!view || on === view.dailyEmail) return;
    if (on && needsAddress) {
      if (!looksLikeEmail(draft)) return setError("Add your email address first.");
      return void save({ email: draft.trim(), dailyEmail: true });
    }
    void save({ dailyEmail: on });
  }

  function submitAddress(e: React.FormEvent) {
    e.preventDefault();
    if (!looksLikeEmail(draft)) return setError("That doesn't look like an email address.");
    void save({ email: draft.trim(), ...(view && !view.email && { dailyEmail: true }) });
  }

  return (
    <div id="email" className="mt-4 scroll-mt-20 space-y-4 border-t pt-4" data-testid="email-settings">
      <Row title="Daily reminder emails" hint="An email when new dailies drop." size="md">
        <Segmented<"on" | "off">
          label="Daily reminder emails"
          value={view?.dailyEmail ? "on" : "off"}
          onChange={(v) => toggle(v === "on")}
          testId="email-daily-toggle"
          size="md"
          options={[
            { value: "on", label: "On", icon: Mail },
            { value: "off", label: "Off", icon: MailX },
          ]}
        />
      </Row>

      {!view && !loadError && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading" />}
      {loadError && <p className="text-sm text-destructive">{loadError}</p>}

      {view && needsAddress && (
        <form className="flex flex-wrap gap-2" onSubmit={submitAddress} data-testid="email-address-form">
          <label className="sr-only" htmlFor="email-settings-address">
            Email address
          </label>
          <input
            id="email-settings-address"
            className={`${EMAIL_FIELD} min-w-0 flex-1 basis-56`}
            type="email"
            inputMode="email"
            placeholder="you@example.com"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={254}
            required
            data-testid="email-settings-input"
          />
          <Button type="submit" variant="outline" className="h-11" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {view.email ? "Save" : "Turn on"}
          </Button>
          {editing && (
            <Button type="button" variant="ghost" className="h-11" onClick={() => (setEditing(false), setDraft(view.email ?? ""), setError(null))}>
              Cancel
            </Button>
          )}
        </form>
      )}

      {view?.email && !editing && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-shade/10 px-3 py-2 text-sm" data-testid="email-address">
          <span className="min-w-0 break-all">
            {view.verified ? (
              <>
                <span className="text-muted-foreground">Sending to </span>
                <span className="font-semibold">{view.email}</span>
              </>
            ) : (
              <>
                <span className="text-muted-foreground">Confirm </span>
                <span className="font-semibold">{view.email}</span>
                <span className="text-muted-foreground"> from the link in your inbox.</span>
              </>
            )}
          </span>
          <span className="flex gap-1">
            {!view.verified && (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void save({ resend: true })} data-testid="email-resend">
                Resend
              </Button>
            )}
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => (setEditing(true), setError(null))}>
              Change
            </Button>
          </span>
        </div>
      )}

      {view?.dailyEmail && (
        <Row title="When to send" hint="Every day, or only when a streak would end at midnight." size="md">
          <Segmented<"daily" | "streak">
            label="When to send"
            value={view.streakNudge ? "streak" : "daily"}
            onChange={(v) => void save({ streakNudge: v === "streak" })}
            testId="email-streak-toggle"
            size="md"
            options={[
              { value: "daily", label: "Every day", icon: CalendarDays },
              { value: "streak", label: "Streak at risk", icon: Flame },
            ]}
          />
        </Row>
      )}

      {note && (
        <p className="text-sm text-muted-foreground" role="status" data-testid="email-note">
          {note}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
