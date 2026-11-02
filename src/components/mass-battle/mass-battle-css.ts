/** Styles for the Mass Battle stage: the HUD, the loader and the result card. Motion stops for prefers-reduced-motion. */
export const MB_CSS = `
.mb-stage { background: radial-gradient(120% 90% at 50% 0%, #1d2a4a 0%, #0b1122 55%, #05070f 100%); }
.mb-stage:fullscreen { border-radius: 0; height: 100vh !important; }
.mb-host canvas { display: block; }
.mb-shade-top { position: absolute; inset-inline: 0; top: 0; height: 8rem; pointer-events: none; background: linear-gradient(180deg, rgb(5 8 20 / .62), rgb(5 8 20 / 0)); }
.mb-shade-bottom { position: absolute; inset-inline: 0; bottom: 0; height: 7rem; pointer-events: none; background: linear-gradient(0deg, rgb(5 8 20 / .66), rgb(5 8 20 / 0)); }
.mb-chip { box-shadow: 0 6px 20px rgb(0 0 0 / .28); }
.mb-bar { height: 8px; border-radius: 999px; background: rgb(255 255 255 / .14); overflow: hidden; }
.mb-bar > i { display: block; height: 100%; border-radius: inherit; transform-origin: left center; transition: transform .25s linear; }
.mb-a { background: linear-gradient(90deg, #3e8bff, #7fd0ff); box-shadow: 0 0 10px rgb(80 160 255 / .7); }
.mb-b { background: linear-gradient(90deg, #ff4f5e, #ffa36c); box-shadow: 0 0 10px rgb(255 90 90 / .7); }
.mb-boss > i { background: linear-gradient(90deg, #ffd23a, #ff8a00); box-shadow: 0 0 12px rgb(255 190 40 / .75); }
.mb-title { font-family: var(--font-display); font-weight: 700; text-transform: uppercase; letter-spacing: .02em; line-height: 1.02;
  color: #ffe45c; -webkit-text-stroke: 2px #0d1626; paint-order: stroke fill; text-shadow: 0 4px 0 #0d1626, 0 10px 30px rgb(0 0 0 / .45); }
.mb-caption { font-family: var(--font-display); font-weight: 700; color: #fff; -webkit-text-stroke: 1px #0d1626; paint-order: stroke fill; text-shadow: 0 2px 0 #0d1626; }
.mb-go { background: linear-gradient(180deg, #ffd84a, #f5a400); color: #1a1205; box-shadow: 0 0 0 2px rgb(255 255 255 / .55) inset, 0 8px 26px rgb(245 164 0 / .35); }
.mb-go:hover { filter: brightness(1.06); }
.mb-feed li { animation: mb-feed-in .35s cubic-bezier(.2,.8,.2,1) both; }
@keyframes mb-feed-in { from { opacity: 0; transform: translateX(14px); } to { opacity: 1; transform: none; } }
.mb-loader-ball { width: 46px; height: 46px; border-radius: 50%; position: relative; overflow: hidden;
  background: linear-gradient(180deg, #ff3b4a 0 46%, #10131d 46% 54%, #f4f6fb 54%); box-shadow: 0 0 0 3px #10131d, 0 0 24px rgb(255 60 80 / .45);
  animation: mb-wobble 1.1s ease-in-out infinite; }
.mb-loader-ball::after { content: ""; position: absolute; left: 50%; top: 50%; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%; background: #f4f6fb; box-shadow: 0 0 0 3px #10131d; }
@keyframes mb-wobble { 0%,100% { transform: rotate(0); } 25% { transform: rotate(-16deg); } 75% { transform: rotate(16deg); } }
.mb-progress { background: linear-gradient(90deg, #ffd84a, #ff9d00); box-shadow: 0 0 10px rgb(255 190 40 / .6); transform-origin: left center; transition: transform .2s linear; }
.mb-answer { font-family: var(--font-display); font-weight: 700; line-height: .95; color: #fff; -webkit-text-stroke: 2px #0d1626; paint-order: stroke fill; text-shadow: 0 5px 0 #0d1626, 0 0 40px rgb(255 210 60 / .45); }
.mb-answer b { color: #ffd84a; }
@media (prefers-reduced-motion: reduce) { .mb-loader-ball, .mb-feed li { animation: none !important; } .mb-bar > i, .mb-progress { transition: none; } }
`;
