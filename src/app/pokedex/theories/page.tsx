import type { Metadata } from "next";
import { jsonLd, pageMetadata } from "@/lib/seo";
import { breadcrumbList } from "@/lib/structured-data";
import { DexTabs } from "@/components/pokedex/DexTabs";
import { ListHeader } from "@/components/pokedex/detail/DetailParts";
import { CaseBoard } from "@/components/theories/CaseBoard";
import { CaseExplorer } from "@/components/theories/CaseExplorer";
import { toFolder } from "@/components/theories/CaseFolder";
import { CASES } from "@/lib/theories/data";
import { SOURCE_ORDER, caseOfTheWeek } from "@/lib/theories/logic";
import { THEORIES_PATH } from "@/lib/theories/types";

export const metadata: Metadata = pageMetadata({
  title: "Pokémon Theories — Fan Theories, Urban Legends & Beta Myths, Checked",
  description:
    "Pokémon fan theories, urban legends and beta myths as case files: Gengar and Clefable, Mew under the truck, MissingNo., Lavender Town Syndrome and more, each with its evidence, its sources and a verdict: confirmed, fan theory or debunked.",
  path: THEORIES_PATH,
  socialTitle: "The case files · PokéIQ Pokédex",
});

/** The Case of the week turns over on Mondays: the page is rebuilt hourly so it picks up the new one. */
export const revalidate = 3600;

export default function TheoriesPage() {
  const featured = caseOfTheWeek(CASES, new Date());
  const sources = SOURCE_ORDER.filter((x) => CASES.some((c) => c.sources.includes(x)));
  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <ListHeader kicker="Theories & conspiracies" title="Poké" accent="dex" blurb="Pokémon theories, urban legends and beta myths, each with its evidence and a verdict." />
      <DexTabs active="theories" />
      <div className="mx-auto flex w-full max-w-[1152px] flex-col gap-6 pt-6">
        <div className="flex flex-col gap-2">
          <span className={"font-display text-[11px] font-semibold uppercase tracking-[0.2em] text-screen"}>Pokémon theories &amp; conspiracies</span>
          <h2 className="m-0 font-display text-4xl font-bold uppercase leading-none sm:text-[44px]">
            The case <span className="text-primary">files</span>
          </h2>
          <p className="m-0 text-[15px] text-muted-foreground">Fan theories, conspiracies, rumors and real glitches. Every one checked against the games.</p>
        </div>
        <CaseBoard c={featured} />
        <CaseExplorer cases={CASES.map(toFolder)} sources={sources} />
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbList([{ name: "Pokédex", path: "/pokedex" }, { name: "Theories", path: THEORIES_PATH }])) }} />
    </div>
  );
}
