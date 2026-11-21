/* eslint-disable jsx-a11y/alt-text, @next/next/no-img-element -- Satori draws plain <img> */
import "server-only";
import { C, localImage, ogCard } from "./card";
import { CASES } from "@/lib/theories/data";
import { VERDICT_LABEL, caseNumber, type TheoryCase, type Verdict } from "@/lib/theories/types";

/**
 * Preview cards for the Theories tab: the case files' card shows a few case
 * photos pinned up, and each case's card shows its own photos with the
 * verdict stamped across them, in the board's pink-string look.
 */

const VERDICT_COLOR: Record<Verdict, string> = { confirmed: C.green, fan: C.violet, debunked: C.pink };

const art = (id: number) => localImage(`public/art/160/${id}.webp`, 220);

function GlitchTiles({ size }: { size: number }) {
  const tiles = [1, 2, 0, 3, 1, 2, 1, 2, 0, 2, 0, 2, 1, 2, 1, 3, 1, 0, 2, 1, 2, 1, 2, 0, 3];
  const colors = ["transparent", C.muted, "#c9b8ff", C.text];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", width: size * 5 + 8, gap: 2 }}>
      {tiles.map((t, i) => (
        <div key={i} style={{ display: "flex", width: size, height: size, background: colors[t] }} />
      ))}
    </div>
  );
}

function Photo({ src, name, rotate, glitch }: { src?: string; name: string; rotate: number; glitch?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", position: "relative", width: 200, padding: 10, borderRadius: 12, background: C.panel, border: `2px solid ${C.edge}`, transform: `rotate(${rotate}deg)`, boxShadow: "0 22px 40px rgba(0,0,0,0.6)" }}>
      <div style={{ display: "flex", position: "absolute", left: 93, top: -8, width: 16, height: 16, borderRadius: 8, background: C.pink, boxShadow: "0 0 0 4px rgba(241,65,124,0.2)" }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 180, borderRadius: 8, background: "#000" }}>
        {glitch || !src ? <GlitchTiles size={24} /> : <img src={src} width={160} height={160} />}
      </div>
      <div style={{ display: "flex", marginTop: 8, fontFamily: "Chakra Petch", fontSize: 20, letterSpacing: 2, textTransform: "uppercase", color: C.text }}>{name}</div>
    </div>
  );
}

function Stamp({ verdict }: { verdict: Verdict }) {
  const color = VERDICT_COLOR[verdict];
  return (
    <div style={{ display: "flex", padding: "8px 18px", border: `4px solid ${color}`, borderRadius: 8, color, fontFamily: "Chakra Petch", fontSize: 30, letterSpacing: 6, textTransform: "uppercase", background: "rgba(8,7,18,0.75)", transform: "rotate(-8deg)" }}>
      {VERDICT_LABEL[verdict]}
    </div>
  );
}

async function CaseVisual({ c }: { c: TheoryCase }) {
  const pics = c.glitch ? [] : await Promise.all(c.art.slice(0, 2).map((a) => art(a.id)));
  return (
    <div style={{ display: "flex", position: "relative", width: 470, height: 400, alignItems: "center", justifyContent: "center" }}>
      {c.glitch || pics.length < 2 ? (
        <Photo src={pics[0]} name={c.glitch ? "MissingNo." : c.art[0].name} rotate={4} glitch={c.glitch} />
      ) : (
        <div style={{ display: "flex", gap: 30 }}>
          <Photo src={pics[0]} name={c.art[0].name} rotate={-6} />
          <Photo src={pics[1]} name={c.art[1].name} rotate={5} />
        </div>
      )}
      <div style={{ display: "flex", position: "absolute", bottom: 6, left: 120 }}>
        <Stamp verdict={c.verdict} />
      </div>
    </div>
  );
}

export async function theoryCaseCard(c: TheoryCase) {
  const accent = VERDICT_COLOR[c.verdict];
  return ogCard({
    eyebrow: `${caseNumber(c.n)} · ${VERDICT_LABEL[c.verdict]}`,
    title: [[c.title, C.text]],
    titleSize: c.title.length > 34 ? 46 : c.title.length > 22 ? 54 : 64,
    subtitle: c.summary,
    accent,
    visual: await CaseVisual({ c }),
    footer: "Open the case file →",
  });
}

export async function theoriesCard() {
  const picks = ["gengar-is-clefables-shadow", "mew-is-under-the-truck", "cubone-wears-its-mothers-skull"].map((slug) => CASES.find((c) => c.slug === slug)!);
  const pics = await Promise.all(picks.map((c) => art(c.art[c.art.length - 1].id)));
  return ogCard({
    eyebrow: "Pokédex · theories",
    title: ["The case", ["files", C.pink]],
    subtitle: "Fan theories, urban legends and beta myths, each with its evidence and a verdict.",
    accent: C.violet,
    visual: (
      <div style={{ display: "flex", position: "relative", width: 470, height: 400 }}>
        {picks.map((c, i) => (
          <div key={c.slug} style={{ display: "flex", position: "absolute", left: [0, 250, 125][i], top: [10, 0, 170][i] }}>
            <Photo src={pics[i]} name={c.art[c.art.length - 1].name} rotate={[-6, 5, -2][i]} />
          </div>
        ))}
      </div>
    ),
    chips: ["Confirmed", "Fan theory", "Debunked"],
  });
}
