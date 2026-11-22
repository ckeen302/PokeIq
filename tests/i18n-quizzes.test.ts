import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import wp from "@/messages/which-pokemon";
import jaWp from "@/messages/ja/which-pokemon.json";
import esWp from "@/messages/es/which-pokemon.json";
import { translator } from "@/i18n/catalog";
import { OTHER_LOCALES } from "@/i18n/config";
import play from "@/messages/iq-test-play";
import results from "@/messages/iq-test-results";
import quiz from "@/messages/which-pokemon-quiz";
import resultNs from "@/messages/which-pokemon-result";
import { arithItem } from "@/lib/cognitive/memory";
import { LOOKALIKES, MONS, TYPES, monName } from "@/lib/cognitive/materials";
import { cognitiveLocal } from "@/lib/cognitive/local";
import { cognitiveBand, cognitiveTitle, profileWords, type CognitiveRecord } from "@/lib/cognitive/result";
import { ordinal } from "@/lib/cognitive/scoring";
import { LEVELS } from "@/lib/cognitive/types";
import { iqTitle } from "@/lib/rating";
import { rankKey } from "@/components/iq-test/rank";
import { QUESTION_BANK } from "@/lib/which-pokemon/questions";
import { ANSWER_LABELS, AXES, AXIS_INFO } from "@/lib/which-pokemon/types";
import { POOL } from "@/lib/which-pokemon/pool";
import { compatibility } from "@/lib/which-pokemon/match";
import { firstSentence, wpLocal, wpText } from "@/lib/which-pokemon/i18n";

const tp = translator(play, "en", undefined);
const tr = translator(results, "en", undefined);
const tq = translator(quiz, "en", undefined);
const tw = translator(resultNs, "en", undefined);

describe("the PokéIQ Test in English reads as before", () => {
  it("arithmetic prompts at every level", () => {
    for (const level of LEVELS) {
      for (let i = 0; i < 20; i++) {
        const item = arithItem(`seed-${i}`, level);
        expect(tp(`arith.l${level}`, { name: monName(item.monId), ...item.values })).toBe(item.prompt);
      }
    }
  });

  it("bands, ranks, ordinals and profile words", () => {
    for (const s of [60, 79, 80, 95, 110, 119, 120, 129, 130, 145]) expect(tr(`bands.${cognitiveBand(s)}`)).toBe(cognitiveTitle(s));
    for (const iq of [70, 85, 95, 108, 118, 130, 150]) expect(tp(`ranks.${rankKey(iqTitle(iq))}`)).toBe(iqTitle(iq));
    for (const p of [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 50.4, 88.6, 99.5, 101, 111, 112]) {
      expect(tr("percentile", { p: Math.round(p) })).toBe(`${ordinal(p)} percentile of trainers`);
    }
    const r = (fluid: number, memory: number, speed: number, spatial: number): CognitiveRecord => ({
      v: 1,
      at: 0,
      score: 100,
      percentile: 50,
      sections: {
        fluid: { raw: 0, percentile: 50, scaled: fluid },
        memory: { raw: 0, percentile: 50, scaled: memory },
        speed: { raw: 0, percentile: 50, scaled: speed },
        spatial: { raw: 0, percentile: 50, scaled: spatial },
      },
    });
    for (const rec of [r(115, 90, 100, 112), r(100, 100, 100, 100), r(80, 120, 85, 100)]) {
      const w = profileWords(rec);
      expect(w.strong.map((k) => tr(`words.${k}.strength`)).join(tr("sep"))).toBe(w.strengths.join("; "));
      expect(w.weak.map((k) => tr(`words.${k}.weakness`)).join(tr("sep"))).toBe(w.weaknesses.join("; "));
    }
  });
});

describe("the PokéIQ Test in other languages", () => {
  it("names every Pokémon its items show, and gives each type a label of its own", () => {
    const ids = new Set([...MONS.map((m) => m.id), ...LOOKALIKES.flat()]);
    for (const locale of OTHER_LOCALES) {
      const local = cognitiveLocal(locale)!;
      for (const id of ids) expect(local.mons[id], `${locale} #${id}`).toMatch(/\S/);
      for (const id of ids) expect(local.mons[id]).not.toMatch(/^#/);
      const labels = TYPES.map((t) => local.abbr[t].toLocaleUpperCase(locale));
      expect(new Set(labels).size, `${locale}: ${labels.join(" ")}`).toBe(TYPES.length);
      for (const t of TYPES) expect(local.types[t]).not.toBe(t);
    }
  });

  it("English pages get no local names", () => {
    expect(cognitiveLocal("en")).toBeUndefined();
    expect(wpLocal("en")).toBeUndefined();
  });
});

describe("Which Pokémon Are You? in English reads as before", () => {
  it("questions, answers, axes and compatibility labels", () => {
    for (const q of QUESTION_BANK) expect(tq(`q.${q.id as keyof typeof quiz.en.q}`)).toBe(q.text);
    for (const a of [1, 2, 3, 4, 5] as const) expect(tq(`answers.${a}`)).toBe(ANSWER_LABELS[a]);
    for (const axis of AXES) {
      expect(tw(`axes.${axis}.label`)).toBe(AXIS_INFO[axis].label);
      expect(tw(`axes.${axis}.inline`)).toBe(AXIS_INFO[axis].label.toLowerCase());
      expect(tw(`axes.${axis}.low`)).toBe(AXIS_INFO[axis].low);
      expect(tw(`axes.${axis}.high`)).toBe(AXIS_INFO[axis].high);
    }
    for (let i = 0; i < POOL.length - 1; i++) {
      const c = compatibility(POOL[i].p, POOL[i + 1].p);
      expect(tw(`compat.${c.tier}`)).toBe(c.label);
    }
  });

  it("result texts and the first sentence of a write-up", () => {
    for (const p of POOL) {
      expect(wpText(p, "en")).toBe(p);
      expect(firstSentence(p.blurb, "en")).toBe(p.blurb.split(/(?<=\.)\s/)[0]);
    }
  });
});

describe("messages with a literal # and tags render in every language", () => {
  it("the result page's Pokédex line", () => {
    for (const [locale, messages] of [["en", undefined], ["ja", jaWp], ["es", esWp]] as const) {
      const t = translator(wp, locale, messages);
      const html = renderToStaticMarkup(createElement("p", null, t.rich("result.dexLine", { num: "0025", gen: 1, link: (c) => createElement("a", null, c) })));
      expect(html, locale).toMatch(/^<p>#0025 · .*1.* · <a>.+<\/a><\/p>$/);
    }
  });
});

describe("Which Pokémon Are You? in other languages", () => {
  it("every pooled Pokémon has its own archetype, write-up and evidence", () => {
    for (const locale of OTHER_LOCALES) {
      const local = wpLocal(locale)!;
      for (const p of POOL) {
        const t = wpText(p, locale);
        expect(t.title, `${locale} ${p.slug}`).not.toBe(p.title);
        expect(t.blurb).not.toBe(p.blurb);
        expect(t.why).not.toBe(p.why);
        expect(local.titles[p.slug]).toBe(t.title);
        // Game codes are written out as the language names the games.
        expect(t.why).not.toMatch(/\b(RBY|RSE|GSC|DPPt|SwSh|ORAS|HGSS|FRLG|LGPE)\b/);
        const first = firstSentence(t.blurb, locale);
        expect(first.length).toBeGreaterThan(5);
        expect(first.length).toBeLessThan(t.blurb.length);
      }
    }
  });
});
