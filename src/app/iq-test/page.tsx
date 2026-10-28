import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { IqTest } from "@/components/iq-test/IqTest";

export const metadata: Metadata = pageMetadata({
  title: "The PokéIQ Test — A Cognitive Test Made of Pokémon",
  description:
    "Five timed sections — reasoning, memory, speed, spatial and Pokémon knowledge — scored against other trainers. Get your Cognitive PokéIQ and a five-domain profile in about 20 minutes.",
  path: "/iq-test",
});

export default function IqTestPage() {
  return <IqTest />;
}
