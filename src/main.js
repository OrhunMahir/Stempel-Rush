import * as THREE from "three";
import QRCode from "qrcode";
import { buildBuilding, disposeBuilding, patrolPos, moveWithCollision, hasLOS, onPuddle, STATIONS, FLOOR_NAMES, rng, DEFAULT_SETTINGS } from "./world.js";
import { makeCharacter, textSprite } from "./assets.js";
import * as audio from "./audio.js";
import { makeAvatar, loadAvatar, saveAvatar, sanitize, MODELS, COLORS, HATS, GLASSES, BEARDS, Preview } from "./avatar.js";
import { Particles, addShake, applyShake, stampSlam, flash, banner, alertSprite, coneMesh } from "./effects.js";

// ---------- constants ----------
const SPEED = 5.2;
const STAMP_TIME = 1.1;
const FRONT_R = 1.7; // distance to the spot in front of a counter
const HIT_R = 0.95;
let settings = { ...DEFAULT_SETTINGS };
const raceMs = () => settings.duration * 1000;
const DASH_SPEED = 15, DASH_T = 0.2, DASH_CD = 2.5;
const AI = {
  clerk: { range: 5.5, angle: (75 * Math.PI) / 180, chase: 3.6, react: 0.45 },
  guard: { range: 7.0, angle: (60 * Math.PI) / 180, chase: 4.3, react: 0.3 },
};
const EVENTS = {
  lunch: { name: "Mittagspause", desc: "Das Personal isst. Freie Bahn!", dur: 9, voice: "ev_lunch" },
  blackout: { name: "Systemausfall", desc: "Licht aus! Sie sehen dich schlechter.", dur: 10, voice: "ev_blackout", sfx: "blackout_sfx" },
  alarm: { name: "Feueralarm", desc: "Das Personal rennt doppelt so schnell!", dur: 9, voice: "ev_alarm", sfx: "alarm_sfx" },
  rush: { name: "Eilverfahren", desc: "Stempel gibt's jetzt doppelt so schnell!", dur: 12, voice: "ev_rush", sfx: "ding" },
};
const params = new URLSearchParams(location.search);
const ROOM = (params.get("room") || "MUC").toUpperCase();
const IS_HOST = params.has("host");
if (IS_HOST) document.body.classList.add("host");
const CANONICAL = "stempel-rush.dalliagac.workers.dev";
const SELF_HOSTED = location.hostname === CANONICAL || location.hostname === "localhost" || location.hostname === "127.0.0.1" || /^\d+\.\d+\.\d+\.\d+$/.test(location.hostname);
const WS_URL = SELF_HOSTED ? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?room=${ROOM}` : `wss://${CANONICAL}/ws?room=${ROOM}`;
const JOIN_BASE = SELF_HOSTED ? location.origin : `https://${CANONICAL}`;
const TOUCH = matchMedia("(pointer: coarse)").matches;

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const ui = {
  join: $("join"), name: $("name"), joinBtn: $("joinBtn"), soloBtn: $("soloBtn"),
  hud: $("hud"), stamps: $("stamps"), timer: $("timer"), info: $("info"),
  bubble: $("bubble"), bubbleText: $("bubbleText"), center: $("center"),
  progress: $("progress"), progressFill: $("progressFill"), progressText: $("progressText"),
  lobby: $("lobby"), playerList: $("playerList"), startBtn: $("startBtn"), qr: $("qr"), joinUrl: $("joinUrl"), lobbyScores: $("lobbyScores"),
  results: $("results"), resultList: $("resultList"), resultsTitle: $("resultsTitle"), resultsNext: $("resultsNext"),
  joy: $("joy"), joyNub: $("joyNub"), minimap: $("minimap"), powerHud: $("powerHud"), dashBtn: $("dashBtn"), eventTag: $("eventTag"),
  menuBtn: $("menuBtn"), menu: $("menu"), menuNote: $("menuNote"), resumeBtn: $("resumeBtn"), volMusic: $("volMusic"), volSfx: $("volSfx"),
  customBtn: $("customBtn"), leaveBtn: $("leaveBtn"), custom: $("custom"), customDone: $("customDone"), lobbyCustomBtn: $("lobbyCustomBtn"), settingsSummary: $("settingsSummary"),
  floorPanel: $("floorPanel"), fade: $("fade"),
  avatarBtn: $("avatarBtn"), avatarScreen: $("avatarScreen"), avatarPreview: $("avatarPreview"), avPrev: $("avPrev"), avNext: $("avNext"), avModel: $("avModel"),
  avColors: $("avColors"), avHats: $("avHats"), avGlasses: $("avGlasses"), avBeards: $("avBeards"), avDone: $("avDone"),
  setDuration: $("setDuration"), setClerks: $("setClerks"), setSize: $("setSize"), setGuards: $("setGuards"), setEvents: $("setEvents"), setPowerups: $("setPowerups"), setShove: $("setShove"),
};
for (let i = 1; i <= 5; i++) { const d = document.createElement("div"); d.className = "slot"; d.textContent = i; d.title = STATIONS[i]; ui.stamps.appendChild(d); }
try { ui.name.value = localStorage.getItem("sr_name") || ""; } catch {}

// ---------- three ----------
const canvas = $("c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !TOUCH, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, TOUCH ? 1.5 : 2));
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color("#1d2433");
scene.fog = IS_HOST ? null : new THREE.Fog("#1d2433", 40, 80);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
const hemi = new THREE.HemisphereLight("#fff8e8", "#4a4f60", 1.4);
scene.add(hemi);
const sun = new THREE.DirectionalLight("#fff3d6", 2.0);
sun.position.set(-12, 30, 14);
sun.castShadow = true;
sun.shadow.mapSize.set(TOUCH ? 1024 : 2048, TOUCH ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 24, bottom: -24, near: 1, far: 90 });
scene.add(sun);
const playerLight = new THREE.PointLight("#fff1c9", 0, 10, 1.6);
scene.add(playerLight);
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener("resize", resize); resize();

const paper = new Particles(scene, { count: 320, size: 0.2 });
const dust = new Particles(scene, { count: 160, size: 0.16, color: "#ffffff", gravity: 1.5, drag: 3, spin: false });

// guidance arrow + beacon
const arrow = (() => {
  const s = new THREE.Shape(); s.moveTo(0, 0.55); s.lineTo(0.32, -0.15); s.lineTo(0, 0); s.lineTo(-0.32, -0.15); s.closePath();
  const geo = new THREE.ShapeGeometry(s); geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: "#ffd23f", transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }));
  m.renderOrder = 3; m.visible = false; scene.add(m); return m;
})();
const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 14, 24, 1, true), new THREE.MeshBasicMaterial({ color: "#ffd23f", transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
beacon.visible = false; scene.add(beacon);

// ---------- state ----------
let world = null, bld = null, curF = 0, worldKey = null, building = null, paused = false, pauseStart = 0;
let fog = []; // per floor: revealed cells (minimap fog of war)
const me = {
  id: null, name: "", color: "#ff7a1a", char: null, label: null, ring: null, shieldMesh: null,
  pos: new THREE.Vector3(), ry: 0, anim: 0, stamps: [], stun: 0, invuln: 0, finished: false, stampProgress: 0, stampAt: null,
  dashT: 0, dashCd: 0, boost: 0, shield: 0, shoved: new Set(), dustT: 0, vel: new THREE.Vector3(), stairCd: 0, slipping: false,
  avatar: loadAvatar(),
};
const remotes = new Map();
let clerks = [];
let phase = "offline", raceStart = 0, phaseEndsAt = 0, serverOffset = 0, results = [], scores = [], round = 0, seed = 1;
let ws = null, solo = false, lastSend = 0, lastCount = -1, spotCd = 0, last30Played = false, curEvent = null, eventsFired = new Set();
const serverNow = () => Date.now() + serverOffset;
const raceT = () => (serverNow() - raceStart) / 1000;

// ---------- input ----------
const keys = new Set();
addEventListener("keydown", (e) => {
  if (e.key === "Escape") { e.preventDefault(); if (!ui.custom.classList.contains("hidden")) closeCustom(); else if (me.char || IS_HOST) toggleMenu(); return; }
  if (document.activeElement === ui.name || menuOpen()) return;
  const k = e.key.toLowerCase();
  keys.add(k);
  if (k === " ") { e.preventDefault(); tryDash(); }
});
addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
const joy = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0 };
canvas.addEventListener("pointerdown", (e) => {
  audio.unlock();
  if (e.pointerType === "mouse") return;
  joy.active = true; joy.id = e.pointerId; joy.ox = e.clientX; joy.oy = e.clientY; joy.x = joy.y = 0;
  ui.joy.style.left = e.clientX + "px"; ui.joy.style.top = e.clientY + "px"; ui.joy.classList.remove("hidden");
});
addEventListener("pointermove", (e) => {
  if (!joy.active || e.pointerId !== joy.id) return;
  let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy;
  const L = Math.hypot(dx, dy), max = 55;
  if (L > max) { dx *= max / L; dy *= max / L; }
  joy.x = dx / max; joy.y = dy / max;
  ui.joyNub.style.transform = `translate(${dx}px, ${dy}px)`;
});
const endJoy = (e) => { if (e.pointerId !== joy.id) return; joy.active = false; joy.x = joy.y = 0; ui.joy.classList.add("hidden"); ui.joyNub.style.transform = ""; };
addEventListener("pointerup", endJoy); addEventListener("pointercancel", endJoy);
ui.dashBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); audio.unlock(); tryDash(); });

