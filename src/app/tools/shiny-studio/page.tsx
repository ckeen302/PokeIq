// MOCK ONLY: a static picture of the Shiny Studio for review (?view=hd, ?view=share).
import type { Metadata } from "next";
import { ShinyStudioMock, type StudioView } from "@/components/tools/mock/ShinyStudioMock";

export const metadata: Metadata = { title: "Shiny Studio (mock)", robots: { index: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  const v: StudioView = view === "hd" || view === "share" ? view : "pixel";
  return <ShinyStudioMock view={v} />;
}
