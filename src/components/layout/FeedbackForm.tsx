"use client";

import { useState } from "react";
import { Bug, CheckCircle2, Lightbulb, Loader2, MessageCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { REPORT_CONTACT_MAX, REPORT_MESSAGE_MAX, recentClientErrors, sendReport } from "@/lib/report";
import { FEEDBACK_MODES, type FeedbackCategory, type FeedbackMode } from "@/lib/moderation";
import { cn } from "@/lib/utils";

const FIELD =
  "w-full rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground/70 focus-visible:border-screen/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const CATEGORIES: { id: FeedbackCategory; label: string; icon: typeof Bug; prompt: string }[] = [
  { id: "idea", label: "Idea", icon: Lightbulb, prompt: "What would make PokéIQ better?" },
  { id: "bug", label: "Bug", icon: Bug, prompt: "What you did, what you expected, and what happened instead." },
  { id: "other", label: "Other", icon: MessageCircle, prompt: "Tell us anything." },
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
  return rules.find(([re]) => re.test(page))?.[1] ?? "general";
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
  const current = CATEGORIES.find((c) => c.id === category)!;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return setError("Write a message first.");
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
        <p className="text-base font-medium">Thanks! We read every message.</p>
        <Button type="button" className="w-full" onClick={onClose ?? (() => setState("idle"))}>
          {onClose ? "Close" : "Send another"}
        </Button>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={submit} data-testid="feedback-form">
      <fieldset className="space-y-1.5">
        <legend className="hud-label mb-1.5">It&apos;s about</legend>
        <div className="grid grid-cols-3 gap-2">
          {CATEGORIES.map(({ id, label, icon: Icon }) => (
            <Button key={id} type="button" variant={category === id ? "default" : "outline"} size="sm" onClick={() => setCategory(id)} aria-pressed={category === id}>
              <Icon className="h-4 w-4" aria-hidden /> {label}
            </Button>
          ))}
        </div>
      </fieldset>
      <label className="block space-y-1.5">
        <span className="hud-label block">Which part</span>
        <select value={mode} onChange={(e) => setMode(e.target.value as FeedbackMode)} className={cn(FIELD, "h-10")} aria-label="Which part of PokéIQ">
          {Object.entries(FEEDBACK_MODES).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1.5">
        <span className="hud-label block">Message</span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          maxLength={REPORT_MESSAGE_MAX}
          required
          placeholder={current.prompt}
          aria-label="Message"
          className={cn(FIELD, "min-h-[7.5rem] resize-y py-2 leading-relaxed")}
        />
        <span className="block text-right font-pixel text-[10px] tabular-nums text-muted-foreground">
          {message.length}/{REPORT_MESSAGE_MAX}
        </span>
      </label>
      <label className="block space-y-1.5">
        <span className="hud-label block">Contact (optional)</span>
        <input
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          maxLength={REPORT_CONTACT_MAX}
          placeholder="Only if you'd like a reply. Ask a grown-up first!"
          aria-label="Contact"
          autoComplete="off"
          className={cn(FIELD, "h-10")}
        />
      </label>
      <p className="rounded-md border bg-shade/20 px-3 py-2 text-xs text-muted-foreground">
        Sent with the page you&apos;re on (<span className="break-all font-mono text-foreground/80">{page || "/"}</span>)
        {category === "bug" ? ", your browser version and any errors the page hit recently." : " and your browser version."}
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={state === "sending"}>
        {state === "sending" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
        Send
      </Button>
    </form>
  );
}
