import { BackButton } from "@/components/ui/BackButton";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { FeedbackPage } from "@/components/layout/FeedbackPage";

export const metadata: Metadata = pageMetadata({
  title: "Feedback",
  description: "Send PokéIQ an idea, report a bug, or tell us anything else. We read every message.",
  path: "/feedback",
});

export default function Feedback() {
  return (
    <div className="mx-auto max-w-xl space-y-6">
    <BackButton href="/" />
      <div className="space-y-2">
        <p className="hud-label">Feedback</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight">
          Tell us <span className="text-primary">anything</span>
        </h1>
        <p className="text-muted-foreground">Ideas, bugs, or something else on your mind: we read every message.</p>
      </div>
      <div className="hud rounded-lg border bg-card p-6">
        <FeedbackPage />
      </div>
    </div>
  );
}
