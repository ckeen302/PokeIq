import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { Connections } from "@/components/connections/Connections";
import { PuzzleOfTheDay } from "@/components/connections/PuzzleOfTheDay";
import { GameInfo } from "@/components/seo/GameInfo";
import { ConnectionsLazyCards } from "@/components/connections/LazyCards";
import { connDailyViews } from "@/lib/server/connections-today";
import { boardArtUrl } from "@/lib/pokemon/art";
import type { ConnPuzzleResponse } from "@/lib/connections/types";
import { howToFirstScript } from "@/lib/howto-first";

export const metadata: Metadata = pageMetadata({
  title: "PokéConnections: the Daily Pokémon Connections Puzzle",
  description:
    "Pokémon Connections: sixteen Pokémon, four hidden groups: types, abilities, evolutions, stats and more. Find what links them with four mistakes to spare. A new puzzle every day, an archive and unlimited practice.",
  path: "/connections",
});

/**
 * Today's tiles ride in the page (never the groups), so the board paints with
 * the HTML. Regenerated hourly: the page carries yesterday's, today's and
 * tomorrow's (UTC), which covers every time zone, so a page dealt shortly
 * before midnight UTC still holds everyone's daily until it's renewed.
 */
export const revalidate = 3600;

/**
 * Runs before the board is parsed: marks the player's local date, so the
 * right one of the pre-rendered boards shows, and starts that board's
 * sixteen pictures at once, at high priority (the browser can't tell which
 * board is the player's until this runs, and would otherwise fetch them
 * behind the page's scripts).
 */
function localDayScript(initial: Record<string, ConnPuzzleResponse>): string {
  const art = Object.fromEntries(Object.entries(initial).map(([date, view]) => [date, view.tiles.filter((t) => !t.kind).map((t) => boardArtUrl(t.id))]));
  return `try{var d=new Date(),k=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");document.documentElement.dataset.connDay=k;(${JSON.stringify(art).replace(/</g, "\\u003c")}[k]||[]).forEach(function(u){var l=document.createElement("link");l.rel="preload";l.as="image";l.href=u;l.setAttribute("fetchpriority","high");document.head.appendChild(l)})}catch(e){}`;
}

/** A first visit's How to play shows with the board (lib/howto-first): the game's own check (connFirstVisit). */
const HOWTO_FIRST = howToFirstScript("pokeiq:connections-prefs:v1", "!P.seenHowToDemo&&!Object.keys((G.conn&&G.conn.results)||{}).length");

export default async function ConnectionsPage() {
  // Per-player state (saved guesses, streaks, results) stays on the device and in its own requests; guesses are checked by /api/connections.
  const initial = await connDailyViews();
  return (
    <>
    <script dangerouslySetInnerHTML={{ __html: localDayScript(initial) + HOWTO_FIRST }} />
    <div className="space-y-10">
      <Connections initial={initial} />
      <PuzzleOfTheDay />
      <ConnectionsLazyCards />
      <GameInfo
        howToButton
        path="/connections"
        name={`PokéConnections`}
        description={`PokéConnections is a free Pokémon Connections puzzle: sort sixteen Pokémon into four hidden groups with four mistakes to spare.`}
        intro={`PokéConnections is Pokémon Connections: sixteen Pokémon, four hidden groups, and a new puzzle every day.`}
        steps={[
          "Look at the sixteen Pokémon and find the ones that share something: a type, an ability, an evolution, stats and more.",
          "Select four and submit them as a group.",
          "You can make four mistakes before the puzzle ends.",
          "Play the daily puzzle, browse the archive or practice without limit.",
        ]}
        faqs={[
          { q: `What kinds of groups are there?`, a: `Types, abilities, evolutions, stats and more.` },
          { q: `How many mistakes can I make?`, a: `Four.` },
        ]}
      />
    </div>
    </>
  );
}
