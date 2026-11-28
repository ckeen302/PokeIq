/* eslint-disable jsx-a11y/alt-text, @next/next/no-img-element -- Satori draws plain <img> */
import "server-only";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { fitTitle, ogCard } from "@/lib/og/card";
import { badgeCount, badgeTotal, graveyard, stats, team, type Run } from "@/lib/nuzlocke/run";
import { VERSION_LOOK } from "@/lib/nuzlocke/versions";
import type { GameView } from "@/lib/nuzlocke/view";
import page from "@/messages/en/nuzlocke-page.json";

/**
 * The Nuzlocke Tracker's preview cards: the tracker's own, a game's, and a shared run's, drawn from the link alone:
 * the game and version, the run's name, its badges, its team's pictures and how many have fallen.
 */

const HEADERS = { "cache-control": "public, max-age=86400, s-maxage=31536000, immutable" };
const ACCENT = "#a47efb";

const cache = new Map<string, Promise<string | null>>();
/** A Pokémon's picture (the site's own render) as a PNG data URI, in grey for the fallen; null if there's none. */
function picture(art: number, size: number, gray = false): Promise<string | null> {
  const key = `${art}@${size}${gray ? "g" : ""}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      try {
        const file = join(process.cwd(), "public/sizes/art/256", `${art}.webp`);
        if (!existsSync(file)) return null;
        let img = sharp(await readFile(file)).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } });
        if (gray) img = img.grayscale();
        return `data:image/png;base64,${(await img.png().toBuffer()).toString("base64")}`;
      } catch {
        return null;
      }
    })();
    cache.set(key, p);
  }
  return p;
}

function Slots({ arts, size = 132 }: { arts: (string | null)[]; size?: number }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", width: size * 3 + 24, gap: 12 }}>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} style={{ display: "flex", width: size, height: size, alignItems: "center", justifyContent: "center", borderRadius: 26, background: arts[i] ? "rgba(164,126,251,0.12)" : "rgba(255,255,255,0.03)", border: arts[i] ? "2px solid rgba(164,126,251,0.35)" : "2px dashed rgba(255,255,255,0.14)" }}>
          {arts[i] && <img src={arts[i]!} width={size - 14} height={size - 14} />}
        </div>
      ))}
    </div>
  );
}

/** The tracker's own card: a team of six in its slots. */
export async function nuzToolCard() {
  const arts = await Promise.all([6, 25, 9, 143, 3, 130].map((id) => picture(id, 118)));
  return ogCard({ eyebrow: "PokéIQ tools", title: ["Nuzlocke", ["Tracker", ACCENT]], subtitle: page.cardSubtitle, accent: ACCENT, visual: <Slots arts={arts} />, footer: "Start your run →" }, HEADERS);
}

/** A game's card: its versions' box-art Pokémon. */
export async function nuzGameCard(view: Pick<GameView, "name" | "versions" | "region" | "gen">) {
  const mascots = [...new Set(view.versions.map((v) => VERSION_LOOK[v.id]?.mascot).filter((m): m is number => !!m))].slice(0, 2);
  const arts = await Promise.all(mascots.map((id) => picture(id, 300)));
  const accent = VERSION_LOOK[view.versions[0]?.id]?.color ?? ACCENT;
  const fitted = fitTitle(view.name, 600, [70, 58, 50, 44]);
  const visual = (
    <div style={{ display: "flex", width: 470, height: 400, alignItems: "center", justifyContent: "center", position: "relative" }}>
      <div style={{ position: "absolute", left: 35, top: 0, width: 400, height: 400, display: "flex", borderRadius: 200, backgroundImage: `radial-gradient(circle, ${accent}55 0%, ${accent}18 50%, ${accent}00 70%)` }} />
      {arts.map((a, i) => a && <img key={i} src={a} width={arts.length > 1 ? 250 : 320} height={arts.length > 1 ? 250 : 320} style={{ marginLeft: i ? -60 : 0, marginTop: i ? 80 : 0 }} />)}
    </div>
  );
  return ogCard({ eyebrow: `Nuzlocke Tracker · ${view.region} · Gen ${view.gen}`, title: fitted.lines, titleSize: fitted.size, subtitle: page.game.lead, accent, visual, footer: "Start your run →" }, HEADERS);
}

/** A shared run's card: its team (the fallen, in grey, when there's no one left), badges and losses. */
export async function nuzRunCard(run: Run, view: GameView) {
  const version = view.versions.find((v) => v.id === run.version);
  const members = team(run);
  const fallen = graveyard(run);
  const showFallen = !members.length && fallen.length > 0;
  const shown = (showFallen ? fallen : members).slice(0, 6);
  const arts = await Promise.all(shown.map((m) => picture(view.mons[m.mon]?.art ?? 0, 118, showFallen)));
  const s = stats(run);
  const badges = badgeCount(run, view);
  const total = badgeTotal(view);
  const accent = VERSION_LOOK[run.version]?.color ?? ACCENT;
  const fitted = fitTitle(run.name || "Nuzlocke", 600, [64, 54, 46, 40]);
  const badgeText = total ? `${badges}/${total} badges` : `${badges} ${badges === 1 ? "badge" : "badges"}`;
  return ogCard(
    {
      eyebrow: `${version?.name ?? view.name} Nuzlocke`,
      title: fitted.lines,
      titleSize: fitted.size,
      subtitle: view.name,
      accent,
      visual: <Slots arts={arts} />,
      chips: [badgeText, `${s.dead} fallen`, `${s.caught} caught`],
    },
    HEADERS
  );
}
