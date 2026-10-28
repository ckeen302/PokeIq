"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock, Loader2, Lock, Search, Sparkles, Trash2, Upload } from "lucide-react";
import {
  AVATAR_FRAMES,
  PICTURE_MAX_BYTES,
  PICTURE_TYPES,
  SHINY_HINT,
  frameHint,
  frameUnlocked,
  pictureSrc,
  shinyUnlocked,
  type Avatar as AvatarChoice,
  type AvatarFrame,
  type AvatarSettings,
  type PublicAvatar,
} from "@/lib/avatar";
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
 * name, generation or type; shiny and frames are earned by playing or by
 * ranked tiers. Locked choices say how to unlock them. The
 * server checks every pick again. Or their own picture, which nobody else
 * sees until a moderator approves it; frames apply to it too.
 */

const PAGE = 120;
const FIELD = "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
type Mon = Pick<Pokemon, "id" | "name" | "gen" | "types">;

export function AvatarPanel() {
  const account = useAccount();
  const [settings, setSettings] = useState<AvatarSettings | null>(null);
  const [draft, setDraft] = useState<AvatarChoice | null>(null);
  const [usePicture, setUsePicture] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const userId = account.user?.id;

  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    fetch("/api/avatar", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<AvatarSettings>) : null))
      .then((s) => {
        if (!live || !s) return;
        setSettings(s);
        setDraft(s.avatar);
        setUsePicture(s.usePicture);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [userId, tick]);

  if (!account.user) return null;
  if (!settings || !draft) return null;
  const u = settings.unlocks;
  const changed = JSON.stringify(draft) !== JSON.stringify(settings.avatar) || usePicture !== settings.usePicture;
  const approved = settings.pictures.approved;
  const preview: PublicAvatar = usePicture && approved ? { ...draft, picture: approved } : draft;
  /** After an upload or a delete: the header shows what everyone now sees, and the settings reload. */
  const refreshed = (avatar?: PublicAvatar) => {
    if (avatar) setAccountAvatar(avatar);
    setTick((t) => t + 1);
  };

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/avatar", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, usePicture }) });
      const body = (await res.json().catch(() => ({}))) as { avatar?: PublicAvatar; error?: string };
      if (!res.ok || !body.avatar) throw new Error(body.error ?? "Couldn't save your avatar.");
      setSettings((s) => (s ? { ...s, avatar: draft, usePicture } : s));
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
          <Avatar avatar={preview} size={72} />
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

        <Pictures settings={settings} usePicture={usePicture} setUsePicture={setUsePicture} frame={draft.frame} onChanged={refreshed} />

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
                      <Avatar avatar={{ ...preview, frame: f.id }} size={24} />
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
          </div>
        )}

        {(open || changed) && (
          <div className="flex gap-2">
            <Button onClick={save} disabled={!changed || saving} data-testid="avatar-save">
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Save avatar
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setDraft(settings.avatar);
                setUsePicture(settings.usePicture);
              }}
              disabled={!changed}
            >
              Reset
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** "Pokémon avatar" or "My picture": uploading, the picture waiting for review, replacing and deleting. */
function Pictures({
  settings,
  usePicture,
  setUsePicture,
  frame,
  onChanged,
}: {
  settings: AvatarSettings;
  usePicture: boolean;
  setUsePicture: (on: boolean) => void;
  frame: AvatarFrame;
  onChanged: (avatar?: PublicAvatar) => void;
}) {
  const p = settings.pictures;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(init: RequestInit, url: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, init);
      const body = (await res.json().catch(() => ({}))) as { avatar?: PublicAvatar; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Something went wrong. Try again.");
      onChanged(body.avatar);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function upload(file: File | undefined) {
    if (!file) return;
    if (!(PICTURE_TYPES as readonly string[]).includes(file.type)) return setError("Use a PNG, JPEG, WebP or GIF image.");
    if (file.size > PICTURE_MAX_BYTES) return setError("That image is too big: the limit is 2 MB.");
    const form = new FormData();
    form.append("file", file);
    void call({ method: "POST", body: form }, "/api/avatar/upload");
  }

  const remove = (which: "pending" | "approved") => {
    if (window.confirm(which === "pending" ? "Delete the picture waiting for review?" : "Delete your picture? You'll show your Pokémon instead.")) void call({ method: "DELETE" }, `/api/avatar/upload?which=${which}`);
  };

  return (
    <div className="space-y-3 rounded-md border p-3" data-testid="avatar-pictures">
      <div className="flex flex-wrap gap-4 text-sm" role="radiogroup" aria-label="Profile picture">
        <label className="flex items-center gap-2">
          <input type="radio" name="avatar-kind" checked={!usePicture} onChange={() => setUsePicture(false)} /> Pokémon avatar
        </label>
        <label className={cn("flex items-center gap-2", !p.open && "opacity-60")}>
          <input type="radio" name="avatar-kind" checked={usePicture} disabled={!p.open && !p.approved} onChange={() => setUsePicture(true)} data-testid="avatar-use-picture" /> My picture
        </label>
      </div>
      {!p.open ? (
        <p className="text-sm text-muted-foreground">Uploading your own picture opens soon.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-start gap-4">
            {p.approved && (
              <figure className="space-y-1 text-center text-xs">
                <Avatar avatar={{ pokemonId: 1, shiny: false, frame, picture: p.approved }} size={64} />
                <figcaption className="text-muted-foreground">Approved</figcaption>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" disabled={busy} onClick={() => remove("approved")}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete
                </Button>
              </figure>
            )}
            {p.pending && (
              <figure className="space-y-1 text-center text-xs" data-testid="avatar-pending">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={pictureSrc(p.pending.id)} alt="Your picture waiting for review" width={64} height={64} className="mx-auto h-16 w-16 rounded-full object-cover opacity-80 ring-2 ring-warning" />
                <figcaption className="flex items-center justify-center gap-1 font-semibold text-warning">
                  <Clock className="h-3 w-3" aria-hidden /> Waiting for review
                </figcaption>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" disabled={busy} onClick={() => remove("pending")}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete
                </Button>
              </figure>
            )}
          </div>
          {p.blocked ? (
            <p className="text-sm text-muted-foreground">{p.blocked}</p>
          ) : (
            <div className="space-y-1">
              <label className={cn("inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:border-screen/60", (busy || !p.left) && "pointer-events-none opacity-60")}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
                {p.approved || p.pending ? "Upload a new picture" : "Upload a picture"}
                <input
                  type="file"
                  accept={PICTURE_TYPES.join(",")}
                  className="sr-only"
                  disabled={busy || !p.left}
                  onChange={(e) => {
                    upload(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                  data-testid="avatar-upload"
                />
              </label>
              <p className="text-xs text-muted-foreground">
                PNG, JPEG, WebP or GIF, up to 2 MB. A moderator checks every picture first: until then, everyone else sees your Pokémon. Never upload a photo of yourself or anything personal. {p.left} upload{p.left === 1 ? "" : "s"} left today.
              </p>
            </div>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
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
