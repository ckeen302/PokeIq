"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Compass, Loader2, Maximize2, Minus, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { createAtlas, loadAtlas, type AtlasData, type AtlasEngine, type AtlasPlace, type AtlasRegion } from "./atlas-engine";

type Card = { place: AtlasPlace } | { region: AtlasRegion } | { miss: string } | null;

const MAIN = ["Kanto", "Johto", "Hoenn", "Sinnoh", "Unova", "Kalos", "Alola", "Galar", "Paldea"];
/** The PokéGuessr map for a region: its own, Galar's for the DLC, otherwise the world. */
const GUESSR_MAP: Record<string, string> = { "Isle of Armor": "galar", "Crown Tundra": "galar" };
const guessrMap = (region: string) => GUESSR_MAP[region] ?? (MAIN.includes(region) ? region.toLowerCase() : "world");

const KIND_LABEL: Record<AtlasPlace["kind"], string> = { route: "Route", landmark: "Landmark", town: "Town / City" };

export function WorldAtlas({ src }: { src: string }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engine = useRef<AtlasEngine | null>(null);
  const [atlas, setAtlas] = useState<AtlasData | null>(null);
  const [failed, setFailed] = useState(false);
  const [card, setCard] = useState<Card>(null);
  const [chip, setChip] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [zoom, setZoom] = useState("World");

  useEffect(() => {
    loadAtlas()
      .then(setAtlas)
      .catch(() => setFailed(true));
  }, []);

  // Search: regions, places ("Route 1 · Kanto") and what's inside them ("Silph Co. · Saffron City").
  const names = new Map<string, { place?: AtlasPlace; region?: AtlasRegion }>();
  for (const r of atlas?.regions ?? []) names.set(r.name, { region: r });
  for (const p of atlas?.places ?? []) names.set(`${p.name} · ${p.region}`, { place: p });
  for (const p of atlas?.places ?? []) for (const b of p.inside ?? []) if (!names.has(`${b} · ${p.name}`)) names.set(`${b} · ${p.name}`, { place: p });

  function showPlace(place: AtlasPlace) {
    setCard({ place });
    engine.current?.setSelected(place);
  }
  function showRegion(region: AtlasRegion) {
    setCard({ region });
    engine.current?.setSelected(null);
  }

  function find(q: string) {
    const text = q.trim().toLowerCase();
    if (!text) return;
    const keys = [...names.keys()];
    const key =
      keys.find((k) => k.toLowerCase() === text) ??
      keys.find((k) => k.toLowerCase().startsWith(text)) ??
      keys.find((k) => k.toLowerCase().includes(text));
    const hit = key ? names.get(key) : undefined;
    if (hit?.place) {
      const place = hit.place;
      void engine.current?.flyTo(place.x, place.y, "place").then(() => showPlace(place));
    } else if (hit?.region) {
      void engine.current?.flyTo(hit.region.x, hit.region.y, "region");
      showRegion(hit.region);
    } else setCard({ miss: q.trim() });
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!atlas || !canvas || !stage) return;
    const e = createAtlas(canvas, stage, atlas, src, {
      onPick: (pick) => {
        if (!pick) {
          setCard(null);
          e.setSelected(null);
        } else if ("place" in pick) {
          setCard({ place: pick.place });
          e.setSelected(pick.place);
        } else {
          setCard({ region: pick.region });
          e.setSelected(null);
        }
      },
      onZoom: setZoom,
    });
    engine.current = e;
    // /atlas?q=Saffron City jumps straight to a place (PokéGuessr links here).
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) {
      setQuery(q);
      requestAnimationFrame(() => find(q));
    }
    return () => {
      e.destroy();
      engine.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- set up once the data is in
  }, [atlas, src]);

  const chips = (atlas?.regions ?? []).filter((r) => r.chip !== false).sort((a, b) => a.tier - b.tier);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="hud-label text-screen">Every mainline region · one map</p>
          <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">
            World <span className="text-primary">Atlas</span>
          </h1>
          <Link href="/guessr/globe" className="inline-block font-display text-xs font-bold uppercase tracking-wider text-screen hover:underline">
            View it as a 3D globe →
          </Link>
        </div>
        <form
          role="search"
          className="flex w-full max-w-md"
          onSubmit={(e) => {
            e.preventDefault();
            find(query);
          }}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            list="atlas-places"
            placeholder="Search a region, town, route or landmark"
            aria-label="Search the map"
            autoComplete="off"
            className="h-10 min-w-0 flex-1 rounded-l-md border border-r-0 border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <datalist id="atlas-places">
            {[...names.keys()].sort().map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <button
            type="submit"
            className="flex h-10 items-center gap-1.5 rounded-r-md bg-primary px-4 font-display text-xs font-bold uppercase tracking-wider text-primary-foreground"
          >
            <Search className="h-4 w-4" aria-hidden /> Go
          </button>
        </form>
      </div>

      <nav className="flex flex-wrap gap-1.5" aria-label="Regions">
        {chips.map((r, i) => (
          <span key={r.name} className="contents">
            {i > 0 && chips[i - 1].tier === 1 && r.tier !== 1 && <span className="mx-1 w-px self-stretch bg-border" aria-hidden />}
            <button
              type="button"
              aria-pressed={chip === r.name}
              onClick={() => {
                setChip(r.name);
                void engine.current?.flyTo(r.x, r.y, "region");
                showRegion(r);
              }}
              className={cn(
                "rounded-md border px-3 py-1.5 font-display text-xs font-semibold uppercase tracking-wider transition-colors",
                chip === r.name ? "border-screen bg-screen/15 text-foreground" : "bg-card hover:border-screen/50 hover:text-foreground",
                r.tier === 1 ? "text-foreground/90" : "text-muted-foreground"
              )}
            >
              {r.name}
            </button>
          </span>
        ))}
      </nav>

      <div ref={stageRef} className="relative h-[calc(100vh-17rem)] min-h-[460px] overflow-hidden rounded-lg border-2 border-foreground/15 bg-[#165c96]">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full cursor-grab touch-none"
          role="img"
          aria-label="Map of the Pokémon world with every region. Use the search or the region buttons to jump to a place."
        />
        {!atlas && (
          <div className="absolute inset-0 flex items-center justify-center text-white/80">
            {failed ? "Couldn't load the atlas. Try reloading." : <Loader2 className="h-6 w-6 animate-spin" aria-label="Loading the atlas" />}
          </div>
        )}

        <div className="pointer-events-none absolute right-3 top-3 rounded-md border border-white/15 bg-black/55 px-2.5 py-1.5 text-right font-pixel text-[10px] uppercase leading-relaxed tracking-wider text-white/70 backdrop-blur">
          <div>
            Zoom <span className="text-white">{zoom}</span>
          </div>
          <div className="flex justify-end gap-2.5">
            <span className="flex items-center gap-1">
              <i className="inline-block h-2 w-2 rounded-sm bg-[#e2475b]" /> Cities
            </span>
            <span className="flex items-center gap-1">
              <i className="inline-block h-2 w-2 rounded-sm bg-[#4d7ee8]" /> Towns
            </span>
          </div>
        </div>

        {card && (
          <aside
            aria-live="polite"
            className="absolute bottom-3 left-3 max-h-[46%] w-[min(22rem,calc(100%-1.5rem))] overflow-auto rounded-lg border border-white/15 bg-[hsl(250_45%_6%/0.9)] p-4 text-white shadow-2xl backdrop-blur"
          >
            <button
              type="button"
              aria-label="Close"
              className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded text-white/60 hover:text-white"
              onClick={() => {
                setCard(null);
                engine.current?.setSelected(null);
              }}
            >
              <X className="h-4 w-4" />
            </button>
            <CardBody card={card} places={atlas?.places ?? []} />
          </aside>
        )}

        <div className="absolute bottom-3 right-3 grid gap-1.5">
          {[
            { label: "Zoom in", icon: <Plus className="h-4 w-4" />, act: () => engine.current?.zoomBy(1.6) },
            { label: "Zoom out", icon: <Minus className="h-4 w-4" />, act: () => engine.current?.zoomBy(1 / 1.6) },
            {
              label: "Show the whole world",
              icon: <Maximize2 className="h-3.5 w-3.5" />,
              act: () => atlas && void engine.current?.flyTo(atlas.W / 2, atlas.H / 2, "world"),
            },
          ].map((b) => (
            <button
              key={b.label}
              type="button"
              onClick={b.act}
              aria-label={b.label}
              title={b.label}
              className="flex h-9 w-9 items-center justify-center rounded-md bg-black/55 text-white backdrop-blur transition-colors hover:bg-black/75"
            >
              {b.icon}
            </button>
          ))}
        </div>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Scroll to zoom, drag to explore, click a place for details. Every region is drawn at the same scale from the games&apos; own town
        maps and laid out like the real places it&apos;s based on.
      </p>
    </div>
  );
}

