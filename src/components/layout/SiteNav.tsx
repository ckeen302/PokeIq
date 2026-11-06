"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  MessagesSquare,
  Trophy,
} from "lucide-react";
import { useProgress } from "@/lib/progress";
import { useAccount } from "@/lib/account";
import { Avatar } from "@/components/avatar/Avatar";
import { cn } from "@/lib/utils";
import { LAB_PATH, isLabPath } from "@/lib/lab";
import { MuteToggle } from "./MuteToggle";
import { ThemeToggle } from "./ThemeToggle";
import { FriendsButton } from "@/components/community/FriendsButton";

const DESKTOP_LINKS: { href: string; label: string; wideOnly?: boolean }[] = [
  { href: "/pokedle", label: "Pokédle" },
  { href: "/connections", label: "Connections" },
  // Only on wide screens, like the 3D Lab: the row is full at 1024px (the home page and footer link it too).
  { href: "/pikadoku", label: "Pikadoku", wideOnly: true },
  { href: "/guessr", label: "Guessr" },
  { href: "/battle", label: "Battle" },
  { href: "/play", label: "Quizzes" },
  { href: "/pokedex", label: "Pokédex" },
  // Only on wide screens, where the leaderboard link was: the row is full at 1024px (the footer links it too).
  // The leaderboard is the trophy among the header's icons.
  { href: LAB_PATH, label: "3D Lab", wideOnly: true },
];

function isActive(pathname: string, href: string) {
  // The 3D experiences (the timeline, sizes, the globe...) belong to the 3D Lab tab, not to the Pokédex or PokéGuessr.
  if (href === LAB_PATH || isLabPath(pathname)) return href === LAB_PATH && isLabPath(pathname);
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
      <div className="flex items-center gap-1 justify-self-end max-[399px]:gap-0">
        <Link
          href="/rooms"
          aria-label="Chat rooms"
          title="Chat rooms"
          className={cn(
            "rounded-md p-2 text-muted-foreground transition-colors hover:text-foreground max-md:hidden",
            isActive(pathname, "/rooms") && "text-foreground",
          )}
        >
          <MessagesSquare className="h-5 w-5" aria-hidden />
        </Link>
        <FriendsButton className="max-md:hidden" />
        <Link
          href="/leaderboard"
          aria-label="Leaderboard"
          title="Leaderboard"
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground max-md:hidden",
            isActive(pathname, "/leaderboard") && "text-foreground",
          )}
          aria-current={isActive(pathname, "/leaderboard") ? "page" : undefined}
          data-testid="nav-leaderboard"
        >
          <Trophy className="h-4 w-4" aria-hidden />
        </Link>
        <ThemeToggle className="max-md:hidden" />
        <MuteToggle className="max-md:hidden" />
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
          aria-label="Your trainer profile"
          className={cn(
            "ml-1 flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 sm:px-3 text-sm text-muted-foreground transition-colors hover:border-screen/60 hover:text-foreground max-md:-mr-1 max-md:rounded-full max-md:border-transparent max-md:bg-transparent max-md:p-1.5",
            isActive(pathname, "/trainer") &&
              "border-screen/60 text-foreground",
          )}
        >
          <Avatar avatar={account.user?.avatar} size={22} className="max-md:!h-7 max-md:!w-7" />
          <span className="hidden max-w-[4rem] truncate font-display font-semibold min-[420px]:inline sm:max-w-[9rem] lg:hidden 2xl:inline max-md:!hidden">
            {account.user?.username ?? (progress?.name || "Trainer")}
          </span>
        </Link>
      </div>
    </nav>
  );
}

export { MobileTabBar } from "./MobileTabBar";
