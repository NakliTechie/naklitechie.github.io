/* eslint-disable complexity, max-lines-per-function */
// A stylised house after Fallingwater, built from boxes in code. Units are metres.
// Stream flows toward +x; the hill is north (-z); the cantilevers hang south over the water.
import {
  Group, Mesh, BoxGeometry, PlaneGeometry, BufferGeometry, BufferAttribute,
  IcosahedronGeometry, CylinderGeometry, InstancedMesh, Matrix4, Quaternion, Vector3, Euler, Points,
  DirectionalLight, HemisphereLight, MeshBasicMaterial, DoubleSide,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { inkMaterial, waterMaterials, ID } from './ink.js';

export const FALL_X = 6, WATER_UP = 0, WATER_DOWN = -3.4;
const L1 = 4.0, L2 = 7.4, L3 = 10.8, SLAB = 0.5;

// ---------- deterministic noise ----------
function hash2(x, y) { let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
}
let seed = 1234567;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967295);
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// ---------- terrain ----------
const GUEST = { cx: -9, cz: -21 };
function rawHill(x, z) {
  let h = 3.7;
  h += 0.62 * Math.min(Math.max(0, -z - 5), 11) + 0.18 * Math.max(0, -z - 16);
  h += 0.22 * Math.max(0, z - 15) + 0.16 * Math.max(0, -x - 14);
  h += 6 * sstep(26, 58, Math.hypot(x * .8, z * 1.0));
  h += 0.9 * (vnoise(x * .09, z * .09) - .5) * 2 + 0.25 * (vnoise(x * .35, z * .35) - .5) * 2;
  return h;
}
const PAD_Y = rawHill(GUEST.cx, GUEST.cz);
function bedAt(x) {
  // upstream bed, stepped ledge near the lip, deeper downstream
  const up = -1.3, down = -4.6;
  return lerp(up, down, sstep(5.2, 7.4, x)) + 0.35 * Math.sin(x * 1.7) * sstep(5, 7, x) * (1 - sstep(7.4, 9, x));
}
export function terrainH(x, z) {
  let h = rawHill(x, z);
  // flatten under the house and the guest pad
  const fx = Math.max(Math.max(-4.8 - x, 0), Math.max(x - 12, 0)), fz = Math.max(Math.max(-4.8 - z, 0), Math.max(z - 4.5, 0));
  h = lerp(3.0, h, sstep(0, 2.2, Math.hypot(fx, fz)));
  const gx = Math.max(Math.abs(x - GUEST.cx) - 6.5, 0), gz = Math.max(Math.abs(z - GUEST.cz) - 5.5, 0);
  h = lerp(PAD_Y, h, sstep(0, 3.5, Math.hypot(gx, gz)));
  // carport/driveway pad on the south bank
  const cx2 = Math.max(Math.abs(x + 8) - 6, 0), cz2 = Math.max(Math.abs(z - 16) - 3, 0);
  h = lerp(3.7, h, sstep(0, 3, Math.hypot(cx2, cz2)));
  // stream channel centred on z = 5, 4 m half-width
  const dist = Math.abs(z - 5) - 4;
  const bank = sstep(0, 4.4, dist);
  return lerp(bedAt(x), h, bank);
}

function terrainMesh() {
  const x0 = -60, x1 = 70, z0 = -52, z1 = 50, step = 1.25;
  const nx = Math.round((x1 - x0) / step), nz = Math.round((z1 - z0) / step);
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
  let k = 0;
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + i * step, z = z0 + j * step;
    pos[k++] = x; pos[k++] = terrainH(x, z); pos[k++] = z;
  }
  const idx = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------- geometry collector ----------
class Parts {
  constructor() { this.by = new Map(); }
  add(mat, geo) { if (!this.by.has(mat)) this.by.set(mat, []); if (geo.index) geo = geo.toNonIndexed(); geo.deleteAttribute('uv'); this.by.get(mat).push(geo); }
  box(mat, x0, x1, y0, y1, z0, z1) {
    const g = new BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.add(mat, g);
  }
  boxM(mat, w, h, d, m) { const g = new BoxGeometry(w, h, d); g.applyMatrix4(m); this.add(mat, g); }
  meshes(group, castShadow = true) {
    for (const [mat, geos] of this.by) {
      const m = new Mesh(mergeGeometries(geos), mat);
      m.castShadow = castShadow; m.receiveShadow = true;
      group.add(m);
    }
  }
}

