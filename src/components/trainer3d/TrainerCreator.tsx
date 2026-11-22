"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "@/components/ui/Link";
import { Brain, Check, Dices, Hand, Loader2, Lock, RotateCcw, Shirt, Swords, Trash2, Trophy, User, Zap } from "lucide-react";
import {
  BALLS,
  BANGS,
  BODIES,
  BOTTOMS,
  CAPES,
  COLORS,
  EARRINGS,
  EMBLEMS,
  EXPRESSIONS,
  EYES,
  EYEWEAR,
  EYE_COLORS,
  GLOVES,
  HAIRS,
  HAIR_ACCESSORIES,
  HAIR_COLORS,
  HATS,
  LEGWEAR,
  NECKWEAR,
  PACKS,
  SHOES,
  SKINS,
  STAGES,
  TOPS,
  TRAINER_FIELD_KEYS,
  TRAINER_FIELDS,
  WRISTWEAR,
  lockedItems,
  lowerFirst,
  unlockHint,
  unlocked,
  type Preset,
  type Swatch,
  type TrainerConfig,
  type TrainerField,
  type TrainerPose,
  type Unlock,
} from "@/lib/trainer/config";
import { TRAINER_PRESETS, matchPreset, presetTrainer } from "@/lib/trainer/presets";
import { shinyUnlocked, type AvatarUnlocks, type PublicAvatar } from "@/lib/avatar";
import { forgetTrainer, type TrainerSettings } from "@/lib/trainer/client";
import { setAccountAvatar, useAccount } from "@/lib/account";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TrainerPortrait } from "@/components/avatar/TrainerPortrait";
import { cn } from "@/lib/utils";
import { Avatar3D, stageStyle } from "./Avatar3D";
import { TAUNTS, type TauntId } from "@/lib/trainer/taunts";
import { useT } from "@/i18n/client";
import { INTL_LOCALE, type Translator } from "@/i18n/catalog";
import creator from "@/messages/trainer-creator";

type CreatorT = Translator<typeof creator.en>;
type ItemList = keyof typeof creator.en.items;

/** Which list of names each field's presets are in (the colours are shared). */
const FIELD_LIST: Record<TrainerField, ItemList> = {
  body: "bodies",
  skin: "skins",
  eyes: "eyes",
  eyeColor: "eyeColors",
  expr: "expressions",
  hair: "hairs",
  bangs: "bangs",
  hairColor: "hairColors",
  hat: "hats",
  hatColor: "colors",
  hatTrim: "colors",
  top: "tops",
  topColor: "colors",
  topTrim: "colors",
  accent: "colors",
  emblem: "emblems",
  bottoms: "bottoms",
  bottomsColor: "colors",
  bottomsTrim: "colors",
  legwear: "legwear",
  shoes: "shoes",
  shoesColor: "colors",
  shoesTrim: "colors",
  gloves: "gloves",
  glovesColor: "colors",
  pack: "packs",
  packColor: "colors",
  packTrim: "colors",
  cape: "capes",
  capeColor: "colors",
  capeTrim: "colors",
  eyewear: "eyewear",
  neck: "neckwear",
  wrist: "wristwear",
  hairAcc: "hairAcc",
  ears: "earrings",
  accColor: "colors",
  ball: "balls",
  stage: "stages",
};

/** An item's name in the page's language. */
const itemName = (t: CreatorT, field: TrainerField, item: { id: string; name: string }) => (t.locale === "en" ? item.name : t(`items.${FIELD_LIST[field]}.${item.id}` as never));

/**
 * How to unlock an item ("Earn 3 badges"; `lower`: "earn 3 badges", to go inside a sentence). English as
 * lib/trainer/config writes it everywhere; other languages from the namespace, the parts joined the language's way.
 */
function hintOf(t: CreatorT, item: Unlock & { name: string }, lower = false): string {
  if (t.locale === "en") return lower ? lowerFirst(unlockHint(item)) : unlockHint(item);
  const parts: string[] = [];
  if (item.badges !== undefined) parts.push(t("unlock.badges", { n: item.badges }));
  if (item.tier !== undefined) parts.push(t("unlock.tier", { tier: t(`tiers.${item.tier}`) }));
  if (item.wins !== undefined) parts.push(t("unlock.wins", { n: item.wins }));
  if (item.streak !== undefined) parts.push(t("unlock.streak", { n: item.streak }));
  const text = new Intl.ListFormat(INTL_LOCALE[t.locale], { type: "conjunction" }).format(parts);
  return lower || !text ? text : text[0].toUpperCase() + text.slice(1);
}

