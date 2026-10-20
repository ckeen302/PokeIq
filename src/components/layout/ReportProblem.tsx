"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MessageSquareWarning, X } from "lucide-react";
import { currentPage, installErrorReporter } from "@/lib/report";
import { FeedbackForm } from "./FeedbackForm";

/** Sends errors the page didn't catch to /api/report (see lib/report). */
export function ErrorReporter() {
  useEffect(() => installErrorReporter(), []);
  return null;
}

/** The footer's "Report a problem" link: the feedback form (as on /feedback) in a dialog, about the page you're on. */
export function ReportProblem() {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [page, setPage] = useState("");
  const [opened, setOpened] = useState(0);

  function open() {
    setPage(currentPage());
    setOpened((n) => n + 1);
    dialog.current?.showModal();
  }

  const close = () => dialog.current?.close();

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
                <MessageSquareWarning className="h-3.5 w-3.5" aria-hidden /> Feedback
              </p>
              <h2 id={`${id}-title`} className="font-display text-2xl font-bold uppercase leading-tight">
                Report a problem
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
          {opened > 0 && <FeedbackForm key={opened} page={page} onClose={close} />}
        </div>
      </dialog>
    </>
  );
}
