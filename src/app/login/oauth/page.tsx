import type { Metadata } from "next";
import { OAuthSignup } from "@/components/account/OAuthSignup";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import accountPages from "@/messages/account-pages";
import account from "@/messages/account";
import email from "@/messages/email";

export function generateMetadata(): Metadata {
  const t = serverT(accountPages);
  return { title: t("oauth.title"), robots: { index: false } };
}

export default function OAuthSignupPage() {
  const t = serverT(accountPages);
  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <p className="hud-label text-screen">{t("oauth.label")}</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight">{t("oauth.heading")}</h1>
      </div>
      <ClientMessages namespaces={[account, email]}>
        <OAuthSignup />
      </ClientMessages>
    </div>
  );
}
