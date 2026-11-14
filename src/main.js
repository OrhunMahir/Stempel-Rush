import * as THREE from "three";
import QRCode from "qrcode";
import { buildWorld, patrolPos, moveWithCollision, STATIONS } from "./world.js";
import { makeCharacter, textSprite } from "./assets.js";
import * as audio from "./audio.js";

// ---------- constants ----------
const SPEED = 5.2;
const STAMP_TIME = 1.1; // s standing at a counter
const STATION_R = 2.35;
const HIT_R = 0.95;
const RACE_MS = 150_000;
const params = new URLSearchParams(location.search);
const ROOM = (params.get("room") || "MUC").toUpperCase();
const IS_HOST = params.has("host");
if (IS_HOST) document.body.classList.add("host");
// Room server: same origin when served by our Worker (or wrangler dev), otherwise (itch.io etc.) the Cloudflare Worker.
const CANONICAL = "stempel-rush.dalliagac.workers.dev";
const SELF_HOSTED = location.hostname === CANONICAL || location.hostname === "localhost" || location.hostname === "127.0.0.1" || /^\d+\.\d+\.\d+\.\d+$/.test(location.hostname);
const WS_URL = SELF_HOSTED
  ? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?room=${ROOM}`
  : `wss://${CANONICAL}/ws?room=${ROOM}`;
const JOIN_BASE = SELF_HOSTED ? location.origin : `https://${CANONICAL}`;

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const ui = {
  join: $("join"), name: $("name"), joinBtn: $("joinBtn"), soloBtn: $("soloBtn"),
  hud: $("hud"), stamps: $("stamps"), timer: $("timer"), info: $("info"),
  bubble: $("bubble"), bubbleText: $("bubbleText"), center: $("center"),
  progress: $("progress"), progressFill: $("progressFill"), progressText: $("progressText"),
  lobby: $("lobby"), playerList: $("playerList"), startBtn: $("startBtn"), qr: $("qr"), joinUrl: $("joinUrl"),
  results: $("results"), resultList: $("resultList"), resultsTitle: $("resultsTitle"), resultsNext: $("resultsNext"),
  joy: $("joy"), joyNub: $("joyNub"),
};
for (let i = 1; i <= 5; i++) { const d = document.createElement("div"); d.className = "slot"; d.textContent = i; d.title = STATIONS[i]; ui.stamps.appendChild(d); }
try { ui.name.value = localStorage.getItem("sr_name") || ""; } catch {}

// ---------- three ----------
const canvas = $("c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color("#1d2433");
scene.fog = IS_HOST ? null : new THREE.Fog("#1d2433", 40, 80);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
scene.add(new THREE.HemisphereLight("#fff8e8", "#4a4f60", 1.4));
const sun = new THREE.DirectionalLight("#fff3d6", 2.0);
sun.position.set(-12, 30, 14);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 20, bottom: -20, near: 1, far: 80 });
scene.add(sun);
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

// ---------- game state ----------
let world = null;
const me = {
  id: null, name: "", color: "#ff7a1a", char: null, label: null, ring: null,
  pos: new THREE.Vector3(), ry: 0, anim: 0, stamps: [], stun: 0, invuln: 0, finished: false, stampProgress: 0, stampAt: null,
};
const remotes = new Map();
const clerks = [];
let phase = "offline"; // offline | lobby | countdown | race | results
let raceStart = 0, phaseEndsAt = 0, serverOffset = 0, results = [];
let ws = null, solo = false, lastSend = 0, lastCount = -1;
const serverNow = () => Date.now() + serverOffset;

// ---------- input ----------
const keys = new Set();
addEventListener("keydown", (e) => { if (document.activeElement === ui.name) return; keys.add(e.key.toLowerCase()); });
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
addEventListener("pointerup", endJoy);
addEventListener("pointercancel", endJoy);

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
  for (const s of world?.stations ?? []) {
    const has = me.stamps.includes(s.n);
    s.holder.visible = !has;
    s.ring.material.color.set(has ? "#3a3f4a" : "#ffd23f");
  }
  if (world?.exit) world.exit.glow.material.opacity = me.stamps.length === 5 ? 0.85 : 0;
}
const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

