import { ImageResponse } from "next/og";

export const alt = "PokéIQ — The Ultimate Pokémon Knowledge Engine";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background:
            "linear-gradient(135deg, #050510 0%, #14123a 50%, #04283a 100%)",
          color: "#eef0fb",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 24,
          }}
        >
          <div
            style={{
              width: 84,
              height: 84,
              borderRadius: 42,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              border: "5px solid rgba(255,255,255,0.85)",
            }}
          >
            <div
              style={{
                flex: 1,
                background: "linear-gradient(135deg, #e9d5ff, #c084fc, #9333ea)",
                display: "flex",
              }}
            />
            <div style={{ height: 10, background: "#2e1065", display: "flex" }} />
            <div style={{ flex: 1, background: "#f8fafc", display: "flex" }} />
          </div>
          <div style={{ display: "flex", fontSize: 96, fontWeight: 900 }}>
            <span>Poké</span>
            <span style={{ color: "#7dd3fc" }}>IQ</span>
          </div>
        </div>
        <div
          style={{
            marginTop: 28,
            fontSize: 38,
            color: "#b6bcdd",
            display: "flex",
          }}
        >
          How deep does your Pokédex go?
        </div>
        <div
          style={{
            marginTop: 44,
            display: "flex",
            gap: 18,
            fontSize: 26,
          }}
        >
          {["👁️ Who's That?", "🔍 Types", "⚡ Moves", "📊 Stats"].map((label) => (
            <div
              key={label}
              style={{
                display: "flex",
                padding: "12px 28px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.14)",
              }}
            >
              {label}
            </div>
          ))}
        </div>
        <div
          style={{
            marginTop: 44,
            fontSize: 22,
            color: "#7dd3fc",
            display: "flex",
            letterSpacing: 4,
          }}
        >
          EVERY QUESTION COMPUTED LIVE · ZERO QUESTION BANKS
        </div>
      </div>
    ),
    size,
  );
}
