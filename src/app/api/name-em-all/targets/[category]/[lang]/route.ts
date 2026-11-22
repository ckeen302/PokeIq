import { NextResponse } from "next/server";
import { LIVE_OTHER_LOCALES, type OtherLocale } from "@/i18n/config";
import { getT } from "@/i18n/server";
import neaCats from "@/messages/nea-cats";
import { NEA_CATEGORIES, neaCategory } from "@/lib/name-em-all/categories";
import { categoryText, localOutsiders, localTargets } from "@/lib/name-em-all/localize";

/**
 * GET /api/name-em-all/targets/:category/:lang — a category's slots in another live language (public data, built at
 * build time), for the daily and races there: each slot's name in that language and the other names it answers to,
 * the species outside the category likewise, and the category's label and heading. English uses ../route.ts as before;
 * an English-only build has none of these.
 */

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams({ params }: { params?: { category?: string } } = {}) {
  const categories = params?.category ? NEA_CATEGORIES.filter((c) => c.id === params.category) : NEA_CATEGORIES;
  return categories.flatMap((c) => LIVE_OTHER_LOCALES.map((lang) => ({ category: c.id, lang })));
}

export async function GET(_request: Request, context: { params: Promise<{ category: string; lang: string }> }) {
  const { category, lang } = await context.params;
  const cat = neaCategory(category);
  if (!cat || !(LIVE_OTHER_LOCALES as readonly string[]).includes(lang)) return NextResponse.json({ error: "No such category." }, { status: 404 });
  const t = await getT(neaCats, lang as OtherLocale);
  const { label, h1 } = categoryText(cat, t);
  return NextResponse.json({ category, targets: localTargets(category, t), outsiders: localOutsiders(category, t), label, h1 });
}
