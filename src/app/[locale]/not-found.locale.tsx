// A missing page under a language: the site's 404, inside that language's layout and in its language.
import type { Metadata } from "next";
import { serverT } from "@/i18n/server";
import site from "@/messages/site";

export { default } from "@/app/not-found";

export function generateMetadata(): Metadata {
  const t = serverT(site);
  return { title: t("notFound.title"), description: t("notFound.description") };
}
