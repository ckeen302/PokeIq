import type { ShareTile } from "@/lib/share";
import { cn } from "@/lib/utils";

const TILE_CLASS: Record<ShareTile, string> = {
  hit: "bg-success",
  near: "bg-warning",
  far: "bg-orange-500",
  wrong: "bg-destructive/80",
  miss: "bg-muted-foreground/30",
  up: "bg-muted-foreground/30",
  down: "bg-muted-foreground/30",
  mask: "bg-blue-500",
  "conn-yellow": "bg-[#f2cf55]",
  "conn-green": "bg-[#96c860]",
  "conn-blue": "bg-[#8fb2ef]",
  "conn-purple": "bg-[#bd8ad8]",
  "pdk-purple": "bg-[#a855f7]",
  "pdk-blue": "bg-[#3b82f6]",
  "pdk-green": "bg-[#22c55e]",
  "pdk-yellow": "bg-[#eab308]",
  "pdk-empty": "bg-zinc-800",
};

const TILE_LABEL: Record<ShareTile, string> = {
  hit: "right",
  near: "close",
  far: "far",
  wrong: "wrong",
  miss: "wrong",
  up: "higher",
  down: "lower",
  mask: "hidden",
  "conn-yellow": "yellow",
  "conn-green": "green",
  "conn-blue": "blue",
  "conn-purple": "purple",
  "pdk-purple": "under 1%",
  "pdk-blue": "under 10%",
  "pdk-green": "under 25%",
  "pdk-yellow": "25% or more",
  "pdk-empty": "wrong or empty",
};

/** A shared result's board: rows of squares, plus optional numbers under them (PokéGuessr's points). */
export function ShareBoard({ tiles, numbers }: { tiles: ShareTile[][]; numbers?: string[] }) {
  if (!tiles.length) return null;
  const cols = Math.max(...tiles.map((r) => r.length));
  return (
    <div className="mx-auto inline-flex flex-col gap-1.5" role="img" aria-label={tiles.map((r, i) => `Row ${i + 1}: ${r.map((t) => TILE_LABEL[t]).join(", ")}`).join(". ")}>
      {tiles.map((row, r) => (
        <div key={r} className="flex justify-center gap-1.5">
          {row.map((t, i) => (
            <span
              key={i}
              className={cn("flex h-9 w-9 items-center justify-center rounded-[4px] text-sm font-bold shadow-[inset_0_-3px_0_rgb(0_0_0/0.3)]", TILE_CLASS[t])}
            >
              {t === "up" ? "▲" : t === "down" ? "▼" : ""}
            </span>
          ))}
        </div>
      ))}
      {numbers && (
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cols}, 2.25rem)` }}>
          {numbers.map((n, i) => (
            <span key={i} className="text-center font-pixel text-[9px] tabular-nums text-muted-foreground">
              {n}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
