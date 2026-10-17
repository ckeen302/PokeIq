/* eslint-disable @next/next/no-img-element -- pre-sized art */
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center">
      <div className="spotlight flex h-44 w-44 items-center justify-center rounded-3xl">
        <img src="/api/art/201?s=160" alt="" className="h-32 w-32 object-contain [filter:brightness(0)]" />
      </div>
      <div className="space-y-2">
        <h1 className="text-4xl font-black tracking-tight">A wild 404 appeared!</h1>
        <p className="mx-auto max-w-sm text-muted-foreground">
          This page fled. Even the Pokédex has no entry for it.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Link href="/" className="rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90">
          Back to safety
        </Link>
        <Link href="/pokedex" className="rounded-full border px-5 py-2.5 text-sm font-bold hover:bg-accent">
          Open the Pokédex
        </Link>
      </div>
    </div>
  );
}
