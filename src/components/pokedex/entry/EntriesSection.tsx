"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Quote } from "lucide-react";

/** Signature colours of each main-series game, for the entry badges. */
const GAME_COLORS: Record<string, string> = {
  red: "#ef4444", blue: "#3b82f6", yellow: "#eab308", gold: "#d4a017", silver: "#a8b3c1", crystal: "#67e8f9",
  ruby: "#dc2626", sapphire: "#2563eb", emerald: "#10b981", firered: "#f97316", leafgreen: "#22c55e",
  diamond: "#93c5fd", pearl: "#f9a8d4", platinum: "#9ca3af", heartgold: "#f59e0b", soulsilver: "#cbd5e1",
  black: "#a1a1aa", white: "#e5e7eb", "black 2": "#8b8b94", "white 2": "#f3f4f6", x: "#3b82f6", y: "#ef4444",
  "omega ruby": "#b91c1c", "alpha sapphire": "#1d4ed8", sun: "#f59e0b", moon: "#8b5cf6", "ultra sun": "#f97316",
  "ultra moon": "#7c3aed", "lets go pikachu": "#facc15", "lets go eevee": "#b45309", sword: "#0ea5e9", shield: "#e11d48",
  "brilliant diamond": "#60a5fa", "shining pearl": "#f472b6", "legends arceus": "#d6d3d1", scarlet: "#dc2626", violet: "#7c3aed",
};

function gameColor(game: string): string {
  return GAME_COLORS[game.toLowerCase()] ?? "#64748b";
}

export function EntriesSection({ entries }: { entries: { text: string; games: string[] }[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? entries : entries.slice(-6).reverse();
  return (
    <div className="space-y-3">
      <div className="columns-1 gap-3 md:columns-2 [&>*]:mb-3">
        {shown.map((e, i) => (
          <motion.figure
            key={e.text}
            className="break-inside-avoid hud rounded-lg border bg-card p-4"
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: Math.min(i, 8) * 0.05 }}
          >
            <Quote className="mb-1 h-4 w-4 text-primary/60" aria-hidden />
            <blockquote className="text-sm leading-relaxed">{e.text}</blockquote>
            {e.games.length > 0 && (
              <figcaption className="mt-3 flex flex-wrap gap-1">
                {e.games.map((g) => (
                  <span
                    key={g}
                    className="rounded-sm px-1.5 py-1 font-pixel text-[9px] uppercase leading-none tracking-wider"
                    style={{ background: `${gameColor(g)}26`, color: gameColor(g), border: `1px solid ${gameColor(g)}55` }}
                  >
                    {g}
                  </span>
                ))}
              </figcaption>
            )}
          </motion.figure>
        ))}
      </div>
      {entries.length > 6 && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="text-sm font-medium text-primary hover:underline">
          {expanded ? "Show latest only" : `Show all ${entries.length} entries`}
        </button>
      )}
    </div>
  );
}
