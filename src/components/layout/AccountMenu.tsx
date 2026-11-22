"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "@/i18n/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronRight, LogIn, LogOut, Users } from "lucide-react";
import Link from "@/components/ui/Link";
import { Avatar } from "@/components/avatar/Avatar";
import { SettingsControls } from "@/components/settings/SiteSettings";
import { signOut, useAccount } from "@/lib/account";
import { openFriends, useCommunity } from "@/lib/friends-client";
import { useProgress } from "@/lib/progress";
import { applyThemeColor, getTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * The header's avatar on desktop and tablet: opens a small panel with the
 * trainer card link, friends, the site settings (theme, sound) and sign in /
 * out. A badge on the avatar and on Friends counts the friend requests and
 * challenges waiting.
 * A disclosure, not an ARIA menu, since it holds switches: Escape, a click
 * outside, tabbing out or a new page closes it.
 */
export function AccountMenu({ className }: { className?: string }) {
  const pathname = usePathname();
  const account = useAccount();
  const progress = useProgress();
  const community = useCommunity();
  const waiting = community.requests + community.challenges.length;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const name = account.user?.username ?? (progress?.name || "Trainer");
  const signIn = account.status === "ready" && account.enabled && !account.user;
  const signedIn = account.status === "ready" && !!account.user;
  const onTrainer = pathname === "/trainer" || pathname.startsWith("/trainer/");

  // The browser chrome (mobile address bar) follows the theme.
  useEffect(() => applyThemeColor(getTheme()), []);

  // A new page closes it.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      ref={root}
      className={cn("relative", className)}
      onBlur={(e) => {
        // Tabbing out of the panel closes it.
        if (open && e.relatedTarget && !root.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Account and settings (${name})${waiting ? `, friends: ${waiting} waiting` : ""}`}
        title="Account and settings"
        onClick={() => setOpen((v) => !v)}
        data-testid="account-menu-button"
        className={cn(
          "ml-1 flex items-center gap-2 rounded-md border bg-card py-1.5 pl-2 pr-1.5 text-sm text-muted-foreground transition-colors hover:border-screen/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          (open || onTrainer) && "border-screen/60 text-foreground"
        )}
      >
        <span className="relative flex">
          <Avatar avatar={account.user?.avatar} size={22} />
          {waiting > 0 && (
            <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-pixel text-[9px] text-primary-foreground" aria-hidden data-testid="account-menu-badge">
              {waiting > 9 ? "9+" : waiting}
            </span>
          )}
        </span>
        <span className="hidden max-w-[9rem] truncate font-display font-semibold md:inline lg:hidden 2xl:inline">{name}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            id={panelId}
            role="region"
            aria-label="Account and settings"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ type: "spring", stiffness: 520, damping: 36 }}
            style={{ transformOrigin: "top right" }}
            className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-xl border border-foreground/10 bg-card text-card-foreground shadow-[0_20px_50px_-12px_hsl(var(--shade)/0.7)]"
            data-testid="account-menu"
          >
            <Link
              href="/trainer"
              className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-foreground/[0.05] focus-visible:bg-foreground/[0.05] focus-visible:outline-none"
              aria-current={onTrainer ? "page" : undefined}
              onClick={() => setOpen(false)}
              data-testid="account-menu-trainer"
            >
              <Avatar avatar={account.user?.avatar} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-[15px] font-bold leading-tight">{name}</span>
                <span className="block text-xs text-muted-foreground">Trainer card</span>
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>

            <div className="border-t border-foreground/[0.07] p-1.5">
              <button
                type="button"
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors hover:bg-foreground/[0.05] focus-visible:bg-foreground/[0.05] focus-visible:outline-none"
                onClick={() => {
                  setOpen(false);
                  trigger.current?.focus();
                  openFriends(community.requests > 0 && community.challenges.length === 0 ? "requests" : "friends");
                }}
                aria-label={waiting ? `Friends (${waiting} waiting)` : "Friends"}
                data-testid="account-menu-friends"
              >
                <Users className="h-4 w-4 text-muted-foreground" aria-hidden /> Friends
                {waiting > 0 && (
                  <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground" data-testid="account-menu-friends-badge">
                    {waiting > 9 ? "9+" : waiting}
                  </span>
                )}
              </button>
            </div>

            <div className="border-t border-foreground/[0.07] px-4 py-3">
              <div className="hud-label mb-3">Settings</div>
              <SettingsControls size="sm" testIdPrefix="account-menu" />
            </div>

            {(signIn || signedIn) && (
              <div className="border-t border-foreground/[0.07] p-1.5">
                {signIn ? (
                  <Link
                    href="/login"
                    className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors hover:bg-foreground/[0.05] focus-visible:bg-foreground/[0.05] focus-visible:outline-none"
                    onClick={() => setOpen(false)}
                    data-testid="account-menu-signin"
                  >
                    <LogIn className="h-4 w-4 text-muted-foreground" aria-hidden /> Sign in
                    <span className="ml-auto text-xs text-muted-foreground">Save your progress</span>
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors hover:bg-foreground/[0.05] focus-visible:bg-foreground/[0.05] focus-visible:outline-none"
                    onClick={() => {
                      setOpen(false);
                      trigger.current?.focus();
                      void signOut();
                    }}
                    data-testid="account-menu-signout"
                  >
                    <LogOut className="h-4 w-4 text-muted-foreground" aria-hidden /> Sign out
                  </button>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
