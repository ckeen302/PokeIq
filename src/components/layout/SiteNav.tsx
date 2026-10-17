"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, CalendarDays, Gamepad2, Home, Search, User } from "lucide-react";
import { levelInfo, useProgress } from "@/lib/progress";
import { cn } from "@/lib/utils";
import { MuteToggle } from "./MuteToggle";

const DESKTOP_LINKS = [
  { href: "/daily", label: "Daily" },
  { href: "/iq-test", label: "IQ Test" },
  { href: "/pokedle", label: "Pokédle" },
  { href: "/play", label: "Modes" },
  { href: "/pokedex", label: "Pokédex" },
  { href: "/leaderboard", label: "Leaderboard" },
];

const MOBILE_TABS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/daily", label: "Daily", icon: CalendarDays },
  { href: "/pokedle", label: "Pokédle", icon: Search },
  { href: "/pokedex", label: "Pokédex", icon: BookOpen },
  { href: "/play", label: "Modes", icon: Gamepad2 },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function DesktopNav() {
  const pathname = usePathname();
  const progress = useProgress();
  return (
    <nav className="flex items-center gap-1 text-sm">
      <div className="hidden items-center gap-1 md:flex">
        {DESKTOP_LINKS.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "rounded-full px-3 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
              isActive(pathname, href) && "bg-accent text-foreground"
            )}
          >
            {label}
          </Link>
        ))}
      </div>
      <MuteToggle />
      <Link
        href="/trainer"
        className={cn(
          "ml-1 flex items-center gap-2 rounded-full border px-3 py-1.5 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground",
          isActive(pathname, "/trainer") && "border-primary/50 text-foreground"
        )}
      >
        <User className="h-4 w-4" aria-hidden />
        <span className="max-w-[9rem] truncate">{progress?.name || "Trainer"}</span>
        {progress && progress.xp > 0 && (
          <span className="rounded-full bg-primary/15 px-1.5 text-xs font-bold text-primary">Lv {levelInfo(progress.xp).level}</span>
        )}
      </Link>
    </nav>
  );
}

export function MobileTabBar() {
  const pathname = usePathname();
  return (
    <nav
      className="glass-top fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="Primary"
    >
      {MOBILE_TABS.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-muted-foreground transition-colors",
              active && "text-primary"
            )}
            aria-current={active ? "page" : undefined}
          >
            <Icon className="h-5 w-5" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

