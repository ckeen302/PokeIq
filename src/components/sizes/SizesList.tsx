import Link from "next/link";
import { itemPath } from "@/lib/sizes/deeplink";
import { dexTag } from "@/lib/sizes/badges";
import { KIND_LABEL, formatFeet, formatMetres, type SizeItem } from "@/lib/sizes/types";
import { capitalize } from "@/lib/pokemon/type-matrix";
import { typeColor } from "@/lib/pokemon/type-colors";
import { getPokemon } from "@/lib/pokemon/pokedex";
import { SortTable, type SortColumn } from "./SortTable";

const COLUMNS: SortColumn[] = [
  { key: "name", label: "Pokémon", numeric: false },
  { key: "m", label: "Size", numeric: true },
  { key: "kg", label: "Weight", numeric: true, className: "hidden sm:table-cell" },
  { key: "dex", label: "Dex", numeric: true, className: "hidden md:table-cell" },
];

/**
 * The line as a plain table, smallest first, sortable by name, size, weight
 * and Dex number: what search engines index, and the whole page without
 * WebGL or with reduced motion. Each Pokémon links to its own size page and
 * its Pokédex entry; real-world references stand in the table for scale.
 */
export function SizesList({ items, focus, caption }: { items: SizeItem[]; focus?: string; caption: string }) {
  return (
    <div className="overflow-x-clip rounded-lg border bg-card/40 px-3 sm:px-4" data-testid="sizes-list">
      <SortTable columns={COLUMNS} initial={{ key: "m", dir: 1 }} label={caption}>
        {items.map((i, n) => {
          const ref = i.kind === "ref";
          return (
            <tr
              key={i.key}
              id={`size-${i.key}`}
              data-order={n}
              data-name={i.name.toLowerCase()}
              data-m={i.m}
              data-kg={i.kg ?? ""}
              data-dex={i.species || ""}
              className={`scroll-mt-28 border-b border-foreground/[0.06] last:border-0 ${i.key === focus ? "sz-list-hit" : ""} ${ref ? "text-muted-foreground" : ""}`}
            >
              <td className="py-2 pr-2 font-pixel text-[10px] tabular-nums text-muted-foreground" data-rank>{n + 1}</td>
              <td className="py-2 pr-2">
                {ref ? (
                  <span className="font-display font-semibold uppercase tracking-wide">{i.name}<span className="ml-2 font-pixel text-[9px] normal-case tracking-normal">real-world size</span></span>
                ) : (
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <Link href={itemPath(i.key)} prefetch={false} className="font-display font-semibold uppercase tracking-wide hover:text-primary">{i.name}</Link>
                    {i.kind !== "pokemon" && <span className="font-pixel text-[9px] uppercase tracking-wider text-muted-foreground">{KIND_LABEL[i.kind]}</span>}
                    <span className="inline-flex gap-1" aria-label={i.types.map(capitalize).join(" / ")}>
                      {i.types.map((t) => <span key={t} className="h-2 w-2 rounded-full" style={{ background: typeColor(t) }} title={capitalize(t)} />)}
                    </span>
                  </span>
                )}
              </td>
              <td className="whitespace-nowrap py-2 pr-2 tabular-nums">
                <span className="font-semibold">{formatMetres(i.m)}{i.min ? "+" : ""}</span>
                <span className="ml-1.5 text-xs text-muted-foreground">{formatFeet(i.m)}{i.min ? "+" : ""}{i.length ? " · length" : ""}</span>
              </td>
              <td className="hidden whitespace-nowrap py-2 pr-2 tabular-nums text-muted-foreground sm:table-cell">{i.kg != null ? `${i.kg.toLocaleString("en-US")} kg` : "—"}</td>
              <td className="hidden py-2 pr-2 md:table-cell">
                {ref ? null : (
                  <Link href={`/pokemon/${pokedexSlug(i)}`} prefetch={false} className="font-pixel text-[10px] text-muted-foreground hover:text-foreground">{dexTag(i.species)}</Link>
                )}
              </td>
            </tr>
          );
        })}
      </SortTable>
    </div>
  );
}

/** The species' Pokédex page for any form ("charizard-gmax" → "charizard"). */
export function pokedexSlug(i: SizeItem): string {
  return i.kind === "pokemon" ? i.key : getPokemon(i.species)?.slug ?? i.key;
}
