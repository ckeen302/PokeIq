import { describe, expect, it } from "vitest";
import { logLineHtml, replayFileHtml, replayFileName, replayLogData } from "@/lib/battle/replay-file";

const LOG = [
  "|j|☆Red",
  "|player|p1|Red|1|",
  "|player|p2|Blue</script>|2|",
  "|gametype|singles",
  "|start",
  "|split|p1",
  "|switch|p1a: Pikachu|Pikachu, L50|105/105",
  "|switch|p1a: Pikachu|Pikachu, L50|100/100",
  "|request|{}",
  "|turn|1",
  "|win|Red",
];

describe("Showdown replay files", () => {
  it("keep the public half of split lines and drop requests", () => {
    expect(replayLogData(LOG)).toEqual(["|j|☆Red", "|player|p1|Red|1|", "|player|p2|Blue</script>|2|", "|gametype|singles", "|start", "|switch|p1a: Pikachu|Pikachu, L50|100/100", "|turn|1", "|win|Red"]);
  });

  it("is Showdown's version-1 layout, with every slash in the log escaped", () => {
    const html = replayFileHtml({ id: "abcd2345", format: "[Gen 9] Random Battle", players: ["Red", "Blue</script>"], log: LOG, logHtml: logLineHtml("", 1) });
    expect(html.startsWith('<!DOCTYPE html>\n<meta charset="utf-8" />\n<!-- version 1 -->\n<title>[Gen 9] Random Battle replay: Red vs. Blue&lt;/script&gt;</title>\n<style>\n')).toBe(true);
    expect(html).toContain('<input type="hidden" name="replayid" value="pokeiq-abcd2345" />');
    expect(html).toContain('<script type="text/plain" class="battle-log-data">|j|☆Red\n|player|p1|Red|1|\n|player|p2|Blue<\\/script>|2|');
    // The only </script> closings are the data block's and the loader's.
    const data = html.slice(html.indexOf('class="battle-log-data">'), html.indexOf("</script>"));
    expect(data).not.toContain("</");
    expect(html).toContain("play.pokemonshowdown.com/js/replay-embed.js");
    expect(html).toContain('<h2 class="battle-history">Turn 1</h2>');
  });

  it("escapes the text log and keeps Showdown's bold", () => {
    expect(logLineHtml("**Red** used <b>Tackle</b>!")).toBe('<div class="battle-history"><strong>Red</strong> used &lt;b&gt;Tackle&lt;/b&gt;!</div>');
    expect(replayFileName("gen9randombattle", ["Red", "Blue!"], "abcd2345")).toBe("gen9randombattle-red-vs-blue-abcd2345.html");
  });
});
