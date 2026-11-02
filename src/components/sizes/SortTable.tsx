"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SortColumn {
  /** The row attribute it sorts by (data-<key>), numeric or text. */
  key: string;
  label: string;
  numeric: boolean;
  className?: string;
}

/**
 * A server-rendered table whose rows sort in place: the header buttons
 * reorder the rows by their data attributes, so the rows themselves are
 * never sent twice (once as HTML, once as data for a client render).
 */
export function SortTable({ columns, initial, children, label }: { columns: SortColumn[]; initial: { key: string; dir: 1 | -1 }; children: React.ReactNode; label: string }) {
  const [sort, setSort] = useState(initial);
  const body = useRef<HTMLTableSectionElement>(null);
  useEffect(() => {
    const tb = body.current;
    if (!tb) return;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return;
    const rows = Array.from(tb.rows);
    const val = (r: HTMLTableRowElement) => r.dataset[sort.key] ?? "";
    rows.sort((a, b) => {
      const va = val(a), vb = val(b);
      const d = col.numeric ? (Number(va || 1e9) - Number(vb || 1e9)) : va.localeCompare(vb);
      return (d || Number(a.dataset.order) - Number(b.dataset.order)) * sort.dir;
    });
    rows.forEach((r, i) => {
      tb.appendChild(r);
      const rank = r.querySelector<HTMLElement>("[data-rank]");
      if (rank) rank.textContent = String(i + 1);
    });
  }, [sort, columns]);
  return (
    <table className="w-full border-collapse text-sm" aria-label={label}>
      <thead className="sticky top-14 z-10 bg-background/95 backdrop-blur">
        <tr className="border-b text-left">
          <th scope="col" className="w-10 py-2 pr-2 font-pixel text-[9px] font-normal uppercase tracking-wider text-muted-foreground">#</th>
          {columns.map((c) => {
            const on = sort.key === c.key;
            return (
              <th key={c.key} scope="col" aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className={cn("py-2 pr-2 font-normal", c.className)}>
                <button
                  type="button"
                  onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : 1 }))}
                  className={cn("inline-flex items-center gap-1 font-pixel text-[9px] uppercase tracking-wider", on ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
                  data-testid={`sizes-sort-${c.key}`}
                >
                  {c.label}
                  {on && (sort.dir === 1 ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />)}
                </button>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody ref={body}>{children}</tbody>
    </table>
  );
}
