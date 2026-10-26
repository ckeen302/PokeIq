import Link from "next/link";
import { ArrowRight, Compass, FlaskConical, Search, Swords, type LucideIcon } from "lucide-react";
import { HpBar } from "@/components/game/HpBar";
import { cn } from "@/lib/utils";

interface Experience {
  href: string;
  title: string;
  blurb: string;
  icon: LucideIcon;
  /** HSL triplet. */
  accent: string;
  visual: React.ReactNode;
}

const EXPERIENCES: Experience[] = [
  {
    href: "/guessr",
    title: "PokéGuessr",
    blurb: "GeoGuessr with real in-game screenshots",
    icon: Compass,
    accent: "154 68% 46%",
    visual: (
      <div className="space-y-1.5">
        <div className="flex justify-between font-pixel text-[10px] text-muted-foreground">
          <span>Round 3/5</span>
          <span className="text-success">4,812 pts</span>
        </div>
        <div className="meter">
          <div className="h-full w-[96%] bg-success shadow-[0_0_8px_hsl(var(--success))]" />
        </div>
      </div>
    ),
  },
  {
    href: "/pokedle",
    title: "Pokédle",
    blurb: "Daily guess-the-Pokémon, plus live PvP vs strangers",
    icon: Search,
    accent: "258 94% 74%",
    visual: (
      <div className="grid grid-cols-6 gap-1">
        {["bg-success", "bg-warning", "bg-shade/60", "bg-success", "bg-shade/60", "bg-warning"].map((c, i) => (
          <span key={i} className={cn("flex aspect-square items-center justify-center rounded-[3px] font-pixel text-[9px] text-black/70", c)}>
            {i === 2 ? "↑" : i === 4 ? "↓" : ""}
          </span>
        ))}
      </div>
    ),
  },
  {
    href: "/battle",
    title: "Battle",
    blurb: "Showdown engine: vs computer, or live PvP with matchmaking",
    icon: Swords,
    accent: "340 86% 60%",
    visual: (
      <div className="space-y-1">
        <HpBar value={0.24} label="FOE" />
        <HpBar value={0.81} label="YOU" />
      </div>
    ),
  },
  {
    href: "/battle/lab",
    title: "Battle Lab",
    blurb: "Simulate thousands of battles for real win odds",
    icon: FlaskConical,
    accent: "199 89% 62%",
    visual: (
      <div className="space-y-1.5">
        <div className="flex justify-between font-pixel text-[10px]">
          <span style={{ color: "var(--lab-a)" }}>A 61.8%</span>
          <span style={{ color: "var(--lab-b)" }}>38.2% B</span>
        </div>
        <div className="flex h-2.5 overflow-hidden rounded-sm">
          <span className="w-[61.8%]" style={{ background: "var(--lab-a)" }} />
          <span className="flex-1" style={{ background: "var(--lab-b)" }} />
        </div>
      </div>
    ),
  },
];

/** Short quiz names for the chips (the full titles are on the quiz pages). */

/** The four headline games, then every quiz, right under the title screen. */
export function Experiences() {
  return (
    <section aria-label="Games" className="space-y-3 sm:space-y-4">
      <ul className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4">
        {EXPERIENCES.map(({ href, title, blurb, icon: Icon, accent, visual }, i) => (
          <li
            key={href}
            className="duration-500 animate-in fade-in slide-in-from-bottom-2 fill-mode-both motion-reduce:animate-none"
            style={{ animationDelay: `${120 + i * 70}ms` }}
          >
            <Link
              href={href}
              className="group relative flex h-full flex-col overflow-hidden rounded-lg border bg-card p-3.5 transition-[border-color,transform] hover:-translate-y-0.5 hover:border-[hsl(var(--accent-c)/0.6)] motion-reduce:transition-none sm:p-5"
              style={{ "--accent-c": accent } as React.CSSProperties}
            >
              <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: `hsl(${accent})`, boxShadow: `0 0 14px hsl(${accent})` }} aria-hidden />
              <span className="flex items-center gap-2.5">
                <span className="screen flex h-9 w-9 shrink-0 items-center justify-center rounded-md sm:h-11 sm:w-11" style={{ color: `hsl(${accent})` }}>
                  <Icon className="relative z-[3] h-[18px] w-[18px] sm:h-5 sm:w-5" aria-hidden />
                </span>
                <span className="min-w-0 font-display text-[15px] font-bold uppercase leading-tight tracking-wide sm:text-xl">{title}</span>
              </span>
              <span className="mt-2 block text-[13px] leading-snug text-muted-foreground sm:text-sm">{blurb}</span>
              <span className="mt-auto hidden pt-4 sm:block" aria-hidden>
                {visual}
              </span>
              <ArrowRight className="absolute right-3 top-4 hidden h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground sm:block" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