function makeQR() {
  const url = `${JOIN_BASE}/?room=${ROOM}`;
  ui.joinUrl.textContent = url.replace(/^https?:\/\//, "");
  QRCode.toCanvas(ui.qr, url, { margin: 1, width: IS_HOST ? 440 : 260 });
}

// ---------- characters ----------
async function spawnMe() {
  me.char = await makeCharacter("player", me.color);
  scene.add(me.char.root);
  me.ring = colorRing(me.color);
  scene.add(me.ring);
  me.label = textSprite(me.name || "Du", { bg: me.color, scale: 0.8 });
  scene.add(me.label);
}
function colorRing(color) {
  const r = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.62, 32), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
  r.rotation.x = -Math.PI / 2;
  return r;
}
async function ensureRemote(id, name, color) {
  if (remotes.has(id)) return remotes.get(id);
  const r = { id, name, color, pos: new THREE.Vector3(), target: new THREE.Vector3(), ry: 0, tRy: 0, anim: 0, char: null, label: null, ring: colorRing(color), stamps: 0, host: false, loading: true };
  remotes.set(id, r);
  scene.add(r.ring);
  r.label = textSprite(name, { bg: color, scale: 0.8 });
  scene.add(r.label);
  makeCharacter("player", color).then((ch) => {
    if (!remotes.has(id)) return;
    r.char = ch; scene.add(ch.root); r.loading = false;
    ch.root.traverse((o) => { if (o.isMesh && o.material) { o.material = o.material.clone(); o.material.color?.lerp(new THREE.Color(color), 0.35); } });
  });
  return r;
}
function removeRemote(id) {
  const r = remotes.get(id);
  if (!r) return;
  if (r.char) scene.remove(r.char.root);
  scene.remove(r.label, r.ring);
  remotes.delete(id);
}

async function spawnClerks() {
  for (const p of world.patrols) {
    const ch = await makeCharacter("clerk", "#7a5230", 1.8);
    ch.setAnim(1);
    scene.add(ch.root);
    clerks.push({ patrol: p, char: ch, pos: new THREE.Vector3(), ry: 0 });
  }
}

// ---------- networking ----------
function connect() {
  return new Promise((resolve, reject) => {

    const sock = new WebSocket(WS_URL);
    let opened = false;
    const to = setTimeout(() => { if (!opened) { sock.close(); reject(new Error("timeout")); } }, 5000);
    sock.onopen = () => { opened = true; clearTimeout(to); ws = sock; sock.send(JSON.stringify({ t: "hello", name: me.name, host: IS_HOST })); resolve(); };
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
      for (const [id, name, color, x, z, ry, a, st, fin, host] of m.ps) {
        seen.add(id);
        if (id === me.id || host) continue;
        ensureRemote(id, name, color).then((r) => { r.target.set(x, 0, z); r.tRy = ry; r.anim = a; r.stamps = st; r.finished = !!fin; if (r.pos.lengthSq() === 0) r.pos.set(x, 0, z); });
      }
      for (const id of [...remotes.keys()]) if (!seen.has(id)) removeRemote(id);
      updateLobbyList(m.ps);
      break;
    }
    case "left": removeRemote(m.id); break;
    case "finish":
      if (m.id !== me.id) say(`${m.name} hat den Aufenthaltstitel! (#${m.place})`, "🏁", 2500);
      break;
  }
}

function applyPhase(m) {
  const prev = phase;
  phase = m.phase; raceStart = m.raceStart; phaseEndsAt = m.phaseEndsAt; results = m.results || [];
  if (m.now) serverOffset = m.now - Date.now();
  onPhaseChange(prev);
}