/**
 * The trainer creator: a live 3D preview beside every option (ready-made
 * looks, body and face, hair, hat, outfit, gear and accessories, Poké Ball
 * and backdrop). Locked items say how to unlock them; the server checks
 * every choice again on save. Guests can play with it; saving needs an
 * account.
 */

const NOBODY: AvatarUnlocks = { level: 1, tier: null, badges: 0 };

type Tab = "looks" | "body" | "hair" | "hat" | "outfit" | "gear" | "stage";
const TABS: { id: Tab }[] = [{ id: "looks" }, { id: "body" }, { id: "hair" }, { id: "hat" }, { id: "outfit" }, { id: "gear" }, { id: "stage" }];

const POSES: { id: TrainerPose; icon: typeof User }[] = [
  { id: "idle", icon: User },
  { id: "wave", icon: Hand },
  { id: "fight", icon: Swords },
  { id: "throw", icon: Zap },
  { id: "victory", icon: Trophy },
  { id: "think", icon: Brain },
];

/** Tops that can be worn open or done up. */
const OPENABLE = new Set<TrainerConfig["top"]>(["jacket", "vest", "shirt", "suit", "labcoat", "longcoat", "coat"]);
/** Tops that show an emblem. */
const EMBLEM_TOPS = new Set<TrainerConfig["top"]>(["tee", "longtee", "tank", "croptop", "uniform", "dress"]);