function inputVec() {
  let x = 0, z = 0;
  if (keys.has("w") || keys.has("arrowup")) z -= 1;
  if (keys.has("s") || keys.has("arrowdown")) z += 1;
  if (keys.has("a") || keys.has("arrowleft")) x -= 1;
  if (keys.has("d") || keys.has("arrowright")) x += 1;
  if (joy.active) { x += joy.x; z += joy.y; }
  const L = Math.hypot(x, z);
  if (L > 1) { x /= L; z /= L; }
  return { x, z, L: Math.min(L, 1) };
}

// ---------- UI helpers ----------
let bubbleTimer = 0;
function say(text, who = "👔", ms = 2200) {
  ui.bubble.querySelector(".who").textContent = who;
  ui.bubbleText.textContent = text;
  ui.bubble.classList.remove("hidden");
  ui.bubble.style.animation = "none"; void ui.bubble.offsetWidth; ui.bubble.style.animation = "";
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => ui.bubble.classList.add("hidden"), ms);
}
function center(html, ms = 0) {
  ui.center.innerHTML = html;
  if (ms) setTimeout(() => { if (ui.center.innerHTML === html) ui.center.innerHTML = ""; }, ms);
}
function renderStamps() {
  [...ui.stamps.children].forEach((d, i) => d.classList.toggle("on", me.stamps.includes(i + 1)));
  for (const fl of bld?.floors ?? []) {
    for (const s of fl.stations) {
      const has = me.stamps.includes(s.n);
      s.holder.visible = !has;
      s.ring.material.color.set(has ? "#3a3f4a" : "#ffd23f");
    }
    if (fl.exit) fl.exit.glow.material.opacity = me.stamps.length === 5 ? 0.85 : 0;
  }
  renderFloorPanel();
}
function renderFloorPanel() {
  if (!bld) return;
  let h = "";
  for (let f = bld.F - 1; f >= 0; f--) {
    const nums = Object.entries(bld.stationFloor).filter(([, fl]) => fl === f).map(([n]) => Number(n)).sort();
    const st = nums.map((n) => `<span class="st${me.stamps.includes(n) ? " done" : ""}">${n}</span>`).join("");
    h += `<div class="fl${f === curF ? " cur" : ""}"><b>${FLOOR_NAMES[f]}</b>${st}${f === bld.F - 1 ? `<span class="st exit${me.stamps.length === 5 ? " ready" : ""}">🏁</span>` : ""}</div>`;
  }
  if (ui.floorPanel._h !== h) { ui.floorPanel.innerHTML = h; ui.floorPanel._h = h; }
}
function renderPowerHud() {
  let h = "";
  if (me.boost > 0) h += `<span class="pw coffee">☕ ${me.boost.toFixed(1)}s</span>`;
  if (me.shield > 0) h += `<span class="pw termin">🎫 Termin</span>`;
  if (ui.powerHud._h !== h) { ui.powerHud.innerHTML = h; ui.powerHud._h = h; }
}
const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function makeQR() {
  const url = `${JOIN_BASE}/?room=${ROOM}`;
  ui.joinUrl.textContent = url.replace(/^https?:\/\//, "");
  QRCode.toCanvas(ui.qr, url, { margin: 1, width: IS_HOST ? 440 : 260 });
}
function renderScores() {
  ui.lobbyScores.innerHTML = scores.length ? "🏆 " + scores.map(([n, p]) => `${escapeHtml(n)} ${p}`).join(" · ") : "";
}

// ---------- world ----------
async function ensureWorld(newSeed) {
  const key = newSeed + "|" + JSON.stringify(settings);
  if (key === worldKey && bld) return;
  worldKey = key;
  const job = buildBuilding(scene, newSeed, settings);
  building = job;
  const b = await job;
  if (building !== job) { disposeBuilding(scene, b); return; }
  disposeBuilding(scene, bld);
  bld = b;
  for (const c of clerks) { scene.remove(c.char.root, c.cone, c.alert, c.q); }
  clerks = [];
  resetFog();
  Object.assign(sun.shadow.camera, { left: -bld.W - 2, right: bld.W + 2, top: bld.H + 2, bottom: -bld.H - 2 });
  sun.shadow.camera.updateProjectionMatrix();
  setFloor(0);
  await spawnClerks();
  renderStamps();
  me.pos.copy(bld.floors[0].spawn); // never stay inside a wall of the new floor plan
}

function resetFog() { fog = bld.floors.map((fl) => ({ cells: new Uint8Array(fl.W * fl.H), canvas: null })); }

function setFloor(f) {
  curF = f;
  world = bld.floors[f];
  bld.floors.forEach((fl, i) => { fl.group.visible = i === f; });
  scene.background.set(world.theme.sky);
  if (scene.fog) scene.fog.color.set(world.theme.sky);
  sun.color.set(world.theme.light);
  for (const c of clerks) {
    const on = c.f === f;
    c.char.root.visible = on; c.cone.visible = on; c.alert.visible = false; c.q.visible = false;
    if (!on) { c.state = "patrol"; c.seeT = 0; }
  }
  for (const r of remotes.values()) applyRemoteVisibility(r);
  buildMinimapBase();
  renderFloorPanel();
}

function useStair(s) {
  me.stairCd = 1.2; me.stampProgress = 0; me.vel.set(0, 0, 0);
  ui.fade.classList.remove("hidden"); ui.fade.style.animation = "none"; void ui.fade.offsetWidth; ui.fade.style.animation = "";
  setTimeout(() => ui.fade.classList.add("hidden"), 450);
  setFloor(s.to);
  const dest = world.stairs.find((t) => t.r === s.r && t.c === s.c) || world.stairs[0];
  me.pos.copy(dest ? dest.arrive : world.spawn);
  camPos.set(me.pos.x, camPos.y, me.pos.z + 9); camLook.copy(me.pos);
  audio.play("whoosh", { vol: 0.5 });
  banner(`<b>${FLOOR_NAMES[s.to]}</b>${s.dir === "up" ? "Treppe hoch" : "Treppe runter"}`, 1300);
}

async function spawnClerks() {
  const B = bld;
  const list = B.floors.flatMap((fl) => fl.patrols.map((p) => ({ p, f: fl.f })));
  const made = await Promise.all(list.map(({ p }) => makeCharacter(p.kind === "guard" ? "guard" : "clerk", "#7a5230", p.kind === "guard" ? 1.95 : 1.8)));
  if (B !== bld) return;
  made.forEach((ch, i) => {
    const { p, f } = list[i];
    const cfg = AI[p.kind] || AI.clerk;
    ch.setAnim(1);
    scene.add(ch.root);
    const cone = coneMesh(cfg.range, cfg.angle);
    scene.add(cone);
    const alert = alertSprite("!");
    const q = alertSprite("?");
    scene.add(alert, q);
    const on = f === curF;
    ch.root.visible = on; cone.visible = on;
    clerks.push({ f, patrol: p, kind: p.kind, cfg, char: ch, cone, alert, q, pos: new THREE.Vector3(), ry: 0, state: "patrol", pt: 0, chaseT: 0, lostT: 0, stuckT: 0, cooldown: 0, seeT: 0 });
  });
  syncClerkTime();
}
function syncClerkTime() {
  const t = phase === "race" || phase === "countdown" ? Math.max(0, raceT()) : serverNow() / 1000 % 10000;
  for (const c of clerks) { c.pt = t; c.state = "patrol"; c.alert.visible = false; c.q.visible = false; c.seeT = 0; }
}

// ---------- minimap (fog of war) ----------
let mmBase = null, mmScale = 6, mmLast = 0;
function buildMinimapBase() {
  const { W, H, map } = world;
  mmScale = Math.max(4, Math.floor(170 / Math.max(W, H)));
  mmBase = document.createElement("canvas");
  mmBase.width = W * mmScale; mmBase.height = H * mmScale;
  const x = mmBase.getContext("2d");
  x.fillStyle = "rgba(246,240,220,0.22)"; x.fillRect(0, 0, mmBase.width, mmBase.height);
  x.fillStyle = "rgba(20,24,34,0.95)";
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (map.g[r][c] === "#") x.fillRect(c * mmScale, r * mmScale, mmScale, mmScale);
  for (const s of world.stairs) { x.fillStyle = s.dir === "up" ? "#4fd1ff" : "#ff9a3c"; x.fillRect(s.c * mmScale + 1, s.r * mmScale + 1, mmScale - 2, mmScale - 2); }
  ui.minimap.width = mmBase.width; ui.minimap.height = mmBase.height;
  const fg = fog[curF];
  if (fg && !fg.canvas) {
    fg.canvas = document.createElement("canvas");
    fg.canvas.width = mmBase.width; fg.canvas.height = mmBase.height;
    const fx = fg.canvas.getContext("2d");
    fx.fillStyle = "#0d1018"; fx.fillRect(0, 0, fg.canvas.width, fg.canvas.height);
    for (let i = 0; i < fg.cells.length; i++) if (fg.cells[i]) fx.clearRect((i % W) * mmScale, Math.floor(i / W) * mmScale, mmScale, mmScale);
  }
}
const isRevealed = (r, c) => { const fg = fog[curF]; return !fg || fg.cells[r * world.W + c] === 1; };
function revealAround() {
  const fg = fog[curF];
  if (!fg || !fg.canvas) return;
  const { W, H } = world;
  const fx = fg.canvas.getContext("2d");
  const [pr, pc] = world.worldToCell(me.pos.x, me.pos.z);
  const open = (r, c) => {
    if (r < 0 || c < 0 || r >= H || c >= W) return;
    const i = r * W + c;
    if (fg.cells[i]) return;
    fg.cells[i] = 1;
    fx.clearRect(c * mmScale, r * mmScale, mmScale, mmScale);
  };
  for (let dr = -3; dr <= 3; dr++) for (let dc = -3; dc <= 3; dc++) if (dr * dr + dc * dc <= 10) open(pr + dr, pc + dc);
  const rm = world.map.rooms.find((q) => pr >= q.r0 && pr <= q.r1 && pc >= q.c0 && pc <= q.c1);
  if (rm && !rm._seen?.[curF]) {
    for (let r = rm.r0 - 1; r <= rm.r1 + 1; r++) for (let c = rm.c0 - 1; c <= rm.c1 + 1; c++) open(r, c);
  }
}
function drawMinimap() {
  if (!mmBase || !world) return;
  if (me.char && !IS_HOST) revealAround();
  const x = ui.minimap.getContext("2d");
  x.clearRect(0, 0, ui.minimap.width, ui.minimap.height);
  x.drawImage(mmBase, 0, 0);
  const toMM = (v) => [(v.x / 2 + world.W / 2) * mmScale, (v.z / 2 + world.H / 2) * mmScale];
  const seen = (v) => { const [r, c] = world.worldToCell(v.x, v.z); return isRevealed(r, c); };
  const dot = (v, col, r) => { const [px, py] = toMM(v); x.fillStyle = col; x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill(); };
  for (const s of world.stations) { if (!seen(s.pos) && !seen(s.front)) continue; const [px, py] = toMM(s.pos); x.fillStyle = me.stamps.includes(s.n) ? "#555c6b" : "#ffd23f"; x.fillRect(px - 5, py - 5, 10, 10); x.fillStyle = "#1d2433"; x.font = "bold 9px sans-serif"; x.textAlign = "center"; x.fillText(s.n, px, py + 3); }
  if (world.exit && (seen(world.exit.pos) || seen(world.exit.front))) { const [px, py] = toMM(world.exit.pos); x.fillStyle = me.stamps.length === 5 ? "#3f6" : "#2f6b45"; x.fillRect(px - 6, py - 6, 12, 12); }
  for (const p of world.powerups) if (serverNow() > p.takenUntil && seen(p.pos)) dot(p.pos, p.type === "coffee" ? "#ff9a3c" : "#4fd1ff", 2.5);
  for (const c of clerks) if (c.f === curF && seen(c.pos)) dot(c.pos, c.state === "chase" ? "#ff2d4a" : "#c0392b", c.state === "chase" ? 4 : 3);
  for (const r of remotes.values()) if (r.f === curF) dot(r.pos, r.color, 3.5);
  if (me.char) { const [px, py] = toMM(me.pos); x.save(); x.translate(px, py); x.rotate(-me.ry + Math.PI); x.fillStyle = "#fff"; x.beginPath(); x.moveTo(0, -6); x.lineTo(4.5, 4.5); x.lineTo(-4.5, 4.5); x.closePath(); x.fill(); x.restore(); }
  const fg = fog[curF];
  if (fg?.canvas && (phase === "race" || phase === "countdown") && !IS_HOST) x.drawImage(fg.canvas, 0, 0);
  x.fillStyle = "rgba(0,0,0,0.6)"; x.fillRect(0, 0, 44, 15);
  x.fillStyle = "#fff"; x.font = "bold 11px sans-serif"; x.textAlign = "left"; x.fillText(FLOOR_NAMES[curF], 4, 11);
}

// ---------- characters ----------
function colorRing(color) {
  const r = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.62, 32), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
  r.rotation.x = -Math.PI / 2;
  return r;
}
async function spawnMe() {
  me.char = await makeAvatar(me.avatar, me.color);
  scene.add(me.char.root);
  me.ring = colorRing(me.color); scene.add(me.ring);
  me.label = textSprite(me.name || "Du", { bg: me.color, scale: 0.8 }); scene.add(me.label);
  me.shieldMesh = new THREE.Mesh(new THREE.SphereGeometry(0.85, 24, 16), new THREE.MeshBasicMaterial({ color: "#4fd1ff", transparent: true, opacity: 0.18, depthWrite: false }));
  me.shieldMesh.visible = false; scene.add(me.shieldMesh);
}
function ensureRemote(id, name, color, av) {
  if (remotes.has(id)) return remotes.get(id);
  const r = { id, name, color, f: 0, pos: new THREE.Vector3(), target: new THREE.Vector3(), ry: 0, tRy: 0, anim: 0, char: null, label: null, ring: colorRing(color), stamps: 0, fresh: true };
  remotes.set(id, r);
  scene.add(r.ring);
  r.label = textSprite(name, { bg: color, scale: 0.8 }); scene.add(r.label);
  makeAvatar(av || { m: "player", c: color }, color).then((ch) => {
    if (!remotes.has(id)) return;
    r.char = ch; scene.add(ch.root); applyRemoteVisibility(r);
  });
  return r;
}
function applyRemoteVisibility(r) {
  const on = r.f === curF;
  if (r.char) r.char.root.visible = on;
  r.label.visible = on; r.ring.visible = on;
}
function removeRemote(id) {
  const r = remotes.get(id);
  if (!r) return;
  if (r.char) scene.remove(r.char.root);
  scene.remove(r.label, r.ring);
  remotes.delete(id);
}

