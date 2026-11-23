"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Download, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import picker from "@/messages/favorite-picker";
import type { ArtStyle } from "@/lib/tier-list/art";
import { canvasBlob, fileSlug, pageFonts, saveBlob } from "@/lib/tier-list/render";
import { SIZES, drawChart, drawResult, loadSlotPictures, type PicSlot, type Size } from "@/lib/favorite-picker/render";
import type { TypeName } from "@/lib/tier-list/types";
import { Field, Modal, PillButton, Segmented } from "../tier-list/ui";
import { typeName } from "./common";

/** Share (a link that holds the result) and Download (a square or tall PNG of the result or the type chart). */

export function ShareDialog({ url, onClose }: { url: string | null; onClose(): void }) {
  const t = useT(picker);
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const el = document.getElementById("fp-share-url") as HTMLInputElement | null;
      el?.select();
      document.execCommand?.("copy");
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <Modal title={t("share.title")} onClose={onClose} closeLabel={t("close")} testId="fp-share-dialog">
      {url ? (
        <div className="space-y-4">
          <p className="text-[14px] text-muted-foreground">{t("share.hint")}</p>
          <input id="fp-share-url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="h-12 w-full rounded-xl border border-foreground/[0.1] bg-background px-3 text-[16px] text-muted-foreground outline-none focus:border-primary/60" data-testid="fp-share-url" aria-label={t("share.title")} />
          <div className="flex gap-2">
            <PillButton primary onClick={copy} className="flex-1" testId="fp-share-copy">
              {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />} {copied ? t("share.copied") : t("share.copy")}
            </PillButton>
            {canShare && (
              <PillButton onClick={() => navigator.share({ url }).catch(() => undefined)} className="flex-1">
                <Share2 className="h-4 w-4" aria-hidden /> {t("share.native")}
              </PillButton>
            )}
          </div>
        </div>
      ) : (
        <p className="py-6 text-center text-muted-foreground">{t("share.nothing")}</p>
      )}
    </Modal>
  );
}

export type ExportKind = "result" | "chart";

export interface ExportInput {
  top: PicSlot[];
  chart: Partial<Record<TypeName, PicSlot>>;
  from: string;
  art: ArtStyle;
}

export function ExportDialog({ input, initial, onClose }: { input: ExportInput; initial: ExportKind; onClose(): void }) {
  const t = useT(picker);
  const kinds: ExportKind[] = [...(input.top.length ? (["result"] as const) : []), ...(Object.keys(input.chart).length ? (["chart"] as const) : [])];
  const [kind, setKind] = useState<ExportKind>(kinds.includes(initial) ? initial : kinds[0] ?? "result");
  const [size, setSize] = useState<Size>("square");
  const [pics, setPics] = useState<Awaited<ReturnType<typeof loadSlotPictures>> | null>(null);
  const [failed, setFailed] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let live = true;
    setPics(null);
    const slots = kind === "result" ? input.top.slice(0, 10) : (Object.values(input.chart).filter(Boolean) as PicSlot[]);
    void loadSlotPictures(slots, input.art).then((p) => live && setPics(p));
    return () => {
      live = false;
    };
  }, [kind, input]);

  useEffect(() => {
    const c = canvas.current;
    if (!pics || !c) return;
    try {
      const { w, h } = SIZES[size];
      c.width = w;
      c.height = h;
      const g = c.getContext("2d")!;
      const f = pageFonts();
      if (kind === "result") drawResult(g, w, h, { eyebrow: t("export.heading"), topLabel: t("export.topHeading", { n: Math.min(10, input.top.length) }), from: input.from, top: input.top.slice(0, 10) }, pics, f);
      else drawChart(g, w, h, { title: t("export.chartHeading"), typeName: (ty) => typeName(t, ty), slots: input.chart }, pics, f);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [pics, size, kind, input, t]);

  const download = async () => {
    const c = canvas.current;
    if (!c) return;
    try {
      const blob = await canvasBlob(c);
      if (!blob) throw new Error("no blob");
      const name = kind === "result" ? fileSlug(input.top[0]?.mon.n ?? "favorite") : "type-chart";
      saveBlob(blob, `pokeiq-favorite-${name}-${size}.png`);
    } catch {
      setFailed(true);
    }
  };

  return (
    <Modal title={t("export.title")} onClose={onClose} closeLabel={t("close")} wide testId="fp-export-dialog">
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_240px]">
        <div className="relative flex min-h-[260px] items-center justify-center overflow-hidden rounded-2xl bg-foreground/[0.04] p-3">
          <canvas ref={canvas} className={cn("max-h-[56vh] max-w-full rounded-lg shadow-lg", !pics && "opacity-0")} style={{ aspectRatio: `${SIZES[size].w} / ${SIZES[size].h}` }} data-testid="fp-export-preview" data-ready={pics ? "1" : "0"} />
          {!pics && <p className="absolute text-sm text-muted-foreground">{t("export.drawing")}</p>}
        </div>
        <div className="space-y-5">
          {kinds.length > 1 && (
            <Field label={t("export.image")}>
              <Segmented<ExportKind> size="sm" className="w-full" label={t("export.image")} value={kind} onChange={setKind} options={kinds.map((k) => ({ value: k, label: t(`export.${k}`), testId: `fp-export-kind-${k}` }))} />
            </Field>
          )}
          <Field label={t("export.size")}>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("export.size")}>
              {(["square", "tall"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={size === s}
                  onClick={() => setSize(s)}
                  className={cn("flex flex-col items-center gap-1.5 rounded-2xl border px-2 py-3 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", size === s ? "border-primary/60 bg-primary/[0.1]" : "border-foreground/[0.08] hover:bg-foreground/[0.05]")}
                  data-testid={`fp-export-size-${s}`}
                >
                  <span className={cn("rounded-[5px] border-2 border-current", s === "square" ? "h-7 w-7" : "h-9 w-5", size === s ? "text-primary" : "text-muted-foreground")} aria-hidden />
                  <span className="text-[13px] font-semibold">{t(`export.${s}`)}</span>
                  <span className="text-[12px] text-muted-foreground">{t(`export.${s}Hint`)}</span>
                </button>
              ))}
            </div>
          </Field>
          <PillButton primary className="w-full" onClick={download} disabled={!pics} testId="fp-export-png">
            <Download className="h-4 w-4" aria-hidden /> {t("export.png")}
          </PillButton>
          {failed && <p className="text-sm text-destructive">{t("export.failed")}</p>}
        </div>
      </div>
    </Modal>
  );
}
