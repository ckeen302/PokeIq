"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Check, Loader2, Pencil, Search, Share2, Sparkles, X } from "lucide-react";
import { useAccount } from "@/lib/account";
import { artUrl } from "@/lib/pokemon/art";
import Link from "@/components/ui/Link";
import { CARD_SLOTS, GAMES, GAME_SLOTS, POKEMON_SLOTS, REGIONS, aboutIsEmpty, type AboutCard, type AboutData, type Choice, type GameSlot, type PokemonSlot } from "@/lib/about-data";
import type { AboutLocal } from "@/lib/about-local";
import { useT } from "@/i18n/client";
import type { Translator } from "@/i18n/catalog";
import { foldLetters } from "@/lib/names/fold";
import aboutNs from "@/messages/about-me";

type AboutT = Translator<typeof aboutNs.en>;

/** A game choice's name: the official one in the page's language for games and regions (sent by the page). */
const choiceName = (slot: GameSlot, c: Choice, local?: AboutLocal) => ((slot.choices === GAMES || slot.choices === REGIONS) && local?.choices[c.id]) || c.label;

/** The name of the choice picked in a game slot (lib/about-data's choiceLabel, in the page's language), or null. */
function pickedName(slot: GameSlot, id: string, local?: AboutLocal): string | null {
  const c = slot.choices.find((x) => x.id === id);
  return c ? choiceName(slot, c, local) : null;
}

