"use client";

/* eslint-disable @next/next/no-img-element -- animated GIF sprites with a fallback chain, and effect images; next/image would freeze or re-encode them */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FX } from "./fx";
import { other, type MonSnap, type SideId, type SideSnap, type SlotRef, type Snap } from "./model";
import { projectPos, spritePosition, STAGE_H, STAGE_W } from "./scene";
import { battleSpriteCandidates, spriteData } from "./sprites";
import type { PopupTone, StageHandle, StageSprite } from "./player";
import { Hud, TeamBalls, type Ball } from "./Hud";
import { Backdrop } from "./Backdrop";
import { cn } from "@/lib/utils";

export interface Popup {
  id: number;
  ref?: SlotRef;
  text: string;
  tone: PopupTone;
}

/** Where a slot's Pokémon stands, as a fraction of the stage (for popups over it). */
function slotCenter(ref: SlotRef, me: SideId, active: number) {
  const near = ref.side === me;
  const pos = spritePosition(near, ref.slot, active, false);
  const box = projectPos(pos, { w: 96, h: 96, gen: 6 });
  return { x: (box.left + box.width / 2) / STAGE_W, y: (box.top + box.height * 0.2) / STAGE_H };
}

const POPUP_TONES: Record<PopupTone, string> = {
  good: "bg-success/90 text-success-foreground",
  bad: "bg-destructive/90 text-white",
  info: "bg-black/75 text-white",
  crit: "bg-warning text-black",
  super: "bg-primary text-primary-foreground",
  weak: "bg-slate-600/90 text-white",
};

const WEATHER_CLASS: Record<string, string> = {
  Rain: "battle-rain",
  "Heavy Rain": "battle-rain",
  Sun: "battle-sun",
  "Harsh Sunshine": "battle-sun",
  Sand: "battle-sand",
  Snow: "battle-snow",
  Hail: "battle-snow",
};

const TERRAIN_TINT: Record<string, string> = {
  Electric: "rgb(250 220 70 / 0.38)",
  Grassy: "rgb(90 210 110 / 0.38)",
  Psychic: "rgb(220 100 220 / 0.36)",
  Misty: "rgb(255 170 220 / 0.38)",
};

/** One active Pokémon's sprite: animated GIF, falling back through static and mirrored sprites. */
const MonSprite = memo(function MonSprite({
  mon,
  near,
  slot,
  active,
  register,
}: {
  mon: MonSnap;
  near: boolean;
  slot: number;
  active: number;
  register: (key: string, sprite: StageSprite | null) => void;
}) {
  const candidates = useMemo(() => battleSpriteCandidates({ id: mon.speciesId, num: mon.num }, near, mon.shiny), [mon.speciesId, mon.num, near, mon.shiny]);
  const [index, setIndex] = useState(0);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const choice = candidates[index];
  const sp = spriteData(choice, size ?? undefined);
  const pos = spritePosition(near, slot, active, !!sp.pixelated);
  const box = projectPos(pos, sp);
  const wrap = useRef<HTMLDivElement>(null);
  const side = near ? "near" : "far";
  const slotKey = `${side}:${slot}`;

  useLayoutEffect(() => {
    if (!wrap.current) return;
    register(slotKey, { el: wrap.current, sp, pos, near, key: mon.key });
    return () => register(slotKey, null);
    // sp/pos change with the loaded size; re-register then.
  }, [register, slotKey, mon.key, near, sp.url, sp.w, sp.h, pos.x, pos.y, pos.z]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!choice) return null;
  return (
    <div
      ref={wrap}
      className="absolute"
      style={{ left: box.left, top: box.top, width: box.width, height: box.height, zIndex: near ? 3 : 2, transformOrigin: "50% 90%" }}
      aria-hidden
    >
      <img
        key={choice.url}
        src={choice.url}
        alt=""
        draggable={false}
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth && (img.naturalWidth !== size?.w || img.naturalHeight !== size?.h)) setSize({ w: img.naturalWidth, h: img.naturalHeight });
        }}
        onError={() => {
          setSize(null);
          setIndex((i) => i + 1);
        }}
        className="h-full w-full select-none object-contain"
        style={{ imageRendering: sp.pixelated ? "pixelated" : undefined, transform: choice.flip ? "scaleX(-1)" : undefined }}
      />
    </div>
  );
});

