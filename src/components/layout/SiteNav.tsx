"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  BookOpen,
  CalendarDays,
  Compass,
  Gamepad2,
  Home,
  MessagesSquare,
  Search,
  Swords,
} from "lucide-react";
import { levelInfo, useProgress } from "@/lib/progress";
import { useAccount } from "@/lib/account";
import { Avatar } from "@/components/avatar/Avatar";
import { cn } from "@/lib/utils";
import { MuteToggle } from "./MuteToggle";
import { ThemeToggle } from "./ThemeToggle";
import { FriendsButton } from "@/components/community/FriendsButton";

const DESKTOP_LINKS: { href: string; label: string; wideOnly?: boolean }[] = [
  { href: "/pokedle", label: "Pokédle" },
  { href: "/connections", label: "Connections" },
  // Only on wide screens, like the leaderboard: the row is full at 1024px (the home page and footer link it too).
  { href: "/pikadoku", label: "Pikadoku", wideOnly: true },
  { href: "/guessr", label: "Guessr" },
  { href: "/battle", label: "Battle" },
  { href: "/play", label: "Quizzes" },
  { href: "/pokedex", label: "Pokédex" },
  // Only on wide screens: with PokéConnections the row is too long for 1024px (the footer links it too).
  { href: "/leaderboard", label: "Leaderboard", wideOnly: true },
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
    // `contents`: the links and the actions sit in the header's grid, so the links are centred on the page itself.
    <nav className="contents">
      <div className="flex justify-center">
        <div className="hidden items-center lg:flex">
          {DESKTOP_LINKS.map(({ href, label, wideOnly }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  // Tighter between lg and xl so every link fits on one row.
                  "relative whitespace-nowrap px-2 py-2 font-display text-[13px] font-semibold uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground xl:px-2.5 xl:tracking-[0.06em] 2xl:px-4 2xl:tracking-[0.12em]",
                  active && "text-foreground",
                  wideOnly && "hidden xl:block",
                )}
                aria-current={active ? "page" : undefined}
              >
                {label}
                {active && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-x-3 -bottom-[9px] h-[3px] bg-primary shadow-[0_0_10px_hsl(var(--primary))] xl:inset-x-3 2xl:inset-x-4"
                    transition={{ type: "spring", stiffness: 500, damping: 38 }}
                  />
                )}
              </Link>
            );
          })}
        </div>
      </div>
      <div className="flex items-center gap-1 justify-self-end">
        <Link
          href="/rooms"
          aria-label="Chat rooms"
          title="Chat rooms"
          className={cn(
            "rounded-md p-2 text-muted-foreground transition-colors hover:text-foreground",
            isActive(pathname, "/rooms") && "text-foreground",
          )}
        >
          <MessagesSquare className="h-5 w-5" aria-hidden />
        </Link>
        <FriendsButton />
        <ThemeToggle />
        <MuteToggle />
        {account.status === "ready" && account.enabled && !account.user && (
          <Link
            href="/login"
            className="hidden whitespace-nowrap px-2 font-display text-[13px] font-semibold uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground sm:block lg:hidden"
          >
            Sign in
          </Link>
        )}
        <Link
          href="/trainer"
          className={cn(
            "ml-1 flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 sm:px-3 text-sm text-muted-foreground transition-colors hover:border-screen/60 hover:text-foreground",
            isActive(pathname, "/trainer") &&
              "border-screen/60 text-foreground",
          )}
        >
          <Avatar avatar={account.user?.avatar} size={22} />
          <span className="max-w-[4rem] truncate font-display font-semibold sm:max-w-[9rem] lg:hidden 2xl:inline">
            {account.user?.username ?? (progress?.name || "Trainer")}
          </span>
          {progress && progress.xp > 0 && (
            <span className="hidden font-pixel text-[10px] text-screen sm:inline">
              Lv{levelInfo(progress.xp).level}
            </span>
          )}
        </Link>
      </div>
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
              active && "text-foreground",
            )}
            aria-current={active ? "page" : undefined}
          >
            {active && (
              <span
                className="absolute inset-x-5 top-0 h-[3px] bg-primary shadow-[0_0_10px_hsl(var(--primary))]"
                aria-hidden
              />
            )}
            <Icon
              className={cn("h-5 w-5", active && "text-primary")}
              aria-hidden
            />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
