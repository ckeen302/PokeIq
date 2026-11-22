/* eslint-disable @next/next/no-img-element -- board art is pre-sized static WebP in public/art */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "@/components/ui/Link";
import { BackButton } from "@/components/ui/BackButton";
import { cn } from "@/lib/utils";
import { jsonLd, pageMetadata } from "@/lib/seo";
import { breadcrumbList } from "@/lib/structured-data";
import { boardArtUrl } from "@/lib/pokemon/art";
import { CASES, CASE_BY_SLUG } from "@/lib/theories/data";
import { relatedCases } from "@/lib/theories/logic";
import { THEORIES_PATH, casePath, type Evidence, type TheoryCase } from "@/lib/theories/types";
import { localizeCase, theoryTexts } from "@/lib/theories/i18n";
import { getLocale, serverT } from "@/i18n/server";
import type { Translator } from "@/i18n/catalog";
import dexTheories from "@/messages/dex-theories";
import { Art, GlitchBlock, Marked, Pin, Stamp } from "@/components/theories/Parts";
import s from "@/components/theories/theories.module.css";

export const dynamicParams = false;

export function generateStaticParams() {
  return CASES.map((c) => ({ slug: c.slug }));
}

interface PageProps {
  params: Promise<{ slug: string }>;
}

type T = Translator<typeof dexTheories.en>;

/** "CASE 001", in the page's language. */
const caseNo = (t: T, n: number) => t("caseNumber", { n: String(n).padStart(3, "0") });

/** The case in the render's language (its texts are loaded only for a language other than English). */
async function load(slug: string) {
  const locale = getLocale();
  const en = CASE_BY_SLUG.get(slug);
  if (!en) return { locale, c: undefined, all: CASES };
  const tx = await theoryTexts(locale);
  return { locale, c: localizeCase(en, tx, locale), all: tx ? CASES.map((x) => localizeCase(x, tx, locale)) : CASES };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { c } = await load((await params).slug);
  if (!c) return {};
  const t = serverT(dexTheories);
  const description = t(`case.metaDescription.${c.verdict}`, { claim: c.claim });
  return pageMetadata({
    title: t(`case.metaTitle.${c.verdict}`, { title: c.title }),
    description: description.length > 300 ? `${description.slice(0, 297)}…` : description,
    path: casePath(c.slug),
    socialTitle: t("case.socialTitle", { case: caseNo(t, c.n), title: c.title }),
  });
}

/** The pinned photos at the right of the case header, on a 507 × 400 design grid. */
function HeaderPhotos({ c }: { c: TheoryCase }) {
  const t = serverT(dexTheories);
  const photo = (i: number, style: React.CSSProperties, h: number, art?: { id: number; name: string }) => (
    <div className={s.hPhoto} style={style} data-testid="case-suspect">
      <Pin />
      <div className={s.ph} style={{ height: `calc(${h} * var(--u))`, background: i ? "hsl(var(--screen) / 0.22)" : "hsl(var(--secondary))" }}>
        {art ? <Art id={art.id} alt={art.name} style={i ? { filter: "drop-shadow(0 0 18px hsl(var(--screen) / 0.75))" } : undefined} /> : <GlitchBlock size={18} />}
      </div>
      <div className={s.hud} style={{ paddingTop: 9, fontSize: 11 }}>
        {art?.name ?? "MissingNo."}
      </div>
    </div>
  );
  const two = !c.glitch && c.art.length > 1;
  return (
    <div className={s.headerPics} aria-label={c.glitch ? t("case.glitchPokemon") : c.art.length > 1 ? t("case.pair", { a: c.art[0].name, b: c.art[1].name }) : (c.art[0]?.name ?? "")} role="img">
      {two ? (
        <>
          <svg aria-hidden className={s.hStrings} viewBox="0 0 507 400" preserveAspectRatio="none">
            <path d="M128 64 Q250 150 372 50" fill="none" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" opacity="0.85" />
          </svg>
          {photo(0, { left: "calc(30 * var(--u))", top: "calc(58 * var(--u))", width: "calc(196 * var(--u))", transform: "rotate(-6deg)" }, 180, c.art[0])}
          {photo(1, { left: "calc(272 * var(--u))", top: "calc(40 * var(--u))", width: "calc(206 * var(--u))", transform: "rotate(5deg)" }, 190, c.art[1])}
        </>
      ) : (
        photo(1, { left: "calc(150 * var(--u))", top: "calc(44 * var(--u))", width: "calc(206 * var(--u))", transform: "rotate(4deg)" }, 190, c.glitch ? undefined : c.art[0])
      )}
      <span className={s.hStamp} style={{ left: two ? "calc(150 * var(--u))" : "calc(60 * var(--u))", bottom: "calc(34 * var(--u))" }}>
        <Stamp verdict={c.verdict} label={t(`verdict.${c.verdict}`)} size="huge" />
      </span>
    </div>
  );
}

