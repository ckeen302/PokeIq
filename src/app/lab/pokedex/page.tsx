import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { labRows } from "@/lib/lab-dex/data";
import { LabDexApp } from "@/components/lab-dex/LabDexApp";

/**
 * The Professor's Lab (/lab/pokedex): a 3D Pokédex. Every Pokémon (and,
 * with Forms on, every Mega, regional and Gigantamax form) on an endless
 * wheel of capsule pods round a holo-table. Static: the page carries a
 * compact index of every Pokémon (numbers, types, stats, evolution links);
 * each one's longer text comes from /api/lab-dex/<id> when it's picked.
 * The 3D scene is loaded by the page itself, on its own, so nothing else on
 * the site carries three.js for it.
 */

export const metadata: Metadata = pageMetadata({
  title: "Professor's Lab: a 3D Pokédex of every Pokémon",
  description:
    "Spin a ring of lab capsules and bring any Pokémon onto the holo-table in 3D: base stats, battle roles ranked against every Pokémon, Pokédex entries, abilities, evolutions and type matchups. Filter and sort like the Pokédex. Free, in your browser.",
  path: "/lab/pokedex",
  socialTitle: "Professor's Lab: a 3D Pokédex · PokéIQ",
});

export const dynamic = "force-static";

export default function Page() {
  return <LabDexApp rows={labRows()} />;
}
