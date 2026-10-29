import Link from "next/link";
import { TYPES, effectiveness, capitalize } from "@/lib/pokemon/type-matrix";
import { typeColor, typeTextColor } from "@/lib/pokemon/type-colors";
import { cn } from "@/lib/utils";

const CELL: Record<string, string> = {
  "2": "bg-orange-500/80 text-white",
  "0.5": "bg-emerald-600/60 text-white",
  "0": "bg-sky-500/60 text-white",
  "1": "bg-muted/30 text-transparent",
};
const LABEL: Record<string, string> = { "2": "2", "0.5": "½", "0": "0", "1": "·" };
const WORD: Record<string, string> = { "2": "super effective", "0.5": "not very effective", "0": "no effect", "1": "neutral" };

/** The full 18x18 chart: rows attack, columns defend. Fully static. */
export function TypeChart() {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-center gap-3 text-xs">
        {(["2", "0.5", "0"] as const).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className={cn("inline-flex h-5 w-6 items-center justify-center rounded font-bold", CELL[k])}>{LABEL[k]}</span>
            {WORD[k]}
          </span>
        ))}
        <span className="text-muted-foreground">Rows attack, columns defend.</span>
      </div>
      <div className="hud overflow-x-auto rounded-lg border bg-card p-3" data-testid="type-chart">
        <table className="mx-auto border-separate border-spacing-0.5 text-center">
          <caption className="sr-only">Type effectiveness: attacking type by defending type</caption>
          <thead>
            <tr>
              <td className="p-0" />
              {TYPES.map((d) => (
                <th key={d} scope="col" className="p-0" title={`Defending: ${capitalize(d)}`}>
                  <Link
                    href={`/pokedex/types/${d}`}
                    aria-label={`${capitalize(d)} type`}
                    className="mx-auto flex h-6 w-8 items-center justify-center rounded-[3px] text-[9px] font-bold uppercase"
                    style={{ background: typeColor(d), color: typeTextColor(d) }}
                  >
                    {d.slice(0, 3)}
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TYPES.map((a) => (
              <tr key={a}>
                <th scope="row" className="p-0 pr-1" title={`Attacking: ${capitalize(a)}`}>
                  <Link
                    href={`/pokedex/types/${a}`}
                    className="flex h-8 w-14 items-center justify-center rounded-[3px] text-[9px] font-bold uppercase"
                    style={{ background: typeColor(a), color: typeTextColor(a) }}
                  >
                    {capitalize(a)}
                  </Link>
                </th>
                {TYPES.map((d) => {
                  const m = String(effectiveness(a, [d]));
                  return (
                    <td
                      key={d}
                      data-testid={`tc-${a}-${d}`}
                      title={`${capitalize(a)} → ${capitalize(d)}: ${WORD[m]}`}
                      className={cn("h-8 w-8 rounded-[3px] text-xs font-bold", CELL[m])}
                    >
                      {LABEL[m]}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
