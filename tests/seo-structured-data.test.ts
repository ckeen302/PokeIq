import { describe, expect, it } from "vitest";
import { breadcrumbList, itemList, webGame, websiteWithSearch } from "@/lib/structured-data";
import { jsonLd } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";
import { TYPES } from "@/lib/pokemon/type-matrix";
import { isType, movesOfType, pokemonOfType, typeDescription, typeMatchups, typeTitle } from "@/lib/dex/type-pages";
import { CARDS_PER_SITEMAP, allCardIds, cardLinksForDex, cardSitemapIds, setName } from "@/lib/tcg/card-index";
import { diffSitemaps, findKey, indexNowPayloads, parseSitemap } from "../scripts/indexnow.mjs";

const absolute = (u: unknown) => typeof u === "string" && u.startsWith(`${SITE_URL}`);

describe("JSON-LD builders", () => {
  it("BreadcrumbList starts at home with sequential positions and absolute URLs", () => {
    const ld = breadcrumbList([
      { name: "Pokédex", path: "/pokedex" },
      { name: "Types", path: "/pokedex/types" },
    ]);
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("BreadcrumbList");
    expect(ld.itemListElement.map((i) => i.position)).toEqual([1, 2, 3]);
    expect(ld.itemListElement.every((i) => i["@type"] === "ListItem" && i.name && absolute(i.item))).toBe(true);
    expect(ld.itemListElement[0].item).toBe(SITE_URL);
    expect(ld.itemListElement[2].item).toBe(`${SITE_URL}/pokedex/types`);
  });

  it("WebSite carries a SearchAction whose template uses the declared variable", () => {
    const ld = websiteWithSearch();
    expect(ld["@type"]).toBe("WebSite");
    expect(ld.url).toBe(SITE_URL);
    expect(ld.potentialAction["@type"]).toBe("SearchAction");
    expect(ld.potentialAction.target["@type"]).toBe("EntryPoint");
    expect(ld.potentialAction.target.urlTemplate).toContain("{search_term_string}");
    expect(absolute(ld.potentialAction.target.urlTemplate)).toBe(true);
    expect(ld.potentialAction["query-input"]).toBe("required name=search_term_string");
  });

  it("game pages are free WebApplications in the game category", () => {
    const ld = webGame({ name: "Battle Lab", path: "/battle/lab", description: "Simulate battles." });
    expect(ld).toMatchObject({
      "@context": "https://schema.org",
      "@type": "WebApplication",
      applicationCategory: "GameApplication",
      url: `${SITE_URL}/battle/lab`,
      offers: { "@type": "Offer", price: "0" },
    });
  });

  it("ItemList counts its items and links each one", () => {
    const ld = itemList("Fire-type Pokémon", [
      { name: "Charmander", path: "/pokemon/charmander" },
      { name: "Vulpix", path: "/pokemon/vulpix" },
    ]);
    expect(ld["@type"]).toBe("ItemList");
    expect(ld.numberOfItems).toBe(2);
    expect(ld.itemListElement[1]).toEqual({ "@type": "ListItem", position: 2, name: "Vulpix", url: `${SITE_URL}/pokemon/vulpix` });
  });

  it("serialises to JSON that cannot close the script tag", () => {
    const out = jsonLd(itemList("</script><b>", []));
    expect(out).not.toContain("</script>");
    expect(JSON.parse(out).name).toBe("</script><b>");
  });
});

