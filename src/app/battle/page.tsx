import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { ArrowRight, Bot, Calculator, Castle, Factory, FlaskConical, UserSearch, Users, type LucideIcon } from "lucide-react";
import { GameInfo } from "@/components/seo/GameInfo";
import { HudHeading } from "@/components/game/HudHeading";
import { BATTLE_FORMATS, BATTLE_FORMAT_IDS } from "@/lib/battle/formats";
import { BattleHome, type NewsItem } from "@/components/battle/BattleHome";
import NEWS from "@/data/news.json";

export const metadata: Metadata = pageMetadata({
  title: "Pokémon Battle Simulator: PvP, vs Computer & Team Builder",
  description:
    "A Pokémon battle simulator on Pokémon Showdown's own engine: find an opponent for a live PvP battle in seconds, battle a friend through a link, or battle the computer. Plus a team builder checked against Showdown's rules, the Smogon damage calculator and the Battle Lab.",
  path: "/battle",
});

const LIVE: { href: string; icon: LucideIcon; title: string; blurb: string; points: string[]; wide?: boolean }[] = [
  {
    href: "/battle/play",
    icon: Bot,
    title: "Battle vs Computer",
    blurb: "Real battles on Pokémon Showdown's engine against a computer opponent that plays to win.",
    points: ["Random Battle, Random Doubles or your saved team", "Easy, Normal and Hard opponents", "Showdown's move animations, Tera and all"],
  },
  {
    href: "/battle/play?vs=anyone",
    icon: UserSearch,
    title: "Battle Online",
    blurb: "Find an opponent searching for the same format and battle live, or send a friend an invite link. Anyone with the link can watch.",
    points: ["Matchmaking in every format, random teams or your own", "Showdown's turn timer; each side sees only what it should", "Rematch with one press"],
  },
  {
    href: "/battle/teams",
    icon: Users,
    title: "Team Builder",
    blurb: "Six slots, every format's learnsets and Pokémon Showdown's own legality check, live as you build.",
    points: ["8 formats from Gen 9 OU to Gen 3 OU", "EVs, IVs, natures and live stats", "Showdown import / export, random teams"],
  },
  {
    href: "/battle/calc",
    icon: Calculator,
    title: "Damage Calc",
    blurb: "The Smogon damage calculator: every move's damage range, KO chance and the full description line.",
    points: ["Boosts, status, Tera and current HP", "Weather, terrain, screens, spread moves", "Load sets straight from your teams"],
  },
  {
    href: "/battle/lab",
    icon: FlaskConical,
    title: "Battle Lab",
    blurb: "Who wins, and how often? Set up any matchup and let Showdown's engine play it thousands of times in your browser.",
    points: ["Any Pokémon, level, item and move, Gen 1 to 9", "Smart, Greedy, Random or Scripted play per side", "Win % with a 95% confidence interval, KOs, crits, replays"],
    wide: true,
  },
];

/** The Battle Frontier: runs against the computer. `href` null: not open yet. */
const FRONTIER: { href: string | null; icon: LucideIcon; title: string; blurb: string; points: string[] }[] = [
  {
    href: "/battle/factory",
    icon: Factory,
    title: "Battle Factory",
    blurb: "No team needed: rent six Pokémon from Showdown's Battle Factory sets and see how long a streak you can build.",
    points: ["Level 100 Factory or level 50 BSS Factory", "Trade for your opponent's Pokémon after each win", "Or battle live: both trainers rent a team"],
  },
  {
    href: "/battle/tower",
    icon: Castle,
    title: "Battle Tower",
    blurb: "Your team against a climbing streak of computer trainers under Flat Rules. How far can you go?",
    points: ["Level 50, bring six, pick three", "Saved, built or quick teams, checked by Showdown", "The Tower Tycoon every seventh battle"],
  },
];

