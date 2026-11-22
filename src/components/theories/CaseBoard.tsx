/* eslint-disable @next/next/no-img-element -- board art is pre-sized static WebP in public/art */
import Link from "@/components/ui/Link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { boardArtUrl } from "@/lib/pokemon/art";
import { casePath, type Board, type TheoryCase } from "@/lib/theories/types";
import { sourceLine } from "@/lib/theories/logic";
import { Art, Badge, Bolded, ExhibitIcon, GlitchBlock, Marked, Pin, Stamp, dexNo } from "./Parts";
import s from "./theories.module.css";
import { serverT } from "@/i18n/server";
import dexTheories from "@/messages/dex-theories";

/**
 * The Case of the week evidence board: the dossier on the left, the evidence
 * web on the right (Exhibit A's suspect photos pinned up, the magnifying glass
 * between them, Exhibits B and C below), joined by pink string. Wide screens
 * get the full board on a 1152 × 560 design grid that scales with its width;
 * phones and tablets get the same pieces stacked.
 */

type Featured = TheoryCase & { board: Board };

const PHOTO_BG = ["radial-gradient(circle at 50% 60%, hsl(var(--secondary)) 0%, hsl(var(--background)) 75%)", "radial-gradient(circle at 50% 60%, hsl(var(--screen) / 0.4) 0%, hsl(var(--background)) 75%)"];
const PHOTO_IMG = ["drop-shadow(0 12px 14px rgb(0 0 0 / 0.6))", "drop-shadow(0 0 20px hsl(var(--screen) / 0.8))"];

/** The file's state and status, in the page's language: a fan theory is still open, the others are closed. */
function status(c: TheoryCase) {
  const t = serverT(dexTheories);
  const open = c.verdict === "fan";
  return { file: t(open ? "board.state.open" : "board.state.closed"), status: t(`board.verdictStatus.${c.verdict}`), open };
}

function Corners({ c }: { c: Featured }) {
  const t = serverT(dexTheories);
  const st = status(c);
  const no = String(c.n).padStart(3, "0");
  return (
    <>
      <span className={cn(s.mono, s.corner)} style={{ left: 24, top: 18 }}>
        {t("board.brand")}
      </span>
      <span className={cn(s.mono, s.corner)} style={{ right: 24, top: 18 }}>
        <span className={cn(s.live, !st.open && s.liveStill)} aria-hidden />
        {t("board.file", { no, state: st.file })}
      </span>
      <span className={cn(s.mono, s.corner)} style={{ left: 24, bottom: 16 }}>
        {t("board.status", { status: st.status })}
      </span>
      <span className={cn(s.mono, s.corner)} style={{ right: 24, bottom: 16 }}>
        {t("board.press")}
      </span>
    </>
  );
}

function Dossier({ c, mobile }: { c: Featured; mobile?: boolean }) {
  const t = serverT(dexTheories);
  const b = c.board;
  return (
    <div className={mobile ? s.mDossier : s.dossier} data-testid="case-dossier">
      <span className={cn(s.mono, s.ftab)}>
        <span className="text-warning" aria-hidden>
          ●
        </span>
        {t("caseNumber", { n: String(c.n).padStart(3, "0") })}
      </span>
      <span className={cn(s.hud, "text-warning")}>{t("board.caseOfTheWeek")}</span>
      <h2 className={mobile ? "m-0 font-display text-3xl font-bold uppercase leading-none" : s.dossierTitle}>{b.question}</h2>
      <p className={mobile ? "m-0 text-[15px] leading-relaxed text-foreground/85" : s.dossierHook}>{b.hook}</p>
      <div className={mobile ? "flex flex-col gap-3" : s.dossierFoot}>
        <div className={s.keyList}>
          <span className={cn(s.hud, "text-muted-foreground")} style={{ fontSize: 11 }}>
            {t("board.keyEvidence")}
          </span>
          {b.keys.map((k, i) => (
            <div key={k} className={s.kev}>
              <Badge>{"ABC"[i]}</Badge>
              {k}
            </div>
          ))}
        </div>
        <div className={s.openRow}>
          <Link href={casePath(c.slug)} className={cn(buttonVariants({ size: "default" }), "px-5")} data-testid="case-open">
            {t("board.open")}
          </Link>
          <Stamp verdict={c.verdict} label={t(`verdict.${c.verdict}`)} size="big" />
        </div>
      </div>
    </div>
  );
}