describe("type pages", () => {
  it("cover exactly the 18 types", () => {
    expect(TYPES).toHaveLength(18);
    expect(isType("fire")).toBe(true);
    expect(isType("stellar")).toBe(false);
  });

  it("derive matchups from the type chart", () => {
    const fire = typeMatchups("fire");
    expect(fire.superEffective).toEqual(["grass", "ice", "bug", "steel"]);
    expect(fire.weakTo).toEqual(["water", "ground", "rock"]);
    const ghost = typeMatchups("ghost");
    expect(ghost.immuneTo).toEqual(["normal", "fighting"]);
    expect(ghost.noEffect).toEqual(["normal"]);
    expect(typeMatchups("normal").superEffective).toEqual([]);
  });

  it("list Pokémon and moves for every type, with unique titles", () => {
    const titles = new Set<string>();
    for (const t of TYPES) {
      const { pure, dual } = pokemonOfType(t);
      expect(pure.length + dual.length).toBeGreaterThan(0);
      expect(pure.every((p) => p.types.length === 1 && p.types[0] === t)).toBe(true);
      const m = movesOfType(t);
      expect(m.total).toBe(m.physical + m.special + m.status);
      const powers = m.strongest.map((x) => x.power ?? 0);
      expect(powers).toEqual([...powers].sort((a, b) => b - a));
      expect(m.strongest.every((x) => x.type === t && x.cls !== "status")).toBe(true);
      titles.add(typeTitle(t));
      expect(typeDescription(t).length).toBeLessThan(320);
    }
    expect(titles.size).toBe(18);
  });
});

describe("card index", () => {
  it("lists every card for the sitemaps, each file under the 50,000-URL limit", async () => {
    const ids = await allCardIds();
    expect(ids.length).toBeGreaterThan(20_000);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[a-z0-9.-]+-[A-Za-z0-9._-]+$/i.test(id))).toBe(true);
    expect(CARDS_PER_SITEMAP).toBeLessThanOrEqual(50_000);
    expect((await cardSitemapIds()).length).toBe(Math.ceil(ids.length / CARDS_PER_SITEMAP));
  });

  it("names sets and links a species' cards newest first", async () => {
    expect(setName("base1")).toBe("Base");
    const { cards, total } = await cardLinksForDex(6, 6);
    expect(total).toBeGreaterThan(cards.length);
    expect(cards).toHaveLength(6);
    expect(cards.every((c) => c.name.includes("Charizard") && c.setName && !/^[a-z0-9]+$/.test(c.setName))).toBe(true);
  });
});

describe("IndexNow", () => {
  const xml = (urls: [string, string?][]) =>
    `<?xml version="1.0"?><urlset>${urls.map(([u, m]) => `<url><loc>${u}</loc>${m ? `<lastmod>${m}</lastmod>` : ""}</url>`).join("")}</urlset>`;

  it("has a key file in public/", () => {
    expect(findKey()).toMatch(/^[a-f0-9]{32}$/);
  });

  it("submits added, removed and re-dated URLs only", () => {
    const before = parseSitemap(xml([["https://x.dev/a", "2026-01-01"], ["https://x.dev/b"], ["https://x.dev/gone"]]));
    const after = parseSitemap(xml([["https://x.dev/a", "2026-02-01"], ["https://x.dev/b"], ["https://x.dev/new?x=1&amp;y=2"]]));
    expect(after.has("https://x.dev/new?x=1&y=2")).toBe(true);
    expect(diffSitemaps(before, after)).toEqual(["https://x.dev/a", "https://x.dev/gone", "https://x.dev/new?x=1&y=2"]);
    expect(diffSitemaps(after, after)).toEqual([]);
  });

  it("batches requests at 10,000 URLs and drops other hosts", () => {
    const urls = [...Array.from({ length: 10_001 }, (_, i) => `https://x.dev/p/${i}`), "https://other.dev/a"];
    const payloads = indexNowPayloads({ site: "https://x.dev", key: "k".repeat(32), urls });
    expect(payloads).toHaveLength(2);
    expect(payloads[0].urlList).toHaveLength(10_000);
    expect(payloads[1].urlList).toEqual(["https://x.dev/p/10000"]);
    expect(payloads[0]).toMatchObject({ host: "x.dev", keyLocation: `https://x.dev/${"k".repeat(32)}.txt` });
  });
});
