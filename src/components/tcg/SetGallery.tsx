"use client";

import { useMemo, useState } from "react";
import type { CardTile } from "@/lib/tcg/types";
import { rarityRank, sortTiles, type TileSort } from "@/lib/tcg/prices";
import { useT } from "@/i18n/client";
import tcgCards from "@/messages/tcg-cards";
import { CardGrid, gridText } from "./CardGrid";

const SORTS: { id: TileSort; label: "number" | "priceDesc" | "priceAsc" | "rarity" }[] = [
  { id: "number", label: "number" },
  { id: "price-desc", label: "priceDesc" },
  { id: "price-asc", label: "priceAsc" },
  { id: "rarity", label: "rarity" },
];

const selectCls = "h-9 rounded-md border border-foreground/15 bg-card px-2 text-sm text-foreground focus:border-screen focus:outline-none";

/**
 * A set's full card list with client-side sort and rarity / type filters. `kindNames`: the types' names in the page's
 * language (sent only by pages in another language; rarities stay the card source's English).
 */
export function SetGallery({ tiles, kindNames }: { tiles: CardTile[]; kindNames?: Record<string, string> }) {
  const t = useT(tcgCards);
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
          <span className="font-pixel text-[9px] uppercase tracking-wider text-muted-foreground">{t("gallery.sort")}</span>
          <select className={selectCls} value={sort} onChange={(e) => setSort(e.target.value as TileSort)} data-testid="tcg-sort">
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {t(`gallery.${s.label}`)}
              </option>
            ))}
          </select>
        </label>
        {rarities.length > 1 && (
          <label className="flex flex-col gap-1">
            <span className="font-pixel text-[9px] uppercase tracking-wider text-muted-foreground">{t("gallery.rarity")}</span>
            <select className={selectCls} value={rarity} onChange={(e) => setRarity(e.target.value)} data-testid="tcg-rarity">
              <option value="">{t("gallery.allRarities")}</option>
              {rarities.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
        )}
        {kinds.length > 1 && (
          <label className="flex flex-col gap-1">
            <span className="font-pixel text-[9px] uppercase tracking-wider text-muted-foreground">{t("gallery.type")}</span>
            <select className={selectCls} value={kind} onChange={(e) => setKind(e.target.value)} data-testid="tcg-type">
              <option value="">{t("gallery.allTypes")}</option>
              {kinds.map((k) =>
                kindNames ? (
                  <option key={k} value={k}>
                    {kindNames[k] ?? k}
                  </option>
                ) : (
                  <option key={k}>{k}</option>
                )
              )}
            </select>
          </label>
        )}
        <span className="ml-auto pb-2 font-pixel text-[10px] uppercase tracking-wider text-muted-foreground" data-testid="tcg-count">
          {t("gallery.count", { shown: shown.length, total: tiles.length })}
        </span>
      </div>
      {shown.length ? <CardGrid tiles={shown} text={gridText(t)} /> : <p className="py-10 text-center text-sm text-muted-foreground">{t("gallery.none")}</p>}
    </div>
  );
}
