import type { Metadata } from "next";
import Link from "@/components/ui/Link";
import { ChevronRight } from "lucide-react";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { DexTabs } from "@/components/pokedex/DexTabs";
import { ListHeader } from "@/components/pokedex/detail/DetailParts";
import { HudHeading } from "@/components/game/HudHeading";
import { TypeBadge } from "@/components/pokedex/TypeBadge";
import { TrainerExplorer } from "@/components/trainers/TrainerExplorer";
import { TrainerAvatar } from "@/components/trainers/TrainerAvatar";
import { ROMAN, TRAINER_GAMES, TRAINER_REGIONS } from "@/lib/trainers/games";
import { ROLE_ORDER } from "@/lib/trainers/notable";
import { gameFile, notableDirectory } from "@/lib/trainers/data";
import { explorerLocal, gameName } from "@/lib/trainers/explorer-local";
import { roleHeading, roleName } from "@/lib/trainers/i18n";
import { dexNames } from "@/lib/dex/local-names";
import { serverT } from "@/i18n/server";
import { ClientMessages } from "@/i18n/ClientMessages";
import trainersNs from "@/messages/trainers";
import dexRef from "@/messages/dex-ref";
import explorerNs from "@/messages/trainers-explorer";

export function generateMetadata(): Metadata {
  const t = serverT(trainersNs);
  return pageMetadata({
    title: t("meta.title"),
    description: t("meta.description"),
    path: "/pokedex/trainers",
    image: SHARE_IMAGES.pokedex,
  });
}

export default function TrainersPage() {
  const games = TRAINER_GAMES.map((g) => {
    const f = gameFile(g.key)!;
    return { ...g, teams: f.teams.length, areas: new Set(f.teams.flatMap((t) => t.at.map((s) => s.a))).size };
  });
  const notables = notableDirectory();
  const classes = [...new Set(TRAINER_GAMES.flatMap((g) => gameFile(g.key)!.teams.map((t) => t.cls)))].sort((a, b) => a.localeCompare(b));
  const byRole = ROLE_ORDER.map((role) => ({ role, list: notables.filter((n) => n.role === role) })).filter((r) => r.list.length);
  const short = new Map(TRAINER_GAMES.map((g) => [g.key, g.short]));
  const t = serverT(trainersNs);
  const names = dexNames();
  const en = names.locale === "en";

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <ListHeader kicker={t("list.kicker")} title={serverT(dexRef)("title")} accent={serverT(dexRef)("accent")} blurb={t("list.blurb")} />
      <DexTabs active="trainers" />
      <ClientMessages namespaces={[explorerNs]}>
      <TrainerExplorer
        games={TRAINER_GAMES.map(({ key, name, short, color, regions }) => ({ key, name: en ? name : gameName(names, { key, name }), short, color, regions }))}
        notables={notables.map(({ slug, name, role, region, type, games }) => ({ slug, name, role: en ? role : roleName(t, role), region, type, games }))}
        classes={classes}
        regions={TRAINER_REGIONS}
        {...(!en && { local: explorerLocal(names) })}
      >
        <div className="space-y-10">
          <section className="space-y-4" aria-labelledby="by-game">
            <HudHeading id="by-game" index={1} title={t("list.byGame")} aside={t("list.byGameAside")} />
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="trainers-games">
              {games.map((g) => (
                <li key={g.key}>
                  <Link
                    href={`/pokedex/trainers/${g.key}`}
                    data-testid="trainers-game-card"
                    className="group flex h-full items-stretch overflow-hidden rounded-lg border bg-card transition-colors hover:border-screen/60"
                  >
                    <span className="w-1.5 shrink-0" style={{ background: g.color }} aria-hidden />
                    <span className="flex min-w-0 flex-1 items-center gap-3 p-4">
                      <span className="min-w-0 flex-1">
                        <span className="block font-display text-lg font-bold uppercase leading-tight tracking-wide group-hover:text-screen">{en ? g.name : gameName(names, g)}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {t("list.gen", { gen: names.locale === "ja" ? String(g.gen) : ROMAN[g.gen], regions: g.regions.map(names.region).join(names.locale === "ja" ? "・" : " & ") })}
                        </span>
                      </span>
                      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-6" aria-labelledby="notable">
            <HudHeading id="notable" index={2} title={t("list.notable")} aside={t("list.notableAside", { n: notables.length })} />
            {byRole.map(({ role, list }) => (
              <div key={role} className="space-y-3">
                <h3 className="hud-label">{roleHeading(t, role)}</h3>
                <ul className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4" data-testid="trainers-notables">
                  {list.map((n) => (
                    <li key={n.slug}>
                      <Link href={`/pokedex/trainers/notable/${n.slug}`} data-testid="trainers-notable-card" className="group flex h-full items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:border-screen/60">
                        <TrainerAvatar name={n.name} type={n.type} />
                        <span className="min-w-0 flex-1 space-y-1">
                          <span className="block truncate font-display text-base font-bold uppercase tracking-wide group-hover:text-screen">{n.name}</span>
                          <span className="flex flex-wrap items-center gap-1.5">
                            {n.type && <TypeBadge type={n.type.toLowerCase()} size="sm" label={names.locale === "en" ? undefined : names.type(n.type)} />}
                            <span className="text-[11px] text-muted-foreground">{names.region(n.region)}</span>
                          </span>
                          <span className="block truncate font-pixel text-[9px] uppercase tracking-wider text-muted-foreground">{n.games.map((g) => short.get(g)).join(" · ")}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        </div>
      </TrainerExplorer>
      </ClientMessages>
      <p className="pt-6 text-center text-xs text-muted-foreground">
        {t.rich("list.sources", {
          pret: (chunks) => (
            <a href="https://github.com/pret" className="underline-offset-2 hover:underline" rel="noopener" target="_blank">
              {chunks}
            </a>
          ),
          bulba: (chunks) => (
            <a href="https://bulbapedia.bulbagarden.net/" className="underline-offset-2 hover:underline" rel="noopener" target="_blank">
              {chunks}
            </a>
          ),
        })}
      </p>
    </div>
  );
}