/** Hazards on a side's ground, and its screens. */
function SideField({ side, near }: { side: SideSnap; near: boolean }) {
  const ids = new Set(side.conditions.map((c) => c.id));
  const level = (id: string) => side.conditions.find((c) => c.id === id)?.level ?? 0;
  // The ground in front of each side's platform.
  const cx = near ? 210 : 430;
  const cy = near ? 322 : 192;
  const s = near ? 1.35 : 1;
  const bits: { src: string; x: number; y: number; w: number; key: string }[] = [];
  if (ids.has("stealthrock")) [-46, 2, 44].forEach((dx, i) => bits.push({ src: `${FX}rock3.png`, x: cx + dx * s, y: cy + (i === 1 ? 6 : 0) * s, w: 26 * s, key: `sr${i}` }));
  for (let i = 0; i < level("spikes"); i++) bits.push({ src: `${FX}caltrop.png`, x: cx - 70 * s + i * 22 * s, y: cy + 14 * s, w: 18 * s, key: `sp${i}` });
  for (let i = 0; i < level("toxicspikes"); i++) bits.push({ src: `${FX}poisoncaltrop.png`, x: cx + 40 * s + i * 22 * s, y: cy + 14 * s, w: 18 * s, key: `ts${i}` });
  if (ids.has("stickyweb")) bits.push({ src: `${FX}web.png`, x: cx, y: cy + 4 * s, w: 120 * s, key: "web" });
  const screens = [
    ["reflect", "sidecondition-reflect"],
    ["lightscreen", "sidecondition-lightscreen"],
    ["auroraveil", "sidecondition-auroraveil"],
    ["safeguard", "sidecondition-safeguard"],
    ["mist", "sidecondition-mist"],
  ].filter(([id]) => ids.has(id));
  return (
    <>
      {bits.map((b) => (
        <img key={b.key} src={b.src} alt="" className="pointer-events-none absolute opacity-90" style={{ left: b.x - b.w / 2, top: b.y - b.w / 2, width: b.w, zIndex: 1 }} />
      ))}
      {screens.map(([id, cls], i) => (
        <div
          key={id}
          className={cn(cls, "pointer-events-none absolute opacity-60")}
          style={{ left: cx - 70 * s + i * 6, top: (near ? 200 : 76) + i * 6, width: 140 * s, height: (near ? 120 : 90) * s, zIndex: near ? 4 : 2 }}
        />
      ))}
      {ids.has("tailwind") && (
        <div className="battle-rain pointer-events-none absolute opacity-40" style={{ left: cx - 120 * s, top: cy - 120 * s, width: 240 * s, height: 130 * s, zIndex: 1, transform: "rotate(-70deg)" }} />
      )}
    </>
  );
}

export interface StageProps {
  snap: Snap;
  me: SideId;
  doubles: boolean;
  popups: Popup[];
  onHandle: (handle: StageHandle) => void;
  /** Your whole team for the party balls (unseen members show as healthy). */
  myBalls?: Ball[];
}

