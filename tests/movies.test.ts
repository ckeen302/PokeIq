import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { MOVIES, getMovie, movieKicker, movieYears, relatedFor } from "@/lib/movies/data";
import { MOVIE_ERAS, MOVIES_PATH, moviePath, parseEra } from "@/lib/movies/eras";
import { getPokemon } from "@/lib/pokemon/pokedex";
import { movie } from "@/lib/structured-data";
import { SITE_URL } from "@/lib/site";

/** When a film comes out, as a sortable string: its premiere, or the end of its announced year. */
const when = (m: (typeof MOVIES)[number]) => m.premiere ?? `${m.year}-12-31`;

describe("Pokédex Movies data", () => {
  it("has unique slugs, and every film resolves by its slug", () => {
    const slugs = MOVIES.map((m) => m.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const m of MOVIES) expect(getMovie(m.slug)).toBe(m);
  });

  it("lists the films in release order", () => {
    for (let i = 1; i < MOVIES.length; i++) expect(when(MOVIES[i - 1]) <= when(MOVIES[i]), `${MOVIES[i - 1].slug} before ${MOVIES[i].slug}`).toBe(true);
    for (const m of MOVIES) if (m.premiere) expect(Number(m.premiere.slice(0, 4))).toBe(m.year);
  });

  it("numbers the anime films 1 to 23 in order; the live-action and coming films have no number", () => {
    const numbered = MOVIES.filter((m) => m.number !== null);
    expect(numbered.map((m) => m.number)).toEqual(Array.from({ length: 23 }, (_, i) => i + 1));
    expect(MOVIES.filter((m) => m.number === null).map((m) => m.slug)).toEqual(["detective-pikachu", "wild-card"]);
  });

  it("puts each anime film in its era", () => {
    const eraOf = (n: number) => (n <= 5 ? "original" : n <= 9 ? "advanced" : n <= 13 ? "dp" : n <= 16 ? "bw" : n <= 19 ? "xy" : "modern");
    for (const m of MOVIES) if (m.number !== null) expect(m.era, m.slug).toBe(eraOf(m.number));
    expect(getMovie("detective-pikachu")?.era).toBe("live-action");
    expect(getMovie("wild-card")?.era).toBe("coming-soon");
    // Every era chip has at least one film behind it.
    for (const e of MOVIE_ERAS) expect(MOVIES.some((m) => m.era === e.id), e.id).toBe(true);
  });

  it("only names Pokémon that are in the Pokédex", () => {
    for (const m of MOVIES) {
      for (const id of m.featured) expect(getPokemon(id), `${m.slug} featured ${id}`).toBeDefined();
      for (const c of m.characters) if (c.partner) expect(getPokemon(c.partner), `${m.slug} ${c.name}'s partner ${c.partner}`).toBeDefined();
    }
  });

  it("has a poster on disk for every film", () => {
    for (const m of MOVIES) {
      expect(m.poster).toBe(`/movies/${m.slug}.webp`);
      expect(existsSync(join(process.cwd(), "public", m.poster)), m.poster).toBe(true);
    }
  });

  it("links related films that exist, never itself", () => {
    for (const m of MOVIES) {
      for (const s of m.related) {
        expect(getMovie(s), `${m.slug} → ${s}`).toBeDefined();
        expect(s).not.toBe(m.slug);
      }
      expect(relatedFor(m).films).toHaveLength(m.related.length);
    }
    // The Diamond & Pearl trilogy links its other two films.
    expect(getMovie("the-rise-of-darkrai")?.related).toEqual(["giratina-and-the-sky-warrior", "arceus-and-the-jewel-of-life"]);
    expect(relatedFor(getMovie("giratina-and-the-sky-warrior")!).title).toMatch(/trilogy/);
  });

  it("labels each film's page", () => {
    expect(movieKicker(getMovie("the-rise-of-darkrai")!)).toBe("Movie 10 · Diamond & Pearl era");
    expect(movieKicker(getMovie("mewtwo-strikes-back-evolution")!)).toBe("Movie 22 · CGI remake");
    expect(movieKicker(getMovie("detective-pikachu")!)).toBe("Live-action");
    expect(movieKicker(getMovie("wild-card")!)).toBe("Coming soon");
    expect(movieYears(getMovie("the-rise-of-darkrai")!)).toBe("Japan 2007 · US 2008");
    expect(movieYears(getMovie("wild-card")!)).toBe("Coming 2027");
  });

  it("keeps summaries short (one to three sentences)", () => {
    for (const m of MOVIES) {
      const sentences = m.summary.split(/(?<=[.!?])\s+/).filter(Boolean);
      expect(sentences.length, m.slug).toBeGreaterThanOrEqual(1);
      expect(sentences.length, m.slug).toBeLessThanOrEqual(3);
    }
  });

  it("reads the era from ?era=, ignoring anything unknown", () => {
    expect(parseEra("xy")).toBe("xy");
    expect(parseEra("nope")).toBeNull();
    expect(parseEra(null)).toBeNull();
  });
});

describe("Pokédex Movies pages", () => {
  it("the sitemap lists the Movies tab and every film", async () => {
    const { default: sitemap } = await import("@/app/sitemap");
    const urls = new Set((await sitemap()).map((e) => new URL(e.url).pathname));
    expect(urls.has(MOVIES_PATH)).toBe(true);
    for (const m of MOVIES) expect(urls.has(moviePath(m.slug)), m.slug).toBe(true);
  });

  it("Movie JSON-LD has absolute URLs and a date only once released", () => {
    const darkrai = getMovie("the-rise-of-darkrai")!;
    const ld = movie({ name: darkrai.title, path: moviePath(darkrai.slug), description: darkrai.summary, image: darkrai.poster, datePublished: darkrai.premiere });
    expect(ld).toMatchObject({ "@context": "https://schema.org", "@type": "Movie", url: `${SITE_URL}/pokedex/movies/the-rise-of-darkrai`, image: `${SITE_URL}/movies/the-rise-of-darkrai.webp`, datePublished: "2007-07-14" });
    const wild = getMovie("wild-card")!;
    expect(movie({ name: wild.title, path: moviePath(wild.slug), description: wild.summary, image: wild.poster, datePublished: wild.premiere })).not.toHaveProperty("datePublished");
  });
});
