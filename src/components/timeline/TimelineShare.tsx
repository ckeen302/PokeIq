"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { track } from "@vercel/analytics";
import { Check, Copy, Share2 } from "lucide-react";
import { copyText } from "@/lib/share";
import { entryPath } from "@/lib/timeline/deeplink";
import { firstRelease, formatDate, type TimelineEntry } from "@/lib/timeline/types";

/**
 * The detail panel's share drawer: the entry's own link (it opens the 3D
 * view at the entry with its panel open, and previews with its own card),
 * copy, the system share sheet where there is one, and a post on X.
 */
export function TimelineShare({ entry, onShared }: { entry: TimelineEntry; onShared?: () => void }) {
  const [url, setUrl] = useState(entryPath(entry.id));
  const [copied, setCopied] = useState(false);
  const [canNative, setCanNative] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    setUrl(`${window.location.origin}${entryPath(entry.id)}`);
    setCanNative(typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches);
    return () => window.clearTimeout(timer.current);
  }, [entry.id]);

  const when = formatDate(firstRelease(entry).date);
  const text = `${entry.title} (${when}) on the Pokémon Timeline`;

  async function copy() {
    const ok = await copyText(url);
    if (!ok) return;
    setCopied(true);
    onShared?.();
    track("share", { kind: "timeline", via: "copied" });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 2000);
  }
  async function native() {
    try {
      await navigator.share({ title: entry.title, text, url });
      onShared?.();
      track("share", { kind: "timeline", via: "shared" });
    } catch {
      // cancelled
    }
  }

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
      className="overflow-hidden"
      data-testid="timeline-share-panel"
    >
      <div className="space-y-2.5 border-t border-foreground/[0.06] px-4 pb-3.5 pt-3">
        <p className="font-pixel text-[9px] uppercase tracking-[0.16em] text-muted-foreground">Share this moment</p>
        <div className="flex items-stretch gap-1.5">
          <output
            className="min-w-0 flex-1 select-all truncate rounded-md border bg-shade/40 px-2.5 py-2 font-mono text-xs text-foreground/90"
            title={url}
            data-testid="timeline-share-url"
          >
            {url.replace(/^https?:\/\//, "")}
          </output>
          <button
            type="button"
            onClick={() => void copy()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[hsl(var(--lane)/0.6)] bg-[hsl(var(--lane)/0.14)] px-3 font-display text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground transition-colors hover:bg-[hsl(var(--lane)/0.24)]"
            data-testid="timeline-share-copy"
          >
            {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {canNative && (
            <button type="button" onClick={() => void native()} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
              <Share2 className="h-3.5 w-3.5" aria-hidden /> Share…
            </button>
          )}
          <a
            href={`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onShared?.()}
            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
            data-testid="timeline-share-x"
          >
            Post on X
          </a>
        </div>
        <p className="sr-only" role="status" aria-live="polite">{copied ? "Link copied" : ""}</p>
      </div>
    </motion.div>
  );
}
