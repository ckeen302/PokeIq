"use client";

/* eslint-disable @next/next/no-img-element -- pre-sized art */
import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import type { DexEntryData } from "@/lib/pokemon/dex-types";
import { artUrl } from "@/lib/pokemon/art";
import { typeColor } from "@/lib/pokemon/type-colors";
import { cn } from "@/lib/utils";

/**
 * Silhouettes a vision model finds most similar to this one — the exact
 * confusions Who's That Pokémon? hard mode is built from. Hover or tap to
 * reveal each one.
 */
export function LookalikesSection({ self, lookalikes }: { self: { id: number; name: string }; lookalikes: DexEntryData["lookalikes"] }) {
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const toggle = (id: number) =>
    setRevealed((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-3 hud rounded-lg border bg-card p-4">
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <div className="flex flex-col items-center gap-1.5">
          <div className="spotlight flex aspect-square w-full items-center justify-center rounded-md ring-2 ring-primary">
            <img src={artUrl(self.id, 160)} alt={`${self.name} silhouette`} className="h-[85%] w-[85%] object-contain [filter:brightness(0)]" />
          </div>
          <span className="text-xs font-bold text-primary">{self.name}</span>
        </div>
        {lookalikes.map((l, i) => {
          const shown = revealed.has(l.id);
          return (
            <motion.div
              key={l.id}
              className="flex flex-col items-center gap-1.5"
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.06 }}
            >
              <button
                type="button"
                onClick={() => toggle(l.id)}
                onMouseEnter={() => setRevealed((cur) => new Set(cur).add(l.id))}
                className="group relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-md border border-foreground/10 transition-colors"
                style={{ background: shown ? `radial-gradient(circle, ${typeColor(l.types[0])}40, transparent 70%)` : undefined }}
                aria-label={shown ? l.name : "Reveal lookalike"}
              >
                {!shown && <div className="spotlight absolute inset-0 opacity-90" aria-hidden />}
                <img
                  src={artUrl(l.id, 160)}
                  alt={shown ? l.name : "Lookalike silhouette"}
                  className={cn("relative h-[85%] w-[85%] object-contain transition-all duration-500", shown ? "scale-105" : "[filter:brightness(0)]")}
                />
              </button>
              {shown ? (
                <Link href={`/pokemon/${l.slug}`} className="truncate text-xs font-semibold hover:text-primary">
                  {l.name}
                </Link>
              ) : (
                <span className="text-xs text-muted-foreground">???</span>
              )}
              <span className="text-[10px] tabular-nums text-muted-foreground">{Math.round(l.similarity * 100)}% match</span>
            </motion.div>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Ranked by a DINOv2 vision model comparing silhouette shapes — these are the options Who&apos;s That Pokémon? hard
        mode will try to trip you up with. Tap to reveal.
      </p>
    </div>
  );
}
