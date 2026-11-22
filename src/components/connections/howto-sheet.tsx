"use client";

import { CONN_LEVELS_4, CONN_MAX_MISTAKES, type ConnLevel } from "@/lib/connections/types";
import { LevelMark, levelName, levelStyle } from "./parts";
import { useT } from "@/i18n/client";
import conn from "@/messages/connections";
import board from "@/messages/connections-board";
import { HowToActions, HowToCards, HowToDialog } from "@/components/howto/shared";
import { ConnectionsDemo } from "@/components/howto/ConnectionsDemo";

/**
 * PokéConnections' how to play. It comes with the board, not with the other
 * pop-ups: a first visit's copy is in the page's HTML (see Connections).
 */

const KINDS = ["types", "origins", "evolution", "battle", "stats", "look", "forms", "breeding", "names"] as const;

export function ConnHowToSheet({ onClose, onNever }: { onClose: () => void; onNever?: () => void }) {
  const t = useT(conn);
  const tb = useT(board);
  const b = (c: React.ReactNode[]) => <b>{c}</b>;
  const strong = (c: React.ReactNode[]) => <b className="text-foreground">{c}</b>;
  const kbd = (c: React.ReactNode[]) => <kbd className="rounded border px-1">{c}</kbd>;
  return (
    <HowToDialog onClose={onClose} testId="howto-sheet" footer={<HowToActions onClose={onClose} onNever={onNever} />}>
      <ConnectionsDemo />
      <HowToCards
        cards={[
          { title: t("howto.goal"), body: <p>{t("howto.goalBody")}</p> },
          {
            title: t("howto.core"),
            body: <p>{t("howto.coreBody", { n: CONN_MAX_MISTAKES })}</p>,
          },
          { title: t("howto.colours"), body: <p>{t("howto.coloursBody")}</p> },
          { title: t("howto.daily"), body: <p>{t("howto.dailyBody")}</p> },
        ]}
      />
      <details className="rounded-md border bg-shade/30 p-3">
        <summary className="tap cursor-pointer font-semibold max-sm:py-2.5">{t("howto.full")}</summary>
      <div className="mt-3 space-y-4">
      <p>{t.rich("howto.fullGoal", { b })}</p>
      <ul className="space-y-1.5">
        <li>{t.rich("howto.fullMistakes", { n: CONN_MAX_MISTAKES, b })}</li>
        <li>{t.rich("howto.fullOneAway", { b })}</li>
        <li>{t.rich("howto.fullRepeat", { b })}</li>
        <li>{t("howto.fullUnique")}</li>
      </ul>
      <div className="space-y-2 rounded-md border bg-shade/30 p-3">
        <p className="font-semibold">{t("howto.coloursOrder")}</p>
        <div className="flex flex-wrap gap-2">
          {CONN_LEVELS_4.map((l, i) => (
            <span key={l.name} className="flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-bold uppercase tracking-wide" style={levelStyle(i as ConnLevel)}>
              <LevelMark level={i as ConnLevel} /> {levelName(tb, i as ConnLevel)}
            </span>
          ))}
        </div>
      </div>
      <div className="space-y-1.5 rounded-md border bg-shade/30 p-3">
        <p className="font-semibold">{t("howto.links")}</p>
        <ul className="space-y-1">
          {KINDS.map((k) => (
            <li key={k}>
              <b>{t(`howto.kinds.${k}`)}:</b> <span className="text-muted-foreground">{t(`howto.kinds.${k}Line`)}</span>
            </li>
          ))}
        </ul>
      </div>
      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
        <li>{t.rich("howto.baseForms", { b: strong })}</li>
        <li>{t.rich("howto.facts", { b: strong })}</li>
        <li>{t.rich("howto.newDaily", { b: strong })}</li>
        <li>{t.rich("howto.keys", { k: kbd })}</li>
      </ul>
      </div>
      </details>
    </HowToDialog>
  );
}