function Photo({ art, i, mobile, style, glitch }: { art?: { id: number; name: string }; i: number; mobile?: boolean; style: React.CSSProperties; glitch?: boolean }) {
  return (
    <div className={mobile ? s.mPhoto : s.evPhoto} style={style} data-testid="case-suspect">
      <Pin style={{ left: "50%", top: -6, marginLeft: -7 }} />
      <Badge className="absolute -left-2.5 -top-2.5 z-[7]">A</Badge>
      <div className={s.ph} style={{ background: PHOTO_BG[i % 2] }}>
        {glitch || !art ? <GlitchBlock size={mobile ? 12 : 18} /> : <Art id={art.id} alt={art.name} style={{ filter: PHOTO_IMG[i % 2] }} />}
      </div>
      <div className={s.cap}>
        <span className={s.hud} style={{ fontSize: 11 }}>
          {glitch || !art ? "MissingNo." : art.name}
        </span>
        <span className={cn(s.mono, s.capNo)}>{glitch || !art ? "#???" : dexNo(art.id)}</span>
      </div>
    </div>
  );
}

/** The sticky note that takes the second photo's place when a case has one suspect. */
function Note({ c, mobile, style }: { c: Featured; mobile?: boolean; style: React.CSSProperties }) {
  const t = serverT(dexTheories);
  const labels = { games: t("source.games"), anime: t("source.anime"), pokedex: t("source.pokedex"), internet: t("source.internet"), manga: t("source.manga") };
  return (
    <div className={mobile ? s.mPhoto : s.evPhoto} style={style}>
      <Pin style={{ left: "50%", top: -6, marginLeft: -7 }} />
      <div className={cn(s.ph, s.mono, "flex-col items-start justify-center gap-2 px-3 text-left text-[11px] uppercase tracking-[0.1em] text-muted-foreground")} style={{ background: "hsl(var(--background) / 0.6)" }}>
        <span>{t("board.noteFiled", { era: c.era })}</span>
        <span>{t("board.noteFrom", { sources: sourceLine(c, labels) })}</span>
        <span className="text-warning">{t("board.noteLead", { caption: c.board.caption })}</span>
      </div>
    </div>
  );
}

function Lens({ c, mobile }: { c: Featured; mobile?: boolean }) {
  const [a, b] = c.art;
  return (
    <>
      <div aria-hidden className={cn(s.scan, mobile && s.mScan)} />
      <div aria-hidden className={cn(s.handle, mobile && s.mHandle)}>
        <span className={s.collar} />
      </div>
      <div aria-hidden className={cn(s.lens, mobile && s.mLens)} data-testid="case-lens">
        {c.glitch || !a ? (
          <span className={s.lensGlitch}>
            <GlitchBlock size={mobile ? 9 : 13} />
          </span>
        ) : (
          <>
            {b && <img src={boardArtUrl(a.id)} alt="" className={s.lensA} />}
            <img src={boardArtUrl((b ?? a).id)} alt="" className={s.lensB} />
          </>
        )}
        <span className={s.reticle} />
        <span className={s.glare} />
      </div>
      <span className={cn(s.hud, s.caption, mobile && s.mCaption)}>{c.board.caption}</span>
    </>
  );
}

function ExhibitB({ c, mobile, style }: { c: Featured; mobile?: boolean; style?: React.CSSProperties }) {
  const b = c.board.b;
  return (
    <div className={mobile ? s.mCard : s.evCard} style={style} data-testid="case-exhibit-b">
      <Pin style={{ left: "50%", top: -7, marginLeft: -7 }} />
      <div className="flex items-center gap-2">
        <Badge>B</Badge>
        <span className={cn(s.mono, s.evLabel)}>{b.label}</span>
      </div>
      <div className={cn(s.mono, s.evQuote)}>{b.quote ? <>“<Marked text={b.quote} mark={b.mark} />”</> : b.text}</div>
    </div>
  );
}

function ExhibitC({ c, mobile, style }: { c: Featured; mobile?: boolean; style?: React.CSSProperties }) {
  const x = c.board.c;
  return (
    <div className={mobile ? s.mCard : s.evCard} style={style} data-testid="case-exhibit-c">
      <Pin style={{ left: "50%", top: -7, marginLeft: -7 }} />
      <div className="flex items-center gap-2">
        <Badge>C</Badge>
        <ExhibitIcon icon={x.icon} />
      </div>
      <div className={s.evFact}>
        <Bolded text={x.text} bold={x.bold} />
      </div>
    </div>
  );
}

