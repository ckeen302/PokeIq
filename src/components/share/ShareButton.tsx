"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { track } from "@vercel/analytics";
import { Check, Share2 } from "lucide-react";
import { shareOrCopy, type ShareOutcome } from "@/lib/share";
import { Button, type ButtonProps } from "@/components/ui/button";
import { CopyFallback } from "@/components/quiz/CopyFallback";
import { cn } from "@/lib/utils";

const TOAST_MS = 2200;

/**
 * The end-of-game share button: the system share sheet where the browser
 * has one, else the clipboard with a "Copied!" toast. If neither works, the
 * text shows below the button for copying by hand. `getText` is called on
 * click, so the text always has the latest result.
 */
export function ShareButton({
  getText,
  label = "Share result",
  kind,
  onShared,
  className,
  fallbackClassName,
  ...props
}: Omit<ButtonProps, "onClick" | "children"> & {
  /** The full share text, link included. */
  getText: () => string;
  label?: string;
  /** For analytics: which game shared. */
  kind?: string;
  onShared?: (outcome: Exclude<ShareOutcome, "cancelled" | "failed">) => void;
  /** Classes for the manual-copy box (e.g. a grid's full width). */
  fallbackClassName?: string;
}) {
  const [done, setDone] = useState<"copied" | "shared" | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function share() {
    const text = getText();
    const outcome = await shareOrCopy(text);
    if (outcome === "cancelled") return;
    if (outcome === "failed") return setFallback(text);
    setFallback(null);
    setDone(outcome);
    if (kind) track("share", { kind, via: outcome });
    onShared?.(outcome);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDone(null), TOAST_MS);
  }

  return (
    <>
      <Button type="button" onClick={() => void share()} className={className} data-testid="share-result" {...props}>
        {done ? <Check className="h-4 w-4" aria-hidden /> : <Share2 className="h-4 w-4" aria-hidden />}
        {done === "copied" ? "Copied!" : done === "shared" ? "Shared!" : label}
      </Button>
      {fallback && (
        <div className={cn("col-span-full basis-full", fallbackClassName)}>
          <CopyFallback text={fallback} />
        </div>
      )}
      <CopiedToast show={done === "copied"} />
    </>
  );
}

/** "Copied!" at the bottom of the screen (in a portal: a transformed parent would trap a fixed element). */
function CopiedToast({ show }: { show: boolean }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-8 z-[70] flex justify-center" role="status" aria-live="polite">
      <AnimatePresence>
        {show && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            className="hud flex items-center gap-2 rounded-lg border border-success/60 bg-card px-4 py-2.5 text-sm font-semibold shadow-xl"
            data-testid="share-toast"
          >
            <Check className="h-4 w-4 text-success" aria-hidden /> Copied! Paste it anywhere.
          </motion.div>
        )}
      </AnimatePresence>
    </div>,
    document.body
  );
}
