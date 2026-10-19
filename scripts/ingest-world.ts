/**
 * Builds World PokéGuessr: every region on one world map.
 *
 * scripts/geo/world-places.json holds every place on the world atlas: its
 * name, region and area in world-map pixels, traced from each game's own town
 * map. For each place this finds its Bulbapedia page and uploads its in-game
 * screenshots (re-encoded under random ids, so URLs reveal nothing); buildings
 * and landmarks inside a place get their own rounds and share its area.
 * Uploads are cached by file name, so a re-run only uploads what's new.
 *
 * Writes the `world` section of src/data/geo.json, and the world map plus one
 * crop per region to public/geo/maps.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run ingest:world               # every region
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run ingest:world -- Hoenn Kalos # selected regions
 *   … npm run ingest:world -- --top-up Alola   # only top up existing places from other wikis
 *   … npm run ingest:world -- --prune Alola    # also delete uploads the data no longer uses (once the site that used them is redeployed)
 */
import { existsSync, mkdirSync, readFileSync, rmdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  GAME_CODES,
  WIKI,
  api,
  archiveFiles,
  categoryFiles,
  categoryPages,
  codeOf,
  collectShots,
  fileInfo,
  type CategoryFile,
  type ShotFallback,
  firstLocationRef,
  galleryImages,
  geoStorage,
  imageStem,
  infoboxImages,
  leadSection,
  pageLinks,
  redirectTarget,
  sleep,
  squash,
  words,
  withBuildingInfobox,
  type GeoShot,
  type ShotStore,
} from "./geo/bulbapedia";
import { WIKIS, localNames, wikiCode, wikiImages, wikiPage, type Wiki } from "./geo/wikis";

const PLACES = path.join(process.cwd(), "scripts/geo/world-places.json");
const WORLD_MAP = path.join(process.cwd(), "public/geo/maps/world.webp");
const OUT_DATA = path.join(process.cwd(), "src/data/geo.json");
const SHOT_CACHE = path.join(process.cwd(), ".data", "geo-shot-cache.json");
const SHOT_HASHES = path.join(process.cwd(), ".data", "geo-shot-hashes.json");
/** Held while the data and caches are read and rewritten, so regions can be imported side by side. */
const LOCK = path.join(process.cwd(), ".data", "ingest-world.lock");

const MAX_SHOTS = 14;
/** 3D screenshots a place gets from other wikis, counting the ones Bulbapedia already gave it. */
const WIKI_SHOTS = 6;
const MAX_BUILDING_SHOTS = 10;
/** Space around each region's crop, as a share of its size. */
const CROP_MARGIN = 0.04;

interface Source {
  /** Atlas region names whose places come from this source. */
  regions: string[];
  /** The region's name on Bulbapedia (page titles, categories, infobox `region`). */
  wiki: string;
  /** File-name game codes set in this region; screenshots from other games are dropped. */
  games: string[];
  /** Files without a game code are kept when they're a console's native screen size, which says which game they're from. */
  screens?: Record<string, string>;
}

const SOURCES: Source[] = [
  { regions: ["Kanto"], wiki: "Kanto", games: ["RB", "RBY", "RGBY", "Y", "GSC", "FRLG", "HGSS", "PE", "LGPE"], screens: { "240x160": "FRLG", "256x192": "HGSS" } },
  { regions: ["Johto"], wiki: "Johto", games: ["GS", "GSC", "C", "HGSS"], screens: { "160x144": "GSC", "256x192": "HGSS" } },
  { regions: ["Hoenn"], wiki: "Hoenn", games: ["RS", "RSE", "SE", "E", "ORAS", "OR", "AS"], screens: { "240x160": "RSE", "400x240": "ORAS" } },
  { regions: ["Sinnoh"], wiki: "Sinnoh", games: ["DP", "Pt", "DPPt", "BDSP"], screens: { "256x192": "DPPt" } },
  { regions: ["Unova"], wiki: "Unova", games: ["BW", "B", "W", "B2W2", "B2", "W2", "BWB2W2"], screens: { "256x192": "BWB2W2" } },
  // Legends: Z-A is set in Lumiose City; X/Y's own location images are mostly guidebook maps.
  { regions: ["Kalos"], wiki: "Kalos", games: ["XY", "ZA"], screens: { "400x240": "XY" } },
  { regions: ["Alola"], wiki: "Alola", games: ["SM", "USUM", "SMUSUM"], screens: { "400x240": "SMUSUM" } },
  { regions: ["Galar", "Isle of Armor", "Crown Tundra"], wiki: "Galar", games: ["SwSh"] },
  { regions: ["Paldea"], wiki: "Paldea", games: ["SV"] },
  { regions: ["Kitakami"], wiki: "Kitakami", games: ["SV"] },
  { regions: ["Blueberry Academy"], wiki: "Unova", games: ["SV"] },
  { regions: ["Sevii Islands"], wiki: "Sevii Islands", games: ["FRLG"] },
];

/**
 * Each game's category of location screenshots on the Archives, by game code:
 * files named after a place whose game isn't in the name, or that no page
 * shows, are still found and filed under the right game.
 */
const GAME_CATEGORIES: Record<string, string> = {
  RBY: "Red, Green, Blue, and Yellow maps",
  GSC: "Gold, Silver, and Crystal maps",
  RSE: "Ruby, Sapphire, and Emerald maps",
  FRLG: "FireRed and LeafGreen maps",
  DPPt: "Diamond, Pearl, and Platinum maps",
  HGSS: "HeartGold and SoulSilver maps",
  BWB2W2: "Black, White, Black 2, and White 2 maps",
  XY: "X and Y maps",
  ORAS: "Omega Ruby and Alpha Sapphire maps",
  SMUSUM: "Sun, Moon, Ultra Sun, and Ultra Moon maps",
  LGPE: "Let's Go, Pikachu! and Let's Go, Eevee! maps",
  SwSh: "Sword and Shield maps",
  BDSP: "Brilliant Diamond and Shining Pearl maps",
  SV: "Scarlet and Violet maps",
  ZA: "Legends: Z-A maps",
};
/** Archives categories of files that aren't a plain view: guide and Town Map maps, models, sprites, art, look-alike Pokémon Center interiors. */
const NOT_A_VIEW_CATEGORY =
  /^(Area highlighted maps|Town maps|Sign maps|Annotated .+|Game sprites.*|Game models.*|Animated .+|Location preview|Location artwork|Unsatisfactory images|Unused images|Early .+ images|Fair use game guide scan images|Pokémon Centers|Poké Marts|Ultra Space maps|Hyperspace maps|Animation .+)$/;
/** The Archives' map category for an atlas region, when it isn't "<Region> maps". */
const REGION_CATEGORIES: Record<string, string[]> = { Kalos: ["Kalos maps", "Lumiose City maps"] };

/** Region maps cut from the world map, and the atlas regions each one plays. */
const CROPS: Record<string, { name: string; regions: string[] }> = {
  kanto: { name: "Kanto", regions: ["Kanto"] },
  johto: { name: "Johto", regions: ["Johto"] },
  hoenn: { name: "Hoenn", regions: ["Hoenn"] },
  sinnoh: { name: "Sinnoh", regions: ["Sinnoh"] },
  unova: { name: "Unova", regions: ["Unova"] },
  kalos: { name: "Kalos", regions: ["Kalos"] },
  alola: { name: "Alola", regions: ["Alola"] },
  galar: { name: "Galar", regions: ["Galar", "Isle of Armor", "Crown Tundra"] },
  paldea: { name: "Paldea", regions: ["Paldea"] },
};

/** Map labels that aren't page titles. */
const TITLES: Record<string, string> = {
  "Kanto|Safari Zone / Pal Park": "Kanto Safari Zone",
  "Alola|Lake of the Sunne / Moone": "Lake of the Sunne",
  "Alola|Altar of the Sunne / Moone": "Altar of the Sunne",
  "Unova|Black City / White Forest": "Black City",
  "Unova|Victory Road (BW)": "Victory Road (Unova)",
  "Unova|Victory Road (B2W2)": "Victory Road (Unova)",
  "Paldea|Naranja and Uva Academy": "Naranja Academy",
  "Hoenn|Battle Frontier": "Battle Frontier (Generation III)",
  "Alola|Thrifty Megamart Abandoned Site": "Thrifty Megamart (Abandoned Site)",
};
/** Places that share a page with another version of themselves: keep only their own game's screenshots. */
const ONLY_GAMES: Record<string, string[]> = {
  "Unova|Victory Road (BW)": ["BW", "B", "W"],
  "Unova|Victory Road (B2W2)": ["B2W2", "B2", "W2"],
};
/** Archive file-name prefixes for places whose files aren't named after their map label. */
const ARCHIVE_PREFIXES: Record<string, string[]> = {
  "Unova|Victory Road (BW)": ["Victory_Road_"],
  "Unova|Victory Road (B2W2)": ["Victory_Road_"],
  "Unova|Black City / White Forest": ["Black_City_", "White_Forest_"],
  // The Safari Zone until Generation III and in Let's Go; HeartGold / SoulSilver's Pal Park on the same spot.
  "Kanto|Safari Zone / Pal Park": ["Kanto_Safari_Zone_", "Safari_Zone_", "Pal_Park_"],
  "Hoenn|Battle Frontier": ["Battle_Frontier_"],
  "Hoenn|Team Aqua Hideout": ["Team_Aqua_Hideout_", "Aqua_Hideout_"],
  "Unova|Challenger's Cave": ["Challengers_Cave_"],
};

