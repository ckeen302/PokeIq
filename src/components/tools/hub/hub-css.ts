/**
 * The Tools hub's motion and scenery, shared by the three mock directions: a
 * float and a catch wobble for the Poké Balls, a rack of balls rolling by,
 * tier list tiles dropping into their tiers, the favourite's crown, a sheen
 * across a tile on hover and each tool's own backdrop. All CSS, and all of it
 * holds still for prefers-reduced-motion.
 */
export const HUB_CSS = `
.th-title{text-shadow:0 0 30px hsl(var(--screen) / .35)}
.th-title b{color:hsl(var(--primary));text-shadow:0 0 22px hsl(var(--primary) / .6)}

/* A tile: its accent (--ac, an HSL triplet) lights the border and a glow on hover. */
.th-tile{--ac:var(--screen);position:relative;isolation:isolate;overflow:hidden;border:1px solid hsl(var(--ac) / .16);
  background:hsl(250 40% 7%);transition:border-color .25s,box-shadow .25s,transform .25s}
.th-tile:hover,.th-tile:focus-visible{border-color:hsl(var(--ac) / .65);box-shadow:0 0 0 1px hsl(var(--ac) / .3),0 18px 50px -12px hsl(var(--ac) / .35)}
.th-tile:focus-visible{outline:none}
/* Each tool's backdrop: a spotlight in its colour over the night, a faint dot grid and a floor. */
.th-scene{position:absolute;inset:0;z-index:-1;background:
  radial-gradient(60% 70% at var(--sx,70%) var(--sy,45%), hsl(var(--ac) / .30), transparent 70%),
  radial-gradient(90% 60% at 0% 100%, hsl(var(--screen) / .10), transparent 70%),
  linear-gradient(180deg, hsl(250 45% 8%), hsl(252 50% 5%))}
.th-scene::before{content:"";position:absolute;inset:0;background-image:radial-gradient(hsl(var(--ac) / .22) 1px,transparent 1.3px);background-size:14px 14px;
  -webkit-mask-image:radial-gradient(70% 80% at var(--sx,70%) var(--sy,45%),#000,transparent 75%);mask-image:radial-gradient(70% 80% at var(--sx,70%) var(--sy,45%),#000,transparent 75%)}
/* A sweep of light across the tile on hover. */
.th-sheen{position:absolute;inset:0;z-index:5;pointer-events:none;background:linear-gradient(110deg,transparent 30%,rgb(255 255 255 / .10) 45%,transparent 60%);
  background-size:250% 100%;background-position:130% 0;transition:background-position .9s ease}
.th-tile:hover .th-sheen{background-position:-40% 0}
.th-lift{transition:transform .5s cubic-bezier(.2,.8,.2,1)}
.th-tile:hover .th-lift{transform:scale(1.04) translateY(-2px)}

/* The pixel Pokémon: crisp pixels, a soft floor shadow. */
.th-px{image-rendering:pixelated;image-rendering:crisp-edges}

/* Poké Balls: a float, and on hover the catch wobble (three shakes and a click). */
.th-float{animation:th-float 6s ease-in-out infinite}
@keyframes th-float{0%,100%{translate:0 -5px}50%{translate:0 7px}}
.th-tile:hover .th-wobble,.th-wobble-on .th-wobble{animation:th-wobble 1.8s ease-in-out infinite;transform-origin:50% 85%}
@keyframes th-wobble{0%,100%{rotate:0deg}8%{rotate:-11deg}16%{rotate:9deg}24%{rotate:0deg}38%{rotate:-8deg}46%{rotate:6deg}54%{rotate:0deg}68%{rotate:-5deg}74%{rotate:3deg}80%{rotate:0deg}}
.th-shadow{background:radial-gradient(closest-side,rgb(0 0 0 / .55),transparent);filter:blur(2px)}

/* A rack of Poké Balls rolling by. */
.th-rack{display:flex;width:max-content;animation:th-rack 26s linear infinite}
@keyframes th-rack{to{transform:translateX(-50%)}}
.th-ball{position:relative;flex:none;border-radius:999px;box-shadow:inset -4px -6px 10px rgb(0 0 0 / .35),inset 3px 4px 8px rgb(255 255 255 / .16),0 3px 6px rgb(0 0 0 / .5);border:1px solid rgb(0 0 0 / .55)}
.th-ball>i{position:absolute;inset:0;border-radius:inherit;animation:th-roll 3.2s linear infinite}
.th-ball::after{content:"";position:absolute;inset:0;border-radius:inherit;background:radial-gradient(circle at 33% 27%,rgb(255 255 255 / .8) 0 7%,transparent 24%)}
@keyframes th-roll{to{rotate:-360deg}}

/* Tier list tiles: they drop into their tiers one after another as the page opens, then now and then one hops
   out and drops back in (never more than one or two at a time, so a tier is never empty). */
.th-drop{animation:th-drop-in .55s cubic-bezier(.3,1.5,.5,1) both,th-dip var(--tp,9s) cubic-bezier(.3,1.4,.5,1) infinite;animation-delay:var(--d1,0s),var(--d2,0s)}
@keyframes th-drop-in{from{opacity:0;transform:translateY(-70%) scale(.6)}to{opacity:1;transform:none}}
@keyframes th-dip{0%,88%{opacity:1;transform:none}91%{opacity:0;transform:translateY(-60%) scale(.7)}96%{opacity:1;transform:translateY(4%) scale(1.06)}100%{opacity:1;transform:none}}
.th-tile:hover .th-drop{--tp:4.5s}

/* The favourite's crown, and the runners-up swaying beside it. */
.th-crown{animation:th-crown 3.2s ease-in-out infinite}
@keyframes th-crown{0%,100%{translate:0 0;rotate:-4deg}50%{translate:0 -6px;rotate:4deg}}
.th-tile:hover .th-crown{animation:th-crown-drop .7s cubic-bezier(.3,1.6,.5,1) both,th-crown 3.2s ease-in-out .7s infinite}
@keyframes th-crown-drop{from{translate:0 -36px;opacity:0}to{translate:0 0;opacity:1}}
.th-sway{animation:th-sway 5s ease-in-out infinite}
@keyframes th-sway{0%,100%{translate:0 0}50%{translate:0 -5px}}

/* A twinkle (the shiny sparkle). */
.th-twinkle{animation:th-twinkle 2.6s ease-in-out infinite}
@keyframes th-twinkle{0%,100%{opacity:0;scale:.4}45%,55%{opacity:1;scale:1}}

/* The chunky game button (the home page's Play button, smaller). */
.th-btn{box-shadow:0 4px 0 hsl(var(--primary-shadow)),0 0 26px hsl(var(--primary) / .3);transition:filter .15s,transform .15s}
.th-tile:hover .th-btn,.th-btn:hover{filter:brightness(1.1)}
.th-btn:active{transform:translateY(2px)}

/* Direction C: the selector's timer and the stage's cross-fade. */
.th-timer{transform-origin:0 50%;animation:th-timer var(--dur,7s) linear both}
@keyframes th-timer{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.th-enter{animation:th-enter .55s cubic-bezier(.2,.8,.2,1) both}
@keyframes th-enter{from{opacity:0;transform:translateX(18px)}to{opacity:1;transform:none}}
.th-enter-up{animation:th-enter-up .5s cubic-bezier(.2,.8,.2,1) both}
@keyframes th-enter-up{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
.th-floor{position:absolute;left:-40%;right:-40%;bottom:-1px;height:38%;transform-origin:50% 100%;transform:perspective(380px) rotateX(62deg);
  background-image:linear-gradient(hsl(var(--ac) / .38) 1.5px,transparent 1.5px),linear-gradient(90deg,hsl(var(--ac) / .28) 1.5px,transparent 1.5px);
  background-size:56px 56px;animation:th-floor 3s linear infinite;transition:background-image .4s;
  -webkit-mask-image:linear-gradient(to bottom,transparent,#000 60%);mask-image:linear-gradient(to bottom,transparent,#000 60%)}
@keyframes th-floor{to{background-position:0 56px,0 0}}
/* The stage's pedestal: a lit disc in the tool's colour under its picture. */
.th-pedestal{position:absolute;left:50%;translate:-50% 0;aspect-ratio:9/2;border-radius:50%;
  background:radial-gradient(closest-side,hsl(var(--ac) / .42),hsl(var(--ac) / .1) 65%,transparent);
  box-shadow:inset 0 0 0 1.5px hsl(var(--ac) / .55),0 0 40px hsl(var(--ac) / .25)}
.th-pedestal::before{content:"";position:absolute;inset:-22% -12%;border-radius:50%;border:1px solid hsl(var(--ac) / .22)}

/* Direction B: the arcade cards' reveal (on a screen that can hover; always open on touch). */
.th-reveal{grid-template-rows:0fr;opacity:0;transition:grid-template-rows .35s cubic-bezier(.2,.8,.2,1),opacity .25s}
.th-reveal>div{overflow:hidden}
.th-tile:hover .th-reveal,.th-tile:focus-visible .th-reveal{grid-template-rows:1fr;opacity:1}
@media (hover:none){.th-reveal{grid-template-rows:1fr;opacity:1}}
.th-speed{position:absolute;inset:0;z-index:-1;opacity:.5;background:repeating-linear-gradient(115deg,transparent 0 22px,hsl(var(--ac) / .10) 22px 24px);
  -webkit-mask-image:linear-gradient(90deg,transparent 20%,#000 70%);mask-image:linear-gradient(90deg,transparent 20%,#000 70%)}

@media (prefers-reduced-motion: reduce){
  .th-float,.th-wobble,.th-rack,.th-ball>i,.th-drop,.th-crown,.th-sway,.th-twinkle,.th-timer,.th-floor,.th-enter,.th-enter-up{animation:none!important}
  .th-drop{opacity:1}
  .th-lift,.th-sheen{transition:none}
}
`;
