"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Copy, Lightbulb, Plus, RefreshCw, X } from "lucide-react";
import { artUrl } from "@/lib/pokemon/art";
import { dlePlayerId } from "@/lib/dle-player";
import { getProgress } from "@/lib/progress";
import type { LinkOption, Suggestion } from "@/lib/server/connections-suggest";
import { CUSTOM_GROUP_NAME_MAX, CUSTOM_TITLE_MAX, customPath, type CustomCheckResponse } from "@/lib/connections/custom";
import { CONN_GROUPS, CONN_GROUP_SIZE, CONN_LEVELS, type ConnLevel, type ConnTile } from "@/lib/connections/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * /connections/create: pick sixteen Pokémon, split them into four named,
 * coloured groups, and publish a short link that plays like a practice
 * puzzle. Counts and duplicates are blocked here and again on the server;
 * the server also warns, from the same categories the dailies use, when a
 * Pokémon fits another group's link too.
 */

interface DraftGroup {
  name: string;
  level: ConnLevel;
  members: ConnTile[];
}

const emptyGroups = (): DraftGroup[] => CONN_LEVELS.map((_, i) => ({ name: "", level: i as ConnLevel, members: [] }));

export function CreatePuzzle() {
  const [groups, setGroups] = useState<DraftGroup[]>(emptyGroups);
  const [active, setActive] = useState(0);
  const [title, setTitle] = useState("");
  const [creator, setCreator] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ConnTile[]>([]);
  const [check, setCheck] = useState<CustomCheckResponse | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const checkRef = useRef(0);
  // "Suggest a group" and the live overlap warnings.
  const [linkQuery, setLinkQuery] = useState("");
  const [links, setLinks] = useState<LinkOption[]>([]);
  const [link, setLink] = useState<LinkOption | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [seed, setSeed] = useState(0);
  const [live, setLive] = useState<string[]>([]);
  const suggest = useCallback(
    async (l: LinkOption, nextSeed: number) => {
      const res = await fetch("/api/connections/custom/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "suggest", link: l.id, group: active, seed: nextSeed, groups: groups.map((g) => ({ name: g.name, members: g.members.map((m) => m.id) })) }),
      }).catch(() => null);
      setSuggestion(res?.ok ? ((await res.json()) as Suggestion) : null);
    },
    [active, groups]
  );

  useEffect(() => {
    setCreator(getProgress().name ?? "");
  }, []);

  const used = useMemo(() => new Set(groups.flatMap((g) => g.members.map((m) => m.id))), [groups]);
  const total = used.size;
  const complete = groups.every((g) => g.members.length === CONN_GROUP_SIZE);
  const colours = new Set(groups.map((g) => g.level));

  // Search as the player types.
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      fetch(`/api/connections/custom?q=${encodeURIComponent(query.trim())}`)
        .then((r) => r.json())
        .then((b) => setResults((b.results as ConnTile[]) ?? []))
        .catch(() => setResults([]));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  // Links matching what the creator types in the suggest box.
  useEffect(() => {
    if (linkQuery.trim().length < 2) {
      setLinks([]);
      return;
    }
    const timer = window.setTimeout(() => {
      fetch("/api/connections/custom/suggest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "links", q: linkQuery.trim() }) })
        .then((r) => r.json())
        .then((b) => setLinks((b.links as LinkOption[]) ?? []))
        .catch(() => setLinks([]));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [linkQuery]);

  // Overlap warnings, live: as soon as a group has three, any Pokémon elsewhere that also fits its link is flagged.
  useEffect(() => {
    if (!groups.some((g) => g.members.length >= 2)) {
      setLive([]);
      return;
    }
    const timer = window.setTimeout(() => {
      fetch("/api/connections/custom/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "overlap", groups: groups.map((g) => ({ name: g.name, members: g.members.map((m) => m.id) })) }),
      })
        .then((r) => r.json())
        .then((b) => setLive((b.warnings as string[]) ?? []))
        .catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [groups]);

  // The live check once all sixteen are in: names, colours and tiles that fit another group.
  useEffect(() => {
    setCheck(null);
    if (!complete) return;
    const id = ++checkRef.current;
    const timer = window.setTimeout(() => {
      fetch("/api/connections/custom/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, groups: groups.map((g) => ({ name: g.name, level: g.level, members: g.members.map((m) => m.id) })) }),
      })
        .then((r) => r.json())
        .then((b) => id === checkRef.current && b.errors && setCheck(b as CustomCheckResponse))
        .catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [complete, groups, title]);

  const add = useCallback(
    (tile: ConnTile) => {
      setGroups((gs) => {
        if (gs.some((g) => g.members.some((m) => m.id === tile.id))) return gs;
        // The chosen group, or the first one with room.
        const at = gs[active].members.length < CONN_GROUP_SIZE ? active : gs.findIndex((g) => g.members.length < CONN_GROUP_SIZE);
        if (at < 0) return gs;
        return gs.map((g, i) => (i === at ? { ...g, members: [...g.members, tile] } : g));
      });
      setQuery("");
      setResults([]);
    },
    [active]
  );
  const patch = (i: number, p: Partial<DraftGroup>) => setGroups((gs) => gs.map((g, j) => (j === i ? { ...g, ...p } : g)));
  const remove = (i: number, id: number) => patch(i, { members: groups[i].members.filter((m) => m.id !== id) });

  const blocked = [
    ...(!complete ? [`Pick ${CONN_GROUPS * CONN_GROUP_SIZE} Pokémon: ${total} so far.`] : []),
    ...(colours.size !== CONN_GROUPS ? ["Give each group its own colour."] : []),
    ...(check?.errors ?? []),
  ];

  async function publish() {
    setPublishing(true);
    setError(null);
    try {
      const res = await fetch("/api/connections/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          groups: groups.map((g) => ({ name: g.name, level: g.level, members: g.members.map((m) => m.id) })),
          ...(creator.trim() && { name: creator.trim() }),
          player: dlePlayerId(),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Couldn't publish.");
      setPublished(body.id as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't publish.");
    } finally {
      setPublishing(false);
    }
  }

  if (published) {
    const url = `${typeof window === "undefined" ? "" : window.location.origin}${customPath(published)}`;
    return (
      <div className="mx-auto max-w-xl space-y-4 text-center" data-testid="create-done">
        <h1 className="font-display text-3xl font-bold uppercase">Published</h1>
        <p className="text-sm text-muted-foreground">Share this link. It plays like a practice puzzle, and only you know the answers.</p>
        <p className="break-all rounded-md border border-foreground/15 bg-card px-3 py-2 font-mono text-sm" data-testid="create-link">
          {url}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            variant="outline"
            onClick={() => {
              void navigator.clipboard?.writeText(url).then(() => setCopied(true));
            }}
          >
            {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />} {copied ? "Copied" : "Copy link"}
          </Button>
          <a href={customPath(published)} className="inline-flex h-10 items-center rounded-md bg-primary px-4 font-display text-sm font-semibold uppercase text-primary-foreground">
            Play it
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-2 text-center">
        <p className="hud-label text-screen">PokéConnections · Create</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight">Make a puzzle</h1>
        <p className="text-sm text-muted-foreground">Pick sixteen Pokémon, split them into four groups of four, name each group and give it a colour.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="hud-label">Title (optional)</span>
          <input value={title} maxLength={CUSTOM_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} className="h-10 w-full rounded-md border border-foreground/15 bg-card px-3" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="hud-label">Your name (optional)</span>
          <input value={creator} maxLength={24} onChange={(e) => setCreator(e.target.value)} className="h-10 w-full rounded-md border border-foreground/15 bg-card px-3" />
        </label>
      </div>

      <div className="relative space-y-1">
        <label htmlFor="create-search" className="hud-label">
          Add a Pokémon to {groups[active].name.trim() || `group ${active + 1}`}
        </label>
        <input
          id="create-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name…"
          autoComplete="off"
          className="h-11 w-full rounded-md border border-foreground/15 bg-card px-3"
          data-testid="create-search"
        />
        {results.length > 0 && (
          <ul className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-md border border-foreground/15 bg-card shadow-lg" role="listbox">
            {results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  disabled={used.has(r.id)}
                  onClick={() => add(r)}
                  className="flex w-full items-center gap-3 px-3 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-40"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={artUrl(r.id, 96)} alt="" className="h-8 w-8 object-contain" />
                  {r.name}
                  {used.has(r.id) ? <span className="ml-auto text-xs text-muted-foreground">already in</span> : <Plus className="ml-auto h-4 w-4" aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <section className="space-y-2 rounded-md border border-dashed border-foreground/20 p-3" data-testid="create-suggest">
        <label htmlFor="create-link" className="hud-label flex items-center gap-1.5">
          <Lightbulb className="h-3.5 w-3.5" aria-hidden /> Suggest a group
        </label>
        <input
          id="create-link"
          value={linkQuery}
          onChange={(e) => {
            setLinkQuery(e.target.value);
            setLink(null);
            setSuggestion(null);
          }}
          placeholder="A link: an ability, type, move, colour… (try “levitate”)"
          autoComplete="off"
          className="h-10 w-full rounded-md border border-foreground/15 bg-card px-3 text-sm"
          data-testid="create-link-input"
        />
        {!link && links.length > 0 && (
          <ul className="max-h-48 overflow-auto rounded-md border border-foreground/15 bg-card text-sm" data-testid="create-links">
            {links.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  className="w-full px-3 py-1.5 text-left hover:bg-accent"
                  onClick={() => {
                    setLink(l);
                    setLinkQuery(l.label);
                    setSeed(0);
                    void suggest(l, 0);
                  }}
                >
                  {l.label}
                </button>
              </li>
            ))}
          </ul>
        )}
        {link && suggestion && (
          <div className="space-y-2 text-sm" data-testid="create-suggestion">
            <p className="text-muted-foreground">
              {suggestion.tiles.length ? `Four that fit “${suggestion.link.label}” and nothing else in your puzzle` : "Nothing left that fits without clashing."}
              {suggestion.short && suggestion.tiles.length > 0 && ` (only ${suggestion.tiles.length} found)`}
            </p>
            <ul className="flex flex-wrap gap-2">
              {suggestion.tiles.map((t) => (
                <li key={t.id} className="flex items-center gap-1 rounded-md border border-foreground/15 bg-card py-1 pl-1 pr-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={artUrl(t.id, 96)} alt="" className="h-8 w-8 object-contain" />
                  {t.name}
                </li>
              ))}
            </ul>
            {suggestion.notes.map((n) => (
              <p key={n} className="text-xs text-amber-600 dark:text-amber-400">
                {n}
              </p>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={!suggestion.tiles.length}
                onClick={() => {
                  suggestion.tiles.forEach((t) => add(t));
                  if (!groups[active].name.trim()) patch(active, { name: suggestion.link.label.slice(0, CUSTOM_GROUP_NAME_MAX) });
                  setSuggestion(null);
                  setLink(null);
                  setLinkQuery("");
                }}
                data-testid="create-suggest-add"
              >
                Add to {groups[active].name.trim() || `group ${active + 1}`}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setSeed(seed + 1);
                  void suggest(link, seed + 1);
                }}
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Another four
              </Button>
            </div>
          </div>
        )}
      </section>

      <div className="space-y-3">
        {groups.map((g, i) => {
          const lv = CONN_LEVELS[g.level];
          return (
            <div
              key={i}
              className={cn("space-y-2 rounded-md border-2 p-3", active === i ? "border-primary" : "border-foreground/10")}
              onClick={() => setActive(i)}
              data-testid={`create-group-${i}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <input
                  aria-label={`Group ${i + 1} name`}
                  value={g.name}
                  maxLength={CUSTOM_GROUP_NAME_MAX}
                  onChange={(e) => patch(i, { name: e.target.value })}
                  onFocus={() => setActive(i)}
                  placeholder={`Group ${i + 1}: what links them?`}
                  className="h-9 min-w-0 flex-1 rounded-md border border-foreground/15 bg-card px-3 text-sm"
                />
                <select
                  aria-label={`Group ${i + 1} colour`}
                  value={g.level}
                  onChange={(e) => patch(i, { level: Number(e.target.value) as ConnLevel })}
                  className="h-9 rounded-md border border-foreground/15 px-2 text-sm"
                  style={{ background: lv.hex, color: "#17142b" }}
                >
                  {CONN_LEVELS.map((l, n) => (
                    <option key={l.name} value={n}>
                      {l.symbol} {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <ul className="flex min-h-12 flex-wrap gap-2">
                {g.members.map((m) => (
                  <li key={m.id} className="flex items-center gap-1 rounded-md border border-foreground/15 bg-card py-1 pl-1 pr-2 text-sm">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={artUrl(m.id, 96)} alt="" className="h-8 w-8 object-contain" />
                    {m.name}
                    <button type="button" onClick={() => remove(i, m.id)} aria-label={`Remove ${m.name}`} className="ml-1 text-muted-foreground hover:text-foreground">
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </li>
                ))}
                <li className="self-center text-xs text-muted-foreground">
                  {g.members.length} of {CONN_GROUP_SIZE}
                </li>
              </ul>
            </div>
          );
        })}
      </div>

      {live.length > 0 && (
        <div className="space-y-1 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm" data-testid="create-warnings">
          <p className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="h-4 w-4" aria-hidden /> Worth a second look (you can still publish)
          </p>
          <ul className="list-disc pl-5">
            {live.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {blocked.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground" data-testid="create-blocked">
          {blocked.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button size="lg" className="w-full" disabled={publishing || blocked.length > 0 || !check} onClick={() => void publish()} data-testid="create-publish">
        {publishing ? "Publishing…" : "Publish"}
      </Button>
    </div>
  );
}
