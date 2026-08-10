import type { Metadata } from "next";
import { AuthForm } from "@/components/AuthForm";
import { BrainLogo } from "@/components/BrainLogo";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Create a trainer account to sync progress and climb the ranks.",
};

export default function LoginPage() {
  return (
    <div className="py-10">
      <header className="mb-8 text-center">
        <BrainLogo size={56} className="mx-auto drop-shadow-[0_0_18px_rgba(192,132,252,0.4)]" />
        <h1 className="mt-4 text-3xl font-black tracking-tight">
          Trainer <span className="text-gradient">ID</span>
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          One account — your stats, badges and rank, on every device.
        </p>
      </header>
      <AuthForm />
    </div>
  );
}
