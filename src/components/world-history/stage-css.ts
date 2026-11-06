/**
 * The film's stage: full-bleed under the site's top bar, with soft shades
 * for legibility, the museum captions, the chapter rail and the controls.
 * Everything that moves stops for prefers-reduced-motion (which gets the
 * text version anyway).
 */
export const WH_STAGE_CSS = `
html.wh-locked, html.wh-locked body { overflow: hidden; overscroll-behavior: none; }
.wh-stage{background:#030207;touch-action:pan-y;contain:strict}
.wh-stage[data-free="1"]{touch-action:none}
.wh-stage canvas{display:block}
.wh-shade-top{position:absolute;inset:0 0 auto 0;height:9rem;pointer-events:none;background:linear-gradient(180deg,rgb(3 2 7 / .78),transparent)}
.wh-shade-bottom{position:absolute;inset:auto 0 0 0;height:15rem;pointer-events:none;background:linear-gradient(0deg,rgb(3 2 7 / .86),rgb(3 2 7 / .45) 55%,transparent)}
:where(.wh-chip){display:inline-flex}
.wh-chip{pointer-events:auto;height:2.25rem;align-items:center;gap:.4rem;border-radius:.4rem;border:1px solid rgb(255 255 255 / .14);background:rgb(10 8 22 / .62);padding:0 .75rem;font-family:var(--font-display),sans-serif;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.12em;color:rgb(255 255 255 / .86);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);transition:border-color .2s,color .2s,background .2s}
.wh-chip:hover{border-color:rgb(255 255 255 / .36);color:#fff}
.wh-chip:focus-visible{outline:none;box-shadow:0 0 0 2px #f2c96b}
.wh-chip:disabled{opacity:.45}
.wh-chip[aria-pressed="true"]{border-color:rgb(242 201 107 / .7);color:#fff;background:rgb(60 40 10 / .55)}
.wh-play{pointer-events:auto;display:inline-flex;height:2.9rem;align-items:center;gap:.55rem;border-radius:.6rem;padding:0 1.1rem;font-family:var(--font-display),sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:.12em;font-size:13px;color:#120c02;background:linear-gradient(180deg,#ffe4a0,#f2c96b 55%,#d9a640);box-shadow:0 6px 24px rgb(242 201 107 / .28),inset 0 1px 0 rgb(255 255 255 / .6)}
.wh-play:hover{filter:brightness(1.06)}
.wh-play:focus-visible{outline:none;box-shadow:0 0 0 2px #fff,0 6px 24px rgb(242 201 107 / .4)}
.wh-serif{font-family:var(--font-wh-serif),Georgia,"Times New Roman",serif}
.wh-cap-q{font-family:var(--font-wh-serif),Georgia,serif;font-style:italic;font-weight:500;line-height:1.18;text-wrap:balance;text-shadow:0 2px 18px rgb(0 0 0 / .85),0 0 2px rgb(0 0 0 / .9)}
.wh-cap-lead{text-shadow:0 1px 10px rgb(0 0 0 / .9)}
.wh-cap-src{text-shadow:0 1px 8px rgb(0 0 0 / .9)}
.wh-tag{display:inline-flex;align-items:center;border-radius:3px;border:1px solid currentColor;padding:1px 6px;font-family:var(--font-pixel),monospace;font-size:9px;letter-spacing:.12em;text-transform:uppercase}
.wh-pro::before{content:"";position:absolute;left:50%;top:42%;width:min(1100px,120vw);height:520px;transform:translate(-50%,-50%);background:radial-gradient(closest-side,rgb(3 2 7 / .72),rgb(3 2 7 / .35) 60%,transparent);z-index:-1}
.wh-title{text-shadow:0 4px 40px rgb(0 0 0 / .8),0 0 3px rgb(0 0 0 / .7)}
.wh-title-k{font-family:var(--font-pixel),monospace;letter-spacing:.38em}
.wh-rail a,.wh-rail button{transition:color .2s,opacity .2s}
.wh-rail-dot{width:7px;height:7px;border-radius:999px;border:1px solid rgb(255 255 255 / .5);transition:all .25s}
.wh-rail [aria-current="true"] .wh-rail-dot{background:var(--wh-accent);border-color:var(--wh-accent);box-shadow:0 0 12px var(--wh-accent);transform:scale(1.35)}
.wh-bar{height:3px;border-radius:99px;background:rgb(255 255 255 / .14);overflow:hidden}
.wh-bar > i{display:block;height:100%;background:linear-gradient(90deg,#f2c96b,#ffe9b5);transform-origin:left;box-shadow:0 0 10px rgb(242 201 107 / .6)}
.wh-scrub{position:relative;height:18px;cursor:pointer;touch-action:none}
.wh-scrub .wh-bar{position:absolute;left:0;right:0;top:7px}
.wh-tick{position:absolute;top:4px;width:2px;height:9px;border-radius:2px;background:rgb(255 255 255 / .35)}
.wh-hint{animation:wh-hint 2.4s ease-in-out infinite}
@keyframes wh-hint{0%,100%{transform:translateY(0);opacity:.75}50%{transform:translateY(5px);opacity:1}}
.wh-load-ring{width:46px;height:46px;border-radius:999px;border:2px solid rgb(242 201 107 / .2);border-top-color:#f2c96b;animation:wh-spin 1s linear infinite}
@keyframes wh-spin{to{transform:rotate(360deg)}}
.wh-sheet{background:rgb(10 8 22 / .94);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}
/* Motion typography (opt-in classes). Title cards: the kicker tracks in, a hairline draws out, words rise out of a mask one by one, then a light sweeps across. */
.wh-tk{animation:wh-track 1.4s cubic-bezier(.2,.8,.2,1) both}
@keyframes wh-track{from{letter-spacing:.95em;opacity:0;filter:blur(3px)}to{letter-spacing:.38em;opacity:1;filter:blur(0)}}
.wh-rule{display:block;height:1px;width:min(16rem,50vw);margin:.7rem auto 0;background:linear-gradient(90deg,transparent,var(--wh-accent,#f2c96b),transparent);transform-origin:center;animation:wh-rule 1.1s .25s cubic-bezier(.2,.8,.2,1) both}
@keyframes wh-rule{from{transform:scaleX(0);opacity:0}to{transform:scaleX(1);opacity:.9}}
.wh-words{position:relative;display:inline-block}
.wh-w{display:inline-block;overflow:hidden;vertical-align:bottom;padding:0 .02em .12em;margin-bottom:-.12em}
.wh-w > span{display:inline-block;animation:wh-rise 1.05s cubic-bezier(.16,.9,.24,1) both;animation-delay:calc(.35s + var(--i,0) * 90ms)}
@keyframes wh-rise{from{transform:translateY(105%) rotate(2deg);opacity:0}60%{opacity:1}to{transform:none;opacity:1}}
.wh-sweep{position:absolute;inset:0;pointer-events:none;color:transparent;text-shadow:none;background:linear-gradient(105deg,transparent 0 40%,rgb(255 248 225 / .95) 48%,rgb(255 230 170 / .7) 52%,transparent 60% 100%);background-size:250% 100%;background-position:120% 0;-webkit-background-clip:text;background-clip:text;animation:wh-sweep 1.6s 1.05s cubic-bezier(.4,0,.2,1) both}
@keyframes wh-sweep{from{background-position:120% 0}to{background-position:-30% 0}}
.wh-when{animation:wh-fadeup .9s .85s cubic-bezier(.2,.8,.2,1) both}
@keyframes wh-fadeup{from{opacity:0;transform:translateY(.5em);filter:blur(4px)}to{opacity:1;transform:none;filter:blur(0)}}
/* Lower thirds: a hairline in the chapter's colour grows beside the caption; the line wipes in left to right. */
.wh-lower{position:relative}
.wh-lower::before{content:"";position:absolute;left:-.9rem;top:.2rem;bottom:.2rem;width:2px;border-radius:2px;background:linear-gradient(180deg,var(--wh-accent,#f2c96b),transparent);transform-origin:top;animation:wh-grow .7s .1s cubic-bezier(.2,.8,.2,1) both}
@keyframes wh-grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}
.wh-wipe{animation:wh-wipe .9s .05s cubic-bezier(.3,.7,.2,1) both}
@keyframes wh-wipe{from{clip-path:inset(-20% 100% -20% 0)}to{clip-path:inset(-20% -2% -20% 0)}}
.wh-lead-in{animation:wh-track-s .8s cubic-bezier(.2,.8,.2,1) both}
@keyframes wh-track-s{from{letter-spacing:.42em;opacity:0}to{letter-spacing:.14em;opacity:1}}
@media (max-width:639px){.wh-lower::before{left:-.55rem}}
@media (prefers-reduced-motion: reduce){.wh-hint,.wh-load-ring,.wh-tk,.wh-rule,.wh-w > span,.wh-sweep,.wh-when,.wh-lower::before,.wh-wipe,.wh-lead-in{animation:none!important}.wh-sweep{display:none}}
`;