/**
 * Files that look like screenshots by name but give the answer away or don't
 * show the place (found by reviewing contact sheets of the imported shots).
 */
const DENYLIST = new Set<string>([
  "Celadon_Game_Corner_7_GSC.png",
  "Celadon_Game_Corner_7_Y.png",
  "Route_22_Rival_battle_RBY.png",
  "Vermilion_City_port_HGSS.png",
  "Cerulean_City_Slowbro_SonicBoom_FRLG.png",
  "Friend_Safari_inside_XY.png",
  // A tournament broadcast, with the players' names on screen.
  "Mesagoza_Championships_SV.png",
  // Dialogue naming the place.
  "Southern_Island_ORAS.png",
  // Key art, not a view.
  "Amity_Square_BDSP.png",
  // Close-ups of museum exhibits.
  "Lumiose_Museum_Survey_Corps_Satchel_ZA.png",
  "Lumiose_Museum_Crafting_Bench_ZA.png",
  "Lumiose_Museum_Hairstyles_ZA.png",
  "Lumiose_Museum_Venerated_Portraits_ZA.png",
  "Lumiose_Museum_Ancient_Sinnoh_Hieroglyphs_ZA.png",
  // Guidebook maps that happen to be screen-shaped.
  "Postwick_SwSh.png",
  "Rose_Tower_SwSh.png",
  // A whole Sevii island stitched together, filler and all: more than its town.
  "Knot_Island_FRLG.png",
  "Kin_Island.png",
  "Boon_Island_FRLG.png",
  "Chrono_Island.png",
  "Quest_Island.png",
  "Fortune_Island.png",
  // A building cut out of the map, on a blank background.
  "Power_Plant_exterior_HGSS.png",
  // Several small ladder rooms in a strip.
  "Navel_Rock_Ladder_Down_FRLG.png",
  // Separate rooms or screens stacked into one image.
  "Abandoned_Ship_1F_and_rooms_RSE.png",
  "Abandoned_Ship_B1F_and_rooms_RSE.png",
  "Abandoned_Ship_HF_and_rooms_RSE.png",
  "Turnback_Cave_Two_Pillar_Random_Rooms_DPPt.png",
  "Black_City_Water_Dungeon_B2.png",
  "White_Forest_Lava_Dungeon_W2.png",
  // Guidebook maps (labels, numbered markers) and model renders that happen to be screen-shaped.
  "Lilycove_City_ORAS.png",
  "Hoenn_Route_125_ORAS.png",
  "Shady_House_SMUSUM.png",
  "Mauville_Food_Court_interior_ORAS.png",
  "Skyarrow_Bridge_BW.png",
  "Tubeline_Bridge_BW.png",
  // Text boxes and banners over the view.
  "Battle_Tower_BDSP.png",
  "Lilycove_Museum_Landscape_ORAS.png",
  "Lilycove_Museum_Landscape_RSE.png",
  "Lilycove_Museum_Sculpture_RSE.png",
  "Sea_Mauville_Scanner_location.png",
  "Sealed_Chamber_Visual_Braille_ORAS.png",
  "Slateport_City_Battle_Tent_E.png",
  "Jubilife_City_join_group_Pt.png",
  // Too small, too empty or too close up to place.
  "Desert_Underpass_E.png",
  "Mauville_City_Game_Corner_RS.png",
  "Hoenn_Route_123_E.png",
  "Hoenn_Safari_Zone_Entrance_E.png",
  "Trick_House_exit_E.png",
  "Miracle_Cycle_Cerulean_exterior_HGSS.png",
  "Kanto_Route_27_HGSS.png",
  "SS_Anne_1F_FRLG.png",
  "SS_Anne_Basement_Rooms_FRLG.png",
  "Maniac_Tunnel_10-25_DP.png",
  "Maniac_Tunnel_26-28_DP.png",
  "Maniac_Tunnel_26-28_Pt.png",
  "Resort_Area_Villa_interior_empty_Pt.png",
  "Celestial_Tower_Summer_BWB2W2.png",
  "Cold_Storage_back_room_BW.png",
  "Entralink_Forest_BW.png",
  "Malie_City_Face_Board_USUM.png",
  "Ns_Castle_Rising_BW.png",
  // Open sea where the island appears only on some days: indistinguishable from the route.
  "Mirage_Island_location_RSE.png",
  // A glitched sky.
  "Valley_Windworks_dragon_event.png",
  // Dialogue boxes, an examine screen and blurred or empty shots.
  "Lake_Verity_Professor_Rowan_DP.png",
  "Lilycove_Museum_Sculpture_ORAS.png",
  "Lilycove_Museum_Poké_Ball_RSE.png",
  "Lilycove_Museum_Poké_Ball_ORAS.png",
  "Ruins_of_Alph_first_chamber_C.png",
  "Ruins_of_Alph_first_chamber_HGSS.png",
  "Pokemon_League_Vista_view_BDSP.png",
  "SS_Anne_2F_RBY.png",
  "SS_Anne_3F_RBY.png",
  "SS_Anne_2F_FRLG.png",
  // Floors and chambers that look the same as one already kept (Dotted Hole B1F, Tanoby's Monean Chamber).
  "Dotted_Hole_B2F.png",
  "Dotted_Hole_B3F.png",
  "Tanoby_Ruins_Dilford_Chamber.png",
  "Tanoby_Ruins_Liptoo_Chamber.png",
  "Tanoby_Ruins_Scufib_Chamber.png",
  "Tanoby_Ruins_Viapois_Chamber.png",
  "Tanoby_Ruins_Weepth_Chamber.png",
  // A labelled guide map.
  "Alola_Route_13.png",
  // Regi chambers: the same room in two places.
  "Desert_Ruins_interior_ORAS.png",
  "Island_Cave_interior_ORAS.png",
  // Text boxes over the view.
  "Fallarbor_Battle_Tent_E.png",
  "Seafloor_Cavern_aftermath_E.png",
  "Lilycove_Museum_Curator_RSE.png",
  // A photo board and a news broadcast, not the place.
  "Mossdeep_Face_Board_ORAS.png",
  "TV_Mauville_Interior_News_Desk.png",
  // Floors that look the same as one already kept (Sky Pillar 3F and 5F, Cave of Origin B2F, Trainer Hill's own floors).
  "Sky_Pillar_3F_after_E.png",
  "Sky_Pillar_3F_before_E.png",
  "Sky_Pillar_4F_after_E.png",
  "Sky_Pillar_4F_before_E.png",
  "Sky_Pillar_4F_RS.png",
  "Cave_of_Origin_B3F_RS.png",
  "Trainer_Hill_Carlotta_E.png",
  "Trainer_Hill_Coleman_E.png",
  "Trainer_Hill_Colleen_E.png",
  "Trainer_Hill_Ed_E.png",
  "Trainer_Hill_Edie_E.png",
  "Trainer_Hill_Elizabeth_E.png",
  // The exterior again (Emerald's is kept).
  "Lilycove_Museum_RS.png",
  // A close-up of the player; a field of grass like any other.
  "Lumiose_Museum_XY.png",
  "Friend_Safari_Field.png",
  // A route drawn over a split view; rooms pasted side by side; a photo board; a sliver of a building.
  "Castelia_City_Oceanfront_Road_B2W2.png",
  "Relic_Castle_B7F_Maze_B2W2.png",
  "Humilau_City_Face_Board.png",
  "Castelia_Gym_exterior_BWB2W2.png",
  // Rooms that look like others already kept (Relic Castle, Victory Road, the Plasma Frigate, Route 10's badge gates).
  "Relic_Castle_B3F_R_BW.png",
  "Relic_Castle_B4F_R_BW.png",
  "Relic_Castle_B7F_L_BW.png",
  "Relic_Castle_B7F_R_BW.png",
  "Victory_Road_3F_R_BW.png",
  "Victory_Road_4F_L_BW.png",
  "Victory_Road_4F_M_BW.png",
  "Victory_Road_6F_BW.png",
  "Plasma_Frigate_B1F_Right_B2.png",
  "Unova_Route_10_Quake_Badge_Gate_BW.png",
  "Unova_Route_10_Jet_Badge_Gate_BW.png",
  // Models rendered on grey, not a view.
  "Snowpoint_Temple.png",
  "Jubilife_TV.png",
  "Pick_a_Peck_of_Colors_Flower_Shop.png",
  "Pokétch_Company.png",
  "Vista_Lighthouse.png",
  // Rooms pasted together, a labelled zone map, a mostly black floor.
  "Old_Chateau_girl_room_DPPt.png",
  "Sunyshore_Gym_DPPt.png",
  "Pal_Park_Zones.png",
  "Canalave_Gym_4F_DPPt.png",
  // Platinum-only rooms filed under Diamond / Pearl too; Spear Pillar filed as the Distortion World.
  "Distortion_World_physics.png",
  "Distortion_World_portal_Pt.png",
  "Global_Terminal_2F_PtHGSS.png",
  "Global_Terminal_3F_PtHGSS.png",
  // Floors that look like one already kept (Distortion World, Mt. Coronet, Spear Pillar, Veilstone Department Store, Victory Road, Jubilife TV, the Galactic building).
  "Distortion_World_B6F_Pt.png",
  "Distortion_World_B7F_Giratina_Pt.png",
  "Distortion_World_B7F_Pt.png",
  "Mt_Coronet_3F_DP.png",
  "Mt_Coronet_5F_Pt.png",
  "Mt_Coronet_6F_DPPt.png",
  "Mt_Coronet_7F_DPPt.png",
  "Spear_Pillar_P.png",
  "Spear_Pillar_Pt.png",
  "Veilstone_Department_Store_2F_Pt.png",
  "Veilstone_Department_Store_3F_Pt.png",
  "Veilstone_Department_Store_4F_Pt.png",
  "Victory_Road_B1F_Deep_Exit_DP.png",
  "Jubilife_TV_4F_DPPt.png",
  "Galactic_Eterna_Building_4F_DP.png",
  "Veilstone_Department_Store_3F_DP.png",
  "Veilstone_Department_Store_4F_DP.png",
  "Veilstone_Department_Store_5F_DP.png",
  // A labelled guidebook map; floors pasted together.
  "RG_Fuchsia_City.png",
  "Pallet_Town_Red's_House_Y.png",
  "Pewter_Museum_of_Science_interior_RBY.png",
  "Pewter_Museum_of_Science_interior_FRLG.png",
  // Mostly black or fog.
  "Mt_Moon_B1F_FRLG.png",
  "Rock_Tunnel_B1F_GSC.png",
  "Rock_Tunnel_Darkness_LGPE.png",
  "SS_Anne_3F_FRLG.png",
  // The same room at both ends of Diglett's Cave.
  "Diglett_Cave_Entrance_Route_11_FRLG.png",
  "Diglett_Cave_Entrance_Route_2_FRLG.png",
  // Floors and rooms that look like one already kept (Kanto).
  "Celadon_Mansion_2F_RBY.png",
  "Celadon_Mansion_3F_RBY.png",
  "Underground_Path_Route_6_Entrance_LGPE.png",
  "Underground_Path_Route_6_Side_LGPE.png",
  "Underground_Path_Route_7_Entrance_LGPE.png",
  "Underground_Path_Route_7_Side_LGPE.png",
  "Underground_Path_Route_8_Entrance_LGPE.png",
  "Underground_Path_Route_8_Side_LGPE.png",
  "Seafoam_Islands_B1F_HGSS.png",
  "Seafoam_Islands_B2F_RBY.png",
  "Seafoam_Islands_B3F_HGSS.png",
  "Seafoam_Islands_B3F_RBY.png",
  "Victory_Road_3F_FRLG.png",
  "Victory_Road_3F_GSC.png",
  "Victory_Road_3F_HGSS.png",
  "Celadon_Department_Store_2F_FRLG.png",
  "Celadon_Department_Store_3F_FRLG.png",
  "Pewter_Museum_Right_Entrance_LGPE.png",
  "Pokémon_Mansion_2F_FRLG.png",
  "Pokémon_Mansion_3F_FRLG.png",
  "Pokémon_Mansion_B1F_FRLG.png",
  "Pokémon_Tower_4F_RBY.png",
  "Pokémon_Tower_5F_RBY.png",
  "Pokémon_Tower_6F_RBY.png",
  "SS_Anne_truck_RBY.png",
  "SS_Anne_RBY.png",
  "SS_Anne_FRLG.png",
  "Silph_Co_5F_RBY.png",
  "Silph_Co_6F_RBY.png",
  "Silph_Co_3F_FRLG.png",
  "Rocket_Hideout_B3F_FRLG.png",
  "Rocket_Hideout_B4F_FRLG.png",
]);
/**
 * Files that aren't a fair view of the place they name: Omega Ruby / Alpha
 * Sapphire's Mirage spots (look-alike islands that appear at random near a
 * route), Emerald's copies of a route map with a cave entrance drawn in, and
 * the Wild Area's dens past the first three (a den in every shot).
 */
