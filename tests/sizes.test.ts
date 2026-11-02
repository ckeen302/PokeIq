import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { EXCLUDED_FORMS, SIZE_BY_KEY, SIZE_FORMS, SIZE_ITEMS, SIZE_POKEMON, SIZE_REFS } from "@/lib/sizes/data";
import { DEFAULT_PRESET, FINALE, HOUSE_M, MILESTONES, PHONE_M, PRESETS, PRESET_BY_ID, STARTER_BASES, compareLineup, presetLineup } from "@/lib/sizes/presets";
import { COMPARE_MAX, COMPARE_PATH, SIZES_PATH, addToCompare, compareOk, comparePath, itemPath, parseVs, presetPath } from "@/lib/sizes/deeplink";
import { bySize, dims, formatFeet, formatMetres, formatSize, fromRow, isLength, layoutLine, measureOf, toRow } from "@/lib/sizes/types";
import { DEFAULT_LENGTH, END_SECONDS, HOOK_SECONDS, LINK_TEXT, MIN_SECONDS, VIDEO_FPS, VIDEO_H, VIDEO_LENGTHS, VIDEO_W, WATERMARK_TEXT, cardAlpha, frameCount, videoFileName, videoSettings, videoTimeline } from "@/lib/sizes/export";
import { Mp4Muxer, aacConfig, readBoxes, type BoxInfo } from "@/lib/sizes/mp4";
import { buildGlide, framer, glideAt, type Lens } from "@/lib/sizes/glide";
import { holdsFor, planPlay, playAt } from "@/lib/sizes/play";
import { BASE_YAW, MAX_ORBIT, ORBIT_LIMIT, finalePose, pitchFor, poseFor } from "@/lib/sizes/camera";
import { DISTRICT_COLORS, RING_M, RING_MAX_TURN, ROOF_Y, STREET, boulevardDistricts, districtAt, inPlaza, planWorld } from "@/lib/sizes/world";
import { FRICTION, MAX_DISTANCE, RATE, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_BUTTON, ZOOM_STEP_KEY, angleDelta, badgeBudget, badgeScaleFor, clampOrbit, clampTilt, clampX, clampZoom, coast, damp, effectiveZoom, exploreView, flightAt, flightSeconds, lookPitch, overviewView, pinchZoom, pitchRange, releaseVelocity, stepIndex, wheelPixels, wheelZoom, zoomAnchorShift, zoomFloorAt, zoomPitch, zoomedDistance } from "@/lib/sizes/explore";
import { compareHook, fold, lineFor, pushCompare, searchItems } from "@/lib/sizes/lineup";
import { factFor, spanFact } from "@/lib/sizes/facts";
import { INTRO_KEY, resetIntroMemory, shouldAutoPlay } from "@/lib/sizes/intro";
import { badgeName, badgeNumber, dexTag } from "@/lib/sizes/badges";
import { buildReliefMesh, distanceField } from "@/lib/sizes/relief";

const item = (key: string) => {
  const i = SIZE_BY_KEY.get(key);
  if (!i) throw new Error(`no ${key}`);
  return i;
};

