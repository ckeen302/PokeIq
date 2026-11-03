import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import RAW from "@/data/world-history.json";
import { getPokemon } from "@/lib/pokemon/pokedex";
import { CHAPTERS, CHAPTER_IDS, FIGURE_ARTS, beatPlain, chapterById, filmBeats, sourceOf } from "@/lib/world-history/data";
import { BASES, basisTag, sourceLine } from "@/lib/world-history/types";
import { HISTORY_PATH, chapterFromPath, chapterPath } from "@/lib/world-history/deeplink";
import { artUrl, figureAsset } from "@/lib/world-history/assets";
import { bleedEdges } from "@/lib/world-history/bleed";
import {
  EPILOGUE,
  MAX_BEAT,
  MIN_BEAT,
  PROLOGUE,
  TITLE_HOLD,
  TRANSITION,
  animToFilm,
  beatIndexAt,
  beatSeconds,
  beatStops,
  buildFilm,
  chapterAtFilm,
  chapterStart,
  chapterTiming,
  chapterVideoPlan,
  easePlayhead,
  filmAt,
  filmToAnim,
  filmToScroll,
  rateAt,
  scrollToFilm,
  stepStop,
  storyVideoPlan,
  trackHeight,
  videoAt,
} from "@/lib/world-history/timing";
import { DEFAULT_LIMITS, blendPose, clampOrbit, fovFor, orbitBy, orbitFrom, orbitPose, poseOnPath, wheelFactor, wrapAngle, zoomBy, type Key } from "@/lib/world-history/camera";

const film = buildFilm();

