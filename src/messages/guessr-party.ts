import en from "./en/guessr-party.json";
import { defineNamespace } from "@/i18n/catalog";

/** A PokéGuessr party at /pokeguessr/party/<code>: the lobby, the rounds, the reveals and the standings (components/geo/GeoParty.tsx, PartyParts.tsx). */
export default defineNamespace("guessr-party", en);
