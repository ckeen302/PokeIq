"use client";

/* eslint-disable @next/next/no-img-element -- small generated thumbnails and board pictures */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Ban, Circle, Cloud, Dices, Flame, Flower2, Heart, Play, Sparkle, Star, Trash2, X, Zap, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Translator } from "@/i18n/catalog";
import msgs from "@/messages/pokeball-maker";
import { boardArtUrl } from "@/lib/pokemon/art";
import { BUTTONS, DESC_MAX, EFFECTS, FINISHES, MAX_STICKERS, NAME_MAX, PARTS, SHAPES, hexOf, rgbOf, type Design, type Effect, type Finish, type Part, type PatternLayer, type RGB } from "@/lib/pokeball-maker/design";
import { PATTERNS } from "@/lib/pokeball-maker/patterns";
import { BALL_IDS, TYPES, ballPreset, typePreset, type BallId, type TypeName } from "@/lib/pokeball-maker/presets";
import { ATLAS_GRID, GLYPH_COUNT, SYMBOL_GLYPHS, TYPE_GLYPHS, glyphInfo } from "@/lib/pokeball-maker/glyphs";
import { ballCss, BALL_SHADE } from "@/lib/pokeball-maker/css";
import { Dot } from "@/components/tools/shiny-maker/ColourControls";
import { Seg } from "@/components/tools/shiny-maker/ExtrasPanel";
import { ColourPicker } from "./ColourPicker";

export type T = Translator<typeof msgs.en>;
export type Thumb = (o: { top: RGB; bottom: RGB; band: RGB; pattern: PatternLayer | null; finish: Finish }) => string | null;

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** A labelled range slider (one undo step per drag). */
function Slider({ label, value, onBegin, onChange, testId, min = 0, max = 255 }: { label: string; value: number; onBegin: () => void; onChange: (v: number) => void; testId?: string; min?: number; max?: number }) {
  return (
    <label className="flex items-center gap-3 text-[13px] text-muted-foreground">
      <span className="w-24 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onPointerDown={onBegin}
        onKeyDown={(e) => !e.repeat && onBegin()}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 w-full accent-primary"
        data-testid={testId}
      />
    </label>
  );
}

/** A tile: a picture (or a CSS ball) over a label. */
function Tile({ on, onClick, label, children, testId, small }: { on?: boolean; onClick: () => void; label: string; children: ReactNode; testId?: string; small?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={label}
      className={cn(
        "group flex flex-col items-center gap-1.5 rounded-2xl p-2 text-center text-[11.5px] leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
        on ? "bg-white/[0.1] text-foreground" : "text-foreground/70 hover:bg-white/[0.06] hover:text-foreground"
      )}
      data-testid={testId}
    >
      <span className={cn("flex items-center justify-center", small ? "h-10 w-10" : "h-12 w-12")}>{children}</span>
      <span className="line-clamp-2 w-full">{label}</span>
    </button>
  );
}

export function CssBall({ design, size = 44, className }: { design: Design; size?: number; className?: string }) {
  return (
    <span
      className={cn("inline-block shrink-0 rounded-full", className)}
      style={{ width: size, height: size, background: ballCss(design), boxShadow: `${BALL_SHADE}, 0 2px 6px rgb(0 0 0 / 0.45)`, border: "1px solid rgb(0 0 0 / 0.55)" }}
      aria-hidden
    />
  );
}

