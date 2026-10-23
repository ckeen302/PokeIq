import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { FACTS } from "@/lib/connections/facts";
import type { CustomGroupInput } from "@/lib/connections/custom";
import {
  CUSTOM_DAILY_LIMIT,
  analyzeCustom,
  checkCustom,
  clearMemoryCustom,
  customView,
  getCustom,
  listCustom,
  memoryCustomStore,
  metaOf,
  publishCustom,
  searchPokemon,
  validateCustom,
  voteCustom,
} from "@/lib/server/connections-custom";
import { GET as getConnections, POST as postConnections } from "@/app/api/connections/route";
import { GET as getList, POST as postCreate } from "@/app/api/connections/custom/route";
import { GET as getMeta, POST as postVote } from "@/app/api/connections/custom/[id]/route";

const id = (name: string) => {
  const f = FACTS.find((x) => x.name === name);
  if (!f) throw new Error(name);
  return f.id;
};
const ids = (...names: string[]) => names.map(id);

/** Sixteen Pokémon from sixteen families. */
const GROUPS = (): CustomGroupInput[] => [
  { name: "Sleepy and lazy", level: 0, members: ids("Snorlax", "Psyduck", "Slowpoke", "Drowzee") },
  { name: "Pays attention", level: 1, members: ids("Meowth", "Abra", "Pikachu", "Eevee") },
  { name: "Rocky road", level: 2, members: ids("Onix", "Geodude", "Machop", "Zubat") },
  { name: "Odd ones out", level: 3, members: ids("Ditto", "Mewtwo", "Lugia", "Magikarp") },
];
const bad = (...parts: string[]) => parts.join("");