function EvidenceList({ items, kind }: { items: Evidence[]; kind: "for" | "against" }) {
  const t = serverT(dexTheories);
  return (
    <div className={s.panel} data-testid={`case-evidence-${kind}`}>
      <h2 className={s.h2}>
        <span aria-hidden className={cn(s.icon, kind === "for" ? "bg-success/15 text-success" : "bg-primary/15 text-primary")}>
          {kind === "for" ? "+" : "−"}
        </span>
        {t(kind === "for" ? "case.evidenceFor" : "case.evidenceAgainst")}
      </h2>
      <ol className="m-0 mt-3 list-none p-0">
        {items.map((e, i) => (
          <li key={i} className={s.ev} data-testid="case-evidence-item">
            <span className={cn(s.mono, s.num)}>{String(i + 1).padStart(2, "0")}</span>
            <div className="min-w-0">
              <div className={s.evt}>{e.text}</div>
              {e.quote && (
                <blockquote className={cn(s.mono, s.quote)}>
                  “<Marked text={e.quote} mark={e.mark} />”
                </blockquote>
              )}
              <span className={cn(s.mono, s.chip)}>{e.source}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default async function CasePage({ params }: PageProps) {
  const { c, all } = await load((await params).slug);
  if (!c) notFound();
  const t = serverT(dexTheories);
  const related = relatedCases(c, all);
  const filed = c.sources.map((x) => t(`source.${x}`)).reduce((a, b) => t("sourceList", { a, b }));

  return (
    <article className="mx-auto flex max-w-[1152px] flex-col gap-6" data-testid="case-page">
      <div>
        <BackButton href={THEORIES_PATH} label={t("case.back")} />
      </div>

      <header className={cn("dark-scope", s.header, s.gridBg)}>
        <div className="flex flex-col gap-4 p-9 max-md:p-5">
          <span className={cn(s.mono, "text-xs uppercase tracking-[0.08em] text-muted-foreground")}>
            {t("case.filed", { case: caseNo(t, c.n), era: c.era, sources: filed })}
          </span>
          <h1 className="m-0 font-display text-[52px] font-bold uppercase leading-none max-md:text-4xl">{c.title}</h1>
          <div className={cn(s.hud, "mt-1 text-warning")}>{t(c.verdict === "fan" ? "case.theory" : "case.claim")}</div>
          <p className="m-0 max-w-[540px] text-base leading-[1.65] text-foreground/85" data-testid="case-claim">
            {c.claim}
          </p>
        </div>
        <HeaderPhotos c={c} />
      </header>

      {c.silhouettes && (
        <section className={cn("dark-scope", s.panel, "grid items-center gap-7 md:grid-cols-[300px_minmax(0,1fr)]")} style={{ background: "hsl(var(--secondary) / 0.7)" }} aria-labelledby="exhibit-a">
          <div className="flex flex-col gap-2">
            <span className={cn(s.mono, "text-xs tracking-[0.08em] text-screen")}>{t("case.exhibitA")}</span>
            <h2 id="exhibit-a" className={s.h2}>
              {c.silhouettes.title}
            </h2>
            <p className="m-0 text-sm leading-relaxed text-muted-foreground">{c.silhouettes.text}</p>
          </div>
          <div className={s.silStrip} data-testid="case-silhouettes">
            {c.silhouettes.pair.map((a) => (
              <div key={a.id} className={s.sil}>
                <img src={boardArtUrl(a.id)} alt={t("case.silhouette", { name: a.name })} width={160} height={160} className={s.silImg} />
                <span className={cn(s.mono, "text-xs uppercase")}>{a.name}</span>
              </div>
            ))}
            <div className={s.sil}>
              <span className={s.overlay}>
                <img src={boardArtUrl(c.silhouettes.pair[0].id)} alt="" width={160} height={160} />
                <img src={boardArtUrl(c.silhouettes.pair[1].id)} alt="" width={160} height={160} />
              </span>
              <span className={cn(s.mono, "text-xs")}>{t("case.overlaid")}</span>
            </div>
          </div>
        </section>
      )}

      <section className={s.panel} aria-labelledby="origin" data-testid="case-origin">
        <h2 id="origin" className={s.h2}>
          {t("case.origin")}
        </h2>
        <p className="m-0 mt-3 text-[15px] leading-relaxed">{c.origin}</p>
      </section>

      <div className="grid gap-5 md:grid-cols-2">
        <EvidenceList items={c.evidenceFor} kind="for" />
        <EvidenceList items={c.evidenceAgainst} kind="against" />
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <section className={cn(s.panel, "flex flex-col gap-2.5")} aria-labelledby="confirmed" data-testid="case-confirmed">
          <h2 id="confirmed" className={cn(s.hud, "m-0 text-success")}>
            {t("case.confirmed")}
          </h2>
          <p className="m-0 text-[15px] leading-relaxed">{c.confirmed}</p>
        </section>
        <section className={cn("dark-scope", s.panel, s.gridBg, "flex items-center gap-6 max-sm:flex-col max-sm:items-start")} aria-labelledby="verdict" data-testid="case-verdict">
          <Stamp verdict={c.verdict} label={t(`verdict.${c.verdict}`)} size="big" className="shrink-0" />
          <div className="flex flex-col gap-1.5">
            <h2 id="verdict" className={cn(s.hud, "m-0 text-muted-foreground")}>
              {t("case.verdict")}
            </h2>
            <p className="m-0 text-[15px] leading-relaxed">{c.verdictText}</p>
          </div>
        </section>
      </div>

      <section className={s.panel} aria-labelledby="sources" data-testid="case-sources">
        <h2 id="sources" className={s.h2}>
          {t("case.sources")}
        </h2>
        <ul className="m-0 mt-3 list-none space-y-2 p-0">
          {c.links.map((l) => (
            <li key={l.url} className="text-sm leading-snug">
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-foreground underline decoration-screen/50 underline-offset-2 hover:text-screen" data-testid="case-source-link">
                {l.label}
              </a>
              <span className={cn(s.mono, "ml-2 break-all text-[11px] text-muted-foreground")}>{new URL(l.url).hostname.replace(/^www\./, "")}</span>
            </li>
          ))}
        </ul>
      </section>

      {related.length > 0 && (
        <section className="flex flex-col gap-1.5" aria-labelledby="related">
          <h2 id="related" className={cn(s.hud, "m-0 text-muted-foreground")}>
            {t("case.related")}
          </h2>
          <ul className="m-0 grid list-none gap-x-4 gap-y-1 p-0 md:grid-cols-3">
            {related.map((r) => (
              <li key={r.slug}>
                <Link href={casePath(r.slug)} className={s.rel} data-testid="case-related">
                  <span className={cn(s.mono, s.rtab)}>{caseNo(t, r.n)}</span>
                  <span className={s.relArt}>{r.glitch || !r.art.length ? <GlitchBlock size={10} /> : <Art id={r.art[0].id} alt="" />}</span>
                  <span className="flex flex-col items-start gap-1.5">
                    <span className="font-display font-bold uppercase leading-tight">{r.title}</span>
                    <Stamp verdict={r.verdict} label={t(`verdict.${r.verdict}`)} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-center text-xs text-muted-foreground">
        {t(`case.footer.${c.verdict}`)}
      </p>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbList([{ name: t("ld.pokedex"), path: "/pokedex" }, { name: t("ld.theories"), path: THEORIES_PATH }, { name: c.title, path: casePath(c.slug) }])) }}
      />
    </article>
  );
}
