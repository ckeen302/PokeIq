import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { poolOf } from "@/lib/server/whoami";
import { WhoamiHome } from "@/components/whoami/WhoamiHome";

export const metadata: Metadata = pageMetadata({
  title: "Who Am I? — Pokémon Deduction Game",
  description:
    "Deduce the secret Pokémon with yes/no questions: type, generation, size, stats, abilities and moves, paid for in PP. Watch the grid shrink, then name it. Daily puzzle, endless practice and live 1v1 duels.",
  path: "/whoami",
});

export default function WhoamiPage() {
  // The curated set every pool is drawn from: public Pokédex data only (number, name, abilities, generation, legendary), never a secret.
  const all = poolOf({ from: 1, to: 9, casual: false });
  const dex = all.map((p) => [p.id, p.name, p.abilities.map((a) => a.name)] as [number, string, string[]]);
  const meta = all.map((p) => [p.id, p.gen, p.legendary || p.mythical] as [number, number, boolean]);
  return <WhoamiHome dex={dex} meta={meta} />;
}
