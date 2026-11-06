import "server-only";
import RECORDS from "@/data/games-records.json";
import { GAMES_BY_KEY } from "./data";
import { EVENT_IDS, type EventId } from "./events";
import { indexRecords, type RecordsFile } from "./records";

/** The records file, read on the server (records pages, default line-ups, nations). */
export const RECORDS_FILE = RECORDS as unknown as RecordsFile;
export const RECORDS_ALL = indexRecords(RECORDS_FILE);
export const RECORDS_SPECIES = indexRecords(RECORDS_FILE, (k) => GAMES_BY_KEY.get(k)?.entrant.kind === "pokemon");

/** Each event's default line-up: its eight best Pokémon (the records). Wrestling's by ring strength. */
export const DEFAULT_FIELDS: Record<EventId, string[]> = Object.fromEntries(EVENT_IDS.map((id) => [id, RECORDS_SPECIES.ranking(id === "all-around" ? "all-around" : id).slice(0, 8)])) as Record<EventId, string[]>;
