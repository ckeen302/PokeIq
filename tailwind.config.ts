import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: { DEFAULT: "1rem", sm: "2rem" },
      screens: { "2xl": "1200px" },
    },
    extend: {
      fontFamily: {
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-body)", "sans-serif"],
        pixel: ["var(--font-pixel)", "ui-monospace", "monospace"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: "hsl(var(--warning))",
        screen: "hsl(var(--screen))",
        shade: "hsl(var(--shade) / <alpha-value>)",
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // The shared UI kit's tokens (globals.css): each has a dark and a light value.
        surface: {
          DEFAULT: "hsl(var(--surface) / <alpha-value>)",
          raised: "hsl(var(--surface-raised) / <alpha-value>)",
          line: "hsl(var(--surface-line) / <alpha-value>)",
        },
        well: "hsl(var(--well) / <alpha-value>)",
        select: {
          DEFAULT: "hsl(var(--select) / <alpha-value>)",
          ink: "hsl(var(--select-ink) / <alpha-value>)",
        },
        feature: {
          ink: "hsl(var(--feature-ink) / <alpha-value>)",
          sub: "hsl(var(--feature-sub) / <alpha-value>)",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 1px)",
        sm: "calc(var(--radius) - 3px)",
      },
      keyframes: {
        blink: { "0%, 49%": { opacity: "1" }, "50%, 100%": { opacity: "0" } },
        nudge: { "0%, 100%": { transform: "translateX(0)" }, "50%": { transform: "translateX(3px)" } },
        scan: { "0%": { transform: "translateY(-100%)" }, "100%": { transform: "translateY(100%)" } },
        flicker: { "0%, 100%": { opacity: "1" }, "92%": { opacity: "1" }, "93%": { opacity: "0.7" }, "94%": { opacity: "1" } },
        // A phone's bottom sheet: up and in from transparent (a plain 0, so a pop-up never counts as the page's largest paint).
        "sheet-in": { from: { opacity: "0", transform: "translateY(2.5rem)" }, to: { opacity: "1", transform: "none" } },
        // A how-to sheet rises from below the screen: its first paint is off screen, so a first visit's how-to never counts as the page's largest paint.
        "sheet-up": { from: { transform: "translateY(100dvh)" }, to: { transform: "none" } },
        // The home page: the hero's picture drifts like a slow camera, light sweeps across Play now and then, colour drifts behind the page, the dailies rise in.
        "hero-drift": { "0%": { transform: "scale(1.02) translate3d(0, 0, 0)" }, "100%": { transform: "scale(1.1) translate3d(-2.5%, -1.5%, 0)" } },
        shine: { "0%, 72%": { transform: "translateX(-120%) skewX(-20deg)" }, "88%, 100%": { transform: "translateX(320%) skewX(-20deg)" } },
        "glow-a": { "0%, 100%": { transform: "translate3d(0, 0, 0) scale(1)" }, "50%": { transform: "translate3d(14vw, 10vh, 0) scale(1.15)" } },
        "glow-b": { "0%, 100%": { transform: "translate3d(0, 0, 0) scale(1.1)" }, "50%": { transform: "translate3d(-16vw, -8vh, 0) scale(0.95)" } },
        "glow-c": { "0%, 100%": { transform: "translate3d(0, 0, 0) scale(1)" }, "50%": { transform: "translate3d(10vw, -12vh, 0) scale(1.2)" } },
        rise: { from: { opacity: "0", transform: "translateY(14px)" }, to: { opacity: "1", transform: "none" } },
      },
      animation: {
        blink: "blink 1s steps(1) infinite",
        nudge: "nudge 0.8s ease-in-out infinite",
        scan: "scan 6s linear infinite",
        flicker: "flicker 6s linear infinite",
        "sheet-in": "sheet-in 0.2s ease-out",
        "sheet-up": "sheet-up 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) both",
        "hero-drift": "hero-drift 26s ease-in-out infinite alternate",
        shine: "shine 5.5s ease-in-out 1.5s infinite",
        "glow-a": "glow-a 34s ease-in-out infinite",
        "glow-b": "glow-b 41s ease-in-out infinite",
        "glow-c": "glow-c 47s ease-in-out infinite",
        rise: "rise 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) both",
      },
    },
  },
  plugins: [animate],
};

export default config;