describe("heights and weights", () => {
  it("every Pokémon's size is its Pokédex height (dm → m) and weight (hg → kg)", () => {
    expect(SIZE_POKEMON).toHaveLength(POKEDEX.length);
    expect(POKEDEX.length).toBe(1025);
    for (const p of POKEDEX) {
      const i = item(p.slug);
      expect(i.kind).toBe("pokemon");
      expect(i.species).toBe(p.id);
      expect(i.m).toBeCloseTo(p.height / 10, 10);
      expect(i.kg).toBeCloseTo(p.weight / 10, 10);
      expect(i.types).toEqual([...p.types]);
      expect(i.min).toBe(false);
    }
  });

  it("forms take their own heights from the form data; Gigantamax is a minimum and Eternamax is 100 m", () => {
    expect(SIZE_FORMS.length).toBeGreaterThan(100);
    for (const f of SIZE_FORMS) {
      const i = item(f.slug);
      expect(i.m).toBeCloseTo(f.height / 10, 10);
      expect(i.art).toBe(f.id);
      expect(i.min).toBe(f.kind === "gmax");
      // Gigantamax and Eternamax weights are not documented: never shown.
      if (f.kind === "gmax" || f.kind === "eternamax") expect(i.kg).toBeNull();
      // Gigantamax and Eternamax heights were cross-checked against a second source.
      if (f.kind === "gmax" || f.kind === "eternamax") expect(f.serebii).toBeCloseTo(f.height / 10, 1);
    }
    expect(item("eternatus-eternamax").m).toBe(100);
    expect(item("eternatus-eternamax").kind).toBe("eternamax");
    expect(item("charizard-gmax").m).toBe(28);
    expect(formatSize(item("charizard-gmax"))).toBe("28 m+ / 91 ft 10 in+");
    expect(item("charizard-mega-x").m).toBe(1.7);
  });

  it("forms whose sources disagree are left out, not guessed", () => {
    expect(EXCLUDED_FORMS.length).toBeGreaterThan(0);
    for (const e of EXCLUDED_FORMS) expect(SIZE_BY_KEY.has(e.slug)).toBe(false);
  });

  it("every figure has its HOME render box and a baked relief map", () => {
    for (const i of SIZE_ITEMS) {
      if (i.kind === "ref") continue;
      expect(i.bs).toBe(512);
      expect(i.bw).toBeGreaterThan(0);
      expect(i.bh).toBeGreaterThan(0);
      expect(existsSync(join(process.cwd(), "public/sizes/depth", `${i.art}.webp`))).toBe(true);
    }
  });

  it("real-world references are documented sizes with a source", () => {
    for (const r of SIZE_REFS) {
      expect(r.m).toBeGreaterThan(0);
      expect(r.source.length).toBeGreaterThan(5);
      expect(r.url).toMatch(/^https:\/\//);
      expect(r.fact.length).toBeGreaterThan(10);
    }
    expect(item("ref-human").m).toBe(1.71);
    expect(item("ref-phone").m).toBe(PHONE_M);
    expect(item("ref-house").m).toBe(HOUSE_M);
  });

  it("the browser builds every lineup exactly as the server does (from the wire rows)", () => {
    const client = SIZE_ITEMS.map((i) => fromRow(toRow(i)));
    for (const p of PRESETS) expect(presetLineup(p, client).map((i) => i.key)).toEqual(presetLineup(p, SIZE_ITEMS).map((i) => i.key));
    expect(presetLineup(DEFAULT_PRESET, client).some((i) => i.key === "ref-phone")).toBe(false);
    expect(lineFor({ preset: "legendaries", vs: [], extra: [] }, client).some((i) => i.key === "ref-phone")).toBe(false);
  });

  it("the wire rows round-trip", () => {
    for (const i of SIZE_ITEMS.slice(0, 200)) {
      const back = fromRow(toRow(i));
      expect({ ...back, ref: undefined }).toEqual({ ...i, ref: undefined });
      expect(back.ref?.kind).toBe(i.ref?.kind);
    }
  });

  it("formats sizes like the Pokédex", () => {
    expect(formatMetres(0.4)).toBe("0.4 m");
    expect(formatMetres(14.5)).toBe("14.5 m");
    expect(formatMetres(100)).toBe("100 m");
    expect(formatMetres(1.71)).toBe("1.71 m");
    expect(formatFeet(0.4)).toBe("1 ft 4 in");
    expect(formatFeet(0.1)).toBe("4 in");
    expect(formatSize(item("pikachu"))).toBe("0.4 m / 1 ft 4 in");
  });
});

describe("the (Length) rule", () => {
  it("only serpentine and fish shapes whose art is wider than tall are measured by length", () => {
    expect(isLength("squiggle", 200, 100)).toBe(true);
    expect(isLength("fish", 200, 100)).toBe(true);
    expect(isLength("squiggle", 100, 200)).toBe(false);
    expect(isLength("quadruped", 300, 100)).toBe(false);
    expect(isLength(null, 300, 100)).toBe(false);
    const shape = new Map(POKEDEX.map((p) => [p.id, p.shape]));
    for (const i of SIZE_ITEMS) {
      if (i.kind === "ref" || !i.length) continue;
      expect(["squiggle", "fish"]).toContain(shape.get(i.species));
      expect(i.bw).toBeGreaterThan(i.bh);
    }
  });

  it("Wailord is 14.5 m long, Onix 8.8 m tall", () => {
    expect(item("wailord").length).toBe(true);
    expect(measureOf(item("wailord"))).toBe("Length");
    expect(item("onix").length).toBe(false);
    expect(measureOf(item("onix"))).toBe("Height");
  });

  it("a length is the longest side, a height the vertical one", () => {
    const w = dims(item("wailord"));
    expect(w.w).toBeCloseTo(14.5, 6);
    expect(w.h).toBeLessThan(14.5);
    const o = dims(item("onix"));
    expect(o.h).toBeCloseTo(8.8, 6);
  });

  it("lays figures out left to right without overlapping", () => {
    const line = presetLineup(PRESET_BY_ID.get("gen-1")!, SIZE_ITEMS);
    const placed = layoutLine(line);
    for (let k = 1; k < placed.length; k++) expect(placed[k].x - placed[k].w / 2).toBeGreaterThan(placed[k - 1].x + placed[k - 1].w / 2);
  });
});

describe("presets", () => {
  const line = (id: string) => presetLineup(PRESET_BY_ID.get(id)!, SIZE_ITEMS);
  const mons = (id: string) => line(id).filter((i) => i.kind !== "ref");

  it("has the eight lineups, each with a hook for videos", () => {
    expect(PRESETS.map((p) => p.id)).toEqual(["every-pokemon", "legendaries", "starters", "eeveelutions", "gen-1", "gigantamax", "bigger-than-a-house", "smaller-than-your-phone"]);
    for (const p of PRESETS) expect(p.hook.length).toBeGreaterThan(8);
    expect(DEFAULT_PRESET.id).toBe("every-pokemon");
  });

  it("Every Pokémon: all 1,025 and Eternamax at the end", () => {
    const l = line("every-pokemon");
    expect(mons("every-pokemon")).toHaveLength(1026);
    expect(l[l.length - 1].key).toBe(FINALE);
    expect(l[0].m).toBe(0.1);
    for (let k = 1; k < l.length; k++) expect(bySize(l[k - 1], l[k])).toBeLessThan(0);
  });

  it("Legendaries & Mythicals, Starters, Eeveelutions, Gen 1 and Gigantamax hold exactly their Pokémon", () => {
    for (const i of mons("legendaries")) expect(i.legendary || i.mythical || i.kind === "eternamax").toBe(true);
    expect(mons("legendaries").length).toBe(POKEDEX.filter((p) => p.legendary || p.mythical).length + 1);
    expect(mons("starters")).toHaveLength(STARTER_BASES.length * 3);
    expect(mons("eeveelutions").map((i) => i.key).sort()).toEqual(["eevee", "espeon", "flareon", "glaceon", "jolteon", "leafeon", "sylveon", "umbreon", "vaporeon"]);
    expect(mons("gen-1")).toHaveLength(151);
    expect(mons("gen-1").every((i) => i.gen === 1 && i.kind === "pokemon")).toBe(true);
    expect(mons("gigantamax").every((i) => i.kind === "gmax" || i.kind === "eternamax")).toBe(true);
    expect(mons("gigantamax").filter((i) => i.kind === "gmax").length).toBe(SIZE_FORMS.filter((f) => f.kind === "gmax").length);
  });

  it("Bigger than a house and Smaller than your phone use the documented thresholds", () => {
    expect(mons("bigger-than-a-house").length).toBeGreaterThan(3);
    expect(mons("bigger-than-a-house").every((i) => i.m > HOUSE_M)).toBe(true);
    expect(mons("smaller-than-your-phone").length).toBeGreaterThan(3);
    expect(mons("smaller-than-your-phone").every((i) => i.m < PHONE_M)).toBe(true);
    expect(line("smaller-than-your-phone").some((i) => i.key === "ref-phone")).toBe(true);
  });

  it("no reference outgrows a line's largest Pokémon, and every line has a familiar scale", () => {
    for (const p of PRESETS) {
      const l = presetLineup(p, SIZE_ITEMS);
      const last = l[l.length - 1];
      const biggest = Math.max(...l.filter((i) => i.kind !== "ref").map((i) => i.m));
      if (p.id === "smaller-than-your-phone") {
        expect(last.key).toBe("ref-phone");
        continue;
      }
      expect(l.some((i) => i.key === "ref-human")).toBe(true);
      for (const r of l.filter((i) => i.kind === "ref" && i.ref?.kind !== "human")) expect(r.m).toBeLessThan(biggest);
      // The line ends on its largest Pokémon, or on the adult human when every Pokémon in it is smaller (Eeveelutions).
      if (biggest > 1.71) expect(last.kind).not.toBe("ref");
      else expect(last.key).toBe("ref-human");
    }
    expect(presetLineup(PRESET_BY_ID.get("starters")!, SIZE_ITEMS).at(-1)!.key).toBe("serperior");
    expect(presetLineup(PRESET_BY_ID.get("gen-1")!, SIZE_ITEMS).at(-1)!.key).toBe("onix");
  });

  it("preset ids and page names never clash with a Pokémon", () => {
    for (const p of PRESETS) expect(SIZE_BY_KEY.has(p.id)).toBe(false);
    expect(SIZE_BY_KEY.has("compare")).toBe(false);
  });

  it("Play pauses on the milestones in the line", () => {
    const placed = layoutLine(line("every-pokemon")).map((p, i) => ({ ...p, key: line("every-pokemon")[i].key }));
    expect(holdsFor(placed)).toEqual([...MILESTONES]);
  });
});

describe("deep links and Compare", () => {
  const known = (k: string) => SIZE_BY_KEY.has(k);
  it("builds the paths", () => {
    expect(presetPath("every-pokemon")).toBe(SIZES_PATH);
    expect(presetPath("legendaries")).toBe("/pokedex/sizes/legendaries");
    expect(itemPath("pikachu")).toBe("/pokedex/sizes/pikachu");
    expect(comparePath(["wailord", "eternatus"])).toBe(`${COMPARE_PATH}?vs=wailord,eternatus`);
  });

  it("reads ?vs= leniently: case, spaces, unknown names and repeats", () => {
    expect(parseVs("wailord,eternatus", known)).toEqual(["wailord", "eternatus"]);
    expect(parseVs("Mr Mime,PIKACHU,pikachu,notamon", known)).toEqual(["mr-mime", "pikachu"]);
    expect(parseVs(new URLSearchParams("vs=wailord%2Ceternatus").get("vs"), known)).toEqual(["wailord", "eternatus"]);
    expect(parseVs("wailord+eternatus|onix", known)).toEqual(["wailord", "eternatus", "onix"]);
    expect(parseVs(null, known)).toEqual([]);
    expect(parseVs("<script>,pikachu", known)).toEqual(["pikachu"]);
  });

  it("compares 2 to 6", () => {
    expect(compareOk(1)).toBe(false);
    expect(compareOk(2)).toBe(true);
    expect(compareOk(6)).toBe(true);
    expect(compareOk(7)).toBe(false);
    const eight = ["pikachu", "eevee", "snorlax", "onix", "wailord", "eternatus", "mew", "ditto"];
    expect(parseVs(eight.join(","), known)).toHaveLength(COMPARE_MAX);
    let keys: string[] = [];
    for (const k of eight) keys = addToCompare(keys, k);
    expect(keys).toEqual(eight.slice(0, 6));
    expect(addToCompare(keys, "pikachu")).toBe(keys);
    let rolling: string[] = [];
    for (const k of eight) rolling = pushCompare(rolling, k);
    expect(rolling).toEqual(eight.slice(2));
  });

  it("a comparison's line is the chosen figures and the human, small to large", () => {
    const l = compareLineup([item("eternatus"), item("wailord")], SIZE_ITEMS);
    expect(l.map((i) => i.key)).toEqual(["ref-human", "wailord", "eternatus"]);
    expect(lineFor({ preset: "starters", vs: ["eternatus", "wailord"], extra: [] }, SIZE_ITEMS).map((i) => i.key)).toEqual(["ref-human", "wailord", "eternatus"]);
    expect(compareHook(l)).toBe("Wailord vs Eternatus 😳");
  });

  it("a form opened by link joins the line it isn't part of", () => {
    const l = lineFor({ preset: "every-pokemon", vs: [], extra: ["charizard-gmax"] }, SIZE_ITEMS);
    expect(l.some((i) => i.key === "charizard-gmax")).toBe(true);
    expect(l.length).toBe(presetLineup(DEFAULT_PRESET, SIZE_ITEMS).length + 1);
  });

  it("search finds names (accents folded), Dex numbers and forms after their species", () => {
    expect(searchItems(SIZE_ITEMS, "pikachu")[0].key).toBe("pikachu");
    expect(searchItems(SIZE_ITEMS, "#25")[0].key).toBe("pikachu");
    expect(searchItems(SIZE_ITEMS, "flabebe")[0].key).toBe("flabebe");
    expect(fold("Flabébé")).toBe("flabebe");
    const zard = searchItems(SIZE_ITEMS, "charizard");
    expect(zard[0].key).toBe("charizard");
    expect(zard.some((i) => i.key === "charizard-gmax")).toBe(true);
    expect(searchItems(SIZE_ITEMS, "human")).toHaveLength(0);
    expect(searchItems(SIZE_ITEMS, "  ")).toHaveLength(0);
  });
});

describe("Make a video: export settings", () => {
  it("is a vertical 9:16 1080 × 1920 video in 15, 30 or 60 seconds", () => {
    expect([VIDEO_W, VIDEO_H]).toEqual([1080, 1920]);
    expect(VIDEO_W / VIDEO_H).toBeCloseTo(9 / 16, 10);
    expect([...VIDEO_LENGTHS]).toEqual([15, 30, 60]);
    expect(DEFAULT_LENGTH).toBe(30);
    const v = videoSettings(30, "Every Pokémon by size 😳");
    expect(v).toMatchObject({ width: 1080, height: 1920, fps: VIDEO_FPS, seconds: 30, hook: "Every Pokémon by size 😳" });
    expect(frameCount(v)).toBe(900);
    expect(v.bitrate).toBeGreaterThanOrEqual(6_000_000);
  });

  it("carries the watermark and the end card's link to the public site", () => {
    const v = videoSettings(15, "hook");
    expect(v.watermark).toBe(WATERMARK_TEXT);
    expect(WATERMARK_TEXT).toBe("PokéIQ");
    expect(v.endLink).toBe(LINK_TEXT);
    expect(LINK_TEXT).toBe("pokeiq.vercel.app/pokedex/sizes");
  });

  it("clamps custom lengths and names the file", () => {
    expect(videoSettings(5, "h").seconds).toBe(5);
    expect(videoSettings(1, "h").seconds).toBe(MIN_SECONDS);
    expect(videoSettings(600, "h").seconds).toBe(60);
    expect(videoFileName("Wailord vs Eternatus!", 15, "mp4")).toBe("pokeiq-sizes-wailord-vs-eternatus-15s.mp4");
    expect(videoFileName("", 30, "webm")).toBe("pokeiq-sizes-lineup-30s.webm");
  });

  it("opens on the hook card and closes on the end card, shorter in short videos", () => {
    const tl = videoTimeline(30);
    expect(tl.hook).toBeCloseTo(HOOK_SECONDS, 6);
    expect(tl.end).toBeCloseTo(END_SECONDS, 6);
    expect(videoTimeline(5).hook).toBeLessThan(tl.hook);
    expect(cardAlpha(0.1, -1, tl.hook)).toBeGreaterThan(0.9);
    expect(cardAlpha(tl.hook + 0.1, -1, tl.hook)).toBe(0);
    expect(cardAlpha(29.9, 30 - tl.end, 31)).toBeGreaterThan(0.9);
  });
});

describe("the MP4 muxer", () => {
  // A minimal avcC record (High profile, level 4.0) with one SPS and one PPS.
  const avcc = new Uint8Array([1, 0x64, 0, 0x28, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x28, 1, 0, 2, 0x68, 0xee]);
  const find = (boxes: BoxInfo[], type: string): BoxInfo[] => boxes.flatMap((b) => [...(b.type === type ? [b] : []), ...find(b.children ?? [], type)]);

  it("writes a fast-start file: ftyp, moov (video and audio tracks), mdat", () => {
    const mux = new Mp4Muxer({ width: 1080, height: 1920, description: avcc }, { codec: "opus", sampleRate: 48000, channels: 2 });
    const fps = 30;
    for (let i = 0; i < 60; i++) mux.addVideo(new Uint8Array([0, 0, 0, 1, i]), Math.round((i * 1e6) / fps), Math.round(1e6 / fps), i % 30 === 0);
    for (let i = 0; i < 100; i++) mux.addAudio(new Uint8Array([i]), i * 20000, 20000);
    const file = mux.finalize();
    const top = readBoxes(file);
    expect(top.map((b) => b.type)).toEqual(["ftyp", "moov", "mdat"]);
    expect(top[2].start + top[2].size).toBe(file.length);
    expect(find(top, "trak")).toHaveLength(2);
    expect(find(top, "stss")).toHaveLength(1);
    // Movie duration (mvhd, timescale 1000): two seconds.
    const mvhd = find(top, "mvhd")[0];
    const v = new DataView(file.buffer, file.byteOffset + mvhd.start);
    expect(v.getUint32(20)).toBe(1000);
    expect(v.getUint32(24)).toBe(2000);
    // The sample entry is H.264 at the video's size.
    const text = new TextDecoder("latin1").decode(file.subarray(0, top[1].start + top[1].size));
    expect(text).toContain("avc1");
    expect(text).toContain("avcC");
    expect(text).toContain("Opus");
  });

  it("needs a key frame first and some video", () => {
    const mux = new Mp4Muxer({ width: 2, height: 2, description: avcc });
    expect(() => mux.addVideo(new Uint8Array([1]), 0, 33333, false)).toThrow();
    expect(() => new Mp4Muxer({ width: 2, height: 2, description: avcc }).finalize()).toThrow();
  });

  it("describes AAC-LC for the sample rate", () => {
    expect([...aacConfig(48000, 2)]).toEqual([0x11, 0x90]);
    expect([...aacConfig(44100, 2)]).toEqual([0x12, 0x10]);
  });
});

describe("the camera: Play, Explore and the finale", () => {
  const lens: Lens = { vfov: 35, aspect: 16 / 9 };
  const every = presetLineup(DEFAULT_PRESET, SIZE_ITEMS);
  const placed = layoutLine(every).map((p, i) => ({ ...p, key: every[i].key }));

  it("glides small to large, deterministically, pausing on the milestones and ending on the finale", () => {
    const plan = planPlay(placed, lens, { duration: 60 });
    const keys = plan.glide.stops.map((s) => s.key);
    expect(keys).toEqual([...MILESTONES, FINALE]);
    expect(plan.glide.stops[plan.glide.stops.length - 1].finale).toBe(true);
    let lastX = -Infinity;
    for (let t = 0; t <= 60; t += 0.25) {
      const a = glideAt(plan.glide, t);
      expect(a.x).toBeGreaterThanOrEqual(lastX - 1e-9);
      lastX = a.x;
      expect(glideAt(plan.glide, t)).toEqual(a);
    }
    expect(glideAt(plan.glide, 60.01).done).toBe(true);
    // The camera rises and pulls back as sizes grow.
    expect(glideAt(plan.glide, 59).d).toBeGreaterThan(glideAt(plan.glide, 1).d * 50);
  });

  it("frames the figure it holds on", () => {
    const fr = framer(placed, lens);
    const plan = buildGlide(placed, fr, lens, { duration: 30, holds: ["pikachu"] });
    const stop = plan.stops[0];
    const at = glideAt(plan, (stop.t0 + stop.t1) / 2);
    expect(at.holding).toBe("pikachu");
    expect(at.x).toBeCloseTo(placed.find((p) => p.key === "pikachu")!.x, 6);
    const pf = playAt(planPlay(placed, lens, { duration: 30 }), 0.1, () => 0.1);
    expect(pf.focus).toBe(placed[0].key);
  });

  it("the finale rises over the rooftops to reveal the city, inside the relief-safe angle", () => {
    const v = { x: 1000, d: 320, h: 100, orbit: 0, pitch: pitchFor(100), rise: 1 };
    const f = finalePose(v);
    expect(f.position[1]).toBeGreaterThan(ROOF_Y + 20);
    expect(f.position[1]).toBeGreaterThan(v.h);
    const yaw = Math.atan2(f.target[0] - f.position[0], f.target[2] - f.position[2]);
    expect(Math.abs(yaw - BASE_YAW)).toBeLessThanOrEqual(MAX_ORBIT);
    // From above, but still nearly face on: never more than about 20° down onto the relief figures.
    const horiz = Math.hypot(f.target[0] - f.position[0], f.target[2] - f.position[2]);
    expect(Math.atan2(f.position[1] - f.target[1], horiz)).toBeLessThan((20 * Math.PI) / 180);
    expect(poseFor(v)).toEqual(f);
    const side = poseFor({ ...v, rise: 0 });
    expect(side.position).not.toEqual(f.position);
    // A small finale doesn't fly off into the sky.
    const small = finalePose({ x: 10, d: 4, h: 1.5, orbit: 0, pitch: pitchFor(1.5), rise: 1 });
    expect(small.position[1]).toBeLessThan(6);
  });

  it("the line walks down the boulevard into the plaza, and the big figures stand round Prism Tower", () => {
    const plan = planWorld(placed);
    const ring = plan.ring!;
    expect(ring).not.toBeNull();
    // Prism Tower stands at the plaza's centre, behind the line (away from the camera).
    expect(plan.tower).toEqual({ x: plan.plaza.cx, z: plan.plaza.cz });
    expect(plan.tower.z).toBeGreaterThan(0);
    // The path is continuous: straight down the boulevard, then on round the ring without a kink.
    const a = plan.path.at(ring.s0 - 1e-6), b = plan.path.at(ring.s0 + 1e-6);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(1e-4);
    expect(Math.abs(a.heading - b.heading)).toBeLessThan(1e-4);
    expect(plan.path.at(ring.s0 - 500)).toEqual({ x: ring.s0 - 500, z: 0, heading: 0 });
    let walls = 0;
    for (const p of placed) {
      const at = plan.path.at(p.x);
      if (Math.max(p.h, p.w) >= RING_M) {
        // Every big figure is on the ring round the tower, inside the plaza, and the ring never turns past the sun.
        expect(Math.abs(Math.hypot(at.x - plan.tower.x, at.z - plan.tower.z) - ring.r)).toBeLessThan(1e-6);
        expect(inPlaza(plan, at.x, at.z)).toBe(true);
        expect(at.heading).toBeLessThanOrEqual(RING_MAX_TURN + 1e-9);
        // Outside the ring the camera has the tower behind the figure.
        const pose = poseFor({ x: p.x, d: Math.max(5, p.h * 2.5), h: p.h, orbit: 0, pitch: pitchFor(p.h), rise: 0 }, plan.path);
        const camToTower = Math.hypot(pose.position[0] - plan.tower.x, pose.position[2] - plan.tower.z);
        expect(camToTower).toBeGreaterThan(ring.r);
        const fx = pose.target[0] - pose.position[0], fz = pose.target[2] - pose.position[2];
        expect(fx * (plan.tower.x - pose.position[0]) + fz * (plan.tower.z - pose.position[2])).toBeGreaterThan(0);
      } else if (at.x < plan.x1) {
        // The rest stand down the middle of the boulevard.
        expect(at.z).toBe(0);
        walls++;
      }
    }
    expect(walls).toBeGreaterThan(placed.length * 0.8);
    // Five districts round the tower, each with its own colour plaza out in the city, and the boulevard between two of them.
    expect(plan.districts.map((d) => d.name)).toEqual(DISTRICT_COLORS.map((d) => d.name));
    for (const d of plan.districts) {
      expect(inPlaza(plan, d.plaza.x, d.plaza.z)).toBe(false);
      expect(districtAt(plan, d.plaza.x, d.plaza.z)).toBe(d);
      expect(Math.abs(d.plaza.z)).toBeGreaterThan(STREET.facade + STREET.depth + d.plaza.r);
    }
    const { far, near } = boulevardDistricts(plan);
    expect(far).not.toBe(near);
    // Lines without big figures stay straight on the boulevard, the plaza just past their end.
    const starters = layoutLine(presetLineup(PRESET_BY_ID.get("starters")!, SIZE_ITEMS));
    const sp = planWorld(starters);
    expect(sp.ring).toBeNull();
    expect(sp.x1).toBeGreaterThan(starters[starters.length - 1].x);
  });

  it("Explore: flights ease from one figure to the next and stay on the line", () => {
    const f = { from: 0, to: 10, t0: 1, dur: 2 };
    expect(flightAt(f, 1).x).toBe(0);
    expect(flightAt(f, 2).x).toBeCloseTo(5, 6);
    expect(flightAt(f, 3)).toEqual({ x: 10, done: true });
    expect(flightSeconds(0, 1, 10)).toBeGreaterThanOrEqual(1);
    expect(flightSeconds(0, 1e6, 1)).toBeLessThanOrEqual(3.2);
    expect(stepIndex(0, -1, 10)).toBe(0);
    expect(stepIndex(9, 10, 10)).toBe(9);
    expect(clampX(-1e9, placed[0], placed[placed.length - 1])).toBeGreaterThan(-1e3);
  });

  it("Compare's overview frames every figure", () => {
    const l = compareLineup([item("wailord"), item("eternatus")], SIZE_ITEMS);
    const p = layoutLine(l).map((q, i) => ({ ...q, key: l[i].key }));
    const v = overviewView(p, lens);
    const half = v.d * Math.tan((lens.vfov * Math.PI) / 360) * lens.aspect;
    expect(v.x - half).toBeLessThan(p[0].x - p[0].w / 2);
    expect(v.x + half).toBeGreaterThan(p[p.length - 1].x + p[p.length - 1].w / 2);
  });
});

describe("badges and captions", () => {
  it("draws the game-style numbers and names", () => {
    expect(badgeNumber(3.8, false)).toBe("3.8");
    expect(badgeNumber(100, false)).toBe("100");
    expect(badgeNumber(28, true)).toBe("28+");
    expect(badgeName("Ho-Oh")).toBe("HO OH");
    expect(dexTag(250)).toBe("#0250");
  });

  it("fun facts come from the documented numbers", () => {
    const every = presetLineup(DEFAULT_PRESET, SIZE_ITEMS);
    expect(factFor(item("snorlax"), every)).toBe("Snorlax weighs 460 kg (1,014 lb)");
    expect(factFor(item("onix"), every)).toBe("Onix is 1.4× the size of a two-storey house");
    expect(factFor(item("wailord"), every)).toBe("Wailord is 8.5× as long as an adult human");
    expect(factFor(item("pikachu"), every)).toBe("You are 4.3× as tall as Pikachu");
    expect(factFor(item("eternatus-eternamax"), every)).toMatch(/^Eternamax Eternatus is 3\.2× the size of a 10-storey building$/);
    expect(spanFact(every)).toBe("Eternamax Eternatus is 1,000× the size of Joltik");
    for (const i of every) expect(factFor(i, every) ?? "").not.toMatch(/NaN|Infinity|undefined/);
  });
});

describe("first visit", () => {
  it("auto-plays once, never on a shared link or with reduced motion", () => {
    resetIntroMemory();
    const store = new Map<string, string>();
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(shouldAutoPlay({ store: s, reducedMotion: false, deepLink: true })).toBe(false);
    expect(shouldAutoPlay({ store: s, reducedMotion: true, deepLink: false })).toBe(false);
    expect(shouldAutoPlay({ store: s, reducedMotion: false, deepLink: false })).toBe(true);
    store.set(INTRO_KEY, "1");
    expect(shouldAutoPlay({ store: s, reducedMotion: false, deepLink: false })).toBe(false);
    resetIntroMemory();
  });
});

describe("relief figures", () => {
  it("measures distance to the outline", () => {
    const w = 9, h = 9;
    const mask = new Uint8Array(w * h);
    for (let y = 1; y < 8; y++) for (let x = 1; x < 8; x++) mask[y * w + x] = 1;
    const d = distanceField(mask, w, h);
    expect(d[0]).toBe(0);
    expect(d[4 * w + 4]).toBeCloseTo(4, 5);
    expect(d[1 * w + 4]).toBeCloseTo(1, 5);
  });

  it("builds a closed two-sided mesh over the covered cells only", () => {
    const n = 16;
    const data = new Uint8Array(n * n * 3);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const inside = Math.hypot(x - 7.5, y - 7.5) < 6;
        data[(y * n + x) * 3] = inside ? 150 : 128;
        data[(y * n + x) * 3 + 1] = inside ? 106 : 128;
        data[(y * n + x) * 3 + 2] = inside ? 255 : 0;
      }
    }
    const m = buildReliefMesh({ w: n, h: n, data, channels: 3 }, { x: 0, y: 0, w: 100, h: 100, size: 100 }, 16);
    expect(m.index.length % 12).toBe(0);
    expect(m.index.length).toBeGreaterThan(0);
    expect(m.position.length / 3).toBeLessThan(17 * 17 * 2);
    expect(m.zMax).toBeGreaterThan(m.zMin);
    expect(m.height).toBe(1);
  });
});

