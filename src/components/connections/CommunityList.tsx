"use client";

import Anchor from "@/components/ui/Anchor";
import { useEffect, useState } from "react";
import { PencilLine, Star, ThumbsDown, ThumbsUp } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { customPath, type CustomListResponse, type CustomSummary } from "@/lib/connections/custom";
import { useT } from "@/i18n/client";
import { INTL_LOCALE } from "@/i18n/catalog";
import { localizePath } from "@/i18n/paths";
import community from "@/messages/connections-community";

/** /pokeconnections/community: the week's featured puzzle, the top ones and the newest. Titles and votes only. */

function Row({ p }: { p: CustomSummary }) {
  const t = useT(community);
  return (
    <li>
      <a href={localizePath(customPath(p.id), t.locale)} className="flex items-center justify-between gap-3 rounded-md border border-foreground/15 bg-card px-4 py-3 hover:border-primary/60" data-testid="community-row">
        <span className="min-w-0">
          <span className="block truncate font-display font-bold">{p.title ?? t("untitled")}</span>
          <span className="block text-xs text-muted-foreground">
            {t("rowBy", { creator: p.creator ?? t("aTrainer"), date: new Date(p.createdAt).toLocaleDateString(INTL_LOCALE[t.locale], { month: "short", day: "numeric" }) })}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-3 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <ThumbsUp className="h-4 w-4" aria-hidden /> {p.up}
          </span>
          <span className="flex items-center gap-1">
            <ThumbsDown className="h-4 w-4" aria-hidden /> {p.down}
          </span>
        </span>
      </a>
    </li>
  );
}

export function CommunityList() {
  const t = useT(community);
  const [data, setData] = useState<CustomListResponse | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch("/api/connections/custom")
      .then((r) => r.json())
      .then((b) => setData(b as CustomListResponse))
      .catch(() => setFailed(true));
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-2 text-center">
        <p className="hud-label max-md:hidden text-screen">{t("eyebrow")}</p>
        <h1 className="font-display text-3xl font-bold uppercase tracking-tight sm:text-4xl">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
        <Anchor href="/pokeconnections/create" className={cn(buttonVariants({ size: "sm" }), "mt-1")} data-testid="community-create">
          <PencilLine className="h-4 w-4" aria-hidden /> {t("makeOwn")}
        </Anchor>
      </div>
      {/* Holds the space the list (or its empty state) will take, so the footer doesn't jump when it arrives. */}
      <div className="min-h-[15rem] space-y-8">
        {failed && <p className="text-center text-sm text-destructive">{t("failed")}</p>}
        {!data && !failed && <p className="text-center text-sm text-muted-foreground">{t("loading")}</p>}
        {data && !data.available && <p className="text-center text-sm text-muted-foreground">{t("off")}</p>}
        {data?.available && !data.featured && !data.top.length && !data.newest.length && (
          <div className="mx-auto max-w-md space-y-3 rounded-lg border border-dashed border-foreground/20 bg-card px-5 py-8 text-center" data-testid="community-empty">
            <p className="font-display text-lg font-bold uppercase">{t("empty")}</p>
            <p className="text-sm text-muted-foreground">{t("emptyLine")}</p>
            <Anchor href="/pokeconnections/create" className={buttonVariants()}>
              <PencilLine className="h-4 w-4" aria-hidden /> {t("create")}
            </Anchor>
          </div>
        )}
        {data?.available && (data.featured || data.top.length > 0 || data.newest.length > 0) && (
          <>
            {data.featured && (
              <section className="space-y-2" aria-labelledby="featured-h">
                <h2 id="featured-h" className="flex items-center gap-2 font-display text-xl font-bold uppercase">
                  <Star className="h-5 w-5 text-primary" aria-hidden /> {t("featured")}
                </h2>
                <ul>
                  <Row p={data.featured} />
                </ul>
              </section>
            )}
            <section className="space-y-2" aria-labelledby="top-h">
              <h2 id="top-h" className="font-display text-xl font-bold uppercase">
                {t("top")}
              </h2>
              {data.top.length ? (
                <ul className="space-y-2">
                  {data.top.map((p) => (
                    <Row key={p.id} p={p} />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t("topEmpty")}</p>
              )}
            </section>
            <section className="space-y-2" aria-labelledby="new-h">
              <h2 id="new-h" className="font-display text-xl font-bold uppercase">
                {t("newest")}
              </h2>
              {data.newest.length ? (
                <ul className="space-y-2">
                  {data.newest.map((p) => (
                    <Row key={p.id} p={p} />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t("newestEmpty")}</p>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
