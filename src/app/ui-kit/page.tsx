import type { Metadata } from "next";
import { KitShowcase } from "@/components/ui/KitShowcase";

// Mock only: the shared UI kit on one page for review. Not linked, not indexed.
export const metadata: Metadata = { title: "UI kit", robots: { index: false, follow: false } };

export default function UiKitPage() {
  return <KitShowcase />;
}