/** The full board, xl and up. */
function WideBoard({ c }: { c: Featured }) {
  const two = !c.glitch && c.art.length > 1;
  return (
    <div className={cn(s.board, "max-xl:hidden")} data-testid="case-board">
      <div className={s.stage}>
        <Corners c={c} />
        <svg aria-hidden className={s.strings} viewBox="0 0 1152 560" preserveAspectRatio="none">
          {/* The detective's extra threads: thinner and fainter, under the main ones. */}
          <g fill="none" stroke="hsl(var(--primary))" strokeWidth="1.1" strokeLinecap="round" opacity="0.32">
            {two && <path className={s.str2} d="M607 64 Q805 128 1003 58" />}
            <path className={s.str2} d="M681 372 Q840 430 1001 382" />
            <path className={s.str2} d="M451 351 C482 300 470 210 503 166" />
            <path className={s.str2} d="M451 382 Q476 396 502 420" />
            <path className={s.str2} d="M451 413 Q690 548 893 474" />
          </g>
          <g className={s.mainStrings} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round">
            {two ? <path className={s.str} d="M607 64 Q680 168 806 210" /> : <path className={s.str} d="M607 64 Q690 150 806 210" strokeDasharray="6 5" opacity="0.7" />}
            <path className={s.str} d="M1003 58 Q930 168 806 210" />
            <path className={s.str} d="M806 210 Q770 300 681 372" />
            <path className={s.str} d="M806 210 Q900 292 1001 382" />
          </g>
        </svg>
        <Dossier c={c} />
        {two ? (
          <Photo art={c.art[0]} i={0} style={{ left: "calc(500 * var(--u))", top: "calc(62 * var(--u))", transform: "rotate(-4deg)" }} />
        ) : (
          <Note c={c} style={{ left: "calc(500 * var(--u))", top: "calc(62 * var(--u))", transform: "rotate(-4deg)" }} />
        )}
        <Photo art={two ? c.art[1] : c.art[0]} i={1} glitch={c.glitch} style={{ left: "calc(896 * var(--u))", top: "calc(56 * var(--u))", transform: "rotate(4deg)" }} />
        <Lens c={c} />
        <ExhibitB c={c} style={{ left: "calc(500 * var(--u))", top: "calc(366 * var(--u))", width: "calc(350 * var(--u))", transform: "rotate(-1.5deg)" }} />
        <ExhibitC c={c} style={{ left: "calc(890 * var(--u))", top: "calc(376 * var(--u))", width: "calc(220 * var(--u))", transform: "rotate(2deg)" }} />
      </div>
    </div>
  );
}

/** The same board, stacked, below xl: two columns on a tablet, one on a phone. */
function StackedBoard({ c }: { c: Featured }) {
  const t = serverT(dexTheories);
  const two = !c.glitch && c.art.length > 1;
  const st = status(c);
  return (
    <div className={cn(s.board, s.mBoard, "xl:hidden")} data-testid="case-board-stacked">
      <div className={cn(s.mono, s.mCornerTop)}>
        <span>{t("board.brand")}</span>
        <span className="flex items-center gap-2">
          <span className={cn(s.live, !st.open && s.liveStill)} aria-hidden />
          {t("board.fileNo", { no: String(c.n).padStart(3, "0") })}
        </span>
      </div>
      <Dossier c={c} mobile />
      <div className={s.mWeb}>
        <div className={s.mWebIn}>
          <svg aria-hidden className={s.strings} viewBox="0 0 360 310" preserveAspectRatio="none">
            <g fill="none" stroke="hsl(var(--primary))" strokeLinecap="round">
              {two && <path className={s.str2} d="M88 8 Q180 40 270 4" strokeWidth="1" opacity="0.32" />}
              <g className={s.mainStrings} strokeWidth="2">
                <path className={s.str} d="M88 8 Q120 140 180 240" />
                <path className={s.str} d="M270 4 Q240 140 180 240" />
                <path className={s.str} d="M180 240 Q186 290 180 310" />
              </g>
            </g>
          </svg>
          {two ? (
            <Photo art={c.art[0]} i={0} mobile style={{ left: "calc(14 * var(--m))", top: "calc(14 * var(--m))", transform: "rotate(-4deg)" }} />
          ) : (
            <Note c={c} mobile style={{ left: "calc(14 * var(--m))", top: "calc(14 * var(--m))", transform: "rotate(-4deg)" }} />
          )}
          <Photo art={two ? c.art[1] : c.art[0]} i={1} glitch={c.glitch} mobile style={{ left: "calc(196 * var(--m))", top: "calc(10 * var(--m))", transform: "rotate(4deg)" }} />
          <Lens c={c} mobile />
        </div>
      </div>
      <div className={s.mCards}>
        <ExhibitB c={c} mobile style={{ transform: "rotate(-1deg)" }} />
        <ExhibitC c={c} mobile style={{ transform: "rotate(1deg)" }} />
      </div>
      <div className={cn(s.mono, s.mCornerBottom)}>
        <span>{t("board.status", { status: st.status })}</span>
        <span>{st.file}</span>
      </div>
    </div>
  );
}

export function CaseBoard({ c }: { c: Featured }) {
  const t = serverT(dexTheories);
  return (
    <section aria-label={t("board.label")} className="dark-scope" data-testid="case-of-the-week" data-case={c.slug}>
      <WideBoard c={c} />
      <StackedBoard c={c} />
    </section>
  );
}
