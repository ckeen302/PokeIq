/* eslint-disable @next/next/no-img-element -- board art is pre-sized static WebP in public/art */
import { Fragment } from "react";
import { cn } from "@/lib/utils";
import { boardArtUrl } from "@/lib/pokemon/art";
import { VERDICT_LABEL, type Verdict } from "@/lib/theories/types";
import s from "./theories.module.css";

/** The class that sets a verdict's colour (--v) on an element and its children. */
export const verdictClass = (v: Verdict) => (v === "confirmed" ? s.ok : v === "fan" ? s.fan : s.no);

export function Stamp({ verdict, size, className }: { verdict: Verdict; size?: "big" | "huge"; className?: string }) {
  return (
    <span className={cn(s.stamp, verdictClass(verdict), size === "big" && s.stampBig, size === "huge" && s.stampHuge, className)} data-testid="case-stamp">
      {VERDICT_LABEL[verdict]}
    </span>
  );
}

export function Pin({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden className={cn(s.pin, className)} style={style} />;
}

/** A, B or C: the exhibit badge. */
export function Badge({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <span aria-hidden className={cn(s.exb, className)} style={style}>
      {children}
    </span>
  );
}

export function Art({ id, alt, className, style }: { id: number; alt: string; className?: string; style?: React.CSSProperties }) {
  return <img src={boardArtUrl(id)} alt={alt} width={160} height={160} loading="lazy" decoding="async" className={className} style={style} />;
}

const TILES = [1, 2, 0, 3, 1, 2, 1, 2, 0, 2, 0, 2, 1, 2, 1, 3, 1, 0, 2, 1, 2, 1, 2, 0, 3];
/** A MissingNo.-style glitch block in place of artwork. */
export function GlitchBlock({ size = 15, className }: { size?: number; className?: string }) {
  return (
    <span aria-hidden className={cn(s.glitch, className)} style={{ "--g": `${size}px` } as React.CSSProperties} data-testid="glitch-block">
      {TILES.map((t, i) => (
        <i key={i} className={t === 1 ? s.g1 : t === 2 ? s.g2 : t === 3 ? s.g3 : undefined} />
      ))}
    </span>
  );
}

/** `text` with the given words highlighted (each once, in order of appearance). */
export function Marked({ text, mark, className }: { text: string; mark?: string[]; className?: string }) {
  const hits = (mark ?? [])
    .map((m) => ({ m, at: text.indexOf(m) }))
    .filter((h) => h.at >= 0)
    .sort((a, b) => a.at - b.at);
  const out: React.ReactNode[] = [];
  let i = 0;
  for (const { m, at } of hits) {
    if (at < i) continue;
    out.push(<Fragment key={`t${i}`}>{text.slice(i, at)}</Fragment>);
    out.push(
      <span key={`m${at}`} className={className ?? s.hl}>
        {m}
      </span>
    );
    i = at + m.length;
  }
  out.push(<Fragment key="end">{text.slice(i)}</Fragment>);
  return <>{out}</>;
}

/** `text` with the given words in bold. */
export function Bolded({ text, bold }: { text: string; bold?: string[] }) {
  return <Marked text={text} mark={bold} className="font-bold text-foreground" />;
}

/** A small icon for exhibit C. */
export function ExhibitIcon({ icon }: { icon: "moon" | "code" | "map" | "dna" | "skull" | "ball" }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "hsl(var(--warning))", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (icon) {
    case "moon":
      return (
        <svg {...common}>
          <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />
        </svg>
      );
    case "code":
      return (
        <svg {...common}>
          <path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />
        </svg>
      );
    case "map":
      return (
        <svg {...common}>
          <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" />
        </svg>
      );
    case "dna":
      return (
        <svg {...common}>
          <path d="M7 3c0 6 10 6 10 12s-10 6-10 6M17 3c0 6-10 6-10 12M8 7h8M8 17h8" />
        </svg>
      );
    case "skull":
      return (
        <svg {...common}>
          <path d="M12 3a8 8 0 0 0-5 14.2V20h10v-2.8A8 8 0 0 0 12 3z" />
          <circle cx="9" cy="11" r="1.5" />
          <circle cx="15" cy="11" r="1.5" />
        </svg>
      );
    case "ball":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h6M15 12h6" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
  }
}

/** A National Dex number as shown on a photo, e.g. #0036. */
export const dexNo = (n: number) => `#${String(n).padStart(4, "0")}`;
