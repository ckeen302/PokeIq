import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { SIZE_BY_KEY } from "@/lib/sizes/data";
import { COMPARE_PATH, compareOk, compareQuery, parseVs } from "@/lib/sizes/deeplink";
import { formatMetres, type SizeItem } from "@/lib/sizes/types";
import { SizesPage } from "@/components/sizes/SizesPage";

/**
 * /pokedex/sizes/compare?vs=wailord,eternatus: 2 to 6 Pokémon side by side,
 * with its own preview card. Without a valid list it opens the full line
 * with the comparison tray ready.
 */

function chosen(vs: string | string[] | undefined): SizeItem[] {
  const raw = Array.isArray(vs) ? vs.join(",") : vs;
  return parseVs(raw, (k) => { const i = SIZE_BY_KEY.get(k); return !!i && i.kind !== "ref"; }).map((k) => SIZE_BY_KEY.get(k)!);
}

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ vs?: string | string[] }> }): Promise<Metadata> {
  const items = chosen((await searchParams).vs);
  if (!compareOk(items.length)) {
    return pageMetadata({ title: "Compare Pokémon sizes in 3D", description: "Put 2 to 6 Pokémon side by side at their real sizes in 3D, and share the comparison or make it a video.", path: COMPARE_PATH });
  }
  const names = items.map((i) => i.name).join(" vs ");
  const q = compareQuery(items.map((i) => i.key));
  return pageMetadata({
    title: `${names}: size comparison`,
    description: `${items.map((i) => `${i.name} ${formatMetres(i.m)}${i.min ? "+" : ""}`).join(", ")}. Side by side at their real sizes in 3D on PokéIQ.`,
    path: `${COMPARE_PATH}?vs=${q}`,
    image: { url: `${COMPARE_PATH}/og?vs=${q}`, alt: `${names}, side by side at their real sizes` },
  });
}

export default async function Page({ searchParams }: { searchParams: Promise<{ vs?: string | string[] }> }) {
  const items = chosen((await searchParams).vs);
  return <SizesPage vs={items} />;
}
