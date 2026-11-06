import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { SIZE_BY_KEY } from "@/lib/sizes/data";
import { COMPARE_PATH, compareOk, compareQuery, parseVs } from "@/lib/sizes/deeplink";
import { orderTitle, parseOrder, withOrder } from "@/lib/sizes/order";
import { formatMetres, type SizeItem } from "@/lib/sizes/types";
import { SizesPage } from "@/components/sizes/SizesPage";

/**
 * /pokedex/sizes/compare?vs=wailord,eternatus: 2 to 6 Pokémon side by side,
 * with its own preview card. Without a valid list it opens the full line
 * with the comparison tray ready. &by=speed&dir=desc stands them in that
 * order.
 */

type Query = { vs?: string | string[]; by?: string | string[]; dir?: string | string[] };

function chosen(vs: string | string[] | undefined): SizeItem[] {
  const raw = Array.isArray(vs) ? vs.join(",") : vs;
  return parseVs(raw, (k) => { const i = SIZE_BY_KEY.get(k); return !!i && i.kind !== "ref"; }).map((k) => SIZE_BY_KEY.get(k)!);
}

export async function generateMetadata({ searchParams }: { searchParams: Promise<Query> }): Promise<Metadata> {
  const q0 = await searchParams;
  const items = chosen(q0.vs);
  const order = parseOrder(q0.by, q0.dir);
  if (!compareOk(items.length)) {
    return pageMetadata({ title: "Compare Pokémon sizes in 3D", description: "Put 2 to 6 Pokémon side by side at their real sizes in 3D, and share the comparison or make it a video.", path: COMPARE_PATH });
  }
  const names = items.map((i) => i.name).join(" vs ");
  const q = compareQuery(items.map((i) => i.key));
  return pageMetadata({
    title: orderTitle(`${names}: size comparison`, order),
    description: `${items.map((i) => `${i.name} ${formatMetres(i.m)}${i.min ? "+" : ""}`).join(", ")}. Side by side at their real sizes in 3D on PokéIQ.`,
    path: withOrder(`${COMPARE_PATH}?vs=${q}`, order),
    image: { url: `${COMPARE_PATH}/og?vs=${q}`, alt: `${names}, side by side at their real sizes` },
  });
}

export default async function Page({ searchParams }: { searchParams: Promise<Query> }) {
  const q = await searchParams;
  return <SizesPage vs={chosen(q.vs)} compare order={parseOrder(q.by, q.dir)} />;
}
