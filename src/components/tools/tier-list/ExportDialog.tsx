"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Film, Volume2, VolumeX, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import tierList from "@/messages/tier-list";
import { ASPECTS, bracketGeometry, canvasBlob, drawBlind, drawBracket, drawChampion, drawTierList, drawTop, fileSlug, loadPictures, pageFonts, saveBlob, type Aspect, type Pictures } from "@/lib/tier-list/render";
import { finishingOrder, resolveBracket } from "@/lib/tier-list/bracket";
import { slotKeys } from "@/lib/tier-list/blind";
import type { Mode, ToolState } from "@/lib/tier-list/state";
import type { Mon } from "@/lib/tier-list/types";
import { Field, Modal, PillButton, Segmented } from "./ui";
import { useRoundName } from "./BracketMode";
import { modeName, type TierListT } from "./names";

export interface ExportInput {
  state: ToolState;
  byKey: ReadonlyMap<string, Mon>;
  title: string;
  /** The template's name, under the title. */
  subtitle: string;
  entrants: string[];
  drawn: string[];
}

type ImageKind = "board" | "bracket" | "champion";

/** The keys an image of the mode needs pictures for. */
function keysFor(mode: Mode, x: ExportInput): string[] {
  const s = x.state;
  if (mode === "tier") return s.tier.rows.flatMap((r) => r.items);
  if (mode === "top") return s.top.items;
  if (mode === "bracket") return x.entrants;
  return x.drawn;
}

export function hasContent(x: ExportInput): boolean {
  const s = x.state;
  if (s.mode === "tier") return s.tier.rows.some((r) => r.items.length);
  if (s.mode === "top") return s.top.items.length > 0;
  if (s.mode === "bracket") return s.bracket.started && x.entrants.length > 1;
  return s.blind.slots.some((v) => v >= 0);
}

/** Draws one of the mode's images at full size. */
export function drawImage(c: HTMLCanvasElement, kind: ImageKind, aspect: Aspect, x: ExportInput, pics: Pictures, labels: (r: number, n: number) => string, t: TierListT) {
  const s = x.state;
  const f = pageFonts();
  if (kind === "bracket") {
    const geo = bracketGeometry(x.entrants.length);
    const k = Math.min(2, 16000 / geo.W, 16000 / geo.H);
    c.width = Math.round(geo.W * k);
    c.height = Math.round(geo.H * k);
    const g = c.getContext("2d")!;
    g.setTransform(k, 0, 0, k, 0, 0);
    drawBracket(g, { title: x.title, entrants: x.entrants, picks: s.bracket.picks, byKey: x.byKey, labels }, pics, f, geo);
    return;
  }
  const { w, h } = ASPECTS[aspect];
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  if (kind === "champion") {
    const res = resolveBracket(x.entrants, s.bracket.picks);
    const order = finishingOrder(res);
    const champ = res.champion ? x.byKey.get(res.champion) : undefined;
    if (champ) drawChampion(g, w, h, { title: x.title, label: t("bracket.champion"), champion: champ, runnerUp: order[1] ? x.byKey.get(order[1]) : null, runnerLabel: t("bracket.runnerUp") }, pics, f);
    return;
  }
  if (s.mode === "tier") drawTierList(g, w, h, { title: x.title, subtitle: x.subtitle, rows: s.tier.rows, byKey: x.byKey }, pics, f);
  else if (s.mode === "top") drawTop(g, w, h, { title: x.title, subtitle: x.subtitle, top: s.top, byKey: x.byKey }, pics, f);
  else if (s.mode === "blind") {
    const runs = [{ name: s.blind.name || t("blind.you"), keys: slotKeys(s.blind.slots, x.drawn) }];
    if (s.blind.vs) runs.push({ name: s.blind.vs.name || t("blind.friend"), keys: slotKeys(s.blind.vs.slots, x.drawn) });
    drawBlind(g, w, h, { title: x.title, subtitle: x.subtitle, runs, byKey: x.byKey }, pics, f);
  }
}

