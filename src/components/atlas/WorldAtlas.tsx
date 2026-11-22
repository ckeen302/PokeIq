"use client";

import { useEffect, useRef, useState } from "react";
import Link from "@/components/ui/Link";
import { Compass, Loader2, Maximize2, Minus, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePlaceholder } from "@/lib/phone";
import { useT } from "@/i18n/client";
import atlasNs from "@/messages/atlas";
import { createAtlas, loadAtlas, type AtlasData, type AtlasEngine, type AtlasPlace, type AtlasRegion } from "./atlas-engine";

type Card = { place: AtlasPlace } | { region: AtlasRegion } | { miss: string } | null;

const MAIN = ["Kanto", "Johto", "Hoenn", "Sinnoh", "Unova", "Kalos", "Alola", "Galar", "Paldea"];
/** The PokéGuessr map for a region: its own, Galar's for the DLC, otherwise the world. */
const GUESSR_MAP: Record<string, string> = { "Isle of Armor": "galar", "Crown Tundra": "galar" };
const guessrMap = (region: string) => GUESSR_MAP[region] ?? (MAIN.includes(region) ? region.toLowerCase() : "world");

/** The engine's zoom level names → their messages. */
const ZOOM_KEY: Record<string, "world" | "region" | "towns" | "close"> = { World: "world", Region: "region", "Towns + routes": "towns", "Close up": "close" };
/** The atlas's map sources → their messages. */
const SOURCE_KEY: Record<string, "emerald" | "oras" | "hgss" | "platinum"> = {
  "Emerald region map data": "emerald",
  "Omega Ruby/Alpha Sapphire map": "oras",
  "HeartGold/SoulSilver Pokégear map data": "hgss",
  "Platinum town map data": "platinum",
};

