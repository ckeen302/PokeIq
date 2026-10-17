import { capitalize } from "@/lib/pokemon/type-matrix";
import { typeColor, typeTextColor } from "@/lib/pokemon/type-colors";
import { cn } from "@/lib/utils";

export function TypeBadge({ type, size = "md", className }: { type: string; size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full font-bold uppercase tracking-wide shadow-sm",
        size === "sm" && "px-2 py-0.5 text-[10px]",
        size === "md" && "px-2.5 py-0.5 text-xs",
        size === "lg" && "px-4 py-1 text-sm",
        className
      )}
      style={{
        background: `linear-gradient(135deg, ${typeColor(type)}, ${typeColor(type)}cc)`,
        color: typeTextColor(type),
        boxShadow: `0 0 12px -2px ${typeColor(type)}88`,
      }}
    >
      {capitalize(type)}
    </span>
  );
}
