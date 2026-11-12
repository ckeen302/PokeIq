/* eslint-disable jsx-a11y/alt-text, @next/next/no-img-element -- Satori draws plain <img> */
import "server-only";
import { ogCard } from "@/lib/og/card";
import { homeRenderUrl } from "@/lib/pokemon/art";
import type { Athlete } from "@/lib/games/athlete";
import { GAMES_BY_KEY } from "@/lib/games/data";
import { eventOf, formatMark, type EventId } from "@/lib/games/events";
import { buildNations, runEvent, runGames, type NationSpec } from "@/lib/games/games";
import { DEFAULT_NATIONS, h2hQuestion } from "@/lib/games/deeplink";
import { DEFAULT_GAMES_SEED } from "@/lib/games/seed";
import { h2hSummary, type H2HSide } from "@/lib/games/h2h";
import { DEFAULT_FIELDS, RECORDS_ALL, RECORDS_FILE } from "@/lib/games/records-data";

/**
 * Preview cards for the PokéIQ Games: the podium of the run being shared
 * (gold in the middle, highest, each medallist's HOME render on its step),
 * the record holder of a records page, the medal table of the Games.
 */

const ACCENT = "#ffd84a";
const W = 470, H = 400;
const MEDAL = ["#ffd21f", "#d9e1ea", "#e6a15c"];

function Render({ a, size }: { a: Athlete; size: number }) {
  const [bx, by, bw, bh] = a.entrant.box;
  const s = size / Math.max(bw, bh);
  return (
    <div style={{ display: "flex", position: "relative", width: bw * s, height: bh * s, overflow: "hidden" }}>
      <img src={homeRenderUrl(a.entrant.art)} width={512 * s} height={512 * s} style={{ position: "absolute", left: -bx * s, top: -by * s }} />
    </div>
  );
}

