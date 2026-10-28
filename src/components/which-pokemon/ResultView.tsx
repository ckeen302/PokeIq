"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, Image as ImageIcon, Sparkles, Users } from "lucide-react";
import { track } from "@vercel/analytics";
import { Button, buttonVariants } from "@/components/ui/button";
import { ShareButton } from "@/components/share/ShareButton";
import { shareOrCopy } from "@/lib/share";
import { typeColor } from "@/lib/pokemon/type-colors";
import { AXIS_INFO, type PooledPokemon, type Profile } from "@/lib/which-pokemon/types";
import { QUIZ_PATH, cardPath, comparePath, encodeScores, matchProfile, nameOf, parseFragment, resultPath, sharedTraits, typesOf, type MatchResult } from "@/lib/which-pokemon/match";
import { clearPendingCompare, lastResult, pendingCompare } from "@/lib/which-pokemon/local";
import { PokemonTile, TraitBars } from "./parts";
import { cn } from "@/lib/utils";

/**
 * The personal half of a result page. The page itself is static (one per
 * pooled Pokémon); the player's scores arrive in the URL fragment, so this
 * renders their trait bars, runners-up, deep cut, partner and rival, the
 * share actions and the compare link, or a "take the quiz" invitation when
 * there's no result in the address.
 */
export function ResultView({ pokemon, name }: { pokemon: PooledPokemon; name: string }) {
  const [result, setResult] = useState<MatchResult | null>(null);
  const [ready, setReady] = useState(false);
  const [friend, setFriend] = useState<Profile | null>(null);
  const [mine, setMine] = useState<Profile | null>(null);

  useEffect(() => {
    const scores = parseFragment(window.location.hash).r;
    if (scores) setResult(matchProfile(scores, pokemon));
    const pending = pendingCompare();
    if (pending) setFriend(pending);
    const own = lastResult();
    if (own && (!scores || encodeScores(own) !== encodeScores(scores))) setMine(own);
    setReady(true);
    const onHash = () => {
      const next = parseFragment(window.location.hash).r;
      setResult(next ? matchProfile(next, pokemon) : null);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [pokemon]);

  if (!ready) return <div className="min-h-24" aria-hidden />;

  if (!result) {
    return (
      <section className="space-y-4" data-testid="wp-cta">
        <Link href={QUIZ_PATH} className={cn(buttonVariants({ size: "lg" }), "h-14 w-full text-base")} data-testid="wp-take-quiz">
          <Sparkles className="h-5 w-5" aria-hidden /> Find out which Pokémon you are
        </Link>
        {mine && <OwnResultLink scores={mine} />}
      </section>
    );
  }

  const { scores, top, runnersUp, deepCut, partner, rival } = result;
  const accent = typeColor(typesOf(pokemon)[0] ?? "normal");
  const shared = sharedTraits(scores, pokemon.p);
  const url = () => `${window.location.origin}${resultPath(pokemon.slug, scores)}`;
  const compareUrl = () => `${window.location.origin}${comparePath(scores)}`;

  return (
    <div className="space-y-8" data-testid="wp-result">
      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold uppercase tracking-wide">Your traits vs {name}&apos;s</h2>
        <p className="text-sm text-muted-foreground">
          Where you&apos;re most {name}: <b className="text-foreground">{AXIS_INFO[shared[0]].label.toLowerCase()}</b> and{" "}
          <b className="text-foreground">{AXIS_INFO[shared[1]].label.toLowerCase()}</b>. {top.similarity}% match overall.
        </p>
        <TraitBars a={scores} b={pokemon.p} bLabel={name} accent={accent} testId="wp-traits" />
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold uppercase tracking-wide">Share it</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          <ShareButton size="lg" className="h-14" kind="which-pokemon" label="Share result" getText={() => `I'm ${name}, ${pokemon.title}! Which Pokémon are you?\n${url()}`} />
          <ShareCardButton scores={scores} name={name} />
          <CompareButton getUrl={compareUrl} />
        </div>
        {friend && <FriendCompare friend={friend} me={scores} />}
        {mine && <OwnResultLink scores={mine} compareWith={scores} />}
        <a href={cardPath(scores)} target="_blank" rel="noopener" className="mx-auto block aspect-[9/16] w-[180px] overflow-hidden rounded-lg border bg-shade/30" data-testid="wp-card" aria-label="Open the share card">
          {/* eslint-disable-next-line @next/next/no-img-element -- drawn on request, story-sized */}
          <img src={cardPath(scores)} alt={`${name} share card`} width={1080} height={1920} loading="lazy" className="h-full w-full object-cover" />
        </a>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold uppercase tracking-wide">Runners-up</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {runnersUp.map((m) => (
            <PokemonTile key={m.pokemon.id} id={m.pokemon.id} name={nameOf(m.pokemon)} title={m.pokemon.title} percent={m.similarity} href={`${QUIZ_PATH}/${m.pokemon.slug}`} testId="wp-runner-up" />
          ))}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <h2 className="font-display text-base font-bold uppercase tracking-wide">Deep cut</h2>
          <p className="text-xs text-muted-foreground">Your closest match among the other {1025 - 200} Pokémon.</p>
          <PokemonTile id={deepCut.species.id} name={deepCut.species.name} percent={deepCut.similarity} href={`/pokemon/${deepCut.species.slug}`} types={deepCut.species.types} testId="wp-deep-cut" />
        </div>
        <div className="space-y-2">
          <h2 className="font-display text-base font-bold uppercase tracking-wide">Best partner</h2>
          <p className="text-xs text-muted-foreground">Same heart, opposite habits: the teammate who covers you.</p>
          <PokemonTile id={partner.pokemon.id} name={nameOf(partner.pokemon)} title={partner.pokemon.title} href={`${QUIZ_PATH}/${partner.pokemon.slug}`} testId="wp-partner" />
        </div>
        <div className="space-y-2">
          <h2 className="font-display text-base font-bold uppercase tracking-wide">Rival</h2>
          <p className="text-xs text-muted-foreground">Alike in most ways, opposite on competitiveness and warmth.</p>
          <PokemonTile id={rival.pokemon.id} name={nameOf(rival.pokemon)} title={rival.pokemon.title} href={`${QUIZ_PATH}/${rival.pokemon.slug}`} testId="wp-rival" />
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <Link href={QUIZ_PATH} className={buttonVariants({ variant: "outline" })} data-testid="wp-retake">
          Take it again
        </Link>
        <Link href="/play" className={buttonVariants({ variant: "ghost" })}>
          More quizzes
        </Link>
      </div>
    </div>
  );
}

