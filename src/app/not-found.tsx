/* eslint-disable @next/next/no-img-element -- pre-sized art */
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center">
      <div className="screen spotlight flex h-44 w-44 items-center justify-center rounded-md border-[3px] border-black/70">
        <img src="/api/art/201?s=160" alt="" className="relative z-[1] h-32 w-32 object-contain [filter:brightness(0)]" />
      </div>
      <div className="space-y-2">
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">A wild 404 appeared!</h1>
        <p className="mx-auto max-w-sm text-muted-foreground">
          This page fled. Even the Pokédex has no entry for it.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Link href="/" className={buttonVariants()}>
          Back to safety
        </Link>
        <Link href="/pokedex" className={buttonVariants({ variant: "outline" })}>
          Open the Pokédex
        </Link>
      </div>
    </div>
  );
}
