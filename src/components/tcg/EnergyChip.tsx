import { ENERGY_COLORS, energyTextColor } from "@/lib/tcg/prices";

/**
 * A TCG energy type: a labelled chip, or (dot) a small round symbol for attack costs. `label`: the type's name in the
 * page's language (the type's English name otherwise; the dot's letter is always the English initial, as a symbol).
 */
export function EnergyChip({ type, dot = false, label }: { type: string; dot?: boolean; label?: string }) {
  const bg = ENERGY_COLORS[type] ?? "#888";
  if (dot) {
    return (
      <span
        title={label ?? type}
        aria-label={label ?? type}
        role="img"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full font-pixel text-[8px] ring-1 ring-black/20"
        style={{ background: bg, color: energyTextColor(type) }}
      >
        {type === "Free" ? "" : type[0]}
      </span>
    );
  }
  return (
    <span className="rounded-sm px-2 py-1 font-pixel text-[9px] uppercase tracking-wider" style={{ background: bg, color: energyTextColor(type) }}>
      {label ?? type}
    </span>
  );
}
