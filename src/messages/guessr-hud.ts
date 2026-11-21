import en from "./en/guessr-hud.json";
import { defineNamespace } from "@/i18n/catalog";

/** The PokéGuessr duel HUD shared by duels and parties: the band, the reveal, the live pill, leaving, reactions, the versus screen (components/geo/DuelHud.tsx, GeoVersus.tsx). */
export default defineNamespace("guessr-hud", en);
