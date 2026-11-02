/** Styles for the full-screen /pokedex/sizes stage. */
export const SIZES_CSS = `
html.sz-locked, html.sz-locked body { overflow: hidden; overscroll-behavior: none; }
.sz-stage { background: linear-gradient(180deg, #7fb2e6 0%, #c9def0 55%, #b8b2a4 100%); }
@media (prefers-reduced-motion: reduce) { .sz-stage[data-ready="0"] { display: none; } }
.sz-host canvas { display: block; }
.sz-overlay { position: absolute; inset: 0; pointer-events: none; }
.sz-shade-top { position: absolute; inset-inline: 0; top: 0; height: 9rem; pointer-events: none;
  background: linear-gradient(180deg, rgb(6 10 24 / .55), rgb(6 10 24 / 0)); }
.sz-shade-bottom { position: absolute; inset-inline: 0; bottom: 0; height: 9rem; pointer-events: none;
  background: linear-gradient(0deg, rgb(6 10 24 / .6), rgb(6 10 24 / 0)); }
.sz-chip { box-shadow: 0 6px 20px rgb(0 0 0 / .28); }
.sz-play { background: linear-gradient(180deg, #ffd84a, #f5a400); color: #1a1205; box-shadow: 0 0 0 2px rgb(255 255 255 / .55) inset, 0 8px 26px rgb(245 164 0 / .35); }
.sz-play:hover { filter: brightness(1.06); }
.sz-hook { font-family: var(--font-display); font-weight: 700; text-transform: uppercase; letter-spacing: .02em; line-height: 1.02;
  color: #ffe45c; -webkit-text-stroke: 2px #0d1626; paint-order: stroke fill;
  text-shadow: 0 4px 0 #0d1626, 0 10px 30px rgb(0 0 0 / .45); }
.sz-caption { font-family: var(--font-display); font-weight: 700; color: #fff; -webkit-text-stroke: 1px #0d1626; paint-order: stroke fill;
  text-shadow: 0 2px 0 #0d1626; }
.sz-progress { background: linear-gradient(90deg, #ffd84a, #ff9d00); box-shadow: 0 0 10px rgb(255 190 40 / .6); }
.sz-thumb { background: #fff; box-shadow: 0 0 0 2px #0d1626, 0 0 12px rgb(255 255 255 / .7); }
.sz-list-hit { box-shadow: inset 0 0 0 2px hsl(var(--primary) / .7); background: hsl(var(--primary) / .08); }
.sz-stage .sz-ui { transition: opacity .6s ease .1s; }
.sz-stage[data-recording="1"] .sz-ui { opacity: .25; pointer-events: none; }
`;
