import type { Metadata } from "next";
import { AuthForm } from "@/components/account/AuthForm";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default function LoginPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <p className="hud-label text-screen">Trainer ID</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">Keep your progress on every device.</p>
      </div>
      <AuthForm />
    </div>
  );
}