// ---------- networking ----------
function connect() {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(WS_URL);
    let opened = false;
    const to = setTimeout(() => { if (!opened) { sock.close(); reject(new Error("timeout")); } }, 5000);
    sock.onopen = () => { opened = true; clearTimeout(to); ws = sock; sock.send(JSON.stringify({ t: "hello", name: me.name, host: IS_HOST, avatar: me.avatar })); resolve(); };
    sock.onerror = () => { if (!opened) { clearTimeout(to); reject(new Error("ws error")); } };
    sock.onclose = () => { if (opened) { ws = null; say("Verbindung verloren – lade neu…", "⚠️", 4000); setTimeout(() => location.reload(), 2500); } };
    sock.onmessage = (ev) => onNet(JSON.parse(ev.data));
  });
}
function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }

function onNet(m) {
  if (m.now) serverOffset = m.now - Date.now();
  switch (m.t) {
    case "welcome":
      me.id = m.id; me.color = m.color;
      if (me.ring) me.ring.material.color.set(m.color);
      if (me.label) { scene.remove(me.label); me.label = textSprite(me.name, { bg: m.color, scale: 0.8 }); scene.add(me.label); }
      applyPhase(m);
      break;
    case "phase": applyPhase(m); break;
    case "snap": {
      const seen = new Set();
      for (const [id, name, color, x, z, ry, a, st, fin, host, f, av] of m.ps) {
        seen.add(id);
        if (id === me.id || host) continue;
        const r = ensureRemote(id, name, color, av);
        const nf = f | 0;
        if (nf !== r.f || r.fresh) { r.f = nf; r.pos.set(x, 0, z); r.fresh = false; applyRemoteVisibility(r); }
        r.target.set(x, 0, z); r.tRy = ry; r.anim = a; r.stamps = st; r.finished = !!fin;
      }
      for (const id of [...remotes.keys()]) if (!seen.has(id)) removeRemote(id);
      updateLobbyList(m.ps);
      break;
    }
    case "left": removeRemote(m.id); break;
    case "finish":
      if (m.id !== me.id) say(`${m.name} hat den Aufenthaltstitel! (#${m.place})`, "🏁", 2500);
      break;
    case "shoved": onShoved(m); break;
    case "fxshove": {
      const t = m.target === me.id ? me.pos : remotes.get(m.target)?.pos;
      if (t && m.id !== me.id) { paper.burst(t.clone().setY(1), 14, { speed: 4, up: 4 }); audio.play("bump", { vol: 0.5 }); }
      break;
    }
  }
}

