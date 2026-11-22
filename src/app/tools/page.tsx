// MOCK ONLY: the Tools hub for review.
import type { Metadata } from "next";
import { ToolsHubMock } from "@/components/tools/mock/ToolsHubMock";

export const metadata: Metadata = { title: "Tools (mock)", robots: { index: false } };

export default function Page() {
  return <ToolsHubMock />;
}