export function ExportDialog({ input, onClose }: { input: ExportInput; onClose(): void }) {
  const t = useT(tierList);
  const labels = useRoundName();
  const s = input.state;
  const res = useMemo(() => (s.mode === "bracket" ? resolveBracket(input.entrants, s.bracket.picks) : null), [s.mode, s.bracket.picks, input.entrants]);
  const kinds: ImageKind[] = s.mode === "bracket" ? (res?.champion ? ["bracket", "champion"] : ["bracket"]) : ["board"];
  const [kind, setKind] = useState<ImageKind>(kinds[kinds.length - 1] === "champion" ? "champion" : kinds[0]);
  const [aspect, setAspect] = useState<Aspect>(s.mode === "tier" ? "wide" : "vertical");
  const [pics, setPics] = useState<Pictures | null>(null);
  const [failed, setFailed] = useState(false);
  const preview = useRef<HTMLCanvasElement>(null);
  const empty = !hasContent(input);

  useEffect(() => {
    let live = true;
    const keys = keysFor(s.mode, input);
    const mons = keys.map((k) => input.byKey.get(k)).filter((m): m is Mon => !!m);
    void loadPictures(mons, s.art, s.shiny).then((p) => live && setPics(p));
    return () => {
      live = false;
    };
  }, [input, s.mode, s.art, s.shiny]);

  useEffect(() => {
    if (!pics || !preview.current || empty) return;
    try {
      drawImage(preview.current, kind, aspect, input, pics, labels, t);
    } catch {
      setFailed(true);
    }
  }, [pics, kind, aspect, input, labels, t, empty]);

  const download = async () => {
    const c = preview.current;
    if (!c) return;
    try {
      const blob = await canvasBlob(c);
      if (!blob) throw new Error("no blob");
      saveBlob(blob, `pokeiq-${fileSlug(input.title)}-${kind === "board" ? s.mode : kind}${kind === "bracket" ? "" : `-${aspect}`}.png`);
    } catch {
      setFailed(true);
    }
  };

  return (
    <Modal title={t("export.title")} onClose={onClose} closeLabel={t("close")} wide testId="export-dialog">
      {empty ? (
        <p className="py-6 text-center text-muted-foreground">{t("export.nothing")}</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_260px]">
          <div className="flex min-h-[220px] items-center justify-center overflow-hidden rounded-2xl bg-foreground/[0.04] p-3">
            <canvas ref={preview} className={cn("max-h-[52vh] max-w-full rounded-lg shadow-lg", !pics && "opacity-0")} style={{ aspectRatio: kind === "bracket" ? undefined : `${ASPECTS[aspect].w} / ${ASPECTS[aspect].h}` }} data-testid="export-preview" />
            {!pics && <p className="absolute text-sm text-muted-foreground">{t("export.drawing")}</p>}
          </div>
          <div className="space-y-5">
            <Field label={t("export.image")}>
              {kinds.length > 1 && (
                <Segmented<ImageKind> size="sm" className="mb-2 w-full" label={t("export.image")} value={kind} onChange={setKind} options={kinds.map((k) => ({ value: k, label: k === "bracket" ? t("export.bracketImage") : t("export.championCard"), testId: `export-kind-${k}` }))} />
              )}
              {kind !== "bracket" && (
                <Segmented<Aspect>
                  size="sm"
                  className="w-full"
                  label={t("export.image")}
                  value={aspect}
                  onChange={setAspect}
                  options={(["square", "wide", "vertical"] as const).map((a) => ({ value: a, label: t(`export.${a}`), testId: `export-aspect-${a}` }))}
                />
              )}
              <PillButton primary className="mt-2 w-full" onClick={download} disabled={!pics} testId="export-png">
                <Download className="h-4 w-4" aria-hidden /> {t("export.png")}
              </PillButton>
              {failed && <p className="text-sm text-destructive">{t("export.imageFailed")}</p>}
            </Field>
            <VideoPanel input={input} />
          </div>
        </div>
      )}
    </Modal>
  );
}

function VideoPanel({ input }: { input: ExportInput }) {
  const t = useT(tierList);
  const labels = useRoundName();
  const [sound, setSound] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [out, setOut] = useState<{ url: string; blob: Blob; name: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => {
    abort.current?.abort();
  }, []);
  useEffect(() => () => {
    if (out) URL.revokeObjectURL(out.url);
  }, [out]);
  const make = async () => {
    setFailed(false);
    setOut(null);
    setBusy(0);
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      const { makeVideo } = await import("@/lib/tier-list/video");
      const r = await makeVideo({
        input,
        sound,
        fonts: pageFonts(),
        labels,
        text: {
          made: t("video.made"),
          champion: t("bracket.champion"),
          runnerUp: t("bracket.runnerUp"),
          you: t("blind.you"),
          friend: t("blind.friend"),
          mode: modeName(t, input.state.mode, input.state.top.length),
        },
        signal: ctl.signal,
        onProgress: (p) => setBusy(p),
      });
      setOut({ url: URL.createObjectURL(r.blob), blob: r.blob, name: `pokeiq-${fileSlug(input.title)}-${input.state.mode}.${r.ext}` });
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") setFailed(true);
    } finally {
      setBusy(null);
      abort.current = null;
    }
  };
  return (
    <Field label={t("export.video")}>
      <p className="-mt-1 text-sm text-muted-foreground">{t("export.videoHint")}</p>
      <button type="button" onClick={() => setSound((v) => !v)} aria-pressed={sound} className="flex h-10 items-center gap-2 rounded-full px-1 text-sm font-medium text-muted-foreground hover:text-foreground" data-testid="export-sound">
        {sound ? <Volume2 className="h-4 w-4" aria-hidden /> : <VolumeX className="h-4 w-4" aria-hidden />} {t("export.sound")}
        <span className={cn("relative ml-1 h-5 w-9 rounded-full transition-colors", sound ? "bg-primary" : "bg-foreground/20")}>
          <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-[left]", sound ? "left-[18px]" : "left-0.5")} />
        </span>
      </button>
      {busy !== null ? (
        <div className="space-y-2" data-testid="export-video-progress">
          <div className="h-2 overflow-hidden rounded-full bg-foreground/10">
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.round(busy * 100)}%` }} />
          </div>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{t("export.making", { pct: Math.round(busy * 100) })}</span>
            <button type="button" onClick={() => abort.current?.abort()} className="flex items-center gap-1 hover:text-foreground">
              <X className="h-3.5 w-3.5" aria-hidden /> {t("export.cancel")}
            </button>
          </div>
        </div>
      ) : out ? (
        <div className="space-y-2" data-testid="export-video-ready">
          <video src={out.url} className="mx-auto max-h-[240px] rounded-xl bg-black" controls playsInline muted={!sound} />
          <PillButton primary className="w-full" onClick={() => saveBlob(out.blob, out.name)} testId="export-video-save">
            <Download className="h-4 w-4" aria-hidden /> {t("export.save")}
          </PillButton>
        </div>
      ) : (
        <PillButton className="w-full" onClick={make} testId="export-video">
          <Film className="h-4 w-4" aria-hidden /> {t("export.makeVideo")}
        </PillButton>
      )}
      {failed && <p className="text-sm text-destructive">{t("export.failed")}</p>}
    </Field>
  );
}
