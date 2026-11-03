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
@media (prefers-reduced-motion: reduce){.wh-hint,.wh-load-ring{animation:none!important}}
`;
