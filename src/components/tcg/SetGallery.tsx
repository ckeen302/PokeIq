"use client";

import { useMemo, useState } from "react";
import type { CardTile } from "@/lib/tcg/types";
import { rarityRank, sortTiles, type TileSort } from "@/lib/tcg/prices";
import { CardGrid } from "./CardGrid";

const SORTS: { id: TileSort; label: string }[] = [
  { id: "number", label: "Number" },
  { id: "price-desc", label: "Price ↓" },
  { id: "price-asc", label: "Price ↑" },
  { id: "rarity", label: "Rarity" },
];

const selectCls = "h-9 rounded-md border border-foreground/15 bg-card px-2 text-sm text-foreground focus:border-screen focus:outline-none";

/** A set's full card list with client-side sort and rarity / type filters. */
export function SetGallery({ tiles }: { tiles: CardTile[] }) {
  const [sort, setSort] = useState<TileSort>("number");
  const [rarity, setRarity] = useState("");
  const [kind, setKind] = useState("");
  const rarities = useMemo(() => [...new Set(tiles.flatMap((t) => (t.rarity ? [t.rarity] : [])))].sort((a, b) => rarityRank(a) - rarityRank(b)), [tiles]);
  const kinds = useMemo(() => [...new Set(tiles.flatMap((t) => t.kinds))].sort(), [tiles]);
  const shown = useMemo(
    () => sortTiles(tiles.filter((t) => (!rarity || t.rarity === rarity) && (!kind || t.kinds.includes(kind))), sort),
    [tiles, sort, rarity, kind]
  );

  return (
    <div className="space-y-4">
      <div className="hud flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
        <label className="flex flex-col gap-1">
          <span className="font-pixel text-[9px] uppercase tracking-wider text-muted-foreground">Sort</span>
          <select className={selectCls} value={sort} onChange={(e) => setSort(e.target.value as TileSort)} data-testid="tcg-sort">
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {rarities.length > 1 && (
          <label className="flex flex-col gap-1">
            <span className="font-pixel text-[9px] uppercase tracking-wider text-muted-foreground">Rarity</span>
            <select className={selectCls} value={rarity} onChange={(e) => setRarity(e.target.value)} data-testid="tcg-rarity">
              <option value="">All rarities</option>
              {rarities.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
        )}
        {kinds.length > 1 && (
          <label className="flex flex-col gap-1">
            <span className="font-pixel text-[9px] uppercase tracking-wider text-muted-foreground">Type</span>
            <select className={selectCls} value={kind} onChange={(e) => setKind(e.target.value)} data-testid="tcg-type">
              <option value="">All types</option>
              {kinds.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
        )}
        <span className="ml-auto pb-2 font-pixel text-[10px] uppercase tracking-wider text-muted-foreground" data-testid="tcg-count">
          {shown.length} / {tiles.length} cards
        </span>
      </div>
      {shown.length ? <CardGrid tiles={shown} /> : <p className="py-10 text-center text-sm text-muted-foreground">No cards match those filters.</p>}
    </div>
  );
}
