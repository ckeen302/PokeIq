import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import geo from "@/data/geo.json";
import { GEO_SHOT_ROUTE_ID_RE } from "@/lib/geo-storage";
import { amzDate, sha256Hex, signV4, uriEncode } from "../scripts/r2/sigv4";
import {
  SHOT_CACHE_CONTROL,
  checkHead,
  listShots,
  shotKey,
  shuffledOrder,
  spearman,
  spreadReport,
  stripWebpMetadata,
  webpChunks,
  type GeoData,
  type ShotRef,
} from "../scripts/r2/shots";

/** scripts/r2-shots.ts: the R2 copy of PokéGuessr's screenshots. */

const DATA = geo as unknown as GeoData;

describe("listShots", () => {
  const shots = listShots(DATA);

  it("lists every screenshot in geo.json once, with valid ids", () => {
    const fromData = DATA.world.locations.flatMap((l) => l.shots.map((s) => s.id));
    expect(shots.length).toBe(new Set(fromData).size);
    expect(new Set(shots.map((s) => s.id)).size).toBe(shots.length);
    expect(shots.every((s) => GEO_SHOT_ROUTE_ID_RE.test(s.id))).toBe(true);
    expect(shots.length).toBeGreaterThan(5000);
  });

  it("keeps each shot's region and data order", () => {
    const first = DATA.world.locations.find((l) => l.shots.length)!;
    expect(shots[0]).toEqual({ id: first.shots[0].id, region: first.region ?? "?", index: 0 });
    expect(shots.every((s, i) => s.index === i)).toBe(true);
  });

  it("dedupes, adds extra ids, and refuses anything that isn't an id", () => {
    const tiny: GeoData = { world: { locations: [{ name: "A", region: "Kanto", shots: [{ id: "aaaaaaaaaaaa" }, { id: "aaaaaaaaaaaa" }] }] } };
    expect(listShots(tiny, ["bbbbbbbbbbbb", "aaaaaaaaaaaa"]).map((s) => s.id)).toEqual(["aaaaaaaaaaaa", "bbbbbbbbbbbb"]);
    expect(() => listShots(tiny, ["../etc/passwd"])).toThrow();
  });

  it("keys match the paths the site reads (src/lib/geo-storage)", () => {
    expect(shotKey("8EnZ4Lag0wIh")).toBe("geo/8EnZ4Lag0wIh.webp");
  });
});

describe("shuffledOrder", () => {
  const shots = listShots(DATA);

  it("is a permutation, fixed by its seed, and leaves its input alone", () => {
    const before = shots.map((s) => s.id);
    const a = shuffledOrder(shots, 1234);
    expect(shots.map((s) => s.id)).toEqual(before);
    expect([...a.map((s) => s.id)].sort()).toEqual([...before].sort());
    expect(shuffledOrder(shots, 1234).map((s) => s.id)).toEqual(a.map((s) => s.id));
    expect(shuffledOrder(shots, 1235).map((s) => s.id)).not.toEqual(a.map((s) => s.id));
  });

  it("has no trace of the data's region-grouped order", () => {
    for (const seed of [1, 2, 3]) {
      const order = shuffledOrder(shots, seed);
      expect(Math.abs(spearman(order.map((s) => s.index), order.map((_, i) => i)))).toBeLessThan(0.05);
      // Every region turns up throughout: each tenth of the run holds most of them.
      const regions = new Set(shots.map((s) => s.region));
      const tenth = new Set(order.slice(0, Math.ceil(order.length / 10)).map((s) => s.region));
      expect(tenth.size).toBeGreaterThanOrEqual(regions.size - 2);
    }
  });
});

describe("spreadReport", () => {
  const shots = listShots(DATA);
  const t0 = Date.parse("2026-11-10T12:00:00Z");
  /** Upload times at `perSecond` files a second in the given order, rounded down to whole seconds like Last-Modified. */
  const timesOf = (order: readonly ShotRef[], perSecond: number) =>
    order.map((ref, i) => ({ ref, lastModified: t0 + Math.floor(i / perSecond) * 1000 }));
  const sampleOf = <T,>(items: readonly T[], n: number) => items.filter((_, i) => i % Math.floor(items.length / n) === 0).slice(0, n);

  it("passes a shuffled upload, even with many files to the second", () => {
    const report = spreadReport(sampleOf(timesOf(shuffledOrder(shots, 99), 25), 300));
    expect(report.grouped).toBe(false);
    expect(report.spreadSeconds).toBeGreaterThan(100);
    expect(Math.abs(report.orderCorrelation)).toBeLessThan(0.2);
  });

  it("catches an upload in the data's order, and a region-at-a-time one", () => {
    expect(spreadReport(sampleOf(timesOf(shots, 25), 300)).grouped).toBe(true);
    const byRegion = [...shots].sort((a, b) => a.region.localeCompare(b.region) || b.index - a.index);
    const report = spreadReport(sampleOf(timesOf(byRegion, 25), 300));
    expect(report.grouped).toBe(true);
    expect(report.regionP).toBeLessThan(0.001);
  });

  it("finds nothing to group without Last-Modified", () => {
    const report = spreadReport(shots.slice(0, 50).map((ref) => ({ ref, lastModified: null })));
    expect(report).toMatchObject({ withLastModified: 0, grouped: false });
  });
});

