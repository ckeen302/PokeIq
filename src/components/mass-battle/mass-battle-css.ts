/** Styles for the Mass Battle stage: the HUD, damage numbers, the controls, the loader and the result card. Motion stops for prefers-reduced-motion. */
export const MB_CSS = `
.mb-stage { background: radial-gradient(120% 90% at 50% 0%, #1d2a4a 0%, #0b1122 55%, #05070f 100%); }
.mb-stage:fullscreen { border-radius: 0; height: 100vh !important; }
.mb-host canvas { display: block; }
.mb-shade-top { position: absolute; inset-inline: 0; top: 0; height: 8rem; pointer-events: none; background: linear-gradient(180deg, rgb(5 8 20 / .55), rgb(5 8 20 / 0)); }
.mb-shade-bottom { position: absolute; inset-inline: 0; bottom: 0; height: 7rem; pointer-events: none; background: linear-gradient(0deg, rgb(5 8 20 / .6), rgb(5 8 20 / 0)); }
.mb-chip { background: rgb(9 14 32 / .62); border: 1px solid rgb(255 255 255 / .14); box-shadow: 0 6px 20px rgb(0 0 0 / .28), inset 0 1px 0 rgb(255 255 255 / .06); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }
.mb-chip:hover { border-color: rgb(255 255 255 / .34); }
.mb-chip-on { border-color: rgb(255 216 74 / .65) !important; color: #ffe680 !important; box-shadow: 0 0 0 1px rgb(255 216 74 / .18), 0 6px 20px rgb(0 0 0 / .28); }
.mb-panel { position: relative; border-radius: 10px; background: linear-gradient(180deg, rgb(10 16 36 / .72), rgb(10 16 36 / .5)); border: 1px solid rgb(255 255 255 / .1); box-shadow: 0 8px 28px rgb(0 0 0 / .3); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
.mb-panel::before { content: ""; position: absolute; top: 8px; bottom: 8px; width: 3px; border-radius: 3px; }
.mb-panel-a::before { left: -1px; background: linear-gradient(#7fd0ff, #3e8bff); box-shadow: 0 0 10px rgb(80 160 255 / .8); }
.mb-panel-b::before { right: -1px; background: linear-gradient(#ffa36c, #ff4f5e); box-shadow: 0 0 10px rgb(255 90 90 / .8); }
.mb-count { color: #fff; text-shadow: 0 2px 0 rgb(0 0 0 / .45), 0 0 18px rgb(255 255 255 / .18); }
.mb-vs { text-shadow: 0 1px 0 #000, 0 0 12px rgb(255 216 74 / .5); }
.mb-bar { position: relative; height: 7px; border-radius: 999px; background: rgb(255 255 255 / .12); overflow: hidden; box-shadow: inset 0 1px 2px rgb(0 0 0 / .4); }
.mb-bar > i { position: absolute; inset: 0; display: block; border-radius: inherit; transform-origin: left center; transition: transform .25s linear; }
.mb-bar > i.mb-trail { background: rgb(255 255 255 / .78); transition: transform .5s cubic-bezier(.4,0,.2,1); }
.mb-a { background: linear-gradient(90deg, #3e8bff, #7fd0ff); box-shadow: 0 0 10px rgb(80 160 255 / .7); }
.mb-b { background: linear-gradient(90deg, #ff4f5e, #ffa36c); box-shadow: 0 0 10px rgb(255 90 90 / .7); }
.mb-boss { border: 1px solid rgb(255 216 74 / .35); }
.mb-boss-fill { background: linear-gradient(90deg, #ff8a00, #ffd23a 70%, #fff3a0); box-shadow: 0 0 14px rgb(255 190 40 / .8); }
.mb-title { font-family: var(--font-display); font-weight: 700; text-transform: uppercase; letter-spacing: .02em; line-height: 1.02;
  color: #ffe45c; -webkit-text-stroke: 2px #0d1626; paint-order: stroke fill; text-shadow: 0 4px 0 #0d1626, 0 10px 30px rgb(0 0 0 / .45); }
.mb-caption { font-family: var(--font-display); font-weight: 700; color: #fff; -webkit-text-stroke: 1px #0d1626; paint-order: stroke fill; text-shadow: 0 2px 0 #0d1626; }
.mb-go { background: linear-gradient(180deg, #ffd84a, #f5a400); color: #1a1205; box-shadow: 0 0 0 2px rgb(255 255 255 / .55) inset, 0 8px 26px rgb(245 164 0 / .35); }
.mb-go:hover { filter: brightness(1.06); }
.mb-feed-item { background: linear-gradient(270deg, rgb(10 16 36 / .82), rgb(10 16 36 / .55)); border: 1px solid rgb(255 255 255 / .1); border-right-width: 3px; -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); animation: mb-feed-in .35s cubic-bezier(.2,.8,.2,1) both; }
.mb-feed-a { border-right-color: #4f9bff; }
.mb-feed-b { border-right-color: #ff5a64; }
.mb-feed-gold { border-color: rgb(255 216 74 / .5); border-right-color: #ffd84a; color: #ffe680; box-shadow: 0 0 18px rgb(255 200 60 / .25); }
@keyframes mb-feed-in { from { opacity: 0; transform: translateX(14px) scale(.98); } to { opacity: 1; transform: none; } }
.mb-menu { background: rgb(9 14 32 / .92); border: 1px solid rgb(255 255 255 / .14); box-shadow: 0 16px 40px rgb(0 0 0 / .45); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); }
.mb-switch { position: relative; width: 28px; height: 16px; border-radius: 999px; background: rgb(255 255 255 / .18); transition: background .2s; flex: none; }
.mb-switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #fff; transition: transform .2s; }
.mb-switch-on { background: #f5b400; }
.mb-switch-on::after { transform: translateX(12px); }
.mb-dmg-layer { position: absolute; inset: 0; pointer-events: none; overflow: hidden; z-index: 2; }
.mb-dmg { position: absolute; left: 0; top: 0; opacity: 0; will-change: transform, opacity; font-family: var(--font-display); font-weight: 800; font-size: 15px; color: #fff;
  -webkit-text-stroke: 3px #0d1626; paint-order: stroke fill; white-space: nowrap; }
.mb-dmg-crit { color: #ffd84a; font-size: 19px; }
.mb-dmg-super { color: #ffa040; }
.mb-dmg-resist { color: #b8c4d8; font-size: 13px; }
.mb-dmg-miss { color: #c8ccd8; font-size: 13px; font-weight: 700; }
.mb-dmg-boss { font-size: 18px; }
.mb-loader-ball { width: 46px; height: 46px; border-radius: 50%; position: relative; overflow: hidden;
  background: linear-gradient(180deg, #ff3b4a 0 46%, #10131d 46% 54%, #f4f6fb 54%); box-shadow: 0 0 0 3px #10131d, 0 0 24px rgb(255 60 80 / .45);
  animation: mb-wobble 1.1s ease-in-out infinite; }
.mb-loader-ball::after { content: ""; position: absolute; left: 50%; top: 50%; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%; background: #f4f6fb; box-shadow: 0 0 0 3px #10131d; }
@keyframes mb-wobble { 0%,100% { transform: rotate(0); } 25% { transform: rotate(-16deg); } 75% { transform: rotate(16deg); } }
.mb-progress { background: linear-gradient(90deg, #ffd84a, #ff9d00); box-shadow: 0 0 10px rgb(255 190 40 / .6); transform-origin: left center; transition: transform .2s linear; }
.mb-answer { font-family: var(--font-display); font-weight: 700; line-height: .95; color: #fff; -webkit-text-stroke: 2px #0d1626; paint-order: stroke fill; text-shadow: 0 5px 0 #0d1626, 0 0 40px rgb(255 210 60 / .45); }
.mb-answer b { color: #ffd84a; }
.mb-fight { animation: mb-fight 1.3s cubic-bezier(.2,.9,.25,1) both; }
@keyframes mb-fight { 0% { opacity: 0; transform: scale(1.8); } 12% { opacity: 1; transform: scale(.94); } 22% { transform: scale(1.02); } 70% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: scale(1.08); visibility: hidden; } }
@media (prefers-reduced-motion: reduce) { .mb-loader-ball, .mb-feed-item { animation: none !important; } .mb-fight { display: none; } .mb-bar > i, .mb-progress, .mb-switch, .mb-switch::after { transition: none; } }
`;
