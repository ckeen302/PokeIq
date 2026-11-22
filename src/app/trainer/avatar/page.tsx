import type { Metadata } from "next";
import { BackButton } from "@/components/ui/BackButton";
import { TrainerCreator } from "@/components/trainer3d/TrainerCreator";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import trainerPages from "@/messages/trainer-pages";
import trainerCreator from "@/messages/trainer-creator";

export function generateMetadata(): Metadata {
  const t = serverT(trainerPages);
  return pageMetadata({
    title: t("creator.title"),
    description: t("creator.description"),
    path: "/trainer/avatar",
    image: SHARE_IMAGES.site,
  });
}

export default function TrainerAvatarPage() {
  const t = serverT(trainerPages);
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <BackButton href="/trainer" label={t("creator.back")} />
      <header className="space-y-1">
        <p className="hud-label max-md:hidden text-screen">{t("creator.label")}</p>
        <h1 className="font-display text-3xl font-bold uppercase tracking-wide sm:text-4xl">{t("creator.heading")}</h1>
      </header>
      <ClientMessages namespaces={[trainerCreator]}>
        <TrainerCreator />
      </ClientMessages>
    </div>
  );
}