export default function BattlePage() {
  return (
    <div className="mx-auto max-w-6xl space-y-12">
      <BattleHome news={NEWS as NewsItem[]} />

      <section className="space-y-5">
        <HudHeading index={1} title="Battles and tools" aside="Live" />
        <div className="grid gap-4 md:grid-cols-2">
          {LIVE.map(({ href, icon: Icon, title, blurb, points, wide }) => (
            <Link key={href} href={href} className={`menu-item hud group relative block rounded-lg border bg-card p-6 hover:border-screen/50${wide ? " md:col-span-2" : ""}`}>
              <div className="flex items-start gap-4">
                <span className="screen flex h-14 w-14 shrink-0 items-center justify-center rounded-md text-screen">
                  <Icon className="relative z-[3] h-6 w-6" aria-hidden />
                </span>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-xl font-bold uppercase tracking-wide">{title}</span>
                    <span className="hud-label flex items-center gap-1.5 text-success">
                      <span className="led h-1.5 w-1.5 text-success" /> Live
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{blurb}</p>
                  <ul className="space-y-1 pt-1 text-sm">
                    {points.map((p) => (
                      <li key={p} className="flex items-center gap-2">
                        <span className="font-pixel text-[9px] text-primary">▶</span> {p}
                      </li>
                    ))}
                  </ul>
                </div>
                <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" aria-hidden />
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-5">
        <HudHeading index={2} title="Battle Frontier" aside="Streaks against the computer" />
        <div className="grid gap-4 md:grid-cols-2" data-testid="battle-frontier">
          {FRONTIER.map(({ href, icon: Icon, title, blurb, points }) =>
            href ? (
              <Link key={title} href={href} className="menu-item hud group relative block rounded-lg border bg-card p-6 hover:border-screen/50">
                <div className="flex items-start gap-4">
                  <span className="screen flex h-14 w-14 shrink-0 items-center justify-center rounded-md text-screen">
                    <Icon className="relative z-[3] h-6 w-6" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <span className="font-display text-xl font-bold uppercase tracking-wide">{title}</span>
                    <p className="text-sm text-muted-foreground">{blurb}</p>
                    <ul className="space-y-1 pt-1 text-sm">
                      {points.map((p) => (
                        <li key={p} className="flex items-center gap-2">
                          <span className="font-pixel text-[9px] text-primary">▶</span> {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" aria-hidden />
                </div>
              </Link>
            ) : (
              <div key={title} className="relative space-y-2 rounded-lg border border-dashed border-foreground/15 bg-card/50 p-5">
                <span className="hud-label absolute right-3 top-3 rounded-sm border border-warning/40 px-1.5 py-1 text-warning">Soon</span>
                <Icon className="h-6 w-6 text-muted-foreground" aria-hidden />
                <h3 className="font-display text-base font-bold uppercase tracking-wide">{title}</h3>
                <p className="text-sm text-muted-foreground">{blurb}</p>
              </div>
            )
          )}
        </div>
      </section>

      <section className="space-y-5">
        <HudHeading index={3} title="Formats" aside="Pokémon Showdown's rules for each" />
        <div className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {BATTLE_FORMAT_IDS.map((id) => {
            const f = BATTLE_FORMATS[id];
            return (
              <div key={id} className="space-y-1 bg-card p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-display font-bold uppercase tracking-wide">{f.name}</span>
                  <span className="hud-label text-screen">{f.gameType}</span>
                </div>
                <p className="text-xs text-muted-foreground">{f.blurb}</p>
              </div>
            );
          })}
        </div>
      </section>
      <GameInfo
        path="/battle"
        name="Pokémon battles"
        description="A free Pokémon battle simulator on Pokémon Showdown's engine: battle the computer, a friend or a stranger, with a team builder, damage calculator and Battle Lab."
        intro="This Pokémon battle simulator runs on Pokémon Showdown's own engine: battle the computer, a friend through a link, or an opponent found online."
        steps={[
          "Pick a mode: battle the computer, battle online, or open the Battle Frontier.",
          "Use a random team or build your own in the team builder.",
          "Choose your moves each turn and win the battle.",
          "Check matchups with the damage calculator or simulate thousands of battles in the Battle Lab.",
        ]}
        faqs={[
          { q: "Is this a Pokémon battle simulator?", a: "Yes. Battles run on Pokémon Showdown's engine, against the computer or live against another player." },
          { q: "Can I build my own team?", a: "Yes, the team builder checks your team against Pokémon Showdown's rules for each format." },
          { q: "Is there a Pokémon damage calculator?", a: "Yes, the damage calculator is powered by the Smogon damage calculator." },
          { q: "What is the Battle Lab?", a: "It lets you set up any matchup and have the engine play it thousands of times to estimate win odds." },
        ]}
      />
    </div>
  );
}
