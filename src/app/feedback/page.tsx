import { BackButton } from "@/components/ui/BackButton";
import type { Metadata } from "next";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { FeedbackPage } from "@/components/layout/FeedbackPage";
import { serverT } from "@/i18n/server";
import site from "@/messages/site";

export function generateMetadata(): Metadata {
  const t = serverT(site);
  return pageMetadata({
    title: t("feedbackPage.title"),
    description: t("feedbackPage.description"),
    path: "/feedback",
    image: SHARE_IMAGES.site,
  });
}

export default function Feedback() {
  const t = serverT(site);
  return (
    <div className="mx-auto max-w-xl space-y-6">
    <BackButton href="/" />
      <div className="space-y-2">
        <p className="hud-label max-md:hidden">{t("feedbackPage.label")}</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight">
          {t.rich("feedbackPage.heading", { em: (c) => <span className="text-primary">{c}</span> })}
        </h1>
        <p className="text-muted-foreground">{t("feedbackPage.intro")}</p>
      </div>
      <div className="hud rounded-lg border bg-card p-6">
        <FeedbackPage />
      </div>
    </div>
  );
}
