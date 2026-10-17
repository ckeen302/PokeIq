import { capitalize } from "@/lib/pokemon/type-matrix";
import { typeColor, typeTextColor } from "@/lib/pokemon/type-colors";
import { cn } from "@/lib/utils";

/** In-game style type plate: solid colour, bevelled edge, uppercase label. */
export function TypeBadge({ type, size = "md", className }: { type: string; size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-[4px] font-display font-bold uppercase tracking-[0.08em]",
        size === "sm" && "px-1.5 py-[3px] text-[10px] leading-none",
        size === "md" && "px-2.5 py-1 text-[11px] leading-none",
        size === "lg" && "px-4 py-1.5 text-sm leading-none",
        className
      )}
      style={{
        background: typeColor(type),
        color: typeTextColor(type),
        boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.35), inset 0 -2px 0 rgb(0 0 0 / 0.25)",
      }}
    >
      {capitalize(type)}
    </span>
  );
}
