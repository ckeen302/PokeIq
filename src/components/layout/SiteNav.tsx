"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { BookOpen, CalendarDays, Compass, Gamepad2, Home, Search, Swords, User } from "lucide-react";
import { levelInfo, useProgress } from "@/lib/progress";
import { useAccount } from "@/lib/account";
import { cn } from "@/lib/utils";
import { MuteToggle } from "./MuteToggle";
import { ThemeToggle } from "./ThemeToggle";
import { FriendsButton } from "@/components/community/FriendsButton";

const DESKTOP_LINKS = [
  { href: "/daily", label: "Daily" },
  { href: "/iq-test", label: "IQ Test" },
  { href: "/pokedle", label: "Pokédle" },
  { href: "/guessr", label: "Guessr" },
  { href: "/atlas", label: "Atlas" },
  { href: "/play", label: "Modes" },
  { href: "/pokedex", label: "Pokédex" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/battle", label: "Battle" },
  { href: "/rooms", label: "Rooms" },
];

const MOBILE_TABS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/daily", label: "Daily", icon: CalendarDays },
  { href: "/pokedle", label: "Pokédle", icon: Search },
  { href: "/guessr", label: "Guessr", icon: Compass },
  { href: "/pokedex", label: "Pokédex", icon: BookOpen },
  { href: "/play", label: "Modes", icon: Gamepad2 },
  { href: "/battle", label: "Battle", icon: Swords },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function DesktopNav() {
  const pathname = usePathname();
  const progress = useProgress();
  const account = useAccount();
  return (
    <nav className="flex items-center gap-1">
      <div className="hidden items-center lg:flex">
        {DESKTOP_LINKS.map(({ href, label }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                // Tighter between lg and xl so every link fits on one row.
                "relative whitespace-nowrap px-2 py-2 font-display text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground transition-colors hover:text-foreground xl:px-3 xl:text-[13px] xl:tracking-[0.12em]",
                active && "text-foreground"
              )}
              aria-current={active ? "page" : undefined}
            >
              {label}
              {active && (
                <motion.span
                  layoutId="nav-active"
                  className="absolute inset-x-2 -bottom-[9px] h-[3px] bg-primary shadow-[0_0_10px_hsl(var(--primary))] xl:inset-x-3"
                  transition={{ type: "spring", stiffness: 500, damping: 38 }}
                />
              )}
            </Link>
          );
        })}
      </div>
      <FriendsButton />
      <ThemeToggle />
      <MuteToggle />
      {account.status === "ready" && account.enabled && !account.user && (
        <Link
          href="/login"
          className="hidden whitespace-nowrap px-2 font-display text-[13px] font-semibold uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground sm:block lg:hidden xl:block"
        >
          Sign in
        </Link>
      )}
      <Link
        href="/trainer"
        className={cn(
          "ml-1 flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-screen/60 hover:text-foreground",
          isActive(pathname, "/trainer") && "border-screen/60 text-foreground"
        )}
      >
        <User className="h-4 w-4" aria-hidden />
        <span className="max-w-[9rem] truncate font-display font-semibold">{account.user?.username ?? (progress?.name || "Trainer")}</span>
        {progress && progress.xp > 0 && (
          <span className="font-pixel text-[10px] text-screen">Lv{levelInfo(progress.xp).level}</span>
        )}
      </Link>
    </nav>
  );
}

export function MobileTabBar() {
  const pathname = usePathname();
  return (
    <nav
      className="glass-top fixed inset-x-0 bottom-0 z-50 grid grid-cols-7 pb-[env(safe-area-inset-bottom)] lg:hidden"
      aria-label="Primary"
    >
      {MOBILE_TABS.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "relative flex flex-col items-center gap-1 py-2.5 font-pixel text-[9px] uppercase tracking-wider text-muted-foreground transition-colors",
              active && "text-foreground"
            )}
            aria-current={active ? "page" : undefined}
          >
            {active && <span className="absolute inset-x-5 top-0 h-[3px] bg-primary shadow-[0_0_10px_hsl(var(--primary))]" aria-hidden />}
            <Icon className={cn("h-5 w-5", active && "text-primary")} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

