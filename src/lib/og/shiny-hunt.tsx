/* eslint-disable jsx-a11y/alt-text, @next/next/no-img-element -- Satori draws plain <img> */
import "server-only";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { C, HOST, LOGO, OG_SIZE, loadFonts, ogCard } from "@/lib/og/card";
import { SPRITE_HOST } from "@/lib/tier-list/art";
import type { Translator } from "@/i18n/catalog";
import type page from "@/messages/shiny-counter-page";
import type counter from "@/messages/shiny-counter";
import { shinyChance } from "@/lib/shiny-hunt/odds";
import { clock, oneIn } from "@/lib/shiny-hunt/math";
import type { SharedHunt } from "@/lib/shiny-hunt/share";

/**
 * The Shiny Hunt Counter's preview cards: the tool's own card (three shinies on a gold glow), and a shared hunt's card
 * drawn from the link alone: the shiny big, its name, and the hunt's numbers.
 */

const GOLD = "#f6c94a";
const HEADERS = { "cache-control": "public, max-age=86400, s-maxage=31536000, immutable" };
const cache = new Map<string, Promise<string | null>>();

/** A shiny's HOME render (PokéAPI) as a PNG data URI, falling back to its sprite. */
function shinyPicture(id: number, size: number): Promise<string | null> {
  const key = `${id}@${size}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      for (const url of [`${SPRITE_HOST}/other/home/shiny/${id}.png`, `${SPRITE_HOST}/shiny/${id}.png`]) {
        try {
          const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
          if (!r.ok) continue;
          const png = await sharp(Buffer.from(await r.arrayBuffer()))
            .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: url.includes("/other/home/") ? "lanczos3" : "nearest" })
            .png()
            .toBuffer();
          return `data:image/png;base64,${png.toString("base64")}`;
        } catch {
          // try the next
        }
      }
      return null;
    })();
    cache.set(key, p);
    void p.then((v) => v === null && cache.delete(key));
  }
  return p;
}

function Star({ size, style }: { size: number; style: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ position: "absolute", ...style }}>
      <path fill={GOLD} d="M12 0c.6 5.6 1.9 8.6 3.6 10.1C17.3 11.6 19.6 12 24 12c-4.4 0-6.7.4-8.4 1.9C13.9 15.4 12.6 18.4 12 24c-.6-5.6-1.9-8.6-3.6-10.1C6.7 12.4 4.4 12 0 12c4.4 0 6.7-.4 8.4-1.9C10.1 8.6 11.4 5.6 12 0Z" />
    </svg>
  );
}

export async function toolCard(text: { eyebrow: string; title: [string, string]; chips: string[] }) {
  const [left, mid, right] = await Promise.all([shinyPicture(25, 200), shinyPicture(6, 320), shinyPicture(130, 200)]);
  return ogCard(
    {
      eyebrow: text.eyebrow,
      title: [text.title[0], [text.title[1], GOLD]],
      titleSize: 70,
      accent: GOLD,
      chips: text.chips,
      visual: (
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", width: 480, height: 380, position: "relative" }}>
          <div style={{ position: "absolute", inset: 0, display: "flex", backgroundImage: `radial-gradient(circle at 50% 55%, ${GOLD}55 0%, ${GOLD}00 60%)` }} />
          {left && <img src={left} width={160} height={160} style={{ marginRight: -24 }} />}
          {mid && <img src={mid} width={290} height={290} />}
          {right && <img src={right} width={160} height={160} style={{ marginLeft: -24 }} />}
          <Star size={34} style={{ left: 40, top: 30 }} />
          <Star size={22} style={{ right: 50, top: 70 }} />
          <Star size={18} style={{ left: 120, top: 150 }} />
        </div>
      ),
    },
    HEADERS
  );
}

export async function sharedHuntCard(h: SharedHunt, pokemon: string, { t, c }: { t: Translator<typeof page.en>; c: Translator<typeof counter.en> }) {
  const [fonts, art] = await Promise.all([loadFonts(), shinyPicture(h.species, 440)]);
  const p = shinyChance(h.game, h.method, h);
  const stats = [
    { label: t("shared.encounters"), value: h.count.toLocaleString("en-US") },
    { label: t("shared.odds"), value: t("shared.oddsValue", { n: oneIn(p).toLocaleString("en-US") }) },
    { label: t("shared.time"), value: clock(h.minutes * 60_000) },
    ...(h.phases ? [{ label: t("shared.phases"), value: String(h.phases) }] : []),
  ];
  const title = h.found ? t("shared.headlineFound", { pokemon }) : t("shared.headlineHunting", { pokemon });
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: C.bg, color: C.text, fontFamily: "Inter" }}>
        <div style={{ position: "absolute", inset: 0, display: "flex", backgroundImage: `radial-gradient(circle at 28% 52%, ${GOLD}48 0%, ${GOLD}00 42%)` }} />
        <div style={{ position: "absolute", inset: 0, display: "flex", backgroundImage: `radial-gradient(circle at 96% 0%, ${C.violet}40 0%, ${C.violet}00 46%)` }} />
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 6, display: "flex", background: GOLD }} />
        <div style={{ display: "flex", width: 520, alignItems: "center", justifyContent: "center", position: "relative" }}>
          {art && <img src={art} width={440} height={440} />}
          <Star size={44} style={{ left: 60, top: 90 }} />
          <Star size={28} style={{ right: 40, top: 140 }} />
          <Star size={22} style={{ left: 90, bottom: 110 }} />
          <Star size={36} style={{ right: 70, bottom: 90 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flex: 1, paddingRight: 60 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <img src={LOGO} width={44} height={44} />
            <div style={{ display: "flex", marginLeft: 12, fontFamily: "Chakra Petch", fontSize: 28, letterSpacing: 2, textTransform: "uppercase" }}>
              Poké<span style={{ color: C.pink }}>IQ</span>
            </div>
          </div>
          <div style={{ display: "flex", marginTop: 34, fontFamily: "Silkscreen", fontSize: 22, color: GOLD, letterSpacing: 2, textTransform: "uppercase" }}>{h.found ? t("shared.found") : t("shared.hunting")}</div>
          <div style={{ display: "flex", marginTop: 10, fontFamily: "Chakra Petch", fontSize: title.length > 22 ? 50 : 62, lineHeight: 1.02 }}>{title}</div>
          <div style={{ display: "flex", marginTop: 12, fontSize: 24, color: C.muted }}>{`${c(`games.${h.game}`)} · ${c(`methods.${h.method}`)}`}</div>
          <div style={{ display: "flex", marginTop: 30 }}>
            {stats.map((s, i) => (
              <div key={s.label} style={{ display: "flex", flexDirection: "column", padding: "14px 18px", marginRight: 12, borderRadius: 16, background: "rgba(255,255,255,0.06)", border: "2px solid rgba(255,255,255,0.08)" }}>
                <div style={{ display: "flex", fontSize: 16, color: C.muted, textTransform: "uppercase", letterSpacing: 1 }}>{s.label}</div>
                <div style={{ display: "flex", marginTop: 4, fontFamily: "Chakra Petch", fontSize: 34, color: i === 0 ? GOLD : C.text }}>{s.value}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", marginTop: 34, fontFamily: "Silkscreen", fontSize: 18, color: C.muted }}>{`${HOST}/tools/shiny-hunt-counter`}</div>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts, headers: HEADERS }
  );
}