/** `names`: on a page in another language, the official names of the atlas's places and regions (from the server). */
export function WorldAtlas({ src, regions, names: local }: { src: string; regions?: AtlasRegion[]; names?: Record<string, string> }) {
  const t = useT(atlasNs);
  const searchHint = usePlaceholder(t("search"), t("searchShort"));
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
  // Another language searches its own names too (English ones still work, and links pass them), and suggests its own.
  const shown = local ? new Map<string, { place?: AtlasPlace; region?: AtlasRegion }>() : names;
  if (local) {
    const n = (s: string) => local[s] ?? s;
    for (const r of atlas?.regions ?? []) shown.set(n(r.name), { region: r });
    for (const p of atlas?.places ?? []) shown.set(`${n(p.name)} · ${n(p.region)}`, { place: p });
    for (const p of atlas?.places ?? []) for (const b of p.inside ?? []) if (!shown.has(`${n(b)} · ${n(p.name)}`)) shown.set(`${n(b)} · ${n(p.name)}`, { place: p });
    for (const [k, v] of shown) if (!names.has(k)) names.set(k, v);
  }

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
      ...(local && { names: local }),
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
  }, [atlas, src, local]);

  const chips = (atlas?.regions ?? regions ?? []).filter((r) => r.chip !== false).sort((a, b) => a.tier - b.tier);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="hud-label max-md:hidden text-screen">{t("kicker")}</p>
          <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">
            {t.rich("title", { accent: (chunks) => <span className="text-primary">{chunks}</span> })}
          </h1>
          <Link href="/pokeguessr/globe" className="inline-block font-display text-xs font-bold uppercase tracking-wider text-screen hover:underline">
            {t("globe")}
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
            placeholder={searchHint}
            aria-label={t("searchLabel")}
            autoComplete="off"
            className="h-10 min-w-0 flex-1 rounded-l-md border border-r-0 border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <datalist id="atlas-places">
            {[...shown.keys()].sort().map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <button
            type="submit"
            className="flex h-10 items-center gap-1.5 rounded-r-md bg-primary px-4 font-display text-xs font-bold uppercase tracking-wider text-primary-foreground"
          >
            <Search className="h-4 w-4" aria-hidden /> {t("go")}
          </button>
        </form>
      </div>

      <nav className="flex flex-wrap gap-1.5" aria-label={t("regions")}>
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
              {local?.[r.name] ?? r.name}
            </button>
          </span>
        ))}
      </nav>

      <div ref={stageRef} className="relative h-[calc(100vh-17rem)] min-h-[460px] overflow-hidden rounded-lg border-2 border-foreground/15 bg-[#165c96]">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full cursor-grab touch-none"
          role="img"
          aria-label={t("canvas")}
        />
        {!atlas && (
          <div className="absolute inset-0 flex items-center justify-center text-white/80">
            {failed ? t("failed") : <Loader2 className="h-6 w-6 animate-spin" aria-label={t("loading")} />}
          </div>
        )}

        <div className="pointer-events-none absolute right-3 top-3 rounded-md border border-white/15 bg-black/55 px-2.5 py-1.5 text-right font-pixel text-[10px] uppercase leading-relaxed tracking-wider text-white/70 backdrop-blur">
          <div>{t.rich("zoom", { level: t(`zoomLevels.${ZOOM_KEY[zoom] ?? "world"}`), b: (chunks) => <span className="text-white">{chunks}</span> })}</div>
          <div className="flex justify-end gap-2.5">
            <span className="flex items-center gap-1">
              <i className="inline-block h-2 w-2 rounded-sm bg-[#e2475b]" /> {t("cities")}
            </span>
            <span className="flex items-center gap-1">
              <i className="inline-block h-2 w-2 rounded-sm bg-[#4d7ee8]" /> {t("towns")}
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
              aria-label={t("close")}
              className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded text-white/60 hover:text-white"
              onClick={() => {
                setCard(null);
                engine.current?.setSelected(null);
              }}
            >
              <X className="h-4 w-4" />
            </button>
            <CardBody card={card} places={atlas?.places ?? []} local={local} />
          </aside>
        )}

        <div className="absolute bottom-3 right-3 grid gap-1.5">
          {[
            { label: t("zoomIn"), icon: <Plus className="h-4 w-4" />, act: () => engine.current?.zoomBy(1.6) },
            { label: t("zoomOut"), icon: <Minus className="h-4 w-4" />, act: () => engine.current?.zoomBy(1 / 1.6) },
            {
              label: t("whole"),
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

      <p className="text-center text-xs text-muted-foreground">{t("help")}</p>
    </div>
  );
}

function CardBody({ card, places, local }: { card: NonNullable<Card>; places: AtlasPlace[]; local?: Record<string, string> }) {
  const t = useT(atlasNs);
  const n = (s: string) => local?.[s] ?? s;
  if ("miss" in card) {
    return (
      <>
        <h2 className="pr-6 font-display text-xl font-bold uppercase">{t("noMatch")}</h2>
        <p className="mt-1 text-sm text-white/70">{t("nothing", { q: card.miss })}</p>
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
          {MAIN.includes(r.name) ? t("main") : r.tier === 2 ? t("side") : r.parent ? t("partOf", { parent: n(r.parent) }) : t("partOfRegion")}
        </p>
        <h2 className="mt-1 pr-6 font-display text-2xl font-bold uppercase">{n(r.name)}</h2>
        {mine.length > 0 && <p className="mt-1 text-sm text-white/70">{routes ? t("countRoutes", { n: mine.length - routes, routes }) : t("count", { n: mine.length - routes })}</p>}
        <GuessrLink region={r.parent ?? r.name} local={local} />
      </>
    );
  }
  const p = card.place;
  return (
    <>
      <p className="font-pixel text-[10px] uppercase tracking-wider text-white/60">
        {n(p.region)} · {t(`kinds.${p.kind}`)}
      </p>
      <h2 className="mt-1 pr-6 font-display text-2xl font-bold uppercase leading-tight">{n(p.name)}</h2>
      {p.inside && (
        <>
          <p className="mt-2 text-sm text-white/70">{t("placesHere")}</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {p.inside.map((b) => (
              <li key={b} className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-xs">
                {n(b)}
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
        {p.exact ? (p.source ? t("exactFrom", { source: SOURCE_KEY[p.source] ? t(`sources.${SOURCE_KEY[p.source]}`) : p.source }) : t("exact")) : t("approximate")}
      </span>
      <GuessrLink region={p.region} local={local} />
    </>
  );
}

function GuessrLink({ region, local }: { region: string; local?: Record<string, string> }) {
  const t = useT(atlasNs);
  const map = guessrMap(region);
  const name = map === "world" ? t("world") : map === region.toLowerCase() ? (local?.[region] ?? region) : (local?.Galar ?? "Galar");
  return (
    <Link
      href={`/pokeguessr?region=${map}`}
      className="mt-3 flex items-center gap-1.5 font-display text-xs font-bold uppercase tracking-wider text-success hover:underline"
    >
      <Compass className="h-3.5 w-3.5" aria-hidden />
      {t("play", { map: name })}
    </Link>
  );
}
