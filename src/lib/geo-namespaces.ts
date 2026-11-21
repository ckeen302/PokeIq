import type { Namespace } from "@/i18n/catalog";
import geo from "@/messages/geo";
import geoNames from "@/messages/geo-names";
import geoSolo from "@/messages/geo-solo";
import geoRecord from "@/messages/geo-record";
import geoHowto from "@/messages/geo-howto";
import geoStreak from "@/messages/geo-streak";
import geoReplay from "@/messages/geo-replay";
import share from "@/messages/share";
import howto from "@/messages/howto";
import duel from "@/messages/duel";

/**
 * The message namespaces each PokéGuessr page hands its client components (<ClientMessages>): the game frame and
 * names every mode shares, then the page's own, and the shared ones they use (the how-to dialog, sharing, duel parts).
 * The duel, party and ranked components' own namespaces still need adding where those render (the hub, the replay).
 */
export const GEO_GAME_NAMESPACES: Namespace[] = [geo, geoNames];
export const GEO_HUB_NAMESPACES: Namespace[] = [...GEO_GAME_NAMESPACES, geoSolo, geoRecord, geoHowto, howto, share, duel];
export const GEO_STREAK_NAMESPACES: Namespace[] = [...GEO_GAME_NAMESPACES, geoStreak, share];
export const GEO_REPLAY_NAMESPACES: Namespace[] = [...GEO_GAME_NAMESPACES, geoReplay, duel];
