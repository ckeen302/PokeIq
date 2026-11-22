import { BackButton } from "@/components/ui/BackButton";
import type { Metadata } from "next";
import Link from "@/components/ui/Link";
import { AuthForm } from "@/components/account/AuthForm";
import { OAuthButtons } from "@/components/account/OAuthButtons";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import accountPages from "@/messages/account-pages";
import account from "@/messages/account";
import email from "@/messages/email";

export function generateMetadata(): Metadata {
  const t = serverT(accountPages);
  return { title: t("login.title"), robots: { index: false } };
}

export default function LoginPage() {
  const t = serverT(accountPages);
  return (
    <div className="space-y-6">
      <BackButton href="/" />
      <div className="space-y-2 text-center">
        <p className="hud-label max-md:hidden text-screen">{t("login.label")}</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight">{t("login.heading")}</h1>
        <p className="text-sm text-muted-foreground">{t("login.intro")}</p>
      </div>
      <ClientMessages namespaces={[account, email]}>
        <OAuthButtons />
        <AuthForm />
      </ClientMessages>
      <p className="text-center text-xs text-muted-foreground">
        {t("login.ages")}{" "}
        <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
          {t("login.privacy")}
        </Link>
      </p>
    </div>
  );
}
