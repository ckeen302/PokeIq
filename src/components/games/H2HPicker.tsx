"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Search, Swords, X } from "lucide-react";
import { searchEntrants } from "@/lib/race/lineup";
import { badgeName } from "@/lib/sizes/badges";
import { fromAthleteRow, type Athlete, type AthleteRow } from "@/lib/games/athlete";
import { EVENTS, type EventId } from "@/lib/games/events";
import { eventRunPath, h2hQuestion } from "@/lib/games/deeplink";
import { RACE_URLS } from "@/components/race/urls";
import { cn } from "@/lib/utils";

/**
 * Head to head in a few taps: two Pokémon (one may come with the page),
 * one event, then watch. Phone first: two big slots, rival chips, the
 * events as a grid, one button that reads the question. Inline on the
 * Games' pages; a sheet inside the 3D stage.
 */

let rows: Promise<Athlete[]> | null = null;
function athletes(): Promise<Athlete[]> {
  rows ??= fetch("/api/games")
    .then((r) => { if (!r.ok) throw new Error(`games ${r.status}`); return r.json() as Promise<AthleteRow[]>; })
    .then((x) => x.map(fromAthleteRow))
    .catch((e) => { rows = null; throw e; });
  return rows;
}

export interface H2HPickerProps {
  /** Already loaded (the 3D stage); otherwise fetched on first use. */
  all?: Athlete[] | null;
  a?: string | null;
  b?: string | null;
  event?: EventId | null;
  /** Suggested rivals (keys) for a tap. */
  rivals: string[];
  /** Names for the keys the page already knows (shown before the list loads). */
  names?: Record<string, string>;
  /** Where it sits: a card on the page, or a sheet over the stage. */
  variant?: "inline" | "sheet";
  /** The stage runs it in place; elsewhere the button opens the run's page. */
  onRun?(event: EventId, keys: [string, string]): void;
  onClose?(): void;
}

const EVENT_CHOICES = EVENTS.filter((e) => e.id !== "all-around");

