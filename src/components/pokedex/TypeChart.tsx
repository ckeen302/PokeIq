import Link from "@/components/ui/Link";
import { TYPES, effectiveness, capitalize } from "@/lib/pokemon/type-matrix";
import { typeColor, typeTextColor } from "@/lib/pokemon/type-colors";
import { cn } from "@/lib/utils";
import { getLocale, serverT } from "@/i18n/server";
import pages from "@/messages/pokedex-pages";
import { typeNames } from "@/lib/pokemon/dex-local";

const CELL: Record<string, string> = {
  "2": "bg-orange-500/80 text-white",
  "0.5": "bg-emerald-600/60 text-white",
  "0": "bg-sky-500/60 text-white",
  "1": "bg-muted/30 text-transparent",
};
const LABEL: Record<string, string> = { "2": "2", "0.5": "½", "0": "0", "1": "·" };
const WORD = { "2": "super", "0.5": "notVery", "0": "none", "1": "neutral" } as const;

/** The full 18x18 chart: rows attack, columns defend. Fully static. */
export function TypeChart() {
  const t = serverT(pages);
  const locale = getLocale();
  const names = locale === "en" ? null : typeNames(locale);
  const name = (type: string) => names?.[type] ?? capitalize(type);
  // The column heads' short names: the English three letters, or the first three of the language's name.
  const short = (type: string) => (names ? [...name(type)].slice(0, 3).join("") : type.slice(0, 3));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-center gap-3 text-xs">
        {(["2", "0.5", "0"] as const).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className={cn("inline-flex h-5 w-6 items-center justify-center rounded font-bold", CELL[k])}>{LABEL[k]}</span>
            {t(`chart.${WORD[k]}`)}
          </span>
        ))}
        <span className="text-muted-foreground">{t("chart.legend")}</span>
      </div>
      <div className="hud overflow-x-auto rounded-lg border bg-card p-3" data-testid="type-chart">
        <table className="mx-auto border-separate border-spacing-0.5 text-center">
          <caption className="sr-only">{t("chart.caption")}</caption>
          <thead>
            <tr>
              <td className="p-0" />
              {TYPES.map((d) => (
                <th key={d} scope="col" className="p-0" title={t("chart.defending", { type: name(d) })}>
                  <Link
                    href={`/pokedex/types/${d}`}
                    aria-label={t("type.name", { type: name(d) })}
                    className="mx-auto flex h-6 w-8 items-center justify-center rounded-[3px] text-[9px] font-bold uppercase"
                    style={{ background: typeColor(d), color: typeTextColor(d) }}
                  >
                    {short(d)}
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TYPES.map((a) => (
              <tr key={a}>
                <th scope="row" className="p-0 pr-1" title={t("chart.attacking", { type: name(a) })}>
                  <Link
                    href={`/pokedex/types/${a}`}
                    className="flex h-8 w-14 items-center justify-center whitespace-nowrap rounded-[3px] text-[9px] font-bold uppercase max-md:w-auto max-md:min-w-14 max-md:px-1.5"
                    style={{ background: typeColor(a), color: typeTextColor(a) }}
                  >
                    {name(a)}
                  </Link>
                </th>
                {TYPES.map((d) => {
                  const m = String(effectiveness(a, [d])) as keyof typeof WORD;
                  return (
                    <td
                      key={d}
                      data-testid={`tc-${a}-${d}`}
                      title={t("chart.cell", { a: name(a), d: name(d), word: t(`chart.${WORD[m]}`) })}
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
