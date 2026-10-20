/* eslint-disable complexity, max-lines-per-function */
// Walkable house (after Fallingwater) — optional home view for the portfolio site.
// Entry: start({ container, data, initialPlace, onExit }) -> controller.
import {
  WebGLRenderer, Scene, PerspectiveCamera, Raycaster, Vector2, Vector3, PCFShadowMap,
} from 'three';
import { buildWorld, createWalker, terrainH } from './world.js';
import { InkPass } from './ink.js';

const EYE = 1.65;
const CSS = `
.hw-root{position:fixed;inset:0;background:#F7F2E7;color:#2C2A24;z-index:1000;font:14px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;touch-action:none;user-select:none;-webkit-user-select:none}
.hw-root canvas{position:absolute;inset:0;width:100%;height:100%;display:block;outline:none}
.hw-bar{position:absolute;top:0;left:0;right:0;display:flex;gap:6px;align-items:center;padding:8px 10px;background:#F7F2E7;border-bottom:1px solid rgba(60,45,15,.35);z-index:3}
.hw-bar button,.hw-bar a{font:inherit;color:#2C2A24;background:none;border:1px solid rgba(60,45,15,.35);padding:3px 9px;border-radius:2px;cursor:pointer;white-space:nowrap;text-decoration:none}
.hw-bar button:hover,.hw-bar a:hover{background:#2C2A24;color:#F7F2E7}
.hw-bar button:focus-visible,.hw-win button:focus-visible,.hw-pin:focus-visible{outline:2px solid #7A5C2E;outline-offset:2px}
.hw-chips{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;flex:1}
.hw-chips::-webkit-scrollbar{display:none}
.hw-chips button.on{border-color:#7A5C2E;color:#7A5C2E}
.hw-chips button.on:hover{color:#F7F2E7;background:#7A5C2E}
.hw-pin{position:absolute;left:0;top:0;z-index:2;display:flex;align-items:center;gap:6px;padding:0;border:0;background:none;color:#7A5C2E;font:600 12px/1 -apple-system,Helvetica,Arial,sans-serif;cursor:pointer;will-change:transform;pointer-events:auto}
.hw-pin b{display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:#F7F2E7;border:1.5px solid #7A5C2E;font-weight:700}
.hw-pin span{background:#F7F2E7;border:1px solid rgba(60,45,15,.35);padding:2px 6px;border-radius:2px;color:#2C2A24;white-space:nowrap}
.hw-pin:hover b,.hw-pin.hot b{background:#7A5C2E;color:#F7F2E7}
.hw-hint{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);background:#F7F2E7;border:1px solid rgba(60,45,15,.35);padding:5px 10px;border-radius:2px;color:#6B665A;z-index:2;transition:opacity .4s;max-width:92vw;text-align:center}
.hw-win{position:absolute;top:56px;right:14px;bottom:14px;width:min(430px,calc(100vw - 28px));background:#FFFDF7;border:1.5px solid #2C2A24;display:flex;flex-direction:column;z-index:4;user-select:text;-webkit-user-select:text}
.hw-title{display:flex;align-items:center;gap:8px;padding:5px 8px;border-bottom:1.5px solid #2C2A24;background:repeating-linear-gradient(0deg,#F7F2E7 0 2px,#2C2A24 2px 3px) ;color:#2C2A24}
.hw-title h2{margin:0;font:600 13px/1.2 -apple-system,Helvetica,Arial,sans-serif;background:#FFFDF7;padding:2px 8px;flex:0 1 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hw-title .sp{flex:1}
.hw-title button{font:600 13px/1 -apple-system,Helvetica,Arial,sans-serif;background:#FFFDF7;border:1.5px solid #2C2A24;width:24px;height:24px;cursor:pointer;color:#2C2A24;padding:0}
.hw-title button:hover{background:#2C2A24;color:#F7F2E7}
.hw-body{overflow:auto;padding:12px 14px;flex:1;-webkit-overflow-scrolling:touch}
.hw-body p.blurb{margin:0 0 10px;color:#6B665A}
.hw-item{padding:9px 0;border-top:1px solid rgba(60,45,15,.14)}
.hw-item h3{margin:0 0 2px;font-size:15px;font-weight:600;line-height:1.3}
.hw-item h3 a{color:#7A5C2E;text-decoration:none}.hw-item h3 a:hover{text-decoration:underline}
.hw-item p{margin:0 0 4px;color:#6B665A;font-size:13px}
.hw-item .tg{font-size:11px;color:#938D7E}
.hw-item .ac{display:flex;gap:10px;font-size:12px}
.hw-item .ac a{color:#2C2A24}
.hw-body a{color:#7A5C2E}
.hw-joy{position:absolute;left:18px;bottom:22px;width:110px;height:110px;border-radius:50%;border:1.5px solid rgba(60,45,15,.35);background:rgba(247,242,231,.5);z-index:2;display:none}
.hw-joy i{position:absolute;left:50%;top:50%;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:#2C2A24;opacity:.7}
@media (pointer:coarse){.hw-joy{display:block}.hw-hint.d{display:none}}
.hw-fb{position:absolute;inset:0;display:grid;place-items:center;text-align:center;padding:20px;z-index:5;background:#F7F2E7}
.hw-perf{position:absolute;left:8px;bottom:8px;font:11px/1.3 ui-monospace,Menlo,monospace;color:#6B665A;z-index:3;white-space:pre}
@media (max-width:640px){.hw-win{top:auto;left:8px;right:8px;width:auto;height:62vh;bottom:8px}.hw-pin span{display:none}.hw-bar .lbl{display:none}}
@media (prefers-reduced-motion:reduce){.hw-hint{transition:none}}
`;

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;

