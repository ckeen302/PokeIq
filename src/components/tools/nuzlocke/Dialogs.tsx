"use client";

import { useState } from "react";
import type { Rules } from "@/lib/nuzlocke/run";
import { Modal } from "../tier-list/ui";
import { RulesForm } from "./RulesForm";
import type { NuzT } from "./parts";

const button = "h-12 flex-1 rounded-full text-[15px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The run's rules, to change mid-run (a shared run shows them, read-only). */
export function RulesDialog({ t, rules, readOnly, onClose, onSave }: { t: NuzT; rules: Rules; readOnly: boolean; onClose(): void; onSave(r: Rules): void }) {
  const [draft, setDraft] = useState(rules);
  return (
    <Modal title={t("rules.title")} onClose={onClose} closeLabel={t("picker.close")} testId="nz-rules-dialog">
      <RulesForm t={t} rules={draft} onChange={readOnly ? () => undefined : setDraft} />
      {!readOnly && (
        <div className="mt-5 flex">
          <button type="button" onClick={() => onSave(draft)} className={`${button} bg-primary text-primary-foreground hover:brightness-110`} data-testid="nz-rules-save">
            {t("rules.done")}
          </button>
        </div>
      )}
    </Modal>
  );
}

export function DeleteDialog({ t, name, onClose, onDelete }: { t: NuzT; name: string; onClose(): void; onDelete(): void }) {
  return (
    <Modal title={t("header.deleteTitle")} onClose={onClose} closeLabel={t("header.deleteCancel")} testId="nz-delete">
      <p className="text-[15px] leading-relaxed text-muted-foreground">{t("header.deleteText", { name })}</p>
      <div className="mt-5 flex gap-2">
        <button type="button" onClick={onClose} className={`${button} bg-foreground/[0.07] hover:bg-foreground/[0.11]`}>
          {t("header.deleteCancel")}
        </button>
        <button type="button" onClick={onDelete} className={`${button} bg-destructive text-destructive-foreground hover:brightness-110`} data-testid="nz-delete-confirm">
          {t("header.deleteConfirm")}
        </button>
      </div>
    </Modal>
  );
}

/** A backup of a run that's already here: replace it, or keep both. */
export function ImportDialog({ t, name, onClose, onReplace, onKeepBoth }: { t: NuzT; name: string; onClose(): void; onReplace(): void; onKeepBoth(): void }) {
  return (
    <Modal title={name} onClose={onClose} closeLabel={t("picker.close")} testId="nz-import">
      <p className="text-[15px] leading-relaxed text-muted-foreground">{t("share.importSame")}</p>
      <div className="mt-5 flex gap-2">
        <button type="button" onClick={onKeepBoth} className={`${button} bg-foreground/[0.07] hover:bg-foreground/[0.11]`}>
          {t("share.keepBoth")}
        </button>
        <button type="button" onClick={onReplace} className={`${button} bg-primary text-primary-foreground hover:brightness-110`} data-testid="nz-import-replace">
          {t("share.replace")}
        </button>
      </div>
    </Modal>
  );
}
