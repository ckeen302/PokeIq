"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface Me {
  user: { id: string; username: string } | null;
}

/** Header account chip: trainer name + sign out, or a Sign in link. */
export function UserMenu() {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : { user: null }))
      .then((data: Me) => {
        if (!cancelled) setMe(data);
      })
      .catch(() => {
        if (!cancelled) setMe({ user: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    // Full navigation clears any per-page state tied to the old session.
    window.location.assign("/");
  }

  if (!me) return <div className="w-16" aria-hidden />; // no layout shift

  if (!me.user) {
    return (
      <Link
        href="/login"
        className="rounded-full bg-white/5 px-3.5 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-white/10 hover:text-foreground"
      >
        Sign in
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Link
        href="/trainer"
        className="max-w-28 truncate rounded-full border border-indigo-400/30 bg-indigo-500/10 px-3 py-1.5 text-sm font-semibold text-indigo-200 transition-colors hover:bg-indigo-500/20"
        title={`Signed in as ${me.user.username}`}
      >
        {me.user.username}
      </Link>
      <button
        onClick={() => void signOut()}
        className="rounded-full px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-white/10 hover:text-foreground"
        title="Sign out"
      >
        Sign out
      </button>
    </div>
  );
}
