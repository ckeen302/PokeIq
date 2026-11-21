import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** PokéConnections' screens: English reads exactly as before; another language reads its own words and Pokémon names. */

const strip = (html: string) => html.replace(/<!-- -->/g, "");

describe("English", () => {
  it("board pieces and results read as they always did", async () => {
    const { LevelLegend, MistakeDots, GuessHistory } = await import("@/components/connections/parts");
    const { KeyHints, StreakFlame } = await import("@/components/connections/results");
    const legend = strip(renderToStaticMarkup(createElement(LevelLegend, { size: 4, symbols: false })));
    expect(legend).toContain('aria-label="Group colours, easiest to trickiest: Yellow, Green, Blue, Purple"');
    expect(legend).toContain(">Easiest</span>");
    expect(strip(renderToStaticMarkup(createElement(MistakeDots, { left: 1, max: 4 })))).toContain('aria-label="1 of 4 mistakes left">Last chance:');
    expect(strip(renderToStaticMarkup(createElement(GuessHistory, { rows: [[0, 0, 1, 0]], symbols: false })))).toContain('aria-label="Guess 1: Yellow, Yellow, Green, Yellow"');
    const keys = strip(renderToStaticMarkup(createElement(KeyHints)));
    expect(keys).toContain("<span><kbd class=\"rounded border border-foreground/20 bg-shade/30 px-1.5 py-0.5 font-mono text-[10px] text-foreground/80\">Space</kbd> pick</span>");
    const flame = strip(renderToStaticMarkup(createElement(StreakFlame, { streak: 1, best: 4 })));
    expect(flame).toContain("1 day</p>");
    expect(flame).toContain("Best: 4 days");
  });

  it("the tiles show the API's names without a provider", async () => {
    const { GroupBar } = await import("@/components/connections/parts");
    const html = strip(renderToStaticMarkup(createElement(GroupBar, { group: { level: 3, label: "Fire starters", members: [{ id: 4, name: "Charmander" }] }, symbols: false })));
    expect(html).toContain('aria-label="Purple group: Fire starters: Charmander"');
    expect(html).toContain("Charmander</span>");
  });
});

describe("another language", () => {
  it("French: the page's words, and the Pokémon's French names", async () => {
    vi.stubEnv("LIVE_LOCALES", "fr");
    vi.resetModules();
    const { LocaleProvider } = await import("@/i18n/locale-context");
    const { MessagesProvider } = await import("@/i18n/client");
    const { ConnNamesProvider } = await import("@/components/connections/names");
    const { GroupBar, MistakeDots } = await import("@/components/connections/parts");
    const fr = {
      "connections-board": (await import("@/messages/fr/connections-board.json")).default,
      connections: (await import("@/messages/fr/connections.json")).default,
    };
    const wrap = (node: ReactNode) =>
      createElement(LocaleProvider, { locale: "fr" }, createElement(MessagesProvider, { messages: fr as never }, createElement(ConnNamesProvider, { names: { 4: "Salamèche" } }, node)));
    const bar = strip(renderToStaticMarkup(wrap(createElement(GroupBar, { group: { level: 3, label: "Starters Feu", members: [{ id: 4, name: "Charmander" }] }, symbols: false }))));
    expect(bar).toContain('aria-label="Groupe Violet : Starters Feu : Salamèche"');
    expect(bar).toContain("Salamèche</span>");
    expect(strip(renderToStaticMarkup(wrap(createElement(MistakeDots, { left: 2, max: 4 }))))).toContain("Erreurs restantes :");
    vi.unstubAllEnvs();
  });
});
