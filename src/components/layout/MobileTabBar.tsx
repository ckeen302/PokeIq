"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Box,
  CalendarDays,
  ChevronRight,
  Compass,
  Gamepad2,
  Grid3x3,
  Home,
  LayoutGrid,
  Menu,
  MessagesSquare,
  Moon,
  Search,
  Sun,
  Swords,
  Trophy,
  Users,
  Volume2,
  VolumeX,
  type LucideIcon,
} from "lucide-react";
import { useAccount } from "@/lib/account";
import { useProgress } from "@/lib/progress";
import { openFriends, useCommunity } from "@/lib/friends-client";
import { getTheme, setTheme, type Theme } from "@/lib/theme";
import { isMuted, onMuteChange, play, setMuted } from "@/lib/sound";
import { LAB_PATH, isLabPath } from "@/lib/lab";
import { Avatar } from "@/components/avatar/Avatar";
// Links that fetch their page on touch on a phone, not whenever they are on screen: the bar is on every page.
import Link from "@/components/ui/Link";
import { cn } from "@/lib/utils";

/** The four tabs before More: the home page and the games most people come for. */
const TABS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/guessr", label: "Guessr", icon: Compass },
  { href: "/pokedle", label: "Pokédle", icon: Search },
  { href: "/battle", label: "Battle", icon: Swords },
];

/** Everything else, in the More sheet: the other games and sections as tiles, then the community pages. */
const MORE_TILES: { href: string; label: string; icon: LucideIcon; accent: string }[] = [
  { href: "/daily", label: "Daily", icon: CalendarDays, accent: "340 86% 60%" },
  { href: "/connections", label: "Connections", icon: LayoutGrid, accent: "42 98% 60%" },
  { href: "/pikadoku", label: "Pikadoku", icon: Grid3x3, accent: "190 90% 55%" },
  { href: "/play", label: "Quizzes", icon: Gamepad2, accent: "24 95% 58%" },
  { href: "/pokedex", label: "Pokédex", icon: BookOpen, accent: "214 90% 64%" },
  { href: LAB_PATH, label: "3D Lab", icon: Box, accent: "300 75% 68%" },
];
const MORE_LINKS: { href: string; label: string; icon: LucideIcon; testId: string }[] = [
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy, testId: "more-leaderboard" },
  { href: "/rooms", label: "Chat rooms", icon: MessagesSquare, testId: "more-rooms" },
];

/** The 3D experiences (the timeline, sizes, the globe...) belong to the 3D Lab, not to the Pokédex or PokéGuessr. */
function tabActive(pathname: string, href: string) {
  if (isLabPath(pathname)) return href === LAB_PATH;
  if (href === LAB_PATH) return false;
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The phone's (and tablet's) navigation: a tab bar along the bottom with
 * Home, three games and More. More opens a sheet above the bar with every
 * other section, the community pages, the trainer card and the theme and
 * sound switches (the header keeps only the logo and the avatar on a phone).
 * Its height is --tabbar-h (globals.css).
 */
export function MobileTabBar() {
  const pathname = usePathname();
  const community = useCommunity();
  const waiting = community.requests + community.challenges.length;
  const [open, setOpen] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  // More is lit on the pages it holds (a share link or a profile lights nothing).
  const inMore = [...MORE_TILES, ...MORE_LINKS, { href: "/trainer" }, { href: "/login" }].some((t) => tabActive(pathname, t.href));

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) moreButton.current?.focus({ preventScroll: true });
  }, []);

  // A new page closes the sheet.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <MoreSheet open={open} onClose={close} pathname={pathname} waiting={waiting} />
      <nav
        className="glass-top fixed inset-x-0 bottom-0 z-50 pb-[env(safe-area-inset-bottom)] lg:hidden"
        aria-label="Primary"
        data-testid="tabbar"
      >
        <div className="mx-auto grid h-14 max-w-lg grid-cols-5 px-1">
          {TABS.map(({ href, label, icon: Icon }) => {
            const active = !open && tabActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                className={cn("tab-item", active && "tab-item-on")}
                aria-current={tabActive(pathname, href) ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                <span className="tab-pill">
                  <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.25 : 1.9} aria-hidden />
                </span>
                {label}
              </Link>
            );
          })}
          <button
            ref={moreButton}
            type="button"
            className={cn("tab-item", (open || inMore) && "tab-item-on")}
            aria-expanded={open}
            aria-controls="more-sheet"
            aria-label={waiting ? `More (${waiting} waiting)` : "More"}
            onClick={() => (open ? close(false) : setOpen(true))}
            data-testid="tab-more"
          >
            <span className="tab-pill relative">
              <Menu className="h-[22px] w-[22px]" strokeWidth={open || inMore ? 2.25 : 1.9} aria-hidden />
              {waiting > 0 && <span className="absolute right-2.5 top-0.5 h-2 w-2 rounded-full bg-primary ring-2 ring-background" aria-hidden />}
            </span>
            More
          </button>
        </div>
      </nav>
    </>
  );
}

