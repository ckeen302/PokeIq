"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, Loader2, MessageSquareWarning, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { REPORT_CONTACT_MAX, REPORT_MESSAGE_MAX, currentPage, installErrorReporter, sendReport } from "@/lib/report";
import { cn } from "@/lib/utils";

const FIELD =
  "w-full rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground/70 focus-visible:border-screen/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Sends errors the page didn't catch to /api/report (see lib/report). */
export function ErrorReporter() {
  useEffect(() => installErrorReporter(), []);
  return null;
}

/** The footer's "Report a problem" link and its dialog: a message, an optional contact, and the page it's about. */
export function ReportProblem() {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const [page, setPage] = useState("");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  function open() {
    setPage(currentPage());
    setError(null);
    if (state === "sent") setState("idle");
    dialog.current?.showModal();
    field.current?.focus();
  }

  const close = () => dialog.current?.close();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return setError("Tell us what went wrong.");
    setState("sending");
    setError(null);
    const out = await sendReport({ kind: "feedback", message, contact: contact.trim() || undefined, page });
    if (out.ok) {
      setState("sent");
      setMessage("");
    } else {
      setState("idle");
      setError(out.error);
    }
  }

  return (
    <>
      <button type="button" onClick={open} className="font-pixel text-[10px] uppercase tracking-wider hover:text-foreground">
        Report a problem
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={`${id}-title`}
        // A click on the backdrop lands on the dialog itself.
        onClick={(e) => e.target === dialog.current && close()}
        // Inside the footer's nav: reset the type it would inherit.
        className="hud m-auto w-[min(28rem,calc(100vw-2rem))] max-w-none rounded-lg border bg-card p-0 text-left font-sans text-sm normal-case tracking-normal text-card-foreground shadow-[0_8px_30px_-12px_hsl(var(--shade)/0.6)] backdrop:bg-background/75 backdrop:backdrop-blur-sm"
      >
        <div className="space-y-4 p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <p className="hud-label flex items-center gap-1.5 text-screen">
                <MessageSquareWarning className="h-3.5 w-3.5" aria-hidden /> Report a problem
              </p>
              <h2 id={`${id}-title`} className="font-display text-2xl font-bold uppercase leading-tight">
                {state === "sent" ? "Report sent" : "What went wrong?"}
              </h2>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="-mr-2 -mt-1 rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>

          {state === "sent" ? (
            <div className="space-y-5 py-2 text-center" role="status">
              <CheckCircle2 className="mx-auto h-10 w-10 text-success" aria-hidden />
              <p className="text-base font-medium">Thanks — we read every report.</p>
              <Button type="button" className="w-full" onClick={close}>
                Close
              </Button>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={submit}>
              <label className="block space-y-1.5">
                <span className="hud-label block">What happened</span>
                <textarea
                  ref={field}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={5}
                  maxLength={REPORT_MESSAGE_MAX}
                  required
                  placeholder="What you did, what you expected, and what happened instead."
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
                  placeholder="Email or Discord name, if you'd like a reply"
                  autoComplete="off"
                  className={cn(FIELD, "h-10")}
                />
              </label>
              <p className="rounded-md border bg-shade/20 px-3 py-2 text-xs text-muted-foreground">
                Sent with the page you&apos;re on (<span className="break-all font-mono text-foreground/80">{page || "/"}</span>) and
                your browser version.
              </p>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" size="lg" className="w-full" disabled={state === "sending"}>
                {state === "sending" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                Send report
              </Button>
            </form>
          )}
        </div>
      </dialog>
    </>
  );
}
