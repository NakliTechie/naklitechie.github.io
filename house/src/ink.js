// One screen-space ink pass in two tones (ink on paper). The scene pass writes
// R = tone (lit albedo), G = material id / 16 into a render target; the ink pass
// turns tone into hatching, stipple, Bayer dither or line art depending on the id.
import {
  MeshLambertMaterial, ShaderMaterial, WebGLRenderTarget, DepthTexture, UnsignedIntType,
  NearestFilter, RGBAFormat, Vector2, Mesh, PlaneGeometry, Scene,
  OrthographicCamera, Color,
} from 'three';

export const ID = { PAPER: 0, CONCRETE: 1, STONE: 2, GROUND: 3, FOLIAGE: 4, WATER: 5, GLASS: 6, STEEL: 7 };

const HASH = /* glsl */ `
float h11(float p){ p = fract(p*.1031); p *= p+33.33; p *= p+p; return fract(p); }
float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
`;

// Per-material patterns edit `tone` using world position (vWPos) before it is written.
const PATTERNS = {
  none: '',
  // coursed ashlar: mortar lines in dark, per-block tone variation
  stone: /* glsl */ `
    vec3 gn = abs(normalize(cross(dFdx(vWPos), dFdy(vWPos))));
    vec2 q = gn.y > .7 ? vWPos.xz : (gn.x > gn.z ? vWPos.zy : vWPos.xy);
    float course = floor(q.y/.34);
    float off = h11(course)*5.;
    float bl = .55 + .9*h11(course+3.);
    float bi = floor((q.x+off)/bl);
    float vx = fract((q.x+off)/bl)*bl;
    float vy = fract(q.y/.34)*.34;
    float mortar = max(step(vy,.035), step(vx,.035));
    tone *= (.82 + .3*h21(vec2(bi,course))) * (1. - .6*mortar);
  `,
  rock: /* glsl */ `
    float rk = h21(floor(vWPos.xz*1.6)+floor(vWPos.y*1.6)*7.);
    tone *= .78 + .35*rk;
  `,
  foliage: /* glsl */ `
    tone *= .72 + .5*h21(floor(vWPos.xz*2.)+floor(vWPos.y*2.)*5.);
  `,
  ground: /* glsl */ `
    tone *= .86 + .22*h21(floor(vWPos.xz*1.3));
  `,
  concrete: /* glsl */ `
    // horizontal form-board lines, the building's grain
    float fb = step(fract(vWPos.y/.42), .05);
    tone *= 1. - .1*fb;
  `,
};