const NOT_THE_PLACE = /^Mirage_(Cave|Mountain|Forest|Island)_|_E_(Terra_Cave|Marine_Cave|normal)\.|_den_[D-Z]_/i;
/** Archive files for places whose town map is named after the place alone ("One_Island.png"). */
const ARCHIVE_FILES: Record<string, string[]> = {
  "Sevii Islands|One Island": ["One_Island.png"],
  "Sevii Islands|Two Island": ["Two_Island.png"],
  "Sevii Islands|Three Island": ["Three_Island.png"],
  "Sevii Islands|Six Island": ["Six_Island.png"],
  "Sevii Islands|Seven Island": ["Seven_Island.png"],
  // The islands on the 3DS's lower screen.
  "Alola|Poké Pelago": ["Isle_Abeens.png", "Isle_Aphun.png", "Isle_Aplenny.png", "Isle_Avue.png", "Isle_Evelup.png"],
  "Alola|Plains Grotto": ["Plains_Grotto_USUM.png"],
};
/** The game of archive files whose name and size don't say. */
const FILE_GAMES: Record<string, string> = Object.fromEntries([
  ...["Isle_Abeens.png", "Isle_Aphun.png", "Isle_Aplenny.png", "Isle_Avue.png", "Isle_Evelup.png"].map((f) => [f, GAME_CODES.SMUSUM]),
  // Only in Black 2 / White 2 (Clay Tunnel, the barricaded Route 10, Opelucid frozen), though the name gives no game.
  ...["Clay_Tunnel_boulders.png", "Unova_Route_10_B2W2_closed.png", "Opelucid_City_B2_Frozen.png"].map((f) => [f, GAME_CODES.B2W2]),
]);
/** Renders of a place's in-game model, for places with no screenshot anywhere (kept though not screen-shaped). */
const MODEL_RENDERS = new Set(["Plains_Grotto_USUM.png"]);
/** The Town Map's and Pokégear's painted previews of a place (FireRed / LeafGreen, HeartGold / SoulSilver): not a view. */
const MAP_PREVIEW = /^(FL_|HGSS_.+-(Morning|Day|Evening|Night)\.)/;

