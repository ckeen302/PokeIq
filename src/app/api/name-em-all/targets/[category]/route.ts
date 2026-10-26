import { NextResponse } from "next/server";
import { NEA_CATEGORIES } from "@/lib/name-em-all/categories";
import { neaOutsiders, neaTargets } from "@/lib/name-em-all/targets";

/**
 * GET /api/name-em-all/targets/:category — a category's slots (public data,
 * built once at build time), for the daily and races, whose category is
 * only known in the browser.
 */

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return NEA_CATEGORIES.map((c) => ({ category: c.id }));
}

export async function GET(_request: Request, context: { params: Promise<{ category: string }> }) {
  const { category } = await context.params;
  const targets = neaTargets(category);
  if (!targets) return NextResponse.json({ error: "No such category." }, { status: 404 });
  return NextResponse.json({ category, targets, outsiders: neaOutsiders(category) });
}
