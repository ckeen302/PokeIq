"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Mainline-style text box: text types out character by character, then a
 * blinking ▼ appears. Clicking completes it instantly; reduced-motion users
 * get the full text immediately.
 */
export function DialogBox({
  text,
  speed = 14,
  className,
  children,
  onDone,
  as: Tag = "p",
}: {
  as?: "p" | "h2";
  text: string;
  /** ms per character */
  speed?: number;
  className?: string;
  children?: React.ReactNode;
  onDone?: () => void;
}) {
  const [shown, setShown] = useState(0);
  const done = shown >= text.length;

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || speed <= 0) {
      setShown(text.length);
      return;
    }
    setShown(0);
    const id = setInterval(() => {
      setShown((n) => {
        if (n >= text.length) {
          clearInterval(id);
          return n;
        }
        return n + 1;
      });
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);

  useEffect(() => {
    if (done) onDone?.();
  }, [done, onDone]);

  return (
    <div className={cn("dialog-box", className)} data-done={done} onClick={() => setShown(text.length)}>
      <Tag className="font-display text-lg font-semibold leading-snug tracking-normal sm:text-xl">
        {/* Screen readers get the whole line at once, not the typewriter. */}
        <span className="sr-only">{text}</span>
        <span aria-hidden>{text.slice(0, shown)}</span>
        {/* Reserve the full height so the box never jumps while typing. */}
        <span className="invisible" aria-hidden>
          {text.slice(shown)}
        </span>
      </Tag>
      {children && done && <div className="mt-2">{children}</div>}
    </div>
  );
}