export function buildWorld() {
  const root = new Group();
  const P = new Parts();
  const floors = [];     // {x0,x1,z0,z1,y}
  const ramps = [];      // {x0,x1,z0,z1,axis,a,b,y0,y1}
  const colliders = [];  // {x0,x1,z0,z1,y0,y1}
  const pools = [];
  const hatchParts = {};
  const proxies = new Group(); // invisible pick boxes, one per place
  root.add(proxies);
  const col = (x0, x1, y0, y1, z0, z1) => { const b = { x0, x1, z0, z1, y0, y1 }; colliders.push(b); return b; };

  const concrete = inkMaterial(ID.CONCRETE, 0.95, 'concrete');
  const stone = inkMaterial(ID.STONE, 0.78, 'stone');
  const rock = inkMaterial(ID.STONE, 0.9, 'rock');
  const steel = inkMaterial(ID.STEEL, 0.1);
  const glass = inkMaterial(ID.GLASS, 0.9);
  const ground = inkMaterial(ID.GROUND, 0.72, 'ground');
  const foliage = inkMaterial(ID.FOLIAGE, 0.62, 'foliage');
  const trunkMat = inkMaterial(ID.STEEL, 0.15);

  const slab = (x0, x1, z0, z1, top, mat = concrete) => { P.box(mat, x0, x1, top - SLAB, top, z0, z1); floors.push({ x0, x1, z0, z1, y: top }); };
  const solid = (mat, x0, x1, y0, y1, z0, z1, collide = true) => { P.box(mat, x0, x1, y0, y1, z0, z1); if (collide) col(x0, x1, y0, y1, z0, z1); };
  const parapet = (x0, x1, z0, z1, top) => solid(concrete, x0, x1, top, top + 0.95, z0, z1);
  const proxy = (id, x0, x1, y0, y1, z0, z1) => {
    const m = new Mesh(new BoxGeometry(x1 - x0, y1 - y0, z1 - z0), new MeshBasicMaterial({ side: DoubleSide }));
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    m.visible = false; m.userData.place = id; proxies.add(m);
  };
  // glass wall along x (z fixed) or z (x fixed), with optional door gap, steel mullions every ~1.5 m
  const glassWall = (axis, fixed, a0, a1, y0, y1, gap) => {
    const h = 0.08, segs = gap ? [[a0, gap[0]], [gap[1], a1]] : [[a0, a1]];
    for (const [s0, s1] of segs) {
      if (s1 - s0 < 0.1) continue;
      if (axis === 'x') { solid(glass, s0, s1, y0, y1, fixed - h, fixed + h); }
      else { solid(glass, fixed - h, fixed + h, y0, y1, s0, s1); }
      const n = Math.max(1, Math.round((s1 - s0) / 1.5));
      for (let i = 0; i <= n; i++) {
        const a = s0 + (s1 - s0) * i / n;
        if (axis === 'x') P.box(steel, a - .06, a + .06, y0, y1, fixed - .1, fixed + .1);
        else P.box(steel, fixed - .1, fixed + .1, y0, y1, a - .06, a + .06);
      }
    }
    if (axis === 'x') { P.box(steel, a0, a1, y1 - .1, y1, fixed - .1, fixed + .1); P.box(steel, a0, a1, y0, y0 + .06, fixed - .1, fixed + .1); }
    else { P.box(steel, fixed - .1, fixed + .1, y1 - .1, y1, a0, a1); P.box(steel, fixed - .1, fixed + .1, y0, y0 + .06, a0, a1); }
  };
  const stoneWall = (x0, x1, y0, y1, z0, z1) => solid(stone, x0, x1, y0, y1, z0, z1);

  // ---------- level 1 (living level) ----------
  slab(-5, 2, -5, 4, L1); slab(3.2, 10, -5, 4, L1); slab(2, 3.2, -5, 1.5, L1);
  slab(0, 2, 4, 11.5, L1); slab(3.2, 16, 4, 11.5, L1); slab(2, 3.2, 6, 11.5, L1);
  // walls
  stoneWall(-5, 10, L1, L2 - SLAB, -5, -4.5);
  stoneWall(-5, -4.5, L1, L2 - SLAB, -4.5, -3.4); stoneWall(-5, -4.5, L1, L2 - SLAB, -1.6, 4);
  glassWall('x', 4, -4.5, 10, L1, L2 - SLAB, [6.6, 8.2]);
  glassWall('z', 10, -4.5, 4, L1, L2 - SLAB);
  // stone core (chimney mass) and the fireplace
  solid(stone, -3, 1, 2.5, L3 + 5, -4.5, -1);
  solid(stone, -2.3, 0.3, L3 + 5, L3 + 6.4, -4.1, -1.4);
  P.box(steel, -2.3, -0.7, L1 + 0.2, L1 + 1.5, -1.04, -0.9);   // firebox
  // entry landing
  solid(stone, -7.6, -5, 2.6, 3.92, -4, -0.8, false);
  floors.push({ x0: -7.6, x1: -5, z0: -4, z1: -0.8, y: 3.92 });
  // roof/underside shade handled by slabs. Stone bulwark pieces under the terrace
  solid(stone, 9.5, 10.5, 1.2, L1 - SLAB, 0.5, 4, false);
  solid(stone, -0.5, 0.3, 1.5, L1 - SLAB, 3.5, 4.2, false);
  // parapets
  parapet(0, 16, 11.2, 11.5, L1); parapet(15.7, 16, 4, 11.2, L1); parapet(0, 0.3, 4, 11.2, L1);
  // furniture
  solid(steel, 3.4, 7.8, L1, L1 + 0.5, -4.5, -3.3);
  solid(steel, 4.6, 6.6, L1, L1 + 0.38, -2.8, -1.8);
  solid(steel, 8.4, 9.8, L1, L1 + 0.5, -4.5, -3.5);
  // hearth boulder
  const bo = new IcosahedronGeometry(1, 3);
  const bp = bo.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
    const n = 1 + 0.28 * (vnoise(x * 2.1 + 5, z * 2.1 + y) - .5) * 2 + 0.12 * (vnoise(x * 5, y * 5 + z * 5) - .5) * 2;
    bp.setXYZ(i, x * n * 1.75, Math.max(y, -.4) * n * 0.78, z * n * 1.15);
  }
  bo.computeVertexNormals();
  bo.translate(-1.3, L1 - 0.15, -0.05);
  P.add(rock, bo);
  col(-2.9, 0.3, L1, L1 + 0.6, -1.0, 1.0);

  // hatch: open slot in the floor, lid propped open, stair to the water
  {
    const y0 = L1, y1 = 0.42, za = 1.5, zb = 6.0, n = 17;
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const ytop = lerp(y0, y1, (i + 0.5) / n);
      P.box(concrete, 2.05, 3.15, ytop - 0.09, ytop, lerp(za, zb, t0), lerp(za, zb, t1) + 0.02);
    }
    P.box(steel, 2.0, 2.08, y0 - 0.3, y0 + 0.9, za, za + 0.06);
    const hatchRamp = { x0: 2.0, x1: 3.2, z0: za, z1: zb, axis: 'z', a: za, b: zb, y0, y1 };
    ramps.push(hatchRamp);
    hatchParts.ramp = hatchRamp;
    solid(rock, 0.8, 4.6, -0.6, 0.42, 6.0, 8.2, false);
    floors.push({ x0: 0.8, x1: 4.6, z0: 6.0, z1: 8.2, y: 0.42 });
    // side rails of the slot (collision): walls so the player stays on the stair
    hatchParts.rails = [col(1.7, 2.0, 0, 6, za, 6.0), col(3.2, 3.5, 0, 6, za, 6.0)];
  }

  // ---------- level 2 ----------
  slab(-4, 10, -5, 3, L2); slab(4, 15.8, 3, 8, L2);
  stoneWall(-4, 10, L2, L3 - SLAB, -5, -4.5); stoneWall(-4, -3.5, L2, L3 - SLAB, -4.5, 3);
  glassWall('x', 3, -3.5, 4, L2, L3 - SLAB); glassWall('x', 3, 4, 10, L2, L3 - SLAB, [8, 9.6]);
  glassWall('z', 10, -4.5, 3, L2, L3 - SLAB);
  parapet(4, 15.8, 7.7, 8, L2); parapet(15.5, 15.8, 3.3, 7.7, L2); parapet(4, 4.3, 3.3, 7.7, L2);
  parapet(10, 15.5, 3, 3.3, L2);
  // ---------- level 3 ----------
  slab(-3, 7, -4.5, 2.5, L3); slab(0, 9.8, 2.5, 7.2, L3);
  stoneWall(-3, 7, L3, 13.7, -4.5, -4); stoneWall(-3, -2.5, L3, 13.7, -4, 2.5);
  glassWall('x', 2.5, -2.5, 4, L3, 13.7); glassWall('x', 2.5, 4, 7, L3, 13.7, [4.2, 5.8]);
  glassWall('z', 7, -4, 2.5, L3, 13.7);
  parapet(0, 9.8, 6.9, 7.2, L3); parapet(0, 0.3, 2.8, 6.9, L3); parapet(9.5, 9.8, 2.8, 5.6, L3);
  parapet(7.3, 9.5, 2.5, 2.8, L3);
  P.box(concrete, -3.8, 8, 13.7, 14.2, -5.2, 3.3); // roof slab
  col(-3.8, 8, 13.7, 14.2, -5.2, 3.3);

  // exterior stair A (L1 terrace -> L2 terrace) and B (L2 terrace -> L3 terrace)
  const stairSolid = (mat, axis, c0, c1, a0, a1, ya, yb, base, n) => {
    for (let i = 0; i < n; i++) {
      const s0 = lerp(a0, a1, i / n), s1 = lerp(a0, a1, (i + 1) / n), ytop = lerp(ya, yb, (i + 1) / n);
      if (axis === 'z') P.box(mat, c0, c1, base, ytop, Math.min(s0, s1), Math.max(s0, s1));
      else P.box(mat, Math.min(s0, s1), Math.max(s0, s1), base, ytop, c0, c1);
    }
  };
  stairSolid(concrete, 'z', 14.6, 15.4, 10.8, 4.6, L1, L2, L1, 20);
  ramps.push({ x0: 14.6, x1: 15.4, z0: 4.6, z1: 10.8, axis: 'z', a: 10.8, b: 4.6, y0: L1, y1: L2 });
  stairSolid(concrete, 'x', 5.85, 6.95, 14.8, 9.8, L2, L3, L2, 20);
  ramps.push({ x0: 9.8, x1: 14.8, z0: 5.85, z1: 6.95, axis: 'x', a: 14.8, b: 9.8, y0: L2, y1: L3 });

  // ---------- terrace pick volumes ----------
  proxy('apps', 0, 16, L1 - 0.6, L1 + 1.2, 4, 11.5);
  proxy('engines', 4, 15.8, L2 - 0.6, L2 + 1.2, 3, 8);
  proxy('training', 0, 9.8, L3 - 0.6, L3 + 1.2, 2.5, 7.2);
  proxy('hearth', -3, 0.4, L1, L1 + 1.6, -1.2, 1.1);
  proxy('stream', 0.8, 4.6, -0.3, 1.5, 6, 8.2);
  proxy('stream', 1.9, 3.3, 0.4, L1, 1.4, 6);

  // ---------- bridge, carport, entry path ----------
  {
    const bx0 = -10.2, bx1 = -7.8, y = 3.9;
    P.box(concrete, bx0, bx1, y - 0.6, y, -3, 14);
    floors.push({ x0: bx0, x1: bx1, z0: -3, z1: 14, y });
    P.box(concrete, bx0 - .25, bx0 + .05, y - 0.6, y + 0.15, -3, 14); // thickened beams
    parapet(bx0, bx0 + 0.3, -1.5, 13, y); parapet(bx1 - 0.3, bx1, -1.5, 13, y);
    for (const z of [3, 7, 11]) P.box(concrete, bx0 - .4, bx1 + .4, -1.6, y - 0.6, z - .3, z + .3); // piers into the stream... shallow
    proxy('bridge', bx0 - .4, bx1 + .4, y - 0.8, y + 1.4, -3, 14);
    // carport on the south bank
    const cy = 3.7;
    P.box(concrete, -12.5, -4.8, cy + 2.7, cy + 3.15, 14.5, 19.5);
    for (const [x, z] of [[-12.2, 14.8], [-5.1, 14.8], [-12.2, 19.2], [-5.1, 19.2]]) solid(stone, x - .25, x + .25, cy - 0.5, cy + 2.7, z - .25, z + .25);
    solid(stone, -12.5, -12, cy - 0.5, cy + 2.7, 14.5, 19.5, false);
    P.box(steel, -11.5, -7, cy + 0.9, cy + 1.2, 16.2, 17.8); // bench/workbench
    col(-11.5, -7, cy, cy + 1.2, 16.2, 17.8);
    proxy('carport', -12.5, -4.8, cy, cy + 3.2, 14.5, 19.5);
  }
  // covered walkway uphill to the guest house
  {
    const a = new Vector3(-7.2, 0, -5.8), b = new Vector3(GUEST.cx + 0.5, 0, GUEST.cz + 4.2);
    const dir = new Vector3().subVectors(b, a); dir.normalize();
    const nseg = 5;
    for (let i = 0; i < nseg; i++) {
      const t0 = i / nseg, t1 = (i + 1) / nseg;
      const p0 = new Vector3().lerpVectors(a, b, t0), p1 = new Vector3().lerpVectors(a, b, t1);
      p0.y = terrainH(p0.x, p0.z) + 2.7; p1.y = terrainH(p1.x, p1.z) + 2.7;
      const mid = new Vector3().addVectors(p0, p1).multiplyScalar(0.5);
      const d = new Vector3().subVectors(p1, p0);
      const m = new Matrix4().compose(mid, new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), d.clone().normalize()), new Vector3(1, 1, 1));
      P.boxM(concrete, 2.3, 0.22, d.length() + 0.1, m);
      const th = terrainH(p1.x, p1.z);
      for (const sgn of [-1, 1]) {
        const ox = -dir.z * sgn * 1.0, oz = dir.x * sgn * 1.0;
        P.box(stone, p1.x + ox - .15, p1.x + ox + .15, th - 0.2, th + 2.6, p1.z + oz - .15, p1.z + oz + .15);
      }
    }
    proxy('guest', GUEST.cx - 6.5, GUEST.cx + 6.5, PAD_Y - 0.5, PAD_Y + 4, GUEST.cz - 3, GUEST.cz + 6);
  }
  // guest house
  {
    const gy = PAD_Y + 0.15, gx0 = GUEST.cx - 4.5, gx1 = GUEST.cx + 4.5, gz0 = GUEST.cz - 2.2, gz1 = GUEST.cz + 2.2;
    slab(gx0 - 0.5, gx1 + 0.5, gz0 - .5, gz1 + 3.2, gy);
    stoneWall(gx0, gx1, gy, gy + 2.7, gz0, gz0 + 0.5);
    stoneWall(gx0, gx0 + 0.5, gy, gy + 2.7, gz0 + .5, gz1);
    stoneWall(gx1 - 0.5, gx1, gy, gy + 2.7, gz0 + .5, gz1);
    glassWall('x', gz1, gx0 + .5, gx1 - .5, gy, gy + 2.7, [GUEST.cx - .6, GUEST.cx + .6]);
    P.box(concrete, gx0 - 0.8, gx1 + 0.8, gy + 2.7, gy + 3.2, gz0 - 0.8, gz1 + 3.4);  // cantilevered roof
    for (const x of [gx0 + 1, GUEST.cx, gx1 - 1]) solid(steel, x - .1, x + .1, gy, gy + 2.7, gz1 + 3.2, gz1 + 3.4);
    col(gx0 - 0.8, gx1 + 0.8, gy + 2.7, gy + 3.2, gz0 - 0.8, gz1 + 3.4);
    // spring-fed pool beyond the roof
    const px0 = gx0 + 0.5, px1 = gx0 + 7, pz0 = gz1 + 4.6, pz1 = gz1 + 7;
    P.box(stone, px0 - .3, px1 + .3, gy - 0.1, gy + 0.3, pz0 - .3, pz0); P.box(stone, px0 - .3, px1 + .3, gy - 0.1, gy + 0.3, pz1, pz1 + .3);
    P.box(stone, px0 - .3, px0, gy - 0.1, gy + 0.3, pz0, pz1); P.box(stone, px1, px1 + .3, gy - 0.1, gy + 0.3, pz0, pz1);
    col(px0 - .3, px1 + .3, gy, gy + 0.3, pz0 - .3, pz1 + .3);
    pools.push({ x: (px0 + px1) / 2, y: gy + 0.1, z: (pz0 + pz1) / 2, w: px1 - px0, d: pz1 - pz0 });
  }

  // ---------- rocks, trees ----------
  const rocksGeo = new IcosahedronGeometry(1, 1);
  const rockList = [];
  for (let i = 0; i < 70; i++) {
    const side = rnd() < .5 ? 1 : 9, x = -42 + rnd() * 90, z = side + (rnd() - .5) * 2.5;
    const y = terrainH(x, z);
    if (Math.abs(x - (-9)) < 3.5) continue; // keep the bridge clear
    rockList.push({ x, y: Math.max(y, -0.35) + 0.15, z, s: 0.3 + rnd() * 0.7 });
  }
  for (let i = 0; i < 5; i++) rockList.push({ x: 7.5 + rnd() * 4, y: bedAt(9) + 0.6, z: 2 + rnd() * 6, s: .6 + rnd() * .6 });
  const rocks = new InstancedMesh(rocksGeo, rock, rockList.length);
  const tmp = new Matrix4(), q = new Quaternion(), sc = new Vector3(), ps = new Vector3();
  rockList.forEach((r, i) => {
    q.setFromEuler(new Euler(rnd() * 3, rnd() * 3, rnd() * 3));
    sc.set(r.s * 1.3, r.s * 0.8, r.s * 1.1); ps.set(r.x, r.y, r.z);
    rocks.setMatrixAt(i, tmp.compose(ps, q, sc));
  });
  rocks.castShadow = rocks.receiveShadow = true; root.add(rocks);

  const treePos = [];
  for (let i = 0; i < 900 && treePos.length < 320; i++) {
    const x = -58 + rnd() * 126, z = -50 + rnd() * 98;
    const h = terrainH(x, z);
    if (h < 2.8) continue;
    if (x > -9 && x < 17.5 && z > -8 && z < 13.5) continue;           // house
    if (x > 8 && x < 40 && z > 8 && z < 34) continue;                  // postcard view from downstream
    if (Math.abs(x - GUEST.cx) < 9 && z < -14 && z > -27) continue;    // guest pad
    if (x > -15 && x < -3 && z > 13 && z < 21) continue;               // carport
    if (Math.abs(x + 9) < 3 && z > -5 && z < 14) continue;             // bridge road
    if (x > -11 && x < -4 && z < -4 && z > GUEST.cz + 3) continue;     // walkway
    treePos.push({ x, y: h, z, s: 1.5 + rnd() * 1.6 });
  }
  const crownGeo = new IcosahedronGeometry(1, 1), trunkGeo = new CylinderGeometry(0.12, 0.2, 1, 5);
  trunkGeo.translate(0, 0.5, 0);
  const crowns = new InstancedMesh(crownGeo, foliage, treePos.length);
  const trunks = new InstancedMesh(trunkGeo, trunkMat, treePos.length);
  treePos.forEach((t, i) => {
    const th = t.s * 1.1;
    ps.set(t.x, t.y - 0.2, t.z); q.identity(); sc.set(1, th, 1); trunks.setMatrixAt(i, tmp.compose(ps, q, sc));
    ps.set(t.x, t.y + th + t.s * 0.55, t.z); q.setFromEuler(new Euler(0, rnd() * 6, 0)); sc.set(t.s * 0.8, t.s * 1.05, t.s * 0.8);
    crowns.setMatrixAt(i, tmp.compose(ps, q, sc));
  });
  crowns.castShadow = trunks.castShadow = true; crowns.receiveShadow = true;
  root.add(crowns, trunks);

  // ---------- terrain mesh ----------
  const ter = new Mesh(terrainMesh(), ground);
  ter.receiveShadow = true; ter.castShadow = false;
  root.add(ter);

  // ---------- terrace furniture ----------
  const planter = (x, z, top) => {
    solid(concrete, x - .6, x + .6, top, top + .5, z - .3, z + .3);
    P.add(foliage, new IcosahedronGeometry(.55, 1).translate(x, top + .85, z));
  };
  const table = (x, z, top) => {
    solid(steel, x - .7, x + .7, top, top + .78, z - .45, z + .45);
    for (const dx of [-1.1, 1.1]) solid(steel, x + dx - .22, x + dx + .22, top, top + .45, z - .22, z + .22);
  };
  [5, 8, 11, 14].forEach((x) => planter(x, 10.6, L1));
  table(9.2, 7.4, L1);
  [6, 8.5].forEach((x) => planter(x, 7.2, L2));
  table(12.5, 4.6, L2);
  [1.4, 3.2].forEach((x) => planter(x, 6.4, L3));
  table(5.6, 4.6, L3);

  P.meshes(root);

  // ---------- water ----------
  const W = waterMaterials();
  const up = new Mesh(new PlaneGeometry(110, 14).rotateX(-Math.PI / 2), W.still);
  
  // upstream: x from -60 to FALL_X (centre = (-60+6)/2), width 66
  up.geometry.dispose(); up.geometry = new PlaneGeometry(FALL_X + 60, 14).rotateX(-Math.PI / 2); up.position.set((FALL_X - 60) / 2, WATER_UP, 5);
  const downPool = new Mesh(new PlaneGeometry(64, 14).rotateX(-Math.PI / 2), W.pool);
  downPool.position.set(FALL_X + 0.5 + 32, WATER_DOWN, 5);
  const fall = new Mesh(new PlaneGeometry(7.4, 3.9, 1, 1), W.fall);
  // vertical sheet, leaning slightly downstream
  fall.geometry.rotateY(Math.PI / 2);
  fall.position.set(FALL_X + 0.15, (WATER_UP + WATER_DOWN) / 2 - 0.1, 5);
  fall.rotation.z = -0.08;
  root.add(up, downPool, fall);
  for (const p of pools) { const m = new Mesh(new PlaneGeometry(p.w, p.d).rotateX(-Math.PI / 2), W.still); m.position.set(p.x, p.y, p.z); root.add(m); }

  // spray at the foot of the fall
  const N = 420, pos = new Float32Array(N * 3), seeds = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    pos.set([FALL_X + 0.5 + rnd() * 0.5, WATER_DOWN + 0.05, 1.8 + rnd() * 6.4], i * 3);
    seeds.set([rnd(), rnd(), rnd(), 0.8 + rnd()], i * 4);
  }
  const sg = new BufferGeometry();
  sg.setAttribute('position', new BufferAttribute(pos, 3)); sg.setAttribute('aSeed', new BufferAttribute(seeds, 4));
  const spray = new Points(sg, W.spray); spray.frustumCulled = false;
  root.add(spray);

  // ---------- openable hatch: a concrete cover slides over the floor ----------
  const cover = new Mesh(new BoxGeometry(1.2, 0.09, 4.5), concrete);
  cover.position.set(3.8, L1 + 0.045, 3.75); cover.castShadow = cover.receiveShadow = true;
  root.add(cover);
  const hatchFloor = { x0: 2, x1: 3.2, z0: 1.5, z1: 6, y: -99 };
  floors.push(hatchFloor);
  const hatch = {
    open: true, t: 1,
    // closing is refused while the player is below the house, who could not get back up
    toggle(playerY) {
      if (this.open) { if (playerY < 3) return false; this.open = false; } else this.open = true;
      hatchFloor.y = this.open ? -99 : L1;
      hatchParts.ramp.off = !this.open;
      hatchParts.rails.forEach((r) => { r.off = !this.open; });
      return true;
    },
    update(dt) {
      const goal = this.open ? 1 : 0;
      this.t += Math.sign(goal - this.t) * Math.min(Math.abs(goal - this.t), dt / 0.7);
      const e = this.t * this.t * (3 - 2 * this.t);
      cover.position.x = lerp(2.6, 3.8, e);
    },
  };

  // ---------- lights ----------
  const sun = new DirectionalLight(0xffffff, 3.1);
  sun.position.set(34, 38, 26); sun.target.position.set(4, 4, 2);
  sun.castShadow = true;
  sun.shadow.camera.left = -34; sun.shadow.camera.right = 34; sun.shadow.camera.top = 34; sun.shadow.camera.bottom = -34;
  sun.shadow.camera.near = 5; sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
  const hemi = new HemisphereLight(0xffffff, 0xe0d8c4, 2.9);
  root.add(sun, sun.target, hemi);

  return {
    root, floors, ramps, colliders, proxies, sun, water: W, rocks, hatch, crowns, trunks,
    placeView: {
      hearth:   { at: [4.6, 0.3], y: 4, look: [-1.3, 4.9, -0.5], plan: [-1.3, -1.2], anchor: [-1.3, 6.3, -0.05] },
      apps:     { at: [6.5, 9.6], y: 4, look: [19, 3.8, 21], plan: [11, 9.6], anchor: [11.5, 5.3, 8.0] },
      engines:  { at: [12.5, 4.6], y: 7.4, look: [26, 6.0, 14], plan: [12.5, 5.2], anchor: [10.5, 8.7, 5.5] },
      training: { at: [6.5, 5.2], y: 10.8, look: [22, 8.5, 15], plan: [4.5, 4.6], anchor: [4.5, 12.1, 4.8] },
      stream:   { at: [4.2, 7.4], y: 0.42, look: [9, -1.5, 4.2], plan: [2.8, 7.4], anchor: [2.8, 1.5, 7.1] },
      guest:    { at: [2.5, -19.0], y: -1, look: [GUEST.cx, PAD_Y + 1.5, GUEST.cz], plan: [GUEST.cx, GUEST.cz], anchor: [GUEST.cx, PAD_Y + 4.0, GUEST.cz + 1] },
      bridge:   { at: [-9, 11.6], y: 3.9, look: [-4, 4.5, 3], plan: [-9, 4.5], anchor: [-9, 5.2, 4.5] },
      carport:  { at: [-3.2, 12.2], y: 3.7, look: [-8.5, 5.0, 17], plan: [-8.5, 17], anchor: [-8.5, 7.1, 17] },
    },
    start: { at: [22, 18.5], y: -1, look: [6, 6.5, 4] },
  };
}