describe("badge layout", () => {
  it("keeps every badge inside the frame, shrinking long names on narrow frames", async () => {
    const { layoutBadges } = await import("@/lib/sizes/badges");
    const measure = (t: string, px: number) => t.length * px * 0.62;
    const info = { name: "Eternamax Eternatus", dex: 890, kind: "eternamax" as const, m: 100, length: false, min: false, types: ["poison", "dragon"] };
    for (const frame of [{ w: 1080, h: 1920 }, { w: 390, h: 700 }, { w: 1440, h: 900 }]) {
      const placed = layoutBadges([{ key: "e", x: frame.w * 0.9, y: frame.h * 0.4, sh: frame.h * 0.5, info, focus: true }], { ...frame, top: 0, bottom: 0 }, measure, { max: 3, minSh: 10, scale: 1.2 });
      expect(placed).toHaveLength(1);
      expect(placed[0].x).toBeGreaterThanOrEqual(0);
      expect(placed[0].x + placed[0].w).toBeLessThanOrEqual(frame.w);
    }
    // A close-up taller than the view: its badge takes a top corner, off the figure's face.
    const tall = layoutBadges([{ key: "p", x: 720, y: -400, sh: 2000, info, focus: true }], { w: 1440, h: 900, top: 72, bottom: 104 }, measure, { max: 3, minSh: 10, scale: 1 });
    expect(tall[0].x).toBeLessThan(tall[0].s);
    expect(tall[0].y).toBeGreaterThanOrEqual(72);
    const short = layoutBadges([{ key: "p", x: 720, y: -400, sh: 2000, info: { ...info, name: "Pikachu", types: ["electric"] }, focus: true }], { w: 1440, h: 900, top: 72, bottom: 104 }, measure, { max: 3, minSh: 10, scale: 1 });
    expect(short[0].x + short[0].w).toBeLessThan(720);
  });
});

