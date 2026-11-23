import type { Metadata } from "next";
import { FavoritePickerView, favoritePickerMetadata } from "./view";

/**
 * /tools/favorite-pokemon-picker: the Favorite Pokémon Picker. Built once and served from the CDN; a shared result
 * (?d=…) is rewritten to ./shared (next.config), which opens that result with its own preview card.
 */
export function generateMetadata(): Promise<Metadata> {
  return favoritePickerMetadata(undefined);
}

export default function Page() {
  return <FavoritePickerView raw={undefined} />;
}
