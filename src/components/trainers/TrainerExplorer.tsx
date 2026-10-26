"use client";

/* eslint-disable @next/next/no-img-element -- party sprites come pre-sized from /api/art */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Search, Star, X } from "lucide-react";
import { artUrl } from "@/lib/pokemon/art";
import { teamAnchor, teamTitle } from "@/lib/trainers/format";
import { cn } from "@/lib/utils";
import { TrainerAvatar } from "./TrainerAvatar";

export interface ExplorerGame {
  key: string;
  name: string;
  short: string;
  color: string;
  regions: string[];
}
export interface ExplorerNotable {
  slug: string;
  name: string;
  role: string;
  region: string;
  type?: string;
  games: string[];
}

/** [game index, area slug, area name, region, class, name, tag, notable, team id, max level, species ids] */
type Row = [number, string, string, string, string, string | null, string | null, string | null, string, number, number[]];
interface Index {
  rows: Row[];
  species: Record<string, string>;
}

const PAGE = 80;
const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

let indexPromise: Promise<Index> | null = null;
const loadIndex = () => (indexPromise ??= fetch("/pokedex/trainers/search-index.json").then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))));

export function TrainerExplorer({ games, notables, classes, regions, children }: { games: ExplorerGame[]; notables: ExplorerNotable[]; classes: string[]; regions: string[]; children: React.ReactNode }) {
  const [q, setQ] = useState("");
  const [game, setGame] = useState("");
  const [region, setRegion] = useState("");
  const [cls, setCls] = useState("");
  const [notableOnly, setNotableOnly] = useState(false);
  const [index, setIndex] = useState<Index | null>(null);
  const [error, setError] = useState(false);
  const [visible, setVisible] = useState(PAGE);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const ready = useRef(false);

  // Filters live in the query string so a search can be shared.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setQ(p.get("q") ?? "");
    setGame(p.get("game") ?? "");
    setRegion(p.get("region") ?? "");
    setCls(p.get("class") ?? "");
    setNotableOnly(p.get("notable") === "1");
    ready.current = true;
  }, []);
  useEffect(() => {
    if (!ready.current) return;
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (game) p.set("game", game);
    if (region) p.set("region", region);
    if (cls) p.set("class", cls);
    if (notableOnly) p.set("notable", "1");
    const s = p.toString();
    window.history.replaceState(null, "", s ? `?${s}` : window.location.pathname);
    setVisible(PAGE);
  }, [q, game, region, cls, notableOnly]);

  const searching = Boolean(q.trim() || game || region || cls || notableOnly);
  // The notable directory needs no download; everything else searches the full index.
  const needIndex = Boolean(q.trim() || cls || ((game || region) && !notableOnly));
  useEffect(() => {
    if (!needIndex || index) return;
    let live = true;
    loadIndex()
      .then((d) => live && setIndex(d))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [needIndex, index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== searchRef.current && !(document.activeElement instanceof HTMLInputElement)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const gameIdx = game ? games.findIndex((g) => g.key === game) : -1;
  const nq = normalize(q);

  const notableHits = useMemo(
    () =>
      notables.filter(
        (n) => (!nq || normalize(n.name).includes(nq) || normalize(n.role).includes(nq)) && (!game || n.games.includes(game)) && (!region || n.region === region)
      ),
    [notables, nq, game, region]
  );

  const rows = useMemo(() => {
    if (!index || !needIndex) return [];
    return index.rows.filter((r) => {
      if (gameIdx >= 0 && r[0] !== gameIdx) return false;
      if (region && r[3] !== region) return false;
      if (cls && r[4] !== cls) return false;
      if (notableOnly && !r[7]) return false;
      if (!nq) return true;
      const hay = normalize(`${r[4]} ${r[5] ?? ""} ${r[2]}`);
      if (hay.includes(nq)) return true;
      return r[10].some((s) => normalize(index.species[s] ?? "").startsWith(nq));
    });
  }, [index, needIndex, gameIdx, region, cls, notableOnly, nq]);

  const groups = useMemo(() => {
    const out: { key: string; game: number; area: string; areaName: string; region: string; rows: Row[] }[] = [];
    const at = new Map<string, number>();
    for (const r of rows.slice(0, visible)) {
      const k = `${r[0]}|${r[1]}`;
      let i = at.get(k);
      if (i === undefined) {
        i = out.push({ key: k, game: r[0], area: r[1], areaName: r[2], region: r[3], rows: [] }) - 1;
        at.set(k, i);
      }
      out[i].rows.push(r);
    }
    return out;
  }, [rows, visible]);

  const reset = () => {
    setQ("");
    setGame("");
    setRegion("");
    setCls("");
    setNotableOnly(false);
  };
  const select = "h-11 min-w-0 rounded-md border border-input bg-shade/40 px-3 font-display text-sm";

  return (
    <div className="space-y-6">
      <div className="sticky top-14 z-30 -mx-4 space-y-2 border-b border-foreground/5 bg-background/80 px-4 py-3 backdrop-blur-xl sm:-mx-8 sm:px-8" data-testid="trainers-filters">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            ref={searchRef}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search trainers, places or Pokémon…  ( / )"
            aria-label="Search trainers"
            data-testid="trainers-search"
            maxLength={40}
            className="h-11 w-full rounded-md border border-input bg-shade/40 pl-9 pr-9 font-display text-sm tracking-wide focus-visible:border-screen/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          />
          {q && (
            <button type="button" onClick={() => setQ("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <select value={game} onChange={(e) => setGame(e.target.value)} aria-label="Game" data-testid="trainers-game" className={select}>
            <option value="">All games</option>
            {games.map((g) => (
              <option key={g.key} value={g.key}>
                {g.name}
              </option>
            ))}
          </select>
          <select value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Region" className={select}>
            <option value="">All regions</option>
            {regions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select value={cls} onChange={(e) => setCls(e.target.value)} aria-label="Trainer class" className={cn(select, "sm:max-w-[200px]")}>
            <option value="">All classes</option>
            {classes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setNotableOnly((v) => !v)}
            aria-pressed={notableOnly}
            data-testid="trainers-notable-toggle"
            className={cn(
              "inline-flex h-11 items-center justify-center gap-1.5 rounded-md border px-3 font-display text-sm transition-colors",
              notableOnly ? "border-primary bg-primary text-primary-foreground" : "border-input bg-shade/40 text-muted-foreground hover:text-foreground"
            )}
          >
            <Star className={cn("h-4 w-4", notableOnly && "fill-current")} aria-hidden /> Notable only
          </button>
          {searching && (
            <button type="button" onClick={reset} className="col-span-2 h-9 px-2 text-left font-pixel text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground sm:col-span-1">
              Clear filters
            </button>
          )}
        </div>
      </div>

      {!searching && children}

      {searching && (
        <div className="space-y-8" data-testid="trainers-results">
          {notableHits.length > 0 && (notableOnly || nq) && (
            <section className="space-y-3" aria-label="Notable trainers">
              <h2 className="hud-label">Notable trainers · {notableHits.length}</h2>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {notableHits.map((n) => (
                  <li key={n.slug}>
                    <Link href={`/pokedex/trainers/notable/${n.slug}`} className="flex h-full items-center gap-3 rounded-lg border bg-card p-2.5 transition-colors hover:border-screen/60" data-testid="trainers-notable-hit">
                      <TrainerAvatar name={n.name} type={n.type} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate font-display text-sm font-bold uppercase tracking-wide">{n.name}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {n.role} · {n.region}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {needIndex && !index && !error && (
            <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading every trainer…
            </p>
          )}
          {error && <p className="py-8 text-center text-sm text-muted-foreground">Couldn&apos;t load the trainer list. Try again in a moment.</p>}

          {index && needIndex && (
            <section className="space-y-4" aria-label="Trainer teams">
              <h2 className="hud-label">
                {rows.length.toLocaleString("en-US")} team{rows.length === 1 ? "" : "s"}
              </h2>
              {rows.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No trainers match. Try a different name, place or Pokémon.</p>}
              {groups.map((g) => {
                const gm = games[g.game];
                return (
                  <div key={g.key} className="overflow-hidden rounded-lg border bg-card" data-testid="trainers-result-group">
                    <Link href={`/pokedex/trainers/${gm.key}/${g.area}`} className="flex items-center justify-between gap-2 border-b border-foreground/[0.07] bg-shade/30 px-3 py-2 hover:text-screen">
                      <span className="min-w-0 truncate font-display text-sm font-bold uppercase tracking-wide">{g.areaName}</span>
                      <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="h-2 w-2 rounded-full" style={{ background: gm.color }} aria-hidden />
                        {gm.name}
                      </span>
                    </Link>
                    <ul className="divide-y divide-foreground/[0.06]">
                      {g.rows.map((r) => (
                        <li key={r[8]}>
                          <Link href={`/pokedex/trainers/${gm.key}/${g.area}#${teamAnchor(r[8])}`} className="flex items-center gap-3 px-3 py-2 hover:bg-shade/30" data-testid="trainers-result">
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold">
                                {teamTitle({ cls: r[4], name: r[5] ?? undefined })}
                                {r[7] && <Star className="ml-1 inline h-3 w-3 -translate-y-px fill-primary text-primary" aria-label="Notable" />}
                              </span>
                              <span className="block truncate text-[11px] text-muted-foreground">
                                {[r[6], `Lv ${r[9]}`].filter(Boolean).join(" · ")}
                              </span>
                            </span>
                            <span className="flex shrink-0 -space-x-2" aria-hidden>
                              {r[10].slice(0, 6).map((s, i) => (
                                <img key={i} src={artUrl(s, 96)} alt="" width={28} height={28} loading="lazy" decoding="async" className="h-7 w-7 object-contain" />
                              ))}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
              {rows.length > visible && (
                <div className="flex justify-center">
                  <button type="button" onClick={() => setVisible((v) => v + PAGE)} className="rounded-md border border-primary/40 px-4 py-2 font-pixel text-[10px] uppercase tracking-wider hover:bg-primary hover:text-primary-foreground">
                    Show more ({(rows.length - visible).toLocaleString("en-US")} left)
                  </button>
                </div>
              )}
            </section>
          )}

          {!needIndex && notableHits.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No notable trainers match.</p>}
        </div>
      )}
    </div>
  );
}
