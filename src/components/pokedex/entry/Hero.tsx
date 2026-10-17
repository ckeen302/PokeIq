"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { Sparkles, Volume2 } from "lucide-react";
import type { DexAbility, DexEntryData, DexForm } from "@/lib/pokemon/dex-types";
import { GENERATION_REGIONS, formatHeight, formatWeight, titleCase } from "@/lib/pokemon/constants";
import { typeColor } from "@/lib/pokemon/type-colors";
import { animatedSpriteUrl, artUrl, homeRenderUrl, publicCryUrl } from "@/lib/pokemon/art";
import { TypeBadge } from "../TypeBadge";
import { cn } from "@/lib/utils";

type View = "art" | "animated" | "3d";

interface HeroProps {
  data: DexEntryData;
  form: DexForm | null;
  onFormChange: (form: DexForm | null) => void;
  types: string[];
  abilities: DexAbility[];
}

export function Hero({ data, form, onFormChange, types, abilities }: HeroProps) {
  const p = data.core;
  const [view, setView] = useState<View>("art");
  const [shiny, setShiny] = useState(false);
  const [burst, setBurst] = useState(0);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const artId = form?.id ?? p.id;
  const c1 = typeColor(types[0]);
  const c2 = typeColor(types[1] ?? types[0]);

  // Pointer-driven 3D tilt.
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rotateY = useSpring(useTransform(mx, [-0.5, 0.5], [-12, 12]), { stiffness: 150, damping: 15 });
  const rotateX = useSpring(useTransform(my, [-0.5, 0.5], [10, -10]), { stiffness: 150, damping: 15 });

  const src =
    view === "animated" ? animatedSpriteUrl(artId, shiny) : view === "3d" ? homeRenderUrl(artId, shiny) : artUrl(artId, 400, shiny);
  const srcKey = `${view}:${artId}:${shiny}`;
  const fallback = artUrl(artId, 400, shiny);

  return (
    <section
      id="overview"
      className="relative -mx-4 overflow-hidden px-4 pb-10 pt-6 sm:-mx-8 sm:rounded-3xl sm:px-8"
      style={{
        background: `radial-gradient(80% 70% at 30% 20%, ${c1}40, transparent 70%), radial-gradient(60% 60% at 90% 80%, ${c2}30, transparent 70%)`,
      }}
    >
      {/* Ghost dex number */}
      <motion.div
        className="pointer-events-none absolute -right-4 top-0 select-none font-black leading-none text-white/[0.04] sm:text-[14rem]"
        style={{ fontSize: "clamp(7rem, 22vw, 16rem)" }}
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.8 }}
        aria-hidden
      >
        #{String(p.id).padStart(4, "0")}
      </motion.div>

      <div className="relative grid items-center gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* Artwork stage */}
        <div className="flex flex-col items-center gap-4">
          <div
            className="relative aspect-square w-full max-w-[380px] [perspective:900px]"
            onPointerMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              mx.set((e.clientX - r.left) / r.width - 0.5);
              my.set((e.clientY - r.top) / r.height - 0.5);
            }}
            onPointerLeave={() => {
              mx.set(0);
              my.set(0);
            }}
          >
            {/* Rotating aura + pokéball watermark */}
            <motion.div
              className="absolute inset-[8%] rounded-full opacity-70 blur-2xl"
              style={{ background: `conic-gradient(from 0deg, ${c1}, ${c2}, ${c1})` }}
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 18, ease: "linear" }}
              aria-hidden
            />
            <PokeballWatermark />
            <motion.div className="relative h-full w-full" style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}>
              <AnimatePresence mode="wait">
                <motion.img
                  key={srcKey}
                  src={failed[srcKey] ? fallback : src}
                  alt={`${form?.name ?? p.name}${shiny ? " (shiny)" : ""}`}
                  onError={() => setFailed((f) => ({ ...f, [srcKey]: true }))}
                  className={cn(
                    "absolute inset-0 m-auto object-contain drop-shadow-[0_20px_30px_rgba(0,0,0,0.5)]",
                    view === "animated" && !failed[srcKey] ? "h-[45%] w-[45%] [image-rendering:pixelated]" : "h-full w-full p-4"
                  )}
                  initial={{ opacity: 0, scale: 0.7, rotate: -8 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0, y: [0, -12, 0] }}
                  exit={{ opacity: 0, scale: 0.85 }}
                  transition={{
                    opacity: { duration: 0.3 },
                    scale: { type: "spring", stiffness: 220, damping: 18 },
                    rotate: { type: "spring", stiffness: 220, damping: 18 },
                    y: { repeat: Infinity, duration: 4, ease: "easeInOut" },
                  }}
                  draggable={false}
                />
              </AnimatePresence>
              <AnimatePresence>
                {burst > 0 && <SparkleBurst key={burst} />}
              </AnimatePresence>
            </motion.div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <div className="flex rounded-full border border-white/10 bg-background/60 p-1 backdrop-blur" role="group" aria-label="Artwork style">
              {(["art", "animated", "3d"] as View[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={cn("relative rounded-full px-3 py-1 text-xs font-semibold transition-colors", view === v ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                  aria-pressed={view === v}
                >
                  {view === v && <motion.span layoutId="hero-view-pill" className="absolute inset-0 rounded-full bg-primary" transition={{ type: "spring", stiffness: 400, damping: 30 }} />}
                  <span className="relative">{v === "art" ? "Artwork" : v === "animated" ? "Animated" : "3D"}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                setShiny((s) => !s);
                setBurst((b) => b + 1);
              }}
              aria-pressed={shiny}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all",
                shiny ? "border-yellow-400/70 bg-yellow-400/15 text-yellow-300 shadow-[0_0_18px_-4px_rgba(250,204,21,0.8)]" : "border-white/10 text-muted-foreground hover:text-foreground"
              )}
            >
              <Sparkles className="h-3.5 w-3.5" /> Shiny
            </button>
            <CryButton id={p.id} />
          </div>
        </div>

        {/* Identity */}
        <div className="space-y-5">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <p className="font-mono text-sm text-muted-foreground">
              #{String(p.id).padStart(4, "0")} · Gen {p.gen} · {GENERATION_REGIONS[p.gen]}
            </p>
            <h1 className="text-5xl font-black tracking-tight sm:text-6xl">{form?.name ?? p.name}</h1>
            <p className="mt-1 text-lg text-muted-foreground">
              The {p.genus}
              {p.names.ja && <span className="ml-2 text-base opacity-70">{p.names.ja}</span>}
            </p>
          </motion.div>

          <motion.div className="flex flex-wrap gap-2" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.08, delayChildren: 0.2 } } }}>
            {types.map((t) => (
              <motion.span key={`${form?.id}-${t}`} variants={{ hidden: { opacity: 0, scale: 0.5 }, show: { opacity: 1, scale: 1 } }}>
                <TypeBadge type={t} size="lg" />
              </motion.span>
            ))}
            {p.legendary && <Tag>Legendary</Tag>}
            {p.mythical && <Tag>Mythical</Tag>}
            {data.isBaby && <Tag>Baby</Tag>}
          </motion.div>

          {data.forms.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Forms</div>
              <div className="flex flex-wrap gap-1.5">
                <FormChip active={!form} onClick={() => onFormChange(null)}>
                  {p.name}
                </FormChip>
                {data.forms.map((f) => (
                  <FormChip key={f.id} active={form?.id === f.id} onClick={() => onFormChange(f)}>
                    {f.name}
                  </FormChip>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Fact label="Height" value={formatHeight(p.height)} />
            <Fact label="Weight" value={formatWeight(p.weight)} />
            <Fact label="Color" value={titleCase(p.color)} />
            <Fact label="Shape" value={p.shape ? titleCase(p.shape) : "—"} />
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Abilities</div>
            <div className="grid gap-2">
              {abilities.map((a, i) => (
                <motion.div
                  key={`${form?.id}-${a.name}`}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.25 + i * 0.07 }}
                  className="rounded-xl border border-white/10 bg-background/50 p-3 backdrop-blur"
                >
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    {a.name}
                    {a.hidden && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase text-primary">Hidden</span>}
                  </div>
                  {a.effect && <p className="mt-0.5 text-xs text-muted-foreground">{a.effect}</p>}
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-yellow-400/40 bg-yellow-400/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-yellow-300">{children}</span>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-background/50 p-2.5 backdrop-blur">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

function FormChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-semibold transition-all",
        active ? "border-primary bg-primary text-primary-foreground shadow-lg shadow-primary/20" : "border-white/10 bg-background/50 text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function CryButton({ id }: { id: number }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    const audio = new Audio();
    if (!audio.canPlayType("audio/ogg")) {
      setSupported(false);
      return;
    }
    audio.src = publicCryUrl(id);
    audio.volume = 0.5;
    audio.preload = "none";
    const stop = () => setPlaying(false);
    audio.addEventListener("ended", stop);
    audioRef.current = audio;
    return () => {
      audio.pause();
      audio.removeEventListener("ended", stop);
    };
  }, [id]);

  if (!supported) return null;
  return (
    <button
      type="button"
      onClick={() => {
        const a = audioRef.current;
        if (!a) return;
        a.currentTime = 0;
        void a.play().then(() => setPlaying(true));
      }}
      className="flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
      aria-label="Play cry"
    >
      <Volume2 className="h-3.5 w-3.5" />
      Cry
      <span className="flex h-3 items-end gap-[2px]" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <motion.span
            key={i}
            className="w-[2px] rounded-full bg-current"
            animate={playing ? { height: ["20%", "100%", "40%", "80%", "20%"] } : { height: "20%" }}
            transition={playing ? { repeat: Infinity, duration: 0.6, delay: i * 0.1 } : { duration: 0.2 }}
          />
        ))}
      </span>
    </button>
  );
}

function SparkleBurst() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {Array.from({ length: 10 }).map((_, i) => {
        const angle = (i / 10) * Math.PI * 2;
        return (
          <motion.span
            key={i}
            className="absolute left-1/2 top-1/2 text-xl text-yellow-300"
            initial={{ x: 0, y: 0, opacity: 1, scale: 0.4 }}
            animate={{ x: Math.cos(angle) * 150, y: Math.sin(angle) * 150, opacity: 0, scale: 1.2, rotate: 180 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9, ease: "easeOut" }}
          >
            ✦
          </motion.span>
        );
      })}
    </div>
  );
}

function PokeballWatermark() {
  return (
    <motion.svg
      viewBox="0 0 100 100"
      className="absolute inset-0 m-auto h-[92%] w-[92%] text-white/[0.05]"
      animate={{ rotate: 360 }}
      transition={{ repeat: Infinity, duration: 60, ease: "linear" }}
      aria-hidden
    >
      <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeWidth="4" />
      <path d="M4 50h30M66 50h30" stroke="currentColor" strokeWidth="4" />
      <circle cx="50" cy="50" r="14" fill="none" stroke="currentColor" strokeWidth="4" />
    </motion.svg>
  );
}
