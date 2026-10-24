"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Pencil, Search, Share2, Sparkles, X } from "lucide-react";
import { useAccount } from "@/lib/account";
import { artUrl } from "@/lib/pokemon/art";
import { GAME_SLOTS, POKEMON_SLOTS, RULE_HINT, aboutIsEmpty, choiceLabel, type AboutData, type PokemonSlot } from "@/lib/about-data";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const FIELD = "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const PAGE = 60;

type Validate = typeof import("@/lib/about-validate");

/**
 * A trainer's "About me": their Pokémon picks and favourite parts of the
 * games. Everyone sees the filled slots; the owner gets an edit mode. The
 * server checks every pick again before saving.
 */
export function AboutMe({ username, initial, names }: { username: string; initial: AboutData; names: Record<string, string> }) {
  const account = useAccount();
  const router = useRouter();
  const mine = account.user?.username.toLowerCase() === username.toLowerCase();
  const [about, setAbout] = useState(initial);
  const [labels, setLabels] = useState(names);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [v, setV] = useState<Validate | null>(null);

  useEffect(() => {
    if (!editing || v) return;
    let live = true;
    void import("@/lib/about-validate").then((m) => live && setV(m));
    return () => {
      live = false;
    };
  }, [editing, v]);

  const empty = aboutIsEmpty(about);
  if (!mine && empty) return null;

  const shown = POKEMON_SLOTS.filter((s) => about.pokemon[s.id]);
  const gamesShown = GAME_SLOTS.filter((s) => about.games[s.id]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile/about", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const body = (await res.json().catch(() => ({}))) as { error?: string; about?: AboutData };
      if (!res.ok || !body.about) {
        setError(body.error ?? "Couldn't save.");
        return;
      }
      setAbout(body.about);
      if (v) setLabels(Object.fromEntries(Object.entries(body.about.pokemon).map(([k, p]) => [k, v.pokemonName(p.id) ?? ""])));
      setEditing(false);
      setOpen(null);
      router.refresh();
    } catch {
      setError("Couldn't save. Check your connection.");
    } finally {
      setSaving(false);
    }
  }

  async function share() {
    setSharing(true);
    const url = `/u/${encodeURIComponent(username)}/about-image`;
    try {
      const blob = await (await fetch(url, { cache: "no-store" })).blob();
      const file = new File([blob], `pokeiq-${username}.png`, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `${username} on PokéIQ`, url: `${location.origin}/u/${encodeURIComponent(username)}` });
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }
    } catch {
      // Share sheet dismissed, or the image couldn't load: nothing to do.
    } finally {
      setSharing(false);
    }
  }

  return (
    <Card data-testid="profile-about">
      <CardContent className="space-y-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="hud-label flex items-center gap-1.5 text-screen">
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> About me
          </p>
          <div className="flex flex-wrap gap-2">
            {!empty && !editing && (
              <Button size="sm" variant="outline" onClick={share} disabled={sharing} data-testid="about-share">
                {sharing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Share2 className="h-4 w-4" aria-hidden />} Share / Download
              </Button>
            )}
            {mine && !editing && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setDraft(about);
                  setEditing(true);
                }}
                data-testid="about-edit"
              >
                <Pencil className="h-4 w-4" aria-hidden /> {empty ? "Add" : "Edit"}
              </Button>
            )}
            {editing && (
              <>
                <Button size="sm" onClick={save} disabled={saving} data-testid="about-save">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />} Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => (setEditing(false), setOpen(null), setError(null))}>
                  <X className="h-4 w-4" aria-hidden /> Cancel
                </Button>
              </>
            )}
          </div>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {editing ? (
          <div className="space-y-5">
            <section className="space-y-3">
              <p className="hud-label">My Pokémon</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
                {POKEMON_SLOTS.map((s) => {
                  const pick = draft.pokemon[s.id];
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setOpen(open === s.id ? null : s.id)}
                      aria-expanded={open === s.id}
                      className={cn("flex flex-col items-center rounded-md border bg-shade/20 p-2 text-center hover:border-screen/60", open === s.id && "border-screen")}
                      data-testid={`about-slot-${s.id}`}
                    >
                      <span className="text-[11px] text-muted-foreground">{s.label}</span>
                      {pick ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={artUrl(pick.id, 96, pick.shiny)} alt="" width={64} height={64} className="h-16 w-16 object-contain" />
                      ) : (
                        <span className="flex h-16 w-16 items-center justify-center text-2xl text-muted-foreground" aria-hidden>
                          +
                        </span>
                      )}
                      <span className="w-full truncate text-xs font-semibold">{pick ? (v?.pokemonName(pick.id) ?? labels[s.id] ?? "") : "Empty"}</span>
                    </button>
                  );
                })}
              </div>
              {open && (
                <Picker
                  key={open}
                  slot={POKEMON_SLOTS.find((s) => s.id === open)!}
                  v={v}
                  current={draft.pokemon[open]}
                  onPick={(pick) => {
                    const pokemon = { ...draft.pokemon };
                    if (pick) pokemon[open] = pick;
                    else delete pokemon[open];
                    setDraft({ ...draft, pokemon });
                    if (pick) setOpen(null);
                  }}
                />
              )}
            </section>
            <section className="space-y-3">
              <p className="hud-label">My Pokémon games</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {GAME_SLOTS.map((s) => {
                  const groups = [...new Set(s.choices.map((c) => c.group ?? ""))];
                  return (
                    <label key={s.id} className="flex flex-col gap-1 text-xs text-muted-foreground">
                      {s.label}
                      <select
                        value={draft.games[s.id] ?? ""}
                        onChange={(e) => {
                          const games = { ...draft.games };
                          if (e.target.value) games[s.id] = e.target.value;
                          else delete games[s.id];
                          setDraft({ ...draft, games });
                        }}
                        className={cn(FIELD, "text-foreground")}
                        data-testid={`about-game-${s.id}`}
                      >
                        <option value="">Not picked</option>
                        {groups.map((g) => {
                          const items = s.choices.filter((c) => (c.group ?? "") === g);
                          const opts = items.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.label}
                            </option>
                          ));
                          return g ? (
                            <optgroup key={g} label={g}>
                              {opts}
                            </optgroup>
                          ) : (
                            opts
                          );
                        })}
                      </select>
                    </label>
                  );
                })}
              </div>
            </section>
          </div>
        ) : (
          <>
            {empty && <p className="text-sm text-muted-foreground">Pick your favorite Pokémon and games to show on your profile.</p>}
            {shown.length > 0 && (
              <section className="space-y-3">
                <p className="hud-label">My Pokémon</p>
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5" data-testid="about-pokemon">
                  {shown.map((s) => {
                    const pick = about.pokemon[s.id];
                    return (
                      <li key={s.id} className="flex flex-col items-center rounded-md border bg-shade/20 p-2 text-center" data-testid={`about-pokemon-${s.id}`}>
                        <span className="text-[11px] text-muted-foreground">{s.label}</span>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={artUrl(pick.id, 160, pick.shiny)} alt="" width={80} height={80} loading="lazy" className="h-20 w-20 object-contain" />
                        <span className="w-full truncate text-sm font-semibold">
                          {pick.shiny && <span aria-label="Shiny">✨ </span>}
                          {labels[s.id]}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            {gamesShown.length > 0 && (
              <section className="space-y-3">
                <p className="hud-label">My Pokémon games</p>
                <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3" data-testid="about-games">
                  {gamesShown.map((s) => (
                    <div key={s.id} className="flex flex-col-reverse rounded-md border bg-shade/20 p-2" data-testid={`about-game-view-${s.id}`}>
                      <dt className="text-[11px] text-muted-foreground">{s.label}</dt>
                      <dd className="font-display text-lg font-bold">{choiceLabel(s.id, about.games[s.id])}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Picker({ slot, v, current, onPick }: { slot: PokemonSlot; v: Validate | null; current?: { id: number; shiny: boolean }; onPick: (p: { id: number; shiny: boolean } | null) => void }) {
  const [query, setQuery] = useState("");
  const [shiny, setShiny] = useState(slot.shinyForced ? true : (current?.shiny ?? false));
  const [shown, setShown] = useState(PAGE);
  const [dex, setDex] = useState<{ id: number; name: string }[] | null>(null);

  useEffect(() => {
    if (!v) return;
    setDex(v.optionsFor(slot.rule).map((id) => ({ id, name: v.pokemonName(id) ?? "" })));
  }, [v, slot.rule]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (dex ?? []).filter((p) => !q || p.name.toLowerCase().includes(q) || String(p.id) === q);
  }, [dex, query]);
  useEffect(() => setShown(PAGE), [query]);

  return (
    <div className="space-y-3 rounded-lg border bg-card p-3" data-testid="about-picker">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm font-semibold">
          {slot.label} <span className="text-xs font-normal text-muted-foreground">· {RULE_HINT[slot.rule]}</span>
        </p>
        <label className="relative">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name" aria-label="Search Pokémon by name" className={cn(FIELD, "w-56 pl-8")} data-testid="about-search" />
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={shiny} disabled={slot.shinyForced} onChange={(e) => setShiny(e.target.checked)} data-testid="about-shiny" /> Shiny{slot.shinyForced ? " (always)" : ""}
        </label>
        {current && (
          <Button size="sm" variant="ghost" onClick={() => onPick(null)} data-testid="about-clear">
            Clear
          </Button>
        )}
      </div>
      {!dex ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading Pokémon" />
      ) : (
        <>
          <div className="grid max-h-80 grid-cols-4 gap-2 overflow-y-auto pr-1 sm:grid-cols-6 lg:grid-cols-8" role="listbox" aria-label="Pokémon">
            {list.slice(0, shown).map((p) => (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={p.id === current?.id}
                title={`#${p.id} ${p.name}`}
                onClick={() => onPick({ id: p.id, shiny })}
                className={cn("flex flex-col items-center rounded-md border p-1 text-[10px] hover:border-screen/60", p.id === current?.id ? "border-screen bg-screen/10" : "border-border")}
                data-testid={`about-mon-${p.id}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={artUrl(p.id, 96, shiny)} alt="" loading="lazy" decoding="async" width={48} height={48} className="h-12 w-12 object-contain" />
                <span className="w-full truncate text-center">{p.name}</span>
              </button>
            ))}
          </div>
          {list.length === 0 && <p className="text-sm text-muted-foreground">No match.</p>}
          {list.length > shown && (
            <Button size="sm" variant="ghost" onClick={() => setShown((s) => s + PAGE)}>
              Show more
            </Button>
          )}
        </>
      )}
    </div>
  );
}
