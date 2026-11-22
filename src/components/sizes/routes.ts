import "server-only";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { SIZE_BY_KEY, SIZE_ITEMS } from "@/lib/sizes/data";
import { DEFAULT_PRESET, PRESET_BY_ID } from "@/lib/sizes/presets";
import { itemPath, presetPath } from "@/lib/sizes/deeplink";
import { listOrder } from "@/lib/sizes/list";
import { HEIGHT_ORDER, isDefaultOrder, withOrder, type Order } from "@/lib/sizes/order";
import { formatFeet, formatMetres, type SizeItem } from "@/lib/sizes/types";
import { formatNumber } from "@/i18n/catalog";
import { serverT } from "@/i18n/server";
import sizesPages from "@/messages/sizes-pages";
import sizesLines from "@/messages/sizes-lines";
import { pageItem } from "./local";
import { lowerIn, orderLabel, presetTitle, sizeText } from "./words";

/**
 * The pages of /pokedex/sizes, shared by their plain routes and the routes
 * an order is rendered at (next.config rewrites ?by=speed&dir=desc to
 * …/by/speed-desc, so every order is a cached page of its own while the
 * address the visitor shares stays the query).
 */

/** A slug as a preset or a Pokémon's (or form's) own page. */
export function resolveSlug(slug: string): { preset?: (typeof DEFAULT_PRESET); item?: SizeItem } {
  const preset = slug !== DEFAULT_PRESET.id ? PRESET_BY_ID.get(slug) : undefined;
  const item = preset ? undefined : SIZE_BY_KEY.get(slug);
  return { preset, item: item && item.kind !== "ref" ? item : undefined };
}

/** The main page's metadata in an order. */
export function mainMetadata(order: Order = HEIGHT_ORDER): Metadata {
  const t = serverT(sizesPages);
  const tl = serverT(sizesLines);
  if (isDefaultOrder(order)) {
    return pageMetadata({ title: t("meta.mainTitle"), description: t("meta.mainDescription"), path: presetPath(DEFAULT_PRESET.id), socialTitle: t("meta.mainSocial") });
  }
  const title = presetTitle(DEFAULT_PRESET.id, order, tl);
  return pageMetadata({
    title: t("meta.orderTitle", { title }),
    description: t("meta.orderDescription", { label: lowerIn(orderLabel(order.by, tl), tl) }),
    path: withOrder(presetPath(DEFAULT_PRESET.id), order),
    socialTitle: t("meta.social", { title }),
  });
}

/** A preset's or a Pokémon's page metadata in an order. */
export function slugMetadata(slug: string, order: Order = HEIGHT_ORDER): Metadata {
  const { preset, item: itemEn } = resolveSlug(slug);
  const t = serverT(sizesPages);
  const tl = serverT(sizesLines);
  if (preset) {
    // A lineup with nothing to show in the order (Gigantamax by weight) stands by height.
    const o = listOrder(SIZE_ITEMS, { preset: preset.id }, order);
    const title = presetTitle(preset.id, o, tl);
    return pageMetadata({ title: t("meta.presetTitle", { title }), description: t("meta.presetDescription", { blurb: t(`blurbs.${preset.id as keyof typeof sizesPages.en.blurbs}`) }), path: withOrder(presetPath(preset.id), o) });
  }
  const item = pageItem(itemEn);
  if (item) {
    const en = t.locale === "en";
    const size = en ? `${formatMetres(item.m)}${item.min ? "+" : ""} (${formatFeet(item.m)}${item.min ? "+" : ""})` : sizeText(item, tl);
    const o = listOrder(SIZE_ITEMS, { preset: DEFAULT_PRESET.id, focus: item.key }, order);
    const weighs = item.kg != null ? t("meta.itemWeighs", { kg: en ? item.kg.toLocaleString("en-US") : formatNumber(item.kg, t.locale) }) : "";
    return pageMetadata({
      title: t("meta.itemTitle", { name: item.name, size, measure: t(item.length ? "focus.length" : "focus.height") }),
      description: t(item.length ? "meta.itemLong" : "meta.itemTall", { name: item.name, size, weighs }),
      path: withOrder(itemPath(item.key), o),
      socialTitle: t("meta.itemSocial", { name: item.name }),
    });
  }
  return {};
}
