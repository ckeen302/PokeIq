import { BackButton } from "@/components/ui/BackButton";
import type { Metadata } from "next";
import { TrainerCard } from "@/components/trainer/TrainerCard";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import { trainerLocal } from "@/lib/trainer/local";
import trainerPages from "@/messages/trainer-pages";
import trainerCard from "@/messages/trainer-card";
import coach from "@/messages/coach";
import avatar from "@/messages/avatar";
import account from "@/messages/account";
import email from "@/messages/email";
import badges from "@/messages/badges";
import battleGlicko from "@/messages/battle-glicko";
import battleRecord from "@/messages/battle-record";

export function generateMetadata(): Metadata {
  const t = serverT(trainerPages);
  return { title: t("card.title"), robots: { index: false } };
}

export default function TrainerPage() {
  const t = serverT(trainerPages);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <BackButton href="/" />
      <ClientMessages namespaces={[trainerCard, coach, avatar, account, email, badges, battleRecord, battleGlicko]}>
        <TrainerCard local={trainerLocal(t.locale)} />
      </ClientMessages>
    </div>
  );
}