/** Fetches the story-sized card and hands it to the share sheet (files) or downloads it. */
function ShareCardButton({ scores, name }: { scores: Profile; name: string }) {
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const res = await fetch(cardPath(scores));
      const blob = await res.blob();
      const file = new File([blob], `which-pokemon-${name.toLowerCase()}.png`, { type: "image/png" });
      const data = { files: [file], title: `I'm ${name}!` };
      if (typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare(data)) {
        await navigator.share(data).catch(() => {});
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      }
      track("share", { kind: "which-pokemon-card" });
    } catch {
      window.open(cardPath(scores), "_blank", "noopener");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button size="lg" variant="outline" className="h-14" onClick={() => void save()} disabled={busy} data-testid="wp-save-card">
      {busy ? <Download className="h-4 w-4 animate-pulse" aria-hidden /> : <ImageIcon className="h-4 w-4" aria-hidden />} Save story card
    </Button>
  );
}

/** Copies the compare link: a friend who opens it takes the quiz and sees both results side by side. */
function CompareButton({ getUrl }: { getUrl: () => string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    const outcome = await shareOrCopy(`Which Pokémon are you? Take the quiz and see how we match:\n${getUrl()}`);
    if (outcome === "copied" || outcome === "shared") {
      setDone(true);
      track("share", { kind: "which-pokemon-compare", via: outcome });
      setTimeout(() => setDone(false), 2200);
    }
  }
  return (
    <Button size="lg" variant="secondary" className="h-14" onClick={() => void copy()} data-testid="wp-compare">
      <Users className="h-4 w-4" aria-hidden /> {done ? "Link copied!" : "Compare with a friend"}
    </Button>
  );
}

function FriendCompare({ friend, me }: { friend: Profile; me: Profile }) {
  const theirs = matchProfile(friend);
  return (
    <Link href={comparePath(friend, me)} onClick={clearPendingCompare} className={cn(buttonVariants({ variant: "success", size: "lg" }), "h-14 w-full")} data-testid="wp-compare-friend">
      <Users className="h-5 w-5" aria-hidden /> See how you match with your friend ({nameOf(theirs.top.pokemon)})
    </Link>
  );
}

function OwnResultLink({ scores, compareWith }: { scores: Profile; compareWith?: Profile }) {
  const own = matchProfile(scores);
  const href = compareWith ? comparePath(scores, compareWith) : resultPath(own.top.pokemon.slug, scores);
  return (
    <Link href={href} className="block text-center text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" data-testid="wp-own">
      {compareWith ? `Compare this result with yours (${nameOf(own.top.pokemon)})` : `See your own result (${nameOf(own.top.pokemon)})`}
    </Link>
  );
}
