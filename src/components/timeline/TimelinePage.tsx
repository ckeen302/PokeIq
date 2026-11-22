import Link from "@/components/ui/PlainLink";
import { jsonLd } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";
import { TIMELINE } from "@/lib/timeline/data";
import { localTimeline } from "@/lib/timeline/localize";
import { entryPath } from "@/lib/timeline/deeplink";
import { ERAS, dateRows, formatDate, type TimelineEntry } from "@/lib/timeline/types";
import { WORLD_HISTORY_LIVE } from "@/lib/lab";
import { HISTORY_PATH } from "@/lib/world-history/deeplink";
import { ListHeader } from "@/components/pokedex/detail/DetailParts";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import { localizePath } from "@/i18n/paths";
import timelineNs from "@/messages/timeline";
import stageNs from "@/messages/timeline-stage";
import pageNs from "@/messages/timeline-page";
import { TimelineExperience, type EraStart } from "./TimelineExperience";
import { TimelineList } from "./TimelineList";

/** Each era starts at its first generation's opener (Japanese release). */
export function eraStarts(): EraStart[] {
  return ERAS.map((era) => {
    const opener = TIMELINE.find((e) => e.lane === "games" && e.introduces === era.gens[0])!;
    return { id: era.id, start: opener.t, year: Math.floor(opener.t) };
  });
}

/**
 * /pokedex/timeline and each entry's own page (/pokedex/timeline/<id>): the
 * 3D view over the server-rendered list. An entry's page opens on that entry
 * and leads its HTML with the entry itself.
 */
export function TimelinePage({ focus }: { focus?: TimelineEntry }) {
  const t = serverT(pageNs);
  const entries = localTimeline(t.locale);
  const starts = eraStarts();
  const ld = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: t("ldName"),
    url: `${SITE_URL}${localizePath("/pokedex/timeline", t.locale)}`,
    numberOfItems: entries.length,
    itemListElement: entries.map((e, i) => ({ "@type": "ListItem", position: i + 1, name: e.title, url: `${SITE_URL}${localizePath(entryPath(e.id), t.locale)}` })),
  };
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <ClientMessages namespaces={[timelineNs, stageNs]}>
        <TimelineExperience entries={entries} eraStarts={starts} initialId={focus?.id ?? null}>
          <div className="space-y-6">
            {focus ? (
              <FocusHeader entry={focus} />
            ) : (
              <ListHeader
                kicker={t("kicker")}
                title={t("titleLead")}
                accent={t("titleAccent")}
                blurb={t("blurb")}
              />
            )}
            {WORLD_HISTORY_LIVE && (
              <p className="text-center text-sm text-muted-foreground" data-testid="timeline-to-history">
                {t.rich("toHistory", {
                  a: (c) => <Link href={HISTORY_PATH} prefetch={false} className="font-semibold text-foreground underline-offset-2 hover:underline">{c}</Link>,
                })}
              </p>
            )}
            <TimelineList entries={entries} eraStarts={starts} />
          </div>
        </TimelineExperience>
      </ClientMessages>
    </div>
  );
}

function FocusHeader({ entry }: { entry: TimelineEntry }) {
  const t = serverT(pageNs);
  const tl = serverT(timelineNs);
  return (
    <div className="space-y-3 text-center">
      <p className="hud-label text-screen">
        <Link href="/pokedex/timeline" className="hover:text-foreground">{t("timelineLink")}</Link> · {tl(`lanes.${entry.lane}`)} · {tl(`eras.${entry.era}.device`)}
      </p>
      <h1 className="break-words font-display text-3xl font-bold uppercase tracking-tight sm:text-5xl">{entry.title}</h1>
      <dl className="flex flex-wrap justify-center gap-x-5 gap-y-1 text-sm">
        {dateRows(entry).map((r) => (
          <div key={r.label} className="flex gap-1.5">
            <dt className="text-muted-foreground">{tl(`dates.${r.label}`)}</dt>
            <dd className="font-semibold tabular-nums">
              <time dateTime={r.date}>{formatDate(r.date, t.locale)}</time>
            </dd>
          </div>
        ))}
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">{t("platform")}</dt>
          <dd className="font-semibold">{entry.platform}</dd>
        </div>
      </dl>
      {entry.note && <p className="mx-auto max-w-2xl text-muted-foreground">{entry.note}</p>}
    </div>
  );
}
