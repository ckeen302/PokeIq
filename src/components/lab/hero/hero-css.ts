/**
 * The /lab hero's three mock visuals (?hero=1|2|3): a Pokémon on a holo
 * pedestal, a size parade and a holographic portal. Their colours come from
 * two tokens set on the hero: --lh-a (the lab's violet) and --lh-b (its
 * pink), neon by night and pearly by day. Everything stops for
 * prefers-reduced-motion, leaving a composed still frame.
 */
export const HERO_CSS = `
.lab-hero{--lh-a:258 94% 74%;--lh-b:330 95% 66%;--lh-c:190 95% 70%}
:root.light .lab-hero{--lh-a:262 78% 66%;--lh-b:330 88% 72%;--lh-c:175 70% 62%}
.lab-visual{position:relative}
@media (max-width:639px){.lab-visual{position:absolute;right:0;top:6px;width:47%;height:162px;z-index:0}}

/* ---------------- 1. The holo pedestal ---------------- */
.lh-ped{position:absolute;inset:0;--S:270px;--foot:21%}
@media (max-width:1023px){.lh-ped{--S:236px}}
@media (max-width:639px){.lh-ped{--S:100px;--foot:17%}.lh-ped .lh-r2,.lh-ped .lh-r3{display:none}.lh-ped-glow{opacity:.7}}
.lh-ped>*{position:absolute;pointer-events:none}
.lh-ped-glow{left:50%;bottom:var(--foot);width:calc(var(--S)*2.1);height:calc(var(--S)*1.7);transform:translate(-50%,18%);
  background:radial-gradient(closest-side,hsl(var(--lh-a)/.34),hsl(var(--lh-b)/.12) 55%,transparent);}
.lh-ped-beam{left:50%;bottom:var(--foot);width:calc(var(--S)*1.02);height:calc(var(--S)*1.36);transform:translateX(-50%);
  background:linear-gradient(to top,hsl(var(--lh-a)/.55),hsl(var(--lh-a)/.2) 34%,hsl(var(--lh-b)/.06) 70%,transparent 96%);
  -webkit-mask-image:linear-gradient(90deg,transparent,#000 24%,#000 76%,transparent);mask-image:linear-gradient(90deg,transparent,#000 24%,#000 76%,transparent);overflow:hidden}
.lh-ped-beam::after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(0deg,hsl(var(--lh-a)/.0) 0 7px,hsl(0 0% 100%/.12) 7px 8px);
  animation:lh-lines 3.2s linear infinite;-webkit-mask-image:linear-gradient(to top,#000,transparent 85%);mask-image:linear-gradient(to top,#000,transparent 85%)}
@keyframes lh-lines{to{transform:translateY(-16px)}}
.lh-ped-base{left:50%;bottom:var(--foot);width:calc(var(--S)*1.18);height:0;transform:translateX(-50%)}
.lh-ped-base>span{position:absolute;left:50%;top:0;border-radius:50%}
.lh-ped-top,.lh-ped-side{width:100%;height:calc(var(--S)*1.18*.25)}
.lh-ped-top{transform:translate(-50%,-50%);
  background:radial-gradient(closest-side,hsl(var(--lh-a)/.75),hsl(var(--lh-a)/.28) 34%,transparent 62%),
    radial-gradient(closest-side,transparent 74%,hsl(var(--lh-a)/.55) 80%,transparent 84%),
    radial-gradient(ellipse at 50% 30%,hsl(256 40% 24%),hsl(254 46% 11%) 74%);
  box-shadow:inset 0 0 0 1.5px hsl(var(--lh-a)/.95),inset 0 0 18px hsl(var(--lh-a)/.6),0 0 22px hsl(var(--lh-a)/.55),0 0 60px hsl(var(--lh-a)/.25)}
.lh-ped-side{transform:translate(-50%,calc(-50% + var(--S)*.085));
  background:linear-gradient(180deg,hsl(254 40% 18%),hsl(254 50% 7%) 70%);
  box-shadow:inset 0 -2px 0 hsl(var(--lh-b)/.9),0 6px 26px hsl(var(--lh-b)/.45),0 14px 50px hsl(var(--lh-a)/.25)}
.lh-ped-ring{aspect-ratio:1;animation:lh-ring 18s linear infinite;
  -webkit-mask-image:radial-gradient(closest-side,transparent calc(100% - 2.5px),#000 calc(100% - 2px));mask-image:radial-gradient(closest-side,transparent calc(100% - 2.5px),#000 calc(100% - 2px))}
.lh-r1{width:112%;--rx:translate(-50%,-50%);
  background:conic-gradient(hsl(var(--lh-a)) 0 20%,transparent 0 27%,hsl(var(--lh-b)) 0 33%,transparent 0 50%,hsl(var(--lh-a)) 0 72%,transparent 0 80%,hsl(var(--lh-c)/.9) 0 83%,transparent 0)}
.lh-r2{width:136%;--rx:translate(-50%,calc(-50% + var(--S)*.085));animation-duration:26s;animation-direction:reverse;
  background:conic-gradient(hsl(var(--lh-a)/.7) 0 8%,transparent 0 12%,hsl(var(--lh-a)/.7) 0 20%,transparent 0 24%,hsl(var(--lh-a)/.7) 0 32%,transparent 0 50%,hsl(var(--lh-b)/.75) 0 58%,transparent 0 62%,hsl(var(--lh-b)/.75) 0 70%,transparent 0)}
.lh-r3{width:166%;--rx:translate(-50%,calc(-50% + var(--S)*.085));animation-duration:40s;
  background:conic-gradient(hsl(var(--lh-a)/.22) 0 30%,hsl(var(--lh-a)/.75) 0 38%,hsl(var(--lh-a)/.22) 0 62%,hsl(var(--lh-b)/.7) 0 66%,hsl(var(--lh-a)/.22) 0)}
@keyframes lh-ring{from{transform:var(--rx) perspective(1000px) rotateX(75.5deg) rotate(0)}to{transform:var(--rx) perspective(1000px) rotateX(75.5deg) rotate(360deg)}}
.lh-ped-shadow{left:50%;bottom:var(--foot);width:calc(var(--S)*min(var(--fig-h)*var(--fig-ar),.9)*.8);height:calc(var(--S)*.08);transform:translate(-50%,50%);border-radius:50%;
  background:radial-gradient(closest-side,rgb(6 2 20/.85),rgb(6 2 20/.35) 60%,transparent)}
.lh-ped-fig{left:50%;bottom:var(--foot);height:calc(var(--S)*var(--fig-h));aspect-ratio:var(--fig-ar);transform:translateX(-50%);transition:opacity .9s ease;
  filter:drop-shadow(0 0 14px hsl(var(--lh-a)/.35))}
.lh-ped-poster{height:100%;width:100%}
.lh-ped-canvas{left:50%;bottom:calc(var(--foot) - var(--S)*.12);width:calc(var(--S)*1.7);height:calc(var(--S)*1.3);transform:translateX(-50%);opacity:0;transition:opacity .9s ease;
  filter:drop-shadow(0 0 14px hsl(var(--lh-a)/.35))}
.lh-ped[data-live] .lh-ped-fig{opacity:0}
.lh-ped[data-live] .lh-ped-canvas{opacity:1}
.lh-ped-motes{left:50%;bottom:var(--foot);width:calc(var(--S)*.95);height:calc(var(--S)*1.3);transform:translateX(-50%)}
.lh-ped-motes span{position:absolute;bottom:0;border-radius:50%;background:hsl(var(--lh-a) / 1);box-shadow:0 0 6px 1px hsl(var(--lh-a)/.9);opacity:0;animation:lh-mote 6s linear infinite}
.lh-ped-motes span:nth-child(3n){background:hsl(var(--lh-b));box-shadow:0 0 6px 1px hsl(var(--lh-b)/.9)}
@keyframes lh-mote{0%{transform:translateY(0);opacity:0}15%{opacity:.95}80%{opacity:.6}100%{transform:translateY(calc(var(--S)*-1.25));opacity:0}}
:root.light .lh-ped-top{background:radial-gradient(closest-side,hsl(var(--lh-a)/.5),hsl(var(--lh-a)/.16) 36%,transparent 62%),
    radial-gradient(closest-side,transparent 74%,hsl(var(--lh-a)/.42) 80%,transparent 84%),
    radial-gradient(ellipse at 50% 30%,#fff,hsl(258 60% 95%) 72%);
  box-shadow:inset 0 0 0 2px hsl(var(--lh-a)/.9),inset 0 0 18px hsl(var(--lh-a)/.38),0 0 26px hsl(var(--lh-a)/.4)}
:root.light .lh-ped-side{background:linear-gradient(180deg,hsl(258 48% 86%),hsl(260 38% 72%));
  box-shadow:inset 0 -2px 0 hsl(var(--lh-b)/.8),0 10px 26px hsl(262 50% 45%/.22),0 4px 22px hsl(var(--lh-b)/.3)}
:root.light .lh-ped-beam{background:linear-gradient(to top,hsl(var(--lh-a)/.42),hsl(var(--lh-a)/.14) 36%,hsl(var(--lh-b)/.05) 70%,transparent 96%)}
:root.light .lh-ped-beam::after{background:repeating-linear-gradient(0deg,transparent 0 7px,hsl(0 0% 100%/.5) 7px 8px)}
:root.light .lh-ped-glow{background:radial-gradient(closest-side,hsl(var(--lh-a)/.28),hsl(var(--lh-b)/.12) 55%,transparent)}
:root.light .lh-ped-shadow{background:radial-gradient(closest-side,rgb(60 36 140/.38),rgb(60 36 140/.12) 60%,transparent)}
:root.light .lh-ped-fig,:root.light .lh-ped-canvas{filter:drop-shadow(0 10px 18px rgb(70 40 160/.18))}
:root.light .lh-ped-motes span{background:hsl(var(--lh-a));box-shadow:0 0 5px hsl(var(--lh-a)/.6)}
:root.light .lh-ped-motes span:nth-child(3n){background:hsl(var(--lh-b));box-shadow:0 0 5px hsl(var(--lh-b)/.6)}

/* ---------------- 2. The size parade ---------------- */
.lh-parade{position:absolute;top:0;bottom:0;left:34%;right:0;pointer-events:none;--u:54px;--lane:60px;--giant-lane:148px;--march:34s;
  -webkit-mask-image:linear-gradient(90deg,transparent,rgb(0 0 0/.35) 12%,#000 30%,#000 97%,transparent);mask-image:linear-gradient(90deg,transparent,rgb(0 0 0/.35) 12%,#000 30%,#000 97%,transparent)}
.lh-lane,.lh-giant-lane{position:absolute;left:0;right:0;height:0}
.lh-lane{bottom:var(--lane)}
.lh-giant-lane{bottom:var(--giant-lane);container-type:inline-size}
.lh-track{position:absolute;left:0;bottom:0;height:0;width:calc(var(--L)*var(--u)*2);animation:lh-march var(--march) linear infinite}
@keyframes lh-march{to{transform:translateX(calc(var(--L)*var(--u)*-1))}}
.lh-walker{position:absolute;bottom:0;left:calc(var(--x)*var(--u));width:calc(var(--w)*var(--u));height:calc(var(--h)*var(--u));transform:translateX(-50%)}
.lh-bob{position:absolute;inset:0;transform-origin:50% 100%;animation:lh-bob var(--step) ease-in-out var(--lag) infinite alternate}
@keyframes lh-bob{from{transform:translateY(0) rotate(-1.8deg)}to{transform:translateY(calc(var(--h)*var(--u)*-.05 - 1.5px)) rotate(1.8deg)}}
.lh-fig{height:100%;width:100%}
.lh-walker .lh-fig{filter:drop-shadow(0 0 10px hsl(var(--lh-a)/.38)) drop-shadow(0 2px 2px rgb(0 0 0/.35))}
.lh-shadow{position:absolute;left:50%;bottom:0;width:calc(var(--w)*var(--u)*.8 + 6px);height:calc(var(--w)*var(--u)*.09 + 3px);transform:translate(-50%,45%);border-radius:50%;
  background:radial-gradient(closest-side,rgb(2 0 10/.85),rgb(2 0 10/.4) 50%,transparent)}
.lh-tag{position:absolute;left:50%;bottom:calc(100% + 26px);transform:translateX(-50%);white-space:nowrap;font-family:var(--font-pixel),ui-monospace,monospace;font-size:10px;line-height:1;
  letter-spacing:.12em;text-transform:uppercase;color:hsl(var(--foreground)/.85);padding:5px 7px;border-radius:4px;border:1px solid hsl(var(--lh-a)/.45);background:hsl(252 50% 8%/.7);
  box-shadow:0 0 14px hsl(var(--lh-a)/.25)}
.lh-tag::after{content:"";position:absolute;left:50%;top:100%;width:1px;height:20px;background:linear-gradient(hsl(var(--lh-a)/.8),transparent)}
.lh-tag b{font-weight:400;color:hsl(var(--lh-a));margin-left:4px}
.lh-tag-giant{left:58%;bottom:auto;top:62%}
.lh-tag-giant::after{display:none}
:root.light .lh-tag{background:hsl(0 0% 100%/.8);border-color:hsl(var(--screen)/.35);box-shadow:0 4px 14px rgb(70 40 160/.12)}
:root.light .lh-tag b{color:hsl(var(--screen))}
.lh-giant{position:absolute;bottom:0;left:100%;width:calc(var(--w)*var(--u));height:calc(var(--h)*var(--u));animation:lh-drift 64s linear -26s infinite}
@keyframes lh-drift{from{transform:translateX(0)}82%,to{transform:translateX(calc(-100cqw - 100%))}}
.lh-giant .lh-fig{filter:brightness(.55) saturate(1.15);-webkit-mask-image:linear-gradient(to top,rgb(0 0 0/.55),#000 40%);mask-image:linear-gradient(to top,rgb(0 0 0/.55),#000 40%)}
.lh-giant .lh-fig{animation:lh-float 9s ease-in-out infinite alternate}
@keyframes lh-float{from{transform:translateY(0)}to{transform:translateY(-10px)}}
:root.light .lh-walker .lh-fig{filter:drop-shadow(0 3px 6px rgb(60 36 140/.18))}
:root.light .lh-shadow{background:radial-gradient(closest-side,rgb(70 40 160/.42),rgb(70 40 160/.14) 60%,transparent)}
:root.light .lh-giant .lh-fig{filter:saturate(.85) opacity(.72)}
@media (max-width:1023px){.lh-parade{left:0;--u:60px;--lane:40px;--giant-lane:96px}}
@media (max-width:639px){
  .lh-giant .lh-fig{filter:brightness(.34) saturate(1.1);-webkit-mask-image:linear-gradient(to top,#000 20%,rgb(0 0 0/.35));mask-image:linear-gradient(to top,#000 20%,rgb(0 0 0/.35))}
  :root.light .lh-giant .lh-fig{filter:saturate(.7) opacity(.3)}
  .lh-tag{display:none}
  .lh-parade{--u:31px;--lane:14px;--giant-lane:30px;--march:30s;-webkit-mask-image:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent);mask-image:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent)}}

/* ---------------- 3. The holographic portal ---------------- */
.lh-portal{position:absolute;inset:0;--R:300px;--gate-top:4%}
@media (max-width:1023px){.lh-portal{--R:250px}}
@media (max-width:639px){.lh-portal{--R:112px;--gate-top:14px}.lh-pool{width:calc(var(--R)*1.25);bottom:2%}.lh-halo{inset:-18%}.lh-rim2{inset:-6%}}
.lh-portal>*,.lh-gate>*{position:absolute;pointer-events:none}
.lh-pool{left:50%;bottom:4%;width:calc(var(--R)*1.5);height:calc(var(--R)*.26);transform:translateX(-50%);border-radius:50%;
  background:radial-gradient(closest-side,hsl(var(--lh-a)/.7),hsl(var(--lh-a)/.25) 45%,transparent 72%),radial-gradient(closest-side,transparent 82%,hsl(var(--lh-b)/.55) 88%,transparent 93%);
  animation:lh-pool 6s ease-in-out infinite alternate}
@keyframes lh-pool{from{opacity:.75;scale:.96}to{opacity:1;scale:1.02}}
.lh-pbeam{left:50%;bottom:calc(4% + var(--R)*.13);top:calc(var(--gate-top) + var(--R)*.55);width:calc(var(--R)*.9);transform:translateX(-50%);
  background:radial-gradient(50% 100% at 50% 100%,hsl(var(--lh-a)/.34),hsl(var(--lh-a)/.1) 55%,transparent 80%)}
.lh-gate{left:50%;top:var(--gate-top);width:var(--R);aspect-ratio:1;translate:-50% 0;animation:lh-hover 7s ease-in-out infinite alternate}
@keyframes lh-hover{from{transform:translateY(0)}to{transform:translateY(-10px)}}
.lh-halo{inset:-26%;border-radius:50%;background:radial-gradient(closest-side,transparent 52%,hsl(var(--lh-a)/.42) 66%,hsl(var(--lh-b)/.16) 80%,transparent)}
.lh-core{inset:3.5%;border-radius:50%;
  background:radial-gradient(circle at 50% 70%,hsl(var(--lh-a)/.5),transparent 55%),radial-gradient(circle at 50% 50%,hsl(258 70% 16%),hsl(252 60% 6%) 72%);
  box-shadow:inset 0 0 30px hsl(var(--lh-a)/.75),inset 0 0 90px hsl(var(--lh-b)/.28),0 0 0 1px hsl(var(--lh-a)/.6)}
.lh-swirl{inset:3.5%;border-radius:50%;mix-blend-mode:screen;opacity:.55;animation:lh-spin 28s linear infinite;
  background:conic-gradient(from 0deg,transparent,hsl(var(--lh-a)/.55) 12%,transparent 24%,hsl(var(--lh-b)/.45) 40%,transparent 52%,hsl(var(--lh-c)/.35) 66%,transparent 78%,hsl(var(--lh-a)/.5) 90%,transparent);
  -webkit-mask-image:radial-gradient(closest-side,transparent 30%,#000 75%,transparent 100%);mask-image:radial-gradient(closest-side,transparent 30%,#000 75%,transparent 100%)}
@keyframes lh-spin{to{transform:rotate(360deg)}}
.lh-holo{inset:3.5%;border-radius:50%;overflow:hidden}
.lh-sil{position:absolute;left:50%;bottom:15%;max-height:64%;max-width:72%;transform:translateX(-50%);opacity:0;
  animation:lh-mat var(--cycle) linear var(--d) infinite;filter:brightness(1.12) drop-shadow(0 0 10px hsl(var(--lh-a)/.95)) drop-shadow(0 0 26px hsl(var(--lh-b)/.45))}
.lh-sil-art{position:absolute;aspect-ratio:1;
  background:repeating-linear-gradient(0deg,transparent 0 3px,hsl(0 0% 100%/.22) 3px 4px),var(--art) center/100% 100% no-repeat,linear-gradient(180deg,#fff 0%,hsl(var(--lh-a)) 34%,hsl(var(--lh-b)) 100%);
  background-blend-mode:normal,luminosity,normal;
  -webkit-mask:var(--art) center/100% 100% no-repeat;mask:var(--art) center/100% 100% no-repeat}
/* Half flat light over the render's shading: a silhouette, with just enough of the figure inside it to read as a hologram. */
.lh-sil-art::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,#fff,hsl(var(--lh-a)) 34%,hsl(var(--lh-b)));opacity:.76;mix-blend-mode:screen}
.lh-sil::after{content:"";position:absolute;left:-14%;right:-14%;height:2px;bottom:calc(var(--rv) - 7%);opacity:0;border-radius:2px;
  background:linear-gradient(90deg,transparent,#fff 30%,#fff 70%,transparent);box-shadow:0 0 12px 2px hsl(var(--lh-a));animation:lh-scan var(--cycle) linear var(--d) infinite}
/* Six silhouettes: each holds 1/6 of the loop (16.67%). It beams in from the feet up behind a soft edge (--rv, how much is
   revealed), flickers, holds, and dissolves upward. */
@property --rv{syntax:"<percentage>";inherits:true;initial-value:0%}
.lh-sil-in{position:absolute;inset:0;
  -webkit-mask-image:linear-gradient(to top,#000 calc(var(--rv) - 12%),transparent var(--rv));mask-image:linear-gradient(to top,#000 calc(var(--rv) - 12%),transparent var(--rv))}
@keyframes lh-mat{
  0%{opacity:0;--rv:0%}
  .8%{opacity:.7}
  4.5%{opacity:.9;--rv:114%}
  5.2%{opacity:.55}6%{opacity:1}
  12.5%{opacity:1;--rv:114%;transform:translateX(-50%) translateY(0) scale(1)}
  16.4%{opacity:0;--rv:114%;transform:translateX(-50%) translateY(-6%) scale(1.05)}
  100%{opacity:0;--rv:114%}}
@keyframes lh-scan{0%{opacity:0}.6%{opacity:1}4.2%{opacity:1}4.8%{opacity:0}100%{opacity:0}}
.lh-rim{inset:0;border-radius:50%;animation:lh-spin 9s linear infinite;
  background:conic-gradient(from 0deg,hsl(var(--lh-b)),hsl(var(--lh-a)) 22%,hsl(var(--lh-c)) 40%,hsl(var(--lh-a)) 58%,#fff 66%,hsl(var(--lh-b)) 80%,hsl(var(--lh-b)));
  -webkit-mask-image:radial-gradient(closest-side,transparent calc(100% - 9px),#000 calc(100% - 8px),#000 calc(100% - 1px),transparent);mask-image:radial-gradient(closest-side,transparent calc(100% - 9px),#000 calc(100% - 8px),#000 calc(100% - 1px),transparent)}
.lh-rim2{inset:-8%;border-radius:50%;animation:lh-spin 34s linear infinite reverse;opacity:.85;
  background:conic-gradient(hsl(var(--lh-a)/.9) 0 14%,transparent 0 19%,hsl(var(--lh-a)/.9) 0 21%,transparent 0 46%,hsl(var(--lh-b)/.9) 0 60%,transparent 0 64%,hsl(var(--lh-b)/.9) 0 66%,transparent 0);
  -webkit-mask-image:radial-gradient(closest-side,transparent calc(100% - 2px),#000 calc(100% - 1.5px));mask-image:radial-gradient(closest-side,transparent calc(100% - 2px),#000 calc(100% - 1.5px))}
.lh-sparks{left:50%;width:calc(var(--R)*1.15);top:0;bottom:6%;transform:translateX(-50%)}
.lh-sparks span{position:absolute;bottom:0;border-radius:50%;background:#fff;box-shadow:0 0 6px 2px hsl(var(--lh-a)),0 0 16px 4px hsl(var(--lh-a)/.55);opacity:0;animation:lh-rise 7s linear infinite}
.lh-sparks span.lh-star{border-radius:0;box-shadow:none;background:#fff;filter:drop-shadow(0 0 4px hsl(var(--lh-a)));clip-path:polygon(50% 0,60% 40%,100% 50%,60% 60%,50% 100%,40% 60%,0 50%,40% 40%)}
.lh-sparks span:nth-child(4n){box-shadow:0 0 6px 1px hsl(var(--lh-b)),0 0 12px 2px hsl(var(--lh-b)/.5)}
@keyframes lh-rise{0%{transform:translateY(0) scale(.6);opacity:0}12%{opacity:1}70%{opacity:.8}100%{transform:translateY(calc(var(--R)*-1.15)) scale(1);opacity:0}}
:root.light .lh-core{background:radial-gradient(circle at 50% 72%,hsl(var(--lh-b)/.22),transparent 55%),radial-gradient(circle at 50% 42%,#fff,hsl(262 70% 96%) 52%,hsl(262 60% 88%) 82%,hsl(262 55% 82%));
  box-shadow:inset 0 0 24px hsl(var(--lh-a)/.4),inset 0 -20px 60px hsl(var(--lh-b)/.16),0 18px 50px rgb(80 50 180/.18)}
:root.light .lh-swirl{mix-blend-mode:normal;opacity:.4}
:root.light .lh-halo{background:radial-gradient(closest-side,transparent 52%,hsl(var(--lh-a)/.3) 66%,hsl(var(--lh-b)/.12) 80%,transparent)}
:root.light .lh-rim{background:conic-gradient(from 0deg,#ffb3d6,#c7b2ff 20%,#a8efe4 38%,#fff 50%,#d4c4ff 62%,#ffc9e2 78%,#fff3c9 90%,#ffb3d6)}
:root.light .lh-sil{filter:drop-shadow(0 0 8px hsl(var(--lh-a)/.6)) drop-shadow(0 6px 16px hsl(var(--lh-b)/.3))}
:root.light .lh-sil-art{background:repeating-linear-gradient(0deg,transparent 0 3px,hsl(0 0% 100%/.34) 3px 4px),var(--art) center/100% 100% no-repeat,linear-gradient(180deg,hsl(262 80% 72%),hsl(278 72% 64%) 45%,hsl(330 80% 66%))}
:root.light .lh-sil-art::after{background:linear-gradient(180deg,hsl(262 80% 74%),hsl(330 80% 72%));opacity:.4}
:root.light .lh-sparks span{background:#fff;box-shadow:0 0 5px 1px hsl(var(--lh-a)/.75),0 0 10px 2px hsl(var(--lh-b)/.3)}
:root.light .lh-sparks span.lh-star{background:hsl(var(--lh-a));filter:drop-shadow(0 0 3px #fff)}
:root.light .lh-pool{background:radial-gradient(closest-side,hsl(var(--lh-a)/.45),hsl(var(--lh-a)/.14) 45%,transparent 72%),radial-gradient(closest-side,transparent 83%,hsl(var(--lh-a)/.4) 88%,transparent 92%)}

@media (prefers-reduced-motion: reduce){
  .lh-ped *,.lh-ped *::after,.lh-parade *,.lh-portal *,.lh-portal *::after{animation:none!important}
  .lh-ped-ring{transform:var(--rx) perspective(1000px) rotateX(75.5deg)}
  .lh-ped-motes span{opacity:.7;transform:translateY(calc(var(--S)*-.3))}
  .lh-ped-motes span:nth-child(2n){transform:translateY(calc(var(--S)*-.75))}
  .lh-ped-motes span:nth-child(3n){transform:translateY(calc(var(--S)*-1.05))}
  .lh-giant{transform:translateX(calc(-50cqw - 50%))}
  .lh-sil{--rv:114%}
  .lh-sil:first-child{opacity:1}
  .lh-sparks span{opacity:.8;transform:translateY(calc(var(--R)*-.15))}
  .lh-sparks span:nth-child(2n){transform:translateY(calc(var(--R)*-.55))}
  .lh-sparks span:nth-child(3n){transform:translateY(calc(var(--R)*-.9))}
}
`;
