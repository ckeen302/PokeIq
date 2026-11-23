import type { Namespace } from "@/i18n/catalog";
import geo from "@/messages/geo";
import geoNames from "@/messages/geo-names";
import geoSolo from "@/messages/geo-solo";
import badges from "@/messages/badges";
import geoRecord from "@/messages/geo-record";
import geoHowto from "@/messages/geo-howto";
import geoStreak from "@/messages/geo-streak";
import geoReplay from "@/messages/geo-replay";
import share from "@/messages/share";
import howto from "@/messages/howto";
import duel from "@/messages/duel";
import tier from "@/messages/tier";
import guessrCards from "@/messages/guessr-cards";
import guessrRanked from "@/messages/guessr-ranked";
import guessrHud from "@/messages/guessr-hud";
import hunt from "@/messages/hunt";

/**
 * The message namespaces each PokéGuessr page hands its client components (<ClientMessages>): the game frame and
 * names every mode shares, then the page's own, and the shared ones they use (the how-to dialog, sharing, duel parts).
 * The hub shows the duel, party and ranked cards; history and replays show Gym Leader tags and the duel HUD's distances.
 */
export const GEO_GAME_NAMESPACES: Namespace[] = [geo, geoNames];
export const GEO_HUB_NAMESPACES: Namespace[] = [...GEO_GAME_NAMESPACES, geoSolo, badges, geoRecord, geoHowto, howto, share, duel, tier, guessrCards, guessrRanked, hunt];
export const GEO_STREAK_NAMESPACES: Namespace[] = [...GEO_GAME_NAMESPACES, geoStreak, share];
export const GEO_REPLAY_NAMESPACES: Namespace[] = [...GEO_GAME_NAMESPACES, geoReplay, duel, guessrRanked, guessrHud];
/** Pokémon Hunt (/pokeguessr/hunt). */
export const GEO_HUNT_NAMESPACES: Namespace[] = [...GEO_GAME_NAMESPACES, hunt];