async function applyPhase(m) {
  const prev = phase;
  phase = m.phase; raceStart = m.raceStart; phaseEndsAt = m.phaseEndsAt; results = m.results || []; scores = m.scores || scores; round = m.round || round;
  if (m.now) serverOffset = m.now - Date.now();
  if (m.seed && m.seed !== seed) seed = m.seed;
  if (m.settings) { settings = { ...DEFAULT_SETTINGS, ...m.settings }; renderSettings(); }
  await ensureWorld(seed);
  onPhaseChange(prev);
  renderScores();
}

function updateLobbyList(ps) {
  const racers = ps.filter((p) => !p[9]);
  ui.playerList.innerHTML = racers.map((p) => `<span class="chip" style="background:${p[2]}">${escapeHtml(p[1])}${p[0] === me.id ? " (du)" : ""}</span>`).join("") || "<em>Noch niemand da…</em>";
  if (phase === "race") ui.info.textContent = `${racers.length} im Rennen · ${racers.filter((p) => p[8]).length} fertig`;
  else ui.info.textContent = `${racers.length} im Wartebereich`;
}

// ---------- phases ----------
function eventSchedule() {
  if (!settings.events) return [];
  const R = rng((seed ^ 0x51ed) >>> 0);
  const ks = Object.keys(EVENTS);
  for (let i = ks.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [ks[i], ks[j]] = [ks[j], ks[i]]; }
  return [{ key: ks[0], at: 28 + R() * 10 }, { key: ks[1], at: 66 + R() * 10 }];
}
function activeEvent(t) {
  for (const e of eventSchedule()) if (t >= e.at && t < e.at + EVENTS[e.key].dur) return e;
  return null;
}

function resetMeForRace() {
  me.stamps = []; me.finished = false; me.stun = 0; me.invuln = 0; me.stampProgress = 0; me.boost = 0; me.shield = 0; me.dashCd = 0;
  setFloor(0);
  resetFog(); buildMinimapBase();
  const sr = world.spawnRoom;
  const p = world.cellToWorld(sr.rc, sr.cc);
  me.pos.set(p.x + (Math.random() - 0.5) * 3, 0, p.z + (Math.random() - 0.5) * 2);
  me.vel.set(0, 0, 0);
  for (const fl of bld.floors) for (const pu of fl.powerups) pu.takenUntil = 0;
  renderStamps();
}

function onPhaseChange(prev) {
  ui.results.classList.add("hidden");
  ui.lobby.classList.toggle("hidden", phase !== "lobby" || solo);
  if (phase !== "race") { ui.eventTag.classList.add("hidden"); curEvent = null; }
  if (phase === "lobby") { center(""); ui.timer.textContent = "--:--"; ui.timer.classList.remove("urgent"); audio.music("music", 0.25); }
  if (phase === "countdown" && prev !== "countdown") {
    resetMeForRace(); syncClerkTime();
    lastCount = -1; last30Played = false; eventsFired = new Set();
    audio.play("countdown");
    banner(`<b>${escapeHtml(bld.name)}</b>Runde ${round || 1} · ${bld.F} Etagen · Aufenthaltstitel im ${FLOOR_NAMES[bld.F - 1]}`, 3400);
  }
  if (phase === "race" && prev !== "race") {
    center("LOS!<small>Hol dir alle 5 Stempel</small>", 1400);
    audio.play("ding"); audio.music("music", 0.3);
  }
  if (phase === "results" && prev !== "results") showResults();
}

function showResults() {
  center("");
  ui.results.classList.remove("hidden");
  const mine = results.findIndex((r) => r.id === me.id);
  ui.resultsTitle.textContent = me.finished ? (mine === 0 ? "1. Platz! 🏆" : `Platz ${mine + 1}`) : "Geschlossen!";
  ui.resultList.innerHTML = results.map((r) => `<li><span class="dot" style="background:${r.color}"></span>${escapeHtml(r.name)} — ${r.ms ? fmt(r.ms) + " ✅" : (r.stamps ?? 0) + "/5 Stempel"}${r.pts ? ` <b>+${r.pts}</b>` : ""}${r.total != null ? ` <span class="scoreLine">(${r.total} P.)</span>` : ""}</li>`).join("") || "<li>Niemand hat es geschafft. Typisch.</li>";
  ui.resultsNext.textContent = solo ? "Neue Etage gleich…" : "Gleich geht's zurück in den Wartebereich…";
  if (!me.finished && !IS_HOST) audio.play("timeup");
  audio.music("music", 0.2);
}

// Solo mode drives its own phase machine.
async function soloStart() {
  seed = (Math.random() * 1e9) | 0;
  await ensureWorld(seed);
  const prev = phase;
  phase = "countdown"; raceStart = serverNow() + 3500; phaseEndsAt = raceStart; results = []; round++;
  onPhaseChange(prev);
}
function soloTick() {
  const now = serverNow();
  if (phase === "countdown" && now >= raceStart) { const p = phase; phase = "race"; phaseEndsAt = raceStart + raceMs(); onPhaseChange(p); }
  else if (phase === "race" && now >= phaseEndsAt) { phase = "results"; results = [{ id: me.id, name: me.name, color: me.color, ms: 0, stamps: me.stamps.length }]; phaseEndsAt = now + 6000; onPhaseChange("race"); }
  else if (phase === "results" && now >= phaseEndsAt) { soloStart(); }
}

