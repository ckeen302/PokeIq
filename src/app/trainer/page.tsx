import { BackButton } from "@/components/ui/BackButton";
import type { Metadata } from "next";
import { TrainerCard } from "@/components/trainer/TrainerCard";

export const metadata: Metadata = { title: "Trainer Card", robots: { index: false } };

export default function TrainerPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <BackButton href="/" />
      <TrainerCard />
    </div>
  );
}
