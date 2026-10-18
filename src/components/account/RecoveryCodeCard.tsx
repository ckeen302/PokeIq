"use client";

import { useState } from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Shows a one-time recovery code; the trainer must confirm they saved it. */
export function RecoveryCodeCard({ code, title, note, onDone }: { code: string; title: string; note: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the code is on screen to copy by hand.
    }
  }

  return (
    <div className="space-y-4 text-center">
      <KeyRound className="mx-auto h-8 w-8 text-warning" aria-hidden />
      <h2 className="font-display text-2xl font-bold uppercase">{title}</h2>
      <p className="text-sm text-muted-foreground">{note}</p>
      <output
        className="block select-all rounded-md border-2 border-warning/50 bg-warning/10 px-4 py-3 font-mono text-lg font-bold tracking-wider text-warning"
        aria-label="Recovery code"
      >
        {code}
      </output>
      <Button variant="outline" className="w-full" onClick={() => void copy()}>
        {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
        {copied ? "Copied" : "Copy code"}
      </Button>
      <label className="flex cursor-pointer items-center justify-center gap-2 text-sm text-muted-foreground">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="h-4 w-4 accent-[hsl(var(--primary))]" />
        I saved my recovery code somewhere safe
      </label>
      <Button size="lg" className="w-full" disabled={!saved} onClick={onDone}>
        Continue
      </Button>
    </div>
  );
}
