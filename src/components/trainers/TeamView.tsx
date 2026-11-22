/* eslint-disable @next/next/no-img-element -- sprites come pre-sized from /api/art; item icons are tiny remote PNGs */
import Link from "@/components/ui/Link";
import { ArrowUpRight, Users } from "lucide-react";
import { artUrl } from "@/lib/pokemon/art";
import { typeColor } from "@/lib/pokemon/type-colors";
import { itemSpriteUrl } from "@/lib/dex/build";
import { VERSION_BY_KEY } from "@/lib/pokemon/encounter-types";
import { itemOf, moveName, notable, speciesOf, type TrainerGroup } from "@/lib/trainers/data";
import { formName, teamAnchor } from "@/lib/trainers/format";
import { battleLabel, formLabel, levelText, roleName, tagName } from "@/lib/trainers/i18n";
import { dexNames } from "@/lib/dex/local-names";
import { serverT } from "@/i18n/server";
import trainersNs from "@/messages/trainers";
import type { TrainerMon, TrainerTeam } from "@/lib/trainers/types";
import { TypeBadge } from "@/components/pokedex/TypeBadge";
import { TeamTabs } from "./TeamTabs";
import { TrainerAvatar } from "./TrainerAvatar";

function ItemRef({ refId, className }: { refId: string; className?: string }) {
  const t = serverT(trainersNs);
  const item = itemOf(refId);
  if (!item)
    return (
      <span className={className} title={t("team.notInList")}>
        {refId}
      </span>
    );
  return (
    <Link href={`/pokedex/items/${item.slug}`} className={`inline-flex items-center gap-1 hover:text-screen ${className ?? ""}`}>
      <img src={itemSpriteUrl(item.slug)} alt="" width={20} height={20} loading="lazy" decoding="async" className="h-5 w-5 shrink-0 [image-rendering:pixelated]" />
      {dexNames().item(item.name)}
    </Link>
  );
}

