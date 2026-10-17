import type { Metadata } from "next";
import { TrainerCard } from "@/components/trainer/TrainerCard";

export const metadata: Metadata = { title: "Trainer Card", robots: { index: false } };

export default function TrainerPage() {
  return <TrainerCard />;
}
