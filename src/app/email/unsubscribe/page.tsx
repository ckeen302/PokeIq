import type { Metadata } from "next";
import { EmailLinkLanding } from "@/components/email/EmailLinkLanding";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import pages from "@/messages/email-pages";
import landing from "@/messages/email-landing";

export function generateMetadata(): Metadata {
  return { title: serverT(pages)("unsubscribe.title"), robots: { index: false, follow: false } };
}

export default function EmailUnsubscribePage() {
  return (
    <div className="space-y-6 pt-6">
      <ClientMessages namespaces={[landing]}>
        <EmailLinkLanding kind="unsubscribe" />
      </ClientMessages>
    </div>
  );
}
