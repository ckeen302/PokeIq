"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Loader2, Search, User } from "lucide-react";
import { USER_QUERY_RE, type UserHit } from "@/lib/community";

/** Find a user: account names starting with what's typed, each linking to their profile. */
export function UserSearch({ initial = "" }: { initial?: string }) {
  const [q, setQ] = useState(initial);
  const [hits, setHits] = useState<UserHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = q.trim();
  const valid = USER_QUERY_RE.test(query);

  useEffect(() => {
    if (!valid) {
      setHits(null);
      return;
    }
    const ctrl = new AbortController();
    // Wait for a pause in typing: one request per name, not per key.
    const id = window.setTimeout(async () => {
      setBusy(true);
      try {
        const res = await fetch(`/api/users?q=${encodeURIComponent(query.toLowerCase())}`, { signal: ctrl.signal });
        const data = (await res.json().catch(() => ({}))) as { users?: UserHit[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Search isn't working right now.");
        setHits(data.users ?? []);
        setError(null);
      } catch (err) {
        if (!ctrl.signal.aborted) setError(err instanceof Error ? err.message : "Search isn't working right now.");
      } finally {
        if (!ctrl.signal.aborted) setBusy(false);
      }
    }, 300);
    return () => {
      ctrl.abort();
      window.clearTimeout(id);
    };
  }, [query, valid]);

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={20}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          aria-label="Trainer name"
          placeholder="Start typing a trainer name…"
          className="h-14 w-full rounded-lg border border-input bg-card pl-11 pr-11 font-display text-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="user-search"
        />
        {busy && <Loader2 className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />}
      </div>
      {query && !valid && <p className="text-sm text-muted-foreground">Type at least two letters, numbers, _ or -.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {hits && valid && (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card" data-testid="user-results">
          {hits.length === 0 ? (
            <li className="p-4 text-sm text-muted-foreground">No trainer names start with &ldquo;{query}&rdquo;.</li>
          ) : (
            hits.map((u) => (
              <li key={u.username}>
                <Link href={`/u/${encodeURIComponent(u.username)}`} className="group flex items-center gap-3 px-4 py-3 hover:bg-accent">
                  <User className="h-4 w-4 text-primary" aria-hidden />
                  <span className="flex-1 font-display font-bold">{u.username}</span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" aria-hidden />
                </Link>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