function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

export async function start({ container, data, initialPlace, onExit, perf }) {
  const T0 = performance.now();
  const metrics = { importMs: 0, buildMs: 0, firstFrameMs: 0, fps: 0, quality: 1, frames: 0 };
  window.__house = metrics;

  if (!document.getElementById('hw-css')) { const s = el('style'); s.id = 'hw-css'; s.textContent = CSS; document.head.appendChild(s); }
  const root = el('div', 'hw-root'); root.hidden = true;
  container.appendChild(root);

  let renderer;
  try {
    renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance', alpha: false });
    if (!renderer.getContext()) throw new Error('no context');
  } catch {
    root.hidden = false;
    root.innerHTML = '<div class="hw-fb"><div><p><b>The house needs WebGL.</b></p><p>Your browser or device has it turned off. The flat page has everything the house does.</p><p><button class="hw-x" style="font:inherit;padding:4px 10px;cursor:pointer">Back to the flat page</button></p></div></div>';
    root.querySelector('.hw-x').onclick = () => { if (onExit) onExit(); };
    return { show() { root.hidden = false; }, hide() { root.hidden = true; }, failed: true };
  }

  // ---------- scene ----------
  const world = buildWorld();
  const scene = new Scene();
  scene.add(world.root);
  const camera = new PerspectiveCamera(70, 1, 0.1, 400);
  camera.rotation.order = 'YXZ';
  const walker = createWalker(world);
  const ink = new InkPass(0.1, 400);

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  world.sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
  renderer.setClearColor(0xffffff, 1);
  const canvas = renderer.domElement;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'A walkable 3D house with terraces over a waterfall. The same places are listed in the bar above.');
  root.appendChild(canvas);

  // ---------- state ----------
  const places = data.places;
  const P = { x: 0, z: 0, fy: 0, yaw: 0, pitch: 0, camY: 0 };
  const keys = new Set();
  let joy = { x: 0, y: 0 };
  let glideS = null, active = false, raf = 0, quality = coarse ? 0.8 : 1, hot = null, openId = null;

  function setView(vp) {
    const [x, z] = vp.at;
    let fy = vp.y;
    if (fy < 0) fy = terrainH(x, z);
    P.x = x; P.z = z; P.fy = fy;
    const f = walker.floorAt(x, z, fy + 0.3);
    if (f !== null) P.fy = f;
    P.camY = P.fy + EYE;
    lookAt(vp.look);
  }
  function lookAt(t) {
    const dx = t[0] - P.x, dy = t[1] - P.camY, dz = t[2] - P.z;
    P.yaw = Math.atan2(-dx, -dz);
    P.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }
  function applyCam() {
    camera.position.set(P.x, P.camY, P.z);
    camera.rotation.set(P.pitch, P.yaw, 0);
  }

  // ---------- sizing ----------
  function resize() {
    const w = container.clientWidth || innerWidth, h = container.clientHeight || innerHeight;
    const pr = Math.max(0.5, Math.min(devicePixelRatio || 1, coarse ? 1.5 : 2) * quality);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    const db = renderer.getDrawingBufferSize(new Vector2());
    ink.resize(db.x, db.y, Math.max(1, Math.round(pr)));
    camera.aspect = w / h;
    camera.fov = camera.aspect < 0.8 ? 82 : 68;
    camera.updateProjectionMatrix();
    world.water.spray.uniforms.uScale.value = db.y / (2 * Math.tan(camera.fov * Math.PI / 360));
  }

  // ---------- UI ----------
  const bar = el('div', 'hw-bar');
  const back = el('button', '', '<span aria-hidden="true">←</span> <span class="lbl">Flat page</span>');
  back.title = 'Back to the flat page (Esc)'; back.onclick = () => exit();
  const chips = el('div', 'hw-chips');
  places.forEach((p, i) => {
    const b = el('button', '', `${i + 1} ${p.short}`); b.dataset.place = p.id; b.onclick = () => goPlace(p.id);
    chips.appendChild(b);
  });
  bar.append(back, chips);
  root.appendChild(bar);

  const pins = {};
  places.forEach((p, i) => {
    const b = el('button', 'hw-pin', `<b>${i + 1}</b><span>${p.short}</span>`);
    b.setAttribute('aria-label', p.title); b.onclick = () => goPlace(p.id);
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    root.appendChild(b); pins[p.id] = b;
  });
  const hint = el('div', 'hw-hint d', coarse ? 'Drag to look · left stick to walk · tap a marker' : 'Drag to look · W A S D or arrows to walk · click a marker or part of the house');
  root.appendChild(hint);
  const joyEl = el('div', 'hw-joy', '<i></i>'); root.appendChild(joyEl);
  let perfEl = null;
  if (perf) { perfEl = el('div', 'hw-perf'); root.appendChild(perfEl); }
  let win = null;

  function closeWin() {
    if (win) { win.remove(); win = null; }
    openId = null;
    chips.querySelectorAll('button').forEach((b) => b.classList.remove('on'));
    if (location.hash.startsWith('#house/')) history.replaceState(null, '', '#house');
  }
  function openWin(id) {
    closeWin();
    const pl = places.find((p) => p.id === id); if (!pl) return;
    openId = id;
    win = el('div', 'hw-win'); win.setAttribute('role', 'dialog'); win.setAttribute('aria-label', pl.title);
    const t = el('div', 'hw-title'); t.append(el('h2', '', pl.title), el('span', 'sp'));
    const x = el('button', '', '×'); x.setAttribute('aria-label', 'Close'); x.onclick = closeWin; t.appendChild(x);
    const body = el('div', 'hw-body');
    body.appendChild(el('p', 'blurb', pl.blurb));
    if (pl.about) body.appendChild(el('div', '', data.aboutHtml));
    else for (const p of data.projectsIn(id)) body.appendChild(projectItem(p, data));
    win.append(t, body);
    win.addEventListener('pointerdown', (e) => e.stopPropagation());
    root.appendChild(win);
    chips.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.place === id));
    history.replaceState(null, '', '#house/' + id);
    x.focus({ preventScroll: true });
  }
  function projectItem(p, d) {
    const it = el('div', 'hw-item');
    const href = d.repoUrl(p) || p.homepage;
    const h = el('h3'); h.innerHTML = href ? `<a href="${href}">${p.name}</a>` : p.name;
    const tags = (p.tags || []).join(' · ') + (p.private ? ' · private' : '');
    it.append(h, el('p', '', p.description || ''), el('div', 'tg', tags));
    const ac = el('div', 'ac');
    if (p.homepage) ac.appendChild(el('a', '', `<a href="${p.homepage}">Try</a>`).firstChild);
    const r = d.repoUrl(p); if (r) ac.appendChild(el('a', '', `<a href="${r}">Repo</a>`).firstChild);
    if (ac.childNodes.length) it.appendChild(ac);
    return it;
  }

  // ---------- glide ----------
  function glideTo(vp, done) {
    const [x, z] = vp.at;
    let fy = vp.y < 0 ? terrainH(x, z) : vp.y;
    const f = walker.floorAt(x, z, fy + 0.3); if (f !== null) fy = f;
    const from = { x: P.x, y: P.camY, z: P.z, yaw: P.yaw, pitch: P.pitch };
    const save = { ...P };
    P.x = x; P.z = z; P.camY = fy + EYE; lookAt(vp.look);
    const to = { x, y: fy + EYE, z, yaw: P.yaw, pitch: P.pitch, fy };
    Object.assign(P, save);
    let dyaw = to.yaw - from.yaw; dyaw -= Math.round(dyaw / (2 * Math.PI)) * 2 * Math.PI;
    const dist = Math.hypot(to.x - from.x, to.z - from.z, to.y - from.y);
    glideS = { t: 0, dur: reduced ? 0.01 : Math.min(2.4, Math.max(0.9, dist / 16)), from, to, dyaw, lift: Math.min(dist * 0.1, 5), done };
  }
  function stepGlide(dt) {
    const g = glideS; g.t = Math.min(1, g.t + dt / g.dur);
    const e = g.t * g.t * (3 - 2 * g.t);
    P.x = g.from.x + (g.to.x - g.from.x) * e; P.z = g.from.z + (g.to.z - g.from.z) * e;
    P.camY = g.from.y + (g.to.y - g.from.y) * e + Math.sin(Math.PI * e) * g.lift;
    P.yaw = g.from.yaw + g.dyaw * e; P.pitch = g.from.pitch + (g.to.pitch - g.from.pitch) * e;
    if (g.t >= 1) { P.fy = g.to.fy; P.camY = g.to.y; const d = g.done; glideS = null; if (d) d(); }
  }
  function goPlace(id) {
    const vp = world.placeView[id]; if (!vp) return;
    closeWin();
    glideTo(vp, () => openWin(id));
    hint.style.opacity = 0;
  }

  // ---------- input ----------
  const ray = new Raycaster(); ray.far = 200;
  function pick(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera);
    const targets = [...world.proxies.children, ...world.root.children.filter((o) => o.isMesh && o.visible && !o.isInstancedMesh)];
    const hit = ray.intersectObjects(targets, false)[0];
    return hit && hit.object.userData.place ? hit.object.userData.place : null;
  }
  let look = null, joyId = null;
  const joyC = () => { const r = joyEl.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  canvas.addEventListener('pointerdown', (e) => {
    if (glideS) return;
    canvas.setPointerCapture(e.pointerId);
    const inJoy = coarse && e.clientX < 160 && e.clientY > innerHeight - 170;
    if (inJoy) { joyId = e.pointerId; return; }
    look = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() };
    hint.style.opacity = 0;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId === joyId) {
      const [cx, cy] = joyC(); let dx = (e.clientX - cx) / 45, dy = (e.clientY - cy) / 45; const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
      joy = { x: dx, y: dy }; joyEl.firstChild.style.transform = `translate(${dx * 38}px,${dy * 38}px)`; return;
    }
    if (look && e.pointerId === look.id) {
      P.yaw -= (e.clientX - look.x) * 0.005; P.pitch = Math.max(-1.3, Math.min(1.3, P.pitch - (e.clientY - look.y) * 0.005));
      look.x = e.clientX; look.y = e.clientY;
    } else if (e.pointerType === 'mouse' && !glideS) {
      const now = performance.now(); if (now - (pick.last || 0) < 90) return; pick.last = now;
      const h = pick(e.clientX, e.clientY); canvas.style.cursor = h ? 'pointer' : 'grab'; setHot(h);
    }
  });
  const end = (e) => {
    if (e.pointerId === joyId) { joyId = null; joy = { x: 0, y: 0 }; joyEl.firstChild.style.transform = ''; return; }
    if (look && e.pointerId === look.id) {
      const moved = Math.hypot(e.clientX - look.sx, e.clientY - look.sy), dt = performance.now() - look.t;
      if (moved < 7 && dt < 400 && e.type === 'pointerup') { const h = pick(e.clientX, e.clientY); if (h) goPlace(h); }
      look = null;
    }
  };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  function setHot(id) {
    if (hot === id) return;
    if (hot && pins[hot]) pins[hot].classList.remove('hot');
    hot = id; if (id && pins[id]) pins[id].classList.add('hot');
  }
  const onKey = (e, v) => {
    if (!active) return;
    const k = e.key.toLowerCase();
    if (e.type === 'keydown' && k === 'escape') { if (win) closeWin(); else exit(); return; }
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(k)) {
      if (e.target.closest && e.target.closest('.hw-win')) return;
      if (v) keys.add(k); else keys.delete(k);
      if (v) { e.preventDefault(); hint.style.opacity = 0; }
    }
  };
  addEventListener('keydown', (e) => onKey(e, true));
  addEventListener('keyup', (e) => onKey(e, false));
  addEventListener('blur', () => keys.clear());
  new ResizeObserver(() => active && resize()).observe(container);

  // ---------- loop ----------
  let last = 0, acc = 0, nFrames = 0, ema = 1 / 60, lowFor = 0, time = 0;
  const v3 = new Vector3();
  function project() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    for (const p of places) {
      const a = world.placeView[p.id].anchor, b = pins[p.id];
      v3.set(a[0], a[1], a[2]).project(camera);
      const dist = Math.hypot(a[0] - P.x, a[1] - P.camY, a[2] - P.z);
      const vis = v3.z < 1 && Math.abs(v3.x) < 1.1 && v3.y > -1.1 && v3.y < 1.1 && dist < 90 && !(win && openId === p.id);
      b.style.display = vis ? '' : 'none';
      if (vis) b.style.transform = `translate(${((v3.x + 1) / 2) * w - 13}px,${((1 - v3.y) / 2) * h - 13}px)`;
    }
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now; time += dt;
    // movement
    if (glideS) stepGlide(dt);
    else {
      let f = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - joy.y;
      let s = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0) + joy.x;
      if (keys.has('arrowleft')) P.yaw += 1.6 * dt; if (keys.has('arrowright')) P.yaw -= 1.6 * dt;
      f = Math.max(-1, Math.min(1, f)); s = Math.max(-1, Math.min(1, s));
      if (f || s) {
        const sp = (keys.has('shift') ? 6 : 3.4) * dt;
        const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
        const r = walker.move(P.x, P.z, P.fy, (fx * f + rx * s) * sp, (fz * f + rz * s) * sp);
        P.x = r.x; P.z = r.z; P.fy = r.y;
      }
      P.camY += (P.fy + EYE - P.camY) * Math.min(1, dt * 10);
    }
    applyCam();
    world.water.uTime.value = reduced ? 0 : time;
    const r0 = performance.now();
    ink.render(renderer, scene, camera, time);
    if (!metrics.firstRenderMs) metrics.firstRenderMs = Math.round(performance.now() - r0);
    project();
    // metrics + adaptive resolution
    nFrames++; acc += dt; ema += (dt - ema) * 0.08;
    if (!metrics.firstFrameMs) { metrics.firstFrameMs = Math.round(performance.now() - T0); performance.mark('house-first-frame'); }
    if (acc >= 1) {
      metrics.fps = Math.round(nFrames / acc); metrics.quality = quality; metrics.frames += nFrames; nFrames = 0; acc = 0;
      if (ema > 1 / 38) lowFor++; else lowFor = Math.max(0, lowFor - 1);
      if (lowFor >= 2 && quality > 0.5) { quality = Math.max(0.5, quality - 0.15); lowFor = 0; resize(); }
      if (perfEl) perfEl.textContent = `${metrics.fps} fps · q ${quality.toFixed(2)} · ${canvas.width}×${canvas.height}\nbuild ${metrics.buildMs} ms · first frame ${metrics.firstFrameMs} ms`;
    }
  }

  function show(placeId) {
    root.hidden = false; active = true; resize();
    last = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
    if (placeId && world.placeView[placeId]) { setView(world.start); applyCam(); goPlace(placeId); }
    else if (!P.camY) { setView(world.start); }
    applyCam();
    hint.style.opacity = 1;
  }
  function hide() { active = false; cancelAnimationFrame(raf); root.hidden = true; closeWin(); keys.clear(); }
  function exit() { hide(); if (onExit) onExit(); }
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelAnimationFrame(raf); else if (active) { last = performance.now(); raf = requestAnimationFrame(frame); } });

  metrics.buildMs = Math.round(performance.now() - T0);
  show(initialPlace);
  const ctl = { show, hide, goPlace, metrics, canvas, _P: P, _camera: camera, _world: world, _setQuality(q) { quality = q; resize(); } };
  window.__houseCtl = ctl;
  return ctl;
}
