/* eslint-disable jsx-a11y/alt-text, @next/next/no-img-element -- Satori draws plain <img> */
import "server-only";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { C, localImage, ogCard } from "@/lib/og/card";
import { homeRenderUrl } from "@/lib/pokemon/art";
import { figureAsset } from "@/lib/world-history/assets";
import { CHAPTERS } from "@/lib/pokemon-story/data";
import type { Chapter } from "@/lib/pokemon-story/types";

/**
 * Preview cards for The Story of Pokémon: a still of the chapter's 3D scene
 * (public/lab/pokemon-story/<id>.webp) in a warm archive frame, otherwise
 * its Pokémon (or a Game Boy-green glow for the chapters without any), with
 * its title and when it happened.
 */

const W = 470, H = 400;

function Frame({ children, accent }: { children: React.ReactNode; accent: string }) {
  return (
    <div style={{ display: "flex", position: "relative", width: W, height: H, borderRadius: 18, overflow: "hidden", border: `4px solid ${accent}`, boxShadow: `0 0 60px ${accent}55, 0 30px 60px rgba(0,0,0,0.6)`, background: "#140d08" }}>
      {children}
    </div>
  );
}

async function still(id: string): Promise<string | null> {
  const rel = `public/lab/pokemon-story/${id}.webp`;
  return existsSync(join(process.cwd(), rel)) ? localImage(rel, 760) : null;
}

function Figures({ chapter }: { chapter: Chapter }) {
  const figs = chapter.figures.filter((f, i, all) => all.findIndex((x) => x.dex === f.dex) === i).slice(0, 3);
  const slots = figs.length === 1 ? [{ x: 0.5, s: 0.7 }] : figs.length === 2 ? [{ x: 0.32, s: 0.6 }, { x: 0.68, s: 0.6 }] : [{ x: 0.5, s: 0.62 }, { x: 0.2, s: 0.44 }, { x: 0.8, s: 0.44 }];
  return (
    <div style={{ display: "flex", position: "absolute", inset: 0, background: `radial-gradient(circle at 50% 40%, ${chapter.accent}77 0%, ${chapter.accent}00 62%), linear-gradient(180deg, #24160c, #0b0704)` }}>
      {figs.map((f, i) => {
        const a = figureAsset(f.art);
        const [bx, by, bw, bh] = a ? a.box : [0, 0, 512, 512];
        const size = H * slots[i].s;
        const k = size / Math.max(bw, bh);
        const left = W * slots[i].x - (bw * k) / 2;
        const top = H * 0.88 - bh * k;
        return (
          <div key={f.art} style={{ display: "flex", position: "absolute", left, top, width: bw * k, height: bh * k, overflow: "hidden" }}>
            <img src={homeRenderUrl(f.art)} width={512 * k} height={512 * k} style={{ position: "absolute", left: -bx * k, top: -by * k }} />
          </div>
        );
      }).reverse()}
      {!figs.length && (
        <div style={{ display: "flex", position: "absolute", left: W / 2 - 110, top: H / 2 - 80, width: 220, height: 160, borderRadius: 14, background: "#9bbc0f", boxShadow: "0 0 80px #9bbc0f88" }} />
      )}
    </div>
  );
}

export async function storyChapterCard(chapter: Chapter) {
  const pic = await still(chapter.id);
  return ogCard({
    eyebrow: `The Story of Pokémon · ${chapter.numeral}`,
    title: [chapter.title],
    titleSize: chapter.title.length > 14 ? 60 : 72,
    subtitle: `${chapter.when} · ${chapter.place}`,
    accent: chapter.accent,
    visual: <Frame accent={chapter.accent}>{pic ? <img src={pic} width={W} height={H} style={{ objectFit: "cover" }} /> : <Figures chapter={chapter} />}</Frame>,
    footer: "Watch the chapter in 3D →",
  });
}

export async function storyHubCard() {
  const pic = (await still("hall")) ?? (await still("cable"));
  const hero = CHAPTERS.find((c) => c.id === "red-green") ?? CHAPTERS[0];
  return ogCard({
    eyebrow: "PokéIQ 3D Lab · The real history",
    title: ["The Story of", ["Pokémon", C.yellow]],
    titleSize: 66,
    subtitle: "From a boy's bug hunts to thirty years: a 3D film, every line sourced.",
    accent: "#e8c15a",
    visual: <Frame accent="#e8c15a">{pic ? <img src={pic} width={W} height={H} style={{ objectFit: "cover" }} /> : <Figures chapter={hero} />}</Frame>,
    footer: "Press play →",
  });
}
