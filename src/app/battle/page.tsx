import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { ArrowRight, Bot, Calculator, Castle, Eye, Factory, FlaskConical, Radio, UserSearch, Users, type LucideIcon } from "lucide-react";
import { HudHeading } from "@/components/game/HudHeading";
import { HpBar } from "@/components/game/HpBar";
import { BATTLE_FORMATS, BATTLE_FORMAT_IDS } from "@/lib/battle/formats";

export const metadata: Metadata = pageMetadata({
  title: "Pokémon Battles Online — PvP, vs Computer & Team Builder",
  description:
    "Battle Pokémon online on Pokémon Showdown's own engine: find an opponent for a live PvP battle in seconds, battle a friend through a link, or battle the computer. Plus a team builder checked against Showdown's rules, the Smogon damage calculator and the Battle Lab.",
  path: "/battle",
});

const SPRITES = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown";

/** The three ways into a battle, biggest first. */
const BATTLE_NOW: { href: string; icon: LucideIcon; label: string; blurb: string; primary?: boolean }[] = [
  { href: "/battle/play", icon: Bot, label: "Battle now", blurb: "vs the computer", primary: true },
  { href: "/battle/play?vs=anyone", icon: UserSearch, label: "Find an opponent", blurb: "live, matched in seconds" },
  { href: "/battle/play?vs=friend", icon: Radio, label: "Battle a friend", blurb: "send an invite link" },
];

const TOOLS: { href: string; icon: LucideIcon; label: string }[] = [
  { href: "/battle/teams", icon: Users, label: "Build a team" },
  { href: "/battle/calc", icon: Calculator, label: "Damage calc" },
  { href: "/battle/lab", icon: FlaskConical, label: "Battle Lab" },
  { href: "/battle/watch", icon: Eye, label: "Watch live" },
];

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
    <div className="mx-auto max-w-6xl space-y-14">
      {/* Title screen */}
      <section className="grid items-center gap-10 pt-2 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-6">
          <p className="hud-label flex items-center gap-2 text-screen">
            <span className="led h-1.5 w-1.5 animate-blink text-screen" /> Battle unit · Pokémon Showdown rules
          </p>
          <h1 className="font-display text-5xl font-bold uppercase leading-[0.95] tracking-tight sm:text-7xl">
            Battle anyone.
            <br />
            <span className="text-primary [text-shadow:0_0_30px_hsl(var(--primary)/0.45)]">Right now.</span>
          </h1>
          <p className="max-w-xl text-base text-muted-foreground sm:text-lg">
            Real Pokémon battles on Pokémon Showdown&apos;s own engine: against the computer, a trainer searching right now, or a
            friend through a link. Random teams, or the team you build here.
          </p>
          <div className="grid gap-3 sm:grid-cols-3" data-testid="battle-now">
            {BATTLE_NOW.map(({ href, icon: Icon, label, blurb, primary }) => (
              <Link
                key={href}
                href={href}
                className={
                  primary
                    ? "flex flex-col items-start gap-1 rounded-md bg-primary px-4 py-3 text-primary-foreground shadow-[0_4px_0_hsl(var(--primary-shadow))] transition-transform hover:-translate-y-0.5"
                    : "flex flex-col items-start gap-1 rounded-md border bg-card px-4 py-3 shadow-[0_3px_0_hsl(var(--border))] transition-colors hover:border-screen/60"
                }
              >
                <span className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wider">
                  <Icon className="h-4 w-4" aria-hidden /> {label}
                </span>
                <span className={primary ? "text-xs text-primary-foreground/80" : "text-xs text-muted-foreground"}>{blurb}</span>
              </Link>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="hud-label">Tools</span>
            {TOOLS.map(({ href, icon: Icon, label }) => (
              <Link key={href} href={href} className="inline-flex items-center gap-1.5 font-display text-xs font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground">
                <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
              </Link>
            ))}
          </div>
        </div>
        <BattleScene />
      </section>

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
    </div>
  );
}

/** A Gen 4-style battle screen: what the calc says about Garchomp's Earthquake into Heatran. */
function BattleScene() {
  return (
    <div className="dark-scope mx-auto w-full max-w-[460px] select-none" aria-hidden>
      <div className="rounded-[18px] border-2 border-black/60 bg-gradient-to-b from-[hsl(256_52%_30%)] to-[hsl(260_52%_16%)] p-3 shadow-[0_24px_60px_-18px_hsl(var(--screen)/0.55),inset_0_2px_0_hsl(258_80%_75%/0.35)]">
        <div className="screen relative aspect-[4/3] overflow-hidden rounded-lg bg-[linear-gradient(180deg,hsl(258_60%_22%)_0%,hsl(262_45%_14%)_55%,hsl(250_45%_9%)_100%)]">
          {/* Platforms */}
          <span className="absolute right-[6%] top-[38%] h-[13%] w-[44%] rounded-[50%] bg-[radial-gradient(closest-side,hsl(var(--screen)/0.35),transparent)]" />
          <span className="absolute bottom-[14%] left-[2%] h-[15%] w-[52%] rounded-[50%] bg-[radial-gradient(closest-side,hsl(var(--primary)/0.3),transparent)]" />
          {/* eslint-disable-next-line @next/next/no-img-element -- animated sprite */}
          <img src={`${SPRITES}/485.gif`} alt="" className="absolute right-[16%] top-[13%] z-[1] h-[32%] object-contain [image-rendering:pixelated]" />
          {/* eslint-disable-next-line @next/next/no-img-element -- animated sprite */}
          <img src={`${SPRITES}/back/445.gif`} alt="" className="absolute bottom-[17%] left-[12%] z-[1] h-[40%] object-contain [image-rendering:pixelated]" />

          {/* Foe HP box */}
          <div className="absolute left-[5%] top-[7%] z-[3] w-[44%] rounded-md border border-white/15 bg-black/55 px-2.5 py-1.5 backdrop-blur">
            <div className="flex items-baseline justify-between font-pixel text-[10px] text-white">
              <span>HEATRAN</span>
              <span className="text-white/70">Lv100</span>
            </div>
            <HpBar value={0.18} label="HP" className="mt-1" />
          </div>
          {/* Player HP box */}
          <div className="absolute bottom-[28%] right-[5%] z-[3] w-[44%] rounded-md border border-white/15 bg-black/55 px-2.5 py-1.5 backdrop-blur">
            <div className="flex items-baseline justify-between font-pixel text-[10px] text-white">
              <span>GARCHOMP</span>
              <span className="text-white/70">Lv100</span>
            </div>
            <HpBar value={0.86} label="HP" className="mt-1" />
            <div className="mt-1 text-right font-pixel text-[9px] text-white/70">307/357</div>
          </div>

          {/* Text box */}
          <div className="absolute inset-x-[3%] bottom-[3%] z-[3] rounded-md border-2 border-white/70 bg-[hsl(250_45%_8%/0.92)] px-3 py-2 font-pixel text-[10px] leading-relaxed text-white">
            <p>
              EARTHQUAKE <span className="text-white/60">vs</span> HEATRAN: <span className="text-warning">161.6 – 190.6%</span>
            </p>
            <p className="text-success">▶ guaranteed OHKO</p>
          </div>
        </div>
      </div>
    </div>
  );
}