// ---------- gameplay ----------
const tmp = { pos: new THREE.Vector3(), ry: 0 };
const v3 = new THREE.Vector3();
function hitMe(byClerk) {
  if (me.shield > 0) {
    me.shield = 0; me.invuln = 2.2;
    say("Termin-Bestätigung vorgezeigt. Glück gehabt!", "🎫", 2000);
    flash("rgba(79,209,255,0.45)"); audio.play("powerup");
    return;
  }
  const i = Math.floor(Math.random() * audio.LINES.hit.length);
  say(audio.LINES.hit[i]); audio.play(`hit_${i}`); audio.play("buzz", { vol: 0.5 });
  me.stun = 1.2; me.invuln = 3.0; me.stampProgress = 0;
  const lost = me.stamps.pop();
  if (lost) setTimeout(() => say(`Stempel ${lost} ungültig! Nochmal zu ${STATIONS[lost]}.`, "📄", 2200), 1300);
  renderStamps();
  flash(); addShake(0.45, 0.4);
  paper.burst(me.pos.clone().setY(1.1), 26, { speed: 5, up: 5 });
  const push = me.pos.clone().sub(byClerk.pos).setY(0).normalize().multiplyScalar(1.3);
  moveWithCollision(world, me.pos, push.x, push.z);
  send({ t: "hit", line: i });
}

function updateClerks(dt) {
  const racing = phase === "race";
  const t = racing ? raceT() : 0;
  const ev = racing ? activeEvent(t) : null;
  const evKey = ev?.key;
  const mul = evKey === "lunch" ? 0 : evKey === "alarm" ? 2 : 1;
  const canSee = racing && !me.finished && !IS_HOST && me.char;
  spotCd = Math.max(0, spotCd - dt);
  for (const c of clerks) {
    c.cooldown = Math.max(0, c.cooldown - dt);
    c.pt += dt * (racing || phase === "lobby" ? mul : 0);
    if (phase === "countdown") c.pt = 0;
    if (c.f !== curF) continue; // other floors are hidden and not simulated
    const cfg = c.cfg;
    const range = cfg.range * (evKey === "blackout" ? 0.55 : 1);
    if (c.state === "patrol") {
      patrolPos(c.patrol, c.pt, tmp);
      c.pos.copy(tmp.pos); c.ry = tmp.ry;
    }
    // vision: must stay in the cone (with line of sight) for a short reaction time
    let sees = false;
    if (canSee && evKey !== "lunch" && c.state !== "chase" && c.cooldown <= 0 && me.invuln <= 0) {
      v3.subVectors(me.pos, c.pos); v3.y = 0;
      const d = v3.length();
      if (d < range) {
        const fx = Math.sin(c.ry), fz = Math.cos(c.ry);
        const cos = (fx * v3.x + fz * v3.z) / (d || 1);
        sees = cos > Math.cos(cfg.angle / 2) && hasLOS(world, c.pos, me.pos);
      }
    }
    c.seeT = sees ? c.seeT + dt : Math.max(0, c.seeT - dt * 1.5);
    c.q.visible = c.seeT > 0 && c.state !== "chase";
    if (sees && c.seeT >= cfg.react) {
      c.state = "chase"; c.chaseT = 0; c.lostT = 0; c.stuckT = 0; c.seeT = 0; c.q.visible = false;
      c.alert.visible = true;
      if (spotCd <= 0) {
        spotCd = 2.2;
        const li = Math.floor(Math.random() * audio.LINES.spot.length);
        audio.play("alert", { vol: 0.7 }); audio.play(`spot_${li}`);
        say(audio.LINES.spot[li], c.kind === "guard" ? "👮" : "👔", 1600);
      }
    }
    if (c.state === "chase") {
      if (!canSee || evKey === "lunch") { c.state = "return"; }
      else {
        v3.subVectors(me.pos, c.pos); v3.y = 0;
        const d = v3.length();
        const spd = cfg.chase * (evKey === "alarm" ? 1.3 : 1) * dt;
        v3.normalize();
        const before = c.pos.clone();
        moveWithCollision(world, c.pos, v3.x * spd, v3.z * spd, 0.35);
        c.ry = Math.atan2(v3.x, v3.z);
        c.chaseT += dt;
        c.stuckT = before.distanceTo(c.pos) < spd * 0.3 ? c.stuckT + dt : 0;
        c.lostT = d > range * 1.6 || !hasLOS(world, c.pos, me.pos) ? c.lostT + dt : 0;
        if (c.lostT > 1.0 || c.chaseT > 6 || c.stuckT > 0.6) { c.state = "return"; c.cooldown = 1.5; }
      }
    }
    if (c.state === "return") {
      c.alert.visible = false;
      patrolPos(c.patrol, c.pt, tmp);
      v3.subVectors(tmp.pos, c.pos); v3.y = 0;
      const d = v3.length();
      if (d < 0.25) { c.state = "patrol"; }
      else {
        const spd = Math.min(d, 3.2 * dt * (mul || 1));
        v3.normalize();
        c.pos.x += v3.x * spd; c.pos.z += v3.z * spd;
        c.ry = Math.atan2(v3.x, v3.z);
      }
    }
    // catch
    if (racing && !me.finished && !IS_HOST && me.char && me.invuln <= 0 && c.cooldown <= 0 && c.pos.distanceTo(me.pos) < HIT_R) {
      hitMe(c); c.state = "return"; c.cooldown = 2.5; c.alert.visible = false;
    }
    // visuals
    c.char.root.position.copy(c.pos);
    c.char.root.rotation.y = c.ry;
    c.char.setAnim(mul === 0 && c.state === "patrol" ? 0 : c.state === "chase" || mul > 1 ? 2 : 1);
    c.char.update(dt);
    c.cone.visible = !(evKey === "lunch") && phase !== "results";
    c.cone.position.set(c.pos.x, 0.04, c.pos.z);
    c.cone.rotation.y = c.ry;
    c.cone.scale.setScalar(evKey === "blackout" ? 0.55 : 1);
    c.cone.material.color.set(c.state === "chase" ? "#ff2d4a" : c.kind === "guard" ? "#ff9a3c" : "#ffd23f");
    c.cone.material.opacity = c.state === "chase" ? 0.28 : 0.16;
    c.alert.position.set(c.pos.x, 2.5 + Math.sin(performance.now() / 120) * 0.08, c.pos.z);
    c.q.position.set(c.pos.x, 2.5, c.pos.z);
  }
}

function tryDash() {
  if (!me.char || me.dashCd > 0 || me.stun > 0 || me.finished || phase === "countdown" || phase === "results") return;
  me.dashT = DASH_T; me.dashCd = DASH_CD; me.shoved.clear();
  audio.play("whoosh", { vol: 0.8 });
  dust.burst(me.pos.clone().setY(0.2), 8, { speed: 2, up: 0.6, colors: ["#e8e2d0", "#ffffff"], life: 0.6 });
}
function onShoved(m) {
  if (phase !== "race" || me.finished) return;
  me.stun = Math.max(me.stun, 1.0); me.stampProgress = 0;
  const L = Math.hypot(m.dx, m.dz) || 1;
  for (let i = 0; i < 6; i++) moveWithCollision(world, me.pos, (m.dx / L) * 0.4, (m.dz / L) * 0.4);
  say(`${m.by} hat sich vorgedrängelt!`, "😤", 1800);
  flash("rgba(255,154,60,0.45)"); addShake(0.35, 0.3); audio.play("bump");
  paper.burst(me.pos.clone().setY(1), 16, { speed: 4, up: 4 });
}

function stairToward(tf) {
  const dir = tf > curF ? "up" : "down";
  let best = null, bd = Infinity;
  for (const st of world.stairs) { if (st.dir !== dir) continue; const d = st.pos.distanceTo(me.pos); if (d < bd) { bd = d; best = st; } }
  return best ? { pos: best.pos, front: best.pos, stair: true } : null;
}
function targetFor() {
  if (!world || !bld) return null;
  if (me.stamps.length === 5) return curF === bld.F - 1 ? world.exit : stairToward(bld.F - 1);
  let best = null, bd = Infinity;
  for (const s of world.stations) {
    if (me.stamps.includes(s.n)) continue;
    const d = s.front.distanceTo(me.pos);
    if (d < bd) { bd = d; best = s; }
  }
  if (best) return best;
  const need = [1, 2, 3, 4, 5].filter((n) => !me.stamps.includes(n)).map((n) => bld.stationFloor[n]);
  if (!need.length) return null;
  const tf = need.sort((a, b) => Math.abs(a - curF) - Math.abs(b - curF))[0];
  return stairToward(tf);
}