function PartChips({ design, value, onChange, t, testId }: { design: Design; value: Part; onChange: (p: Part) => void; t: T; testId: string }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("tabs.colours")} data-testid={testId}>
      {PARTS.map((p) => (
        <button
          key={p}
          type="button"
          role="radio"
          aria-checked={value === p}
          onClick={() => onChange(p)}
          className={cn(
            "flex h-9 items-center gap-2 rounded-full border px-3 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 max-lg:h-10",
            value === p ? "border-white/25 bg-white/[0.1] text-foreground" : "border-white/[0.07] text-foreground/75 hover:border-white/15 hover:text-foreground"
          )}
          data-value={p}
        >
          <Dot color={hexOf(design.colours[p])} size={14} />
          {t(`parts.${p}`)}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------

export function StartPanel({ onPick, onType, onBlank, onRandom, onMatch, t }: { onPick: (id: BallId) => void; onType: (t: TypeName) => void; onBlank: () => void; onRandom: () => void; onMatch: () => void; t: T }) {
  const presets = useMemo(() => Object.fromEntries(BALL_IDS.map((id) => [id, ballPreset(id)])) as Record<BallId, Design>, []);
  const types = useMemo(() => Object.fromEntries(TYPES.map((ty) => [ty, typePreset(ty)])) as Record<TypeName, Design>, []);
  const hisui = (id: BallId) => presets[id].shape === "hisui";
  return (
    <div className="space-y-6" data-testid="pbm-start">
      <div className="grid grid-cols-3 gap-2">
        <button type="button" onClick={onMatch} className="col-span-3 flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-3 text-left transition-colors hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" data-testid="pbm-match">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/[0.06]">
            <img src={boardArtUrl(25)} alt="" width={40} height={40} className="h-10 w-10 object-contain" />
          </span>
          <span>
            <span className="block text-[14px] font-medium">{t("start.match")}</span>
            <span className="block text-[12.5px] text-muted-foreground">{t("start.matchHint")}</span>
          </span>
        </button>
        <button type="button" onClick={onBlank} className="flex h-11 items-center justify-center gap-2 rounded-full border border-white/[0.08] text-[13px] text-foreground/80 transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" data-testid="pbm-blank">
          {t("start.blank")}
        </button>
        <button type="button" onClick={onRandom} className="col-span-2 flex h-11 items-center justify-center gap-2 rounded-full border border-white/[0.08] text-[13px] text-foreground/80 transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
          <Dices className="h-4 w-4" aria-hidden /> {t("start.random")}
        </button>
      </div>
      <Section title={t("start.official")}>
        <div className="grid grid-cols-4 gap-1 max-sm:grid-cols-4" data-testid="pbm-presets">
          {BALL_IDS.filter((id) => !hisui(id)).map((id) => (
            <Tile key={id} onClick={() => onPick(id)} label={t(`balls.${id}`)} testId={`pbm-preset-${id}`}>
              <CssBall design={presets[id]} />
            </Tile>
          ))}
        </div>
      </Section>
      <Section title={t("start.hisui")}>
        <div className="grid grid-cols-4 gap-1">
          {BALL_IDS.filter(hisui).map((id) => (
            <Tile key={id} onClick={() => onPick(id)} label={t(`balls.${id}`)} testId={`pbm-preset-${id}`}>
              <CssBall design={presets[id]} />
            </Tile>
          ))}
        </div>
      </Section>
      <Section title={t("start.types")}>
        <div className="grid grid-cols-4 gap-1">
          {TYPES.map((ty) => (
            <Tile key={ty} onClick={() => onType(ty)} label={t(`types.${ty}`)} testId={`pbm-type-${ty}`}>
              <CssBall design={types[ty]} />
            </Tile>
          ))}
        </div>
      </Section>
    </div>
  );
}

export function ColoursPanel({ design, part, onPart, onBegin, onColour, compact, t }: { design: Design; part: Part; onPart: (p: Part) => void; onBegin: () => void; onColour: (p: Part, c: RGB) => void; compact?: boolean; t: T }) {
  return (
    <div className="space-y-5" data-testid="pbm-colours">
      <PartChips design={design} value={part} onChange={onPart} t={t} testId="pbm-parts" />
      <ColourPicker compact={compact} value={design.colours[part]} onBegin={onBegin} onChange={(c) => onColour(part, c)} label={t("colour.dialog", { part: t(`parts.${part}`) })} />
    </div>
  );
}

/** A colour well that opens a picker under it. */
function Well({ value, label, open, onToggle, testId }: { value: RGB; label: string; open: boolean; onToggle: () => void; testId?: string }) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} aria-label={label} title={label} className={cn("flex h-10 w-10 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70", open ? "bg-white/[0.12]" : "hover:bg-white/[0.06]")} data-testid={testId}>
      <Dot color={hexOf(value)} size={26} ring={open} />
    </button>
  );
}

/** A pattern's own colours (as it's first chosen). */
const defaults = (id: number) => PATTERNS[id].colours.map((h) => rgbOf(h)) as PatternLayer["colours"];

