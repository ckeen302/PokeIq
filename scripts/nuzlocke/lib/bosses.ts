/**
 * Which walkthrough battles are bosses, and their level caps (each boss's highest-level Pokémon, from the
 * walkthrough's {{Party}} data for that game).
 *
 * A boss is a Gym Leader (a {{Party}} inside the walkthrough's {{WalkthroughGym}}), an Elite Four member or the
 * Champion; some games add their own (Alola's Captains and Kahunas, BW's N and Ghetsis…, see EXTRA). Battles of one
 * boss in a row (one per starter, version or difficulty) are one boss: per version, the highest level of its
 * variants; Challenge Mode teams are left out (Normal Mode is the game's default).
 */
import type { NuzBoss } from "../../../src/lib/nuzlocke/model";
import { GAME_BY_ID } from "./config";
import type { WtParty } from "./walkthrough";

export interface Picked {
  /** The battle that places the boss in the story. */
  first: WtParty;
  boss: NuzBoss;
  note?: string;
}
export interface BossCfg {
  pick(parties: WtParty[]): Picked[];
}

type Kind = "leader" | "e4" | "champion" | "extra";

/** Party `game` codes that mean one version (anything else means every version). */
const VERSION_CODE: Record<string, Record<string, string[]>> = {
  "ruby-sapphire": { Ru: ["ruby"], Sa: ["sapphire"], Sapphire: ["sapphire"], Ruby: ["ruby"] },
  "black-white": { Bl: ["black"], B: ["black"], W: ["white"] },
  "black-2-white-2": { B2: ["black-2"], W2: ["white-2"], Black: ["black-2"] },
  "omega-ruby-alpha-sapphire": { OR: ["omega-ruby"], AS: ["alpha-sapphire"] },
  "sun-moon": { Su: ["sun"], M: ["moon"] },
  "ultra-sun-ultra-moon": { US: ["ultra-sun"], UM: ["ultra-moon"] },
  "lets-go-pikachu-eevee": { LGP: ["lets-go-pikachu"], LGE: ["lets-go-eevee"] },
  "sword-shield": { Sw: ["sword"], Sh: ["shield"] },
  "scarlet-violet": { S: ["scarlet"], V: ["violet"] },
};
/** Caption words that name a version. */
const VERSION_WORD: [RegExp, string][] = [
  [/\bBlack 2\b/, "black-2"],
  [/\bWhite 2\b/, "white-2"],
  [/\bBlack\b/, "black"],
  [/\bWhite\b/, "white"],
  [/\bHeartGold\b/, "heartgold"],
  [/\bSoulSilver\b/, "soulsilver"],
  [/\bOmega Ruby\b/, "omega-ruby"],
  [/\bAlpha Sapphire\b/, "alpha-sapphire"],
  [/\bRuby\b/, "ruby"],
  [/\bSapphire\b/, "sapphire"],
  [/\bUltra Sun\b/, "ultra-sun"],
  [/\bUltra Moon\b/, "ultra-moon"],
  [/\bSun\b/, "sun"],
  [/\bMoon\b/, "moon"],
  [/\bSword\b/, "sword"],
  [/\bShield\b/, "shield"],
  [/\bScarlet\b/, "scarlet"],
  [/\bViolet\b/, "violet"],
  [/\bLGP\b|Let's Go, Pikachu/, "lets-go-pikachu"],
  [/\bLGE\b|Let's Go, Eevee/, "lets-go-eevee"],
];

/** Game-specific bosses beyond Gym Leaders, the Elite Four and the Champion, with why. */
const EXTRA: Record<string, { test: (p: WtParty) => boolean; title: (p: WtParty) => string; why: string }[]> = {
  "black-white": [
    { test: (p) => p.cls === "Team Plasma" && /^(N|Ghetsis)$/.test(p.name) && p.path.some((h) => /Throne Room/.test(h)), title: (p) => p.name, why: "N and Ghetsis at N's Castle end the main story (Alder is fought after it)" },
  ],
  "scarlet-violet": [
    { test: (p) => !p.standalone && /^(Giacomo|Mela|Atticus|Ortega|Eri)$/.test(p.name) && (p.cls === "" || /Team Star|Squad Boss/i.test(p.cls)), title: (p) => `Team Star ${p.name}`, why: "Team Star's squad bosses (the walkthrough's major fights)" },
    { test: (p) => !!p.standalone && (/^VS Titan /.test(p.path[p.path.length - 1] ?? "") || p.path.some((h) => /Titan/.test(h))), title: (p) => `Titan ${p.name}`, why: "the Titan Pokémon (the walkthrough's major fights; its level is the Titan's, from the walkthrough's Pokémon box or text)" },
  ],
  "sword-shield": [
    { test: (p) => !p.standalone && p.cls === "Gym Leader" && !p.gym && p.part < 21 && p.path.some((h) => /^Wyndon Stadium$/.test(h)), title: (p) => `Champion Cup ${p.name}`, why: "the Champion Cup Finals at Wyndon Stadium (Bede's challenge, then Nessa, Bea or Allister, and Raihan) stand between the eight badges and Leon, as an Elite Four would" },
  ],
  "sun-moon": [
    { test: (p) => p.cls === "Captain" && p.part < 27, title: (p) => `Captain ${p.name}`, why: "Alola's Trial Captains" },
    { test: (p) => p.cls === "Island Kahuna" && p.part < 27, title: (p) => `Kahuna ${p.name}`, why: "Alola's Kahunas (grand trials)" },
    { test: (p) => p.cls === "Pokémon Professor" && p.name === "Kukui" && p.path.some((h) => /Champion/.test(h)), title: () => "Champion battle: Kukui", why: "Kukui is Sun and Moon's Champion battle" },
  ],
  "ultra-sun-ultra-moon": [
    { test: (p) => p.cls === "Captain" && p.part < 29, title: (p) => `Captain ${p.name}`, why: "Alola's Trial Captains" },
    { test: (p) => p.cls === "Island Kahuna" && p.part < 29, title: (p) => `Kahuna ${p.name}`, why: "Alola's Kahunas (grand trials)" },
    { test: (p) => p.name === "Hau" && p.part < 29 && p.path.some((h) => /Champion's Chamber/i.test(h)), title: () => "Champion battle: Hau", why: "Hau is Ultra Sun and Ultra Moon's Champion battle" },
  ],
};

function kindOf(p: WtParty, game: string): Kind | null {
  if (EXTRA[game]?.some((x) => x.test(p))) return "extra";
  if (p.standalone) return null;
  if (/^Champion$/i.test(p.cls) || (p.cls === "" || p.cls === "Elite Four") && p.path.some((h) => /^(The )?Champion\b/i.test(h))) return "champion";
  if (/^Elite Four$/i.test(p.cls) || (p.cls === "" && p.path.some((h) => /^(The )?Elite Four$/i.test(h)))) return "e4";
  if (p.gym && p.gym.badge && !/^\?+$/.test(p.name) && (p.cls === "" || /^(Gym )?Leaders?$/i.test(p.cls))) return "leader";
  return null;
}

function versionsOf(p: WtParty, game: string): string[] {
  const all = GAME_BY_ID.get(game)!.versions.map((v) => v.id);
  const byCode = VERSION_CODE[game]?.[p.game];
  if (byCode) return byCode;
  const words = VERSION_WORD.filter(([re]) => re.test(p.caption)).map(([, v]) => v).filter((v) => all.includes(v));
  // "Black 2" also matches "Black": keep the most specific matches only.
  const specific = words.filter((v) => !words.some((w) => w !== v && w.startsWith(v)));
  return specific.length ? specific : all;
}

const maxLevel = (p: WtParty) => Math.max(...p.mons.map((m) => m.level));

function generic(game: string): BossCfg {
  return {
    pick(parties) {
      const out: Picked[] = [];
      const titles = new Map<string, number>();
      let cur: { kind: Kind; key: string; parties: WtParty[] } | null = null;
      const groups: { kind: Kind; key: string; parties: WtParty[] }[] = [];
      for (const p of parties) {
        const kind = kindOf(p, game);
        // A lone Pokémon box is a boss only by a game's own rule (a Titan); otherwise it is not a battle at all.
        if (p.standalone && kind !== "extra") continue;
        if (!kind || !p.mons.length) {
          cur = null;
          continue;
        }
        if (/Challenge Mode/i.test(p.caption)) continue;
        // A gym's battles group by the gym (BW's Striaton trio); others by trainer name and place.
        const key = kind === "leader" ? `gym:${p.gym!.badge}|${p.part}` : `${kind}:${p.name}|${p.part}|${p.path[p.path.length - 1] ?? ""}`;
        if (cur && cur.key === key) cur.parties.push(p);
        else {
          cur = { kind, key, parties: [p] };
          groups.push(cur);
        }
      }
      const all = GAME_BY_ID.get(game)!.versions.map((v) => v.id);
      for (const g of groups) {
        const first = g.parties[0];
        const names = [...new Set(g.parties.map((p) => p.name))];
        let title: string;
        // One leader per version (BW's Drayden/Iris): name each with its version.
        const verName = (n: string) => {
          const vs = [...new Set(g.parties.filter((p) => p.name === n).flatMap((p) => versionsOf(p, game)))];
          return vs.length < all.length ? `${n} (${vs.map((v) => GAME_BY_ID.get(game)!.versions.find((x) => x.id === v)!.name).join(", ")})` : n;
        };
        if (g.kind === "leader") title = names.length > 1 ? names.map(verName).join(" / ") : names[0];
        else if (g.kind === "e4") title = `Elite Four ${names.join(" / ")}`;
        else if (g.kind === "champion") title = `Champion ${names.join(" / ")}`;
        else title = EXTRA[game]!.find((x) => x.test(first))!.title(first);
        const seen = titles.get(title) ?? 0;
        titles.set(title, seen + 1);
        if (seen) title = `${title} (rematch${seen > 1 ? ` ${seen}` : ""})`;
        const per: Record<string, number> = {};
        for (const p of g.parties) for (const v of versionsOf(p, game)) per[v] = Math.max(per[v] ?? 0, maxLevel(p));
        const caps = [...new Set(Object.values(per))];
        const cap = Math.max(...Object.values(per));
        const boss: NuzBoss = { name: title, ...(g.kind === "leader" && first.gym?.badge ? { badge: first.gym.badge } : {}), cap };
        const inVers = all.filter((v) => per[v] !== undefined);
        if (inVers.length < all.length) boss.versions = inVers;
        const notes: string[] = [];
        if (caps.length > 1) {
          boss.capByVersion = Object.fromEntries(all.filter((v) => per[v] !== undefined).map((v) => [v, per[v]]));
          notes.push(`by version: ${JSON.stringify(boss.capByVersion)}`);
        }
        const starters = g.parties.filter((p) => /^Player choice: /.test(p.caption));
        if (starters.length > 1 && new Set(starters.map(maxLevel)).size > 1) notes.push(`differs by starter: ${starters.map((p) => `${p.caption.replace("Player choice: ", "")} ${maxLevel(p)}`).join(", ")} (highest used)`);
        if (names.length > 1 && g.kind === "leader") notes.push(`one of ${names.join(", ")} (by ${g.parties.some((p) => /Player choice/.test(p.caption)) ? "starter" : "version"})`);
        out.push({ first, boss, ...(notes.length ? { note: notes.join("; ") } : {}) });
      }
      return out;
    },
  };
}

export const BOSSES: Record<string, BossCfg> = Object.fromEntries([...GAME_BY_ID.keys()].map((id) => [id, generic(id)]));
export const BOSS_EXTRA_WHY = Object.fromEntries(Object.entries(EXTRA).map(([g, xs]) => [g, xs.map((x) => x.why)]));
