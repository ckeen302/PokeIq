import { typeColor } from "@/lib/pokemon/type-colors";
import { initials } from "@/lib/trainers/format";
import { cn } from "@/lib/utils";

/**
 * Placeholder portrait: we don't ship official trainer art, so a notable
 * trainer gets their initials on a plate in their specialty type's colour.
 */
export function TrainerAvatar({ name, type, size = "md", className }: { name: string; type?: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const c = type ? typeColor(type.toLowerCase()) : "hsl(var(--primary))";
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full border-2 font-display font-bold uppercase text-white",
        size === "sm" && "h-10 w-10 text-sm",
        size === "md" && "h-14 w-14 text-lg",
        size === "lg" && "h-24 w-24 text-3xl sm:h-28 sm:w-28 sm:text-4xl",
        className
      )}
      style={{
        borderColor: c,
        background: `radial-gradient(circle at 30% 25%, rgb(255 255 255 / 0.28), transparent 55%), linear-gradient(145deg, ${c}, color-mix(in srgb, ${c} 45%, #0b0f14))`,
        textShadow: "0 2px 0 rgb(0 0 0 / 0.35)",
      }}
    >
      {initials(name)}
      <span className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-white/15" />
    </span>
  );
}
