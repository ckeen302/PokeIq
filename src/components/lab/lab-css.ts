/**
 * The 3D Lab's motion: a neon floor running toward the viewer in the hero,
 * floating screenshots, a slow drift over each card's picture and a race
 * track for a card without one. All of it is CSS (no WebGL on /lab), and all
 * of it stops for prefers-reduced-motion.
 */
export const LAB_CSS = `
.lab-hero{background:
  radial-gradient(70% 60% at 78% 30%, hsl(var(--screen) / .22), transparent 70%),
  radial-gradient(55% 55% at 8% 100%, hsl(var(--primary) / .18), transparent 70%),
  linear-gradient(180deg, hsl(250 50% 5%), hsl(252 46% 8%) 62%, hsl(252 50% 5%));}
.lab-floor{position:absolute;left:-60%;right:-60%;bottom:-1px;height:34%;transform-origin:50% 100%;transform:perspective(420px) rotateX(64deg);
  background-image:linear-gradient(hsl(var(--screen) / .42) 1.5px,transparent 1.5px),linear-gradient(90deg,hsl(var(--screen) / .32) 1.5px,transparent 1.5px);
  background-size:64px 64px;animation:lab-floor 2.6s linear infinite;
  -webkit-mask-image:linear-gradient(to bottom,transparent 0%,#000 55%);mask-image:linear-gradient(to bottom,transparent 0%,#000 55%);}
@keyframes lab-floor{to{background-position:0 64px,0 0}}
@media (max-width:1023px){.lab-floor{height:30%}}
.lab-title{text-shadow:0 0 28px hsl(var(--screen) / .45)}
.lab-title b{color:hsl(var(--primary));text-shadow:0 0 22px hsl(var(--primary) / .75),0 0 60px hsl(var(--primary) / .35)}
.lab-stack{perspective:1400px}
.lab-panel{position:absolute;overflow:hidden;border-radius:12px;border:1px solid hsl(var(--screen) / .45);
  box-shadow:0 30px 60px rgb(0 0 0 / .55),0 0 32px hsl(var(--lab-accent, var(--screen)) / .28);
  animation:lab-float 7s ease-in-out infinite alternate;}
.lab-panel::after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(115deg,transparent 35%,rgb(255 255 255 / .16) 48%,transparent 60%);background-size:260% 100%;animation:lab-sheen 7s ease-in-out infinite}
@keyframes lab-float{from{translate:0 -7px}to{translate:0 9px}}
@keyframes lab-sheen{0%,55%{background-position:120% 0}100%{background-position:-40% 0}}
.lab-kb{animation:lab-kb 24s ease-in-out infinite alternate;transform-origin:var(--kb-o,50% 50%)}
@keyframes lab-kb{from{transform:scale(1)}to{transform:scale(1.07)}}
.lab-card:hover .lab-kb,.lab-card:focus-within .lab-kb{animation-duration:9s}
.lab-glow{box-shadow:0 0 0 1px hsl(var(--lab-accent) / .0),0 0 0 hsl(var(--lab-accent) / 0);transition:box-shadow .25s,border-color .25s}
.lab-card:hover .lab-glow{border-color:hsl(var(--lab-accent) / .6);box-shadow:0 0 0 1px hsl(var(--lab-accent) / .35),0 0 40px hsl(var(--lab-accent) / .18)}
.lab-accent{color:hsl(var(--lab-accent))}
.lab-led{color:hsl(var(--lab-accent))}

/* A night race track: lanes running into the distance, runners streaking to the line. */
.lab-track{background:radial-gradient(60% 45% at 20% 0%,rgb(255 244 214 / .28),transparent 70%),radial-gradient(60% 45% at 80% 0%,rgb(255 244 214 / .22),transparent 70%),linear-gradient(180deg,#0a0820,#140c2a 45%,#0b0718)}
.lab-lanes{position:absolute;inset:44% 0 0 0;background:repeating-linear-gradient(180deg,rgb(255 255 255 / .5) 0 2px,transparent 2px 25%),linear-gradient(180deg,#8a2a3e,#5e1828);box-shadow:inset 0 18px 30px rgb(0 0 0 / .45)}
.lab-finish{position:absolute;top:44%;bottom:0;right:14%;width:22px;background:conic-gradient(#fff 25%,#111 0 50%,#fff 0 75%,#111 0) 0 0/11px 11px;opacity:.9}
.lab-runner{position:absolute;left:-12%;height:10px;width:16%;border-radius:999px;background:linear-gradient(90deg,transparent,hsl(var(--lab-accent)) 70%,#fff);box-shadow:0 0 18px hsl(var(--lab-accent));animation:lab-run var(--d,3s) cubic-bezier(.5,0,.3,1) infinite}
@keyframes lab-run{0%{transform:translateX(0)}80%,100%{transform:translateX(620%)}}

/* Phones: the pictures hold still (the drift costs main-thread time on a phone and is barely seen at this size). */
@media (max-width:639px){.lab-kb{animation:none}}

@media (prefers-reduced-motion: reduce){
  .lab-floor,.lab-panel,.lab-panel::after,.lab-kb,.lab-runner{animation:none!important}
}
`;
