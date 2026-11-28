import * as THREE from "three";
import { latOf, lonOf, type Atlas } from "@/lib/globe/geo";
import { LAST_GEN, regionGeneration } from "@/lib/globe/era";

/**
 * The world globe's look, shared by the World globe (/pokeguessr/globe, scene.ts) and the PokéGuessr landing's
 * planet (geo/hub-globe/scene.ts): the holographic world (the atlas mask, in the site's theme colours), its
 * atmosphere, the drifting clouds, the towns lighting up at night, and how each is lit for the current pose. Each
 * scene owns its camera, motion, labels and anything else it draws.
 *
 * Colours never depend on THREE.ColorManagement (the World globe turns it off; the landing leaves it on for the
 * trainer drawn beside it): theme tokens go through setHSL, and fixed colours are set in the working colour space.
 */

export const GLOBE_R = 1;

export const toVec = (lon: number, lat: number, r = GLOBE_R, out = new THREE.Vector3()) => {
  const phi = ((90 - lat) * Math.PI) / 180, th = ((lon + 180) * Math.PI) / 180;
  return out.set(-r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th));
};

/** "248 40% 97%" token -> three Color, bypassing colour management so it matches the CSS exactly. */
export function tokenColor(name: string, out: THREE.Color) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  const [h, s, l] = raw.match(/-?[\d.]+/g)?.map(Number) ?? [0, 0, 50];
  return out.setHSL(h / 360, s / 100, l / 100);
}
/** A hex colour, as is (whatever THREE.ColorManagement is set to). */
const hex = (c: THREE.Color, h: number) => c.setHex(h, THREE.ColorManagement.workingColorSpace);

export const NOISE = `
float hash(vec3 p){ p=fract(p*.3183099+.1); p*=17.; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.-2.*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float a=.5, s=0.; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=.5; } return s; }
`;

export interface WorldLookOptions {
  /** The atlas mask (public/geo/maps/globe-mask.*). */
  mask: string;
  onMask?: () => void;
  onMaskError?: () => void;
  maxAniso: number;
  /** The world sphere's and the clouds' segments across. */
  segments: number;
  cloudSegments: number;
  /** A pool of light on one point of the world (the landing's region in focus); off by default. */
  focus?: boolean;
}

export type WorldLook = ReturnType<typeof createWorldLook>;

