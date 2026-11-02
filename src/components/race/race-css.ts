/** Styles for the full-screen /pokedex/race stage. */
export const RACE_CSS = `
html.rc-locked, html.rc-locked body { overflow: hidden; overscroll-behavior: none; }
.rc-stage { background: radial-gradient(120% 90% at 50% 0%, #17223f 0%, #070b16 60%, #04060c 100%); }
@media (prefers-reduced-motion: reduce) { .rc-stage[data-ready="0"] { display: none; } }
.rc-host canvas { display: block; }
.rc-overlay { position: absolute; inset: 0; pointer-events: none; }
.rc-shade-top { position: absolute; inset-inline: 0; top: 0; height: 8rem; pointer-events: none; background: linear-gradient(180deg, rgb(4 7 15 / .6), rgb(4 7 15 / 0)); }
.rc-shade-bottom { position: absolute; inset-inline: 0; bottom: 0; height: 8rem; pointer-events: none; background: linear-gradient(0deg, rgb(4 7 15 / .65), rgb(4 7 15 / 0)); }
.rc-chip { box-shadow: 0 6px 20px rgb(0 0 0 / .3); }
.rc-go { background: linear-gradient(180deg, #ffd84a, #f5a400); color: #1a1205; box-shadow: 0 0 0 2px rgb(255 255 255 / .55) inset, 0 8px 26px rgb(245 164 0 / .35); }
.rc-go:hover { filter: brightness(1.06); }
.rc-seg button[aria-pressed="true"] { background: rgb(255 216 74 / .16); color: #ffd84a; border-color: rgb(255 216 74 / .7); }
.rc-results { background: linear-gradient(180deg, rgb(8 14 32 / .96), rgb(6 10 24 / .96)); }
.rc-results table { width: 100%; border-collapse: collapse; }
.rc-results th { font-family: var(--font-pixel); font-size: 9px; text-transform: uppercase; letter-spacing: .06em; color: rgb(255 255 255 / .5); font-weight: 400; padding: .35rem .3rem; text-align: left; }
.rc-results td { padding: .42rem .3rem; border-top: 1px solid rgb(255 255 255 / .07); font-variant-numeric: tabular-nums; }
.rc-results tr.win td { color: #ffd84a; }
.rc-stage .rc-ui { transition: opacity .5s ease .05s; }
.rc-stage[data-recording="1"] .rc-ui { opacity: .25; pointer-events: none; }
.rct { width: 100%; border-collapse: collapse; font-size: .875rem; }
.rct th { padding: .5rem .5rem .5rem 0; text-align: left; font-weight: 400; border-bottom: 1px solid hsl(var(--border)); font-family: var(--font-pixel); font-size: 9px; text-transform: uppercase; letter-spacing: .05em; color: hsl(var(--muted-foreground)); }
.rct td { padding: .5rem .5rem .5rem 0; border-bottom: 1px solid hsl(var(--foreground) / .06); vertical-align: middle; font-variant-numeric: tabular-nums; }
.rct tbody tr:last-child td { border-bottom: 0; }
.rct .n { font-family: var(--font-display); font-weight: 600; text-transform: uppercase; letter-spacing: .025em; }
.rct .n:hover { color: hsl(var(--primary)); }
.rct .k { margin-left: .5rem; font-family: var(--font-pixel); font-size: 9px; text-transform: uppercase; letter-spacing: .05em; color: hsl(var(--muted-foreground)); }
.rct .g { color: hsl(var(--muted-foreground)); }
.rct .rct-x { display: none; }
@media (min-width: 640px) { .rct .rct-x { display: table-cell; } }
.rc-bar { height: .5rem; border-radius: 9999px; background: linear-gradient(90deg, #f5a400, #ffd84a); }
`;
