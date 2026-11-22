/* eslint-disable jsx-a11y/alt-text -- Satori draws plain <img> */
import sharp from "sharp";
import { C, ogCard } from "./card";
import type { TcgCard, TcgSet } from "@/lib/tcg/types";
import { formatApiDate } from "@/lib/tcg/prices";
import { INTL_LOCALE } from "@/i18n/format";
import { englishOgT, type OgT } from "@/lib/og/i18n";

/**
 * Share cards for the TCG pages: a set's logo or a card's scan on the site's
 * 1200 × 630 card. Linking the logo or the scan itself as the preview gave
 * the wrong shape (a 273 × 140 logo, a tall card), which link previews
 * stretch or crop.
 */

/** Only the Pokémon TCG API's own image hosts are fetched. */
const IMAGE_RE = /^https:\/\/images\.(pokemontcg\.io|scrydex\.com)\/[\w./-]+$/;

/** A remote picture as a PNG data URI that fits `width` × `height`, or null when it can't be had: the card is drawn without it. */
async function picture(url: string | undefined, width: number, height: number): Promise<{ src: string; width: number; height: number } | null> {
  if (!url || !IMAGE_RE.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const { data, info } = await sharp(Buffer.from(await res.arrayBuffer()))
      .resize(width, height, { fit: "inside", withoutEnlargement: false })
      .png()
      .toBuffer({ resolveWithObject: true });
    return { src: `data:image/png;base64,${data.toString("base64")}`, width: info.width, height: info.height };
  } catch {
    return null;
  }
}

const frame = { display: "flex", alignItems: "center", justifyContent: "center", width: 470, height: 400 } as const;

export async function tcgSetCard(set: TcgSet | null, t: OgT = englishOgT()) {
  const logo = await picture(set?.images?.logo, 440, 300);
  const date = formatApiDate(set?.releaseDate, INTL_LOCALE[t.locale]);
  const name = set?.name ?? t("tcg.setFallback");
  return ogCard({
    eyebrow: set ? t("tcg.eyebrow", { series: set.series }) : t("tcg.name"),
    title: [name],
    titleSize: name.length > 22 ? 46 : name.length > 14 ? 58 : 72,
    subtitle: set && date ? t("tcg.setSubtitleDate", { date }) : t("tcg.setSubtitle"),
    accent: C.cyan,
    visual: logo ? (
      <div style={frame}>
        <img src={logo.src} width={logo.width} height={logo.height} />
      </div>
    ) : undefined,
    footer: t("tcg.setFooter"),
    t,
  });
}

export async function tcgCardCard(card: TcgCard | null, t: OgT = englishOgT()) {
  const scan = await picture(card?.images?.large ?? card?.images?.small, 300, 410);
  const name = card?.name ?? t("tcg.cardFallback");
  const where = [card?.set?.name, card?.number && `#${card.number}`].filter(Boolean).join(" · ");
  return ogCard({
    eyebrow: card?.set?.series ? t("tcg.eyebrow", { series: card.set.series }) : t("tcg.name"),
    title: [name],
    titleSize: name.length > 22 ? 46 : name.length > 14 ? 58 : 72,
    subtitle: [where, card?.rarity].filter(Boolean).join(" · ") || undefined,
    accent: C.cyan,
    visual: scan ? (
      <div style={frame}>
        <img src={scan.src} width={scan.width} height={scan.height} style={{ borderRadius: 14 }} />
      </div>
    ) : undefined,
    footer: t("tcg.cardFooter"),
    t,
  });
}
