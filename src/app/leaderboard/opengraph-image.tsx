import { C, OG_CONTENT_TYPE, OG_SIZE, ogCard } from "@/lib/og/card";
import { ogT } from "@/lib/og/i18n";

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

export default async function Image(props: { params?: unknown }) {
  const t = await ogT(props);
  return ogCard({
    eyebrow: t("leaderboard.eyebrow"),
    title: [t("leaderboard.title1"), [t("leaderboard.title2"), C.yellow]],
    subtitle: t("leaderboard.subtitle"),
    accent: C.yellow,
    visual: <Podium />,
    footer: t("leaderboard.footer"),
    t,
  });
}
