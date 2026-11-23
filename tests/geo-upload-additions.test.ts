import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { assertNoMetadata, pendingPlans, webpChunks } from "../scripts/geo/upload-additions";

// The owner's upload step (scripts/geo/upload-additions.ts): with no plan
// named it takes every plan that still has something to send, and an encoded
// shot carries no metadata that could name its place.

describe("upload-additions", () => {
  it("finds the plans with something left to upload", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "plans-"));
    try {
      writeFileSync(path.join(dir, "batch-1.json"), JSON.stringify([{ game: "X / Y", id: "a", uploaded: true }]));
      writeFileSync(path.join(dir, "batch-2.json"), JSON.stringify([{ game: "X / Y", id: "b", uploaded: false }]));
      writeFileSync(path.join(dir, "notes.txt"), "not a plan");
      expect(pendingPlans(dir).map((p) => path.basename(p))).toEqual(["batch-2.json"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("every plan in the repository is well formed", () => {
    for (const file of pendingPlans()) expect(path.basename(file)).toMatch(/^batch-\d+\.json$/);
  });

  it("refuses an encoded file with metadata", async () => {
    const plain = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#123" } }).webp().toBuffer();
    expect(webpChunks(plain)).toEqual(["VP8 "]);
    expect(() => assertNoMetadata(plain)).not.toThrow();
    const tagged = await sharp(plain).withMetadata({ exif: { IFD0: { Copyright: "x" } } }).webp().toBuffer();
    expect(webpChunks(tagged)).toContain("EXIF");
    expect(() => assertNoMetadata(tagged)).toThrow(/metadata/);
  });
});