export function createWorldLook(o: WorldLookOptions) {
  const R = GLOBE_R;
  const disposables: { dispose(): void }[] = [];
  const tex = new THREE.TextureLoader().load(o.mask, o.onMask, undefined, o.onMaskError);
  tex.anisotropy = o.maxAniso;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  disposables.push(tex);
  const blank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  blank.needsUpdate = true;
  disposables.push(blank);

  /** The sun, and the camera, in the world's own frame (set by orient()). */
  const sunObj = new THREE.Vector3(1, 0, 0), camObj = new THREE.Vector3();
  const C = () => new THREE.Color();
  const U = {
    map: { value: tex }, gens: { value: blank as THREE.Texture }, hasGens: { value: 0 }, era: { value: LAST_GEN },
    time: { value: 0 }, land: { value: C() }, coast: { value: C() }, grid: { value: C() }, rim: { value: C() }, sea: { value: C() },
    seaInk: { value: C() }, seaK: { value: 0 }, shoal: { value: C() },
    spec: { value: C() }, dusk: { value: new THREE.Color(1, 0.62, 0.36) }, nightTint: { value: new THREE.Color(0.72, 0.78, 1.15) },
    nightLevel: { value: 0.34 }, light: { value: 0 }, uSun: { value: sunObj }, uCam: { value: camObj },
    uFocus: { value: new THREE.Vector3(0, 1, 0) }, uFocusK: { value: 0 }, uWorldK: { value: 0 }, uHot: { value: C() },
  };
  const holo = new THREE.ShaderMaterial({
    uniforms: U,
    defines: o.focus ? { FOCUS: 1 } : {},
    vertexShader: `varying vec2 vUv; varying vec3 vP;
      void main(){ vUv=uv; vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform sampler2D map; uniform sampler2D gens; uniform float hasGens; uniform float era; uniform float time;
      uniform vec3 land; uniform vec3 coast; uniform vec3 grid; uniform vec3 rim; uniform vec3 sea; uniform vec3 seaInk; uniform float seaK; uniform vec3 shoal; uniform vec3 spec; uniform vec3 dusk; uniform vec3 nightTint;
      uniform float nightLevel; uniform float light; uniform vec3 uSun; uniform vec3 uCam;
      #ifdef FOCUS
      uniform vec3 uFocus; uniform float uFocusK; uniform float uWorldK; uniform vec3 uHot;
      #endif
      varying vec2 vUv; varying vec3 vP;
      ${NOISE}
      float gridf(vec2 uv, vec2 n){ vec2 g=abs(fract(uv*n-.5)-.5)/max(fwidth(uv*n),vec2(1e-6)); return 1.-min(min(g.x,g.y),1.); }
      void main(){
        vec3 N=normalize(vP); vec3 V=normalize(uCam-vP);
        float m=texture2D(map,vUv).r;
        float gen=texture2D(gens,vUv).r*255./25.;
        float vis=hasGens>.5 ? clamp(era-gen+1.,0.,1.) : 1.;
        float l0=step(.04,m), c0=smoothstep(.85,1.,m);
        float l=l0*vis, c=c0*vis;
        float g=gridf(vUv, vec2(36.,18.))*(1.-l*.6);
        float f=pow(max(1.-max(dot(N,V),0.),0.),2.2);
        float band=.96+.04*sin(vUv.y*900.+time*2.);
        // The open sea, so it reads as water: lighter shallows round the coasts (the mask, blurred by its mipmaps) and
        // faint drifting ripple lines (contours of a slow noise, on the sphere itself, so no seam and no pinch at the
        // poles). Both fade under the land.
        float near=texture2D(map,vUv,4.).r;
        float sh=smoothstep(.0,.3,near);
        float rn=vnoise(vP*4.2+vec3(0.,time*.015,0.))+.5*vnoise(vP*9.5+vec3(time*.02,0.,0.));
        float rc=rn*5., rw=fwidth(rc);
        float lines=1.-smoothstep(rw*.5,rw*1.5+.02,abs(fract(rc+.5)-.5));
        vec3 col=mix(sea, shoal, sh*.55);
        col=mix(col, seaInk, seaK*(lines*.9+.25*smoothstep(.25,1.2,rn))*(1.-sh*.5));
        col=mix(col, land*(.55+.75*m)*band, l*.92);
        col=mix(col, coast, c*.9);
        col=mix(col, land, l0*(1.-vis)*.09);
        col=mix(col, grid, g*.35);
        float ndl=dot(N,uSun);
        float day=smoothstep(-.1,.22,ndl);
        vec3 H=normalize(uSun+V); float nh=max(dot(N,H),0.);
        float w=vnoise(vP*38.+vec3(time*.25,time*.18,0.));
        col+=spec*(pow(nh,110.)*(.55+.45*w)*.42+pow(nh,12.)*.035)*(1.-l0)*day;
        col*=mix(nightLevel,1.,day);
        col=mix(col,col*nightTint,(1.-day)*.75);
        float dx=(ndl-.03)/.06;
        col+=dusk*exp(-dx*dx)*(light>.5?.025:.05)*(.35+.65*l);
        #ifdef FOCUS
        // A pool of light on the region in focus, ringed; the whole world in focus: its rim brighter.
        float fp=dot(N,uFocus);
        float pool=smoothstep(cos(.26),cos(.05),fp);
        float fr=(fp-cos(.21))/.004;
        float ring=exp(-fr*fr);
        col=mix(col, col*1.12+uHot*.1, pool*uFocusK*(.35+.65*l));
        col=mix(col, uHot, ring*.75*uFocusK);
        f*=1.+.8*uWorldK;
        #endif
        col+=rim*f*(light>.5?.35:.9)*mix(.4,1.,day);
        gl_FragColor=vec4(col,1.);
      }`,
  });
  const sphereGeo = new THREE.SphereGeometry(R, o.segments, o.segments / 2);
  const sphere = new THREE.Mesh(sphereGeo, holo);
  disposables.push(holo, sphereGeo);

  // ---- atmosphere: a rim of light around the limb, brighter on the day side
  const haloU = { color: { value: C() }, dusk: { value: new THREE.Color(1, 0.55, 0.4) }, strength: { value: 1 }, uSunV: { value: new THREE.Vector3() } };
  const haloMat = new THREE.ShaderMaterial({
    uniforms: haloU, transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending, premultipliedAlpha: true,
    vertexShader: `varying vec3 vN; void main(){ vN=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform vec3 color; uniform vec3 dusk; uniform float strength; uniform vec3 uSunV; varying vec3 vN;
      void main(){
        float i=pow(max(.72-dot(vN,vec3(0,0,1.)),0.),2.4)*strength;
        float s=dot(vN,uSunV);
        float lit=.35+.85*smoothstep(-.45,.55,s);
        float sx=s/.28;
        vec3 c=mix(color,dusk,exp(-sx*sx)*.45);
        float k=i*lit; gl_FragColor=vec4(c*k,min(1.,k*.8));
      }`,
  });
  const haloGeo = new THREE.SphereGeometry(R * 1.17, 64, 32);
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.renderOrder = 4;
  disposables.push(haloMat, haloGeo);

  // ---- clouds: drifting fbm streaks on a shell just above the world
  const cloudU = { uTime: { value: 0 }, uSun: { value: new THREE.Vector3() }, uFade: { value: 1 }, uDay: { value: C() }, uNight: { value: C() }, uAmt: { value: 0.34 } };
  const cloudMat = new THREE.ShaderMaterial({
    uniforms: cloudU, transparent: true, depthWrite: false,
    vertexShader: `varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform float uTime; uniform vec3 uSun; uniform float uFade; uniform vec3 uDay; uniform vec3 uNight; uniform float uAmt; varying vec3 vP;
      ${NOISE}
      void main(){
        vec3 p=normalize(vP);
        vec3 q=p*vec3(2.1,4.6,2.1);
        float w=fbm(q*.9+vec3(uTime*.012,0.,uTime*.008));
        float n=fbm(q*1.6+w*1.4+vec3(-uTime*.02,0.,uTime*.01));
        float a=smoothstep(.54,.78,n)*uAmt;
        float lit=smoothstep(-.18,.3,dot(p,uSun));
        a*=mix(.12,1.,lit)*uFade*(1.-smoothstep(.72,.98,abs(p.y)));
        if(a<.004) discard;
        gl_FragColor=vec4(mix(uNight,uDay,lit),a);
      }`,
  });
  const cloudGeo = new THREE.SphereGeometry(R * 1.016, o.cloudSegments, o.cloudSegments / 2);
  const clouds = new THREE.Mesh(cloudGeo, cloudMat);
  clouds.renderOrder = 3;
  disposables.push(cloudMat, cloudGeo);

  // ---- city lights: every town and city glows warm on the night side
  const lightMat = new THREE.ShaderMaterial({
    uniforms: { uSun: U.uSun, uCam: U.uCam, uEra: U.era, uTime: { value: 0 }, uPx: { value: 1 }, uColor: { value: new THREE.Color(1, 0.78, 0.42) }, uFade: { value: 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, premultipliedAlpha: true,
    vertexShader: `attribute float aSize; attribute float aGen; attribute float aSeed; uniform vec3 uSun; uniform vec3 uCam; uniform float uEra; uniform float uTime; uniform float uPx; uniform float uFade; varying float vA;
      void main(){ vec3 n=normalize(position);
        float night=smoothstep(.04,-.2,dot(n,uSun));
        float vis=clamp(uEra-aGen+1.,0.,1.);
        float facing=dot(n,normalize(uCam-position));
        vA=night*vis*smoothstep(.0,.3,facing)*(.82+.18*sin(uTime*(1.3+aSeed)+aSeed*50.))*uFade;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
        gl_PointSize=vA>.003 ? aSize*uPx : 0.; }`,
    fragmentShader: `uniform vec3 uColor; varying float vA;
      void main(){ float d=length(gl_PointCoord-.5)*2.; float core=smoothstep(.32,0.,d); float glow=pow(max(1.-d,0.),2.2)*.6;
        gl_FragColor=vec4((uColor*glow+vec3(1.,.95,.85)*core)*vA,(glow+core)*vA); }`,
  });
  const lightGeo = new THREE.BufferGeometry();
  const cityLights = new THREE.Points(lightGeo, lightMat);
  cityLights.renderOrder = 2;
  disposables.push(lightMat, lightGeo);

  /** The night lights: every town and city marker, and the atlas's other towns (`places`: those not markers). */
  function setTowns(a: Atlas, places: Atlas["places"]) {
    const { W, H } = a;
    const towns = [...a.markers.map((m) => ({ ...m, big: m.kind === "city" })), ...places.filter((p) => p.kind === "town").map((p) => ({ ...p, big: false }))];
    const lp = new Float32Array(towns.length * 3), ls = new Float32Array(towns.length), lg = new Float32Array(towns.length), lsd = new Float32Array(towns.length);
    const v = new THREE.Vector3();
    towns.forEach((m, i) => {
      toVec(lonOf(m.x, W), latOf(m.y, W, H), R * 1.003, v);
      lp.set([v.x, v.y, v.z], i * 3);
      ls[i] = m.big ? 15 : 10;
      lg[i] = regionGeneration(m.region) ?? 1;
      lsd[i] = Math.random();
    });
    lightGeo.setAttribute("position", new THREE.BufferAttribute(lp, 3));
    lightGeo.setAttribute("aSize", new THREE.BufferAttribute(ls, 1));
    lightGeo.setAttribute("aGen", new THREE.BufferAttribute(lg, 1));
    lightGeo.setAttribute("aSeed", new THREE.BufferAttribute(lsd, 1));
  }

  /** The theme's colours (html.light or not), from the site's tokens. Returns --screen and --primary for the scene's own parts. */
  function applyTheme(dark: boolean) {
    const screen = tokenColor("--screen", C()), primary = tokenColor("--primary", C());
    U.light.value = dark ? 0 : 1;
    tokenColor("--card", U.sea.value); U.land.value.copy(screen); tokenColor("--foreground", U.coast.value); tokenColor("--border", U.grid.value);
    // The sea's texture: by night a faint lift towards the land's violet, by day a lavender wash on the white card.
    if (!dark) U.sea.value.lerp(U.grid.value, 0.35);
    U.seaInk.value.copy(screen);
    U.seaK.value = 0.045;
    U.shoal.value.copy(U.sea.value).lerp(screen, dark ? 0.1 : 0.06);
    if (!dark) U.shoal.value.lerp(new THREE.Color(1, 1, 1), 0.5);
    if (dark) U.rim.value.copy(screen); else hex(U.rim.value, 0xffffff);
    U.spec.value.copy(dark ? new THREE.Color(0.85, 0.82, 1) : new THREE.Color(1, 1, 1));
    // The night side stays readable: an era's new region may lie on it.
    U.nightLevel.value = dark ? 0.6 : 0.74;
    hex(U.nightTint.value, dark ? 0x7f8cff : 0xd2d0ff).multiplyScalar(dark ? 1.25 : 1.05);
    U.uHot.value.copy(primary).lerp(new THREE.Color(1, 1, 1), dark ? 0.35 : 0.1);
    haloU.color.value.copy(dark ? screen : primary.clone().lerp(screen, 0.6)); haloU.strength.value = dark ? 1.2 : 0.32;
    cloudU.uDay.value.copy(dark ? new THREE.Color(0.93, 0.92, 1) : new THREE.Color(1, 1, 1));
    cloudU.uNight.value.copy(dark ? new THREE.Color(0.22, 0.2, 0.42) : new THREE.Color(0.75, 0.74, 0.9));
    cloudU.uAmt.value = dark ? 0.34 : 0.5;
    hex(lightMat.uniforms.uColor.value, dark ? 0xffc46a : 0xff9a3c);
    return { screen, primary };
  }

  const qInv = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  /**
   * Lights the world for a pose: `q` the world's rotation in the scene, the sun's direction in the scene, `tm` the
   * ambient clock (clouds, glint, twinkle), the clouds turned `cloudYaw` about the axis on top of the world's turn.
   * The camera's matrices must be up to date.
   */
  function orient(q: THREE.Quaternion, camera: THREE.Camera, sunWorld: THREE.Vector3, tm: number, cloudYaw: number) {
    qInv.copy(q).invert();
    sunObj.copy(sunWorld).applyQuaternion(qInv);
    camObj.copy(camera.position).applyQuaternion(qInv);
    haloU.uSunV.value.copy(sunWorld).transformDirection(camera.matrixWorldInverse);
    U.time.value = tm;
    clouds.rotation.y = cloudYaw;
    cloudU.uSun.value.copy(sunObj).applyAxisAngle(up, -clouds.rotation.y);
    cloudU.uTime.value = tm;
    lightMat.uniforms.uTime.value = tm;
  }

  return { sphere, U, halo, haloU, clouds, cloudU, cityLights, lightMat, lightGeo, sunObj, camObj, setTowns, applyTheme, orient, disposables };
}
