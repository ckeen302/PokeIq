/**
 * The Tools hub's picture of the Shiny Pokémon Maker: the first design (Charizard in obsidian and ember) at its own
 * size, public/shiny-maker/hub.png (the page scales it up with crisp pixels).
 *   npx tsx scripts/shiny-maker/hub-art.ts
 */
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { decodeSpecies, type SpeciesFile } from "../../src/lib/shiny-maker/data";
import { DEFAULT_ID, firstDesign } from "../../src/lib/shiny-maker/presets";
import { renderPixels } from "../../src/lib/shiny-maker/recolor";

const sp = decodeSpecies(JSON.parse(readFileSync(`public/shiny-maker/px/${DEFAULT_ID}.json`, "utf8")) as SpeciesFile);
const px = renderPixels(sp, firstDesign(sp), "yours", 0.6);
sharp(Buffer.from(px.buffer), { raw: { width: sp.w, height: sp.h, channels: 4 } }).png({ compressionLevel: 9 }).toFile("public/shiny-maker/hub.png").then(() => console.log(`hub.png ${sp.w}×${sp.h}`));
