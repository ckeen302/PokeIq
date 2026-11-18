import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

describe("the games' web addresses", () => {
  it("the old /guessr and /connections addresses forward, with the rest of the path, to the Pokémon-style ones", async () => {
    const rules = await nextConfig.redirects!();
    const find = (source: string) => rules.find((r) => r.source === source);
    expect(find("/play")).toMatchObject({ destination: "/quiz", permanent: true });
    expect(find("/guessr")).toMatchObject({ destination: "/pokeguessr", permanent: true });
    expect(find("/guessr/:path*")).toMatchObject({ destination: "/pokeguessr/:path*", permanent: true });
    expect(find("/connections")).toMatchObject({ destination: "/pokeconnections", permanent: true });
    expect(find("/connections/:path*")).toMatchObject({ destination: "/pokeconnections/:path*", permanent: true });
  });

  it("the sitemap lists the new addresses and not the old ones", async () => {
    const { default: sitemap } = await import("@/app/sitemap");
    const urls = (await sitemap()).map((e) => new URL(e.url).pathname);
    expect(urls).toEqual(expect.arrayContaining(["/pokedle", "/pikadoku", "/pokeconnections", "/pokeguessr", "/quiz"]));
    expect(urls.some((u) => u === "/play" || u === "/guessr" || u === "/connections" || u.startsWith("/guessr/") || u.startsWith("/connections/"))).toBe(false);
  });
});