describe("Explore: zoom, tilt, orbit and motion", () => {
  const lens: Lens = { vfov: 35, aspect: 16 / 9 };
  const every = presetLineup(DEFAULT_PRESET, SIZE_ITEMS);
  const placed = layoutLine(every).map((p, i) => ({ ...p, key: every[i].key }));
  const fr = framer(placed, lens);
  const heights = new Map(placed.map((p) => [p.x, p.h]));
  const heightAt = (x: number) => heights.get(x) ?? 1;
  const tanHalf = Math.tan((lens.vfov * Math.PI) / 360);

  it("damping is frame-rate independent and settles on the target", () => {
    let a = 0, b = 0, c = 0;
    for (let i = 0; i < 120; i++) a = damp(a, 10, RATE.zoom, 1 / 120);
    for (let i = 0; i < 30; i++) b = damp(b, 10, RATE.zoom, 1 / 30);
    c = damp(c, 10, RATE.zoom, 1);
    expect(a).toBeCloseTo(b, 9);
    expect(a).toBeCloseTo(c, 9);
    expect(damp(3, 10, RATE.x, 0)).toBe(3);
    expect(damp(0, 10, RATE.x, 5)).toBeCloseTo(10, 6);
  });

  it("a flick coasts the same distance at any frame rate, and stops", () => {
    const run = (fps: number) => {
      let s = { target: 0, vel: 6 };
      for (let i = 0; i < fps * 5; i++) s = coast(s.target, s.vel, FRICTION.x, 1 / fps);
      return s;
    };
    const a = run(30), b = run(144);
    expect(a.target).toBeCloseTo(b.target, 6);
    expect(a.target).toBeCloseTo(6 / FRICTION.x, 2);
    expect(Math.abs(a.vel)).toBeLessThan(1e-3);
    // The release speed comes from the last moments of the drag, not a pointer that had already stopped.
    const samples = [0, 16, 32, 48, 64].map((t) => ({ t, v: t * 0.01 }));
    expect(releaseVelocity(samples, 70)).toBeCloseTo(10, 6);
    expect(releaseVelocity(samples, 400)).toBe(0);
  });

  it("zoom multiplies the automatic framing, within its range, and the distance cap holds over the giants", () => {
    expect(zoomedDistance(4, 1)).toBe(4);
    expect(zoomedDistance(4, 2)).toBeCloseTo(2, 9);
    expect(zoomedDistance(4, 100)).toBeCloseTo(4 / ZOOM_MAX, 9);
    expect(zoomedDistance(4, 0)).toBeCloseTo(4 / ZOOM_MIN, 9);
    expect(zoomedDistance(300, ZOOM_MIN)).toBe(MAX_DISTANCE);
    expect(zoomedDistance(900, 0.5)).toBe(900);
    expect(effectiveZoom(4, zoomedDistance(4, 0.25))).toBeCloseTo(0.25, 9);
    expect(zoomFloorAt(300)).toBeCloseTo(300 / MAX_DISTANCE, 9);
    expect(zoomFloorAt(1)).toBe(ZOOM_MIN);
    expect(clampZoom(NaN)).toBe(1);
  });

  it("zoomed in, a 10 cm Pokémon overfills the frame; zoomed out, dozens of figures share it", () => {
    const tiny = placed[0];
    expect(tiny.h).toBeLessThanOrEqual(0.12);
    const close = exploreView(tiny.x, fr, heightAt, { zoom: ZOOM_MAX, tilt: 0, orbit: 0 });
    expect(tiny.h / (2 * close.d * tanHalf)).toBeGreaterThan(1);
    const mid = placed.find((p) => p.key === "pikachu")!;
    const wide = exploreView(mid.x, fr, heightAt, { zoom: ZOOM_MIN, tilt: 0, orbit: 0 });
    const halfW = wide.d * tanHalf * lens.aspect;
    const inFrame = placed.filter((p) => Math.abs(p.x - mid.x) < halfW).length;
    expect(inFrame).toBeGreaterThanOrEqual(24);
  });

  it("the automatic framing is unchanged at the default look", () => {
    const p = placed[300];
    const v = exploreView(p.x, fr, heightAt);
    expect(v.d).toBeCloseTo(fr.at(p.x), 9);
    expect(v.pitch).toBeCloseTo(pitchFor(p.h), 9);
    expect(v.orbit).toBe(0);
    expect(zoomPitch(1)).toBe(0);
    expect(zoomPitch(2)).toBe(0);
  });

  it("tilt stays inside what the relief figures can take, and pulling back looks down on the crowd", () => {
    for (const zoom of [ZOOM_MAX, 1, 0.3, 0.1, ZOOM_MIN]) {
      const [lo, hi] = pitchRange(zoom);
      expect(lo).toBeLessThan(hi);
      for (const tilt of [-5, -0.2, 0, 0.2, 5]) {
        const p = lookPitch(1.5, zoom, tilt);
        expect(p).toBeGreaterThanOrEqual(lo - 1e-12);
        expect(p).toBeLessThanOrEqual(hi + 1e-12);
        expect(lookPitch(1.5, zoom, clampTilt(tilt, 1.5, zoom))).toBeCloseTo(p, 9);
      }
    }
    // Up close never more than about 32° from above, nor more than a little from below.
    expect(pitchRange(1)[1]).toBeLessThanOrEqual(0.57);
    expect(pitchRange(1)[0]).toBeGreaterThanOrEqual(-0.11);
    expect(zoomPitch(ZOOM_MIN)).toBeGreaterThan(0.4);
    expect(lookPitch(1.5, ZOOM_MIN, 0)).toBeGreaterThan(lookPitch(1.5, 1, 0));
  });

  it("the camera never sinks into the pavement, and pulled back it looks over the rooftops", () => {
    for (const p of [placed[0], ...["pikachu", "snorlax", "gyarados", "wailord"].map((k) => placed.find((q) => q.key === k)!)]) {
      for (const zoom of [ZOOM_MAX, 1, 0.7, 0.4, 0.3, 0.2, 0.1, 0.06, ZOOM_MIN]) {
        for (const tilt of [-5, 0, 5]) {
          for (const orbit of [-1, 0, 1]) {
            const v = exploreView(p.x, fr, heightAt, { zoom, tilt, orbit });
            const pose = poseFor(v);
            expect(pose.position[1]).toBeGreaterThan(0);
            // Zoomed out behind the near facades, the sight line passes over their roofs.
            const z = Math.abs(pose.position[2]);
            if (zoom <= 0.4 && z > STREET.facade) {
              const atFacade = pose.target[1] + (pose.position[1] - pose.target[1]) * (STREET.facade / z);
              expect(atFacade).toBeGreaterThan(ROOF_Y);
            }
          }
        }
      }
    }
  });

  it("orbit is a modest turn either way, and the rig holds it there", () => {
    expect(ORBIT_LIMIT).toBeGreaterThanOrEqual(MAX_ORBIT);
    expect(ORBIT_LIMIT).toBeLessThanOrEqual((30 * Math.PI) / 180);
    expect(clampOrbit(9)).toBe(ORBIT_LIMIT);
    expect(clampOrbit(-9)).toBe(-ORBIT_LIMIT);
    const v = { x: 10, d: 5, h: 1, orbit: 3, pitch: 0.05, rise: 0 };
    const pose = poseFor(v);
    const yaw = Math.atan2(pose.target[0] - pose.position[0], pose.target[2] - pose.position[2]);
    expect(yaw - BASE_YAW).toBeCloseTo(ORBIT_LIMIT, 6);
  });

  it("maps wheels, pinches and keys to zoom steps", () => {
    // Scrolling up zooms in, about 16% a mouse notch; a trackpad pinch (ctrl + wheel) is more sensitive.
    expect(Math.exp(wheelZoom(-100, false))).toBeCloseTo(1.16, 2);
    expect(wheelZoom(100, false)).toBeLessThan(0);
    expect(Math.abs(wheelZoom(10, true))).toBeGreaterThan(Math.abs(wheelZoom(10, false)));
    expect(wheelPixels(3, 1, 900)).toBe(48);
    expect(wheelPixels(5000, 0, 900)).toBe(240);
    expect(Math.exp(ZOOM_STEP_KEY)).toBeGreaterThan(1.2);
    expect(Math.exp(ZOOM_STEP_BUTTON)).toBeGreaterThan(Math.exp(ZOOM_STEP_KEY));
    // A pinch follows the fingers' spread; a twist's angle wraps the short way round.
    expect(pinchZoom(0, 100, 200)).toBeCloseTo(Math.log(2), 9);
    expect(angleDelta(3.1, -3.1)).toBeCloseTo(2 * Math.PI - 6.2, 9);
    // Zooming in towards a point right of centre moves the camera's point that way; at the centre it stays.
    expect(zoomAnchorShift(300, 1440, 5, 1.5, lens)).toBeGreaterThan(0);
    expect(zoomAnchorShift(0, 1440, 5, 1.5, lens)).toBe(0);
    expect(zoomAnchorShift(300, 1440, 5, 1 / 1.5, lens)).toBeLessThan(0);
  });

  it("badges thin out and shrink as the view widens, and shrink up close", () => {
    expect(badgeBudget(1, false)).toBe(4);
    expect(badgeBudget(1, true)).toBe(2);
    expect(badgeBudget(ZOOM_MIN, false)).toBe(1);
    let lastN = Infinity;
    for (const z of [2, 1, 0.5, 0.2, 0.1, ZOOM_MIN]) {
      const n = badgeBudget(z, false);
      expect(n).toBeLessThanOrEqual(lastN);
      lastN = n;
    }
    expect(badgeScaleFor(1)).toBe(1);
    expect(badgeScaleFor(ZOOM_MIN)).toBeCloseTo(0.7, 6);
    expect(badgeScaleFor(ZOOM_MAX)).toBeCloseTo(0.7, 6);
    expect(badgeScaleFor(1.5)).toBeLessThan(1);
  });
});
