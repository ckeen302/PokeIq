"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCcw } from "lucide-react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-5 text-center">
      <div className="text-6xl" aria-hidden>
        💫
      </div>
      <div className="space-y-2">
        <h1 className="text-3xl font-black tracking-tight">It&apos;s super effective… against us.</h1>
        <p className="mx-auto max-w-sm text-muted-foreground">Something broke on our side. Give it another try.</p>
        {error.digest && <p className="font-mono text-xs text-muted-foreground">Ref: {error.digest}</p>}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90"
        >
          <RotateCcw className="h-4 w-4" /> Try again
        </button>
        <Link href="/" className="rounded-full border px-5 py-2.5 text-sm font-bold hover:bg-accent">
          Home
        </Link>
      </div>
    </div>
  );
}