function CardBody({ card, places }: { card: NonNullable<Card>; places: AtlasPlace[] }) {
  if ("miss" in card) {
    return (
      <>
        <h2 className="pr-6 font-display text-xl font-bold uppercase">No match</h2>
        <p className="mt-1 text-sm text-white/70">
          Nothing called &ldquo;{card.miss}&rdquo;. Try a region, town, route or landmark, like Saffron City, Route 24 or Paldea.
        </p>
      </>
    );
  }
  if ("region" in card) {
    const r = card.region;
    const mine = places.filter((p) => p.region === r.name);
    const routes = mine.filter((p) => p.kind === "route").length;
    return (
      <>
        <p className="font-pixel text-[10px] uppercase tracking-wider text-white/60">
          {MAIN.includes(r.name) ? "Main series region" : r.tier === 2 ? "DLC or side area" : `Part of ${r.parent ?? "a region"}`}
        </p>
        <h2 className="mt-1 pr-6 font-display text-2xl font-bold uppercase">{r.name}</h2>
        {mine.length > 0 && (
          <p className="mt-1 text-sm text-white/70">
            {mine.length - routes} towns and landmarks{routes ? ` plus ${routes} routes` : ""}, laid out like the game&apos;s own map. Zoom in for
            every name.
          </p>
        )}
        <GuessrLink region={r.parent ?? r.name} />
      </>
    );
  }
  const p = card.place;
  return (
    <>
      <p className="font-pixel text-[10px] uppercase tracking-wider text-white/60">
        {p.region} · {KIND_LABEL[p.kind]}
      </p>
      <h2 className="mt-1 pr-6 font-display text-2xl font-bold uppercase leading-tight">{p.name}</h2>
      {p.inside && (
        <>
          <p className="mt-2 text-sm text-white/70">Places here</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {p.inside.map((b) => (
              <li key={b} className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-xs">
                {b}
              </li>
            ))}
          </ul>
        </>
      )}
      <span
        className={cn(
          "mt-3 inline-block rounded px-1.5 py-1 font-pixel text-[10px] uppercase tracking-wider",
          p.exact ? "bg-success/20 text-success" : "bg-warning/15 text-warning"
        )}
      >
        {p.exact ? (p.source ? `Exact · ${p.source}` : "Exact · from the game's own map") : "Approximate · no official highlight"}
      </span>
      <GuessrLink region={p.region} />
    </>
  );
}

function GuessrLink({ region }: { region: string }) {
  const map = guessrMap(region);
  return (
    <Link
      href={`/guessr?region=${map}`}
      className="mt-3 flex items-center gap-1.5 font-display text-xs font-bold uppercase tracking-wider text-success hover:underline"
    >
      <Compass className="h-3.5 w-3.5" aria-hidden />
      Play PokéGuessr {map === "world" ? "World" : map === region.toLowerCase() ? region : "Galar"} →
    </Link>
  );
}
