import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { GameJsonLd } from "@/components/seo/GameJsonLd";
import { IqTest } from "@/components/iq-test/IqTest";

const DESCRIPTION =
  "Five timed sections — reasoning, memory, speed, spatial and Pokémon knowledge — scored against other trainers. Get your Cognitive PokéIQ and a five-domain profile in about 20 minutes.";

export const metadata: Metadata = pageMetadata({
  title: "The PokéIQ Test — A Cognitive Test Made of Pokémon",
  description: DESCRIPTION,
  path: "/iq-test",
});

export default function IqTestPage() {
  return (
    <>
      <GameJsonLd name="The PokéIQ Test" path="/iq-test" description={DESCRIPTION} />
      <IqTest />
    </>
  );
}
