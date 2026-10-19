import { C, OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";

/** Share card for the leaderboards. */

export const alt = "PokéIQ leaderboards";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

/** A podium (no names: the boards change all day). */
function Podium() {
  const steps: [string, number, string][] = [
    ["2", 200, C.muted],
    ["1", 280, C.yellow],
    ["3", 150, "#cd7f32"],
  ];
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 16, width: 470, height: 380 }}>
      {steps.map(([place, height, color]) => (
        <div
          key={place}
          style={{
            display: "flex",
            flex: 1,
            height,
            alignItems: "flex-start",
            justifyContent: "center",
            paddingTop: 18,
            borderRadius: "14px 14px 0 0",
            background: C.panel,
            border: `3px solid ${color}`,
            fontFamily: "Chakra Petch",
            fontSize: 72,
            color,
          }}
        >
          {place}
        </div>
      ))}
    </div>
  );
}

export default function Image() {
  return ogCard({
    eyebrow: "Leaderboards · updated live",
    title: ["Top", ["trainers", C.yellow]],
    subtitle: "Daily Challenge, PokéIQ, PokéGuessr and every quiz mode. Where do you rank?",
    accent: C.yellow,
    visual: <Podium />,
    footer: "Play a run to get on the board →",
  });
}
