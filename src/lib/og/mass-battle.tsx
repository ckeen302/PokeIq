/* eslint-disable jsx-a11y/alt-text, @next/next/no-img-element -- Satori draws plain <img> */
import "server-only";
import { C, ogCard, type TitleLine } from "@/lib/og/card";
import { homeRenderUrl } from "@/lib/pokemon/art";
import { speciesById } from "@/lib/mass-battle/page-data";

/**
 * Preview cards for Mass Battle links: the two armies' Pokémon HOME renders
 * facing off (a crowd of the army's species on the left, the other side on
 * the right, bigger when it's a lone boss) with the answer or the result.
 */

const ACCENT = "#ff9a2e";

/** One figure cropped to its visible box, `h` px tall. */
function Figure({ id, h }: { id: number; h: number }) {
  const s = speciesById().get(id);
  if (!s) return null;
  const [bx, by, bw, bh, size] = s.box;
  const k = h / bh;
  return (
    <div style={{ display: "flex", position: "relative", width: Math.max(4, bw * k), height: h, overflow: "hidden" }}>
      <img src={homeRenderUrl(id)} width={size * k} height={size * k} style={{ position: "absolute", left: -bx * k, top: -by * k }} />
    </div>
  );
}

/** Left: a crowd (up to three species, a few of each); right: the other side. */
function FaceOff({ left, right, leftCount, rightCount, big }: { left: number[]; right: number[]; leftCount: number; rightCount: number; big: string | null }) {
  const crowd = left.slice(0, 3);
  const many = leftCount > 3;
  const bossSide = rightCount <= 3;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 450, height: 400, justifyContent: "flex-end" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", width: 450 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 200, overflow: "hidden" }}>
          {many && (
            <div style={{ display: "flex", gap: 2, marginBottom: -22, opacity: 0.6 }}>
              {[0, 1, 2].map((k) => <Figure key={k} id={crowd[k % crowd.length]} h={50} />)}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 2 }}>
            {(many ? [0, 1, 2] : [0]).map((k) => <Figure key={k} id={crowd[k % crowd.length]} h={many ? 78 : 140} />)}
          </div>
        </div>
        <div style={{ display: "flex", fontFamily: "Chakra Petch", fontSize: 46, color: ACCENT, marginBottom: 50, marginLeft: 6, marginRight: 6 }}>VS</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, width: 190, justifyContent: "center", overflow: "hidden" }}>
          {right.slice(0, bossSide ? 1 : 2).map((id) => <Figure key={id} id={id} h={bossSide ? 210 : 110} />)}
        </div>
      </div>
      <div style={{ display: "flex", height: 4, width: 440, marginTop: 4, borderRadius: 2, background: `linear-gradient(90deg, ${ACCENT}00, ${ACCENT}, ${ACCENT}00)` }} />
      {big && (
        <div style={{ display: "flex", marginTop: 14, padding: "6px 18px", borderRadius: 12, background: C.panel, border: `2px solid ${ACCENT}`, fontFamily: "Chakra Petch", fontSize: 40, color: C.text }}>
          {big}
        </div>
      )}
    </div>
  );
}

export function massBattleCard(o: { eyebrow?: string; title: TitleLine[]; subtitle: string; left: number[]; right: number[]; leftCount: number; rightCount: number; big: string | null; footer?: string }) {
  const longest = Math.max(...o.title.map((t) => (typeof t === "string" ? t : t[0]).length));
  return ogCard({
    eyebrow: o.eyebrow ?? "Pokémon Mass Battle · 3D",
    title: o.title,
    titleSize: longest > 22 ? 46 : longest > 15 ? 56 : 68,
    subtitle: o.subtitle,
    accent: ACCENT,
    visual: <FaceOff left={o.left} right={o.right} leftCount={o.leftCount} rightCount={o.rightCount} big={o.big} />,
    footer: o.footer ?? "Watch it in 3D →",
  });
}
