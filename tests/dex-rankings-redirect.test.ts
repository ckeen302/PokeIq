import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

describe("the old Pokédex rankings addresses", () => {
  it("forward permanently to the Pokédex", async () => {
    const rules = await nextConfig.redirects!();
    const find = (source: string) => rules.find((r) => r.source === source);
    expect(find("/pokedex/rankings")).toMatchObject({ destination: "/pokedex", permanent: true });
    expect(find("/pokedex/rankings/:path*")).toMatchObject({ destination: "/pokedex", permanent: true });
  });

  it("the sitemap lists no rankings pages", async () => {
    const { default: sitemap } = await import("@/app/sitemap");
    const urls = (await sitemap()).map((e) => new URL(e.url).pathname);
    expect(urls).toContain("/pokedex");
    expect(urls.some((u) => u === "/pokedex/rankings" || u.startsWith("/pokedex/rankings/"))).toBe(false);
  });
});
