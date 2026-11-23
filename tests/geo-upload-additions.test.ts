import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { filePage, parseSource, sourceWithCut } from "../scripts/geo/shot-source";
import { validate, webpChunks, type Pending } from "../scripts/geo/upload-additions";

// The owner's upload step (scripts/geo/upload-additions.ts): sources resolve
// to the wiki's file, the upload carries no metadata, and a pending list with
// a problem is refused before anything is fetched.

describe("shot sources", () => {
  it("reads the part of the file kept", () => {
    expect(parseSource("https://archives.bulbagarden.net/wiki/File:Mt_Chimney_RS.png (view cut at 208,464,368,240)")).toEqual({
      page: "https://archives.bulbagarden.net/wiki/File:Mt_Chimney_RS.png",
      cut: { left: 208, top: 464, width: 368, height: 240 },
    });
    expect(parseSource("https://www.pokewiki.de/Datei:Route_1_SoMo.png")).toEqual({ page: "https://www.pokewiki.de/Datei:Route_1_SoMo.png" });
  });

  it("writes a cut only when it isn't the whole file", () => {
    const page = "https://www.pokepedia.fr/Fichier:Route_1_SL.png";
    expect(sourceWithCut(page, { left: 0, top: 0, width: 400, height: 240 }, { width: 400, height: 240 })).toBe(page);
    expect(sourceWithCut(page, { left: 0, top: 0, width: 400, height: 200 }, { width: 400, height: 240 })).toBe(`${page} (view cut at 0,0,400,200)`);
    expect(parseSource(sourceWithCut(page, { left: 1, top: 2, width: 3, height: 4 })).cut).toEqual({ left: 1, top: 2, width: 3, height: 4 });
  });

  it("finds each wiki's API and file title", () => {
    expect(filePage("https://archives.bulbagarden.net/wiki/File:Team_Rocket's_Castle_USUM.png")).toEqual({
      api: "https://bulbapedia.bulbagarden.net/w/api.php",
      title: "File:Team_Rocket's_Castle_USUM.png",
    });
    expect(filePage("https://www.pokewiki.de/Datei:Route_1_SoMo.png")?.title).toBe("Datei:Route_1_SoMo.png");
    expect(filePage("https://www.pokepedia.fr/Fichier:%C3%8Ele_de_Fer_DEPS.png")?.title).toBe("Fichier:Île_de_Fer_DEPS.png");
    expect(filePage("https://www.wikidex.net/wiki/Archivo:Ruta_1_SL.png")?.api).toBe("https://www.wikidex.net/api.php");
    expect(filePage("https://pokemon.fandom.com/wiki/File:X.png")?.api).toBe("https://pokemon.fandom.com/api.php");
    // Anything else is the file itself.
    expect(filePage("https://static.example.org/x.png")).toBeNull();
    expect(filePage("https://www.pokepedia.fr/Route_1_(Alola)")).toBeNull();
  });
});

describe("upload", () => {
  it("encoded shots carry no metadata", async () => {
    const plain = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#123" } }).webp().toBuffer();
    expect(webpChunks(plain)).toEqual(["VP8 "]);
    const tagged = await sharp(plain).withMetadata({ exif: { IFD0: { Copyright: "x" } } }).webp().toBuffer();
    expect(webpChunks(tagged)).toContain("EXIF");
  });

  it("refuses a pending list with a problem", () => {
    const ok: Pending = { key: "p-a1b2c3", region: "Alola", name: "Route 1", game: "Sun / Moon", source: "https://www.pokewiki.de/Datei:Route_1_SoMo.png" };
    expect(validate([ok], new Set())).toEqual([]);
    expect(validate([ok, ok], new Set())).toHaveLength(1);
    expect(validate([{ ...ok, game: "Sun and Moon" }], new Set())[0]).toMatch(/known game label/);
    expect(validate([{ ...ok, source: "" }], new Set())[0]).toMatch(/no source/);
    expect(validate([ok], new Set(["p-a1b2c3"]))[0]).toMatch(/already a shot id/);
  });
});
