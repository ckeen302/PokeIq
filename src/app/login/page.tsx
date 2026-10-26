import { BackButton } from "@/components/ui/BackButton";
import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/account/AuthForm";
import { OAuthButtons } from "@/components/account/OAuthButtons";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default function LoginPage() {
  return (
    <div className="space-y-6">
      <BackButton href="/" />
      <div className="space-y-2 text-center">
        <p className="hud-label text-screen">Trainer ID</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">Keep your progress on every device.</p>
      </div>
      <OAuthButtons />
      <AuthForm />
      <p className="text-center text-xs text-muted-foreground">
        Accounts are for ages 13 and up.{" "}
        <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
          Privacy policy
        </Link>
      </p>
    </div>
  );
}