export function inkMaterial(id, albedo, pattern = 'none') {
  const m = new MeshLambertMaterial();
  m.color.setRGB(albedo, albedo, albedo);
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wp4 = vec4(transformed, 1.);
        #ifdef USE_INSTANCING
          wp4 = instanceMatrix * wp4;
        #endif
        vWPos = (modelMatrix * wp4).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\n${HASH}`)
      .replace('#include <opaque_fragment>', `
        float tone = dot(outgoingLight, vec3(.299,.587,.114));
        ${PATTERNS[pattern]}
        gl_FragColor = vec4(clamp(tone,0.,1.), ${id.toFixed(1)}/16., 0., 1.);`);
  };
  m.customProgramCacheKey = () => `ink-${id}-${pattern}`;
  return m;
}

// Water: flowing line art written directly as tone (ink where tone < .5).
export function waterMaterials() {
  const uTime = { value: 0 };
  const common = /* glsl */ `
    uniform float uTime; varying vec3 vW;
    ${HASH}
    float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
      return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
  `;
  const vert = `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`;
  const still = new ShaderMaterial({
    uniforms: { uTime }, vertexShader: vert,
    fragmentShader: common + /* glsl */ `
      void main(){
        float u = vW.x - uTime*1.1;       // streaks run downstream (+x)
        float v = vW.z;
        float wob = vn(vec2(u*.35, v*.8))*2.2;
        float lines = abs(fract((v + wob)*2.1) - .5)*2.;       // 1 at line centre
        float broken = vn(vec2(u*.9, floor((v+wob)*2.1)*3.1));   // dashes along the flow
        float ink = step(.78, lines) * step(.4, broken);
        // ripples near the ledge lip
        float lip = smoothstep(2.4, 0., 6. - vW.x);
        ink = max(ink, lip * step(.75, vn(vec2(u*2.2, v*3.5))));
        gl_FragColor = vec4(1. - ink, ${ID.WATER}./16., 0., 1.);
      }`,
  });
  const fall = new ShaderMaterial({
    uniforms: { uTime }, vertexShader: vert,
    fragmentShader: common + /* glsl */ `
      void main(){
        float z = vW.z, y = vW.y;
        float cols = vn(vec2(z*3.2, 1.));
        float streak = vn(vec2(z*5.5 + cols*3., y*.55 + uTime*3.4));
        float ink = step(.6, streak) * step(.2, vn(vec2(z*9., y*.3 + uTime*2.)));
        // dark stripes wobble, a few solid threads
        float thread = step(.93, vn(vec2(z*14., y*.15 + uTime*4.2)));
        // foam band at the foot
        float foot = smoothstep(-2.4, -3.3, y);
        ink = max(ink, thread);
        ink = mix(ink, step(.55, h21(floor(vec2(z*9., y*9. + uTime*8.)))), foot*.8);
        gl_FragColor = vec4(1. - ink, ${ID.WATER}./16., 0., 1.);
      }`,
  });
  const pool = new ShaderMaterial({
    uniforms: { uTime }, vertexShader: vert,
    fragmentShader: common + /* glsl */ `
      void main(){
        vec2 c = vW.xz - vec2(7.2, 5.);
        float ring = length(c*vec2(.5, 1.));
        float u = vW.x - uTime*.7;
        float lines = abs(fract(vW.z*1.1 + vn(vec2(u*.45, vW.z))*2.) - .5)*2.;
        float ink = step(.84, lines) * step(.4, vn(vec2(u*.8, floor(vW.z*1.1)*2.3)));
        float foam = 1. - smoothstep(1.2, 5., ring);
        ink = max(ink, foam * step(.6, h21(floor(vec2(vW.x*7., vW.z*7. + uTime*6.)))));
        gl_FragColor = vec4(1. - ink, ${ID.WATER}./16., 0., 1.);
      }`,
  });
  const spray = new ShaderMaterial({
    uniforms: { uTime, uScale: { value: 600 } },
    vertexShader: /* glsl */ `
      uniform float uTime, uScale; attribute vec4 aSeed;
      void main(){
        float t = fract(aSeed.x + uTime*(.25+aSeed.y*.35));
        vec3 p = position;
        p.x += (t*1.6 + aSeed.z*.6) * (.4+aSeed.y);
        p.y += t*2.4*aSeed.w - t*t*1.2;
        vec4 mv = modelViewMatrix*vec4(p,1.);
        gl_PointSize = min((1. - t*.6) * 1.1 * uScale / -mv.z, 7.);
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: /* glsl */ `
      void main(){ vec2 d = gl_PointCoord-.5; if(dot(d,d)>.25) discard;
        gl_FragColor = vec4(0.,${ID.WATER}./16.,0.,1.); }`,
  });
  return { still, fall, pool, spray, uTime };
}

