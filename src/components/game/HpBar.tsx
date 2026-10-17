import { cn } from "@/lib/utils";

/** HP-bar style meter: green → yellow → red as it drains. */
export function HpBar({ value, label, className }: { value: number; label?: string; className?: string }) {
  const pct = Math.max(0, Math.min(1, value));
  const color = pct > 0.5 ? "hsl(var(--success))" : pct > 0.22 ? "hsl(var(--warning))" : "hsl(var(--destructive))";
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {label && <span className="font-pixel text-[10px] font-bold text-warning">{label}</span>}
      <div className="meter flex-1">
        <div
          className="h-full transition-[width,background-color] duration-100 ease-linear"
          style={{ width: `${pct * 100}%`, background: color, boxShadow: `0 0 8px ${color}` }}
        />
      </div>
    </div>
  );
}
