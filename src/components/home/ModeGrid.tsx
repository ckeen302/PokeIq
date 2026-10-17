"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { MODULE_INFO, PLAY_MODULES, moduleHref } from "@/lib/modes";
import { useProgress } from "@/lib/progress";

const container = { hidden: {}, show: { transition: { staggerChildren: 0.07, delayChildren: 0.1 } } };
const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.21, 0.47, 0.32, 0.98] as const } },
};

export function ModeGrid() {
  const progress = useProgress();
  return (
    <motion.div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" variants={container} initial="hidden" animate="show">
      {PLAY_MODULES.map((id) => {
        const info = MODULE_INFO[id];
        const best = progress?.best[`${id}:${info.defaultFormat}`];
        return (
          <motion.div key={id} variants={item}>
            <Link href={moduleHref(id)} className="group block h-full" aria-label={`Play ${info.title}`}>
              <div
                className="glow-card flex h-full flex-col rounded-xl border bg-card p-5"
                style={{ "--glow": info.accent } as React.CSSProperties}
              >
                <div className="flex items-start justify-between">
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-xl text-2xl"
                    style={{ background: `hsl(${info.accent} / 0.14)` }}
                    aria-hidden
                  >
                    {info.emoji}
                  </div>
                  {best ? (
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      Best {best.toLocaleString()}
                    </span>
                  ) : null}
                </div>
                <h3 className="mt-4 text-lg font-semibold">{info.title}</h3>
                <p className="text-xs font-medium" style={{ color: `hsl(${info.accent})` }}>
                  {info.tagline}
                </p>
                <p className="mt-2 flex-1 text-sm text-muted-foreground">{info.description}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium" style={{ color: `hsl(${info.accent})` }}>
                  Play
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden />
                </span>
              </div>
            </Link>
          </motion.div>
        );
      })}
    </motion.div>
  );
}
