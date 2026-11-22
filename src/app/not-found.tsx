/* eslint-disable @next/next/no-img-element -- pre-sized art */
import Link from "@/components/ui/Link";
import { buttonVariants } from "@/components/ui/button";
import type { Metadata } from "next";
import { serverT } from "@/i18n/server";
import site from "@/messages/site";

// The layout's template makes this "Page not found · PokéIQ". Next.js adds the noindex itself.
export const metadata: Metadata = {
  title: site.en.notFound.title,
  description: site.en.notFound.description,
};

/** The 404 in the render's language (app/[locale]'s 404 shows it inside that language's layout). */
export default function NotFound() {
  const t = serverT(site);
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center">
      <div className="screen spotlight flex h-44 w-44 items-center justify-center rounded-md border-[3px] border-black/70">
        <img src="/api/art/201?s=160" alt="" className="relative z-[1] h-32 w-32 object-contain [filter:brightness(0)]" />
      </div>
      <div className="space-y-2">
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">{t("notFound.heading")}</h1>
        <p className="mx-auto max-w-sm text-muted-foreground">
          {t("notFound.body")}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Link href="/" className={buttonVariants()}>
          {t("notFound.home")}
        </Link>
        <Link href="/pokedex" className={buttonVariants({ variant: "outline" })}>
          {t("notFound.pokedex")}
        </Link>
      </div>
    </div>
  );
}
