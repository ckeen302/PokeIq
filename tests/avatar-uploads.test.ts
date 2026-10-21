import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import sharp from "sharp";
import type { PublicUser } from "@/lib/server/accounts";
import { PICTURE_MAX_BYTES, PICTURE_STRIKE_LIMIT, PICTURES_PER_DAY } from "@/lib/avatar";

process.env.POKEIQ_LOCAL_ACCOUNTS = "1";

const user = (n: number, username: string): PublicUser => ({ id: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`, username, createdAt: "2026-01-01T00:00:00Z" });
const oak = user(1, "Oak");
const ash = user(2, "Ash");
const misty = user(3, "Misty");
const users = new Map([oak, ash, misty].map((u) => [u.username.toLowerCase(), u]));

vi.mock("@/lib/server/auth", async (orig) => {
  const real = await orig<typeof import("@/lib/server/auth")>();
  return {
    ...real,
    sessionTokenHash: (r: NextRequest) => r.headers.get("x-test-user"),
    userFromRequest: async (r: NextRequest) => users.get(r.headers.get("x-test-user") ?? "") ?? null,
  };
});
vi.mock("@/lib/server/accounts", async (orig) => {
  const real = await orig<typeof import("@/lib/server/accounts")>();
  return {
    ...real,
    accountsEnabled: () => true,
    findUserByName: async (name: string) => {
      const u = users.get(name.toLowerCase());
      return u ? { ...u, passwordHash: "", recoveryCodeHash: null } : null;
    },
    usersByIds: async (ids: string[]) => [...users.values()].filter((u) => ids.includes(u.id)),
    usersByNames: async (names: string[]) => [...users.values()].filter((u) => names.map((n) => n.toLowerCase()).includes(u.username.toLowerCase())),
    progressDigests: async () => new Map(),
  };
});

const { clearMemoryAvatars, avatarsByNames } = await import("@/lib/server/avatars");
const { clearMemoryPictures, processPicture } = await import("@/lib/server/avatar-uploads");
const { clearMemoryModeration, setSanction, modStore } = await import("@/lib/server/moderation");
const uploadRoute = await import("@/app/api/avatar/upload/route");
const imgRoute = await import("@/app/api/avatar/img/[id]/route");
const avatarRoute = await import("@/app/api/avatar/route");
const admin = await import("@/app/api/admin/route");

let ip = 0;
function headers(as: string | null): Record<string, string> {
  const h: Record<string, string> = { host: "localhost:3000", origin: "http://localhost:3000", "x-forwarded-for": `10.7.${Math.floor(++ip / 250)}.${ip % 250}` };
  if (as) h["x-test-user"] = as;
  return h;
}
const png = (w = 300, h = 200) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toBuffer();

async function upload(as: string | null, body: Buffer, type = "image/png") {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(body)], { type }), "pic");
  return uploadRoute.POST(new NextRequest("http://localhost:3000/api/avatar/upload", { method: "POST", headers: headers(as), body: form }));
}
const image = (id: string, as: string | null, size = 64) => imgRoute.GET(new NextRequest(`http://localhost:3000/api/avatar/img/${id}?s=${size}`, { headers: headers(as) }), { params: Promise.resolve({ id }) });
const adminGet = (as: string) => admin.GET(new NextRequest("http://localhost:3000/api/admin?tab=avatars", { headers: headers(as) }));
const adminAct = (as: string, body: unknown) => admin.POST(new NextRequest("http://localhost:3000/api/admin", { method: "POST", headers: { ...headers(as), "content-type": "application/json" }, body: JSON.stringify(body) }));
const settings = async (as: string) => (await (await avatarRoute.GET(new NextRequest("http://localhost:3000/api/avatar", { headers: headers(as) }))).json()) as import("@/lib/avatar").AvatarSettings;

async function uploaded(as: string): Promise<string> {
  const res = await upload(as, await png());
  expect(res.status).toBe(200);
  return ((await res.json()) as { id: string }).id;
}

beforeEach(() => {
  process.env.POKEIQ_ADMINS = "Oak";
  clearMemoryAvatars();
  clearMemoryPictures();
  clearMemoryModeration();
});
afterEach(() => {
  delete process.env.POKEIQ_ADMINS;
});

describe("checking an uploaded image", () => {
  it("makes square 256 and 64 px WebPs with no metadata", async () => {
    const jpeg = await sharp({ create: { width: 640, height: 400, channels: 3, background: "#3366cc" } })
      .jpeg()
      .withExif({ IFD0: { Copyright: "Someone", Artist: "A kid" } })
      .toBuffer();
    expect((await sharp(jpeg).metadata()).exif).toBeDefined();
    const out = await processPicture(jpeg, "image/jpeg");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    for (const size of [64, 256] as const) {
      const meta = await sharp(out.images[size]).metadata();
      expect(meta.format).toBe("webp");
      expect([meta.width, meta.height]).toEqual([size, size]);
      expect(meta.exif).toBeUndefined();
      expect(meta.icc).toBeUndefined();
    }
  });

  it("accepts PNG, WebP and a GIF's first frame", async () => {
    expect((await processPicture(await png(), "image/png")).ok).toBe(true);
    const webp = await sharp(await png()).webp().toBuffer();
    expect((await processPicture(webp, "image/webp")).ok).toBe(true);
    const gif = await sharp(await png(), { animated: false }).gif().toBuffer();
    const out = await processPicture(gif, "image/gif");
    expect(out.ok).toBe(true);
    if (out.ok) expect((await sharp(out.images[64]).metadata()).pages ?? 1).toBe(1);
  });

  it("refuses other types, big files and anything that doesn't decode", async () => {
    expect(await processPicture(await png(), "image/svg+xml")).toMatchObject({ ok: false, status: 415 });
    expect(await processPicture(Buffer.alloc(PICTURE_MAX_BYTES + 1), "image/png")).toMatchObject({ ok: false, status: 413 });
    expect(await processPicture(Buffer.from("definitely not an image"), "image/png")).toMatchObject({ ok: false, status: 400 });
    // A truncated PNG.
    expect(await processPicture((await png()).subarray(0, 60), "image/png")).toMatchObject({ ok: false, status: 400 });
    // An SVG passed off as a PNG is still not a PNG.
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
    expect((await processPicture(svg, "image/png")).ok).toBe(false);
    expect(await processPicture(Buffer.alloc(0), "image/png")).toMatchObject({ ok: false, status: 400 });
  });

  it("is for signed-in trainers, through the route", async () => {
    expect((await upload(null, await png())).status).toBe(401);
    expect((await upload("ash", Buffer.from("nope"))).status).toBe(400);
    expect((await upload("ash", await png(), "text/html")).status).toBe(415);
  });
});

describe("a picture waiting for review", () => {
  it("is seen by its uploader and moderators only", async () => {
    const id = await uploaded("ash");
    // Everyone else still sees Ash's Pokémon.
    expect((await avatarsByNames(["Ash"])).ash.picture).toBeUndefined();
    expect((await image(id, "misty")).status).toBe(404);
    expect((await image(id, null)).status).toBe(404);
    const own = await image(id, "ash");
    expect(own.status).toBe(200);
    expect(own.headers.get("cache-control")).toContain("no-store");
    expect((await image(id, "oak", 256)).status).toBe(200);
    const s = await settings("ash");
    expect(s.pictures.pending?.id).toBe(id);
    expect(s.pictures.approved).toBeNull();
    expect(s.usePicture).toBe(true);
  });

  it("is replaced by a newer upload, and can be deleted", async () => {
    const first = await uploaded("ash");
    const second = await uploaded("ash");
    expect((await image(first, "ash")).status).toBe(404);
    expect((await settings("ash")).pictures.pending?.id).toBe(second);
    const del = await uploadRoute.DELETE(new NextRequest("http://localhost:3000/api/avatar/upload?which=pending", { method: "DELETE", headers: headers("ash") }));
    expect(del.status).toBe(200);
    expect((await settings("ash")).pictures.pending).toBeNull();
    expect((await image(second, "ash")).status).toBe(404);
  });
});

describe("moderating pictures", () => {
  it("is for admins only", async () => {
    const id = await uploaded("ash");
    expect((await adminGet("ash")).status).toBe(404);
    expect((await adminAct("ash", { action: "approvePicture", id })).status).toBe(404);
    expect((await adminAct("misty", { action: "rejectPicture", id, strike: true })).status).toBe(404);
    const res = await adminGet("oak");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.pending).toEqual([expect.objectContaining({ id, username: "Ash" })]);
    // Still pending: nobody acted.
    expect((await avatarsByNames(["Ash"])).ash.picture).toBeUndefined();
  });

  it("approving shows the picture to everyone, in the trainer's frame, and logs it", async () => {
    const id = await uploaded("ash");
    expect((await adminAct("oak", { action: "approvePicture", id })).status).toBe(200);
    const shown = (await avatarsByNames(["Ash"])).ash;
    expect(shown.picture).toBe(id);
    const pub = await image(id, null);
    expect(pub.status).toBe(200);
    expect(pub.headers.get("cache-control")).toContain("public");
    expect((await adminGet("oak").then((r) => r.json())).count).toBe(0);
    expect((await adminAct("oak", { action: "approvePicture", id })).status).toBe(409);
    expect((await modStore()!.audit(5))[0]).toMatchObject({ admin: "Oak", action: "approve picture", target: "Ash" });

    // Back to the Pokémon, then deleting the picture for good.
    const put = await avatarRoute.PUT(
      new NextRequest("http://localhost:3000/api/avatar", { method: "PUT", headers: { ...headers("ash"), "content-type": "application/json" }, body: JSON.stringify({ pokemonId: 7, shiny: false, frame: "none", usePicture: false }) })
    );
    expect(put.status).toBe(200);
    expect((await avatarsByNames(["Ash"])).ash).toEqual({ pokemonId: 7, shiny: false, frame: "none" });
    const del = await uploadRoute.DELETE(new NextRequest("http://localhost:3000/api/avatar/upload?which=approved", { method: "DELETE", headers: headers("ash") }));
    expect(del.status).toBe(200);
    expect((await image(id, null)).status).toBe(404);
    expect((await settings("ash")).pictures.approved).toBeNull();
  });

  it("a newly approved picture replaces the old one", async () => {
    const first = await uploaded("ash");
    await adminAct("oak", { action: "approvePicture", id: first });
    const second = await uploaded("ash");
    // The approved one stays up while the new one waits.
    expect((await avatarsByNames(["Ash"])).ash.picture).toBe(first);
    await adminAct("oak", { action: "approvePicture", id: second });
    expect((await avatarsByNames(["Ash"])).ash.picture).toBe(second);
    expect((await image(first, null)).status).toBe(404);
  });

  it("rejecting deletes it, and three strikes stop uploads", async () => {
    for (let n = 1; n <= PICTURE_STRIKE_LIMIT; n++) {
      const id = await uploaded("misty");
      const res = await adminAct("oak", { action: "rejectPicture", id, strike: true });
      expect(res.status).toBe(200);
      expect((await res.json()).strikes).toBe(n);
      expect((await image(id, "misty")).status).toBe(404);
      expect((await avatarsByNames(["Misty"])).misty.picture).toBeUndefined();
    }
    const refused = await upload("misty", await png());
    expect(refused.status).toBe(403);
    expect((await settings("misty")).pictures.blocked).toMatch(/closed/);
    expect((await modStore()!.audit(1))[0]).toMatchObject({ action: "reject picture + strike", target: "Misty" });
    // A rejection without a strike doesn't count towards the limit.
    const id = await uploaded("ash");
    await adminAct("oak", { action: "rejectPicture", id });
    expect((await upload("ash", await png())).status).toBe(200);
  });
});

describe("upload limits", () => {
  it(`allows ${PICTURES_PER_DAY} uploads a day`, async () => {
    for (let i = 0; i < PICTURES_PER_DAY; i++) await uploaded("ash");
    expect((await upload("ash", await png())).status).toBe(429);
    expect((await settings("ash")).pictures.left).toBe(0);
  });

  it("refuses banned and muted trainers", async () => {
    const base = { mutedUntil: null, banned: false, banReason: null, updatedAt: Date.now(), updatedBy: "Oak" };
    await setSanction({ ...base, userId: ash.id, username: "Ash", banned: true, banReason: "spam" });
    expect((await upload("ash", await png())).status).toBe(403);
    await setSanction({ ...base, userId: misty.id, username: "Misty", mutedUntil: Date.now() + 3_600_000 });
    expect((await upload("misty", await png())).status).toBe(403);
    await setSanction({ ...base, userId: misty.id, username: "Misty" });
    expect((await upload("misty", await png())).status).toBe(200);
  });
});
