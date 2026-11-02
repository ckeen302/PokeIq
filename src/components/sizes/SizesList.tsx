"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { itemPath } from "@/lib/sizes/deeplink";
import { dexTag } from "@/lib/sizes/badges";
import { KIND_LABEL, formatFeet, formatMetres, type SizeKind } from "@/lib/sizes/types";
import { TYPE_COLORS } from "@/lib/pokemon/type-colors";

/** One table row, compact on the wire: key, name, kind, Dex number, metres, length?, minimum?, kg, types ("fire/flying"), Pokédex slug. */
export type ListRow = [key: string, name: string, kind: SizeKind, dex: number, m: number, length: 0 | 1, min: 0 | 1, kg: number | null, types: string, dexSlug: string];

type SortKey = "m" | "name" | "kg" | "dex";

const HEAD: { key: SortKey; label: string; cls?: string }[] = [
  { key: "name", label: "Pokémon" },
  { key: "m", label: "Size" },
  { key: "kg", label: "Weight", cls: "szt-w" },
  { key: "dex", label: "Dex", cls: "szt-d" },
];

/**
 * The line as a plain table, smallest first, sortable by name, size, weight
 * and Dex number: what search engines index, and the whole page without
 * WebGL or with reduced motion. Each Pokémon links to its own size page and
 * its Pokédex entry; real-world references stand in the table for scale. A
 * client component so its rows travel once, as compact data, rather than
 * as a second rendered tree.
 */
export function SizesList({ rows, focus, caption }: { rows: ListRow[]; focus?: string; caption: string }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "m", dir: 1 });
  const sorted = useMemo(() => {
    const idx = rows.map((r, i) => [r, i] as const);
    const val = (r: ListRow): number | string => (sort.key === "m" ? r[4] : sort.key === "name" ? r[1] : sort.key === "kg" ? r[7] ?? 1e9 : r[3] || 1e9);
    idx.sort(([a, ia], [b, ib]) => {
      const va = val(a), vb = val(b);
      const d = typeof va === "number" ? va - (vb as number) : va.localeCompare(vb as string);
      return (d || ia - ib) * sort.dir;
    });
    return idx.map(([r]) => r);
  }, [rows, sort]);
  return (
    <div className="overflow-x-clip rounded-lg border bg-card/40 px-3 sm:px-4" data-testid="sizes-list">
      <table className="szt" aria-label={caption}>
        <thead>
          <tr>
            <th scope="col">#</th>
            {HEAD.map((h) => {
              const on = sort.key === h.key;
              return (
                <th key={h.key} scope="col" className={h.cls} aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                  <button type="button" onClick={() => setSort((s) => ({ key: h.key, dir: s.key === h.key ? (s.dir === 1 ? -1 : 1) : 1 }))} className={on ? "on" : undefined} data-testid={`sizes-sort-${h.key}`}>
                    {h.label}
                    {on && (sort.dir === 1 ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />)}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, n) => {
            const [key, name, kind, dex, m, length, min, kg, types, slug] = r;
            const plus = min ? "+" : "";
            const ref = kind === "ref";
            return (
              <tr key={key} id={`size-${key}`} className={`${ref ? "ref" : ""}${key === focus ? " sz-list-hit" : ""}`}>
                <td>{n + 1}</td>
                <td>
                  {ref ? (
                    <>{name}<span className="k">real-world size</span></>
                  ) : (
                    <>
                      <Link href={itemPath(key)} prefetch={false} className="n">{name}</Link>
                      {kind !== "pokemon" && <span className="k">{KIND_LABEL[kind]}</span>}
                      {types.split("/").filter(Boolean).map((t) => <i key={t} style={{ background: TYPE_COLORS[t] ?? "#888" }} title={t} />)}
                    </>
                  )}
                </td>
                <td><b>{formatMetres(m)}{plus}</b><small>{formatFeet(m)}{plus}{length ? " · length" : ""}</small></td>
                <td className="szt-w">{kg != null ? `${kg.toLocaleString("en-US")} kg` : "—"}</td>
                <td className="szt-d">{ref ? null : <Link href={`/pokemon/${slug}`} prefetch={false}>{dexTag(dex)}</Link>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