export function PatternsPanel({ design, half, onHalf, onBegin, onLayer, onBoth, thumb, compact, t }: { design: Design; half: "top" | "bottom"; onHalf: (h: "top" | "bottom") => void; onBegin: () => void; onLayer: (h: "top" | "bottom", l: PatternLayer, commit?: boolean) => void; onBoth: () => void; thumb: Thumb; compact?: boolean; t: T }) {
  const layer = design.patterns[half];
  const [well, setWell] = useState(-1);
  const base = design.colours[half];
  const def = PATTERNS[layer.id];
  return (
    <div className="space-y-5" data-testid="pbm-patterns">
      <Seg<"top" | "bottom"> label={t("patterns.half")} value={half} onChange={onHalf} testId="pbm-half" items={[{ v: "top", label: t("patterns.top") }, { v: "bottom", label: t("patterns.bottom") }]} />
      <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label={t("tabs.patterns")}>
        {PATTERNS.map((p, id) => {
          const own = id === layer.id ? layer.colours : defaults(id);
          const pic = thumb({ top: base, bottom: design.colours[half === "top" ? "bottom" : "top"], band: design.colours.band, pattern: id ? { id, colours: own, scale: id === layer.id ? layer.scale : p.scale ?? 102, rot: id === layer.id ? layer.rot : 0 } : null, finish: design.finishes[half] });
          return (
            <Tile
              key={p.key}
              small
              on={layer.id === id}
              onClick={() => {
                if (id === layer.id) return;
                onBegin();
                onLayer(half, { id, colours: defaults(id), scale: p.scale ?? 102, rot: 0 }, true);
              }}
              label={t(`patterns.names.${p.key}` as "patterns.names.none")}
              testId={`pbm-pattern-${p.key}`}
            >
              {pic ? <img src={pic} alt="" width={40} height={40} className="h-10 w-10" /> : <span className="h-9 w-9 rounded-full bg-white/[0.06]" />}
            </Tile>
          );
        })}
      </div>
      {layer.id > 0 && (
        <div className="space-y-4 border-t border-white/[0.07] pt-4">
          <Section title={t("patterns.colours")} aside={<button type="button" onClick={onBoth} className="text-[12.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" data-testid="pbm-both">{t("patterns.both")}</button>}>
            <div className="flex items-center gap-2">
              {[0, 1, 2].slice(0, Math.max(def?.uses ?? 3, 1)).map((k) => (
                <Well key={k} value={layer.colours[k]} label={t("patterns.colourN", { n: k + 1 })} open={well === k} onToggle={() => setWell((w) => (w === k ? -1 : k))} testId={`pbm-pattern-colour-${k}`} />
              ))}
            </div>
            {well >= 0 && (
              <ColourPicker
                compact={compact}
                value={layer.colours[well]}
                onBegin={onBegin}
                onChange={(c) => {
                  const cs = layer.colours.slice() as PatternLayer["colours"];
                  cs[well] = c;
                  onLayer(half, { ...layer, colours: cs });
                }}
                label={t("patterns.colourN", { n: well + 1 })}
              />
            )}
          </Section>
          <Slider label={t("patterns.scale")} value={layer.scale} onBegin={onBegin} onChange={(v) => onLayer(half, { ...layer, scale: v })} testId="pbm-pattern-scale" />
          <Slider label={t("patterns.rotation")} value={layer.rot} onBegin={onBegin} onChange={(v) => onLayer(half, { ...layer, rot: v })} testId="pbm-pattern-rot" />
        </div>
      )}
    </div>
  );
}

export function FinishPanel({ design, part, onPart, onFinish, onAll, thumb, glassReal, t }: { design: Design; part: Part; onPart: (p: Part) => void; onFinish: (p: Part, f: Finish) => void; onAll: (f: Finish) => void; thumb: Thumb; glassReal: boolean; t: T }) {
  const f = design.finishes[part];
  return (
    <div className="space-y-5" data-testid="pbm-finish">
      <PartChips design={design} value={part} onChange={onPart} t={t} testId="pbm-finish-parts" />
      <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label={t("tabs.finish")}>
        {FINISHES.map((fin) => {
          const pic = thumb({ top: design.colours[part], bottom: design.colours[part], band: design.colours.band, pattern: null, finish: fin });
          return (
            <Tile key={fin} small on={f === fin} onClick={() => onFinish(part, fin)} label={t(`finish.names.${fin}`)} testId={`pbm-finish-${fin}`}>
              {pic ? <img src={pic} alt="" width={40} height={40} className="h-10 w-10" /> : <span className="h-9 w-9 rounded-full bg-white/[0.06]" />}
            </Tile>
          );
        })}
      </div>
      <button type="button" onClick={() => onAll(f)} className="text-[12.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" data-testid="pbm-finish-all">
        {t("finish.all")}
      </button>
      {f === "glass" && !glassReal && <p className="text-[12.5px] leading-relaxed text-muted-foreground">{t("finish.glassNote")}</p>}
    </div>
  );
}

