import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Apple touch icon: the Master Ball brain mark on the aurora tile. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #1e1b4b, #3b0764)",
          borderRadius: 36,
        }}
      >
        <div
          style={{
            width: 110,
            height: 110,
            borderRadius: 55,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            border: "6px solid #2e1065",
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
        <div
          style={{
            position: "absolute",
            width: 44,
            height: 44,
            borderRadius: 22,
            background: "#2e1065",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 13,
              background: "#fce7f3",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: 6,
                background: "#ec4899",
                display: "flex",
              }}
            />
          </div>
        </div>
      </div>
    ),
    size,
  );
}
