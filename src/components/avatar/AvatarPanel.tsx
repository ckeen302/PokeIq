"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Lock, Search, Sparkles } from "lucide-react";
import { AVATAR_FRAMES, SHINY_HINT, frameHint, frameUnlocked, shinyUnlocked, type Avatar as AvatarChoice, type AvatarFrame, type AvatarSettings } from "@/lib/avatar";
import { setAccountAvatar, useAccount } from "@/lib/account";
import { artUrl } from "@/lib/pokemon/art";
import { TYPE_COLORS } from "@/lib/pokemon/type-colors";
import type { Pokemon } from "@/lib/pokemon/pokedex";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Avatar } from "./Avatar";

/**
 * The avatar picker on the trainer card (accounts only): any Pokémon, by
 * name, generation or type; shiny from level 10; frames from level
 * milestones and ranked tiers. Locked choices say how to unlock them. The
 * server checks every pick again.
 */

const PAGE = 120;
const FIELD = "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
type Mon = Pick<Pokemon, "id" | "name" | "gen" | "types">;

export function AvatarPanel() {
  const account = useAccount();
  const [settings, setSettings] = useState<AvatarSettings | null>(null);
  const [draft, setDraft] = useState<AvatarChoice | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const userId = account.user?.id;

  useEffect(() => {
    if (!userId) return;
    let live = true;
    fetch("/api/avatar", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<AvatarSettings>) : null))
      .then((s) => {
        if (!live || !s) return;
        setSettings(s);
        setDraft(s.avatar);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [userId]);

  if (!account.user) return null;
  if (!settings || !draft) return null;
  const u = settings.unlocks;
  const changed = JSON.stringify(draft) !== JSON.stringify(settings.avatar);

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/avatar", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const body = (await res.json().catch(() => ({}))) as { avatar?: AvatarChoice; error?: string };
      if (!res.ok || !body.avatar) throw new Error(body.error ?? "Couldn't save your avatar.");
      setSettings((s) => (s ? { ...s, avatar: body.avatar! } : s));
      setAccountAvatar(body.avatar);
      setSaved(true);
      setOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card data-testid="avatar-panel">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg">Avatar</CardTitle>
        {settings.available ? (
          <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)} data-testid="avatar-change">
            {open ? "Close" : "Change avatar"}
          </Button>
        ) : (
          <span className="text-sm text-muted-foreground">Picking an avatar opens soon.</span>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <Avatar avatar={draft} size={72} />
          <div className="space-y-1 text-sm">
            <p className="text-muted-foreground">
              Shown next to your name in the header, chats, lobbies, friends and leaderboards.
              {saved && !changed && <span className="ml-1 text-success">Saved!</span>}
            </p>
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
          </div>
        </div>

        {open && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <LockedToggle locked={!shinyUnlocked(u)} hint={SHINY_HINT}>
                <label className={cn("flex items-center gap-2 text-sm", !shinyUnlocked(u) && "opacity-60")}>
                  <input type="checkbox" checked={draft.shiny} disabled={!shinyUnlocked(u)} onChange={(e) => setDraft({ ...draft, shiny: e.target.checked })} data-testid="avatar-shiny" />
                  <Sparkles className="h-4 w-4 text-[#f2c14e]" aria-hidden /> Shiny
                </label>
              </LockedToggle>
            </div>

            <div className="space-y-2">
              <p className="hud-label">Frame</p>
              <div className="flex flex-wrap gap-2">
                {AVATAR_FRAMES.map((f) => {
                  const locked = !frameUnlocked(f.id, u);
                  return (
                    <button
                      key={f.id}
                      type="button"
                      disabled={locked}
                      title={locked ? frameHint(f.id) : f.name}
                      onClick={() => setDraft({ ...draft, frame: f.id as AvatarFrame })}
                      className={cn("flex items-center gap-2 rounded-md border px-2 py-1 text-xs", draft.frame === f.id ? "border-screen bg-screen/10" : "border-border", locked && "cursor-not-allowed opacity-60")}
                      data-testid={`avatar-frame-${f.id}`}
                    >
                      <Avatar avatar={{ ...draft, frame: f.id }} size={24} />
                      <span>{f.name}</span>
                      {locked && (
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <Lock className="h-3 w-3" aria-hidden /> {frameHint(f.id)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <MonGrid selected={draft.pokemonId} shiny={draft.shiny} onPick={(id) => setDraft({ ...draft, pokemonId: id })} />

            <div className="flex gap-2">
              <Button onClick={save} disabled={!changed || saving} data-testid="avatar-save">
                {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Save avatar
              </Button>
              <Button variant="ghost" onClick={() => setDraft(settings.avatar)} disabled={!changed}>
                Reset
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LockedToggle({ locked, hint, children }: { locked: boolean; hint: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2" title={locked ? hint : undefined}>
      {children}
      {locked && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Lock className="h-3 w-3" aria-hidden /> {hint}
        </span>
      )}
    </span>
  );
}

function MonGrid({ selected, shiny, onPick }: { selected: number; shiny: boolean; onPick: (id: number) => void }) {
  const [dex, setDex] = useState<Mon[] | null>(null);
  const [query, setQuery] = useState("");
  const [gen, setGen] = useState(0);
  const [type, setType] = useState("");
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    let live = true;
    // The Pokédex is big: load it only when the picker opens.
    void import("@/lib/pokemon/pokedex").then((m) => live && setDex(m.POKEDEX.map(({ id, name, gen, types }) => ({ id, name, gen, types }))));
    return () => {
      live = false;
    };
  }, []);

  const gens = useMemo(() => [...new Set((dex ?? []).map((p) => p.gen))].sort((a, b) => a - b), [dex]);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (dex ?? []).filter((p) => (!q || p.name.toLowerCase().includes(q) || String(p.id) === q) && (!gen || p.gen === gen) && (!type || (p.types as string[]).includes(type)));
  }, [dex, query, gen, type]);

  useEffect(() => setShown(PAGE), [query, gen, type]);

  if (!dex) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading Pokémon" />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <label className="relative">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name" aria-label="Search Pokémon by name" className={cn(FIELD, "w-56 pl-8")} data-testid="avatar-search" />
        </label>
        <select value={gen} onChange={(e) => setGen(Number(e.target.value))} aria-label="Generation" className={FIELD}>
          <option value={0}>All generations</option>
          {gens.map((g) => (
            <option key={g} value={g}>
              Gen {g}
            </option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type" className={FIELD}>
          <option value="">All types</option>
          {Object.keys(TYPE_COLORS).map((t) => (
            <option key={t} value={t}>
              {t[0].toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>
        <span className="self-center text-xs text-muted-foreground">{list.length} Pokémon</span>
      </div>
      <div className="grid max-h-96 grid-cols-6 gap-2 overflow-y-auto pr-1 sm:grid-cols-8 lg:grid-cols-10" role="listbox" aria-label="Pokémon">
        {list.slice(0, shown).map((p) => (
          <button
            key={p.id}
            type="button"
            role="option"
            aria-selected={p.id === selected}
            title={`#${p.id} ${p.name}`}
            onClick={() => onPick(p.id)}
            className={cn("flex flex-col items-center rounded-md border p-1 text-[10px] hover:border-screen/60", p.id === selected ? "border-screen bg-screen/10" : "border-border")}
            data-testid={`avatar-mon-${p.id}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={artUrl(p.id, 96, shiny)} alt="" loading="lazy" decoding="async" width={48} height={48} className="h-12 w-12 object-contain" />
            <span className="w-full truncate text-center">{p.name}</span>
          </button>
        ))}
      </div>
      {list.length > shown && (
        <Button size="sm" variant="ghost" onClick={() => setShown((s) => s + PAGE)}>
          Show more
        </Button>
      )}
    </div>
  );
}
