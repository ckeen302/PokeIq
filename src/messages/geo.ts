import en from "./en/geo.json";
import { defineNamespace } from "@/i18n/catalog";

/** PokéGuessr's game frame, shared by every mode (solo, streaks, duels, parties): the HUD, the map, the round result and the results map. */
export default defineNamespace("geo", en);