function updateMe(dt) {
  if (!me.char || IS_HOST || !world) return;
  const racing = phase === "race";
  const t = racing ? raceT() : 0;
  const evKey = racing ? activeEvent(t)?.key : null;
  const frozen = phase === "countdown" || phase === "results" || me.finished;
  me.stun = Math.max(0, me.stun - dt);
  me.invuln = Math.max(0, me.invuln - dt);
  me.dashCd = Math.max(0, me.dashCd - dt);
  me.boost = Math.max(0, me.boost - dt);
  me.shield = Math.max(0, me.shield - dt);
  me.stairCd = Math.max(0, me.stairCd - dt);
  ui.dashBtn.classList.toggle("cool", me.dashCd > 0);

  const v = frozen || me.stun > 0 ? { x: 0, z: 0, L: 0 } : inputVec();
  if (me.dashT > 0 && !frozen) {
    me.dashT -= dt;
    const fx = Math.sin(me.ry), fz = Math.cos(me.ry);
    moveWithCollision(world, me.pos, fx * DASH_SPEED * dt, fz * DASH_SPEED * dt);
    dust.burst(me.pos.clone().setY(0.3), 2, { speed: 1, up: 0.5, colors: ["#ffffff", me.color], life: 0.4 });
    if (racing) for (const r of remotes.values()) {
      if (me.shoved.has(r.id) || r.finished) continue;
      if (settings.shove && r.f === curF && r.pos.distanceTo(me.pos) < 1.25) {
        me.shoved.add(r.id);
        send({ t: "shove", target: r.id, dx: fx, dz: fz });
        audio.play("bump"); addShake(0.2, 0.2);
        paper.burst(r.pos.clone().setY(1), 16, { speed: 4, up: 4 });
      }
    }
    me.anim = 2;
  } else if (v.L > 0.05 || me.slipping) {
    const sp = SPEED * (0.35 + 0.65 * v.L) * (me.boost > 0 ? 1.45 : 1);
    const slip = onPuddle(world, me.pos.x, me.pos.z);
    if (slip && !me.slipping && racing) say("Huiii! Rutschgefahr!", "⚠️", 1200);
    me.slipping = slip;
    v3.set(v.x * sp, 0, v.z * sp);
    if (slip) { me.vel.lerp(v3, Math.min(1, dt * 1.1)); if (me.vel.length() < 2.5 && me.vel.lengthSq() > 0.01) me.vel.setLength(2.5); }
    else me.vel.copy(v3);
    if (!moveWithCollision(world, me.pos, me.vel.x * dt, me.vel.z * dt)) me.vel.multiplyScalar(0.4);
    if (v.L <= 0.05) { me.anim = 0; me.dustT = 1; }
    const target = v.L > 0.05 ? Math.atan2(v.x, v.z) : me.ry;
    let d = target - me.ry; d = Math.atan2(Math.sin(d), Math.cos(d));
    me.ry += d * Math.min(1, dt * 14);
    me.anim = v.L > 0.6 ? 2 : 1;
    me.dustT -= dt;
    if (me.anim === 2 && me.dustT <= 0) { me.dustT = me.boost > 0 ? 0.05 : 0.14; dust.burst(me.pos.clone().setY(0.1), me.boost > 0 ? 3 : 1, { speed: 0.6, up: 0.4, colors: me.boost > 0 ? ["#ff9a3c", "#ffd23f"] : ["#d8d2c0"], life: 0.5, scale: 0.8 }); }
  } else me.anim = 0;
  me.char.setAnim(me.anim);
  me.char.update(dt, me.anim > 0);
  me.char.root.position.copy(me.pos);
  me.char.root.rotation.y = me.ry;
  me.char.root.rotation.z = me.stun > 0 ? Math.sin(performance.now() / 50) * 0.15 : 0;
  me.ring.position.set(me.pos.x, 0.04, me.pos.z);
  me.ring.material.opacity = me.invuln > 0 ? 0.3 + 0.6 * (Math.sin(performance.now() / 60) > 0) : 0.9;
  me.label.position.set(me.pos.x, 2.25, me.pos.z);
  me.shieldMesh.visible = me.shield > 0;
  me.shieldMesh.position.set(me.pos.x, 0.9, me.pos.z);
  playerLight.position.set(me.pos.x, 2.2, me.pos.z);
  renderPowerHud();

  // stairs (also usable in the lobby)
  if (!frozen && me.stairCd <= 0) {
    for (const st of world.stairs) if (st.pos.distanceTo(me.pos) < 0.85) { useStair(st); return; }
  }

  // guidance
  const tgt = racing && !me.finished ? targetFor() : null;
  if (tgt) {
    const goal = tgt.front;
    v3.subVectors(goal, me.pos); v3.y = 0;
    const d = v3.length();
    arrow.visible = d > 2.6;
    const col = tgt.stair ? "#4fd1ff" : me.stamps.length === 5 ? "#3f6" : "#ffd23f";
    if (arrow.visible) { v3.normalize(); arrow.position.set(me.pos.x + v3.x * 1.25, 0.08, me.pos.z + v3.z * 1.25); arrow.rotation.y = Math.atan2(v3.x, v3.z) + Math.PI; arrow.material.color.set(col); }
    beacon.visible = true; beacon.position.set(tgt.pos.x, 7, tgt.pos.z); beacon.material.color.set(col);
  } else { arrow.visible = false; beacon.visible = false; }

  if (!racing || me.finished) { ui.progress.classList.add("hidden"); return; }

  // power-ups
  const now = serverNow();
  for (const pu of world.powerups) {
    if (now < pu.takenUntil) continue;
    if (pu.pos.distanceTo(me.pos) < 1.0) {
      pu.takenUntil = now + 15000;
      audio.play("powerup");
      paper.burst(pu.pos.clone().setY(0.8), 16, { speed: 3, up: 4, colors: pu.type === "coffee" ? ["#ff9a3c", "#ffd23f", "#7a4a2a"] : ["#4fd1ff", "#ffffff", "#ffd23f"], life: 1 });
      if (pu.type === "coffee") { me.boost = 5; audio.play("slurp"); say("Kaffee! 5 Sekunden Turbo.", "☕", 1600); }
      else { me.shield = 20; say("Termin-Bestätigung! Schützt einmal vor dem Personal.", "🎫", 2000); }
    }
  }

  // counters
  let near = null;
  for (const s of world.stations) if (!me.stamps.includes(s.n) && s.front.distanceTo(me.pos) < FRONT_R) { near = s; break; }
  if (near && me.stun <= 0) {
    if (me.stampAt !== near) { me.stampAt = near; me.stampProgress = 0; }
    me.stampProgress += dt * (evKey === "rush" ? 2.2 : 1);
    ui.progress.classList.remove("hidden");
    ui.progressFill.style.width = `${Math.min(100, (me.stampProgress / STAMP_TIME) * 100)}%`;
    ui.progressText.textContent = `${near.name}: Formular ausfüllen…`;
    if (me.stampProgress >= STAMP_TIME) {
      me.stamps.push(near.n);
      me.stampProgress = 0; me.stampAt = null;
      audio.play("stamp_sfx");
      const li = Math.floor(Math.random() * audio.LINES.stamp.length);
      setTimeout(() => audio.play(`stamp_${li}`), 250);
      stampSlam(near.name.toUpperCase(), `GESTEMPELT ✓ ${me.stamps.length}/5`);
      addShake(0.3, 0.3);
      paper.burst(near.front.clone().setY(1.2), 36, { speed: 5, up: 6, colors: ["#ffffff", "#f6f0dc", "#d7263d", "#ffd23f"] });
      renderStamps();
      send({ t: "stamp", n: near.n });
      if (me.stamps.length === 5) setTimeout(() => banner("<b>Alle 5 Stempel!</b>Ab zum Schalter Aufenthaltstitel 🏁", 2600), 900);
    }
  } else { me.stampAt = null; me.stampProgress = 0; ui.progress.classList.add("hidden"); }

  // exit
  if (me.stamps.length === 5 && world.exit && world.exit.front.distanceTo(me.pos) < FRONT_R) {
    me.finished = true;
    audio.play("win");
    const ms = serverNow() - raceStart;
    stampSlam("GENEHMIGT", `AUFENTHALTSTITEL · ${fmt(ms)}`);
    addShake(0.5, 0.5);
    for (let k = 0; k < 3; k++) setTimeout(() => paper.burst(me.pos.clone().setY(1.5), 40, { speed: 7, up: 8, colors: ["#d7263d", "#ffd23f", "#2fb4ff", "#2ecc71", "#ffffff"], life: 2 }), k * 180);
    send({ t: "finish" });
    if (solo) { results = [{ id: me.id, name: me.name, color: me.color, ms }]; phase = "results"; phaseEndsAt = serverNow() + 6000; setTimeout(() => onPhaseChange("race"), 1500); }
  }
}