export function TrainerCreator() {
  const t = useT(creator);
  const account = useAccount();
  const user = account.user;
  const [settings, setSettings] = useState<TrainerSettings | null>(null);
  const [draft, setDraft] = useState<TrainerConfig>(() => presetTrainer(TRAINER_PRESETS[0], 25));
  const [tab, setTab] = useState<Tab>("looks");
  const [pose, setPose] = useState<TrainerPose>("idle");
  const [taunt, setTaunt] = useState<{ id: TauntId; n: number } | null>(null);
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
        setDraft(s.trainer ?? presetTrainer(TRAINER_PRESETS[0], s.avatar.pokemonId, s.avatar.shiny && shinyUnlocked(s.unlocks)));
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
  const current = useMemo(() => matchPreset(draft), [draft]);

  const set = <K extends keyof TrainerConfig>(key: K, value: TrainerConfig[K]) => {
    setMessage(null);
    setDraft((d) => ({ ...d, [key]: value }));
  };

  function surprise() {
    const next = { ...draft };
    const pick = <T extends Preset>(list: readonly T[]) => {
      const options = list.filter((p) => unlocked(p, u));
      return options[Math.floor(Math.random() * options.length)].id;
    };
    for (const key of TRAINER_FIELD_KEYS) (next as Record<string, unknown>)[key] = pick(TRAINER_FIELDS[key] as readonly Preset[]);
    // Keep it wearable: most trainers go without a cape or eyewear, bottoms lean dark, the backdrop stays.
    if (Math.random() < 0.75) next.cape = "none";
    if (Math.random() < 0.7) next.eyewear = "none";
    if (Math.random() < 0.5) next.hairAcc = "none";
    if (Math.random() < 0.6) next.ears = "none";
    if (next.accent === next.topColor) next.accent = next.topColor === "white" ? "navy" : "white";
    next.bangs = "auto";
    next.closed = Math.random() < 0.4;
    next.stage = draft.stage;
    setMessage(null);
    setDraft(next);
  }

  async function save(remove = false) {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/avatar/trainer", remove ? { method: "DELETE" } : { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const body = (await res.json().catch(() => ({}))) as { avatar?: PublicAvatar; trainer?: TrainerConfig | null; error?: string };
      if (!res.ok || !body.avatar) throw new Error(body.error ?? t("saveFailed"));
      setSettings((s) => (s ? { ...s, trainer: body.trainer ?? null, avatar: body.avatar! } : s));
      setAccountAvatar(body.avatar);
      if (user) forgetTrainer(user.username);
      setMessage({ ok: true, text: remove ? t("removed") : t("saved") });
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  const canSave = !!user && !!settings?.available && changed && !locked.length && !shinyLocked;
  const p = { draft, u, set };
  const backdrop = stageStyle(draft.stage);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start">
      {/* Stage */}
      <div className="space-y-3 lg:sticky lg:top-20">
        <div className="hud relative h-[380px] overflow-hidden rounded-xl border bg-card sm:h-[480px] lg:h-[560px]" data-testid="trainer-stage">
          {!backdrop && <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_35%,hsl(var(--screen)/0.16),transparent_62%)]" />}
          {!backdrop && <div aria-hidden className="absolute inset-x-[8%] bottom-[5%] h-[16%] rounded-[50%] bg-[radial-gradient(ellipse_at_center,hsl(var(--foreground)/0.09),transparent_70%)]" />}
          <Avatar3D config={draft} pose={pose} taunt={taunt} stage label={user ? t("trainerOf", { name: user.username }) : t("yourTrainer")} />
          <Button variant="outline" size="sm" onClick={surprise} className="absolute right-3 top-3 bg-background/80 backdrop-blur-sm" aria-label={t("surprise")} title={t("surprise")} data-testid="trainer-surprise">
            <Dices className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">{t("surprise")}</span>
          </Button>
          <div className={cn("absolute left-3 top-3 flex items-center gap-2 rounded-full pr-3", backdrop && "bg-background/75 backdrop-blur-sm")}>
            <TrainerPortrait trainer={draft} size={36} className="rounded-full ring-1 ring-border" />
            <div className="leading-tight">
              <p className="hud-label text-screen">{current ? (t.locale === "en" ? current.name : t(`presets.${current.id}` as never)) : t("trainer")}</p>
              <p className="font-display text-sm font-bold uppercase tracking-wide">{user?.username ?? t("you")}</p>
            </div>
          </div>
        </div>
        <div role="radiogroup" aria-label={t("pose")} className="grid grid-cols-3 gap-1 rounded-lg border bg-card p-1 sm:grid-cols-6">
          {POSES.map((po) => (
            <button
              key={po.id}
              type="button"
              role="radio"
              aria-checked={pose === po.id}
              onClick={() => setPose(po.id)}
              className={cn("flex min-w-0 items-center justify-center gap-1 rounded-md px-1 py-1.5 text-[11px] font-semibold uppercase tracking-normal transition-colors", pose === po.id ? "bg-screen/15 text-foreground" : "text-muted-foreground hover:text-foreground")}
              data-testid={`trainer-pose-${po.id}`}
            >
              <po.icon className="h-3.5 w-3.5 shrink-0" aria-hidden /> <span className="truncate">{t(`poses.${po.id}`)}</span>
            </button>
          ))}
        </div>
        <TauntPreview u={u} t={t} onPlay={(id) => setTaunt((was) => ({ id, n: (was?.n ?? 0) + 1 }))} />
      </div>

      {/* Options */}
      <Card className="min-w-0">
        <div role="tablist" aria-label={t("sections")} className="flex gap-1 overflow-x-auto border-b px-3 pt-3 [scrollbar-width:none]">
          {TABS.map((tb) => (
            <button
              key={tb.id}
              type="button"
              role="tab"
              aria-selected={tab === tb.id}
              onClick={() => setTab(tb.id)}
              className={cn("-mb-px shrink-0 border-b-2 px-2.5 pb-2.5 pt-1 font-display text-sm font-semibold uppercase tracking-wide transition-colors sm:px-3", tab === tb.id ? "border-screen text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
              data-testid={`trainer-tab-${tb.id}`}
            >
              {t(`tabs.${tb.id}`)}
            </button>
          ))}
        </div>
        <CardContent className="space-y-5 p-4 sm:p-5" role="tabpanel">
          {tab === "looks" && (
            <Group label={t("startLook")} hint={t("startHint")}>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {TRAINER_PRESETS.map((preset) => {
                  const on = current?.id === preset.id;
                  const look = presetTrainer(preset, draft.partner, draft.shiny);
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        setMessage(null);
                        setDraft({ ...look, stage: draft.stage });
                      }}
                      className={cn(
                        "group relative flex flex-col items-center gap-1 rounded-lg border p-1.5 text-[11px] font-semibold transition-colors",
                        on ? "border-screen bg-screen/10 text-foreground" : "border-border text-muted-foreground hover:border-screen/50 hover:text-foreground",
                      )}
                      data-testid={`trainer-preset-${preset.id}`}
                    >
                      <span className="block aspect-square w-full overflow-hidden rounded-md">
                        <TrainerPortrait trainer={look} size={88} className="h-full w-full transition-transform group-hover:scale-105" />
                      </span>
                      <span className="w-full text-center leading-tight">{t.locale === "en" ? preset.name : t(`presets.${preset.id}` as never)}</span>
                    </button>
                  );
                })}
              </div>
            </Group>
          )}
          {tab === "body" && (
            <>
              <Chips label={t("labels.build")} field="body" list={BODIES} {...p} t={t} />
              <Swatches label={t("labels.skin")} field="skin" list={SKINS} {...p} t={t} />
              <Tiles label={t("labels.eyes")} field="eyes" list={EYES} {...p} t={t} zoom />
              <Swatches label={t("labels.eyeColor")} field="eyeColor" list={EYE_COLORS} {...p} t={t} />
              <Tiles label={t("labels.expression")} field="expr" list={EXPRESSIONS} {...p} t={t} zoom />
            </>
          )}
          {tab === "hair" && (
            <>
              <Tiles label={t("labels.style")} field="hair" list={HAIRS} {...p} t={t} preview={(d) => ({ ...d, hat: "none" })} />
              <Swatches label={t("labels.colour")} field="hairColor" list={HAIR_COLORS} {...p} t={t} />
              <Chips label={t("labels.fringe")} field="bangs" list={BANGS} {...p} t={t} />
              <Chips label={t("labels.hairAcc")} field="hairAcc" list={HAIR_ACCESSORIES} {...p} t={t} />
              {draft.hairAcc !== "none" && <Swatches label={t("labels.accColor")} field="accColor" list={COLORS} {...p} t={t} hint={t("hints.accShared")} />}
            </>
          )}
          {tab === "hat" && (
            <>
              <Tiles label={t("labels.hat")} field="hat" list={HATS} {...p} t={t} />
              {draft.hat !== "none" && (
                <>
                  <Swatches label={t("labels.hatColor")} field="hatColor" list={COLORS} {...p} t={t} />
                  <Swatches label={t("labels.trim")} field="hatTrim" list={COLORS} {...p} t={t} hint={t("hints.hatTrim")} />
                </>
              )}
            </>
          )}
          {tab === "outfit" && (
            <>
              <Tiles label={t("labels.top")} field="top" list={TOPS} {...p} t={t} icon={Shirt} />
              {OPENABLE.has(draft.top) && (
                <Group label={t("labels.wear")}>
                  <div className="flex flex-wrap gap-2">
                    <Option selected={!draft.closed} locked={false} hint="" onClick={() => set("closed", false)} testid="trainer-closed-open">
                      {t("open")}
                    </Option>
                    <Option selected={draft.closed} locked={false} hint="" onClick={() => set("closed", true)} testid="trainer-closed-closed">
                      {t("doneUp")}
                    </Option>
                  </div>
                </Group>
              )}
              <Swatches label={t("labels.topColor")} field="topColor" list={COLORS} {...p} t={t} />
              <Swatches label={t("labels.trim")} field="topTrim" list={COLORS} {...p} t={t} hint={t("hints.topTrim")} />
              <Swatches label={t("labels.under")} field="accent" list={COLORS} {...p} t={t} hint={t("hints.under")} />
              {EMBLEM_TOPS.has(draft.top) && <Chips label={t("labels.emblem")} field="emblem" list={EMBLEMS} {...p} t={t} />}
              <Chips label={t("labels.bottoms")} field="bottoms" list={BOTTOMS} {...p} t={t} />
              <Swatches label={t("labels.bottomsColor")} field="bottomsColor" list={COLORS} {...p} t={t} />
              <Chips label={t("labels.legwear")} field="legwear" list={LEGWEAR} {...p} t={t} />
              <Swatches label={t("labels.bottomsTrim")} field="bottomsTrim" list={COLORS} {...p} t={t} hint={t("hints.bottomsTrim")} />
              <Chips label={t("labels.shoes")} field="shoes" list={SHOES} {...p} t={t} />
              <Swatches label={t("labels.shoesColor")} field="shoesColor" list={COLORS} {...p} t={t} />
              <Swatches label={t("labels.shoesTrim")} field="shoesTrim" list={COLORS} {...p} t={t} hint={t("hints.shoesTrim")} />
            </>
          )}
          {tab === "gear" && (
            <>
              <Chips label={t("labels.gloves")} field="gloves" list={GLOVES} {...p} t={t} />
              {draft.gloves !== "none" && <Swatches label={t("labels.glovesColor")} field="glovesColor" list={COLORS} {...p} t={t} />}
              <Chips label={t("labels.bag")} field="pack" list={PACKS} {...p} t={t} />
              {draft.pack !== "none" && (
                <>
                  <Swatches label={t("labels.bagColor")} field="packColor" list={COLORS} {...p} t={t} />
                  <Swatches label={t("labels.bagTrim")} field="packTrim" list={COLORS} {...p} t={t} hint={t("hints.bagTrim")} />
                </>
              )}
              <Chips label={t("labels.cape")} field="cape" list={CAPES} {...p} t={t} />
              {draft.cape !== "none" && (
                <>
                  <Swatches label={t("labels.capeColor")} field="capeColor" list={COLORS} {...p} t={t} />
                  <Swatches label={t("labels.lining")} field="capeTrim" list={COLORS} {...p} t={t} hint={draft.cape === "royal" ? t("hints.fur") : undefined} />
                </>
              )}
              <Chips label={t("labels.eyewear")} field="eyewear" list={EYEWEAR} {...p} t={t} />
              <Chips label={t("labels.neck")} field="neck" list={NECKWEAR} {...p} t={t} />
              <Chips label={t("labels.wrists")} field="wrist" list={WRISTWEAR} {...p} t={t} />
              <Chips label={t("labels.earrings")} field="ears" list={EARRINGS} {...p} t={t} />
              <Swatches label={t("labels.accColor")} field="accColor" list={COLORS} {...p} t={t} hint={t("hints.accGear")} />
              <Group label={t("labels.ball")}>
                <div className="flex flex-wrap gap-2">
                  {BALLS.map((b) => {
                    const lock = !unlocked(b, u);
                    return (
                      <Option key={b.id} selected={draft.ball === b.id} locked={lock} hint={hintOf(t, b)} onClick={() => set("ball", b.id)} testid={`trainer-ball-${b.id}`}>
                        <BallIcon top={b.top} bottom={b.bottom} />
                        {itemName(t, "ball", b)}
                      </Option>
                    );
                  })}
                </div>
              </Group>
            </>
          )}
          {tab === "stage" && (
            <Group label={t("labels.backdrop")} hint={t("hints.backdrop")}>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {STAGES.map((s) => {
                  const lock = !unlocked(s, u);
                  const style = stageStyle(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={draft.stage === s.id}
                      title={lock ? hintOf(t, s) : itemName(t, "stage", s)}
                      onClick={() => set("stage", s.id)}
                      className={cn(
                        "relative flex flex-col items-center gap-1 rounded-lg border p-1.5 text-[11px] font-semibold transition-colors",
                        draft.stage === s.id ? "border-screen bg-screen/10 text-foreground" : "border-border text-muted-foreground hover:border-screen/50 hover:text-foreground",
                      )}
                      data-testid={`trainer-stage-${s.id}`}
                      data-locked={lock || undefined}
                    >
                      <span className={cn("block aspect-[4/3] w-full rounded-md border border-foreground/10", !style && "bg-[radial-gradient(ellipse_at_50%_35%,hsl(var(--screen)/0.16),transparent_62%)]", lock && "opacity-60")} style={style ?? undefined} />
                      <span className="w-full truncate text-center leading-tight">{itemName(t, "stage", s)}</span>
                      {lock && (
                        <span className="absolute right-1 top-1 rounded-full bg-background/90 p-1 shadow-sm">
                          <Lock className="h-3 w-3" aria-label={hintOf(t, s)} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </Group>
          )}
        </CardContent>
        <div className="flex flex-wrap items-center gap-2 border-t p-4 sm:px-5">
          {user ? (
            <>
              <Button onClick={() => save()} disabled={!canSave || saving} data-testid="trainer-save">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />} {t("save")}
              </Button>
              <Button variant="ghost" onClick={() => saved && setDraft(saved)} disabled={!saved || !changed || saving}>
                <RotateCcw className="h-4 w-4" aria-hidden /> {t("undo")}
              </Button>
              {saved && (
                <Button variant="ghost" className="sm:ml-auto" onClick={() => window.confirm(t("confirmRemove")) && save(true)} disabled={saving} data-testid="trainer-remove">
                  <Trash2 className="h-4 w-4" aria-hidden /> {t("remove")}
                </Button>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t.rich("signIn", {
                link: (c) => (
                  <Link href="/login?next=/trainer/avatar" className="font-semibold text-primary hover:underline">
                    {c}
                  </Link>
                ),
              })}
            </p>
          )}
          {settings && !settings.available && <p className="w-full text-sm text-muted-foreground">{t("soon")}</p>}
          {(locked.length > 0 || shinyLocked) && (
            <p className="flex w-full items-center gap-1.5 text-sm text-muted-foreground" data-testid="trainer-locked">
              <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden /> {locked.length ? t("lockedSave", { item: itemName(t, locked[0].field, locked[0].item), hint: hintOf(t, locked[0].item, true) }) : t("shinyLocked")}
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
  t: CreatorT;
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

function Chips<F extends TrainerField>({ label, field, list, draft, u, set, hint, t }: PickerProps<F>) {
  return (
    <Group label={label} hint={hint}>
      <div className="flex flex-wrap gap-2">
        {list.map((p) => (
          <Option key={p.id} selected={draft[field] === p.id} locked={!unlocked(p, u)} hint={hintOf(t, p)} onClick={() => set(field, p.id as TrainerConfig[F])} testid={`trainer-${field}-${p.id}`}>
            {itemName(t, field, p)}
          </Option>
        ))}
      </div>
    </Group>
  );
}

function Tiles<F extends TrainerField>({ label, field, list, draft, u, set, hint, preview, zoom, t }: PickerProps<F> & { preview?: (d: TrainerConfig) => TrainerConfig; zoom?: boolean; icon?: typeof Shirt }) {
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
              title={lock ? hintOf(t, p) : itemName(t, field, p)}
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
              <span className="w-full truncate text-center leading-tight">{itemName(t, field, p)}</span>
              {lock && (
                <span className="absolute right-1 top-1 rounded-full bg-background/90 p-1 shadow-sm">
                  <Lock className="h-3 w-3" aria-label={hintOf(t, p)} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </Group>
  );
}

function Swatches<F extends TrainerField>({ label, field, list, draft, u, set, hint, t }: PickerProps<F>) {
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
              aria-label={lock ? t("swatchLocked", { name: itemName(t, field, c), hint: hintOf(t, c, true) }) : itemName(t, field, c)}
              title={lock ? t("lockedTitle", { name: itemName(t, field, c), hint: hintOf(t, c) }) : itemName(t, field, c)}
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

function BallIcon({ top, bottom }: { top: string; bottom: string }) {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden>
      <path d="M1.5 10 A8.5 8.5 0 0 1 18.5 10 Z" fill={top} />
      <path d="M1.5 10 A8.5 8.5 0 0 0 18.5 10 Z" fill={bottom} />
      <path d="M1.5 10 H18.5" stroke="#1b1b1f" strokeWidth="1.6" />
      <circle cx="10" cy="10" r="3" fill="#f6f6f2" stroke="#1b1b1f" strokeWidth="1.6" />
      <circle cx="10" cy="10" r="8.5" fill="none" stroke="#1b1b1f" strokeWidth="1.2" />
    </svg>
  );
}

/** The dances and emotes trainers play after a duel: a tap previews one here (locked ones too, with how to earn them). */
function TauntPreview({ u, t, onPlay }: { u: AvatarUnlocks; t: CreatorT; onPlay: (id: TauntId) => void }) {
  return (
    <div className="space-y-1.5 rounded-lg border bg-card p-2" data-testid="trainer-taunts">
      {(["dance", "emote"] as const).map((kind) => (
        <div key={kind} className="flex items-start gap-2">
          <p className="hud-label w-14 shrink-0 pt-1.5">{kind === "dance" ? t("dances") : t("emotes")}</p>
          <div className="flex min-w-0 flex-wrap gap-1">
            {TAUNTS.filter((m) => m.kind === kind).map((m) => {
              const lock = !unlocked(m, u);
              const name = t.locale === "en" ? m.name : t(`taunts.${m.id}`);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onPlay(m.id)}
                  title={lock ? t("tauntLocked", { name, hint: hintOf(t, m) }) : t("preview", { name })}
                  className={cn("tap", "flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold uppercase tracking-normal text-muted-foreground transition-colors hover:border-screen/50 hover:text-foreground", lock && "opacity-75")}
                  data-testid={`trainer-taunt-${m.id}`}
                  data-locked={lock || undefined}
                >
                  {name}
                  {lock && <Lock className="h-3 w-3 shrink-0" aria-label={hintOf(t, m)} />}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
