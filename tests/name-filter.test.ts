import { describe, expect, it } from "vitest";
import POKEDEX from "@/data/pokedex.json";
import { NAME_REJECTED, SAFE_NAME, isCleanName, optionalName, publicName } from "@/lib/name-filter";
import { duelNameSchema } from "@/lib/server/duel-core";

describe("name filter", () => {
  it("passes every Pokémon, in every language", () => {
    const blocked = POKEDEX.flatMap((p) => [p.name, ...Object.values(p.names)]).filter((name) => !isCleanName(name));
    expect(blocked).toEqual([]);
  });

  it("passes everyday words and names that hide a rude one (the Scunthorpe problem)", () => {
    const words = [
      "Cockatiel", "Scunthorpe", "assassin", "classic", "Dugtrio", "Cofagrigus", "Shiinotic", "Analyst", "Hitmonchan",
      "Passimian", "Spoink", "Klefki", "Bass", "Glass", "Compass", "Embassy", "Cassandra", "Grape", "Therapist",
      "Arsenal", "Sussex", "Nigel", "Niger", "Raccoon", "Spicy", "Spices", "Title", "Titan", "Cumberbatch", "Peacock",
      "Hancock", "Cocktail", "Dickens", "Shiitake", "Penistone", "Uranus", "Assess", "Rapping", "Annals", "Saltwater",
      "Nightwatch", "Snazzy", "Fukuoka", "Yamashita", "Kinoshita", "Matsushita", "Mass Hitter", "MassHitter",
      "Ash's Hitmonchan", "In Igglybuff", "It Watchog", "OfAggron", "Ash Ketchum", "Red", "B055", "N1ce", "Ash4ever",
      "Gary0ak", "Pikachu123", "Mr. Mime", "Farfetch'd", "Ho-Oh", "Type: Null", "Flabébé", "ピカチュウ", "피카츄",
    ];
    expect(words.filter((w) => !isCleanName(w))).toEqual([]);
  });

  it("blocks slurs and obscenities however they're spelled", () => {
    const names = [
      // plain, cased and repeated
      "nigger", "NIGGA", "niggaaaa", "faggot", "fuck", "FUUUUCK", "shit", "cunt", "bitch", "asshole", "whore", "slut",
      "retard", "tranny", "kike", "spic", "chink", "coon", "wetback", "Hitler", "nazi", "kkk", "rape", "rapist",
      "porn", "dildo", "cumshot", "penis", "vagina", "pussy", "dick", "cock", "tits", "fag", "ass", "cum", "kys",
      // leetspeak and symbols
      "N1GG3R", "n!gg@", "f4gg0t", "Sh1t", "5h1t", "$hit", "a$$hole", "@ss", "b1tch", "p0rn", "c0ck", "pu$$y",
      "r4pe", "H1tl3r", "n4zi", "s1ut", "d1ck", "wh0re", "fvck", "phuck",
      // split up
      "n i g g e r", "nig.ger", "nig ger", "f u c k", "f.u.c.k", "fu ck", "s h i t", "sh-it", "c_u_n_t", "a.s.s",
      // hidden in other words, or run together
      "xXfuckXx", "MotherFucker", "BullShit", "BigAss", "BigDick", "DickHead", "dickhead", "cocksucker", "pornhub",
      "ShitLord", "xXxShitxXx", "ShiT", "FatAss", "kill yourself", "white power", "SiegHeil", "Trainer1488",
      // look-alike letters, accents and fancy Unicode
      "nіgger", "fuсk", "Nïggér", "ｎｉｇｇｅｒ", "𝓯𝓾𝓬𝓴", "ⓕⓤⓒⓚ", "fμck", "ƒuck", "s​h​i​t",
    ];
    expect(names.filter((n) => isCleanName(n))).toEqual([]);
  });

  it("checks both readings of 1 and |", () => {
    expect(isCleanName("s1ut")).toBe(false); // 1 → l
    expect(isCleanName("sh1t")).toBe(false); // 1 → i
    expect(isCleanName("|<ys")).toBe(true); // not a K
  });

  it("swaps names already stored for a safe one, and drops optional ones", () => {
    expect(publicName("Ash")).toBe("Ash");
    expect(publicName("fuckface")).toBe(SAFE_NAME);
    expect(optionalName("Misty")).toBe("Misty");
    expect(optionalName("sh1thead")).toBeUndefined();
    expect(optionalName(undefined)).toBeUndefined();
  });

  it("is enforced by the duel, battle and matchmaking name schema", () => {
    expect(duelNameSchema.safeParse("Brock").success).toBe(true);
    const parsed = duelNameSchema.safeParse("Big Sh1t");
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0].message).toBe(NAME_REJECTED);
  });
});
