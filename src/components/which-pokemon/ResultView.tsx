"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "@/components/ui/Link";
import { Download, Image as ImageIcon, Sparkles, Users } from "lucide-react";
import { track } from "@vercel/analytics";
import { Button, buttonVariants } from "@/components/ui/button";
import { ShareButton } from "@/components/share/ShareButton";
import { shareOrCopy } from "@/lib/share";
import { typeColor } from "@/lib/pokemon/type-colors";
import type { PooledPokemon, Profile } from "@/lib/which-pokemon/types";
import { QUIZ_PATH, cardPath, comparePath, encodeScores, matchProfile, parseFragment, resultPath, sharedTraits, typesOf, type MatchResult } from "@/lib/which-pokemon/match";
import { clearPendingCompare, lastResult, pendingCompare } from "@/lib/which-pokemon/local";
import { PokemonTile, TraitBars, useWpLocal } from "./parts";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { localizePath } from "@/i18n/paths";
import resultNs from "@/messages/which-pokemon-result";

const bold = (c: ReactNode[]) => <b className="text-foreground">{c}</b>;

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
  const t = useT(resultNs);
  const local = useWpLocal();

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
          <Sparkles className="h-5 w-5" aria-hidden /> {t("cta")}
        </Link>
        {mine && <OwnResultLink scores={mine} />}
      </section>
    );
  }

  const { scores, top, runnersUp, deepCut, partner, rival } = result;
  const accent = typeColor(typesOf(pokemon)[0] ?? "normal");
  const shared = sharedTraits(scores, pokemon.p);
  const url = () => `${window.location.origin}${localizePath(resultPath(pokemon.slug, scores), t.locale)}`;
  const compareUrl = () => `${window.location.origin}${localizePath(comparePath(scores), t.locale)}`;

  return (
    <div className="space-y-8" data-testid="wp-result">
      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold uppercase tracking-wide">{t("vs", { name })}</h2>
        <p className="text-sm text-muted-foreground">
          {t.rich("most", { name, x: t(`axes.${shared[0]}.inline`), y: t(`axes.${shared[1]}.inline`), pct: top.similarity, b: bold })}
        </p>
        <TraitBars a={scores} b={pokemon.p} bLabel={name} accent={accent} testId="wp-traits" />
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold uppercase tracking-wide">{t("share")}</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          <ShareButton size="lg" className="h-14" kind="which-pokemon" label={t("shareLabel")} getText={() => t("shareText", { name, title: local.title(pokemon), url: url() })} />
          <ShareCardButton scores={scores} name={name} />
          <CompareButton getUrl={compareUrl} />
        </div>
        {friend && <FriendCompare friend={friend} me={scores} />}
        {mine && <OwnResultLink scores={mine} compareWith={scores} />}
        <a href={cardPath(scores)} target="_blank" rel="noopener" className="mx-auto block aspect-[9/16] w-[180px] overflow-hidden rounded-lg border bg-shade/30" data-testid="wp-card" aria-label={t("openCard")}>
          {/* eslint-disable-next-line @next/next/no-img-element -- drawn on request, story-sized */}
          <img src={cardPath(scores)} alt={t("cardAlt", { name })} width={1080} height={1920} loading="lazy" className="h-full w-full object-cover" />
        </a>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold uppercase tracking-wide">{t("runnersUp")}</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {runnersUp.map((m) => (
            <PokemonTile key={m.pokemon.id} id={m.pokemon.id} name={local.name(m.pokemon)} title={local.title(m.pokemon)} percent={m.similarity} href={`${QUIZ_PATH}/${m.pokemon.slug}`} testId="wp-runner-up" />
          ))}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <h2 className="font-display text-base font-bold uppercase tracking-wide">{t("deepCut")}</h2>
          <p className="text-xs text-muted-foreground">{t("deepCutNote")}</p>
          <PokemonTile id={deepCut.species.id} name={local.species(deepCut.species.id, deepCut.species.name)} percent={deepCut.similarity} href={`/pokemon/${deepCut.species.slug}`} types={deepCut.species.types} testId="wp-deep-cut" />
        </div>
        <div className="space-y-2">
          <h2 className="font-display text-base font-bold uppercase tracking-wide">{t("partner")}</h2>
          <p className="text-xs text-muted-foreground">{t("partnerNote")}</p>
          <PokemonTile id={partner.pokemon.id} name={local.name(partner.pokemon)} title={local.title(partner.pokemon)} href={`${QUIZ_PATH}/${partner.pokemon.slug}`} testId="wp-partner" />
        </div>
        <div className="space-y-2">
          <h2 className="font-display text-base font-bold uppercase tracking-wide">{t("rival")}</h2>
          <p className="text-xs text-muted-foreground">{t("rivalNote")}</p>
          <PokemonTile id={rival.pokemon.id} name={local.name(rival.pokemon)} title={local.title(rival.pokemon)} href={`${QUIZ_PATH}/${rival.pokemon.slug}`} testId="wp-rival" />
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <Link href={QUIZ_PATH} className={buttonVariants({ variant: "outline" })} data-testid="wp-retake">
          {t("retake")}
        </Link>
        <Link href="/quiz" className={buttonVariants({ variant: "ghost" })}>
          {t("more")}
        </Link>
      </div>
    </div>
  );
}