const INK_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tScene, tDepth;
uniform vec2 uRes; uniform float uUnit, uNear, uFar, uTime, uFadeScale, uPlan;
uniform vec3 uPaper, uInk;
varying vec2 vUv;
${HASH}
float bayer4(vec2 c){
  int x = int(mod(c.x,4.)), y = int(mod(c.y,4.));
  float m[16] = float[16](0.,8.,2.,10., 12.,4.,14.,6., 3.,11.,1.,9., 15.,7.,13.,5.);
  return (m[x+y*4]+.5)/16.;
}
float lin(float d){ return uNear*uFar/(uFar - d*(uFar-uNear)); }
float line(vec2 p, float ang, float sp, float w){
  float t = dot(p, vec2(cos(ang), sin(ang)))/sp;
  float c = abs(fract(t) - .5)*2.;
  float aa = fwidth(c)*.8 + .001;
  return smoothstep(1.-w-aa, 1.-w+aa, c) * step(.001, w);
}
void main(){
  vec2 px = gl_FragCoord.xy;
  float u = uUnit;
  vec4 s = texture2D(tScene, vUv);
  float tone = s.r;
  float id = floor(s.g*16. + .5);
  float d = texture2D(tDepth, vUv).r;
  bool sky = d > .99999;
  float ld = sky ? uFar : lin(d);

  // outlines from depth and id discontinuities
  vec2 o = vec2(u)/uRes;
  float dl = lin(texture2D(tDepth, vUv+vec2(o.x,0.)).r), dr = lin(texture2D(tDepth, vUv-vec2(o.x,0.)).r);
  float du = lin(texture2D(tDepth, vUv+vec2(0.,o.y)).r), dd = lin(texture2D(tDepth, vUv-vec2(0.,o.y)).r);
  float rel = max(max(abs(dl-ld), abs(dr-ld)), max(abs(du-ld), abs(dd-ld)))/ld;
  float e = smoothstep(.025, .06, rel);
  float idr = floor(texture2D(tScene, vUv+vec2(o.x,0.)).g*16.+.5), idu = floor(texture2D(tScene, vUv+vec2(0.,o.y)).g*16.+.5);
  if (!sky) e = max(e, step(.5, abs(id-idr)+abs(id-idu)) * .6);
  e *= 1. - smoothstep(70.*uFadeScale, 170.*uFadeScale, ld);

  // distance fades toward paper
  float fade = smoothstep(35.*uFadeScale, 170.*uFadeScale, ld);
  float pb = (!sky && id < 2.5) ? uPlan*.28 : 0.;
  float dk = clamp(1. - tone + pb, 0., 1.) * .8 * (1. - fade*.9);

  vec2 p = px + vec2(sin(px.y*.05)*.7, sin(px.x*.04)*.7)*u;   // hand wobble
  vec2 cell = floor(px/u);
  float ink = 0.;

  if (sky) {
    float gy = 1. - vUv.y;                                   // sparse stipple, denser toward the zenith
    ink = step(bayer4(cell), gy*gy*.16) * step(.5, h21(cell));
    e = 0.;
  } else if (id < 1.5) {                                      // concrete: horizontal hatch + cross hatch
    float w1 = clamp((dk-.20)*1.5, 0., .6);
    float w2 = clamp((dk-.42)*1.6, 0., .8);
    ink = max(line(p, .0, 4.2*u, w1), line(p, 1.05, 5.*u, w2));
    ink = max(ink, step(.93, dk));
  } else if (id < 2.5) {                                      // stone: stipple + diagonal hatch
    float st = step(h21(floor(px/(1.5*u))), dk*.7);
    ink = max(st*step(.12, dk), line(p, .78, 4.6*u, clamp((dk-.4)*1.6, 0., 1.)));
    
  } else if (id < 3.5) {                                      // ground: stipple
    ink = step(h21(floor(px/(1.8*u))), dk*.85);
  } else if (id < 4.5) {                                      // foliage: Bayer dither
    ink = step(bayer4(cell), dk*1.2 - .05);
  } else if (id < 5.5) {                                      // water: line art passthrough
    ink = step(tone, .5 + (bayer4(cell)-.5)*.2);
    ink *= 1. - fade*.8;
  } else if (id < 6.5) {                                      // glass: sparse diagonal
    ink = line(p, .96, 8.*u, clamp((dk-.12)*1.2, 0., .22));
  } else {                                                    // steel: solid
    ink = step(.2, dk);
  }
  ink = max(ink, e);
  gl_FragColor = vec4(mix(uPaper, uInk, ink), 1.);
}`;

export class InkPass {
  constructor(near, far) {
    this.scene = new Scene();
    this.cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.mat = new ShaderMaterial({
      uniforms: {
        tScene: { value: null }, tDepth: { value: null }, uRes: { value: new Vector2(1, 1) },
        uUnit: { value: 1 }, uFadeScale: { value: 1 }, uPlan: { value: 0 }, uNear: { value: near }, uFar: { value: far }, uTime: { value: 0 },
        uPaper: { value: new Color('#F7F2E7') }, uInk: { value: new Color('#2C2A24') },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
      fragmentShader: INK_FRAG, depthTest: false, depthWrite: false,
    });
    // ShaderMaterial colours bypass colour management; give sRGB values as linear-to-output
    this.mat.uniforms.uPaper.value.setRGB(0xF7 / 255, 0xF2 / 255, 0xE7 / 255);
    this.mat.uniforms.uInk.value.setRGB(0x2C / 255, 0x2A / 255, 0x24 / 255);
    this.scene.add(new Mesh(new PlaneGeometry(2, 2), this.mat));
    this.rt = null;
  }
  resize(w, h, unit) {
    if (this.rt) { this.rt.dispose(); this.rt.depthTexture?.dispose(); }
    this.rt = new WebGLRenderTarget(w, h, { format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: true });
    this.rt.depthTexture = new DepthTexture(w, h, UnsignedIntType);
    this.mat.uniforms.tScene.value = this.rt.texture;
    this.mat.uniforms.tDepth.value = this.rt.depthTexture;
    this.mat.uniforms.uRes.value.set(w, h);
    this.mat.uniforms.uUnit.value = unit;
  }
  render(renderer, scene, camera, time) {
    this.mat.uniforms.uTime.value = time;
    renderer.setRenderTarget(this.rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.cam);
  }
}
