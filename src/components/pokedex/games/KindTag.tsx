import { KIND_LABEL, type GameKind } from "@/lib/dex/video-games-types";
import { cn } from "@/lib/utils";

/** Mainline / Remake / Spin-off / Mobile, each in one of the site's accent colours. */
const KIND_CLASS: Record<GameKind, string> = {
  mainline: "border-primary/50 bg-primary/15 text-primary",
  remake: "border-screen/50 bg-screen/15 text-screen",
  spinoff: "border-success/50 bg-success/15 text-success",
  mobile: "border-warning/50 bg-warning/15 text-warning",
};

export function KindTag({ kind, className }: { kind: GameKind; className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center rounded-[4px] border px-1.5 py-[3px] font-display text-[11px] font-bold uppercase leading-none tracking-[0.08em]", KIND_CLASS[kind], className)}
      data-testid="games-kind-tag"
    >
      {KIND_LABEL[kind]}
    </span>
  );
}
