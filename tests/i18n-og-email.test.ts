import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { translator } from "@/i18n/catalog";
import og from "@/messages/og";
import ogAlt from "@/messages/og-alt";
import { confirmEmail, dailyEmail, mailT, streakLine } from "@/lib/server/email/templates";
import jaOgAlt from "@/messages/ja/og-alt.json";
import esOg from "@/messages/es/og.json";

/**
 * Share images and emails in every language: each English share image has a /<lang>/ mirror and an alt text in
 * og-alt (under the key scripts/i18n/mirror.mjs gives it), and the emails take a language while English stays as it was.
 */

const APP = "src/app";

function images(dir = APP): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!/^(\[locale\]|api|admin)$/.test(name) || dir !== APP) out.push(...images(full));
    } else if (/^(opengraph|twitter)-image\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** The same key as scripts/i18n/mirror.mjs's altKey. */
const altKey = (relDir: string) => relDir.replace(/\[+(?:\.\.\.)?([^\]]+)\]+/g, "$1").replace(/[^A-Za-z0-9]+/g, "_") || "home";
const CHALLENGE_ALT = /CHALLENGE_ALT = "([^"]+)"/.exec(readFileSync("src/lib/og/challenge.tsx", "utf8"))![1];

describe("share images in every language", () => {
  const files = images();
  const english = ogAlt.en as Record<string, string>;

  it("finds the share images", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("gives every image a mirror under [locale] and its English alt in og-alt", () => {
    const keys = new Set<string>();
    for (const file of files) {
      const relDir = relative(APP, dirname(file)).split("\\").join("/");
      const key = altKey(relDir);
      keys.add(key);
      expect(existsSync(join(APP, "[locale]", relDir, "opengraph-image.locale.tsx")), file).toBe(true);
      const src = readFileSync(file, "utf8");
      const m = /^export const alt = (?:"((?:[^"\\]|\\.)*)"|CHALLENGE_ALT);/m.exec(src);
      expect(m, file).not.toBeNull();
      expect(english[key], file).toBe(m![1] !== undefined ? JSON.parse(`"${m![1]}"`) : CHALLENGE_ALT);
    }
    expect(Object.keys(english).sort()).toEqual([...keys].sort());
    expect(Object.keys(jaOgAlt).sort()).toEqual([...keys].sort());
  });

  it("writes the English cards' lines exactly as before", () => {
    const t = translator(og, "en", undefined);
    expect(t("card.footer")).toBe("Free · no sign-up →");
    expect(t("replay.subtitle", { result: "Red beat Blue", how: "forfeit" })).toBe("Red beat Blue by forfeit.");
    expect(t("replay.subtitle", { result: "Red beat Blue", how: "timeout" })).toBe("Red beat Blue on time.");
    expect(t("replay.subtitle", { result: "Red beat Blue", how: "other" })).toBe("Red beat Blue.");
    expect(t("species.eyebrow", { number: "0025", gen: 1 })).toBe("Pokédex #0025 · Gen 1");
    expect(t("result.footer", { play: "Play today's daily" })).toBe("Can you beat it? Play today's daily →");
  });

  it("writes another language's lines in it", () => {
    const t = translator(og, "es", esOg as never);
    expect(t("species.subtitle", { genus: "Pokémon Ratón", bst: 320 })).toBe("Pokémon Ratón. Estadísticas base totales: 320.");
    expect(t("replay.subtitle", { result: "Rojo venció a Azul", how: "forfeit" })).toBe("Rojo venció a Azul por abandono.");
  });
});

describe("emails in a language", () => {
  const input = {
    to: "ash@example.com",
    username: "Ash",
    date: "2026-11-08",
    dailyNumber: 23,
    siteUrl: "https://playpokeiq.com",
    imageUrl: "https://playpokeiq.com/api/email/daily-image?date=2026-11-08",
    unsubscribeUrl: "https://playpokeiq.com/email/unsubscribe?token=abc.def",
    settingsUrl: "https://playpokeiq.com/trainer#settings",
    postalAddress: null,
    streak: { game: "dle" as const, days: 12 },
  };

  it("is English without a language, word for word", () => {
    const m = dailyEmail(input);
    expect(m.html).toContain('<html lang="en">');
    expect(m.html).toContain("Today's dailies are live</h1>");
    expect(m.html).toContain('alt="Today\'s PokéGuessr picture, blurred"');
    expect(m.text.split("\n").slice(0, 2)).toEqual(["PokéIQ Daily #23", "Today's dailies are live."]);
    expect(m.text).toContain("PokéGuessr daily: https://playpokeiq.com/pokeguessr");
    expect(streakLine({ game: "dle", days: 12 })).toBe("Your 12-day Pokédle streak ends at midnight.");
    const c = confirmEmail({ to: "a@b.co", username: "<Ash>", confirmUrl: "https://x/c", postalAddress: null });
    expect(c.subject).toBe("Confirm your email for PokéIQ");
    expect(c.html).toContain('Confirm this address for the trainer <b style="color:#f3f2fb;">&lt;Ash&gt;</b> to get PokéIQ\'s daily reminder emails.');
    expect(c.text).toContain("Confirm this address for the trainer <Ash> to get PokéIQ's daily reminder emails.");
  });

  it("is in the recipient's language when one is given", () => {
    const m = dailyEmail({ ...input, locale: "ja" });
    expect(m.subject).toBe("今日のPokéIQデイリーが始まりました");
    expect(m.html).toContain('<html lang="ja">');
    expect(m.html).toContain("Pokédleの12日連続記録が、今夜0時に途切れます。");
    expect(m.html).not.toContain("Today's dailies");
    const c = confirmEmail({ to: "a@b.co", username: "<Ash>", confirmUrl: "https://x/c", postalAddress: null, locale: "fr" });
    expect(c.subject).toBe("Confirme ton e-mail pour PokéIQ");
    expect(c.html).toContain("<b style=\"color:#f3f2fb;\">&lt;Ash&gt;</b>");
    expect(mailT("de")("confirm.button")).toBe("E-Mail bestätigen");
  });
});