/** Pages that aren't a building of one place: another page for a place on the map, or a ship or train between two. */
const NOT_BUILDINGS = new Set(
  [
    "Victory Road (Black and White)",
    "Victory Road (Black 2 and White 2)",
    "Mirage Island (Generation III)",
    "Kanto Safari Zone",
    "Team Magma Hideout",
    "Magnet Train",
    "S.S. Aqua",
    "S.S. Tidal",
    "S.S. Sinnoh",
    "Seagallop",
    // The academy is its own place on the map (Naranja Academy's page); Uva Academy is the same building in Violet.
    "Uva Academy",
    // Omega Ruby / Alpha Sapphire's soaring-only islands: off the map, placed only roughly ("north of Route 133"), and Emerald's caves that appear on a random route.
    "Crescent Isle",
    "Fabled Cave",
    "Gnarled Den",
    "Nameless Cavern",
    "Pathless Plain",
    "Trackless Forest",
    "Marine Cave",
    "Terra Cave",
  ].map(squash)
);
/** The Mirage spots Omega Ruby / Alpha Sapphire scatter around Hoenn's seas ("Mirage Island (west of Route 104)"). */
const MIRAGE_SPOT = /^Mirage (Island|Cave|Mountain|Forest) \(/;
/** A screenshot both pages use, kept where it was taken (Gold / Silver put Blaine's Gym in the Seafoam Islands). */
const KEEP_IN: Record<string, string> = {
  "Cinnabar_Gym_GSC.png": "Seafoam Islands",
  "Cinnabar_Gym_HGSS.png": "Seafoam Islands",
  "Lilycove_Hideout_RSE.png": "Team Aqua Hideout",
  // Bill's Sea Cottage, at the end of Route 25, not in Cerulean City.
  ...Object.fromEntries(["RBY", "GSC", "FRLG", "HGSS"].map((code) => [`Cerulean_Cape_${code}.png`, "Route 25"])),
};

/** Screenshots with the place's name along the bottom (BDSP's banner, X/Y's Gym caption bar): it's cut off. */
const TRIM_BOTTOM: Record<string, number> = Object.fromEntries([
  ...["Canalave", "Eterna", "Hearthome", "Jubilife", "Oreburgh", "Pastoria", "Snowpoint", "Sunyshore", "Veilstone"].map((city) => [`${city}_City_BDSP.png`, 0.21]),
  ...["Anistar", "Coumarine", "Cyllage", "Laverre", "Shalour", "Snowbelle"].map((city) => [`${city}_Gym_XY.png`, 0.2]),
]);

/** In-game backdrops named after places: Ultra Sun / Ultra Moon's Alola Photo Club ("APC bg Iki Town"). */
const BACKDROPS: Record<string, { prefix: string; code: string }> = {
  Alola: { prefix: "APC_bg_", code: "USUM" },
};

/** Other wikis' shots that name the place (a banner, a caption, a text box) or aren't a view. */
const WIKI_DENYLIST = new Set<string>([
  "Petalburg_City.png",
  "Glittering_Cave.png",
  "Snowbelle_City.png",
  "Ruins_of_Abundance.png",
  "Paniola_Ranch.png",
  "Poké_Pelago5.png",
  "Galar_Route_5.png",
  // X / Y's sleeping Snorlax is on Route 7, not in the Pokémon Village.
  "Snorlax_Kalos_Pokemon_Village.jpeg",
  // Battle screens, and a photo of a 3DS screen.
  "Battle_Tree_1.png",
  "Battle_Tree_2.png",
  "Battle_Tree_3.png",
  "Battle_Tree_4.png",
  "Seaward_Cave.png",
  // Half the view blacked out.
  "Roche-sur-Gliffe_Aquarium_XY.png",
  // The same Pokémon Center front as the first.
  "Motostoke_-_Pokémon_Center_2.jpg",
  // A speech bubble at the top; too dark or too close to place.
  "Route_120_ORAS.jpg",
  "Grotte_Granite_ROSA.png",
  "Grotte_Étincelante_XY.png",
]);

interface PlaceIn {
  name: string;
  region: string;
  kind: string;
  x: number;
  y: number;
  mask: [number, number][];
}
interface WorldPlaces {
  W: number;
  H: number;
  squarePx: number;
  crops: Record<string, [number, number, number, number]>;
  places: PlaceIn[];
  /** Town and city squares drawn on the map: centre x, y, width, height (world px), 1 for a city. */
  markers: [number, number, number, number, 0 | 1][];
}

export interface WorldLocation {
  name: string;
  /** Atlas region the place is in (Isle of Armor, Kitakami, …). */
  region: string;
  /** Buildings and landmarks: the place they sit in (they share its area). */
  parent?: string;
  pin?: [number, number];
  mask?: [number, number][];
  shots: GeoShot[];
}

const storage = geoStorage();
/** How many regions have a place of each name ("Victory Road" is in five). */
const PLACE_COUNTS = new Map<string, number>();
const PLACES_BY_REGION = new Map<string, PlaceIn[]>();
const norm = (v: number, size: number) => Math.round((v / size) * 100000) / 100000;
/**
 * A place's pin and area, normalised to the world map. The area is a point
 * every 8 px (one per 8 × 8 cell), so any spot in it is within half a map
 * square of a point: scoring measures the distance to the nearest.
 */
const placeArea = (place: PlaceIn, world: WorldPlaces) => ({
  pin: [norm(place.x, world.W), norm(place.y, world.H)] as [number, number],
  mask: place.mask.map(([x, y]) => [norm(x, world.W), norm(y, world.H)] as [number, number]),
});

/** Words in file names that mean "not a view of the place" ("battle", but not "Battle Frontier"). */
const NOT_A_VIEW =
  /(^|_)(map\d*|icon|concept|art|artwork|anime|tcg|manga|adventures|sign|battle(?!_(frontier|tower|tree|maison|subway|hall|factory|arcade|castle|pike|palace|dome|pyramid|resort|zone|park|royal|institute|court|tent|company))|battlefield|environment|referee|layout|sprite|dialogue|menu|logo|pre-release|prerelease|trailer|exhibit|painting|evolutions|generations|origins|hz|pg|dsd|unused|beta|jp|numbered|comparison|puzzle\d*|storyboard|postcomp|cutscene|event|prelease|psmd|pmd|tw|berries|rooms|braille|tablet|sculpture)(_|\.|$)/i;

/**
 * 3D games' screenshots are screen-shaped: 5:3 on the 3DS (400 × 240), 16:9
 * on the Switch, or the 2:1 crops some pages use, and no bigger than a 1080p
 * capture. Their guidebook maps, scans and renders aren't.
 */
const THREE_DS = new Set(["XY", "ORAS", "OR", "AS", "SM", "USUM", "SMUSUM"]);
const SWITCH = new Set(["PE", "LGPE", "SwSh", "BDSP", "SV", "ZA"]);
const THREE_D_GAMES = new Set([...THREE_DS, ...SWITCH].map((c) => GAME_CODES[c]));
const count3d = (shots: GeoShot[]) => shots.filter((s) => THREE_D_GAMES.has(s.game)).length;
function screenShaped(code: string, width: number, height: number): boolean {
  const ratio = width / height;
  if (Math.max(width, height) > 1920) return false;
  if (THREE_DS.has(code)) return Math.abs(ratio - 5 / 3) < 0.02;
  return Math.abs(ratio - 16 / 9) < 0.06 || (ratio >= 1.95 && ratio <= 2.15);
}

function usable(file: string, games: string[], codeless: boolean): boolean {
  const f = file.replace(/ /g, "_");
  if (DENYLIST.has(f) || NOT_A_VIEW.test(f) || MAP_PREVIEW.test(f) || NOT_THE_PLACE.test(f)) return false;
  const code = codeOf(f);
  // Single-game regions (X/Y, Sword/Shield, Scarlet/Violet…) often leave the game off the file name.
  return code ? games.includes(code) : codeless;
}

/** The game for files without a code: the region's only game, or the game its screen size belongs to. */
function fallbackFor(source: Source, games: string[]): ShotFallback | undefined {
  if (games.length === 1) return GAME_CODES[games[0]];
  const screens = source.screens;
  if (!screens) return undefined;
  return (width, height) => {
    const code = screens[`${width}x${height}`];
    return code && games.includes(code) ? GAME_CODES[code] : undefined;
  };
}

/** Games whose versions share their maps: one screenshot of a place per family (Ruby / Sapphire's or Emerald's, not both). */
const FAMILIES: Record<string, string> = {
  ...Object.fromEntries(["RB", "RBY", "RGBY", "Y"].map((c) => [c, "gen1"])),
  ...Object.fromEntries(["GS", "GSC", "C"].map((c) => [c, "gen2"])),
  ...Object.fromEntries(["RS", "RSE", "SE", "E"].map((c) => [c, "gen3"])),
  ...Object.fromEntries(["DP", "Pt", "DPPt"].map((c) => [c, "gen4"])),
  ...Object.fromEntries(["BW", "B", "W", "B2W2", "B2", "W2", "BWB2W2"].map((c) => [c, "gen5"])),
};
/** A file's name without its game, season or variant: "Unova_Route_9_Spring_BW" and "…_Summer_B2W2" are one view. */
function variantKey(file: string): string {
  const code = codeOf(file);
  const stem = file
    .replace(/\.[a-z0-9]+$/i, "")
    .split("_")
    .filter((t, i, all) => !(code && t === code && (i === 0 || i === all.length - 1)) && !/^(spring|summer|autumn|winter)$/i.test(t))
    .join("_")
    .toLowerCase();
  return `${stem}|${code ? (FAMILIES[code] ?? code) : ""}`;
}

/**
 * Infobox shots first (one per game), then archive files named after the
 * place, then gallery shots; 3D games' files only when they're screen-shaped.
 * A file naming no game is trusted only from the infobox or a list here, or
 * at a console's native screen size: galleries file anime frames the same
 * way ("Hammerlocke Station.png"). Of a view in several seasons or in two
 * versions of one game, the first is kept.
 */
async function rankShots(lists: string[][], games: string[], source: Source, trusted: Set<string>, codes = new Map<string, string>()): Promise<string[]> {
  const codeless = games.length === 1 || !!source.screens;
  const files = [...new Set(lists.flat().map((f) => f.replace(/ /g, "_")))].filter((f) => usable(f, games, codeless));
  const info = await fileInfo(files);
  const codeFor = (f: string) => codeOf(f) ?? codes.get(f) ?? (games.length === 1 ? games[0] : undefined);
  // A Switch game's small copies (Let's Go's 396 px location cards) only when there's no full-size capture of the place.
  const hd = new Set(files.filter((f) => SWITCH.has(codeFor(f) ?? "") && (info.get(f)?.width ?? 0) >= 1280).map((f) => GAME_CODES[codeFor(f)!]));
  const seen = new Set<string>();
  return files.filter((f) => {
    const size = info.get(f);
    // Thumbnails and slivers (a lighthouse wall 75 px wide) are too small to place.
    if (!size || Math.min(size.width, size.height) < 120) return false;
    if (!codeOf(f) && !trusted.has(f) && !FILE_GAMES[f] && !source.screens?.[`${size.width}x${size.height}`]) return false;
    const code = codeFor(f);
    if (code && (THREE_DS.has(code) || SWITCH.has(code)) && !screenShaped(code, size.width, size.height) && !MODEL_RENDERS.has(f)) return false;
    if (code && SWITCH.has(code) && size.width < 960 && hd.has(GAME_CODES[code])) return false;
    const key = variantKey(f);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The Archives category family of a game code (Black / White's and Black 2 / White 2's share one). */
const GAME_FAMILY: Record<string, string> = {
  ...Object.fromEntries(["RB", "RBY", "RGBY", "Y"].map((c) => [c, "RBY"])),
  ...Object.fromEntries(["GS", "GSC", "C"].map((c) => [c, "GSC"])),
  ...Object.fromEntries(["RS", "RSE", "SE", "E"].map((c) => [c, "RSE"])),
  ...Object.fromEntries(["DP", "Pt", "DPPt"].map((c) => [c, "DPPt"])),
  ...Object.fromEntries(["BW", "B", "W", "B2W2", "B2", "W2", "BWB2W2"].map((c) => [c, "BWB2W2"])),
  ...Object.fromEntries(["OR", "AS", "ORAS"].map((c) => [c, "ORAS"])),
  ...Object.fromEntries(["SM", "USUM", "SMUSUM"].map((c) => [c, "SMUSUM"])),
  ...Object.fromEntries(["PE", "LGPE"].map((c) => [c, "LGPE"])),
};
const familyOf = (code: string) => GAME_FAMILY[code] ?? code;

const gameCategoryFiles = new Map<string, Promise<CategoryFile[]>>();
/**
 * The region's files in its games' Archives categories (each fetched once),
 * with the game each is from: the code in its name, else its category's.
 */
async function categoryShots(source: Source, games: string[]): Promise<Map<string, string>> {
  const regionCats = new Set([source.wiki, ...source.regions].flatMap((r) => REGION_CATEGORIES[r] ?? [`${r} maps`]));
  const families = new Map<string, Set<string>>();
  for (const [family, category] of Object.entries(GAME_CATEGORIES)) {
    if (!games.some((g) => familyOf(g) === family)) continue;
    if (!gameCategoryFiles.has(category)) gameCategoryFiles.set(category, categoryFiles(category));
    for (const file of await gameCategoryFiles.get(category)!) {
      if (!file.categories.some((c) => regionCats.has(c)) || file.categories.some((c) => NOT_A_VIEW_CATEGORY.test(c))) continue;
      families.set(file.name, (families.get(file.name) ?? new Set()).add(family));
    }
  }
  const out = new Map<string, string>();
  for (const [file, fams] of families) {
    const named = codeOf(file);
    if (named) {
      if (games.includes(named)) out.set(file, named);
      continue;
    }
    // In two games' categories with no game in its name: can't tell which.
    if (fams.size !== 1) continue;
    const [family] = fams;
    const code = games.includes(family) ? family : games.find((g) => familyOf(g) === family);
    if (code) out.set(file, code);
  }
  return out;
}

/** Archive screenshots named "<Place>_<GAME>.png" (or "<Region>_Route_N_<GAME>.png"), for places whose page has few. */
async function archiveShots(place: PlaceIn, source: Source): Promise<string[]> {
  const name = (TITLES[`${place.region}|${place.name}`] ?? place.name).replace(/ /g, "_");
  const prefixes =
    ARCHIVE_PREFIXES[`${place.region}|${place.name}`] ??
    (/^Route_\d+$/.test(name) ? [`${source.wiki.replace(/ /g, "_")}_${name}_`] : [`${name}_`]);
  // X/Y's Photo Spots: a view of the place from where the photographer stands.
  const photoSpot = `Photo_Spot_${name}`;
  const codeless = source.games.length === 1 || !!source.screens;
  const out: string[] = [];
  for (const prefix of [...prefixes, photoSpot]) {
    for (const f of await archiveFiles(prefix)) {
      if (Math.max(f.width, f.height) < 200) continue;
      // The rest of the name is a game code, optionally after a season / view word or two;
      // regions that allow code-less files (sized up later) take a word or two without one.
      const rest = f.name.slice(prefix.length).replace(/\.(png|jpe?g)$/i, "").split("_").filter(Boolean);
      if (rest.length <= 3 && GAME_CODES[rest.at(-1) ?? ""]) out.push(f.name);
      else if (codeless && rest.length <= 2 && (prefix === photoSpot || rest.length > 0)) out.push(f.name);
    }
  }
  return [...(ARCHIVE_FILES[`${place.region}|${place.name}`] ?? []), ...out];
}

const ALL_PLACES: PlaceIn[] = [];
/**
 * A file that names a different place on the map isn't a view of this one
 * (Cerulean's Miracle Cycle page shows Goldenrod's too). Names inside this
 * place's own ("Cerulean" in Cerulean Cave) don't count.
 */
function namesOtherPlace(file: string, place: PlaceIn, title = place.name): boolean {
  if (KEEP_IN[file]) return KEEP_IN[file] !== place.name;
  const fw = fileWords(file);
  const own = squash(title) + squash(place.name);
  return ALL_PLACES.some((p) => {
    if (p.name === place.name) return false;
    const pw = placeWords(p);
    const key = pw.join("");
    return key.length >= 5 && !own.includes(key) && spells(fw, pw);
  });
}

/** A file's name as words, without its extension or a trailing variant letter ("Aether ParadiseA", "route1b"). */
const fileWords = (file: string) => words(file.replace(/\.[a-z0-9]+$/i, "").replace(/(?<=[a-z\d])[A-D]$|(?<=\d)[a-d]$/, ""));
/** Names too common to stand alone once "Village" is dropped (any "Pokémon …" file isn't Pokémon Village's). */
const KEEP_SUFFIX = new Set(["pokemon", "tapu"]);
/** A place's name as words, without "Town", "City" or "Village". */
function placeWords(place: PlaceIn): string[] {
  const name = TITLES[`${place.region}|${place.name}`] ?? place.name;
  const short = words(name.replace(/\s+(Town|City|Village)$/i, ""));
  return short.length === 1 && KEEP_SUFFIX.has(short[0]) ? words(name) : short;
}

/** Some run of the file's words spells the place's name ("Route14" and "Kalos_Route_4" spell Route 4; "Route_40" doesn't). */
function spells(file: string[], place: string[]): boolean {
  const target = place.join("");
  for (let i = 0; i < file.length; i++) {
    let run = "";
    for (let j = i; j < file.length && run.length < target.length; j++) {
      run += file[j];
      if (run === target) return true;
    }
  }
  return false;
}

/**
 * A file named after the place, not one that just sits on its page. When it
 * spells several of the region's places, it belongs to the longest name
 * ("Hau'oli Cemetery", not "Hau'oli City").
 */
function namesPlace(file: string, place: PlaceIn): boolean {
  const f = fileWords(file);
  let owner: PlaceIn | null = null;
  let longest = 0;
  for (const p of PLACES_BY_REGION.get(place.region) ?? [place]) {
    const w = placeWords(p);
    const n = w.join("").length;
    if (n > longest && spells(f, w)) [owner, longest] = [p, n];
  }
  return owner === place;
}

const backdropFiles = new Map<string, Promise<{ name: string; width: number; height: number }[]>>();
/** The region's in-game backdrops of the place, if it has any. */
async function backdropShots(place: PlaceIn, store: ShotStore, max: number): Promise<GeoShot[]> {
  const backdrop = BACKDROPS[place.region];
  if (!backdrop || max <= 0) return [];
  if (!backdropFiles.has(backdrop.prefix)) backdropFiles.set(backdrop.prefix, archiveFiles(backdrop.prefix));
  const files = (await backdropFiles.get(backdrop.prefix)!).filter((f) => f.width === 400 && f.height === 240 && namesPlace(f.name, place));
  return collectShots(
    files.map((f) => f.name),
    max,
    store,
    storage,
    { fallback: GAME_CODES[backdrop.code] }
  );
}

/** Words in other wikis' file names that mean "not a view of the place". */
const WIKI_NOT_A_VIEW = /(^|[ _(-])(localisation|carte|icône|icone|icon|animé|dessin|vs|pms|sticker|symbol|global|modell|embuscade|citydex|disambig|vote|wikipedia|lückenhaft|orden|passe|lettre|zygarde|smash|ssbu|betreten|storyboard|postcomp|lebensraum|tw(?=[ _.)-]|$)|ign(?=[ _.)-]|$)|map(?=[ _.)-]|$)|(lh|lv|vp|pg|ep|ag|hz|sl|xy|bw|dp)\d{2,3})/i;
/** PokéWiki's floor maps ("Seeschauminseln EG", "… UG1"): guide maps with item markers. */
const WIKI_FLOOR_MAP = /[ _(-](EG|UG\d*|OG\d*)[ _.)-]/;

/** Words in other wikis' file names for the weather or time of day of a plain view ("Roche-sur-Gliffe pluie XY.png"). */
const VIEW_WORDS = new Set(["pluie", "nuit", "jour", "soir", "matin", "neige", "hiver", "ete", "printemps", "automne", "regen", "nacht", "tag", "abend", "schnee", "winter", "sommer", "herbst", "fruhling"]);

/**
 * How to use another wiki's 3D shot, from its name. Poképédia and PokéWiki
 * name a view after the place alone when it's the moment of arriving, with the
 * place's name on screen: a banner at the top (X / Y, Sun / Moon, Sword /
 * Shield, Scarlet / Violet) or a sign box at the bottom (Omega Ruby / Alpha
 * Sapphire, Brilliant Diamond / Shining Pearl), which is cut off. Weather and
 * time-of-day views are kept whole. Anything else in the name is an item, a
 * TM or an event: X / Y's item shots are the spot with the pickup's text box
 * along the bottom, which is cut off; a TM is a Gym Leader's cutscene, and the
 * other games' item shots are dark dives and room interiors: null, not used.
 */
function overlayTrim(wiki: Wiki, file: string, title: string, region: string, code: string): { top?: number; bottom?: number } | null {
  const own = new Set([...words(title), ...words(region)]);
  const codes = new Set(Object.keys(wiki.codes).map((c) => c.toLowerCase()));
  const rest = fileWords(file).filter((w) => !own.has(w) && !codes.has(w) && !/^\d+$/.test(w));
  if (rest.length && rest.every((w) => VIEW_WORDS.has(w))) return {};
  if (rest.some((w) => !/^(entree|arrivee|betreten|ankunft)$/.test(w))) {
    return code === "XY" && !rest.some((w) => /^(ct|cs|tm|vm|dt|tr)\d+$/.test(w)) ? { bottom: 0.3 } : null;
  }
  return ["ORAS", "OR", "AS", "BDSP"].includes(code) ? { bottom: 0.3 } : { top: 0.27 };
}

/**
 * The place's page on other wikis (Fandom, Poképédia, PokéWiki): screenshots
 * named after the place, of the region's games. Bulbapedia has guidebook maps
 * for most X/Y, Sun/Moon and Sword/Shield routes; these wikis have the views.
 * 3D games' shots must be screen-shaped. Fills up to `max` shots.
 */
async function wikiShots(place: PlaceIn, source: Source, games: string[], store: ShotStore, max: number, retro: boolean, have3d: number): Promise<GeoShot[]> {
  if (max <= 0) return [];
  const name = TITLES[`${place.region}|${place.name}`] ?? place.name;
  const unique = PLACE_COUNTS.get(place.name) === 1;
  let local: Partial<Record<"fr" | "de", string>> | null = null;
  // Fandom's and Poképédia's 3DS shots are often a little cropped or scaled: 5:3-ish and small (guidebook scans are big).
  const ds = source.screens?.["400x240"];
  const shapeless = (width: number, height: number) =>
    games.length === 1 ? games[0] : ds && width / height >= 1.6 && width / height <= 1.8 && width <= 800 ? ds : undefined;
  const shots: GeoShot[] = [];
  for (const wiki of WIKIS) {
    if (shots.length >= max) break;
    // Poképédia's and PokéWiki's views mostly carry a text box or the place's banner: only for places nothing else shows.
    if (wiki.lang !== "en" && have3d + shots.length > 0) break;
    if (wiki.lang !== "en") local ??= await localNames(name, source.wiki);
    const title = wiki.lang === "en" ? name : local?.[wiki.lang];
    if (!title) continue;
    // A bare "Route 9" could be another region's.
    const bare = wiki.lang === "en" ? unique : !/^Route \d+$/.test(title);
    const page = await wikiPage(wiki, [`${title} (${source.wiki})`, `${source.wiki} ${title}`, ...(bare ? [title] : [])]);
    if (!page) continue;
    // A linked page's title can carry its region ("Route 13 (Alola)"); files don't.
    const plainTitle = title.replace(/\s*\(.*\)$/, "");
    const named = (file: string) =>
      wiki.lang === "en" ? namesPlace(file, place) : spells(fileWords(file), words(plainTitle.replace(/\s+(Town|City|Village)$/i, "")));
    const gameOf = new Map<string, string>();
    const trimTop: Record<string, number> = {};
    const trimBottom: Record<string, number> = {};
    const files = (await wikiImages(wiki, page)).filter((f) => {
      if (WIKI_DENYLIST.has(f.file) || WIKI_NOT_A_VIEW.test(f.file) || WIKI_FLOOR_MAP.test(f.file) || !usable(f.file, games, true) || !named(f.file)) return false;
      const code = wikiCode(wiki, f.file);
      const resolved = code ?? shapeless(f.width, f.height);
      if (!resolved || !games.includes(resolved)) return false;
      const threeD = THREE_DS.has(resolved) || SWITCH.has(resolved);
      if (!threeD && !retro) return false;
      // A 3DS capture is at most twice the screen's 400 px; wider 5:3 images are guidebook scans.
      const ok = !threeD
        ? Math.min(f.width, f.height) >= 144
        : Math.min(f.width, f.height) >= 200 &&
          (!THREE_DS.has(resolved) || f.width <= 800) &&
          (code || SWITCH.has(resolved) ? screenShaped(resolved, f.width, f.height) : f.width / f.height >= 1.6 && f.width / f.height <= 1.8);
      if (!ok) return false;
      if (threeD && wiki.lang !== "en") {
        const trim = overlayTrim(wiki, f.file, plainTitle, source.wiki, resolved);
        if (!trim) return false;
        if (trim.top) trimTop[f.file] = trim.top;
        if (trim.bottom) trimBottom[f.file] = trim.bottom;
      }
      gameOf.set(f.file, GAME_CODES[resolved]);
      return true;
    });
    // The plain view ("Route 9 XY.png") first.
    files.sort((a, b) => a.file.length - b.file.length);
    shots.push(
      ...(await collectShots(
        files.map((f) => f.file),
        max - shots.length,
        store,
        storage,
        {
          fallback: (w, h) => (shapeless(w, h) ? GAME_CODES[shapeless(w, h)!] : undefined),
          games: gameOf,
          urls: new Map(files.map((f) => [f.file, f.url])),
          keyPrefix: `${wiki.id}:`,
          trimTop,
          trimBottom,
        }
      ))
    );
  }
  return shots;
}

/** The infobox `region` field allows this source (absent counts as yes). */
function inRegion(wikitext: string, source: Source): boolean {
  const field = wikitext.match(/^\|\s*region\s*=\s*(.*)$/m)?.[1];
  if (!field) return true;
  return [source.wiki, ...source.regions].some((r) => field.includes(r));
}

/** A place's page: candidate titles in order, then search; the first whose infobox is in the right region. */
async function placePage(place: PlaceIn, source: Source): Promise<{ title: string; wikitext: string } | null> {
  const name = TITLES[`${place.region}|${place.name}`] ?? place.name;
  const candidates = [`${source.wiki} ${name}`, `${name} (${source.wiki})`, name];
  const r = await api<{ query: { pages: { title: string; missing?: boolean }[]; redirects?: { from: string; to: string }[] } }>(WIKI, {
    action: "query",
    titles: candidates.join("|"),
    redirects: "1",
  });
  const resolved = new Map((r.query.redirects ?? []).map((x) => [x.from, x.to]));
  const titles = [...new Set(candidates.map((c) => resolved.get(c) ?? c).filter((c) => r.query.pages.some((p) => p.title === c && !p.missing)))];
  if (!titles.length) {
    const found = await api<{ query: { search: { title: string }[] } }>(WIKI, {
      action: "query",
      list: "search",
      srsearch: `${name} ${source.wiki}`,
      srlimit: "3",
    });
    // Only results named like the place ("Ghost (type)" is no page for the abandoned Thrifty Megamart).
    const key = [...words(name)].sort((a, b) => b.length - a.length)[0] ?? "";
    titles.push(...found.query.search.map((s) => s.title).filter((t) => words(t).includes(key)));
  }
  for (const title of titles) {
    const page = await leadSection(title);
    if (page && inRegion(page.wikitext, source)) return page;
  }
  return null;
}

async function ingestSource(source: Source, world: WorldPlaces, store: ShotStore): Promise<WorldLocation[]> {
  const places = world.places.filter((p) => source.regions.includes(p.region));
  console.log(`\n== ${source.regions.join(" + ")} (${places.length} places)`);
  const out: WorldLocation[] = [];
  /** Page title → the place it is, for matching buildings to their parent. */
  const byTitle = new Map<string, PlaceIn>();
  const pageTitles: string[] = [];
  const catCodes = await categoryShots(source, source.games);
  const catGames = new Map([...Object.entries(FILE_GAMES), ...[...catCodes].map(([f, code]) => [f, GAME_CODES[code]] as const)]);
  for (const place of places) {
    const games = ONLY_GAMES[`${place.region}|${place.name}`] ?? source.games;
    const page = await placePage(place, source);
    const infobox = page ? await infoboxImages(page.wikitext) : [];
    const archive = await archiveShots(place, source);
    const gallery = page ? await galleryImages(page.title, [page.title, place.name, ...infobox.map(imageStem)]) : [];
    const fromCategories = [...catCodes.keys()].filter((f) => games.includes(catCodes.get(f)!) && (KEEP_IN[f] ? KEEP_IN[f] === place.name : namesPlace(f, place)));
    const trusted = new Set(
      [...infobox, ...(ARCHIVE_FILES[`${place.region}|${place.name}`] ?? []), ...archive.filter((f) => f.startsWith("Photo_Spot_")), ...fromCategories].map((f) =>
        f.replace(/ /g, "_")
      )
    );
    const ranked = (await rankShots([infobox, archive, gallery, fromCategories], games, source, trusted, catCodes)).filter((f) => !namesOtherPlace(f, place));
    const shots = await collectShots(ranked, MAX_SHOTS, store, storage, {
      games: catGames,
      fallback: fallbackFor(source, games),
      trimBottom: TRIM_BOTTOM,
    });
    shots.push(...(await wikiShots(place, source, games, store, WIKI_SHOTS - count3d(shots), shots.length === 0, count3d(shots))));
    shots.push(...(await backdropShots(place, store, WIKI_SHOTS - count3d(shots))));
    if (page) {
      byTitle.set(squash(page.title), place);
      pageTitles.push(page.title);
    }
    out.push({ name: place.name, region: place.region, ...placeArea(place, world), shots });
    console.log(`  ${shots.length ? "✓" : "·"} ${place.name}${page && squash(page.title) !== squash(place.name) ? ` [${page.title}]` : ""} (${shots.length} shots)`);
  }

  // Buildings, Gyms and landmarks whose infobox places them in one of these places.
  const candidates = new Set<string>();
  for (const cat of [`Category:${source.wiki} locations`, `Category:${source.wiki} Gyms`]) for (const t of await categoryPages(cat)) candidates.add(t);
  for (const title of pageTitles) for (const t of await pageLinks(title)) candidates.add(t);
  const taken = new Set([...byTitle.keys(), ...NOT_BUILDINGS]);
  const titles = (await withBuildingInfobox([...candidates].filter((t) => !taken.has(squash(t))))).sort();
  const find = (ref: string) => byTitle.get(squash(ref)) ?? byTitle.get(squash(`${source.wiki} ${ref}`));
  for (const title of titles) {
    const page = await leadSection(title);
    if (!page || taken.has(squash(page.title)) || MIRAGE_SPOT.test(page.title) || !inRegion(page.wikitext, source)) continue;
    const ref = firstLocationRef(page.wikitext);
    let parent = ref ? find(ref) : undefined;
    if (ref && !parent) {
      const to = await redirectTarget(ref);
      parent = to ? find(to) : undefined;
    }
    if (!parent) continue;
    const infobox = await infoboxImages(page.wikitext);
    const gallery = await galleryImages(page.title, [page.title, ...infobox.map(imageStem)]);
    // Archives files named after the building ("Silph Co. 5F LGPE.png").
    const titleWords = words(page.title.replace(/\s*\(.*\)$/, ""));
    const fromCategories = titleWords.join("").length >= 6 ? [...catCodes.keys()].filter((f) => spells(fileWords(f), titleWords)) : [];
    const trusted = new Set([...infobox, ...fromCategories].map((f) => f.replace(/ /g, "_")));
    const shots = await collectShots(
      (await rankShots([infobox, gallery, fromCategories], source.games, source, trusted, catCodes)).filter((f) => !namesOtherPlace(f, parent, page.title)),
      MAX_BUILDING_SHOTS,
      store,
      storage,
      { games: catGames, fallback: fallbackFor(source, source.games), trimBottom: TRIM_BOTTOM }
    );
    if (!shots.length) continue;
    taken.add(squash(page.title));
    out.push({ name: page.title, region: parent.region, parent: parent.name, shots });
    console.log(`  ✓ ${page.title} → ${parent.name} (${shots.length} shots)`);
  }
  return keepOnce(out, store);
}

/** The world map, and one crop per region (with a margin), as static images. */
async function writeMaps(world: WorldPlaces) {
  const crops: Record<string, { name: string; regions: string[]; box: [number, number, number, number]; src: string }> = {};
  for (const [id, info] of Object.entries(CROPS)) {
    const [x0, y0, x1, y1] = world.crops[id];
    const m = Math.round(Math.max(x1 - x0, y1 - y0) * CROP_MARGIN);
    const box: [number, number, number, number] = [Math.max(0, x0 - m), Math.max(0, y0 - m), Math.min(world.W, x1 + m), Math.min(world.H, y1 + m)];
    await sharp(WORLD_MAP)
      .extract({ left: box[0], top: box[1], width: box[2] - box[0], height: box[3] - box[1] })
      .webp({ quality: 88, effort: 5 })
      .toFile(path.join(path.dirname(WORLD_MAP), `${id}.webp`));
    crops[id] = { ...info, box, src: `/geo/maps/${id}.webp` };
  }
  return crops;
}

/**
 * A screenshot two places' pages share (an area map that takes in its
 * neighbour) would have two right answers: it stays with the place it is
 * named after, or the longer name ("Hammerlocke Hills", not "Hammerlocke").
 */
function keepOnce(locations: WorldLocation[], store: ShotStore): WorldLocation[] {
  const fileOf = new Map(Object.entries(store.cache).map(([file, id]) => [id, file.replace(/^[a-z]+:/, "").replace(/#.*$/, "")]));
  const areaOf = (l: WorldLocation) => l.parent ?? l.name;
  const areas = new Map<string, Set<string>>();
  for (const l of locations) for (const s of l.shots) (areas.get(s.id) ?? areas.set(s.id, new Set()).get(s.id)!).add(areaOf(l));
  for (const [id, where] of areas) {
    if (where.size < 2) continue;
    const file = fileOf.get(id) ?? "";
    const named = [...where].filter((a) => spells(fileWords(file), words(a.replace(/\s+(Town|City|Village)$/i, ""))));
    const keep = KEEP_IN[file] ?? named.sort((a, b) => b.length - a.length)[0] ?? [...where][0];
    for (const l of locations) if (areaOf(l) !== keep) l.shots = l.shots.filter((s) => s.id !== id);
    console.log(`  = ${file}: kept in ${keep}, not ${[...where].filter((a) => a !== keep).join(", ")}`);
  }
  return locations.filter((l) => !l.parent || l.shots.length);
}

/** A difference hash of a screenshot (borders trimmed, 17 × 16 grey): 256 bits, as a string of 0s and 1s. */
async function shotHash(id: string): Promise<string | null> {
  const res = await fetch(`${storage.baseUrl}/${id}.webp`).catch(() => null);
  if (!res?.ok) return null;
  let img = sharp(Buffer.from(await res.arrayBuffer())).flatten({ background: "#000" });
  try {
    img = sharp(await img.trim({ threshold: 30 }).toBuffer());
  } catch {
    // Nothing to trim.
  }
  const px = await img.resize(17, 16, { fit: "fill" }).greyscale().raw().toBuffer();
  let bits = "";
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) bits += px[y * 17 + x] < px[y * 17 + x + 1] ? "1" : "0";
  return bits;
}
function hashDistance(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}
/** Hash distance under which two shots of one place are copies: of any game, or of the same game (seasons, Sword's and Shield's, a wiki's copy). */
const SAME_PICTURE = 10;
const SAME_GAME_PICTURE = 24;
/** Two places whose shots are this alike (two Regi chambers, two open-sea routes) can't be told apart. */
const LOOK_ALIKE = 18;

/**
 * Each place's screenshots, once: a town doesn't repeat its stadium's shot,
 * and of two near-copies (a route in spring and in summer, the same view on
 * two wikis) only the first is kept.
 */
async function nearCopies(locations: WorldLocation[], store: ShotStore): Promise<WorldLocation[]> {
  const fromWiki = new Set(Object.entries(store.cache).filter(([file]) => /^[a-z]+:/.test(file)).map(([, id]) => id));
  const hashes: Record<string, string | null> = existsSync(SHOT_HASHES) ? JSON.parse(readFileSync(SHOT_HASHES, "utf8")) : {};
  for (const l of locations) for (const s of l.shots) if (!hashes[s.id]) hashes[s.id] = await shotHash(s.id);
  writeFileSync(SHOT_HASHES, JSON.stringify(hashes));
  const areas = new Map<string, WorldLocation[]>();
  for (const l of locations) {
    const key = `${l.region}|${l.parent ?? l.name}`;
    areas.set(key, [...(areas.get(key) ?? []), l]);
  }
  for (const group of areas.values()) {
    // Buildings first, so a shot both list stays with the building.
    const ordered = [...group.filter((l) => l.parent), ...group.filter((l) => !l.parent)];
    const kept: GeoShot[] = [];
    for (const l of ordered) {
      l.shots = l.shots.filter((s) => {
        const h = hashes[s.id];
        const copy = kept.some((k) => {
          if (k.id === s.id) return true;
          const kh = hashes[k.id];
          if (!h || !kh) return false;
          const d = hashDistance(h, kh);
          return d <= SAME_PICTURE || (d <= SAME_GAME_PICTURE && k.game === s.game);
        });
        if (copy) console.log(`  ≈ ${l.region} | ${l.name}: dropped a copy of an earlier shot (${s.game})`);
        else kept.push(s);
        return !copy;
      });
    }
  }
  const all = locations.flatMap((l) => l.shots.map((s) => ({ s, area: `${l.region}|${l.parent ?? l.name}` })));
  const alike = new Set<string>();
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = hashes[all[i].s.id];
      const b = hashes[all[j].s.id];
      if (a && b && all[i].area !== all[j].area && all[i].s.id !== all[j].s.id && hashDistance(a, b) <= LOOK_ALIKE) {
        // Another wiki's copy of a Bulbapedia shot, filed under a neighbouring place, goes; two of Bulbapedia's both go.
        const wiki = [all[i].s.id, all[j].s.id].filter((id) => fromWiki.has(id));
        for (const id of wiki.length === 1 ? wiki : [all[i].s.id, all[j].s.id]) alike.add(id);
        console.log(`  ≈ ${all[i].area} and ${all[j].area} look the same: dropped ${wiki.length === 1 ? "the other wiki's copy" : "both shots"}`);
      }
    }
  }
  for (const l of locations) l.shots = l.shots.filter((s) => !alike.has(s.id));
  return locations.filter((l) => !l.parent || l.shots.length);
}

/** Tops up a region's existing places from other wikis and backdrops, without asking Bulbapedia again. */
async function topUp(source: Source, world: WorldPlaces, store: ShotStore, old: WorldLocation[]): Promise<WorldLocation[]> {
  console.log(`\n== ${source.regions.join(" + ")}: top-up`);
  const out = old.filter((l) => source.regions.includes(l.region)).map((l) => ({ ...l, shots: [...l.shots] }));
  for (const place of world.places.filter((p) => source.regions.includes(p.region))) {
    const location = out.find((l) => !l.parent && l.region === place.region && l.name === place.name);
    if (!location) continue;
    const games = ONLY_GAMES[`${place.region}|${place.name}`] ?? source.games;
    const fromWikis = await wikiShots(place, source, games, store, WIKI_SHOTS - count3d(location.shots), location.shots.length === 0, count3d(location.shots));
    const backdrops = await backdropShots(place, store, WIKI_SHOTS - count3d([...location.shots, ...fromWikis]));
    const added = [...fromWikis, ...backdrops].filter((s) => !location.shots.some((t) => t.id === s.id));
    location.shots.push(...added);
    if (added.length) console.log(`  + ${place.name} (${added.length})`);
  }
  return keepOnce(out, store);
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  mkdirSync(path.dirname(LOCK), { recursive: true });
  for (;;) {
    try {
      mkdirSync(LOCK);
      break;
    } catch {
      await sleep(2000);
    }
  }
  try {
    return await fn();
  } finally {
    rmdirSync(LOCK);
  }
}

/** Saves this run's uploads into the upload cache, keeping what other runs saved since it was read. */
function saveCache(store: ShotStore, readAtStart: Record<string, string>) {
  const onDisk: Record<string, string> = existsSync(SHOT_CACHE) ? JSON.parse(readFileSync(SHOT_CACHE, "utf8")) : {};
  const ours = Object.entries(store.cache).filter(([file, id]) => readAtStart[file] !== id);
  store.cache = { ...onDisk, ...Object.fromEntries(ours) };
  Object.assign(readAtStart, Object.fromEntries(ours));
  writeFileSync(SHOT_CACHE, JSON.stringify(store.cache));
}

async function main() {
  const args = process.argv.slice(2);
  const topUpOnly = args.includes("--top-up");
  const wanted = args.filter((a) => !a.startsWith("--")).map((s) => s.toLowerCase());
  const world: WorldPlaces = JSON.parse(readFileSync(PLACES, "utf8"));
  for (const name of new Set(world.places.map((p) => p.name))) {
    PLACE_COUNTS.set(name, new Set(world.places.filter((p) => p.name === name).map((p) => p.region)).size);
  }
  for (const place of world.places) PLACES_BY_REGION.set(place.region, [...(PLACES_BY_REGION.get(place.region) ?? []), place]);
  ALL_PLACES.push(...world.places);
  const data = JSON.parse(readFileSync(OUT_DATA, "utf8"));
  await storage.ensureBucket();
  const old: WorldLocation[] = data.world?.locations ?? [];
  const store: ShotStore = {
    cache: existsSync(SHOT_CACHE) ? JSON.parse(readFileSync(SHOT_CACHE, "utf8")) : {},
    live: new Set(old.flatMap((l) => l.shots.map((s) => s.id))),
  };
  const readAtStart = { ...store.cache };

  const built: WorldLocation[] = [];
  const regions = new Set<string>();
  for (const source of SOURCES) {
    if (wanted.length && !source.regions.some((r) => wanted.includes(r.toLowerCase()))) continue;
    const these = topUpOnly ? await topUp(source, world, store, old) : await ingestSource(source, world, store);
    built.push(...these);
    for (const r of source.regions) regions.add(r);
    mkdirSync(path.dirname(SHOT_CACHE), { recursive: true });
    await withLock(async () => saveCache(store, readAtStart));
    const shots = these.reduce((s, l) => s + l.shots.length, 0);
    console.log(`  → ${these.filter((l) => !l.parent).length} places, ${these.filter((l) => l.parent).length} buildings, ${shots} screenshots`);
  }

  await withLock(async () => {
    // Other regions as they are now (another run may have rewritten them meanwhile).
    const current: WorldLocation[] = JSON.parse(readFileSync(OUT_DATA, "utf8")).world?.locations ?? [];
    const before = [...old, ...current];
    const locations = await nearCopies([...current.filter((l) => !regions.has(l.region)), ...built], store);
    // Every place's pin and area as world-places.json has them now.
    const places = new Map(world.places.map((p) => [`${p.region}|${p.name}`, p]));
    for (const l of locations) {
      const place = l.parent ? undefined : places.get(`${l.region}|${l.name}`);
      if (place) Object.assign(l, placeArea(place, world));
    }
    const crops = await writeMaps(world);
    const out = {
      storageBase: storage.baseUrl,
      world: { map: { src: "/geo/maps/world.webp", width: world.W, height: world.H, squarePx: world.squarePx }, crops, locations },
    };
    writeFileSync(OUT_DATA, JSON.stringify(out));
    // Screenshots the data no longer uses: the deployed site may still show them, so they go only when asked.
    const kept = new Set(locations.flatMap((l) => l.shots.map((s) => s.id)));
    const unused = [...new Set(before.flatMap((l) => l.shots.map((s) => s.id)))].filter((id) => !kept.has(id));
    if (args.includes("--prune")) await storage.remove(unused);
    else if (unused.length) console.log(`  ${unused.length} uploads no longer used (delete them with --prune after deploying)`);
  });
}

void main();
