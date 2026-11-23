import type { Metadata } from "next";
import { FavoritePickerView, favoritePickerMetadata, one, type Query } from "../view";

/**
 * A shared result: /tools/favorite-pokemon-picker?d=… is rewritten here (next.config), so the picker's own page stays
 * static while a link renders with its result and its own preview card. The address people see keeps ?d=.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }: { searchParams: Promise<Query> }): Promise<Metadata> {
  return favoritePickerMetadata(one((await searchParams).d));
}

export default async function SharedPage({ searchParams }: { searchParams: Promise<Query> }) {
  return <FavoritePickerView raw={one((await searchParams).d)} />;
}