export function ShapePanel({ design, onBegin, onChange, t }: { design: Design; onBegin: () => void; onChange: (d: Partial<Design>, commit?: boolean) => void; t: T }) {
  return (
    <div className="space-y-6" data-testid="pbm-shape">
      <Section title={t("shape.shape")}>
        <Seg<Design["shape"]> label={t("shape.shape")} value={design.shape} onChange={(s) => onChange({ shape: s, ...(s === "hisui" && design.button !== "latch" ? { button: "latch" } : s !== "hisui" && design.button === "latch" ? { button: s === "faceted" ? "gem" : "classic" } : {}) }, true)} testId="pbm-shape-kind" items={SHAPES.map((s) => ({ v: s, label: t(`shape.${s}`) }))} />
      </Section>
      <Slider label={t("shape.band")} value={design.band} onBegin={onBegin} onChange={(v) => onChange({ band: v })} testId="pbm-band" />
      <Section title={t("shape.button")}>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("shape.button")} data-testid="pbm-buttons">
          {BUTTONS.map((b) => (
            <button
              key={b}
              type="button"
              role="radio"
              aria-checked={design.button === b}
              onClick={() => onChange({ button: b }, true)}
              className={cn("flex h-9 items-center rounded-full border px-3.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 max-lg:h-10", design.button === b ? "border-white/25 bg-white/[0.1] text-foreground" : "border-white/[0.07] text-foreground/75 hover:border-white/15 hover:text-foreground")}
              data-value={b}
            >
              {t(`shape.buttons.${b}`)}
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}

export function glyphName(i: number, t: T): string {
  const g = glyphInfo(i);
  if (g.kind === "type") return t(`types.${g.key as TypeName}`);
  if (g.kind === "symbol") return t(`stickers.symbolNames.${g.key as (typeof SYMBOL_GLYPHS)[number]}`);
  return g.key;
}

function Glyph({ atlas, i, size = 26 }: { atlas: string | null; i: number; size?: number }) {
  if (!atlas) return <span style={{ width: size, height: size }} className="inline-block rounded bg-white/[0.06]" />;
  return (
    <span
      aria-hidden
      className="inline-block"
      style={{
        width: size,
        height: size,
        backgroundColor: "currentColor",
        WebkitMaskImage: `url(${atlas})`,
        maskImage: `url(${atlas})`,
        WebkitMaskSize: `${ATLAS_GRID * 100}%`,
        maskSize: `${ATLAS_GRID * 100}%`,
        WebkitMaskPosition: `${((i % ATLAS_GRID) / (ATLAS_GRID - 1)) * 100}% ${(Math.floor(i / ATLAS_GRID) / (ATLAS_GRID - 1)) * 100}%`,
        maskPosition: `${((i % ATLAS_GRID) / (ATLAS_GRID - 1)) * 100}% ${(Math.floor(i / ATLAS_GRID) / (ATLAS_GRID - 1)) * 100}%`,
      }}
    />
  );
}

export interface StickerBrush {
  glyph: number;
  size: number;
  rot: number;
  colour: RGB;
}

export function StickersPanel({ design, brush, onBrush, sel, onSel, onBegin, onSticker, onRemove, onClear, atlas, touch, compact, t }: { design: Design; brush: StickerBrush; onBrush: (b: StickerBrush) => void; sel: number; onSel: (i: number) => void; onBegin: () => void; onSticker: (i: number, patch: Partial<Design["stickers"][number]>) => void; onRemove: (i: number) => void; onClear: () => void; atlas: string | null; touch: boolean; compact?: boolean; t: T }) {
  const s = sel >= 0 ? design.stickers[sel] : null;
  const glyph = s ? s.glyph : brush.glyph;
  const set = (patch: Partial<StickerBrush>) => {
    onBrush({ ...brush, ...patch });
    if (s) onSticker(sel, patch);
  };
  const [colourOpen, setColourOpen] = useState(false);
  const groups: [string, number[]][] = [
    [t("stickers.types"), TYPE_GLYPHS.map((_, i) => i)],
    [t("stickers.symbols"), SYMBOL_GLYPHS.map((_, i) => TYPE_GLYPHS.length + i)],
    [t("stickers.chars"), Array.from({ length: GLYPH_COUNT - TYPE_GLYPHS.length - SYMBOL_GLYPHS.length }, (_, i) => TYPE_GLYPHS.length + SYMBOL_GLYPHS.length + i)],
  ];
  return (
    <div className="space-y-5" data-testid="pbm-stickers">
      <p className="rounded-2xl bg-white/[0.05] px-3.5 py-2.5 text-[13px] text-foreground/85">{touch ? t("stickers.hintTouch") : t("stickers.hint")}</p>
      {groups.map(([title, ids]) => (
        <Section key={title} title={title}>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(40px,1fr))] gap-1" role="radiogroup" aria-label={title}>
            {ids.map((i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={glyph === i}
                aria-label={glyphName(i, t)}
                title={glyphName(i, t)}
                onClick={() => {
                  if (s) onBegin();
                  set({ glyph: i });
                }}
                className={cn("flex h-10 items-center justify-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70", glyph === i ? "bg-white/[0.14] text-foreground" : "text-foreground/70 hover:bg-white/[0.06] hover:text-foreground")}
                data-testid={`pbm-glyph-${i}`}
              >
                <Glyph atlas={atlas} i={i} />
              </button>
            ))}
          </div>
        </Section>
      ))}
      <div className="space-y-3 border-t border-white/[0.07] pt-4">
        <Slider label={t("stickers.size")} value={s ? s.size : brush.size} onBegin={onBegin} onChange={(v) => set({ size: v })} testId="pbm-sticker-size" />
        <Slider label={t("stickers.rotation")} value={s ? s.rot : brush.rot} onBegin={onBegin} onChange={(v) => set({ rot: v })} testId="pbm-sticker-rot" />
        <div className="flex items-center gap-3 text-[13px] text-muted-foreground">
          <span className="w-24 shrink-0">{t("stickers.colour")}</span>
          <Well value={s ? s.colour : brush.colour} label={t("stickers.colour")} open={colourOpen} onToggle={() => setColourOpen((o) => !o)} testId="pbm-sticker-colour" />
        </div>
        {colourOpen && <ColourPicker compact={compact} value={s ? s.colour : brush.colour} onBegin={onBegin} onChange={(c) => set({ colour: c })} label={t("stickers.colour")} />}
      </div>
      <Section title={t("stickers.placed")} aside={design.stickers.length ? <button type="button" onClick={onClear} className="text-[12.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">{t("stickers.clear")}</button> : null}>
        {design.stickers.length ? (
          <div className="flex flex-wrap gap-1.5" data-testid="pbm-sticker-list">
            {design.stickers.map((st, i) => (
              <span key={i} className={cn("flex h-10 items-center rounded-full border pl-1 pr-1", sel === i ? "border-white/25 bg-white/[0.1]" : "border-white/[0.07]")}>
                <button type="button" onClick={() => onSel(sel === i ? -1 : i)} aria-pressed={sel === i} aria-label={t("stickers.select", { n: i + 1, name: glyphName(st.glyph, t) })} className="flex h-8 w-8 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" style={{ color: hexOf(st.colour) }}>
                  <Glyph atlas={atlas} i={st.glyph} size={20} />
                </button>
                <button type="button" onClick={() => onRemove(i)} aria-label={t("stickers.remove")} title={t("stickers.remove")} className="flex h-8 w-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">{t("stickers.none")}</p>
        )}
        {design.stickers.length >= MAX_STICKERS && <p className="text-[12.5px] text-muted-foreground">{t("stickers.full")}</p>}
      </Section>
    </div>
  );
}

const EFFECT_ICON: Record<Effect, LucideIcon> = { none: Ban, hearts: Heart, stars: Star, fire: Flame, bubbles: Circle, lightning: Zap, petals: Flower2, confetti: Sparkle, smoke: Cloud };

export function EffectPanel({ design, onBegin, onEffect, onPlay, compact, t }: { design: Design; onBegin: () => void; onEffect: (e: Design["effect"], commit?: boolean) => void; onPlay: () => void; compact?: boolean; t: T }) {
  const [well, setWell] = useState(-1);
  const e = design.effect;
  return (
    <div className="space-y-5" data-testid="pbm-effect">
      <p className="text-[13px] text-muted-foreground">{t("effect.hint")}</p>
      <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={t("tabs.effect")}>
        {EFFECTS.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={e.kind === k}
            onClick={() => onEffect({ ...e, kind: k }, true)}
            className={cn("flex h-12 items-center gap-2 rounded-2xl border px-3 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70", e.kind === k ? "border-white/25 bg-white/[0.1] text-foreground" : "border-white/[0.07] text-foreground/75 hover:border-white/15 hover:text-foreground")}
            data-testid={`pbm-effect-${k}`}
          >
            {(() => {
              const Icon = EFFECT_ICON[k];
              return <Icon className="h-4 w-4 shrink-0" style={{ color: k === "none" ? undefined : hexOf(e.colours[0]) }} aria-hidden />;
            })()}
            <span className="truncate">{t(`effect.names.${k}`)}</span>
          </button>
        ))}
      </div>
      {e.kind !== "none" && (
        <Section title={t("effect.colours")} aside={<button type="button" onClick={onPlay} className="flex h-9 items-center gap-1.5 rounded-full bg-white/[0.08] px-3.5 text-[13px] font-medium transition-colors hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" data-testid="pbm-effect-play"><Play className="h-3.5 w-3.5" aria-hidden /> {t("actions.play")}</button>}>
          <div className="flex items-center gap-2">
            {[0, 1, 2].map((k) => (
              <Well key={k} value={e.colours[k]} label={t("patterns.colourN", { n: k + 1 })} open={well === k} onToggle={() => setWell((w) => (w === k ? -1 : k))} />
            ))}
          </div>
          {well >= 0 && (
            <ColourPicker
              compact={compact}
              value={e.colours[well]}
              onBegin={onBegin}
              onChange={(c) => {
                const cs = e.colours.slice() as Design["effect"]["colours"];
                cs[well] = c;
                onEffect({ ...e, colours: cs });
              }}
              label={t("patterns.colourN", { n: well + 1 })}
            />
          )}
        </Section>
      )}
    </div>
  );
}

export function InsidePanel({ design, name, onChoose, onShiny, onClear, onLink, linkError, t }: { design: Design; name: string | null; onChoose: () => void; onShiny: (v: boolean) => void; onClear: () => void; onLink: (s: string) => void; linkError: boolean; t: T }) {
  const [link, setLink] = useState("");
  const id = design.inside.id;
  return (
    <div className="space-y-5" data-testid="pbm-inside">
      <p className="text-[13px] text-muted-foreground">{t("inside.hint")}</p>
      {id ? (
        <div className="flex items-center gap-3 rounded-2xl bg-white/[0.05] p-3">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/[0.06]">
            <img src={boardArtUrl(id)} alt="" width={52} height={52} className="h-[52px] w-[52px] object-contain" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-medium" data-testid="pbm-inside-name">{name ?? `#${id}`}</p>
            {design.inside.custom && <p className="text-[12px] text-muted-foreground">{t("inside.custom")}</p>}
          </div>
          <button type="button" onClick={onChoose} className="h-9 rounded-full border border-white/[0.1] px-3.5 text-[13px] transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" data-testid="pbm-inside-change">
            {t("inside.change")}
          </button>
          <button type="button" onClick={onClear} aria-label={t("inside.remove")} title={t("inside.remove")} className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[13px] text-foreground/80">{t("inside.none")}</p>
          <button type="button" onClick={onChoose} className="flex h-11 w-full items-center justify-center rounded-full bg-white/[0.08] text-[14px] font-medium transition-colors hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" data-testid="pbm-inside-choose">
            {t("inside.choose")}
          </button>
        </div>
      )}
      {id > 0 && !design.inside.custom && (
        <label className="flex items-center gap-3 text-[13.5px]">
          <input type="checkbox" checked={design.inside.shiny} onChange={(e) => onShiny(e.target.checked)} className="h-4 w-4 accent-primary" data-testid="pbm-inside-shiny" />
          {t("inside.shiny")}
        </label>
      )}
      <form
        className="space-y-2 border-t border-white/[0.07] pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          onLink(link);
        }}
      >
        <label className="block text-[12.5px] text-muted-foreground" htmlFor="pbm-shiny-link">{t("inside.link")}</label>
        <div className="flex gap-2">
          <input id="pbm-shiny-link" value={link} onChange={(e) => setLink(e.target.value)} placeholder={t("inside.linkPlaceholder")} className="h-10 min-w-0 flex-1 rounded-full border border-white/[0.08] bg-white/[0.05] px-4 text-[13.5px] outline-none placeholder:text-muted-foreground/70 focus:border-white/25 max-lg:text-[16px]" data-testid="pbm-shiny-link" />
          <button type="submit" className="h-10 rounded-full bg-white/[0.08] px-4 text-[13px] font-medium transition-colors hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">{t("inside.use")}</button>
        </div>
        {linkError && <p className="text-[12.5px] text-[hsl(0_80%_72%)]" role="alert">{t("inside.badShiny")}</p>}
      </form>
    </div>
  );
}