let lobbyPs = [];
function updateLobbyList(ps) {
  lobbyPs = ps;
  const racers = ps.filter((p) => !p[9]);
  ui.playerList.innerHTML = racers.map((p) => `<span class="chip" style="background:${p[2]}">${escapeHtml(p[1])}${p[0] === me.id ? " (du)" : ""}</span>`).join("") || "<em>Noch niemand da…</em>";
  if (phase === "race") {
    const place = racers.filter((p) => p[8]).length;
    ui.info.textContent = `${racers.length} im Rennen · ${place} fertig`;
  } else ui.info.textContent = `${racers.length} im Wartebereich`;
}
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- phases ----------
function resetMeForRace() {
  me.stamps = []; me.finished = false; me.stun = 0; me.invuln = 0; me.stampProgress = 0;
  const s = world.spawn;
  me.pos.set(s.x + (Math.random() * 6), 0, s.z + Math.random() * 5);
  renderStamps();
}

function onPhaseChange(prev) {
  ui.results.classList.add("hidden");
  ui.lobby.classList.toggle("hidden", !(phase === "lobby"));
  if (phase === "lobby") {
    center("");
    ui.timer.textContent = "--:--";
    ui.timer.classList.remove("urgent");
  }
  if (phase === "countdown") {
    resetMeForRace();
    lastCount = -1;
    audio.play("countdown");
  }
  if (phase === "race" && prev !== "race") {
    center("LOS!<small>Hol dir alle 5 Stempel</small>", 1400);
    audio.play("ding");
    audio.musicVolume(0.35);
  }
  if (phase === "results") showResults();
}

function showResults() {
  center("");
  ui.results.classList.remove("hidden");
  const mine = results.findIndex((r) => r.id === me.id);
  ui.resultsTitle.textContent = me.finished ? (mine === 0 ? "1. Platz! 🏆" : `Platz ${mine + 1}`) : "Geschlossen!";
  ui.resultList.innerHTML = results.map((r) => `<li><span class="dot" style="background:${r.color}"></span>${escapeHtml(r.name)} — ${r.ms ? fmt(r.ms) + " ✅" : (r.stamps ?? 0) + "/5 Stempel"}</li>`).join("") || "<li>Niemand hat es geschafft. Typisch.</li>";
  ui.resultsNext.textContent = solo ? "Gleich geht's weiter…" : "Zurück in den Wartebereich in ein paar Sekunden…";
  if (!me.finished && !IS_HOST) audio.play("timeup");
}

// Solo mode drives its own phase machine.
function soloStart() {
  phase = "countdown"; raceStart = serverNow() + 3500; phaseEndsAt = raceStart; results = [];
  onPhaseChange("lobby");
}
function soloTick() {
  const now = serverNow();
  if (phase === "countdown" && now >= raceStart) { const p = phase; phase = "race"; phaseEndsAt = raceStart + RACE_MS; onPhaseChange(p); }
  else if (phase === "race" && now >= phaseEndsAt) { phase = "results"; results = [{ id: me.id, name: me.name, color: me.color, ms: 0, stamps: me.stamps.length }]; phaseEndsAt = now + 6000; onPhaseChange("race"); }
  else if (phase === "results" && now >= phaseEndsAt) { soloStart(); }
}

// ---------- gameplay ----------
const tmp = { pos: new THREE.Vector3(), ry: 0 };
function updateClerks(dt) {
  const t = (phase === "race" || phase === "countdown" ? serverNow() - raceStart : serverNow()) / 1000;
  for (const c of clerks) {
    patrolPos(c.patrol, t, tmp);
    c.pos.copy(tmp.pos);
    c.char.root.position.copy(c.pos);
    c.ry = tmp.ry;
    c.char.root.rotation.y = c.ry;
    c.char.update(dt);
  }
}