/** Fetches the story-sized card and hands it to the share sheet (files) or downloads it. */
function ShareCardButton({ scores, name }: { scores: Profile; name: string }) {
  const [busy, setBusy] = useState(false);
  const t = useT(resultNs);
  async function save() {
    setBusy(true);
    try {
      const res = await fetch(cardPath(scores));
      const blob = await res.blob();
      const file = new File([blob], `which-pokemon-${name.toLowerCase()}.png`, { type: "image/png" });
      const data = { files: [file], title: t("cardTitle", { name }) };
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
      {busy ? <Download className="h-4 w-4 animate-pulse" aria-hidden /> : <ImageIcon className="h-4 w-4" aria-hidden />} {t("saveCard")}
    </Button>
  );
}

/** Copies the compare link: a friend who opens it takes the quiz and sees both results side by side. */
function CompareButton({ getUrl }: { getUrl: () => string }) {
  const [done, setDone] = useState(false);
  const t = useT(resultNs);
  async function copy() {
    const outcome = await shareOrCopy(t("compareText", { url: getUrl() }));
    if (outcome === "copied" || outcome === "shared") {
      setDone(true);
      track("share", { kind: "which-pokemon-compare", via: outcome });
      setTimeout(() => setDone(false), 2200);
    }
  }
  return (
    <Button size="lg" variant="secondary" className="h-14" onClick={() => void copy()} data-testid="wp-compare">
      <Users className="h-4 w-4" aria-hidden /> {done ? t("copied") : t("compare")}
    </Button>
  );
}

function FriendCompare({ friend, me }: { friend: Profile; me: Profile }) {
  const theirs = matchProfile(friend);
  const t = useT(resultNs);
  const local = useWpLocal();
  return (
    <Link href={comparePath(friend, me)} onClick={clearPendingCompare} className={cn(buttonVariants({ variant: "success", size: "lg" }), "h-14 w-full")} data-testid="wp-compare-friend">
      <Users className="h-5 w-5" aria-hidden /> {t("friend", { name: local.name(theirs.top.pokemon) })}
    </Link>
  );
}

function OwnResultLink({ scores, compareWith }: { scores: Profile; compareWith?: Profile }) {
  const own = matchProfile(scores);
  const t = useT(resultNs);
  const local = useWpLocal();
  const href = compareWith ? comparePath(scores, compareWith) : resultPath(own.top.pokemon.slug, scores);
  return (
    <Link href={href} className="block text-center text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" data-testid="wp-own">
      {compareWith ? t("ownCompare", { name: local.name(own.top.pokemon) }) : t("own", { name: local.name(own.top.pokemon) })}
    </Link>
  );
}
