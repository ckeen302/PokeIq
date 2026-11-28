/**
 * Where the tracker's game data comes from: the one import of it, so switching sources is one line.
 * TEMPORARY: the FireRed & LeafGreen dev fixture, until the real data (./games, branch nuzlocke-data) lands; then this
 * re-exports "./games" and dev-fixture.ts is deleted (tests/nuzlocke.test.ts fails while both exist).
 */
export { NUZ_GAMES, loadGame } from "./dev-fixture";