function updateMe(dt) {
  if (!me.char || IS_HOST) return;
  const frozen = phase === "countdown" || phase === "results" || me.finished;
  me.stun = Math.max(0, me.stun - dt);
  me.invuln = Math.max(0, me.invuln - dt);
  const v = frozen || me.stun > 0 ? { x: 0, z: 0, L: 0 } : inputVec();
  if (v.L > 0.05) {
    const sp = SPEED * (0.35 + 0.65 * v.L);
    moveWithCollision(world, me.pos, v.x * sp * dt, v.z * sp * dt);
    const target = Math.atan2(v.x, v.z);
    let d = target - me.ry; d = Math.atan2(Math.sin(d), Math.cos(d));
    me.ry += d * Math.min(1, dt * 14);
    me.anim = v.L > 0.6 ? 2 : 1;
  } else me.anim = 0;
  me.char.setAnim(me.anim);
  me.char.update(dt, me.anim > 0);
  me.char.root.position.copy(me.pos);
  me.char.root.rotation.y = me.ry;
  // stun wobble
  me.char.root.rotation.z = me.stun > 0 ? Math.sin(performance.now() / 50) * 0.15 : 0;
  me.ring.position.set(me.pos.x, 0.04, me.pos.z);
  me.ring.material.opacity = me.invuln > 0 ? 0.3 + 0.6 * (Math.sin(performance.now() / 60) > 0) : 0.9;
  me.label.position.set(me.pos.x, 2.25, me.pos.z);

  if (phase !== "race" || me.finished) { ui.progress.classList.add("hidden"); return; }

  // clerk collisions
  if (me.invuln <= 0) {
    for (const c of clerks) {
      if (c.pos.distanceTo(me.pos) < HIT_R) {
        const lineIdx = Math.floor(Math.random() * audio.LINES.hit.length);
        say(audio.LINES.hit[lineIdx]);
        audio.play(`hit_${lineIdx}`);
        audio.play("buzz", { vol: 0.5 });
        me.stun = 1.2; me.invuln = 3.0; me.stampProgress = 0;
        const lost = me.stamps.pop();
        if (lost) setTimeout(() => say(`Stempel ${lost} ungültig! Nochmal zu ${STATIONS[lost]}.`, "📄", 2200), 1300);
        renderStamps();
        const push = me.pos.clone().sub(c.pos).setY(0).normalize().multiplyScalar(1.2);
        moveWithCollision(world, me.pos, push.x, push.z);
        send({ t: "hit", line: lineIdx });
        break;
      }
    }
  }

  // counters
  let near = null;
  for (const s of world.stations) {
    if (!me.stamps.includes(s.n) && s.pos.distanceTo(me.pos) < STATION_R) { near = s; break; }
  }
  if (near && me.stun <= 0) {
    if (me.stampAt !== near) { me.stampAt = near; me.stampProgress = 0; }
    me.stampProgress += dt;
    ui.progress.classList.remove("hidden");
    ui.progressFill.style.width = `${Math.min(100, (me.stampProgress / STAMP_TIME) * 100)}%`;
    ui.progressText.textContent = `${near.name}: Formular ausfüllen…`;
    if (me.stampProgress >= STAMP_TIME) {
      me.stamps.push(near.n);
      me.stampProgress = 0; me.stampAt = null;
      audio.play("stamp_sfx");
      const li = Math.floor(Math.random() * audio.LINES.stamp.length);
      audio.play(`stamp_${li}`);
      say(audio.LINES.stamp[li], "🧾", 1600);
      renderStamps();
      send({ t: "stamp", n: near.n });
      if (me.stamps.length === 5) setTimeout(() => say("Alle Stempel! Ab zum Schalter Aufenthaltstitel!", "🏁", 2600), 1400);
    }
  } else {
    me.stampAt = null; me.stampProgress = 0;
    ui.progress.classList.add("hidden");
  }

  // exit
  if (me.stamps.length === 5 && world.exit.pos.distanceTo(me.pos) < STATION_R) {
    me.finished = true;
    audio.play("win");
    const ms = serverNow() - raceStart;
    center(`GENEHMIGT!<small>${fmt(ms)}</small>`, 3000);
    send({ t: "finish" });
    if (solo) { results = [{ id: me.id, name: me.name, color: me.color, ms }]; phase = "results"; phaseEndsAt = serverNow() + 6000; setTimeout(() => onPhaseChange("race"), 1500); }
  }
}