export function H2HPicker({ all: given, a: a0 = null, b: b0 = null, event: e0 = null, rivals, names, variant = "inline", onRun, onClose }: H2HPickerProps) {
  const router = useRouter();
  const [all, setAll] = useState<Athlete[] | null>(given ?? null);
  const [failed, setFailed] = useState(false);
  const [a, setA] = useState<string | null>(a0);
  const [b, setB] = useState<string | null>(b0);
  const [ev, setEv] = useState<EventId | null>(e0);
  const [slot, setSlot] = useState<"a" | "b">(a0 ? "b" : "a");
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => { if (given) setAll(given); }, [given]);
  const need = () => { if (!all && !failed) athletes().then(setAll, () => setFailed(true)); };
  // The sheet loads at once; the inline card when it comes into view (or on a first touch).
  useEffect(() => {
    if (variant === "sheet" || typeof IntersectionObserver === "undefined") { need(); return; }
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { need(); io.disconnect(); } }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const byKey = useMemo(() => new Map((all ?? []).map((x) => [x.key, x])), [all]);
  const entrants = useMemo(() => (all ?? []).map((x) => x.entrant), [all]);
  const results = useMemo(() => (q.trim() ? searchEntrants(entrants, q, 6) : []), [entrants, q]);
  const nameOf = (k: string | null) => (k ? byKey.get(k)?.name ?? names?.[k] ?? k.replace(/-/g, " ") : "");
  const chips = rivals.filter((k) => k !== a && k !== b).slice(0, 8);

  const put = (key: string) => {
    if (slot === "a") { setA(key); if (key === b) setB(null); setSlot(b && key !== b ? "a" : "b"); }
    else { setB(key); if (key === a) setA(null); if (!a) setSlot("a"); }
    setQ("");
  };
  const ready = !!(a && b && ev && a !== b);
  const question = ready ? h2hQuestion(ev!, nameOf(a), nameOf(b)) : null;
  const go = () => {
    if (!ready) return;
    if (onRun) onRun(ev!, [a!, b!]);
    else router.push(eventRunPath(ev!, { keys: [a!, b!] }));
  };

  const slotEl = (which: "a" | "b", k: string | null) => {
    const x = k ? byKey.get(k) : undefined;
    const on = slot === which;
    return (
      <button
        type="button"
        onClick={() => { need(); setSlot(which); input.current?.focus({ preventScroll: true }); }}
        aria-pressed={on}
        aria-label={k ? `${which === "a" ? "First" : "Second"} Pokémon: ${nameOf(k)}. Change` : `Pick the ${which === "a" ? "first" : "second"} Pokémon`}
        className={cn("relative flex min-h-[7.5rem] min-w-0 flex-1 flex-col items-center justify-end gap-1 rounded-xl border p-2 transition-colors", on ? "border-[#ffd84a] bg-[#ffd84a]/10" : "border-white/15 bg-white/[0.04] hover:border-white/35")}
        data-testid={`h2h-slot-${which}`}
        data-key={k ?? ""}
      >
        {x ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={RACE_URLS.art(x.entrant.art, 256)} alt="" width={72} height={72} className="h-[4.5rem] w-[4.5rem] object-contain" loading="lazy" />
        ) : (
          <span className="flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full border border-dashed border-white/30 text-white/50"><Search className="h-6 w-6" aria-hidden /></span>
        )}
        <span className="w-full truncate text-center font-display text-xs font-bold uppercase tracking-wide">{k ? badgeName(nameOf(k)) : on ? "Search below" : "Tap to pick"}</span>
      </button>
    );
  };

  const body = (
    <div ref={root} className="space-y-3" onPointerDown={need} onFocus={need}>
      <div className="flex items-stretch gap-2">
        {slotEl("a", a)}
        <span className="self-center font-display text-lg font-black italic text-[#ffd84a]" aria-hidden>VS</span>
        {slotEl("b", b)}
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/45" aria-hidden />
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && results[0]) put(results[0].key); }}
          placeholder={slot === "a" ? "Search the first Pokémon…" : "Search the rival…"}
          aria-label={slot === "a" ? "Search for the first Pokémon" : "Search for the second Pokémon"}
          className="h-11 w-full rounded-lg border border-white/20 bg-[#121b36] pl-9 pr-3 font-display text-base text-white placeholder:text-white/45 outline-none focus:border-[#ffd84a] sm:text-sm"
          data-testid="h2h-search"
        />
      </div>
      {results.length > 0 ? (
        <ul className="max-h-52 overflow-y-auto rounded-lg border border-white/15 bg-[#0e1730] p-1" role="listbox" aria-label="Pokémon">
          {results.map((e) => (
            <li key={e.key}>
              <button type="button" role="option" aria-selected={false} onClick={() => put(e.key)} className="flex min-h-11 w-full items-center rounded-md px-3 text-left font-display text-sm font-semibold uppercase tracking-wide hover:bg-white/10" data-testid="h2h-result" data-key={e.key}>{e.name}</button>
            </li>
          ))}
        </ul>
      ) : (
        chips.length > 0 && (
          <div>
            <p className="mb-1.5 font-pixel text-[9px] uppercase tracking-[0.16em] text-white/50">{slot === "a" ? "Or tap one" : "Or tap a rival"}</p>
            <div className="flex flex-wrap gap-1.5">
              {chips.map((k) => (
                <button key={k} type="button" onClick={() => put(k)} className="tap inline-flex min-h-9 items-center rounded-md border border-white/15 px-2.5 font-display text-[11px] font-semibold uppercase tracking-wide text-white/80 hover:border-white/40 hover:text-white" data-testid="h2h-rival" data-key={k}>{badgeName(nameOf(k))}</button>
              ))}
            </div>
          </div>
        )
      )}
      <div>
        <p className="mb-1.5 font-pixel text-[9px] uppercase tracking-[0.16em] text-white/50">The event</p>
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4" role="radiogroup" aria-label="Event">
          {EVENT_CHOICES.map((e) => (
            <button key={e.id} type="button" role="radio" aria-checked={ev === e.id} onClick={() => setEv(e.id)} className={cn("min-h-10 rounded-md border px-1 py-1.5 font-display text-[11px] font-semibold uppercase leading-tight tracking-normal transition-colors sm:px-1.5 sm:tracking-wide", ev === e.id ? "border-[#ffd84a] bg-[#ffd84a]/10 text-[#ffd84a]" : "border-white/15 text-white/75 hover:text-white")} data-testid={`h2h-event-${e.id}`}>
              {e.name}
            </button>
          ))}
        </div>
      </div>
      <button type="button" disabled={!ready} onClick={go} className="rc-go inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-center font-display text-sm font-bold uppercase tracking-wider disabled:opacity-45" data-testid="h2h-go">
        <Play className="h-4 w-4 shrink-0 fill-current" aria-hidden />
        <span className="min-w-0 break-words">{question ?? (!a || !b ? "Pick two Pokémon" : !ev ? "Pick an event" : "Pick two different Pokémon")}</span>
      </button>
      {failed && <p className="text-sm text-red-300" role="alert">The Pokémon didn&apos;t load. Check the connection and try again.</p>}
    </div>
  );

  if (variant === "sheet") {
    return (
      <div className="pointer-events-auto absolute inset-0 z-40 flex items-end justify-center bg-black/55 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="h2h-title" data-testid="h2h-picker">
        <div className="dark-scope relative max-h-full w-full overflow-y-auto rounded-t-2xl border border-white/15 bg-[#0b1226] p-4 text-white shadow-2xl sm:max-w-lg sm:rounded-2xl sm:p-5" data-rc-scroll>
          <button type="button" onClick={onClose} className="absolute right-3 top-3 rounded-md p-1.5 text-white/60 hover:text-white" aria-label="Close" data-testid="h2h-close"><X className="h-5 w-5" /></button>
          <h2 id="h2h-title" className="mb-3 flex items-center gap-2 font-display text-lg font-bold uppercase tracking-wider"><Swords className="h-5 w-5 text-[#ffd84a]" aria-hidden /> Head to head</h2>
          {body}
        </div>
      </div>
    );
  }
  return <div className="dark-scope max-w-2xl rounded-xl border border-white/15 bg-[#0b1226] p-3 text-white sm:p-4" data-testid="h2h-picker">{body}</div>;
}
