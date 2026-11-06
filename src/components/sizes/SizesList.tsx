"use client";

import { useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { itemPath } from "@/lib/sizes/deeplink";
import { dexTag } from "@/lib/sizes/badges";
import { listCaption, listItems, listNote, listOrder, listRows, type ListRow, type ListSpec } from "@/lib/sizes/list";
import { ORDERS, dirLabel, isHeight, orderInfo, sameOrder, type Order, type OrderKey } from "@/lib/sizes/order";
import { KIND_LABEL, formatFeet, formatMetres } from "@/lib/sizes/types";
import { TYPE_COLORS } from "@/lib/pokemon/type-colors";
import { SizesOrderContext } from "./order-context";
import { loadSizeItems } from "./load-items";

export type { ListRow };

type SortKey = "line" | "m" | "name" | "kg" | "dex" | "v";

const STAT_AT: Partial<Record<OrderKey, number>> = { hp: 0, atk: 1, def: 2, spa: 3, spd: 4, spe: 5 };

/** A row's value in a stat order (the table's value column). */
function rowStat(r: ListRow, by: OrderKey): number | null {
  if (!r[10]) return null;
  const s = r[10].split("/").map(Number);
  return by === "bst" ? s.reduce((a, b) => a + b, 0) : s[STAT_AT[by] ?? -1] ?? null;
}

/**
 * The line as a plain table, in the line's order (Height, smallest first,
 * unless the address or the page's "Order by" says otherwise), and sortable
 * by name, size, weight, the order's value and Dex number: what search
 * engines index, and the whole page without WebGL or with reduced motion.
 * Each Pokémon links to its own size page and its Pokédex entry; real-world
 * references stand in the Height order for scale. The server renders it for
 * the address's order; when the order changes on the page the browser
 * builds the same table from the figures' data. A client component so its
 * rows travel once, as compact data, rather than as a second rendered tree.
 */
export function SizesList({ rows, focus, caption, note, spec, order, path }: { rows: ListRow[]; focus?: string; caption: string; note: string | null; spec: ListSpec; order: Order; path: string }) {
  const ctx = useContext(SizesOrderContext);
  const live = ctx?.order ?? order;
  // The table for another order than the server's: built here from every figure's data.
  const [built, setBuilt] = useState<{ order: Order; rows: ListRow[]; caption: string; note: string | null; shown: Order } | null>(null);
  useEffect(() => {
    if (sameOrder(live, order)) return;
    let alive = true;
    void loadSizeItems().then((all) => {
      if (!alive) return;
      setBuilt({ order: live, rows: listRows(listItems(all, spec, live), all), caption: listCaption(all, spec, live), note: listNote(all, spec, live), shown: listOrder(all, spec, live) });
    }, () => undefined);
    return () => { alive = false; };
  }, [live, order, spec]);
  const cur = !sameOrder(live, order) && built && sameOrder(built.order, live) ? built : null;
  const view = cur ?? { rows, caption, note, shown: order };
  const by = view.shown.by;
  const valueCol = !isHeight(view.shown);

  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "line", dir: 1 });
  // A new order starts the table on it again.
  useEffect(() => setSort({ key: "line", dir: 1 }), [live.by, live.dir]);
  const value = (r: ListRow) => (by === "weight" ? r[7] : rowStat(r, by));
  const sorted = useMemo(() => {
    const idx = view.rows.map((r, i) => [r, i] as const);
    if (sort.key === "line") return sort.dir === 1 ? view.rows : [...view.rows].reverse();
    const val = (r: ListRow): number | string => (sort.key === "m" ? r[4] : sort.key === "name" ? r[1] : sort.key === "kg" ? r[7] ?? 1e9 : sort.key === "v" ? value(r) ?? 1e9 : r[3] || 1e9);
    idx.sort(([a, ia], [b, ib]) => {
      const va = val(a), vb = val(b);
      const d = typeof va === "number" ? va - (vb as number) : va.localeCompare(vb as string);
      return (d || ia - ib) * sort.dir;
    });
    return idx.map(([r]) => r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.rows, sort, by]);

  const head: { key: SortKey; label: string; cls?: string }[] = [
    { key: "name", label: "Pokémon" },
    // The order's value comes first, so it shows on a phone too.
    ...(valueCol ? [{ key: "v" as SortKey, label: orderInfo(by).label, cls: "szt-v" }] : []),
    { key: "m", label: "Size", cls: valueCol ? "szt-s" : undefined },
    ...(by === "weight" ? [] : [{ key: "kg" as SortKey, label: "Weight", cls: "szt-w" }]),
    { key: "dex", label: "Dex", cls: "szt-d" },
  ];
  const rank = useMemo(() => new Map(view.rows.map((r, i) => [r[0], i + 1])), [view.rows]);
  const toggle = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }));
  const setOrder = (o: Order) => ctx?.setOrder(o);

  return (
    <div className="overflow-x-clip rounded-lg border bg-card/40 px-3 sm:px-4" data-testid="sizes-list" data-order={`${live.by}-${live.dir}`}>
      {/* Order by: works without JavaScript too (the address carries it, ?by=speed&dir=desc). */}
      <form method="get" action={path} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b py-3 text-sm" onSubmit={(e) => { if (ctx) e.preventDefault(); }} data-testid="sizes-list-order">
        {spec.vs && spec.vs.length >= 2 && <input type="hidden" name="vs" value={spec.vs.join(",")} />}
        <label className="flex items-center gap-2">
          <span className="font-pixel text-[9px] uppercase tracking-wider text-muted-foreground">Order by</span>
          <select name="by" value={orderInfo(live).param} onChange={(e) => { const o = ORDERS.find((x) => x.param === e.target.value); if (o) setOrder({ by: o.key, dir: live.dir }); }} className="h-8 rounded-md border bg-background px-2 font-display text-xs font-semibold uppercase tracking-wide" data-testid="sizes-list-by">
            {ORDERS.map((o) => <option key={o.key} value={o.param}>{o.label}</option>)}
          </select>
        </label>
        <select name="dir" value={live.dir} onChange={(e) => setOrder({ by: live.by, dir: e.target.value === "desc" ? "desc" : "asc" })} aria-label="Direction" className="h-8 rounded-md border bg-background px-2 font-display text-xs font-semibold uppercase tracking-wide" data-testid="sizes-list-dir">
          <option value="asc">{dirLabel(live.by, "asc")}</option>
          <option value="desc">{dirLabel(live.by, "desc")}</option>
        </select>
        <noscript><button type="submit" className="h-8 rounded-md border px-3 font-display text-xs font-semibold uppercase">Show</button></noscript>
        {view.note && <p className="basis-full text-xs text-muted-foreground sm:basis-auto" data-testid="sizes-list-note">{view.note}</p>}
      </form>
      <table className="szt" aria-label={view.caption}>
        <thead>
          <tr>
            <th scope="col" aria-sort={sort.key === "line" ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
              <button type="button" onClick={() => toggle("line")} className={sort.key === "line" ? "on" : undefined} data-testid="sizes-sort-line">#</button>
            </th>
            {head.map((h) => {
              const on = sort.key === h.key;
              return (
                <th key={h.key} scope="col" className={h.cls} aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                  <button type="button" onClick={() => toggle(h.key)} className={on ? "on" : undefined} data-testid={`sizes-sort-${h.key}`}>
                    {h.label}
                    {on && (sort.dir === 1 ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />)}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const [key, name, kind, dex, m, length, min, kg, types, slug] = r;
            const plus = min ? "+" : "";
            const ref = kind === "ref";
            const v = valueCol ? value(r) : null;
            return (
              <tr key={key} id={`size-${key}`} className={`${ref ? "ref" : ""}${key === focus ? " sz-list-hit" : ""}`}>
                <td>{rank.get(key)}</td>
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
                {valueCol && <td className="szt-v">{v == null ? "—" : by === "weight" ? `${v.toLocaleString("en-US")} kg` : v}</td>}
                <td className={valueCol ? "szt-s" : undefined}><b>{formatMetres(m)}{plus}</b><small>{formatFeet(m)}{plus}{length ? " · length" : ""}</small></td>
                {by !== "weight" && <td className="szt-w">{kg != null ? `${kg.toLocaleString("en-US")} kg` : "—"}</td>}
                <td className="szt-d">{ref ? null : <Link href={`/pokemon/${slug}`} prefetch={false}>{dexTag(dex)}</Link>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
