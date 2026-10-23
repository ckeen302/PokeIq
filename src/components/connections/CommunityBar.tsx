"use client";

import { creatorPath } from "@/lib/connections/social";
import { useCallback, useEffect, useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { dlePlayerId } from "@/lib/dle-player";
import { customPath, type CustomMeta } from "@/lib/connections/custom";
import { ShareButton } from "@/components/share/ShareButton";
import { cn } from "@/lib/utils";

/**
 * A community puzzle's byline, its thumbs up/down (one vote per player, a
 * second tap on the same one takes it back) and a share link. It knows only
 * what /api/connections/custom/<id> sends: the title, creator and votes,
 * never the groups.
 */
export function CommunityBar({ id }: { id: string }) {
  const [meta, setMeta] = useState<CustomMeta | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/connections/custom/${id}?player=${encodeURIComponent(dlePlayerId())}`)
      .then((r) => r.json().then((b) => ({ ok: r.ok, b })))
      .then(({ ok, b }) => {
        if (!live) return;
        if (ok) setMeta(b as CustomMeta);
        else setError(b.error ?? "Couldn't load this puzzle's details.");
      })
      .catch(() => live && setError("Couldn't load this puzzle's details."));
    return () => {
      live = false;
    };
  }, [id]);

  const vote = useCallback(
    async (value: 1 | -1) => {
      if (!meta) return;
      setError(null);
      const next = meta.myVote === value ? 0 : value;
      try {
        const res = await fetch(`/api/connections/custom/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: next, player: dlePlayerId() }) });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Couldn't save your vote.");
        setMeta({ ...meta, up: body.up, down: body.down, myVote: body.myVote });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save your vote.");
      }
    },
    [id, meta]
  );

  if (!meta) return error ? <p className="text-center text-sm text-destructive">{error}</p> : null;
  const button = (value: 1 | -1, Icon: typeof ThumbsUp, count: number, label: string) => (
    <button
      type="button"
      onClick={() => void vote(value)}
      aria-pressed={meta.myVote === value}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        meta.myVote === value ? "border-primary bg-primary text-primary-foreground" : "border-foreground/15 bg-card text-muted-foreground hover:text-foreground"
      )}
    >
      <Icon className="h-4 w-4" aria-hidden /> {count}
    </button>
  );
  return (
    <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 rounded-md border border-foreground/15 bg-card px-4 py-3" data-testid="conn-community-bar">
      <div className="min-w-0">
        <p className="truncate font-display text-lg font-bold">{meta.title ?? "Untitled puzzle"}</p>
        <p className="text-xs text-muted-foreground">
          by{" "}
          {meta.creator ? (
            <a href={creatorPath(meta.creator)} className="text-primary hover:underline" data-testid="community-creator-link">
              {meta.creator}
            </a>
          ) : (
            "a trainer"
          )}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {button(1, ThumbsUp, meta.up, "Thumbs up")}
        {button(-1, ThumbsDown, meta.down, "Thumbs down")}
        <ShareButton getText={() => `Try this PokéConnections puzzle: ${typeof window === "undefined" ? "" : window.location.origin}${customPath(id)}`} label="Share link" kind="connections" variant="outline" />
      </div>
      {error && (
        <p className="w-full text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
