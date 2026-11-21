import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { Connections } from "@/components/connections/Connections";
import { PuzzleOfTheDay } from "@/components/connections/PuzzleOfTheDay";
import { GameInfo } from "@/components/seo/GameInfo";
import { ConnectionsLazyCards } from "@/components/connections/LazyCards";
import { ConnNamesProvider } from "@/components/connections/names";
import { connDailyViews } from "@/lib/server/connections-today";
import { puzzleView } from "@/lib/server/connections";
import { effectiveDaily } from "@/lib/server/connections-social";
import { localizedDaily } from "@/lib/connections/localize";
import { connTileNames } from "@/lib/connections/names";
import { CONN_LAUNCH_DATE } from "@/lib/connections/types";
import { boardArtUrl } from "@/lib/pokemon/art";
import type { ConnPuzzleResponse } from "@/lib/connections/types";
import { howToFirstScript } from "@/lib/howto-first";
import type { Locale } from "@/i18n/config";
import { ClientMessages } from "@/i18n/ClientMessages";
import { getLocale, serverT } from "@/i18n/server";
import pages from "@/messages/connections-pages";
import conn from "@/messages/connections";
import board from "@/messages/connections-board";
import stats from "@/messages/connections-stats";
import cards from "@/messages/connections-cards";
import party from "@/messages/connections-party";
import share from "@/messages/share";
import howto from "@/messages/howto";
import duel from "@/messages/duel";

export function generateMetadata(): Metadata {
  const t = serverT(pages);
  return pageMetadata({
    title: t("meta.title"),
    description: t("meta.description"),
    path: "/pokeconnections",
  });
}

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

/**
 * The same three dailies for a page in another language: on a day with a group about the English names, that
 * group swapped (lib/connections/localize), exactly as /api/connections deals and checks it for that language.
 */
async function localDailyViews(locale: Locale, now = Date.now()): Promise<Record<string, ConnPuzzleResponse>> {
  const day = 86_400_000;
  const dates = [-1, 0, 1].map((k) => new Date(now + k * day).toISOString().slice(0, 10)).filter((d) => d >= CONN_LAUNCH_DATE);
  const out: Record<string, ConnPuzzleResponse> = {};
  for (const date of dates) {
    try {
      out[date] = puzzleView(localizedDaily(await effectiveDaily(date), date, locale), `daily:${date}`, date);
    } catch (err) {
      console.error("[connections] couldn't deal", date, err);
    }
  }
  return out;
}

/** A first visit's How to play shows with the board (lib/howto-first): the game's own check (connFirstVisit). */
const HOWTO_FIRST = howToFirstScript("pokeiq:connections-prefs:v1", "!P.seenHowToDemo&&!Object.keys((G.conn&&G.conn.results)||{}).length");

export default async function ConnectionsPage() {
  const t = serverT(pages);
  const locale = getLocale();
  // Per-player state (saved guesses, streaks, results) stays on the device and in its own requests; guesses are checked by /api/connections.
  const initial = locale === "en" ? await connDailyViews() : await localDailyViews(locale);
  return (
    <>
    <script dangerouslySetInnerHTML={{ __html: localDayScript(initial) + HOWTO_FIRST }} />
    <div className="space-y-10">
      <ClientMessages namespaces={[conn, board, stats, cards, party, share, howto, duel]}>
        <ConnNamesProvider names={connTileNames(locale)}>
          <Connections initial={initial} />
          <PuzzleOfTheDay />
          <ConnectionsLazyCards />
        </ConnNamesProvider>
      </ClientMessages>
      <GameInfo
        howToButton
        noFaq
        path="/pokeconnections"
        name={`PokéConnections`}
        description={t("info.description")}
        intro={t("info.intro")}
        steps={[t("info.step1"), t("info.step2"), t("info.step3"), t("info.step4")]}
        faqs={[
          { q: t("info.faq1"), a: t("info.faq1a") },
          { q: t("info.faq2"), a: t("info.faq2a") },
        ]}
      />
    </div>
    </>
  );
}
