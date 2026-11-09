import type { Metadata } from "next";
import { EmailLinkLanding } from "@/components/email/EmailLinkLanding";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };

export default function EmailUnsubscribePage() {
  return (
    <div className="space-y-6 pt-6">
      <EmailLinkLanding kind="unsubscribe" />
    </div>
  );
}
