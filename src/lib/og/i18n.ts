import "server-only";
import { isLiveLocale, type Locale } from "@/i18n/config";
import { translator, type Translator } from "@/i18n/catalog";
import { getT } from "@/i18n/server";
import og from "@/messages/og";

/**
 * Share images in the page's language. An image route renders outside React (no `enterLocale`, so no `serverT`):
 * its language comes in its params instead. An English route has no `locale` param (English, exactly as before);
 * a /<lang>/ mirror of it (src/i18n/mirror.tsx `mirrorImage`) passes the language's code there.
 */

export type OgT = Translator<typeof og.en>;

/** The cards' English text (the default of every helper that takes a translator). */
export const englishOgT = (): OgT => translator(og, "en", undefined);

/** The language an image route is drawn in: the mirror's `locale` param, English otherwise. */
export async function ogLocale(props?: { params?: unknown }): Promise<Locale> {
  const params = (await props?.params) as { locale?: unknown } | undefined;
  const locale = params?.locale;
  return isLiveLocale(locale) ? locale : "en";
}

/** The og namespace in the image route's language. */
export async function ogT(props?: { params?: unknown }): Promise<OgT> {
  return getT(og, await ogLocale(props));
}
