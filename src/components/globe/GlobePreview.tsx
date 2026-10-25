/** A still, CSS-only globe for the /guessr card (no three.js there). */
export function GlobePreview() {
  return (
    <div aria-hidden className="relative mx-auto my-3 h-28 w-28 shrink-0">
      <div
        className="absolute inset-0 rounded-full border border-screen/60"
        style={{
          background:
            "radial-gradient(circle at 36% 32%, hsl(var(--screen) / 0.55) 0 14%, transparent 15%), radial-gradient(circle at 62% 58%, hsl(var(--screen) / 0.5) 0 20%, transparent 21%), radial-gradient(circle at 30% 70%, hsl(var(--screen) / 0.4) 0 10%, transparent 11%), repeating-linear-gradient(90deg, hsl(var(--border)) 0 1px, transparent 1px 14px), repeating-linear-gradient(0deg, hsl(var(--border)) 0 1px, transparent 1px 14px), hsl(var(--card))",
          boxShadow: "0 0 24px hsl(var(--screen) / 0.35), inset -10px -8px 22px hsl(var(--background) / 0.7)",
        }}
      />
      <div className="absolute -inset-2 rounded-full border border-screen/30" style={{ transform: "rotate(-18deg) scaleY(0.28)" }} />
      <span className="absolute left-[58%] top-[52%] h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_6px_hsl(var(--primary))]" />
    </div>
  );
}