describe("validating a creator's puzzle", () => {
  it("accepts four named, coloured groups of four", () => {
    expect(validateCustom({ groups: GROUPS() })).toEqual([]);
  });

  it("blocks wrong counts", () => {
    const three = GROUPS().slice(0, 3);
    expect(validateCustom({ groups: three })[0]).toMatch(/Make 4 groups/);
    const short = GROUPS();
    short[1].members.pop();
    expect(validateCustom({ groups: short }).join(" ")).toMatch(/Group 2 needs exactly 4/);
    const long = GROUPS();
    long[0].members.push(id("Mew"));
    expect(validateCustom({ groups: long }).join(" ")).toMatch(/Group 1 needs exactly 4/);
  });

  it("blocks a Pokémon twice, repeated colours and names, and unknown Pokémon", () => {
    const twice = GROUPS();
    twice[1].members[0] = twice[0].members[0];
    expect(validateCustom({ groups: twice }).join(" ")).toMatch(/Snorlax is in the puzzle twice/);
    const colours = GROUPS();
    colours[1].level = 0;
    expect(validateCustom({ groups: colours }).join(" ")).toMatch(/own colour/);
    const names = GROUPS();
    names[1].name = " sleepy AND lazy ";
    expect(validateCustom({ groups: names }).join(" ")).toMatch(/same name/);
    const unknown = GROUPS();
    unknown[2].members[0] = 99999;
    expect(validateCustom({ groups: unknown }).join(" ")).toMatch(/doesn't exist/);
  });

  it("runs group names and the title through the profanity filter", () => {
    const g = GROUPS();
    g[3].name = bad("f", "uck", " this");
    expect(validateCustom({ groups: g }).join(" ")).toMatch(/Group 4's name isn't allowed/);
    expect(validateCustom({ title: bad("sh", "it"), groups: GROUPS() }).join(" ")).toMatch(/title/);
    const empty = GROUPS();
    empty[0].name = "   ";
    expect(validateCustom({ groups: empty }).join(" ")).toMatch(/needs a name/);
  });

  it("warns, from the computed categories, when a tile fits another group", () => {
    // Four Fire types, and a fifth Pokémon elsewhere that is Fire too.
    const g: CustomGroupInput[] = [
      { name: "Hot stuff", level: 0, members: ids("Charmander", "Vulpix", "Growlithe", "Magmar") },
      { name: "Other", level: 1, members: ids("Pikachu", "Eevee", "Ponyta", "Abra") },
      { name: "Rocks", level: 2, members: ids("Onix", "Geodude", "Machop", "Zubat") },
      { name: "Odd ones out", level: 3, members: ids("Ditto", "Mewtwo", "Lugia", "Magikarp") },
    ];
    expect(validateCustom({ groups: g })).toEqual([]);
    expect(analyzeCustom(g).join(" ")).toMatch(/Ponyta \(in “Other”\) also fits “Hot stuff”/);
    // All sixteen debuted in Gen 1, so a group of four Gen 1 Pokémon fits everywhere: a real warning.
    expect(analyzeCustom(GROUPS()).join(" ")).toMatch(/Debuted in Gen 1/);
  });

  it("searches names for the picker", () => {
    expect(searchPokemon("pikac").map((r) => r.name)).toContain("Pikachu");
    expect(searchPokemon("p")).toEqual([]);
  });
});

describe("publishing and playing", () => {
  beforeEach(() => {
    clearMemoryCustom();
    process.env.POKEIQ_LOCAL_ACCOUNTS = "1";
  });

  it("stores a puzzle under a short id and credits the creator", async () => {
    const store = memoryCustomStore();
    const out = await publishCustom({ groups: GROUPS(), identity: "d:aaaaaaaaaaaaaaaaaaaa", creatorName: "Ash", title: "Mine" }, store);
    expect(out.ok && out.id).toMatch(/^[a-z0-9]{8}$/);
    const p = (await getCustom((out as { id: string }).id, store))!;
    expect(p.creatorName).toBe("Ash");
    expect(p.creatorKey).not.toContain("aaaaaaaaaaaaaaaaaaaa");
    expect(new Set(p.tiles).size).toBe(16);
  });

  it("rejects an invalid puzzle and is off without a store", async () => {
    const store = memoryCustomStore();
    const g = GROUPS();
    g[0].members.pop();
    expect(await publishCustom({ groups: g, identity: "d:aaaaaaaaaaaaaaaaaaaa" }, store)).toMatchObject({ ok: false, status: 400 });
    expect(await publishCustom({ groups: GROUPS(), identity: "d:aaaaaaaaaaaaaaaaaaaa" }, null)).toMatchObject({ ok: false, status: 503 });
  });

  it("caps how many a creator publishes a day", async () => {
    const store = memoryCustomStore();
    for (let i = 0; i < CUSTOM_DAILY_LIMIT; i++) expect((await publishCustom({ groups: GROUPS(), identity: "d:bbbbbbbbbbbbbbbbbbbb" }, store)).ok).toBe(true);
    expect(await publishCustom({ groups: GROUPS(), identity: "d:bbbbbbbbbbbbbbbbbbbb" }, store)).toMatchObject({ ok: false, status: 429 });
    expect((await publishCustom({ groups: GROUPS(), identity: "d:cccccccccccccccccccc" }, store)).ok).toBe(true);
  });

  it("checks answers on the server and reveals groups only as they're found", async () => {
    const store = memoryCustomStore();
    const out = (await publishCustom({ groups: GROUPS(), identity: "d:aaaaaaaaaaaaaaaaaaaa", creatorName: "Ash" }, store)) as { id: string };
    const p = (await getCustom(out.id, store))!;
    const [yellow, green] = GROUPS();
    // A wrong guess: no names, no reveal.
    const wrong = checkCustom(p, [[yellow.members[0], yellow.members[1], yellow.members[2], green.members[0]]]);
    expect(wrong.results[0].kind).toBe("one-away");
    expect(wrong.found).toEqual([]);
    expect(wrong.reveal).toBeUndefined();
    expect(JSON.stringify(wrong)).not.toContain("Sleepy and lazy");
    // A right one reveals just that group.
    const right = checkCustom(p, [yellow.members]);
    expect(right.found).toHaveLength(1);
    expect(right.found[0].label).toBe("Sleepy and lazy");
    expect(JSON.stringify(right)).not.toContain("Rocky road");
    // Winning explains all four with a line per Pokémon.
    const won = checkCustom(p, GROUPS().map((g) => g.members));
    expect(won.won).toBe(true);
    expect(won.reveal).toHaveLength(4);
    expect(won.reveal!.every((g) => g.lines.length === 4 && g.lines.every((l) => l.why === g.label))).toBe(true);
    // Four mistakes also end the game and reveal.
    const lost = checkCustom(p, [0, 1, 2, 3].map((n) => [yellow.members[n], green.members[n], GROUPS()[2].members[n], GROUPS()[3].members[(n + 1) % 4]]));
    expect(lost.over).toBe(true);
    expect(lost.reveal).toHaveLength(4);
  });
});

describe("no answer leaks", () => {
  beforeEach(() => {
    clearMemoryCustom();
    process.env.POKEIQ_LOCAL_ACCOUNTS = "1";
  });
  const names = GROUPS().map((g) => g.name);

  it("never sends the groups before the game is over: tiles, meta and the community lists", async () => {
    const store = memoryCustomStore();
    const out = (await publishCustom({ groups: GROUPS(), identity: "d:aaaaaaaaaaaaaaaaaaaa", creatorName: "Ash", title: "Quiz" }, store)) as { id: string };
    const p = (await getCustom(out.id, store))!;
    const view = customView(p);
    expect(Object.keys(view).sort()).toEqual(["key", "tiles"]);
    expect(view.tiles).toHaveLength(16);
    expect(Object.keys(view.tiles[0]).sort()).toEqual(["id", "name"]);

    const viaApi = await getConnections(new NextRequest(`http://x.test/api/connections?practice=custom-${out.id}`, { headers: { "x-forwarded-for": "10.9.0.1" } }));
    const apiText = JSON.stringify(await viaApi.json());
    for (const n of names) expect(apiText).not.toContain(n);
    expect(apiText).not.toContain("level");
    expect(apiText).not.toContain("members");

    const meta = JSON.stringify(await metaOf(out.id, "d:zzzzzzzzzzzzzzzzzzzz", store));
    const list = JSON.stringify(await listCustom(store));
    for (const text of [meta, list]) {
      for (const n of names) expect(text).not.toContain(n);
      expect(text).not.toContain("members");
      expect(text).not.toContain("tiles");
      expect(text).toContain("Quiz");
    }
    const metaRes = await getMeta(new NextRequest(`http://x.test/api/connections/custom/${out.id}`, { headers: { "x-forwarded-for": "10.9.0.2" } }), { params: Promise.resolve({ id: out.id }) });
    const metaText = JSON.stringify(await metaRes.json());
    for (const n of names) expect(metaText).not.toContain(n);
  });

  it("checks guesses through the same API as practice, and a wrong one reveals nothing", async () => {
    const store = memoryCustomStore();
    const out = (await publishCustom({ groups: GROUPS(), identity: "d:aaaaaaaaaaaaaaaaaaaa" }, store)) as { id: string };
    const [a, b] = GROUPS();
    const res = await postConnections(
      new NextRequest("http://x.test/api/connections", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "10.9.0.3" },
        body: JSON.stringify({ practice: `custom-${out.id}`, guesses: [[a.members[0], a.members[1], b.members[0], b.members[1]]] }),
      })
    );
    const body = await res.json();
    expect(body.results[0].kind).toBe("wrong");
    expect(body.reveal).toBeUndefined();
    for (const n of names) expect(JSON.stringify(body)).not.toContain(n);
    const missing = await getConnections(new NextRequest("http://x.test/api/connections?practice=custom-abcdefgh", { headers: { "x-forwarded-for": "10.9.0.4" } }));
    expect(missing.status).toBe(404);
  });
});

