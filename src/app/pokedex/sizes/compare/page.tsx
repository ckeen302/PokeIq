import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { SIZE_BY_KEY } from "@/lib/sizes/data";
import { COMPARE_PATH, compareOk, compareQuery, parseVs } from "@/lib/sizes/deeplink";
import { isDefaultOrder, parseOrder, withOrder } from "@/lib/sizes/order";
import { formatMetres, type SizeItem } from "@/lib/sizes/types";
import { SizesPage } from "@/components/sizes/SizesPage";
import { pageItem } from "@/components/sizes/local";
import { joinNames, sizeText } from "@/components/sizes/words";
import { serverT } from "@/i18n/server";
import sizesPages from "@/messages/sizes-pages";
import sizesLines from "@/messages/sizes-lines";

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
  const items = chosen(q0.vs).map(pageItem);
  const order = parseOrder(q0.by, q0.dir);
  const t = serverT(sizesPages);
  const tl = serverT(sizesLines);
  if (!compareOk(items.length)) {
    return pageMetadata({ title: t("meta.compareTitle"), description: t("meta.compareDescription"), path: COMPARE_PATH, image: { url: "/pokedex/sizes/opengraph-image", alt: t("meta.compareImage") } });
  }
  const names = joinNames(items.map((i) => i.name), tl);
  const q = compareQuery(items.map((i) => i.key));
  const en = t.locale === "en";
  return pageMetadata({
    title: isDefaultOrder(order) ? t("meta.pairTitle", { names }) : t("meta.pairTitleBy", { names, by: tl(order.dir === "desc" ? `order.${order.by}.byHigh` : `order.${order.by}.by`) }),
    description: t("meta.pairDescription", { list: items.map((i) => `${i.name} ${en ? `${formatMetres(i.m)}${i.min ? "+" : ""}` : sizeText(i, tl)}`).join(", ") }),
    path: withOrder(`${COMPARE_PATH}?vs=${q}`, order),
    image: { url: `${COMPARE_PATH}/og?vs=${q}`, alt: t("meta.pairImage", { names }) },
  });
}

export default async function Page({ searchParams }: { searchParams: Promise<Query> }) {
  const q = await searchParams;
  return <SizesPage vs={chosen(q.vs)} compare order={parseOrder(q.by, q.dir)} />;
}
