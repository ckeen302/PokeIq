/**
 * Pictures of the forms the tracker shows that the site's Pokémon art (public/sizes/art, made for /pokedex/sizes) has no
 * file for. Each is the form's Pokémon HOME render, made the same way as the rest (scripts/nuzlocke-art.ts), so a form
 * that looks different (Heat Rotom, East Sea Shellos, Yellow Flabébé) never shows as its species' default.
 */

/**
 * Forms with a PokéAPI pokemon id whose render the tracker added at that id (public/sizes/art/256/{id}.webp), by
 * PokéAPI's form name. Partner Pikachu and Partner Eevee (10158, 10159) have no HOME render; they look like Pikachu
 * and Eevee, whose pictures stand in.
 */
export const FORM_ART: Record<string, number> = {
  "wormadam-sandy": 10004,
  "wormadam-trash": 10005,
  "giratina-origin": 10007,
  "rotom-heat": 10008,
  "rotom-wash": 10009,
  "rotom-frost": 10010,
  "rotom-fan": 10011,
  "rotom-mow": 10012,
  "basculin-blue-striped": 10016,
  "keldeo-resolute": 10024,
  "meowstic-female": 10025,
  "pumpkaboo-small": 10027,
  "pumpkaboo-large": 10028,
  "pumpkaboo-super": 10029,
  "gourgeist-small": 10030,
  "gourgeist-large": 10031,
  "gourgeist-super": 10032,
  "oricorio-pom-pom": 10123,
  "oricorio-pau": 10124,
  "oricorio-sensu": 10125,
  "lycanroc-midnight": 10126,
  "rockruff-own-tempo": 10151,
  "zygarde-10": 10181,
  "toxtricity-low-key": 10184,
  "indeedee-female": 10186,
  "urshifu-rapid-strike": 10191,
  "oinkologne-female": 10254,
  "squawkabilly-blue-plumage": 10260,
  "squawkabilly-yellow-plumage": 10261,
  "squawkabilly-white-plumage": 10262,
};

const FLOWERS = ["yellow", "orange", "blue", "white"] as const;
const FLOWER_LINE = [
  [669, "flabebe", "Flabébé"],
  [670, "floette", "Floette"],
  [671, "florges", "Florges"],
] as const;

/**
 * Cosmetic forms that depend on where the Pokémon is met (East Sea Shellos, Flabébé's flower colours): PokéAPI has no
 * pokemon for them, only a form name, so their pictures are kept with the tracker (public/tools/nuzlocke/forms/, from
 * HOME's {species}-{form}.png). With the name the screens give them and the form each evolves into (the same sea, the
 * same flower).
 */
export const COSMETIC_FORMS: Record<string, { species: number; render: string; name: string; evolves?: string }> = {
  "shellos-east": { species: 422, render: "422-east", name: "East Sea Shellos", evolves: "gastrodon-east" },
  "gastrodon-east": { species: 423, render: "423-east", name: "East Sea Gastrodon" },
  ...Object.fromEntries(
    FLOWER_LINE.flatMap(([species, slug, name], i) =>
      FLOWERS.map((c) => [`${slug}-${c}`, { species, render: `${species}-${c}`, name: `${c[0].toUpperCase()}${c.slice(1)} ${name}`, ...(FLOWER_LINE[i + 1] && { evolves: `${FLOWER_LINE[i + 1][1]}-${c}` }) }])
    )
  ),
};

/** A cosmetic form's picture. */
export const cosmeticArt = (form: string): string => `/tools/nuzlocke/forms/${COSMETIC_FORMS[form].render}.webp`;