function MoreSheet({ open, onClose, pathname, waiting }: { open: boolean; onClose: (refocus?: boolean) => void; pathname: string; waiting: number }) {
  const sheet = useRef<HTMLDivElement>(null);
  const account = useAccount();
  const progress = useProgress();
  const community = useCommunity();
  const [theme, setThemeState] = useState<Theme>("dark");
  const [muted, setMutedState] = useState(true);
  const [drag, setDrag] = useState(0);
  const dragFrom = useRef<number | null>(null);

  useEffect(() => onMuteChange(setMutedState), []);

  useEffect(() => {
    if (!open) return;
    setThemeState(getTheme());
    setMutedState(isMuted());
    setDrag(0);
    // The page behind holds still while the sheet is up.
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    sheet.current?.querySelector<HTMLElement>("a,button")?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      root.style.overflow = before;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const name = account.user?.username ?? (progress?.name || "Trainer");
  const signIn = account.status === "ready" && account.enabled && !account.user;

  return (
    <div className="lg:hidden" data-open={open ? "true" : "false"}>
      <div
        className={cn("fixed inset-0 z-[45] bg-black/50 transition-opacity duration-200 motion-reduce:transition-none", open ? "opacity-100" : "pointer-events-none opacity-0")}
        onClick={() => onClose(false)}
        aria-hidden
      />
      <div
        ref={sheet}
        id="more-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="More"
        inert={!open}
        className={cn(
          "fixed inset-x-0 z-[46] mx-auto max-w-lg rounded-t-3xl border-t border-foreground/[0.08] bg-background px-5 pb-5 pt-2 shadow-[0_-20px_60px_rgb(0_0_0/0.45)] transition-[transform,visibility] duration-300 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none",
          open ? "visible" : "invisible translate-y-[calc(100%+var(--tabbar-h))]"
        )}
        style={{ bottom: "var(--tabbar-h)", ...(open && drag > 0 ? { transform: `translateY(${drag}px)`, transitionDuration: "0ms" } : null) }}
        data-testid="more-sheet"
        onPointerDown={(e) => {
          if (e.pointerType === "mouse" || (e.target as HTMLElement).closest("a,button")) return;
          dragFrom.current = e.clientY;
        }}
        onPointerMove={(e) => {
          if (dragFrom.current === null) return;
          setDrag(Math.max(0, e.clientY - dragFrom.current));
        }}
        onPointerUp={() => {
          if (dragFrom.current === null) return;
          dragFrom.current = null;
          if (drag > 70) onClose(false);
          setDrag(0);
        }}
        onPointerCancel={() => {
          dragFrom.current = null;
          setDrag(0);
        }}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-foreground/20" aria-hidden />

        <ul className="grid grid-cols-3 gap-2.5">
          {MORE_TILES.map(({ href, label, icon: Icon, accent }) => {
            const active = tabActive(pathname, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={cn(
                    "flex h-[88px] flex-col items-center justify-center gap-2 rounded-2xl bg-foreground/[0.04] text-[13px] font-semibold text-foreground transition-colors active:bg-foreground/[0.09]",
                    active && "bg-foreground/[0.08] ring-1 ring-inset ring-foreground/15"
                  )}
                  aria-current={active ? "page" : undefined}
                  onClick={() => onClose(false)}
                >
                  <Icon className="h-6 w-6" style={{ color: `hsl(${accent})` }} aria-hidden />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>

        <ul className="mt-4 divide-y divide-foreground/[0.06] overflow-hidden rounded-2xl bg-foreground/[0.04]">
          {MORE_LINKS.map(({ href, label, icon: Icon, testId }) => (
            <li key={href}>
              <Link href={href} className="sheet-row" onClick={() => onClose(false)} aria-current={tabActive(pathname, href) ? "page" : undefined} data-testid={testId}>
                <Icon className="h-5 w-5 text-muted-foreground" aria-hidden />
                <span className="flex-1">{label}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground/60" aria-hidden />
              </Link>
            </li>
          ))}
          <li>
            <button
              type="button"
              className="sheet-row w-full text-left"
              onClick={() => {
                onClose(false);
                openFriends(community.requests > 0 && community.challenges.length === 0 ? "requests" : "friends");
              }}
              data-testid="more-friends"
            >
              <Users className="h-5 w-5 text-muted-foreground" aria-hidden />
              <span className="flex-1">Friends</span>
              {waiting > 0 ? (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">{waiting > 9 ? "9+" : waiting}</span>
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground/60" aria-hidden />
              )}
            </button>
          </li>
        </ul>

        <div className="mt-4 flex items-center gap-2">
          <Link
            href={signIn ? "/login" : "/trainer"}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl bg-foreground/[0.04] px-3 py-2.5 transition-colors active:bg-foreground/[0.09]"
            onClick={() => onClose(false)}
            data-testid="more-trainer"
          >
            <Avatar avatar={account.user?.avatar} size={32} />
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-semibold leading-tight">{signIn ? "Sign in" : name}</span>
              <span className="block text-xs text-muted-foreground">{signIn ? "Save your progress" : "Trainer card"}</span>
            </span>
          </Link>
          <button
            type="button"
            className="flex h-[56px] w-[56px] shrink-0 items-center justify-center rounded-2xl bg-foreground/[0.04] text-foreground transition-colors active:bg-foreground/[0.09]"
            onClick={() => {
              const next = getTheme() === "dark" ? "light" : "dark";
              setTheme(next);
              setThemeState(next);
              play("click");
            }}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            data-testid="more-theme"
          >
            {theme === "dark" ? <Sun className="h-5 w-5" aria-hidden /> : <Moon className="h-5 w-5" aria-hidden />}
          </button>
          <button
            type="button"
            className="flex h-[56px] w-[56px] shrink-0 items-center justify-center rounded-2xl bg-foreground/[0.04] text-foreground transition-colors active:bg-foreground/[0.09]"
            onClick={() => {
              const next = !isMuted();
              setMuted(next);
              setMutedState(next);
              if (!next) play("click");
            }}
            aria-label={muted ? "Turn sound on" : "Turn sound off"}
            aria-pressed={!muted}
            data-testid="more-sound"
          >
            {muted ? <VolumeX className="h-5 w-5" aria-hidden /> : <Volume2 className="h-5 w-5" aria-hidden />}
          </button>
        </div>
      </div>
    </div>
  );
}
