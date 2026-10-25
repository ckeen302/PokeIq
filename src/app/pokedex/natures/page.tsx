import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { DexTabs } from "@/components/pokedex/DexTabs";
import { ListHeader } from "@/components/pokedex/detail/DetailParts";
import { NATURE_STATS, natureRows } from "@/lib/dex/natures";

export const metadata: Metadata = pageMetadata({
  title: "Pokémon Natures — Stat Boosts & Flavor Preferences",
  description: "All 25 Pokémon natures: the stat each one raises by 10% and the stat it lowers, plus the berry flavor a Pokémon likes or dislikes.",
  path: "/pokedex/natures",
});

const label = (k: string | null) => (k ? NATURE_STATS.find((s) => s.key === k)!.label : "—");

export default function NaturesPage() {
  const rows = natureRows();
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <ListHeader kicker="Natures · 25" title="Poké" accent="dex" blurb="A nature raises one stat by 10% and lowers another by 10%. Five natures change nothing." />
      <DexTabs active="natures" />
      <div className="hud overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[34rem] text-left text-sm" data-testid="nature-table">
          <thead className="text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="p-3">Nature</th>
              <th className="p-3">Raises</th>
              <th className="p-3">Lowers</th>
              <th className="p-3">Likes</th>
              <th className="p-3">Dislikes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => (
              <tr key={n.name} data-testid={`nature-${n.name.toLowerCase()}`} className="border-t border-foreground/10">
                <th scope="row" className="p-3 font-semibold">{n.name}</th>
                <td className={n.plus ? "p-3 font-semibold text-emerald-400" : "p-3 text-muted-foreground"}>{n.plus ? `+${label(n.plus)}` : "—"}</td>
                <td className={n.minus ? "p-3 font-semibold text-red-400" : "p-3 text-muted-foreground"}>{n.minus ? `−${label(n.minus)}` : "—"}</td>
                <td className="p-3">{n.likes ?? "—"}</td>
                <td className="p-3">{n.dislikes ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-center text-xs text-muted-foreground">Neutral natures (Hardy, Docile, Serious, Bashful, Quirky) have no stat change and no flavor preference.</p>
    </div>
  );
}