describe("voting and the community lists", () => {
  beforeEach(() => {
    clearMemoryCustom();
    process.env.POKEIQ_LOCAL_ACCOUNTS = "1";
  });
  const make = async (store: ReturnType<typeof memoryCustomStore>, who: string, now?: number) => ((await publishCustom({ groups: GROUPS(), identity: who, title: who }, store, now)) as { id: string }).id;

  it("lets each player vote once, change it or take it back", async () => {
    const store = memoryCustomStore();
    const pid = await make(store, "d:aaaaaaaaaaaaaaaaaaaa");
    expect(await voteCustom(pid, "d:v1v1v1v1v1v1v1v1v1v1", 1, store)).toMatchObject({ ok: true, up: 1, down: 0 });
    expect(await voteCustom(pid, "d:v1v1v1v1v1v1v1v1v1v1", 1, store)).toMatchObject({ up: 1, down: 0 }); // same vote again: still one
    expect(await voteCustom(pid, "d:v2v2v2v2v2v2v2v2v2v2", 1, store)).toMatchObject({ up: 2, down: 0 });
    expect(await voteCustom(pid, "d:v1v1v1v1v1v1v1v1v1v1", -1, store)).toMatchObject({ up: 1, down: 1 }); // changed
    expect(await voteCustom(pid, "d:v2v2v2v2v2v2v2v2v2v2", 0, store)).toMatchObject({ up: 0, down: 1 }); // taken back
    expect((await metaOf(pid, "d:v1v1v1v1v1v1v1v1v1v1", store))!.myVote).toBe(-1);
    expect((await metaOf(pid, "d:v2v2v2v2v2v2v2v2v2v2", store))!.myVote).toBe(0);
  });

  it("won't take a vote on your own puzzle or a missing one", async () => {
    const store = memoryCustomStore();
    const pid = await make(store, "d:aaaaaaaaaaaaaaaaaaaa");
    expect(await voteCustom(pid, "d:aaaaaaaaaaaaaaaaaaaa", 1, store)).toMatchObject({ ok: false, status: 403 });
    expect(await voteCustom("abcdefgh", "d:v1v1v1v1v1v1v1v1v1v1", 1, store)).toMatchObject({ ok: false, status: 404 });
  });

  it("votes over the API, once per player id", async () => {
    const store = memoryCustomStore();
    const pid = await make(store, "d:aaaaaaaaaaaaaaaaaaaa");
    const vote = (player: string, value: number) =>
      postVote(
        new NextRequest(`http://x.test/api/connections/custom/${pid}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.9.1.1" }, body: JSON.stringify({ value, player }) }),
        { params: Promise.resolve({ id: pid }) }
      );
    expect(await (await vote("p1p1p1p1p1p1p1p1p1p1", 1)).json()).toMatchObject({ up: 1, down: 0, myVote: 1 });
    expect(await (await vote("p1p1p1p1p1p1p1p1p1p1", 1)).json()).toMatchObject({ up: 1, down: 0 });
    expect((await vote("p1p1p1p1p1p1p1p1p1p1", 5)).status).toBe(400);
  });

  it("lists the top and newest, and features this week's best", async () => {
    const store = memoryCustomStore();
    const day = 86_400_000;
    const now = Date.now();
    const old = await make(store, "d:o1o1o1o1o1o1o1o1o1o1", now - 30 * day);
    const mid = await make(store, "d:m1m1m1m1m1m1m1m1m1m1", now - 2 * day);
    const fresh = await make(store, "d:f1f1f1f1f1f1f1f1f1f1", now - 1000);
    for (const v of ["a", "b", "c"]) await voteCustom(old, `d:${v.repeat(20)}`, 1, store); // old and loved
    for (const v of ["a", "b"]) await voteCustom(mid, `d:${v.repeat(20)}`, 1, store);
    await voteCustom(fresh, "d:aaaaaaaaaaaaaaaaaaaa", 1, store);
    const list = await listCustom(store, now);
    expect(list.available).toBe(true);
    expect(list.top.map((p) => p.id)).toEqual([old, mid, fresh]);
    expect(list.newest.map((p) => p.id)).toEqual([fresh, mid, old]);
    expect(list.featured?.id).toBe(mid); // the old one is the top overall, but not this week's
    // Nothing voted up this week: nothing featured.
    clearMemoryCustom();
    const empty = memoryCustomStore();
    await make(empty, "d:o1o1o1o1o1o1o1o1o1o1", now);
    expect((await listCustom(empty, now)).featured).toBeNull();
    expect(await listCustom(null)).toMatchObject({ available: false, top: [] });
  });
});

describe("creating over the API", () => {
  beforeEach(() => {
    clearMemoryCustom();
    process.env.POKEIQ_LOCAL_ACCOUNTS = "1";
  });
  const post = (body: unknown, ip: string) =>
    postCreate(new NextRequest("http://x.test/api/connections/custom", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) }));

  it("publishes, filters names and is rate-limited per address", async () => {
    const ok = await post({ groups: GROUPS(), player: "q1q1q1q1q1q1q1q1q1q1", name: "Misty" }, "10.9.2.1");
    const made = await ok.json();
    expect(ok.status).toBe(200);
    expect(made.path).toBe(`/connections/c/${made.id}`);
    expect((await getCustom(made.id))!.creatorName).toBe("Misty");

    const dirty = GROUPS();
    dirty[0].name = bad("f", "uck");
    expect((await post({ groups: dirty, player: "q1q1q1q1q1q1q1q1q1q1" }, "10.9.2.1")).status).toBe(400);
    expect((await post({ groups: GROUPS().slice(0, 3), player: "q1q1q1q1q1q1q1q1q1q1" }, "10.9.2.1")).status).toBe(400);

    let last = 0;
    for (let i = 0; i < 8; i++) last = (await post({ groups: GROUPS(), player: "q1q1q1q1q1q1q1q1q1q1" }, "10.9.2.9")).status;
    expect(last).toBe(429);

    const list = await (await getList(new NextRequest("http://x.test/api/connections/custom", { headers: { "x-forwarded-for": "10.9.2.2" } }))).json();
    expect(list.available).toBe(true);
  });
});
