import type { Metadata } from "next";
import { OAuthSignup } from "@/components/account/OAuthSignup";

export const metadata: Metadata = { title: "Pick your trainer name", robots: { index: false } };

export default function OAuthSignupPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <p className="hud-label text-screen">New trainer</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight">Pick your trainer name</h1>
      </div>
      <OAuthSignup />
    </div>
  );
}
