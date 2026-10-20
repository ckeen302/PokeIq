import { C, OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";

/** Share card for /whoami (spoiler-free: questions and a grid being struck out). */

export const alt = "Who Am I? Deduce the secret Pokémon with yes/no questions";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

function QuestionsVisual() {
  const asked: [string, boolean][] = [
    ["Am I Fire-type?", false],
    ["Am I from Gen 4 or later?", true],
    ["Is my base Speed over 90?", true],
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: 26, borderRadius: 18, background: C.panel, border: `3px solid ${C.edge}`, width: 470 }}>
      {asked.map(([q, yes]) => (
        <div key={q} style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 26, color: C.text }}>
          <div style={{ display: "flex", width: 64, justifyContent: "center", borderRadius: 8, padding: "4px 0", fontSize: 20, background: yes ? C.green : C.red, color: "#08071a" }}>
            {yes ? "YES" : "NO"}
          </div>
          {q}
        </div>
      ))}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
        {Array.from({ length: 24 }, (_, i) => (
          <div key={i} style={{ display: "flex", width: 44, height: 44, borderRadius: 8, background: [3, 9, 17].includes(i) ? C.cyan : C.edge, opacity: [3, 9, 17].includes(i) ? 1 : 0.45 }} />
        ))}
      </div>
    </div>
  );
}

export default function Image() {
  return ogCard({
    eyebrow: "Who Am I? · deduction race",
    title: ["Who", ["am I?", C.cyan]],
    subtitle: "100 PP of yes/no questions. Strike the grid, name the Pokémon, race a rival live.",
    accent: C.cyan,
    visual: <QuestionsVisual />,
    footer: "Daily, practice, or duel a stranger →",
  });
}