// ---------- walking ----------
export function createWalker(world) {
  const { floors, ramps, colliders } = world;
  const R = 0.35;
  function candidates(x, z) {
    const out = [];
    const h = terrainH(x, z);
    if (h > 1.6) out.push(h);
    for (const f of floors) if (x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1) out.push(f.y);
    for (const r of ramps) if (!r.off && x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) {
      const c = r.axis === 'z' ? z : x;
      out.push(lerp(r.y0, r.y1, (c - r.a) / (r.b - r.a)));
    }
    return out;
  }
  function floorAt(x, z, cur) {
    let best = null;
    for (const c of candidates(x, z)) {
      if (c <= cur + 0.7 && c >= cur - 1.5 && (best === null || c > best)) best = c;
    }
    return best;
  }
  function blocked(x, z, fy) {
    for (const b of colliders) {
      if (b.off || !(b.y0 < fy + 1.7 && b.y1 > fy + 0.5)) continue;
      const dx = Math.max(b.x0 - x, 0, x - b.x1), dz = Math.max(b.z0 - z, 0, z - b.z1);
      if (dx * dx + dz * dz < R * R) return true;
    }
    return false;
  }
  // returns new {x,z,y} after trying to move; axes are tried separately so the player slides
  function move(x, z, fy, dx, dz) {
    let nx = x, nz = z, ny = fy;
    let f = floorAt(nx + dx, nz, ny);
    if (f !== null && !blocked(nx + dx, nz, f)) { nx += dx; ny = f; }
    f = floorAt(nx, nz + dz, ny);
    if (f !== null && !blocked(nx, nz + dz, f)) { nz += dz; ny = f; }
    return { x: nx, z: nz, y: ny };
  }
  return { floorAt, move, candidates };
}
