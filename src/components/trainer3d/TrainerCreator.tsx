"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, Dices, Hand, Loader2, Lock, RotateCcw, Shirt, Sparkles, Swords, Trash2, User } from "lucide-react";
import {
  BALLS,
  BODIES,
  BOTTOMS,
  COLORS,
  EYES,
  GLOVES,
  HAIRS,
  HAIR_COLORS,
  HATS,
  PACKS,
  SHOES,
  SKINS,
  TOPS,
  TRAINER_FIELD_KEYS,
  TRAINER_FIELDS,
  lockedItems,
  starterTrainer,
  unlockHint,
  unlocked,
  type Preset,
  type Swatch,
  type TrainerConfig,
  type TrainerField,
  type TrainerPose,
} from "@/lib/trainer/config";
import { SHINY_HINT, shinyUnlocked, type AvatarUnlocks, type PublicAvatar } from "@/lib/avatar";
import { forgetTrainer, type TrainerSettings } from "@/lib/trainer/client";
import { setAccountAvatar, useAccount } from "@/lib/account";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TrainerPortrait } from "@/components/avatar/TrainerPortrait";
import { MonGrid } from "@/components/avatar/AvatarPanel";
import { cn } from "@/lib/utils";
import { Avatar3D } from "./Avatar3D";

/**
 * The trainer creator: a live 3D preview beside every preset (body, skin,
 * hair, hat, clothes, bag, Poké Ball, partner Pokémon). Locked items say how
 * to unlock them; the server checks every choice again on save. Guests can
 * play with it; saving needs an account.
 */

const NOBODY: AvatarUnlocks = { level: 1, tier: null, badges: 0 };

type Tab = "body" | "hair" | "hat" | "outfit" | "gear" | "partner";
const TABS: { id: Tab; name: string }[] = [
  { id: "body", name: "Body" },
  { id: "hair", name: "Hair" },
  { id: "hat", name: "Hat" },
  { id: "outfit", name: "Outfit" },
  { id: "gear", name: "Gear" },
];

const POSES: { id: TrainerPose; name: string; icon: typeof User }[] = [
  { id: "idle", name: "Idle", icon: User },
  { id: "wave", name: "Wave", icon: Hand },
  { id: "fight", name: "Battle", icon: Swords },
];

const BALL_TOP: Record<string, string> = { poke: "#e3262f", great: "#2f6fe0", ultra: "#24252b", master: "#7b3fc6" };

