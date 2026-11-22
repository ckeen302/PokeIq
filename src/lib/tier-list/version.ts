import ART from "@/data/tier-list-art.json";

/** Changes when the roster's pictures do, so browsers fetch the new roster.json instead of a cached one. */
export const ROSTER_JSON_VERSION = Object.keys((ART as { mons: object }).mons).length * 7 + (ART as { local: unknown[] }).local.length;
