import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { GAMES_LIVE } from "@/lib/lab";
import { GAMES_PATH } from "@/lib/games/deeplink";
import { GamesHub } from "@/components/games/GamesPages";

export const metadata: Metadata = pageMetadata({
  title: "The PokéIQ Games: real track and field, swimming and weightlifting for every Pokémon",
  description: "Which Pokémon is the best athlete? The 100, 200 and 400 m, long jump, high jump, shot put, javelin, weightlifting, swimming and wrestling for all 1,025 Pokémon, scored from their real stats with real physics and played out in 3D. Records, head to heads and the Games with a medal table.",
  path: GAMES_PATH,
  socialTitle: "The PokéIQ Games · every Pokémon, real sport",
  noindex: !GAMES_LIVE,
});

export default function Page() {
  return <GamesHub />;
}
