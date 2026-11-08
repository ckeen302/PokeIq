"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Admins: send today's daily email (marked [Test]) to yourself. */
export function AdminEmailTest() {
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/email/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(to.trim() ? { to: to.trim() } : {}) });
      const body = (await res.json().catch(() => ({}))) as { to?: string; error?: string };
      setNote(res.ok ? `Sent to ${body.to}.` : (body.error ?? `Failed (${res.status}).`));
    } catch {
      setNote("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={send} className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-3" data-testid="admin-email-test">
      <span className="hud-label w-full">Daily email test</span>
      <input
        type="email"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        placeholder="Your address on file, or another"
        className="h-10 min-w-0 flex-1 basis-56 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <Button type="submit" variant="outline" disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />} Send test
      </Button>
      {note && (
        <p className="w-full text-sm text-muted-foreground" role="status">
          {note}
        </p>
      )}
    </form>
  );
}
