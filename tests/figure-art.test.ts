import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { figureArtUrl } from "@/lib/figure-art";
import { FILM_ART_IDS, RACE_ART_IDS, figureArtIds } from "@/lib/server/figure-art-ids";
import { FIGURE_ART_SIZES } from "@/lib/server/figure-art";
import { RACE_URLS } from "@/components/race/urls";
import { artUrl as historyArtUrl } from "@/lib/world-history/assets";

const raceRoute = await import("@/app/api/race/home/[id]/route");
const historyRoute = await import("@/app/api/world-history/art/[id]/route");
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("the cut-out figures' pictures", () => {
  it("every figure the race and the films can show has a static picture at each size (scripts/figure-art.ts)", () => {
    const missing = figureArtIds().flatMap((id) => FIGURE_ART_SIZES.filter((s) => !existsSync(join(process.cwd(), "public", figureArtUrl(id, s)))).map((s) => `${id}@${s}`));
    expect(missing, "run scripts/figure-art.ts").toEqual([]);
    expect(RACE_ART_IDS.size).toBeGreaterThan(1000);
    for (const id of FILM_ART_IDS) expect(RACE_ART_IDS.has(id) || figureArtIds().includes(id)).toBe(true);
  });

  it("the pages load the static files, not a function", () => {
    expect(RACE_URLS.art(25, 512)).toBe("/race/art/512/25.webp");
    expect(historyArtUrl(493, 256)).toBe("/race/art/256/493.webp");
  });

  it("the old routes redirect there, and only for figures they know", async () => {
    const res = await raceRoute.GET(new NextRequest("http://localhost:3000/api/race/home/25?s=256"), params("25"));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("http://localhost:3000/race/art/256/25.webp");
    const [film] = [...FILM_ART_IDS];
    const old = await historyRoute.GET(new NextRequest(`http://localhost:3000/api/world-history/art/${film}`), params(String(film)));
    expect(old.status).toBe(308);
    expect(old.headers.get("location")).toBe(`http://localhost:3000/race/art/512/${film}.webp`);
    expect((await raceRoute.GET(new NextRequest("http://localhost:3000/api/race/home/25?s=128"), params("25"))).status).toBe(404);
    expect((await raceRoute.GET(new NextRequest("http://localhost:3000/api/race/home/99999"), params("99999"))).status).toBe(404);
  });
});
