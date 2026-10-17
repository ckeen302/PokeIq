"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-5 text-center">
      <p className="hud-label flex items-center gap-2 text-destructive">
        <span className="led h-1.5 w-1.5 animate-blink text-destructive" /> System error
      </p>
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-bold uppercase tracking-tight">It&apos;s super effective… against us.</h1>
        <p className="mx-auto max-w-sm text-muted-foreground">Something broke on our side. Give it another try.</p>
        {error.digest && <p className="font-mono text-xs text-muted-foreground">Ref: {error.digest}</p>}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={reset} className={buttonVariants()}>
          <RotateCcw className="h-4 w-4" /> Try again
        </button>
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          Home
        </Link>
      </div>
    </div>
  );
}