function MonCard({ m }: { m: TrainerMon }) {
  const t = serverT(trainersNs);
  const names = dexNames();
  const s = speciesOf(m.s);
  const english = m.fn ?? formName(m.s, m.f);
  const form = english && formLabel(t, english);
  return (
    <li className="relative overflow-hidden rounded-md border border-foreground/10 bg-shade/20" data-testid="trainer-mon">
      <div className="flex h-[3px]" aria-hidden>
        <span className="flex-1" style={{ background: typeColor(s?.types[0] ?? "normal") }} />
        <span className="flex-1" style={{ background: typeColor(s?.types[1] ?? s?.types[0] ?? "normal") }} />
      </div>
      <div className="flex gap-2.5 p-2.5">
        <img src={artUrl(m.s, 96)} alt="" width={56} height={56} loading="lazy" decoding="async" className="h-14 w-14 shrink-0 object-contain" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-baseline justify-between gap-2">
            {s ? (
              <Link href={`/pokemon/${s.slug}`} className="truncate font-display text-sm font-bold uppercase tracking-wide hover:text-screen">
                {names.species(s.id, s.name)}
              </Link>
            ) : (
              <span className="font-display text-sm font-bold">#{m.s}</span>
            )}
            <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{t("team.lv", { lv: m.lv })}</span>
          </div>
          {form && <div className="text-[11px] text-muted-foreground">{form}</div>}
          <div className="flex flex-wrap items-center gap-1">
            {s?.types.map((t) => (
              <TypeBadge key={t} type={t} size="sm" label={names.locale === "en" ? undefined : names.type(t[0].toUpperCase() + t.slice(1))} />
            ))}
            {m.tt && (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground" data-testid="trainer-mon-tera">
                {t("team.tera")} <TypeBadge type={m.tt.toLowerCase()} size="sm" label={names.locale === "en" ? undefined : names.type(m.tt)} />
              </span>
            )}
          </div>
          {m.ab && <div className="text-[11px] text-muted-foreground">{names.ability(m.ab)}</div>}
          {m.i && (
            <div className="text-xs">
              <span className="sr-only">{t("team.heldItem")}</span>
              <ItemRef refId={m.i} />
            </div>
          )}
        </div>
      </div>
      {m.m.length > 0 && (
        <div className="border-t border-foreground/[0.06] px-2.5 py-2">
          <ul className="grid grid-cols-2 gap-1" aria-label={t("team.moves")}>
            {m.m.map((mv, i) => (
              <li key={mv + i} className="min-w-0">
                <Link href={`/pokedex/moves/${mv}`} className="block truncate rounded-sm bg-background/40 px-1.5 py-1 text-[12px] leading-tight hover:text-screen">
                  {names.move(moveName(mv) ?? mv)}
                </Link>
              </li>
            ))}
          </ul>
          {m.d && (
            <p className="mt-1.5 text-[10px] text-muted-foreground" title={t("team.levelUpTitle")}>
              {t("team.levelUp")}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/** One team: its Pokémon, plus the items the trainer can use. */
export function TeamGrid({ team }: { team: TrainerTeam }) {
  const t = serverT(trainersNs);
  const names = dexNames();
  const items = new Map<string, number>();
  for (const i of team.items ?? []) items.set(i, (items.get(i) ?? 0) + 1);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        <span className="font-mono tabular-nums">{levelText(t, team.team)}</span>
        <span>{t(team.double ? "team.sizeDouble" : "team.size", { n: team.team.length })}</span>
        {team.ver && (
          <span className="inline-flex items-center gap-1">
            {team.ver.map((v) => (
              <span key={v} className="rounded-sm px-1.5 py-0.5 text-[10px] font-bold" style={{ background: VERSION_BY_KEY[v]?.bg, color: VERSION_BY_KEY[v]?.dark ? "#000c" : "#fff" }}>
                {t("team.only", { version: names.locale === "en" ? (VERSION_BY_KEY[v]?.name ?? v) : names.version(v) })}
              </span>
            ))}
          </span>
        )}
        {items.size > 0 && (
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{t("team.uses")}</span>
            {[...items].map(([i, n]) => (
              <span key={i} className="inline-flex items-center gap-0.5 text-foreground/90">
                <ItemRef refId={i} />
                {n > 1 && <span className="font-mono">×{n}</span>}
              </span>
            ))}
          </span>
        )}
      </div>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {team.team.map((m, i) => (
          <MonCard key={i} m={m} />
        ))}
      </ul>
    </div>
  );
}

/** A trainer as met in one place: header, and their team (or tabs between their battles). */
export function TrainerCard({ group, game }: { group: TrainerGroup; game?: string }) {
  const t = serverT(trainersNs);
  const names = dexNames();
  const n = group.n ? notable(group.n) : undefined;
  const teams = group.teams;
  return (
    <article id={teamAnchor(group.key)} className="hud scroll-mt-28 space-y-3 rounded-lg border bg-card p-3 sm:p-4" data-testid="trainer-card">
      {teams.slice(1).map((t) => (
        <span key={t.id} id={teamAnchor(t.id)} className="block scroll-mt-28" aria-hidden />
      ))}
      <header className="flex flex-wrap items-center gap-3">
        {n ? <TrainerAvatar name={n.name} type={n.type} size="sm" /> : <Users className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />}
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg font-bold uppercase leading-tight tracking-wide">
            {group.name ? (
              <>
                <span className="text-muted-foreground">{group.cls} </span>
                {group.name}
              </>
            ) : (
              group.cls
            )}
          </h3>
          {teams.length === 1 && teams[0].tag && <p className="text-xs text-primary">{tagName(t, names, teams[0].tag)}</p>}
        </div>
        {n && (
          <Link
            href={`/pokedex/trainers/notable/${n.slug}${game ? `#game-${game}` : ""}`}
            className="inline-flex items-center gap-1 rounded-sm border border-primary/40 px-2 py-1 font-pixel text-[9px] uppercase tracking-wider hover:bg-primary hover:text-primary-foreground"
          >
            {t("team.rolePage", { role: roleName(t, n.role) })} <ArrowUpRight className="h-3 w-3" aria-hidden />
          </Link>
        )}
      </header>
      {teams.length === 1 ? (
        <TeamGrid team={teams[0]} />
      ) : (
        <TeamTabs label={t("team.battles")} labels={teams.map((team, i) => battleLabel(t, names, team, i))}>
          {teams.map((team) => (
            <TeamGrid key={team.id} team={team} />
          ))}
        </TeamTabs>
      )}
    </article>
  );
}
