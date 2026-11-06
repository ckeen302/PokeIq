import "server-only";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { SIZE_BY_KEY, SIZE_ITEMS } from "@/lib/sizes/data";
import { DEFAULT_PRESET, PRESET_BY_ID } from "@/lib/sizes/presets";
import { itemPath, presetPath } from "@/lib/sizes/deeplink";
import { listOrder } from "@/lib/sizes/list";
import { HEIGHT_ORDER, isDefaultOrder, orderInfo, orderTitle, withOrder, type Order } from "@/lib/sizes/order";
import { formatFeet, formatMetres, measureOf, type SizeItem } from "@/lib/sizes/types";

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

const DEFAULT_DESCRIPTION =
  "Every Pokémon side by side at its real size, from 0.1 m to Eternamax Eternatus at 100 m, in a 3D Lumiose City. Play the glide, compare any Pokémon, and make your own size comparison video for TikTok, Reels and Shorts.";

/** The main page's metadata in an order. */
export function mainMetadata(order: Order = HEIGHT_ORDER): Metadata {
  if (isDefaultOrder(order)) {
    return pageMetadata({ title: "Pokémon size comparison: every Pokémon to scale in 3D", description: DEFAULT_DESCRIPTION, path: presetPath(DEFAULT_PRESET.id), socialTitle: "Every Pokémon to scale, in 3D · PokéIQ" });
  }
  const title = orderTitle(DEFAULT_PRESET.title, order);
  return pageMetadata({
    title: `${title} (every Pokémon to scale in 3D)`,
    description: `Every Pokémon lined up by ${orderInfo(order).label.toLowerCase()}, each at its real size, in a 3D Lumiose City. Play the glide, compare any Pokémon, or make a video.`,
    path: withOrder(presetPath(DEFAULT_PRESET.id), order),
    socialTitle: `${title} · PokéIQ`,
  });
}

/** A preset's or a Pokémon's page metadata in an order. */
export function slugMetadata(slug: string, order: Order = HEIGHT_ORDER): Metadata {
  const { preset, item } = resolveSlug(slug);
  if (preset) {
    // A lineup with nothing to show in the order (Gigantamax by weight) stands by height.
    const o = listOrder(SIZE_ITEMS, { preset: preset.id }, order);
    const title = orderTitle(preset.title, o);
    return pageMetadata({ title: `${title} (3D size comparison)`, description: `${preset.blurb} See them to scale in 3D, compare any two, or make a size comparison video.`, path: withOrder(presetPath(preset.id), o) });
  }
  if (item) {
    const size = `${formatMetres(item.m)}${item.min ? "+" : ""} (${formatFeet(item.m)}${item.min ? "+" : ""})`;
    const o = listOrder(SIZE_ITEMS, { preset: DEFAULT_PRESET.id, focus: item.key }, order);
    return pageMetadata({
      title: `How big is ${item.name}? ${size} ${measureOf(item).toLowerCase()}`,
      description: `${item.name} is ${size} ${item.length ? "long" : "tall"}${item.kg != null ? ` and weighs ${item.kg.toLocaleString("en-US")} kg` : ""}. See it to scale next to every other Pokémon and an adult human in 3D.`,
      path: withOrder(itemPath(item.key), o),
      socialTitle: `How big is ${item.name}? · PokéIQ`,
    });
  }
  return {};
}