describe("checkHead", () => {
  const good = () =>
    new Headers({ "content-type": "image/webp", "cache-control": SHOT_CACHE_CONTROL, "content-length": "1234", etag: '"abc"', "last-modified": "Tue, 10 Nov 2026 12:00:00 GMT" });

  it("accepts the headers the upload sets", () => {
    const check = checkHead(200, good(), 1234);
    expect(check.problems).toEqual([]);
    expect(check.lastModified).toBe(Date.parse("2026-11-10T12:00:00Z"));
  });

  it("flags custom metadata, a file name, wrong caching, type or size", () => {
    const h = good();
    h.set("x-amz-meta-region", "kanto");
    h.set("content-disposition", 'inline; filename="route-1.webp"');
    h.set("cache-control", "no-cache");
    h.set("content-type", "application/octet-stream");
    const { problems } = checkHead(404, h, 999);
    expect(problems).toHaveLength(6);
  });

  it("reads a missing Last-Modified as null", () => {
    const h = good();
    h.delete("last-modified");
    expect(checkHead(200, h).lastModified).toBeNull();
  });
});

describe("stripWebpMetadata", () => {
  const chunk = (fourcc: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.write(fourcc, 0, "ascii");
    head.writeUInt32LE(data.length, 4);
    return Buffer.concat([head, data, data.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };
  const riff = (...chunks: Buffer[]) => {
    const body = Buffer.concat(chunks);
    const head = Buffer.alloc(12);
    head.write("RIFF", 0, "ascii");
    head.writeUInt32LE(4 + body.length, 4);
    head.write("WEBP", 8, "ascii");
    return Buffer.concat([head, body]);
  };
  const vp8x = (flags: number) => chunk("VP8X", Buffer.from([flags, 0, 0, 0, 9, 0, 0, 9, 0, 0]));
  const image = chunk("VP8 ", Buffer.from("pixels!")); // odd length: padded

  it("drops EXIF and XMP chunks and their VP8X flags, keeping everything else byte for byte", () => {
    const icc = chunk("ICCP", Buffer.from("profile"));
    const withMeta = riff(vp8x(0x20 | 0x08 | 0x04), icc, image, chunk("EXIF", Buffer.from("GPS: Pallet Town")), chunk("XMP ", Buffer.from("<x/>")));
    const out = stripWebpMetadata(withMeta);
    expect(webpChunks(out)).toEqual(["VP8X", "ICCP", "VP8 "]);
    expect(out[20]).toBe(0x20);
    expect(out.readUInt32LE(4)).toBe(out.length - 8);
    expect(out.subarray(12 + 18)).toEqual(Buffer.concat([icc, image]));
    expect(out.includes(Buffer.from("Pallet"))).toBe(false);
  });

  it("returns a file without metadata unchanged", () => {
    const plain = riff(image);
    expect(stripWebpMetadata(plain)).toBe(plain);
  });

  it("leaves the repo's own WebPs unchanged", () => {
    const dir = path.join(import.meta.dirname, "../public/geo/maps");
    const files = readdirSync(dir).filter((f) => f.endsWith(".webp"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const buf = readFileSync(path.join(dir, f));
      expect(stripWebpMetadata(buf).equals(buf)).toBe(true);
    }
  });

  it("refuses what isn't a WebP, or is cut short", () => {
    expect(() => stripWebpMetadata(Buffer.from("GIF89a........"))).toThrow();
    expect(() => stripWebpMetadata(riff(image).subarray(0, 22))).toThrow();
  });
});

describe("signV4", () => {
  // The worked examples in AWS's "Signature Version 4: header-based auth" docs.
  const KEYS = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1" };
  const date = new Date("2013-05-24T00:00:00Z");
  const EMPTY = sha256Hex("");

  it("matches AWS's GET Object example", () => {
    const s = signV4({ ...KEYS, date, method: "GET", url: "https://examplebucket.s3.amazonaws.com/test.txt", headers: { Range: "bytes=0-9" }, payloadHash: EMPTY });
    expect(s.signature).toBe("f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
    expect(s.headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });

  it("matches AWS's PUT Object example (an encoded key, a body hash)", () => {
    const body = "Welcome to Amazon S3.";
    expect(sha256Hex(body)).toBe("44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072");
    const s = signV4({
      ...KEYS,
      date,
      method: "PUT",
      url: "https://examplebucket.s3.amazonaws.com/test$file.text",
      headers: { Date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY" },
      payloadHash: sha256Hex(body),
    });
    expect(s.canonicalRequest.split("\n")[1]).toBe("/test%24file.text");
    expect(s.signature).toBe("98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd");
  });

  it("matches AWS's GET Bucket example (a sorted query string)", () => {
    const s = signV4({ ...KEYS, date, method: "GET", url: "https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J", payloadHash: EMPTY });
    expect(s.signature).toBe("34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
  });

  it("formats dates and encodes like SigV4 wants", () => {
    expect(amzDate(new Date("2026-11-10T01:02:03.456Z"))).toBe("20261110T010203Z");
    expect(uriEncode("a b*!'()~-_.")).toBe("a%20b%2A%21%27%28%29~-_.");
  });

  it("signs an R2 upload with its headers", () => {
    const s = signV4({
      accessKeyId: "id",
      secretAccessKey: "secret",
      region: "auto",
      date,
      method: "PUT",
      url: "https://acct.r2.cloudflarestorage.com/bucket/geo/8EnZ4Lag0wIh.webp",
      headers: { "content-type": "image/webp", "cache-control": SHOT_CACHE_CONTROL },
      payloadHash: EMPTY,
    });
    expect(s.headers.host).toBe("acct.r2.cloudflarestorage.com");
    expect(s.headers.authorization).toContain("/20130524/auto/s3/aws4_request, SignedHeaders=cache-control;content-type;host;x-amz-content-sha256;x-amz-date,");
    expect(s.canonicalRequest).toContain("cache-control:public, max-age=31536000, immutable\n");
  });
});
