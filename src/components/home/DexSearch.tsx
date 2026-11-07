"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/ui/Link";
import { ArrowRight, Loader2, Search, X } from "lucide-react";
import { boardArtUrl } from "@/lib/pokemon/art";
import { searchDex, type DexSearchEntry } from "@/lib/pokemon/dex-search";
import { isPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { HomeHeading } from "./HomeHeading";

/** Every Pokémon's [id, slug, name, category], fetched once a search starts (not with the page). */
let index: Promise<DexSearchEntry[]> | null = null;
function loadIndex(): Promise<DexSearchEntry[]> {
  index ??= fetch("/api/pokedex/names")
    .then((r) => (r.ok ? (r.json() as Promise<DexSearchEntry[]>) : Promise.reject(new Error(`names ${r.status}`))))
    .catch((err) => {
      index = null;
      throw err;
    });
  return index;
}

const LIMIT = 6;
const pad = (id: number) => `#${String(id).padStart(4, "0")}`;

/**
 * "Look up any Pokémon": the Pokédex's search in a box (name, number or
 * category, forgiving a typo), with the best few as you type. Arrow keys and
 * Enter pick one and open its entry; "See all" opens the Pokédex on the search.
 */
export function DexSearch() {
  const router = useRouter();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<DexSearchEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [failed, setFailed] = useState(false);

  const warm = () => {
    if (entries) return;
    loadIndex().then(setEntries, () => setFailed(true));
  };
  // A search typed before the list arrived runs as soon as it does.
  useEffect(() => {
    if (query.trim() && !entries) warm();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- warm reads state it sets
  }, [query]);

  const results = useMemo(() => (entries ? searchDex(entries, query, LIMIT) : []), [entries, query]);
  const q = query.trim();
  const shown = open && q.length > 0;
  const activeId = results[active] ? `${listId}-${results[active][0]}` : undefined;
  const allHref = `/pokedex?q=${encodeURIComponent(q)}`;

  function go(entry: DexSearchEntry | undefined) {
    setOpen(false);
    router.push(entry ? `/pokemon/${entry[1]}` : allHref);
  }

  return (
    <section aria-labelledby="home-search" data-testid="home-search">
      <HomeHeading
        id="home-search"
        title="Look up any Pokémon"
        aside={
          <span className="text-sm text-muted-foreground">
            Or browse{" "}
            <Link href="/pokedex/moves" prefetch={false} className="font-medium text-foreground underline-offset-4 hover:underline">
              moves
            </Link>
            ,{" "}
            <Link href="/pokedex/abilities" prefetch={false} className="font-medium text-foreground underline-offset-4 hover:underline">
              abilities
            </Link>{" "}
            and{" "}
            <Link href="/pokedex/types" prefetch={false} className="font-medium text-foreground underline-offset-4 hover:underline">
              types
            </Link>
          </span>
        }
      />
      <form
        role="search"
        className="relative max-w-2xl scroll-mt-20"
        onSubmit={(e) => {
          e.preventDefault();
          if (q) go(results[active] ?? results[0]);
        }}
      >
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-label="Search any Pokémon"
          aria-expanded={shown}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={shown ? activeId : undefined}
          value={query}
          placeholder="Search any Pokémon…"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="search"
          data-testid="home-search-input"
          onPointerEnter={warm}
          onFocus={(e) => {
            warm();
            setOpen(true);
            // A phone's keyboard covers the lower half: bring the box up so its results show above it.
            if (isPhone()) {
              const form = e.currentTarget.form;
              window.setTimeout(() => form?.scrollIntoView({ block: "start", behavior: "smooth" }), 250);
            }
          }}
          onBlur={() => setOpen(false)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setOpen(true);
              const n = results.length;
              if (n) setActive((a) => (Math.min(a, n - 1) + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
            } else if (e.key === "Escape") {
              if (shown) setOpen(false);
              else setQuery("");
            }
          }}
          className="h-14 w-full rounded-xl border border-input bg-card pl-12 pr-12 text-base shadow-[0_8px_30px_-12px_hsl(var(--screen)/0.35)] transition-colors placeholder:text-muted-foreground focus-visible:border-screen/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              input.current?.focus();
            }}
            className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        )}
        {shown && (
          <div className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-xl border bg-card shadow-[0_24px_60px_-12px_rgb(0_0_0/0.55)]" data-testid="home-search-results">
            <ul id={listId} role="listbox" aria-label="Matching Pokémon">
              {results.map((entry, i) => {
                const [id, , name, genus] = entry;
                return (
                  <li
                    key={id}
                    id={`${listId}-${id}`}
                    role="option"
                    aria-selected={i === active}
                    data-testid="home-search-option"
                    // Keep the focus in the box (a blur would close the list before the click lands).
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(entry)}
                    className={cn("flex min-h-[52px] cursor-pointer items-center gap-3 px-3 py-1.5", i === active ? "bg-screen/10" : "hover:bg-foreground/[0.04]")}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- the Pokédex's own static artwork */}
                    <img src={boardArtUrl(id)} alt="" width={40} height={40} loading="lazy" className="h-10 w-10 shrink-0 object-contain" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{name}</span>
                      <span className="block truncate text-[13px] text-muted-foreground">
                        {pad(id)} · {genus}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
            {!results.length && (
              <p className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                {entries ? (
                  "No Pokémon match that."
                ) : failed ? (
                  "Couldn't load the Pokédex. Try again in a moment."
                ) : (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading the Pokédex…
                  </>
                )}
              </p>
            )}
            <Link
              href={allHref}
              prefetch={false}
              onMouseDown={(e) => e.preventDefault()}
              className="flex min-h-[48px] items-center justify-between gap-2 border-t border-foreground/[0.07] px-4 text-sm font-semibold text-screen hover:bg-foreground/[0.04]"
              data-testid="home-search-all"
            >
              See all results in the Pokédex <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        )}
        <span className="sr-only" aria-live="polite">
          {shown && entries ? (results.length ? `${results.length} result${results.length === 1 ? "" : "s"}` : "No results") : ""}
        </span>
      </form>
    </section>
  );
}
