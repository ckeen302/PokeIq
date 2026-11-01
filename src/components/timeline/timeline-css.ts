/** Styles for the 3D timeline stage, its CSS3D cards and each era's hardware touches. */
export const TIMELINE_CSS = `
@property --era-a { syntax: '<color>'; inherits: true; initial-value: #9bbc0f; }
@property --era-b { syntax: '<color>'; inherits: true; initial-value: #8bac0f; }
@property --era-deep { syntax: '<color>'; inherits: true; initial-value: #0f380f; }
html.tl-locked, html.tl-locked body { overflow: hidden; overscroll-behavior: none; }
.tl-stage { background: hsl(var(--background)); transition: --era-a 1.2s ease, --era-b 1.2s ease, --era-deep 1.2s ease; }
@media (prefers-reduced-motion: reduce) { .tl-stage[data-ready="0"] { display: none; } }
.tl-bg { position: absolute; inset: 0; pointer-events: none;
  background:
    radial-gradient(70% 55% at 50% 38%, color-mix(in srgb, var(--era-deep) 85%, transparent), transparent 75%),
    radial-gradient(120% 80% at 50% 120%, color-mix(in srgb, var(--era-a) 14%, transparent), transparent 60%),
    linear-gradient(180deg, hsl(250 45% 4%), hsl(246 42% 5%)); }
.tl-gl { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.tl-css { position: absolute !important; inset: 0; pointer-events: none; }
.tl-fx { position: absolute; inset: 0; pointer-events: none; z-index: 1;
  background:
    radial-gradient(120% 90% at 50% 45%, transparent 55%, rgb(0 0 0 / 0.55) 100%); }
.tl-fx::after { content: ""; position: absolute; inset: 0; opacity: .5;
  background: repeating-linear-gradient(to bottom, transparent 0 2px, rgb(0 0 0 / 0.16) 2px 3px); }
.tl-accent { color: var(--era-a); text-shadow: 0 0 18px color-mix(in srgb, var(--era-a) 60%, transparent); transition: color 1.2s; }
.tl-thumb { background: var(--era-a); box-shadow: 0 0 12px var(--era-a), 0 0 2px #fff; }
.tl-boot { animation: tl-blink 1s steps(2) infinite; }
@keyframes tl-blink { 50% { opacity: .35; } }
.tl-flash-k { color: var(--era-a); text-shadow: 0 0 12px var(--era-a); }
.tl-flash-t { color: #fff; text-shadow: 0 0 28px var(--era-a), 0 0 64px color-mix(in srgb, var(--era-b) 70%, transparent); }
.tl-panel { box-shadow: 0 0 0 1px hsl(var(--lane) / .25), 0 20px 60px rgb(0 0 0 / .55), 0 0 40px hsl(var(--lane) / .12); }

/* Cards: big DOM scaled down in 3D, so text stays sharp up close. */
.tl-card { width: 440px; box-sizing: border-box; padding: 18px 22px 20px; border-radius: 14px; cursor: pointer; user-select: none;
  display: flex; flex-direction: column; gap: 8px; color: hsl(var(--foreground));
  background: linear-gradient(180deg, hsl(250 40% 11% / .94), hsl(250 45% 6% / .9));
  border: 2px solid hsl(var(--lane) / .5);
  box-shadow: inset 0 0 0 1px hsl(var(--lane) / .12), 0 0 36px hsl(var(--lane) / .22);
  transition: border-color .25s, box-shadow .25s, background .25s; }
.tl-card::before { content: ""; position: absolute; left: 16px; right: 16px; top: -2px; height: 4px; border-radius: 4px; background: hsl(var(--lane)); box-shadow: 0 0 16px hsl(var(--lane)); }
.tl-card:hover, .tl-card.is-current { border-color: hsl(var(--lane)); background: linear-gradient(180deg, hsl(250 40% 14% / .96), hsl(250 45% 7% / .94));
  box-shadow: inset 0 0 0 1px hsl(var(--lane) / .3), 0 0 60px hsl(var(--lane) / .45), 0 0 120px hsl(var(--lane) / .18); }
.tl-card-top { display: flex; justify-content: space-between; gap: 12px; font-family: var(--font-pixel); font-size: 15px; letter-spacing: .12em; text-transform: uppercase; }
.tl-card-lane { color: hsl(var(--lane)); }
.tl-card-date { color: hsl(var(--muted-foreground)); white-space: nowrap; }
.tl-card-title { font-family: var(--font-display); font-weight: 700; font-size: 31px; line-height: 1.08; letter-spacing: .03em; text-transform: uppercase;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.tl-card-meta { font-family: var(--font-body); font-size: 18px; color: hsl(var(--muted-foreground)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tl-year { font-family: var(--font-display); font-weight: 700; font-size: 170px; letter-spacing: .08em; line-height: 1; pointer-events: none; color: transparent;
  -webkit-text-stroke: 2px color-mix(in srgb, var(--year-c, #fff) 55%, transparent); text-shadow: 0 0 40px color-mix(in srgb, var(--year-c, #fff) 30%, transparent); }
.tl-era { pointer-events: none; display: flex; flex-direction: column; align-items: center; text-align: center; white-space: nowrap; }
.tl-era-k { font-family: var(--font-pixel); font-size: 34px; letter-spacing: .3em; text-transform: uppercase; color: var(--a); text-shadow: 0 0 18px var(--a); }
.tl-era-t { font-family: var(--font-display); font-weight: 700; font-size: 120px; letter-spacing: .14em; text-transform: uppercase; color: #fff; text-shadow: 0 0 40px var(--a), 0 0 90px var(--b); }

/* Each era's hardware, applied lightly over the site's own look. */
.tl-stage[data-era="gb"] .tl-fx::before { content: ""; position: absolute; inset: 0; opacity: .22; mix-blend-mode: soft-light;
  background-image: radial-gradient(circle at 1px 1px, #9bbc0f 1px, transparent 1.4px); background-size: 4px 4px; }
.tl-stage[data-era="gbc"] .tl-fx::before { content: ""; position: absolute; inset: 0; opacity: .5;
  background: linear-gradient(90deg, rgb(214 51 108 / .12), transparent 25%, transparent 75%, rgb(62 199 194 / .12)); }
.tl-stage[data-era="gba"] .tl-fx::before { content: ""; position: absolute; inset: 0;
  background: radial-gradient(150% 70% at 50% 50%, transparent 60%, rgb(90 79 207 / .22)); }
.tl-stage[data-era="ds"] .tl-fx::before { content: ""; position: absolute; left: 8%; right: 8%; top: 50%; height: 1px; opacity: .35;
  background: linear-gradient(90deg, transparent, #a9c7ff 20%, #a9c7ff 80%, transparent); box-shadow: 0 0 12px #5ad1ff; }
.tl-stage[data-era="ds2"] .tl-fx::before { content: ""; position: absolute; inset: 0; backdrop-filter: saturate(.55) contrast(1.08); }
.tl-stage[data-era="3ds"] h1, .tl-stage[data-era="3ds"] [data-testid="timeline-year"] { text-shadow: -2px 0 rgb(255 77 109 / .65), 2px 0 rgb(63 208 255 / .65); }
.tl-stage[data-era="switch"] .tl-fx::before { content: ""; position: absolute; inset: 0;
  background: linear-gradient(90deg, rgb(0 195 227 / .2), transparent 9%, transparent 91%, rgb(255 69 84 / .2)); }
@media (max-width: 640px) { .tl-era-t { font-size: 90px; } }

/* A game's starters and box legendaries, standing on the card's top edge. */
.tl-card-mons { position: absolute; right: 14px; bottom: calc(100% - 30px); display: flex; align-items: flex-end; pointer-events: none; }
.tl-mon { display: block; object-fit: contain; opacity: 0; transform: translateY(10px) scale(.9); transition: opacity .45s ease, transform .5s cubic-bezier(.2,.9,.25,1.2);
  filter: drop-shadow(0 6px 8px rgb(0 0 0 / .55)) drop-shadow(0 0 14px hsl(var(--lane) / .35)); }
.tl-mon.is-in { opacity: 1; transform: none; }
.tl-mon + .tl-mon { margin-left: -20px; }
.tl-mon.is-legend { filter: drop-shadow(0 6px 10px rgb(0 0 0 / .6)) drop-shadow(0 0 22px hsl(var(--lane) / .5)); }
.tl-mon.is-legend + .tl-mon.is-legend { margin-left: -52px; }
.tl-mon.is-legend + .tl-mon:not(.is-legend) { margin-left: -8px; }
.tl-card.has-mons .tl-card-top { padding-right: 0; }
.tl-card.has-mons .tl-card-title { padding-right: 4px; }

/* Adaptive quality: below the top levels the glows and halos go first. */
.tl-stage[data-q="1"] .tl-card, .tl-stage[data-q="0"] .tl-card { box-shadow: inset 0 0 0 1px hsl(var(--lane) / .12); }
.tl-stage[data-q="1"] .tl-card.is-current, .tl-stage[data-q="0"] .tl-card.is-current { box-shadow: 0 0 0 1px hsl(var(--lane) / .6); }
.tl-stage[data-q="0"] .tl-card::before { box-shadow: none; }
.tl-stage[data-q="0"] .tl-mon, .tl-stage[data-q="1"] .tl-mon { filter: none; }
.tl-stage[data-q="0"] .tl-year, .tl-stage[data-q="0"] .tl-era-t, .tl-stage[data-q="0"] .tl-era-k { text-shadow: none; }
.tl-stage[data-q="0"] .tl-fx::after { display: none; }

/* The intro owns the screen: the controls wait, then fade in. */
.tl-stage .tl-ui { transition: opacity .7s ease .15s; }
.tl-stage[data-intro="1"] .tl-ui { opacity: 0; pointer-events: none; transition: none; }
.tl-tour-bar { background: var(--era-a); box-shadow: 0 0 8px var(--era-a); transition: background-color 1.2s; }
.tl-tour-btn[aria-pressed="true"] { border-color: color-mix(in srgb, var(--era-a) 60%, transparent); box-shadow: 0 0 16px color-mix(in srgb, var(--era-a) 30%, transparent); }
.tl-tour-cap { box-shadow: 0 0 0 1px hsl(var(--lane) / .3), 0 10px 40px rgb(0 0 0 / .5), 0 0 30px hsl(var(--lane) / .15); }
.tl-list-hit > article { box-shadow: 0 0 0 2px hsl(var(--primary) / .7), 0 0 30px hsl(var(--primary) / .2); }
`;