function updateRemotes(dt) {
  const k = 1 - Math.exp(-dt * 12);
  for (const r of remotes.values()) {
    r.pos.lerp(r.target, k);
    let d = r.tRy - r.ry; d = Math.atan2(Math.sin(d), Math.cos(d)); r.ry += d * k;
    if (r.char) {
      r.char.setAnim(r.anim); r.char.update(dt, r.anim > 0);
      r.char.root.position.copy(r.pos); r.char.root.rotation.y = r.ry;
    }
    r.ring.position.set(r.pos.x, 0.04, r.pos.z);
    r.label.position.set(r.pos.x, 2.25, r.pos.z);
  }
}

function updateHud() {
  const now = serverNow();
  if (phase === "countdown") {
    const n = Math.ceil((raceStart - now) / 1000);
    if (n !== lastCount && n > 0) { lastCount = n; center(`${n}<small>Behörde öffnet…</small>`); audio.play("tick"); }
    ui.timer.textContent = fmt(RACE_MS);
  } else if (phase === "race") {
    const left = phaseEndsAt - now;
    ui.timer.textContent = fmt(left);
    ui.timer.classList.toggle("urgent", left < 20_000);
  } else if (phase === "results" && !ui.results.classList.contains("hidden")) {
    // nothing
  }
}

const camPos = new THREE.Vector3(0, 40, 20);
const camLook = new THREE.Vector3();
function updateCamera(dt) {
  const portrait = camera.aspect < 1;
  if (IS_HOST || !me.char) {
    camPos.lerp(new THREE.Vector3(0, portrait ? 62 : 38, portrait ? 26 : 22), 1 - Math.exp(-dt * 3));
    camLook.lerp(new THREE.Vector3(0, 0, 1), 1 - Math.exp(-dt * 3));
  } else {
    const h = portrait ? 19 : 13, b = portrait ? 11 : 9;
    camPos.lerp(new THREE.Vector3(me.pos.x, h, me.pos.z + b), 1 - Math.exp(-dt * 6));
    camLook.lerp(me.pos, 1 - Math.exp(-dt * 8));
  }
  camera.position.copy(camPos);
  camera.lookAt(camLook);
}

// ---------- loop ----------
const clock = new THREE.Clock();
function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (world) {
    if (solo) soloTick();
    updateClerks(dt);
    updateMe(dt);
    updateRemotes(dt);
    updateHud();
    const t = performance.now() / 1000;
    for (const s of world.stations) { s.holder.rotation.y = t * 1.6; s.holder.position.y = 2.1 + Math.sin(t * 2 + s.n) * 0.12; }
    if (ws && me.char && performance.now() - lastSend > 66) {
      lastSend = performance.now();
      send({ t: "s", x: me.pos.x, z: me.pos.z, ry: me.ry, a: me.anim, st: me.stamps.length });
    }
  }
  updateCamera(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

// ---------- boot ----------
async function boot() {
  center("<small>Lade Behörde…</small>");
  world = await buildWorld(scene);
  await spawnClerks();
  center("");
  me.pos.copy(world.spawn).add(new THREE.Vector3(2, 0, 2));
  renderStamps();
  if (IS_HOST) { ui.join.classList.add("hidden"); hostJoin(); }
}
loop();
boot();

async function hostJoin() {
  me.name = "HOST";
  makeQR();
  ui.hud.classList.remove("hidden");
  try { await connect(); } catch { center("<small>Server nicht erreichbar</small>"); }
}

async function startGame(isSolo) {
  audio.unlock();
  audio.preload(["stamp_sfx", "ding", "buzz", "win", "timeup", "countdown", "music", ...audio.LINES.hit.map((_, i) => `hit_${i}`), ...audio.LINES.stamp.map((_, i) => `stamp_${i}`)]);
  audio.music("music", 0.25);
  me.name = (ui.name.value.trim() || "Gast" + Math.floor(Math.random() * 90 + 10)).slice(0, 16);
  try { localStorage.setItem("sr_name", me.name); } catch {}
  ui.join.classList.add("hidden");
  ui.hud.classList.remove("hidden");
  while (!world) await new Promise((r) => setTimeout(r, 100));
  await spawnMe();
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

// debug hook for testing
window.__sr = { me, get phase() { return phase; }, clerks, remotes, get world() { return world; } };
