"use client";

import Link from "@/components/ui/Link";
import { usePathname } from "@/i18n/navigation";
import { useLayoutEffect, useRef } from "react";
import {
  MessagesSquare,
  Trophy,
} from "lucide-react";
import { useAccount } from "@/lib/account";
import { Avatar } from "@/components/avatar/Avatar";
import { cn } from "@/lib/utils";
import { LAB_PATH, isLabPath } from "@/lib/lab";
import { AccountMenu } from "./AccountMenu";
import { SoundShortcut } from "./SoundShortcut";
import { useT } from "@/i18n/client";
import nav from "@/messages/nav";
import { springEasing } from "@/lib/spring";
import { SERVED_PATH_ATTR, useServedPathname } from "@/i18n/served-path";

const DESKTOP_LINKS: { href: string; label: keyof typeof nav.en.links; wideOnly?: boolean }[] = [
  { href: "/pokedle", label: "wordle" },
  { href: "/pokeconnections", label: "connections" },
  // Only on wide screens, like the 3D Lab: the row is full at 1024px (the home page and footer link it too).
  { href: "/pikadoku", label: "sudoku", wideOnly: true },
  { href: "/pokeguessr", label: "guessr" },
  { href: "/battle", label: "battle" },
  { href: "/quiz", label: "quizzes" },
  { href: "/pokedex", label: "pokedex" },
  // Only on wide screens, where the leaderboard link was: the row is full at 1024px (the footer links it too).
  // The leaderboard is the trophy among the header's icons.
  { href: LAB_PATH, label: "lab", wideOnly: true },
  // The Tools tab (the Shiny Pokémon Maker): wide screens only, like the 3D Lab (the row is full at 1024px; the phone's More sheet has it).
  { href: "/tools", label: "tools", wideOnly: true },
];

function isActive(pathname: string, href: string) {
  // The 3D experiences (the timeline, sizes, the globe...) belong to the 3D Lab tab, not to the Pokédex or PokéGuessr.
  if (href === LAB_PATH || isLabPath(pathname)) return href === LAB_PATH && isLabPath(pathname);
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** Where the active tab's bar was drawn as it left (for the next tab's bar to slide from), cleared once that commit is done. */
let leftFrom: DOMRect | null = null;
const SLIDE = { stiffness: 500, damping: 38 };

/**
 * The bar under the active tab. On a change of tab it slides from the old tab to the new one with a spring
 * (what framer-motion's shared layout did, without loading the library on every page): the new bar starts
 * where the old one was and eases into place, its width scaling from the old one's.
 */
function ActiveBar({ className }: { className: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const from = leftFrom;
    leftFrom = null;
    if (el && from && from.width > 0 && typeof el.animate === "function") {
      const to = el.getBoundingClientRect();
      if (to.width > 0 && (Math.abs(from.left - to.left) > 0.5 || Math.abs(from.width - to.width) > 0.5)) {
        const { easing, duration } = springEasing(SLIDE);
        el.animate(
          [
            { transformOrigin: "0 0", transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scaleX(${from.width / to.width})` },
            { transformOrigin: "0 0", transform: "none" },
          ],
          { duration, easing }
        );
      }
    }
    return () => {
      if (!el?.isConnected) return;
      leftFrom = el.getBoundingClientRect();
      // Only the bar mounted in the same commit slides from here: a later one (after a page with no active tab) just appears.
      requestAnimationFrame(() => (leftFrom = null));
    };
  }, []);
  return <span ref={ref} className={className} />;
}

export function DesktopNav() {
  const pathname = usePathname();
  const account = useAccount();
  const t = useT(nav);
  const served = { [SERVED_PATH_ATTR]: useServedPathname() };
  return (
    // `contents`: the links and the actions sit in the header's grid, so the links are centred on the page itself.
    // It also tells the browser which path the HTML was rendered for (see served-path).
    <nav className="contents" {...served}>
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
                {t(`links.${label}`)}
                {active && (
                  <ActiveBar className="absolute inset-x-3 -bottom-[9px] h-[3px] bg-primary shadow-[0_0_10px_hsl(var(--primary))] xl:inset-x-3 2xl:inset-x-4" />
                )}
              </Link>
            );
          })}
        </div>
      </div>
      {/* The header keeps chat, the leaderboard and the avatar; friends, the theme and the sound live in the avatar's menu. */}
      <div className="flex items-center gap-1 justify-self-end max-[399px]:gap-0">
        <Link
          href="/rooms"
          aria-label={t("links.rooms")}
          title={t("links.rooms")}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground max-md:hidden",
            isActive(pathname, "/rooms") && "text-foreground",
          )}
        >
          <MessagesSquare className="h-4 w-4" aria-hidden />
        </Link>
        <Link
          href="/leaderboard"
          aria-label={t("links.leaderboard")}
          title={t("links.leaderboard")}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground max-md:hidden",
            isActive(pathname, "/leaderboard") && "text-foreground",
          )}
          aria-current={isActive(pathname, "/leaderboard") ? "page" : undefined}
          data-testid="nav-leaderboard"
        >
          <Trophy className="h-4 w-4" aria-hidden />
        </Link>
        <SoundShortcut />
        {account.status === "ready" && account.enabled && !account.user && (
          <Link
            href="/login"
            className="hidden whitespace-nowrap px-2 font-display text-[13px] font-semibold uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground sm:block lg:hidden"
          >
            {t("signIn")}
          </Link>
        )}
        {/* Phones: the avatar leads straight to the trainer card (the More sheet holds the settings). */}
        <Link
          href="/trainer"
          aria-label={t("yourProfile")}
          className="-mr-1 flex items-center rounded-full border border-transparent p-1.5 text-muted-foreground transition-colors hover:text-foreground md:hidden"
          aria-current={isActive(pathname, "/trainer") ? "page" : undefined}
        >
          <Avatar avatar={account.user?.avatar} size={22} className="!h-7 !w-7" />
        </Link>
        <AccountMenu className="max-md:hidden" />
      </div>
    </nav>
  );
}

export { MobileTabBar } from "./MobileTabBar";