/** A choice group's name ("Gen 1", "Kanto", "Champions") in the page's language. */
function groupName(t: AboutT, group: string, local?: AboutLocal): string {
  if (!local) return group;
  const gen = /^Gen (\d+)$/.exec(group);
  if (gen) return t("gen", { n: gen[1] });
  if (group === "Champions") return t("champions");
  return local.regions[group.toLowerCase()] ?? group;
}
import type { CardTile } from "@/lib/tcg/types";
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
export function AboutMe({ username, initial, names, local }: { username: string; initial: AboutData; names: Record<string, string>; local?: AboutLocal }) {
  const t = useT(aboutNs);
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
  const cardsShown = CARD_SLOTS.filter((s) => about.cards?.[s.id]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile/about", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const body = (await res.json().catch(() => ({}))) as { error?: string; about?: AboutData };
      if (!res.ok || !body.about) {
        setError(body.error ?? t("saveFailed"));
        return;
      }
      setAbout(body.about);
      if (v) setLabels(Object.fromEntries(Object.entries(body.about.pokemon).map(([k, p]) => [k, local?.species[p.id] ?? v.pokemonName(p.id) ?? ""])));
      setEditing(false);
      setOpen(null);
      router.refresh();
    } catch {
      setError(t("offline"));
    } finally {
      setSaving(false);
    }
  }

  async function share() {
    setSharing(true);
    const url = `/u/${encodeURIComponent(username)}/about-grid`;
    try {
      const blob = await (await fetch(url, { cache: "no-store" })).blob();
      const file = new File([blob], `pokeiq-${username}.png`, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: t("shareTitle", { name: username }), url: `${location.origin}/u/${encodeURIComponent(username)}` });
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
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> {t("title")}
          </p>
          <div className="flex flex-wrap gap-2">
            {!empty && !editing && (
              <Button size="sm" variant="outline" onClick={share} disabled={sharing} data-testid="about-share">
                {sharing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Share2 className="h-4 w-4" aria-hidden />} {t("share")}
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
                <Pencil className="h-4 w-4" aria-hidden /> {empty ? t("add") : t("edit")}
              </Button>
            )}
            {editing && (
              <>
                <Button size="sm" onClick={save} disabled={saving} data-testid="about-save">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />} {t("save")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => (setEditing(false), setOpen(null), setError(null))}>
                  <X className="h-4 w-4" aria-hidden /> {t("cancel")}
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
              <p className="hud-label">{t("myPokemon")}</p>
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
                      <span className="text-[11px] text-muted-foreground">{t(`slots.${s.id}` as never)}</span>
                      {pick ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={artUrl(pick.id, 96, pick.shiny)} alt="" width={64} height={64} className="h-16 w-16 object-contain" />
                      ) : (
                        <span className="flex h-16 w-16 items-center justify-center text-2xl text-muted-foreground" aria-hidden>
                          +
                        </span>
                      )}
                      <span className="w-full truncate text-xs font-semibold">{pick ? (local?.species[pick.id] ?? v?.pokemonName(pick.id) ?? labels[s.id] ?? "") : t("empty")}</span>
                    </button>
                  );
                })}
              </div>
              {open && POKEMON_SLOTS.some((s) => s.id === open) && (
                <Picker
                  key={open}
                  slot={POKEMON_SLOTS.find((s) => s.id === open)!}
                  v={v}
                  t={t}
                  local={local}
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
              <p className="hud-label">{t("myCards")}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
                {CARD_SLOTS.map((s) => {
                  const pick = draft.cards?.[s.id];
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setOpen(open === s.id ? null : s.id)}
                      aria-expanded={open === s.id}
                      className={cn("flex flex-col items-center rounded-md border bg-shade/20 p-2 text-center hover:border-screen/60", open === s.id && "border-screen")}
                      data-testid={`about-slot-${s.id}`}
                    >
                      <span className="text-[11px] text-muted-foreground">{t(`cardSlots.${s.id}` as never)}</span>
                      {pick?.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={pick.image} alt="" width={46} height={64} className="h-16 w-auto rounded-[3px] object-contain" />
                      ) : (
                        <span className="flex h-16 w-16 items-center justify-center text-2xl text-muted-foreground" aria-hidden>
                          +
                        </span>
                      )}
                      <span className="w-full truncate text-xs font-semibold">{pick?.name ?? t("empty")}</span>
                    </button>
                  );
                })}
              </div>
              {open && CARD_SLOTS.some((s) => s.id === open) && (
                <CardPicker
                  key={open}
                  label={t(`cardSlots.${open}` as never)}
                  t={t}
                  current={draft.cards?.[open]}
                  onPick={(card) => {
                    const cards = { ...draft.cards };
                    if (card) cards[open] = card;
                    else delete cards[open];
                    setDraft({ ...draft, cards });
                    if (card) setOpen(null);
                  }}
                />
              )}
            </section>
            <section className="space-y-3">
              <p className="hud-label">{t("myGames")}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {GAME_SLOTS.map((s) => {
                  const groups = [...new Set(s.choices.map((c) => c.group ?? ""))];
                  return (
                    <label key={s.id} className="flex flex-col gap-1 text-xs text-muted-foreground">
                      {t(`games.${s.id}` as never)}
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
                        <option value="">{t("notPicked")}</option>
                        {groups.map((g) => {
                          const items = s.choices.filter((c) => (c.group ?? "") === g);
                          const opts = items.map((c) => (
                            <option key={c.id} value={c.id}>
                              {choiceName(s, c, local)}
                            </option>
                          ));
                          return g ? (
                            <optgroup key={g} label={groupName(t, g, local)}>
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
            {empty && <p className="text-sm text-muted-foreground">{t("intro")}</p>}
            {shown.length > 0 && (
              <section className="space-y-3">
                <p className="hud-label">{t("myPokemon")}</p>
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5" data-testid="about-pokemon">
                  {shown.map((s) => {
                    const pick = about.pokemon[s.id];
                    return (
                      <li key={s.id} className="flex flex-col items-center rounded-md border bg-shade/20 p-2 text-center" data-testid={`about-pokemon-${s.id}`}>
                        <span className="text-[11px] text-muted-foreground">{t(`slots.${s.id}` as never)}</span>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={artUrl(pick.id, 160, pick.shiny)} alt="" width={80} height={80} loading="lazy" className="h-20 w-20 object-contain" />
                        <span className="w-full truncate text-sm font-semibold">
                          {pick.shiny && <span aria-label={t("shinyMark")}>✨ </span>}
                          {labels[s.id]}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            {cardsShown.length > 0 && (
              <section className="space-y-3">
                <p className="hud-label">{t("myCards")}</p>
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5" data-testid="about-cards">
                  {cardsShown.map((s) => {
                    const c = about.cards![s.id];
                    return (
                      <li key={s.id} className="rounded-md border bg-shade/20 text-center" data-testid={`about-card-${s.id}`}>
                        <Link href={`/pokedex/tcg/card/${c.id}`} className="group flex h-full flex-col items-center gap-1 p-2" title={c.set ? `${c.name} · ${c.set}` : c.name}>
                          <span className="text-[11px] text-muted-foreground">{t(`cardSlots.${s.id}` as never)}</span>
                          {c.image && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={c.image} alt={t("cardAlt", { name: c.name })} width={86} height={120} loading="lazy" className="h-[120px] w-auto rounded-[4px] object-contain shadow-md shadow-black/40 transition-transform group-hover:scale-105" />
                          )}
                          <span className="w-full truncate text-sm font-semibold group-hover:text-screen">{c.name}</span>
                          {c.set && <span className="-mt-1 w-full truncate text-[11px] text-muted-foreground">{c.set}</span>}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            {gamesShown.length > 0 && (
              <section className="space-y-3">
                <p className="hud-label">{t("myGames")}</p>
                <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3" data-testid="about-games">
                  {gamesShown.map((s) => (
                    <div key={s.id} className="flex flex-col-reverse rounded-md border bg-shade/20 p-2" data-testid={`about-game-view-${s.id}`}>
                      <dt className="text-[11px] text-muted-foreground">{t(`games.${s.id}` as never)}</dt>
                      <dd className="font-display text-lg font-bold">{pickedName(s, about.games[s.id], local)}</dd>
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

function Picker({ slot, v, t, local, current, onPick }: { slot: PokemonSlot; v: Validate | null; t: AboutT; local?: AboutLocal; current?: { id: number; shiny: boolean }; onPick: (p: { id: number; shiny: boolean } | null) => void }) {
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
    // A page in another language also finds a Pokémon by its name in that language.
    const own = local ? foldLetters(query.trim()) : "";
    const named = (id: number) => !!own && !!local?.species[id] && foldLetters(local.species[id]).includes(own);
    return (dex ?? []).filter((p) => !q || p.name.toLowerCase().includes(q) || String(p.id) === q || named(p.id));
  }, [dex, query, local]);
  useEffect(() => setShown(PAGE), [query]);

  return (
    <div className="space-y-3 rounded-lg border bg-card p-3" data-testid="about-picker">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm font-semibold">
          {t(`slots.${slot.id}` as never)} <span className="text-xs font-normal text-muted-foreground">· {t(`rules.${slot.rule}`)}</span>
        </p>
        <label className="relative">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("searchPlaceholder")} aria-label={t("searchLabel")} className={cn(FIELD, "w-56 pl-8")} data-testid="about-search" />
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={shiny} disabled={slot.shinyForced} onChange={(e) => setShiny(e.target.checked)} data-testid="about-shiny" /> {t("shiny")}{slot.shinyForced ? t("always") : ""}
        </label>
        {current && (
          <Button size="sm" variant="ghost" onClick={() => onPick(null)} data-testid="about-clear">
            {t("clear")}
          </Button>
        )}
      </div>
      {!dex ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label={t("loading")} />
      ) : (
        <>
          <div className="grid max-h-80 grid-cols-4 gap-2 overflow-y-auto pr-1 sm:grid-cols-6 lg:grid-cols-8" role="listbox" aria-label={t("pokemon")}>
            {list.slice(0, shown).map((p) => (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={p.id === current?.id}
                title={`#${p.id} ${local?.species[p.id] ?? p.name}`}
                onClick={() => onPick({ id: p.id, shiny })}
                className={cn("flex flex-col items-center rounded-md border p-1 text-[10px] hover:border-screen/60", p.id === current?.id ? "border-screen bg-screen/10" : "border-border")}
                data-testid={`about-mon-${p.id}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={artUrl(p.id, 96, shiny)} alt="" loading="lazy" decoding="async" width={48} height={48} className="h-12 w-12 object-contain" />
                <span className="w-full truncate text-center">{local?.species[p.id] ?? p.name}</span>
              </button>
            ))}
          </div>
          {list.length === 0 && <p className="text-sm text-muted-foreground">{t("noMatch")}</p>}
          {list.length > shown && (
            <Button size="sm" variant="ghost" onClick={() => setShown((s) => s + PAGE)}>
              {t("more")}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

/** A TCG card slot: search the Pokémon TCG by name, in the same style as the Pokémon picker. */
function CardPicker({ label, t, current, onPick }: { label: string; t: AboutT; current?: AboutCard; onPick: (c: AboutCard | null) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CardTile[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      setLoading(true);
      setFailed(false);
      fetch(`/api/tcg/search?q=${encodeURIComponent(term)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: { cards: CardTile[] }) => live && setResults(d.cards))
        .catch(() => live && setFailed(true))
        .finally(() => live && setLoading(false));
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);

  return (
    <div className="space-y-3 rounded-lg border bg-card p-3" data-testid="about-card-picker">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm font-semibold">
          {label} <span className="text-xs font-normal text-muted-foreground">· {t("anyCard")}</span>
        </p>
        <label className="relative">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("cardSearchPlaceholder")} aria-label={t("cardSearchLabel")} className={cn(FIELD, "w-56 pl-8")} data-testid="about-card-search" />
        </label>
        {current && (
          <Button size="sm" variant="ghost" onClick={() => onPick(null)} data-testid="about-card-clear">
            {t("clear")}
          </Button>
        )}
      </div>
      {loading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label={t("searching")} />}
      {failed && <p className="text-sm text-muted-foreground">{t("cardSearchDown")}</p>}
      {!results && !loading && <p className="text-sm text-muted-foreground">{t("typeTwo")}</p>}
      {results && results.length === 0 && <p className="text-sm text-muted-foreground">{t("noMatch")}</p>}
      {results && results.length > 0 && (
        <div className="grid max-h-80 grid-cols-4 gap-2 overflow-y-auto pr-1 sm:grid-cols-6 lg:grid-cols-8" role="listbox" aria-label={t("cards")}>
          {results.map((c) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={c.id === current?.id}
              title={`${c.name}${c.setName ? ` · ${c.setName}` : ""}${c.number ? ` #${c.number}` : ""}`}
              onClick={() => onPick({ id: c.id, name: c.name, image: c.image, set: c.setName })}
              className={cn("flex flex-col items-center rounded-md border p-1 text-[10px] hover:border-screen/60", c.id === current?.id ? "border-screen bg-screen/10" : "border-border")}
              data-testid="about-card-option"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {c.image && <img src={c.image} alt="" loading="lazy" decoding="async" width={57} height={80} className="h-20 w-auto rounded-[3px] object-contain" />}
              <span className="w-full truncate text-center">{c.name}</span>
              {c.setName && <span className="w-full truncate text-center text-muted-foreground">{c.setName}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