export function TrainerCreator() {
  const account = useAccount();
  const user = account.user;
  const [settings, setSettings] = useState<TrainerSettings | null>(null);
  const [draft, setDraft] = useState<TrainerConfig>(() => starterTrainer(25));
  const [tab, setTab] = useState<Tab>("body");
  const [pose, setPose] = useState<TrainerPose>("idle");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!user) return;
    let live = true;
    fetch("/api/avatar/trainer", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<TrainerSettings>) : null))
      .then((s) => {
        if (!live || !s) return;
        setSettings(s);
        setDraft(s.trainer ?? starterTrainer(s.avatar.pokemonId, s.avatar.shiny && shinyUnlocked(s.unlocks)));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [user]);

  const u = settings?.unlocks ?? NOBODY;
  const saved = settings?.trainer ?? null;
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  const locked = useMemo(() => lockedItems(draft, u), [draft, u]);
  const shinyLocked = draft.shiny && !shinyUnlocked(u);

  const set = <K extends keyof TrainerConfig>(key: K, value: TrainerConfig[K]) => {
    setMessage(null);
    setDraft((d) => ({ ...d, [key]: value }));
  };

  function surprise() {
    const next = { ...draft };
    for (const key of TRAINER_FIELD_KEYS) {
      const options = (TRAINER_FIELDS[key] as readonly Preset[]).filter((p) => unlocked(p, u));
      (next as Record<string, unknown>)[key] = options[Math.floor(Math.random() * options.length)].id;
    }
    // Keep the outfit readable: tops and accents differ, bottoms lean dark.
    if (next.accent === next.topColor) next.accent = next.topColor === "white" ? "navy" : "white";
    setMessage(null);
    setDraft(next);
  }

  async function save(remove = false) {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/avatar/trainer", remove ? { method: "DELETE" } : { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const body = (await res.json().catch(() => ({}))) as { avatar?: PublicAvatar; trainer?: TrainerConfig | null; error?: string };
      if (!res.ok || !body.avatar) throw new Error(body.error ?? "Couldn't save your trainer.");
      setSettings((s) => (s ? { ...s, trainer: body.trainer ?? null, avatar: body.avatar! } : s));
      setAccountAvatar(body.avatar);
      if (user) forgetTrainer(user.username);
      setMessage({ ok: true, text: remove ? "Removed. Your Pokémon is your avatar again." : "Saved! Your trainer now shows next to your name." });
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  const canSave = !!user && !!settings?.available && changed && !locked.length && !shinyLocked;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start">
      {/* Stage */}
      <div className="space-y-3 lg:sticky lg:top-20">
        <div className="hud relative h-[360px] overflow-hidden rounded-xl border bg-card sm:h-[460px] lg:h-[540px]" data-testid="trainer-stage">
          <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_35%,hsl(var(--screen)/0.16),transparent_62%)]" />
          <div aria-hidden className="absolute inset-x-[8%] bottom-[5%] h-[16%] rounded-[50%] bg-[radial-gradient(ellipse_at_center,hsl(var(--foreground)/0.09),transparent_70%)]" />
          <Avatar3D config={draft} pose={pose} label={user ? `${user.username}'s trainer` : "Your trainer"} />
          <div className="absolute left-3 top-3 flex items-center gap-2">
            <TrainerPortrait trainer={draft} size={36} className="rounded-full ring-1 ring-border" />
            <div className="leading-tight">
              <p className="hud-label text-screen">Trainer</p>
              <p className="font-display text-sm font-bold uppercase tracking-wide">{user?.username ?? "You"}</p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="radiogroup" aria-label="Pose" className="inline-flex rounded-lg border bg-card p-1">
            {POSES.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={pose === p.id}
                onClick={() => setPose(p.id)}
                className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1.5 sm:px-3 text-xs font-semibold uppercase tracking-wide transition-colors", pose === p.id ? "bg-screen/15 text-foreground" : "text-muted-foreground hover:text-foreground")}
                data-testid={`trainer-pose-${p.id}`}
              >
                <p.icon className="h-3.5 w-3.5" aria-hidden /> {p.name}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={surprise} aria-label="Surprise me" title="Surprise me" data-testid="trainer-surprise">
            <Dices className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Surprise me</span>
          </Button>
        </div>
      </div>

      {/* Options */}
      <Card className="min-w-0">
        <div role="tablist" aria-label="Creator sections" className="flex gap-1 overflow-x-auto border-b px-3 pt-3 [scrollbar-width:none]">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn("-mb-px shrink-0 border-b-2 px-3 pb-2.5 pt-1 font-display text-sm font-semibold uppercase tracking-wide transition-colors", tab === t.id ? "border-screen text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
              data-testid={`trainer-tab-${t.id}`}
            >
              {t.name}
            </button>
          ))}
        </div>
        <CardContent className="space-y-5 p-4 sm:p-5" role="tabpanel">
          {tab === "body" && (
            <>
              <Chips label="Build" field="body" list={BODIES} draft={draft} u={u} set={set} />
              <Swatches label="Skin tone" field="skin" list={SKINS} draft={draft} u={u} set={set} />
              <Tiles label="Eyes" field="eyes" list={EYES} draft={draft} u={u} set={set} zoom />
            </>
          )}
          {tab === "hair" && (
            <>
              <Tiles label="Style" field="hair" list={HAIRS} draft={draft} u={u} set={set} preview={(d) => ({ ...d, hat: "none" })} />
              <Swatches label="Colour" field="hairColor" list={HAIR_COLORS} draft={draft} u={u} set={set} />
            </>
          )}
          {tab === "hat" && (
            <>
              <Tiles label="Hat" field="hat" list={HATS} draft={draft} u={u} set={set} />
              {draft.hat !== "none" && <Swatches label="Hat colour" field="hatColor" list={COLORS} draft={draft} u={u} set={set} />}
            </>
          )}
          {tab === "outfit" && (
            <>
              <Tiles label="Top" field="top" list={TOPS} draft={draft} u={u} set={set} icon={Shirt} />
              <Swatches label="Top colour" field="topColor" list={COLORS} draft={draft} u={u} set={set} />
              <Swatches label="Accent colour" field="accent" list={COLORS} draft={draft} u={u} set={set} hint="Shirt under jackets, stripes, gloves, trims" />
              <Chips label="Bottoms" field="bottoms" list={BOTTOMS} draft={draft} u={u} set={set} />
              <Swatches label="Bottoms colour" field="bottomsColor" list={COLORS} draft={draft} u={u} set={set} />
              <Chips label="Shoes" field="shoes" list={SHOES} draft={draft} u={u} set={set} />
              <Swatches label="Shoes colour" field="shoesColor" list={COLORS} draft={draft} u={u} set={set} />
              <Chips label="Gloves" field="gloves" list={GLOVES} draft={draft} u={u} set={set} />
            </>
          )}
          {tab === "gear" && (
            <>
              <Tiles label="Bag" field="pack" list={PACKS} draft={draft} u={u} set={set} />
              {draft.pack !== "none" && <Swatches label="Bag colour" field="packColor" list={COLORS} draft={draft} u={u} set={set} />}
              <Group label="Poké Ball">
                <div className="flex flex-wrap gap-2">
                  {BALLS.map((b) => {
                    const lock = !unlocked(b, u);
                    return (
                      <Option key={b.id} selected={draft.ball === b.id} locked={lock} hint={unlockHint(b)} onClick={() => set("ball", b.id)} testid={`trainer-ball-${b.id}`}>
                        <BallIcon top={BALL_TOP[b.id]} />
                        {b.name}
                      </Option>
                    );
                  })}
                </div>
              </Group>
            </>
          )}
          {tab === "partner" && (
            <>
              <Group label="Shiny">
                <label className={cn("inline-flex items-center gap-2 text-sm", !shinyUnlocked(u) && "opacity-60")} title={shinyUnlocked(u) ? undefined : SHINY_HINT}>
                  <input type="checkbox" checked={draft.shiny} disabled={!shinyUnlocked(u)} onChange={(e) => set("shiny", e.target.checked)} data-testid="trainer-shiny" />
                  <Sparkles className="h-4 w-4 text-[#f2c14e]" aria-hidden /> Shiny partner
                  {!shinyUnlocked(u) && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Lock className="h-3 w-3" aria-hidden /> {SHINY_HINT}
                    </span>
                  )}
                </label>
              </Group>
              <MonGrid selected={draft.partner} shiny={draft.shiny} onPick={(id) => set("partner", id)} />
            </>
          )}
        </CardContent>
        <div className="flex flex-wrap items-center gap-2 border-t p-4 sm:px-5">
          {user ? (
            <>
              <Button onClick={() => save()} disabled={!canSave || saving} data-testid="trainer-save">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />} Save trainer
              </Button>
              <Button variant="ghost" onClick={() => saved && setDraft(saved)} disabled={!saved || !changed || saving}>
                <RotateCcw className="h-4 w-4" aria-hidden /> Undo changes
              </Button>
              {saved && (
                <Button variant="ghost" className="sm:ml-auto" onClick={() => window.confirm("Remove your trainer? Your Pokémon becomes your avatar again.") && save(true)} disabled={saving} data-testid="trainer-remove">
                  <Trash2 className="h-4 w-4" aria-hidden /> Remove
                </Button>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              <Link href="/login?next=/trainer/avatar" className="font-semibold text-primary hover:underline">
                Sign in
              </Link>{" "}
              to save your trainer and show it next to your name.
            </p>
          )}
          {settings && !settings.available && <p className="w-full text-sm text-muted-foreground">Saving trainers opens soon.</p>}
          {(locked.length > 0 || shinyLocked) && (
            <p className="flex w-full items-center gap-1.5 text-sm text-muted-foreground" data-testid="trainer-locked">
              <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden /> {locked.length ? `${locked[0].item.name}: ${unlockHint(locked[0].item).toLowerCase()} to save it.` : `${SHINY_HINT}.`}
            </p>
          )}
          {message && (
            <p role={message.ok ? "status" : "alert"} className={cn("w-full text-sm", message.ok ? "text-success" : "text-destructive")}>
              {message.text}
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Option pickers
// ---------------------------------------------------------------------------

interface PickerProps<F extends TrainerField> {
  label: string;
  field: F;
  list: readonly Preset[];
  draft: TrainerConfig;
  u: AvatarUnlocks;
  set: <K extends keyof TrainerConfig>(key: K, value: TrainerConfig[K]) => void;
  hint?: string;
}

function Group({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="hud-label">
        {label}
        {hint && <span className="ml-2 normal-case tracking-normal text-muted-foreground/80">{hint}</span>}
      </p>
      {children}
    </div>
  );
}

function Option({ selected, locked, hint, onClick, children, testid, className }: { selected: boolean; locked: boolean; hint: string; onClick: () => void; children: React.ReactNode; testid?: string; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      title={locked ? hint : undefined}
      onClick={onClick}
      className={cn(
        "relative flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors",
        selected ? "border-screen bg-screen/10 text-foreground" : "border-border text-muted-foreground hover:border-screen/50 hover:text-foreground",
        locked && "opacity-70",
        className,
      )}
      data-testid={testid}
      data-locked={locked || undefined}
    >
      {children}
      {locked && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-label={hint} />}
    </button>
  );
}

function Chips<F extends TrainerField>({ label, field, list, draft, u, set, hint }: PickerProps<F>) {
  return (
    <Group label={label} hint={hint}>
      <div className="flex flex-wrap gap-2">
        {list.map((p) => (
          <Option key={p.id} selected={draft[field] === p.id} locked={!unlocked(p, u)} hint={unlockHint(p)} onClick={() => set(field, p.id as TrainerConfig[F])} testid={`trainer-${field}-${p.id}`}>
            {p.name}
          </Option>
        ))}
      </div>
    </Group>
  );
}

function Tiles<F extends TrainerField>({ label, field, list, draft, u, set, hint, preview, zoom }: PickerProps<F> & { preview?: (d: TrainerConfig) => TrainerConfig; zoom?: boolean; icon?: typeof Shirt }) {
  return (
    <Group label={label} hint={hint}>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {list.map((p) => {
          const lock = !unlocked(p, u);
          const look = { ...(preview ? preview(draft) : draft), [field]: p.id } as TrainerConfig;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={draft[field] === p.id}
              title={lock ? unlockHint(p) : p.name}
              onClick={() => set(field, p.id as TrainerConfig[F])}
              className={cn(
                "group relative flex flex-col items-center gap-1 rounded-lg border p-1.5 text-[11px] font-semibold transition-colors",
                draft[field] === p.id ? "border-screen bg-screen/10 text-foreground" : "border-border text-muted-foreground hover:border-screen/50 hover:text-foreground",
              )}
              data-testid={`trainer-${field}-${p.id}`}
              data-locked={lock || undefined}
            >
              <span className="block aspect-square w-full overflow-hidden rounded-md">
                <TrainerPortrait trainer={look} size={72} className={cn("h-full w-full transition-transform group-hover:scale-105", zoom && "origin-[50%_48%] scale-[1.6] group-hover:scale-[1.7]", lock && "opacity-60 grayscale-[35%]")} />
              </span>
              <span className="w-full truncate text-center leading-tight">{p.name}</span>
              {lock && (
                <span className="absolute right-1 top-1 rounded-full bg-background/90 p-1 shadow-sm">
                  <Lock className="h-3 w-3" aria-label={unlockHint(p)} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </Group>
  );
}

function Swatches<F extends TrainerField>({ label, field, list, draft, u, set, hint }: PickerProps<F>) {
  return (
    <Group label={label} hint={hint}>
      <div className="flex flex-wrap gap-2">
        {(list as readonly Swatch[]).map((c) => {
          const lock = !unlocked(c, u);
          const on = draft[field] === c.id;
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={on}
              aria-label={lock ? `${c.name} (${unlockHint(c).toLowerCase()})` : c.name}
              title={lock ? `${c.name}: ${unlockHint(c)}` : c.name}
              onClick={() => set(field, c.id as TrainerConfig[F])}
              className={cn("relative h-8 w-8 rounded-full border border-foreground/15 shadow-inner transition-transform hover:scale-110", on && "ring-2 ring-screen ring-offset-2 ring-offset-card")}
              style={{ background: c.hex }}
              data-testid={`trainer-${field}-${c.id}`}
              data-locked={lock || undefined}
            >
              {lock && (
                <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/35">
                  <Lock className="h-3.5 w-3.5 text-white" aria-hidden />
                </span>
              )}
              {on && !lock && <Check className="absolute inset-0 m-auto h-4 w-4 text-white mix-blend-difference" aria-hidden />}
            </button>
          );
        })}
      </div>
    </Group>
  );
}

function BallIcon({ top }: { top: string }) {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden>
      <path d="M1.5 10 A8.5 8.5 0 0 1 18.5 10 Z" fill={top} />
      <path d="M1.5 10 A8.5 8.5 0 0 0 18.5 10 Z" fill="#f6f6f2" />
      <path d="M1.5 10 H18.5" stroke="#1b1b1f" strokeWidth="1.6" />
      <circle cx="10" cy="10" r="3" fill="#f6f6f2" stroke="#1b1b1f" strokeWidth="1.6" />
      <circle cx="10" cy="10" r="8.5" fill="none" stroke="#1b1b1f" strokeWidth="1.2" />
    </svg>
  );
}