export function Stage({ snap, me, doubles, popups, onHandle, myBalls }: StageProps) {
  const outer = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const bgfx = useRef<HTMLDivElement>(null);
  const fx = useRef<HTMLDivElement>(null);
  const sprites = useRef(new Map<string, StageSprite>());
  const [scale, setScale] = useState(1);
  const foe = other(me);
  const active = doubles ? 2 : 1;

  useLayoutEffect(() => {
    const el = outer.current;
    if (!el) return;
    const measure = () => setScale(el.clientWidth / STAGE_W);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const register = useMemo(
    () => (key: string, sprite: StageSprite | null) => {
      if (sprite) sprites.current.set(key, sprite);
      else sprites.current.delete(key);
    },
    []
  );

  useEffect(() => {
    if (!stage.current || !backdrop.current || !bgfx.current || !fx.current) return;
    onHandle({
      stage: stage.current,
      backdrop: backdrop.current,
      bgfx: bgfx.current,
      fx: fx.current,
      me,
      sprite: (ref) => sprites.current.get(`${ref.side === me ? "near" : "far"}:${ref.slot}`) ?? null,
      repaint: () => {
        for (const s of sprites.current.values()) {
          const box = projectPos(s.pos, s.sp);
          Object.assign(s.el.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, opacity: "" });
        }
      },
    });
  }, [onHandle, me]);

  const weather = WEATHER_CLASS[snap.weather];
  const tint = TERRAIN_TINT[snap.terrain];
  const trickRoom = snap.pseudo.includes("trickroom");
  const fieldChips = [snap.weather, snap.terrain && `${snap.terrain} Terrain`, ...snap.pseudo.map((p) => PSEUDO[p] ?? null)].filter(Boolean) as string[];

  return (
    <div className="relative">
      <div ref={outer} className="dark-scope relative aspect-[16/9] w-full overflow-hidden rounded-lg border border-black/50 bg-[hsl(250_45%_8%)] shadow-[0_18px_50px_-20px_hsl(var(--screen)/0.5)]">
        <div ref={stage} className="absolute left-0 top-0 origin-top-left" style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})` }}>
          {/* Backdrop: our own scene (Earthquake shakes it, so it's taller than the stage). */}
          <div ref={backdrop} className="absolute inset-x-0" style={{ top: -90, bottom: 0 }}>
            <Backdrop trickRoom={trickRoom} tint={tint} />
          </div>
          <div ref={bgfx} className="pointer-events-none absolute inset-0" style={{ zIndex: 1 }} />
          <SideField side={snap.sides[foe]} near={false} />
          <SideField side={snap.sides[me]} near />
          {[foe, me].map((sideId) =>
            snap.sides[sideId].active.map((mon, slot) =>
              mon && !mon.fainted ? (
                <MonSprite key={`${sideId}:${slot}:${mon.key}:${mon.species}`} mon={mon} near={sideId === me} slot={slot} active={active} register={register} />
              ) : null
            )
          )}
          {weather && <div className={cn(weather, "pointer-events-none absolute inset-0")} style={{ zIndex: 5 }} />}
          <div ref={fx} className="pointer-events-none absolute inset-0" style={{ zIndex: 6 }} />
        </div>

        {/* Overlays in screen space. */}
        <div className="pointer-events-none absolute inset-0 z-10">
          <span className="hud-label absolute left-1/2 top-2 -translate-x-1/2 rounded-sm bg-black/55 px-2 py-1 text-white/80">Turn {Math.max(1, snap.turn)}</span>
          {fieldChips.length > 0 && (
            <div className="absolute right-2 top-2 flex flex-col items-end gap-1">
              {fieldChips.map((chip) => (
                <span key={chip} className="hud-label rounded-sm bg-black/60 px-2 py-1 text-white/90">
                  {chip}
                </span>
              ))}
            </div>
          )}
          <div className="absolute left-[2%] top-[3%] hidden w-[42%] flex-col gap-1 sm:flex">
            {snap.sides[foe].active.map((mon, i) => (mon ? <Hud key={i} mon={mon} mine={false} compact={doubles} /> : null))}
            <TeamBalls side={snap.sides[foe]} />
          </div>
          <div className="absolute bottom-[4%] right-[2%] hidden w-[42%] flex-col items-stretch gap-1 sm:flex">
            <TeamBalls side={snap.sides[me]} align="end" balls={myBalls} />
            {snap.sides[me].active.map((mon, i) => (mon ? <Hud key={i} mon={mon} mine compact={doubles} /> : null))}
          </div>
          {popups.map((p) => {
            const at = p.ref ? slotCenter(p.ref, me, active) : { x: 0.5, y: 0.35 };
            return (
              <span
                key={p.id}
                className={cn("battle-popup absolute whitespace-nowrap rounded-md px-2.5 py-1 font-display text-sm font-bold uppercase tracking-wide shadow-lg sm:text-base", POPUP_TONES[p.tone])}
                style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%` }}
              >
                {p.text}
              </span>
            );
          })}
        </div>
      </div>

      {/* Phones: the HUDs sit around the field instead of over it. */}
      <div className="mt-2 grid gap-1.5 sm:hidden">
        <div className="grid grid-cols-1 gap-1.5">
          {snap.sides[foe].active.map((mon, i) => (mon ? <Hud key={i} mon={mon} mine={false} compact={doubles} /> : null))}
        </div>
        <div className="grid grid-cols-1 gap-1.5">
          {snap.sides[me].active.map((mon, i) => (mon ? <Hud key={i} mon={mon} mine compact={doubles} /> : null))}
        </div>
      </div>
    </div>
  );
}

const PSEUDO: Record<string, string> = {
  trickroom: "Trick Room",
  gravity: "Gravity",
  magicroom: "Magic Room",
  wonderroom: "Wonder Room",
  fairylock: "Fairy Lock",
  iondeluge: "Ion Deluge",
};
