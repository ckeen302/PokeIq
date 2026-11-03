/* eslint-disable jsx-a11y/alt-text, @next/next/no-img-element -- Satori draws plain <img> */
import "server-only";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { C, localImage, ogCard } from "@/lib/og/card";
import { homeRenderUrl } from "@/lib/pokemon/art";
import { figureAsset } from "@/lib/world-history/assets";
import type { Chapter } from "@/lib/world-history/types";

/**
 * Preview cards for The History of the Pokémon World: a chapter's exhibit
 * (a still from its 3D scene when one is in public/lab/world-history,
 * otherwise its legendaries' HOME renders in a lit doorway), its title and
 * when it happened.
 */

const W = 470, H = 400;

/** The doorway: an arched frame glowing in the chapter's accent. */
function Exhibit({ children, accent }: { children: React.ReactNode; accent: string }) {
  return (
    <div style={{ display: "flex", position: "relative", width: W, height: H, borderRadius: "235px 235px 18px 18px", overflow: "hidden", border: `4px solid ${accent}`, boxShadow: `0 0 60px ${accent}55, 0 30px 60px rgba(0,0,0,0.6)`, background: "#0a0716" }}>
      {children}
    </div>
  );
}

async function still(id: string): Promise<string | null> {
  const rel = `public/lab/world-history/${id}.webp`;
  return existsSync(join(process.cwd(), rel)) ? localImage(rel, 760) : null;
}

function Figures({ chapter }: { chapter: Chapter }) {
  const figs = chapter.figures.filter((f, i, all) => all.findIndex((x) => x.dex === f.dex) === i).slice(0, 3);
  const slots = figs.length === 1 ? [{ x: 0.5, s: 0.86 }] : figs.length === 2 ? [{ x: 0.32, s: 0.62 }, { x: 0.68, s: 0.62 }] : [{ x: 0.5, s: 0.66 }, { x: 0.2, s: 0.46 }, { x: 0.8, s: 0.46 }];
  return (
    <div style={{ display: "flex", position: "absolute", inset: 0, background: `radial-gradient(circle at 50% 38%, ${chapter.accent}66 0%, ${chapter.accent}00 62%), linear-gradient(180deg, #120c26, #05030b)` }}>
      {figs.map((f, i) => {
        const a = figureAsset(f.art);
        const [bx, by, bw, bh] = a ? a.box : [0, 0, 512, 512];
        const size = H * slots[i].s;
        const k = size / Math.max(bw, bh);
        const left = W * slots[i].x - (bw * k) / 2;
        const top = H * 0.9 - bh * k;
        return (
          <div key={f.art} style={{ display: "flex", position: "absolute", left, top, width: bw * k, height: bh * k, overflow: "hidden" }}>
            <img src={homeRenderUrl(f.art)} width={512 * k} height={512 * k} style={{ position: "absolute", left: -bx * k, top: -by * k }} />
          </div>
        );
      }).reverse()}
    </div>
  );
}

export async function historyChapterCard(chapter: Chapter) {
  const pic = await still(chapter.id);
  return ogCard({
    eyebrow: `History of the Pokémon World · ${chapter.numeral}`,
    title: [chapter.title],
    titleSize: chapter.title.length > 22 ? 56 : 66,
    subtitle: `${chapter.region} · ${chapter.when}`,
    accent: chapter.accent,
    visual: (
      <Exhibit accent={chapter.accent}>
        {pic ? <img src={pic} width={W} height={H} style={{ objectFit: "cover" }} /> : <Figures chapter={chapter} />}
      </Exhibit>
    ),
    footer: "Watch the chapter in 3D →",
  });
}

export async function historyHubCard(chapters: Chapter[]) {
  const pic = await still("hall");
  const hero = chapters[0];
  return ogCard({
    eyebrow: "PokéIQ 3D Lab · In-universe history",
    title: ["The History of", ["the Pokémon World", C.yellow]],
    titleSize: 54,
    subtitle: "From Sinnoh's creation myth to Area Zero, each line sourced to the games.",
    accent: hero.accent,
    visual: <Exhibit accent={hero.accent}>{pic ? <img src={pic} width={W} height={H} style={{ objectFit: "cover" }} /> : <Figures chapter={hero} />}</Exhibit>,
    footer: "Step inside →",
  });
}