/** Three steps (2, 1, 3) with the medallists on them and their marks under. */
function Podium({ rows }: { rows: { a: Athlete; mark: string; medal: 1 | 2 | 3 }[] }) {
  const order = [2, 1, 3] as const;
  const stepH = { 1: 120, 2: 88, 3: 66 } as const;
  return (
    <div style={{ display: "flex", position: "relative", width: W, height: H, borderRadius: 16, overflow: "hidden", background: "linear-gradient(180deg,#0b1a3a,#060b18)", border: "3px solid #2a2745" }}>
      {order.map((m, i) => {
        const r = rows.find((x) => x.medal === m);
        // A head to head has no third step.
        if (!r && m === 3) return null;
        const x = 20 + i * 145 + (rows.length < 3 ? 72 : 0);
        return (
          <div key={m} style={{ display: "flex", position: "absolute", left: x, bottom: 0, width: 140, height: H, flexDirection: "column", alignItems: "center", justifyContent: "flex-end" }}>
            {r && <Render a={r.a} size={m === 1 ? 130 : 108} />}
            <div style={{ display: "flex", width: 132, height: stepH[m], marginTop: 4, background: "#f3f4f6", borderTop: `6px solid ${MEDAL[m - 1]}`, borderRadius: 6, flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <div style={{ display: "flex", fontFamily: "Chakra Petch", fontSize: 34, color: "#14213d" }}>{m}</div>
              {r && <div style={{ display: "flex", fontFamily: "Chakra Petch", fontSize: 16, color: "#334155" }}>{r.mark}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A head to head: the two side by side, the winner's frame gold, each one's result under it. */
function Versus({ sides }: { sides: { a: Athlete; s: H2HSide }[] }) {
  return (
    <div style={{ display: "flex", position: "relative", width: W, height: H, borderRadius: 16, overflow: "hidden", background: "linear-gradient(180deg,#0b1a3a,#060b18)", border: "3px solid #2a2745", alignItems: "center", justifyContent: "space-around", padding: "0 14px" }}>
      <div style={{ display: "flex", position: "absolute", left: W / 2 - 24, top: 168, fontFamily: "Chakra Petch", fontSize: 32, color: ACCENT }}>VS</div>
      {sides.map(({ a, s }) => (
        <div key={a.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 190 }}>
          <div style={{ display: "flex", height: 26, marginBottom: 6 }}>
            {s.win && <div style={{ display: "flex", padding: "2px 14px", borderRadius: 13, background: ACCENT, color: "#0d1626", fontFamily: "Chakra Petch", fontSize: 18 }}>WINS</div>}
          </div>
          <div style={{ display: "flex", width: 176, height: 176, borderRadius: 88, alignItems: "center", justifyContent: "center", border: `5px solid ${s.win ? ACCENT : "#5b6478"}`, background: s.win ? "rgba(255,216,74,0.12)" : "rgba(255,255,255,0.05)", opacity: s.win ? 1 : 0.85 }}>
            <Render a={a} size={140} />
          </div>
          <div style={{ display: "flex", marginTop: 12, fontFamily: "Chakra Petch", fontSize: 24, color: "#ffffff", textAlign: "center" }}>{a.name}</div>
          <div style={{ display: "flex", marginTop: 2, fontFamily: "Chakra Petch", fontSize: 26, color: s.win ? ACCENT : "#aab3c5" }}>{s.mark}</div>
        </div>
      ))}
    </div>
  );
}

function podiumOf(event: EventId, keys: string[], seed: number, rain: boolean) {
  const field = keys.map((k) => GAMES_BY_KEY.get(k)).filter((a): a is Athlete => !!a);
  const out = runEvent(event, field, seed, { rain });
  const rows: { a: Athlete; mark: string; medal: 1 | 2 | 3 }[] = [];
  ([[1, out.podium.gold], [2, out.podium.silver], [3, out.podium.bronze]] as const).forEach(([m, ks]) => {
    for (const k of ks.slice(0, 1)) {
      const a = GAMES_BY_KEY.get(k);
      if (a) rows.push({ a, medal: m, mark: event === "wrestling" ? ["Gold", "Silver", "Bronze"][m - 1] : formatMark(event, out.marks.get(k)) });
    }
  });
  return { field, out, rows };
}

/** A shared (or default) run of an event. */
export function gamesEventCard(event: EventId, keys: string[] = [], seed: number | null = null, rain = false) {
  const e = eventOf(event);
  const { field, rows, out } = podiumOf(event, keys.length ? keys : DEFAULT_FIELDS[event], seed ?? DEFAULT_GAMES_SEED, rain);
  const gold = rows.find((r) => r.medal === 1);
  const title = field.length === 2 ? h2hQuestion(event, field[0].name, field[1].name) : e.question;
  if (field.length === 2) {
    const s = h2hSummary(out, field[0], field[1]);
    return ogCard({
      eyebrow: `The PokéIQ Games · ${e.name} · head to head`,
      title: [title],
      titleSize: title.length > 40 ? 40 : title.length > 26 ? 48 : 60,
      subtitle: `${s.line}, from real stats and real physics.`,
      accent: ACCENT,
      visual: <Versus sides={[{ a: field[0], s: s.sides[0] }, { a: field[1], s: s.sides[1] }]} />,
      footer: "Watch it in 3D →",
    });
  }
  return ogCard({
    eyebrow: `The PokéIQ Games · ${e.name}`,
    title: [title],
    titleSize: title.length > 40 ? 40 : title.length > 26 ? 48 : 60,
    subtitle: gold ? `${gold.a.name} wins${event === "wrestling" ? " the bracket" : ` with ${gold.mark}`}, from real stats and real physics.` : "Real stats, real physics, in 3D.",
    accent: ACCENT,
    visual: <Podium rows={rows} />,
    footer: "Watch it in 3D →",
  });
}

/** An event's records: the top three of all 1,025 Pokémon and forms. */
export function gamesRecordsCard(event: EventId) {
  const e = eventOf(event);
  const top = RECORDS_ALL.ranking(event).slice(0, 3);
  const mark = (k: string) => {
    const v = RECORDS_ALL.mark(k, event);
    return v == null ? "" : event === "wrestling" ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} kN` : formatMark(event, v);
  };
  const rows = top.map((k, i) => ({ a: GAMES_BY_KEY.get(k)!, mark: mark(k), medal: (i + 1) as 1 | 2 | 3 })).filter((r) => r.a);
  return ogCard({
    eyebrow: `The PokéIQ Games · ${e.name} records`,
    title: [e.question],
    titleSize: e.question.length > 40 ? 40 : 50,
    subtitle: rows[0] ? `${rows[0].a.name} holds the record with ${rows[0].mark}, out of every Pokémon.` : undefined,
    accent: ACCENT,
    visual: <Podium rows={rows} />,
    footer: "See the top ten →",
  });
}

/** The Games: the nations' medal table, the top three on the podium as their best athletes. */
export function gamesPlayCard(nations: NationSpec[] = DEFAULT_NATIONS, seed: number | null = null, rain = false) {
  const ns = buildNations(nations, GAMES_BY_KEY, RECORDS_FILE.nations);
  const g = runGames(ns, seed ?? DEFAULT_GAMES_SEED, { rain });
  const rows = g.table.slice(0, 3).map((r, i) => ({ a: r.nation.athletes[0], mark: `${r.nation.name} · ${r.gold} gold`, medal: (i + 1) as 1 | 2 | 3 }));
  const champ = g.champion ? GAMES_BY_KEY.get(g.champion) : null;
  return ogCard({
    eyebrow: "The PokéIQ Games · every event",
    title: ["The Games"],
    titleSize: 66,
    subtitle: `${g.table[0]?.nation.name ?? ""} top the medal table${champ ? `; ${champ.name} is the Champion of the Games` : ""}.`,
    accent: ACCENT,
    visual: <Podium rows={rows} />,
    footer: "Watch the Games in 3D →",
  });
}

/** The hub: the 100 m's podium for every Pokémon. */
export function gamesHubCard() {
  const top = RECORDS_ALL.ranking("100m").slice(0, 3);
  const rows = top.map((k, i) => ({ a: GAMES_BY_KEY.get(k)!, mark: formatMark("100m", RECORDS_ALL.mark(k, "100m")), medal: (i + 1) as 1 | 2 | 3 })).filter((r) => r.a);
  return ogCard({
    eyebrow: "3D Lab · real sport, real stats",
    title: ["The PokéIQ", ["Games", ACCENT]],
    titleSize: 66,
    subtitle: "Track and field, weightlifting, swimming and wrestling for every Pokémon, with real physics, in 3D.",
    accent: ACCENT,
    visual: <Podium rows={rows} />,
    footer: "Who is the best athlete? →",
  });
}