function updateRemotes(dt) {
  const k = 1 - Math.exp(-dt * 12);
  for (const r of remotes.values()) {
    r.pos.lerp(r.target, k);
    let d = r.tRy - r.ry; d = Math.atan2(Math.sin(d), Math.cos(d)); r.ry += d * k;
    if (r.char) { r.char.setAnim(r.anim); r.char.update(dt, r.anim > 0); r.char.root.position.copy(r.pos); r.char.root.rotation.y = r.ry; }
    r.ring.position.set(r.pos.x, 0.04, r.pos.z);
    r.label.position.set(r.pos.x, 2.25, r.pos.z);
  }
}

function updateEvents(dt) {
  if (phase !== "race" || !world) { setDark(0, dt); return; }
  const t = raceT();
  for (const e of eventSchedule()) {
    const ev = EVENTS[e.key];
    if (t >= e.at && !eventsFired.has(e.key) && t < e.at + ev.dur) {
      eventsFired.add(e.key);
      banner(`<b>${ev.name}!</b>${ev.desc}`, 3200, "event");
      audio.play(ev.voice);
      if (ev.sfx) audio.play(ev.sfx, { vol: 0.6 });
      addShake(0.2, 0.3);
    }
  }
  const cur = activeEvent(t);
  curEvent = cur;
  if (cur) { ui.eventTag.classList.remove("hidden"); ui.eventTag.textContent = `${EVENTS[cur.key].name} · ${Math.ceil(cur.at + EVENTS[cur.key].dur - t)}s`; }
  else ui.eventTag.classList.add("hidden");
  setDark(cur?.key === "blackout" ? 1 : 0, dt);
  if (cur?.key === "alarm") hemi.color.setRGB(1, 0.75 + 0.25 * Math.sin(t * 8), 0.75 + 0.25 * Math.sin(t * 8));
  else hemi.color.set("#fff8e8");
  // last 30 seconds
  const left = phaseEndsAt - serverNow();
  if (left < 30_000 && !last30Played) { last30Played = true; audio.play("last30"); audio.music("music_final", 0.32); banner("<b>Noch 30 Sekunden!</b>Die Behörde schließt gleich", 2400, "event"); }
}
let darkK = 0;
function setDark(target, dt) {
  darkK += (target - darkK) * Math.min(1, dt * 4);
  hemi.intensity = 1.4 * (1 - darkK * 0.88);
  sun.intensity = 2.0 * (1 - darkK * 0.92);
  playerLight.intensity = darkK * 40;
}

function updateHud() {
  const now = serverNow();
  if (phase === "countdown") {
    const n = Math.ceil((raceStart - now) / 1000);
    if (n !== lastCount && n > 0) { lastCount = n; center(`${n}<small>Behörde öffnet…</small>`); audio.play("tick"); }
    ui.timer.textContent = fmt(raceMs());
  } else if (phase === "race") {
    const left = phaseEndsAt - now;
    ui.timer.textContent = fmt(left);
    ui.timer.classList.toggle("urgent", left < 30_000);
  } else if (phase === "results") { ui.timer.textContent = "Ende"; ui.timer.classList.remove("urgent"); }
}

const camPos = new THREE.Vector3(0, 40, 20);
const camLook = new THREE.Vector3();
function updateCamera(dt) {
  const portrait = camera.aspect < 1;
  if (IS_HOST || !me.char) {
    const span = world ? Math.max(world.W * 2 / Math.max(camera.aspect, 0.6), world.H * 2) : 40;
    camPos.lerp(v3.set(0, span * (portrait ? 1.5 : 1.15), span * 0.6), 1 - Math.exp(-dt * 3));
    camLook.lerp(new THREE.Vector3(0, 0, 1), 1 - Math.exp(-dt * 3));
  } else {
    const zoom = phase === "countdown" ? 0.8 : 1;
    const h = (portrait ? 19 : 13) * zoom, b = (portrait ? 11 : 9) * zoom;
    camPos.lerp(v3.set(me.pos.x, h, me.pos.z + b), 1 - Math.exp(-dt * 6));
    camLook.lerp(me.pos, 1 - Math.exp(-dt * 8));
  }
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  applyShake(camera, dt);
}

// ---------- loop ----------
const clock = new THREE.Clock();
let loopErr = 0, hostFloorT = 0;
function loop() {
  requestAnimationFrame(loop);
  try { frame(); } catch (e) { if (loopErr++ < 5) console.error("frame error", e); }
}
let pr = renderer.getPixelRatio(), fpsAcc = 0, fpsN = 0, fpsT = 0;
function adaptResolution(rawDt) {
  fpsAcc += rawDt; fpsN++;
  if (fpsAcc < 2) return;
  const fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0;
  if (document.hidden) return;
  if (fps < 45 && pr > 1) { pr = Math.max(1, pr - 0.25); renderer.setPixelRatio(pr); resize(); }
  else if (fps > 58 && pr < Math.min(devicePixelRatio, TOUCH ? 1.5 : 2) && performance.now() - fpsT > 10000) { fpsT = performance.now(); pr = Math.min(pr + 0.25, Math.min(devicePixelRatio, TOUCH ? 1.5 : 2)); renderer.setPixelRatio(pr); resize(); }
}
function frame() {
  const raw = clock.getDelta();
  adaptResolution(raw);
  const dt = Math.min(raw, 0.05);
  if (world && !paused) {
    if (solo) soloTick();
    if (IS_HOST && bld && bld.F > 1 && performance.now() - hostFloorT > 7000) { hostFloorT = performance.now(); setFloor((curF + 1) % bld.F); }
    updateEvents(dt);
    updateClerks(dt);
    updateMe(dt);
    updateRemotes(dt);
    updateHud();
    const t = performance.now() / 1000;
    for (const s of world.stations) { s.holder.rotation.y = t * 1.6; s.holder.position.y = 2.1 + Math.sin(t * 2 + s.n) * 0.12; }
    const now = serverNow();
    for (const pu of world.powerups) {
      const on = now >= pu.takenUntil && phase !== "countdown";
      pu.holder.visible = on;
      pu.holder.rotation.y = t * 2; pu.holder.position.y = 0.6 + Math.sin(t * 3 + pu.pos.x) * 0.12;
    }
    beacon.material.opacity = 0.12 + Math.sin(t * 3) * 0.05;
    if (ws && me.char && performance.now() - lastSend > 66) {
      lastSend = performance.now();
      send({ t: "s", x: me.pos.x, z: me.pos.z, ry: me.ry, a: me.anim, st: me.stamps.length, f: curF });
    }
    if (performance.now() - mmLast > 66) { mmLast = performance.now(); drawMinimap(); }
  }
  paper.update(dt); dust.update(dt);
  updateCamera(dt);
  renderer.render(scene, camera);
}

