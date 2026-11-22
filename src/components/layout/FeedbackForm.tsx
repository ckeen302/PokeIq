"use client";

import { useState } from "react";
import { Bug, CheckCircle2, Lightbulb, Loader2, MessageCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { REPORT_CONTACT_MAX, REPORT_MESSAGE_MAX, recentClientErrors, sendReport } from "@/lib/report";
import { FEEDBACK_MODES, type FeedbackCategory, type FeedbackMode } from "@/lib/moderation";
import { cn } from "@/lib/utils";
import { stripLocale } from "@/i18n/paths";
import { useT } from "@/i18n/client";
import feedback from "@/messages/feedback";

const FIELD =
  "w-full rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground/70 focus-visible:border-screen/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const CATEGORIES: { id: FeedbackCategory; icon: typeof Bug }[] = [
  { id: "idea", icon: Lightbulb },
  { id: "bug", icon: Bug },
  { id: "other", icon: MessageCircle },
];

/** Which part of the site a page belongs to. */
export function modeFromPage(page: string): FeedbackMode {
  const rules: [RegExp, FeedbackMode][] = [
    [/^\/battle\/tournaments/, "tournaments"],
    [/^\/battle/, "battle"],
    [/^\/rooms/, "rooms"],
    [/^\/pokedle/, "pokedle"],
    [/^\/(guessr|atlas)/, "guessr"],
    [/^\/(quiz|play)/, "quiz"],
    [/^\/daily/, "daily"],
    [/^\/iq-test/, "iqtest"],
    [/^\/(pokedex|pokemon)/, "pokedex"],
    [/^\/(users|u)\//, "friends"],
    [/^\/(login|trainer)/, "accounts"],
  ];
  const path = process.env.LIVE_LOCALES ? stripLocale(page) : page;
  return rules.find(([re]) => re.test(path))?.[1] ?? "general";
}

/**
 * Feedback: an idea, a bug or anything else, which part of the site it's
 * about, the message and an optional contact. A bug report carries the page,
 * the browser and the errors the page hit recently. Used by /feedback and the
 * footer's "Report a problem".
 */
export function FeedbackForm({ page, onClose }: { page: string; onClose?: () => void }) {
  const [category, setCategory] = useState<FeedbackCategory>("bug");
  const [mode, setMode] = useState<FeedbackMode>(() => modeFromPage(page));
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const t = useT(feedback);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return setError(t("empty"));
    setState("sending");
    setError(null);
    const extra =
      category === "bug"
        ? { viewport: `${window.innerWidth}x${window.innerHeight}`, language: navigator.language, recentErrors: recentClientErrors() }
        : undefined;
    const out = await sendReport({ kind: "feedback", category, mode, message, contact: contact.trim() || undefined, page, extra });
    if (out.ok) {
      setState("sent");
      setMessage("");
    } else {
      setState("idle");
      setError(out.error);
    }
  }

  if (state === "sent") {
    return (
      <div className="space-y-5 py-2 text-center" role="status" data-testid="feedback-sent">
        <CheckCircle2 className="mx-auto h-10 w-10 text-success" aria-hidden />
        <p className="text-base font-medium">{t("thanks")}</p>
        <Button type="button" className="w-full" onClick={onClose ?? (() => setState("idle"))}>
          {onClose ? t("close") : t("another")}
        </Button>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={submit} data-testid="feedback-form">
      <fieldset className="space-y-1.5">
        <legend className="hud-label mb-1.5">{t("about")}</legend>
        <div className="grid grid-cols-3 gap-2">
          {CATEGORIES.map(({ id, icon: Icon }) => (
            <Button key={id} type="button" variant={category === id ? "default" : "outline"} size="sm" onClick={() => setCategory(id)} aria-pressed={category === id}>
              <Icon className="h-4 w-4" aria-hidden /> {t(`categories.${id}`)}
            </Button>
          ))}
        </div>
      </fieldset>
      <label className="block space-y-1.5">
        <span className="hud-label block">{t("part")}</span>
        <select value={mode} onChange={(e) => setMode(e.target.value as FeedbackMode)} className={cn(FIELD, "h-10")} aria-label={t("partLabel")}>
          {(Object.keys(FEEDBACK_MODES) as FeedbackMode[]).map((id) => (
            <option key={id} value={id}>
              {t(`modes.${id}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1.5">
        <span className="hud-label block">{t("message")}</span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          maxLength={REPORT_MESSAGE_MAX}
          required
          placeholder={t(`prompts.${category}`)}
          aria-label={t("message")}
          className={cn(FIELD, "min-h-[7.5rem] resize-y py-2 leading-relaxed")}
        />
        <span className="block text-right font-pixel text-[10px] tabular-nums text-muted-foreground">
          {message.length}/{REPORT_MESSAGE_MAX}
        </span>
      </label>
      <label className="block space-y-1.5">
        <span className="hud-label block">{t("contact")}</span>
        <input
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          maxLength={REPORT_CONTACT_MAX}
          placeholder={t("contactHint")}
          aria-label={t("contactLabel")}
          autoComplete="off"
          className={cn(FIELD, "h-10")}
        />
      </label>
      <p className="rounded-md border bg-shade/20 px-3 py-2 text-xs text-muted-foreground">
        {t.rich("sentWith", { bug: category === "bug", page: () => <span className="break-all font-mono text-foreground/80">{page || "/"}</span> })}
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={state === "sending"}>
        {state === "sending" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
        {t("send")}
      </Button>
    </form>
  );
}
