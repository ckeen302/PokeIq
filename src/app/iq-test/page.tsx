import type { Metadata } from "next";
import { IqTest } from "@/components/iq-test/IqTest";

export const metadata: Metadata = {
  title: "The PokéIQ Test — Adaptive Pokémon Knowledge Test",
  description:
    "20 adaptive questions that home in on exactly how much you know about Pokémon — like the GRE, but for Pokémon. Get your PokéIQ with a confidence range.",
  alternates: { canonical: "/iq-test" },
};

export default function IqTestPage() {
  return <IqTest />;
}
