import type { Metadata } from "next";
import { EmailLinkLanding } from "@/components/email/EmailLinkLanding";

export const metadata: Metadata = { title: "Confirm your email", robots: { index: false, follow: false } };

export default function EmailConfirmPage() {
  return (
    <div className="space-y-6 pt-6">
      <EmailLinkLanding kind="confirm" />
    </div>
  );
}
