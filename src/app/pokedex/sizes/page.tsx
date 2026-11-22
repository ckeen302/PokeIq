import type { Metadata } from "next";
import { SizesPage } from "@/components/sizes/SizesPage";
import { mainMetadata } from "@/components/sizes/routes";

export function generateMetadata(): Metadata {
  return mainMetadata();
}

export default function Page() {
  return <SizesPage />;
}