// ---------- boot ----------
async function boot() {
  center("<small>Lade Behörde…</small>");
  await ensureWorld(seed);
  center("");
  if (IS_HOST) { ui.join.classList.add("hidden"); hostJoin(); }
}
loop();
boot();

async function hostJoin() {
  me.name = "HOST";
  makeQR();
  ui.hud.classList.remove("hidden");
  ui.minimap.classList.remove("hidden");
  try { await connect(); } catch { center("<small>Server nicht erreichbar</small>"); }
}

async function startGame(isSolo) {
  audio.unlock();
  audio.preload(["stamp_sfx", "ding", "buzz", "win", "timeup", "countdown", "music", "music_final", "whoosh", "bump", "powerup", "slurp", "alert", "last30", "ev_lunch", "ev_blackout", "ev_alarm", "ev_rush", "alarm_sfx", "blackout_sfx", "ambience",
    ...audio.LINES.hit.map((_, i) => `hit_${i}`), ...audio.LINES.stamp.map((_, i) => `stamp_${i}`), ...audio.LINES.spot.map((_, i) => `spot_${i}`)]);
  audio.music("music", 0.25);
  audio.ambience("ambience", 0.14);
  me.name = (ui.name.value.trim() || "Gast" + Math.floor(Math.random() * 90 + 10)).slice(0, 16);
  try { localStorage.setItem("sr_name", me.name); } catch {}
  ui.join.classList.add("hidden");
  ui.hud.classList.remove("hidden");
  ui.minimap.classList.remove("hidden");
  if (TOUCH) ui.dashBtn.classList.remove("hidden");
  ui.menuBtn.classList.remove("hidden");
  while (!world) await new Promise((r) => setTimeout(r, 100));
  await spawnMe();
  me.pos.copy(world.spawn);
  makeQR();
  if (!isSolo) {
    try { await connect(); return; } catch { say("Server nicht erreichbar – Solo-Modus", "⚠️", 3000); }
  }
  solo = true; me.id = "solo";
  ui.lobby.classList.add("hidden");
  soloStart();
}
ui.joinBtn.onclick = () => startGame(false);
ui.soloBtn.onclick = () => startGame(true);
ui.name.addEventListener("keydown", (e) => { if (e.key === "Enter") startGame(false); });
ui.startBtn.onclick = () => { audio.unlock(); send({ t: "start" }); };

// ---------- pause menu & custom game ----------
const menuOpen = () => !ui.menu.classList.contains("hidden") || !ui.custom.classList.contains("hidden");
function toggleMenu(force) {
  const open = force ?? ui.menu.classList.contains("hidden");
  ui.menu.classList.toggle("hidden", !open);
  keys.clear();
  if (open) {
    const v = audio.getVolumes();
    ui.volMusic.value = Math.round(v.music * 100); ui.volSfx.value = Math.round(v.sfx * 100);
    const canPause = solo && (phase === "race" || phase === "countdown");
    ui.menuNote.textContent = solo ? "Spiel pausiert." : "Online-Runde läuft weiter!";
    ui.customBtn.classList.toggle("hidden", !(solo || phase === "lobby" || phase === "results"));
    if (canPause && !paused) { paused = true; pauseStart = Date.now(); }
  } else if (paused) {
    const shift = Date.now() - pauseStart;
    raceStart += shift; phaseEndsAt += shift;
    paused = false;
  }
}
function renderSettings() {
  ui.setDuration.value = String(settings.duration); ui.setClerks.value = settings.clerks; ui.setSize.value = settings.size;
  ui.setGuards.checked = settings.guards; ui.setEvents.checked = settings.events; ui.setPowerups.checked = settings.powerups; ui.setShove.checked = settings.shove;
  const lbl = { few: "wenig", normal: "normal", many: "viel" }[settings.clerks];
  const size = { small: "klein", normal: "normal", large: "groß" }[settings.size];
  const off = [!settings.guards && "ohne Wachmann", !settings.events && "ohne Ereignisse", !settings.powerups && "ohne Power-ups", !settings.shove && "ohne Drängeln"].filter(Boolean);
  ui.settingsSummary.textContent = `${fmt(settings.duration * 1000)} · Personal ${lbl} · Behörde ${size}${off.length ? " · " + off.join(", ") : ""}`;
}
function readSettings() {
  return {
    duration: Number(ui.setDuration.value), clerks: ui.setClerks.value, size: ui.setSize.value,
    guards: ui.setGuards.checked, events: ui.setEvents.checked, powerups: ui.setPowerups.checked, shove: ui.setShove.checked,
  };
}
function openCustom() { renderSettings(); ui.menu.classList.add("hidden"); ui.custom.classList.remove("hidden"); }
function closeCustom() {
  ui.custom.classList.add("hidden");
  const next = readSettings();
  if (solo) { settings = { ...settings, ...next }; renderSettings(); }
  else send({ t: "settings", settings: next });
  if (paused) toggleMenu(true);
}
ui.menuBtn.onclick = () => { audio.unlock(); toggleMenu(); };
ui.resumeBtn.onclick = () => toggleMenu(false);
ui.leaveBtn.onclick = () => location.reload();
ui.customBtn.onclick = openCustom;
ui.lobbyCustomBtn.onclick = openCustom;
ui.customDone.onclick = closeCustom;
ui.volMusic.oninput = () => audio.setVolumes({ music: ui.volMusic.value / 100 });
ui.volSfx.oninput = () => audio.setVolumes({ sfx: ui.volSfx.value / 100 });
renderSettings();

// ---------- avatar editor ----------
let preview = null;
function chipRow(el, list, keyName) {
  el.innerHTML = list.map(([v, label]) => `<button class="avChip${me.avatar[keyName] === v ? " on" : ""}" data-v="${v}">${label}</button>`).join("");
  el.onclick = (e) => { const b = e.target.closest("button"); if (!b) return; me.avatar[keyName] = b.dataset.v; renderAvatarUI(); };
}
function renderAvatarUI() {
  me.avatar = sanitize(me.avatar);
  const mi = MODELS.findIndex((m) => m.id === me.avatar.m);
  ui.avModel.textContent = `${MODELS[mi].name} (${mi + 1}/${MODELS.length})`;
  ui.avColors.innerHTML = COLORS.map((c) => `<button class="sw${me.avatar.c === c ? " on" : ""}" data-c="${c || ""}" style="background:${c || "conic-gradient(#ff7a1a,#2fb4ff,#2ecc71,#ffd23f,#ff7a1a)"}" title="${c ? c : "Original"}">${c ? "" : "∅"}</button>`).join("");
  ui.avColors.onclick = (e) => { const b = e.target.closest("button"); if (!b) return; me.avatar.c = b.dataset.c || null; renderAvatarUI(); };
  chipRow(ui.avHats, HATS, "hat"); chipRow(ui.avGlasses, GLASSES, "gl"); chipRow(ui.avBeards, BEARDS, "br");
  preview?.set(me.avatar);
}
function openAvatar() {
  audio.unlock();
  ui.avatarScreen.classList.remove("hidden");
  if (!preview) preview = new Preview(ui.avatarPreview);
  preview.start();
  renderAvatarUI();
}
function closeAvatar() {
  ui.avatarScreen.classList.add("hidden");
  preview?.stop();
  saveAvatar(me.avatar);
}
const stepModel = (d) => { const i = MODELS.findIndex((m) => m.id === me.avatar.m); me.avatar.m = MODELS[(i + d + MODELS.length) % MODELS.length].id; renderAvatarUI(); };
ui.avatarBtn.onclick = openAvatar;
ui.avDone.onclick = closeAvatar;
ui.avPrev.onclick = () => stepModel(-1);
ui.avNext.onclick = () => stepModel(1);

// debug hook for testing
window.__sr = { setFloor: (f) => setFloor(f), get bld() { return bld; }, get curF() { return curF; }, camera, renderer, me, get phase() { return phase; }, get clerks() { return clerks; }, remotes, get world() { return world; }, get seed() { return seed; }, activeEvent: () => activeEvent(raceT()), skip: (sec) => { raceStart -= sec * 1000; phaseEndsAt -= sec * 1000; }, schedule: () => eventSchedule() };
