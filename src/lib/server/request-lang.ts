import type { NextRequest } from "next/server";
import { isLiveLocale, type Locale } from "@/i18n/config";

/** The language a request asks to be answered in (`?lang=`, sent by pages in another language): a live one, else English. */
export function langOf(request: NextRequest): Locale {
  const lang = request.nextUrl.searchParams.get("lang");
  return isLiveLocale(lang) ? lang : "en";
}