describe("content", () => {
  it("has twelve chapters, oldest stories first, with unique ids and sequential numerals", () => {
    expect(CHAPTER_IDS).toEqual(["creation", "giants", "hoenn", "kalos", "galar", "unova", "kitakami", "johto", "hisui", "alola", "kanto", "paldea"]);
    const numerals = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
    CHAPTERS.forEach((c, i) => expect(c.numeral).toBe(numerals[i]));
    expect(new Set(CHAPTER_IDS).size).toBe(CHAPTER_IDS.length);
    for (const id of CHAPTER_IDS) expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it("every chapter shows its sources, and every beat and note cites one of them", () => {
    for (const c of CHAPTERS) {
      expect(c.sources.length, c.id).toBeGreaterThan(0);
      expect(new Set(c.sources.map((s) => s.id)).size, `${c.id} source ids`).toBe(c.sources.length);
      for (const s of c.sources) {
        expect(s.game, `${c.id}/${s.id}`).toMatch(/^Pokémon[: ]/);
        expect(s.label.length, `${c.id}/${s.id}`).toBeGreaterThan(1);
        expect(sourceLine(s)).toContain(" · ");
      }
      expect(c.beats.length, c.id).toBeGreaterThanOrEqual(4);
      for (const b of c.beats) {
        expect(() => sourceOf(c, b), `${c.id}/${b.id}`).not.toThrow();
        expect(b.quote || b.text, `${c.id}/${b.id} has words`).toBeTruthy();
        expect(BASES, `${c.id}/${b.id}`).toContain(b.basis);
        if (b.cut) {
          // A film excerpt is the game's own words: every piece between the ellipses is in the full quote.
          const full = beatPlain(b);
          for (const piece of b.cut.split(/\.\.\.|…/).map((x) => x.trim()).filter((x) => x.length > 3)) expect(full, `${c.id}/${b.id} cut`).toContain(piece.replace(/^[.!?]+/, "").trim());
          expect(b.cut.length).toBeLessThan(full.length);
        }
      }
      for (const n of c.notes) {
        expect(BASES).toContain(n.basis);
        if (n.source) expect(() => sourceOf(c, { source: n.source! })).not.toThrow();
      }
      // Every source is used.
      const used = new Set([...c.beats.map((b) => b.source), ...c.notes.map((n) => n.source).filter(Boolean)]);
      for (const s of c.sources) expect(used.has(s.id), `${c.id}: source ${s.id} unused`).toBe(true);
      expect(c.beats.some((b) => b.id === c.video), `${c.id} video beat`).toBe(true);
      expect(new Set(c.beats.map((b) => b.id)).size).toBe(c.beats.length);
    }
  });

  it("every figure is a real Pokémon with a valid National Dex number, a HOME box and a baked relief map", () => {
    for (const c of CHAPTERS) {
      expect(c.figures.length, c.id).toBeGreaterThan(0);
      for (const f of c.figures) {
        const p = getPokemon(f.dex);
        expect(p, `${c.id}: dex ${f.dex}`).toBeTruthy();
        expect(Number.isInteger(f.dex) && f.dex >= 1 && f.dex <= 1025).toBe(true);
        expect(p!.name).toBe(f.name);
        if (f.art !== f.dex) expect(f.art).toBeGreaterThan(10000);
        const a = figureAsset(f.art);
        expect(a, `${c.id}: art ${f.art}`).toBeTruthy();
        expect(a!.box[2]).toBeGreaterThan(50);
        expect(existsSync(join(process.cwd(), "public", a!.relief)), `${a!.relief}`).toBe(true);
      }
      // A beat's figures are the chapter's own.
      const arts = new Set(c.figures.map((f) => f.art));
      for (const b of c.beats) for (const a of b.figures ?? []) expect(arts.has(a), `${c.id}/${b.id}: figure ${a}`).toBe(true);
    }
    expect(FIGURE_ARTS.length).toBeGreaterThan(30);
    expect(artUrl(493)).toBe("/api/world-history/art/493?s=512");
  });

  it("never invents a date: every number in a chapter's 'when' is in its own quoted text", () => {
    const words: Record<string, string> = { "two thousand": "2000", "three thousand": "3000", "thousand": "1000" };
    for (const c of CHAPTERS) {
      const nums = (c.when.match(/\d[\d,]*/g) ?? []).map((n) => n.replace(/,/g, ""));
      let text = c.beats.map(beatPlain).join(" ").toLowerCase().replace(/(\d),(\d)/g, "$1$2");
      for (const [w, n] of Object.entries(words)) text = text.replaceAll(w, n);
      for (const n of nums) expect(text, `${c.id}: “${c.when}”`).toContain(n);
    }
    expect(chapterById("unova")!.when).toBe("Undated");
    expect(chapterById("hisui")!.when).not.toMatch(/\d/);
  });

  it("captions myths and speculation as such", () => {
    const creation = chapterById("creation")!;
    expect(creation.tag).toBe("Myth");
    expect(creation.beats[0].lead).toMatch(/^Sinnoh myths tell/);
    expect(basisTag("myth", "Myth")).toBe("Myth");
    expect(basisTag("myth", "Record")).toBe("Legend");
    expect(basisTag("speculation", "Legend")).toBe("Speculation");
    expect(basisTag("stated", "Legend")).toBeNull();
    expect(basisTag("contested", "Record")).toBe("Sources differ");
    const husk = chapterById("unova")!.beats.find((b) => b.id === "husk")!;
    expect(husk.basis).toBe("speculation");
    expect(husk.lead).toMatch(/^Speculation/);
  });

  it("keeps the verified points exactly", () => {
    const all = (id: string) => [...chapterById(id)!.beats.map((b) => `${b.lead ?? ""} ${beatPlain(b)}`), ...chapterById(id)!.notes.map((n) => n.text)].join(" ");
    expect(all("creation")).toContain("It is known as the Original One");
    expect(sourceOf(chapterById("creation")!, chapterById("creation")!.beats.find((b) => b.id === "arceus")!).kind).toBe("npc");
    expect(all("hoenn")).toContain("Thousands of years ago");
    expect(all("hoenn")).toContain("A thousand years of peace");
    expect(all("kalos")).toContain("Three thousand years ago");
    expect(all("galar")).toContain("20,000 years ago");
    expect(chapterById("galar")!.whenNote).toContain("20,000 years ago");
    expect(all("galar")).toContain("The sword and shield were actually Pokémon");
    expect(all("kitakami")).toContain("persecuted as a heretic");
    expect(all("johto")).toContain("700 years ago");
    expect(all("johto")).toContain("About 150 years ago");
    expect(all("johto")).toMatch(/resurrected|gave new life/);
    expect(all("johto")).not.toMatch(/Ho-Oh created/i);
    expect(all("hisui")).toContain("a long-gone era of Sinnoh");
    expect(all("hisui")).toContain("Almighty Sinnoh");
    expect(all("kanto")).toContain("Mew gave birth. We named the newborn Mewtwo.");
    expect(all("hisui")).toContain("call this region the Sinnoh region");
    expect(all("kalos")).toContain("reached the heavens");
    expect(all("kanto")).toContain("Guyana");
    // "Clone" only where the page says the games don't use it.
    for (const c of CHAPTERS) for (const b of c.beats) expect(`${b.lead ?? ""} ${beatPlain(b)}`, `${c.id}/${b.id}`).not.toMatch(/clone/i);
    expect(all("paldea")).toContain("About two thousand years ago");
    expect(all("paldea")).toContain("eight hundred years ago");
    expect(all("paldea")).toContain("Two hundred years ago");
    expect(all("alola")).toContain("control all of Necrozma's light");
    expect(all("unova")).toContain("about 2,500 years ago");
    expect(all("giants")).toContain("towed continents with ropes");
    expect(all("giants")).toContain("we sealed the Pokémon away");
    expect(all("galar")).toContain("King of Bountiful Harvests");
    expect(all("johto")).toContain("about 1500 years old");
    expect(all("hoenn")).toContain("beginning of all Mega Evolution");
  });

  it("captions every point the games tell more than one way", () => {
    const contested = (id: string) => chapterById(id)!.notes.filter((n) => n.basis === "contested").map((n) => n.text).join(" ");
    expect(contested("kanto")).toMatch(/gave birth[\s\S]*obtained a new Pokémon from Mew[\s\S]*gene splicing/);
    expect(contested("hoenn")).toContain("underwater volcano");
    expect(contested("kalos")).toContain("life force of many Pokémon");
    expect(contested("paldea")).toContain("paranormal magazine");
    expect(chapterById("kalos")!.notes.some((n) => n.basis === "theory" && /Mega Stones/.test(n.text))).toBe(true);
    expect(chapterById("alola")!.notes.some((n) => /which came first/.test(n.text))).toBe(true);
    expect(chapterById("creation")!.notes.some((n) => /never confirmed in its own words/.test(n.text))).toBe(true);
  });

  it("keeps the anime and films in their own lane, apart from the games' history", () => {
    expect(RAW.screen.title).toBe("Anime & Movies");
    expect(RAW.screen.note).toMatch(/separate continuity/);
    expect(RAW.screen.items.length).toBeGreaterThanOrEqual(3);
    const lane = RAW.screen.items.map((i) => i.text).join(" ");
    expect(lane).toMatch(/clone/);
    // Nothing from the films leaks into the chapters.
    for (const c of CHAPTERS) for (const b of c.beats) expect(`${b.lead ?? ""} ${beatPlain(b)}`).not.toMatch(/Sir Aaron|Damos|Jewel of Life|Prison Bottle|eyelash/);
  });

  it("keeps quotes clean (no game control codes, no unbalanced quotation marks)", () => {
    for (const c of CHAPTERS) {
      for (const b of c.beats) {
        const s = `${b.lead ?? ""}${b.quote ?? ""}${b.text ?? ""}`;
        expect(s, `${c.id}/${b.id}`).not.toMatch(/#MON|\{|\}|\\c|\[|\]/);
        expect((s.match(/“/g) ?? []).length, `${c.id}/${b.id} quotes`).toBe((s.match(/”/g) ?? []).length);
      }
    }
    expect(RAW.title).toBe("The History of the Pokémon World");
  });
});

describe("deep links", () => {
  it("maps chapters to paths and back", () => {
    expect(chapterPath("hoenn")).toBe("/lab/world-history/hoenn");
    expect(chapterPath(null)).toBe(HISTORY_PATH);
    expect(chapterPath("atlantis")).toBe(HISTORY_PATH);
    expect(chapterFromPath("/lab/world-history/johto")).toBe("johto");
    expect(chapterFromPath("/lab/world-history/johto/")).toBe("johto");
    expect(chapterFromPath("/lab/world-history")).toBeNull();
    expect(chapterFromPath("/lab/world-history/nowhere")).toBeNull();
  });
});

describe("timing", () => {
  it("holds every caption long enough to read, within bounds", () => {
    for (const c of CHAPTERS) {
      const ct = chapterTiming(c);
      expect(ct.beats[0].anim).toBe(TITLE_HOLD);
      const fb = filmBeats(c);
      expect(fb.length, c.id).toBeGreaterThanOrEqual(4);
      expect(fb.some((b) => b.id === c.video), `${c.id}: the video beat is in the film`).toBe(true);
      for (let i = 0; i < fb.length; i++) {
        const s = beatSeconds(fb[i]);
        expect(s).toBeGreaterThanOrEqual(MIN_BEAT);
        expect(s).toBeLessThanOrEqual(MAX_BEAT);
        expect(ct.beats[i].hold).toBeGreaterThanOrEqual(s);
        if (i) expect(ct.beats[i].anim).toBeCloseTo(ct.beats[i - 1].anim + ct.beats[i - 1].hold, 6);
      }
      expect(ct.film).toBeGreaterThanOrEqual(ct.anim);
    }
  });

  it("maps film time to anim time through slow motion, both ways", () => {
    const ct = film.chapters[0];
    expect(ct.slow.length).toBe(1);
    const s = ct.slow[0];
    expect(filmToAnim(ct, 1)).toBeCloseTo(1, 6);
    expect(filmToAnim(ct, s.at)).toBeCloseTo(s.at, 6);
    // Halfway through the slow stretch (in film time) is halfway through its anim span.
    expect(filmToAnim(ct, s.at + s.dur / s.rate / 2)).toBeCloseTo(s.at + s.dur / 2, 6);
    expect(rateAt(ct, s.at + 0.1)).toBe(s.rate);
    expect(rateAt(ct, 0.5)).toBe(1);
    for (const a of [0, 2, s.at + 0.3, s.at + s.dur + 1, ct.anim]) expect(filmToAnim(ct, animToFilm(ct, a))).toBeCloseTo(a, 6);
    expect(animToFilm(ct, ct.anim)).toBeCloseTo(ct.film, 6);
    expect(ct.film).toBeCloseTo(ct.anim + s.dur / s.rate - s.dur, 6);
  });

  it("lays the film out: prologue, chapters joined by hall transitions, epilogue", () => {
    expect(film.chapters).toHaveLength(12);
    expect(film.halls).toHaveLength(13);
    expect(film.chapters[0].start).toBe(PROLOGUE);
    for (let i = 1; i < film.chapters.length; i++) {
      const prev = film.chapters[i - 1];
      expect(film.chapters[i].start).toBeCloseTo(prev.start + prev.film + TRANSITION, 6);
    }
    const last = film.chapters[11];
    expect(film.duration).toBeCloseTo(last.start + last.film + EPILOGUE, 6);
    expect(filmAt(film, 0)).toMatchObject({ kind: "hall" });
    expect(filmAt(film, PROLOGUE + 1)).toMatchObject({ kind: "chapter", index: 0 });
    const t = film.halls[3];
    expect(filmAt(film, (t.start + t.end) / 2)).toMatchObject({ kind: "hall", hall: { from: 2, to: 3 } });
    expect(filmAt(film, film.duration + 50)).toMatchObject({ kind: "hall", k: 1 });
    expect(chapterAtFilm(film, 0)).toBe(0);
    expect(chapterAtFilm(film, t.start + 0.1)).toBe(2);
    expect(chapterAtFilm(film, t.end - 0.1)).toBe(3);
    expect(chapterAtFilm(film, film.duration)).toBe(11);
    expect(chapterStart(film, 4)).toBe(film.chapters[4].start);
    // A sensible length for a film you can also scroll: a few minutes.
    expect(film.duration).toBeGreaterThan(240);
    expect(film.duration).toBeLessThan(600);
  });

  it("steps caption by caption with the arrow keys", () => {
    const stops = beatStops(film);
    expect(stops.length).toBe(CHAPTERS.reduce((n, c) => n + filmBeats(c).length + 1, 0));
    expect(stepStop(film, 0, 1)).toBe(film.chapters[0].start);
    const second = stops[1].t;
    expect(stepStop(film, film.chapters[0].start, 1)).toBeCloseTo(second, 6);
    expect(stepStop(film, second, -1)).toBeCloseTo(film.chapters[0].start, 6);
    expect(stepStop(film, 0, -1)).toBe(0);
    expect(stepStop(film, film.duration, 1)).toBe(film.duration);
  });

  it("finds the caption at a time", () => {
    const ct = film.chapters[2];
    expect(beatIndexAt(ct, 0)).toBe(-1);
    expect(beatIndexAt(ct, ct.beats[0].anim)).toBe(0);
    expect(beatIndexAt(ct, ct.beats[2].anim + 0.01)).toBe(2);
    expect(beatIndexAt(ct, ct.anim)).toBe(ct.beats.length - 1);
  });

  it("scrolls through the film at a screen per few seconds", () => {
    const h = 900;
    expect(trackHeight(film, h)).toBeGreaterThan(film.duration * 100);
    expect(scrollToFilm(film, filmToScroll(film, 123.4, h), h)).toBeCloseTo(123.4, 6);
    expect(scrollToFilm(film, -50, h)).toBe(0);
    expect(scrollToFilm(film, 1e9, h)).toBe(film.duration);
    // The playhead eases toward the scroll and never overshoots.
    let p = 0;
    for (let i = 0; i < 120; i++) p = easePlayhead(p, 10, 1 / 60);
    expect(p).toBeGreaterThan(9.9);
    expect(p).toBeLessThanOrEqual(10);
    expect(easePlayhead(5, 5, 0.016)).toBe(5);
  });
});

describe("videos", () => {
  it("tells the whole story in 60 seconds, one segment per chapter around its quoted beat", () => {
    const plan = storyVideoPlan(film);
    expect(plan.seconds).toBe(60);
    expect(plan.segments).toHaveLength(12);
    expect(plan.segments[0].t0).toBeGreaterThan(0);
    expect(plan.segments[11].t1).toBeLessThanOrEqual(plan.endAt + 0.001);
    for (let i = 0; i < plan.segments.length; i++) {
      const s = plan.segments[i], ct = film.chapters[i];
      expect(s.chapter).toBe(i);
      const b = ct.beats.find((x) => x.id === CHAPTERS[i].video)!;
      expect(s.from).toBeLessThanOrEqual(b.anim);
      expect(s.to).toBeGreaterThan(b.anim);
      expect(s.to).toBeLessThanOrEqual(ct.anim);
      if (i) expect(s.t0).toBeCloseTo(plan.segments[i - 1].t1, 6);
    }
    // A cut blends into the next chapter.
    const cutAt = plan.segments[3].t1 - plan.cut / 2;
    const f = videoAt(plan, cutAt);
    expect(f.chapter).toBe(3);
    expect(f.next?.chapter).toBe(4);
    expect(f.next!.k).toBeCloseTo(0.5, 6);
    expect(videoAt(plan, 0).chapter).toBe(0);
    expect(videoAt(plan, 59.9).chapter).toBe(11);
  });

  it("plays one chapter at film speed, under a minute", () => {
    for (let i = 0; i < film.chapters.length; i++) {
      const plan = chapterVideoPlan(film, i);
      expect(plan.seconds).toBeLessThanOrEqual(59.0001);
      expect(plan.segments).toHaveLength(1);
      const a = videoAt(plan, 10).anim, b = videoAt(plan, 11).anim;
      expect(b - a).toBeCloseTo(1, 6);
    }
  });
});

describe("camera", () => {
  const keys: Key[] = [
    { t: 0, pos: [0, 0, 10], look: [0, 0, 0], fov: 40 },
    { t: 2, pos: [5, 2, 8], look: [0, 1, 0], fov: 35 },
    { t: 5, pos: [10, 0, 0], look: [0, 0, 0], fov: 50 },
  ];
  it("passes through every key and eases to rest at the ends", () => {
    for (const k of keys) {
      const p = poseOnPath(keys, k.t);
      expect(p.pos[0]).toBeCloseTo(k.pos[0], 6);
      expect(p.pos[2]).toBeCloseTo(k.pos[2], 6);
      expect(p.fov).toBeCloseTo(k.fov, 6);
    }
    expect(poseOnPath(keys, -3).pos).toEqual(keys[0].pos);
    expect(poseOnPath(keys, 9).pos).toEqual(keys[2].pos);
    // Zero velocity at the start: a tiny step moves much less than the average speed.
    const d = Math.abs(poseOnPath(keys, 0.01).pos[0] - 0);
    expect(d).toBeLessThan(0.01);
    // Continuous velocity through the middle key.
    const v1 = (poseOnPath(keys, 2).pos[0] - poseOnPath(keys, 1.999).pos[0]) / 0.001;
    const v2 = (poseOnPath(keys, 2.001).pos[0] - poseOnPath(keys, 2).pos[0]) / 0.001;
    expect(Math.abs(v1 - v2)).toBeLessThan(0.05);
  });

  it("cuts cleanly: a jump between two keys a moment apart never swings the camera off its path", () => {
    const cut: Key[] = [
      { t: 0, pos: [0, 2, 30], look: [0, 2, 0], fov: 40 },
      { t: 4, pos: [0, 2, 20], look: [0, 2, 0], fov: 40 },
      { t: 4.01, pos: [400, 3, 15], look: [400, 4, -12], fov: 46 },
      { t: 9, pos: [398, 2, 4], look: [400, 3, -12], fov: 42 },
    ];
    // Before the cut the camera stays between its own keys (z 30 → 20, x 0).
    for (let t = 0; t <= 4; t += 0.25) {
      const p = poseOnPath(cut, t).pos;
      expect(Math.abs(p[0])).toBeLessThan(1e-6);
      expect(p[2]).toBeLessThanOrEqual(30.0001);
      expect(p[2]).toBeGreaterThanOrEqual(19.9999);
    }
    // After it, near the far side's keys.
    for (let t = 4.01; t <= 9; t += 0.25) {
      const p = poseOnPath(cut, t).pos;
      expect(p[0]).toBeGreaterThan(397);
      expect(p[0]).toBeLessThan(401);
    }
  });

  it("widens the lens for tall screens, never past a fish-eye", () => {
    expect(fovFor(40, 16 / 9)).toBe(40);
    expect(fovFor(40, 2.4)).toBe(40);
    const phone = fovFor(40, 390 / 760);
    expect(phone).toBeGreaterThan(55);
    expect(phone).toBeLessThanOrEqual(88);
    expect(fovFor(40, 9 / 16)).toBeGreaterThan(50);
  });

  it("orbits and zooms within limits that keep the figures facing the camera", () => {
    const pose = { pos: [0, 2, 12] as [number, number, number], look: [0, 2, 0] as [number, number, number], fov: 40 };
    const o = orbitFrom(pose);
    const back = orbitPose(o);
    expect(back.pos[2]).toBeCloseTo(12, 6);
    expect(back.pos[1]).toBeCloseTo(2, 6);
    const far = orbitBy(o, 1e5, 0, 900);
    expect(Math.abs(wrapAngle(far.yaw - DEFAULT_LIMITS.yaw0))).toBeLessThanOrEqual(DEFAULT_LIMITS.yawSpan + 1e-9);
    const up = orbitBy(o, 0, 1e5, 900);
    expect(up.pitch).toBeLessThanOrEqual(DEFAULT_LIMITS.maxPitch);
    expect(zoomBy(o, 2).dist).toBeCloseTo(6, 6);
    expect(zoomBy(o, 1e-9).dist).toBeLessThanOrEqual(DEFAULT_LIMITS.maxDist);
    expect(clampOrbit({ ...o, dist: 0.001 }, DEFAULT_LIMITS).dist).toBe(DEFAULT_LIMITS.minDist);
    expect(wheelFactor(-100, 0, false)).toBeGreaterThan(1);
    expect(wheelFactor(100, 0, false)).toBeLessThan(1);
    expect(wheelFactor(-10, 0, true)).toBeGreaterThan(wheelFactor(-10, 0, false));
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 6);
    const mid = blendPose(pose, { ...pose, fov: 60 }, 0.5);
    expect(mid.fov).toBeCloseTo(50, 6);
  });
});

describe("art", () => {
  it("bleeds edge colours into transparent pixels without touching alpha", () => {
    const w = 4, h = 1;
    const px = new Uint8Array([200, 100, 50, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    bleedEdges(px, w, h, 2);
    expect([px[4], px[5], px[6], px[7]]).toEqual([200, 100, 50, 0]);
    expect([px[8], px[9], px[10], px[11]]).toEqual([200, 100, 50, 0]);
    expect([px[12], px[13], px[14]]).toEqual([0, 0, 0]);
  });
});
