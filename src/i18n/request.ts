import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, isLiveLocale } from "./config";
import { loadMessages } from "./messages";

// next-intl's per-request setup. Every layout and page that renders in a language calls setRequestLocale first,
// so `requestLocale` comes from there and never from headers (pages stay static).
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = isLiveLocale(requested) ? requested : DEFAULT_LOCALE;
  return { locale, messages: await loadMessages(locale) };
});
