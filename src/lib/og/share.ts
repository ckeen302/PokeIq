import "server-only";
import type { DescribeOptions } from "@/lib/share/view";
import type { Locale } from "@/i18n/config";
import { getT } from "@/i18n/server";
import share from "@/messages/share";
import sharePage from "@/messages/share-page";

/**
 * describeShare's words in a share image's language (the same as /s/<payload>'s page uses): the share text, the
 * landing page's lines and the regions' official names. English: nothing (describeShare's own English).
 */
export async function shareTranslators(locale: Locale): Promise<DescribeOptions> {
  if (locale === "en") return {};
  const [t, tp, regions] = await Promise.all([
    getT(share, locale),
    getT(sharePage, locale),
    import(`@/data/i18n/${locale}/regions.json`).then((m) => m.default as Record<string, string>),
  ]);
  return { t, tp, region: (id) => regions[id] };
}