export function ItemCard({ design, still, t }: { design: Design; still: string | null; t: T }) {
  return (
    <div className="flex gap-4 rounded-[22px] border border-white/[0.08] bg-[linear-gradient(180deg,hsl(248_28%_15%),hsl(248_30%_11%))] p-4 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]" data-testid="pbm-item-card">
      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white/[0.06]">
        {still ? <img src={still} alt="" width={56} height={56} className="h-14 w-14" /> : <CssBall design={design} size={48} />}
      </span>
      <div className="min-w-0">
        <p className="truncate font-display text-[17px] font-semibold" data-testid="pbm-item-name">{design.name || t("card.untitled")}</p>
        <p className={cn("mt-1 whitespace-pre-line break-words text-[13.5px] leading-relaxed", design.desc ? "text-foreground/80" : "italic text-muted-foreground/60")} data-testid="pbm-item-desc">{design.desc || t("card.descPlaceholder")}</p>
      </div>
    </div>
  );
}

export function CardPanel({ design, onName, onDesc, still, rejected, t }: { design: Design; onName: (s: string) => void; onDesc: (s: string) => void; still: string | null; rejected: boolean; t: T }) {
  const [name, setName] = useState(design.name);
  const [desc, setDesc] = useState(design.desc);
  useEffect(() => setName(design.name), [design.name]);
  useEffect(() => setDesc(design.desc), [design.desc]);
  return (
    <div className="space-y-5" data-testid="pbm-card">
      <Section title={t("card.preview")}>
        <ItemCard design={{ ...design, name: name.trim() ? name : design.name, desc: desc.trim() ? desc : design.desc }} still={still} t={t} />
      </Section>
      <label className="block space-y-1.5">
        <span className="flex justify-between text-[12.5px] text-muted-foreground">
          {t("card.name")} <span>{t("card.count", { n: Array.from(name).length, max: NAME_MAX })}</span>
        </span>
        <input value={name} maxLength={NAME_MAX * 2} onChange={(e) => setName(Array.from(e.target.value).slice(0, NAME_MAX).join(""))} onBlur={() => onName(name)} onKeyDown={(e) => e.key === "Enter" && onName(name)} placeholder={t("card.namePlaceholder")} className="h-11 w-full rounded-xl border border-white/[0.08] bg-white/[0.05] px-3.5 text-[15px] outline-none placeholder:text-muted-foreground/70 focus:border-white/25 max-lg:text-[16px]" data-testid="pbm-name" />
        {rejected && <span className="block text-[12.5px] text-[hsl(0_80%_72%)]" role="alert">{t("card.rejected")}</span>}
      </label>
      <label className="block space-y-1.5">
        <span className="flex justify-between text-[12.5px] text-muted-foreground">
          {t("card.desc")} <span>{t("card.count", { n: Array.from(desc).length, max: DESC_MAX })}</span>
        </span>
        <textarea value={desc} rows={3} onChange={(e) => setDesc(Array.from(e.target.value.replace(/\n/g, " ")).slice(0, DESC_MAX).join(""))} onBlur={() => onDesc(desc)} placeholder={t("card.descPlaceholder")} className="w-full resize-none rounded-xl border border-white/[0.08] bg-white/[0.05] px-3.5 py-2.5 text-[14px] leading-relaxed outline-none placeholder:text-muted-foreground/70 focus:border-white/25 max-lg:text-[16px]" data-testid="pbm-desc" />
      </label>
    </div>
  );
}
