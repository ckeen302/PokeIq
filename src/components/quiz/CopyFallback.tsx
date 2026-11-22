"use client";

import { useT } from "@/i18n/client";
import copyNs from "@/messages/copy-fallback";

/** Shown when neither the share sheet nor the clipboard worked: select and copy by hand. */
export function CopyFallback({ text }: { text: string }) {
  const t = useT(copyNs);
  return (
    <div className="space-y-1.5 text-left" role="status">
      <p className="text-xs font-medium text-destructive">{t("failed")}</p>
      <textarea
        readOnly
        value={text}
        rows={Math.min(6, text.split("\n").length)}
        onFocus={(e) => e.currentTarget.select()}
        className="w-full resize-none rounded-md border border-input bg-shade/20 p-2 font-mono text-xs"
        aria-label={t("label")}
      />
    </div>
  );
}
