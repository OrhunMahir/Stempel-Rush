import * as THREE from "three";
import { prop, textSprite, makeCharacter } from "./assets.js";

export const CS = 2; // cell size (m)
export const WALL_H = 1.5;

export const STATIONS = {
  1: "Anmeldung",
  2: "Meldebescheinigung",
  3: "Krankenkasse",
  4: "Steuer-ID",
  5: "Fingerabdruck",
};
export const FLOOR_NAMES = ["EG", "1. OG", "2. OG", "3. OG"];
export const BUILDINGS = ["KVR München", "Bürgerbüro Pasing", "Finanzamt Mitte", "Jobcenter Nord", "Standesamt Mitte", "Ausländerbehörde Ost"];

// one palette per floor (rotated per building) so every floor is recognisable at a glance
export const THEMES = [
  { floor: ["#d8cfb8", "#c7bc9f"], carpet: "#6f8f7a", lino: "#cbd6c9", wallLow: "#8fbf9f", stripe: "#4f8466", wallUp: "#f3eddb", top: "#d9d3c3", sky: "#1d2433", light: "#fff3d6" },
  { floor: ["#d6dde4", "#c1cbd4"], carpet: "#b7774a", lino: "#efd9c3", wallLow: "#e3a76f", stripe: "#b5703a", wallUp: "#f7f0e5", top: "#dcd6cc", sky: "#241d33", light: "#ffeccc" },
  { floor: ["#dfd8de", "#cdc2cb"], carpet: "#4f6aa8", lino: "#d3dcf0", wallLow: "#8aa4d6", stripe: "#3f5a9a", wallUp: "#eef1f7", top: "#d7d8de", sky: "#14202e", light: "#e8f0ff" },
  { floor: ["#ddd7c0", "#cbc2a3"], carpet: "#8f5280", lino: "#f0d8e6", wallLow: "#c98fb6", stripe: "#8f5280", wallUp: "#f8f0ea", top: "#ddd5cf", sky: "#2a1b24", light: "#fff0e6" },
  { floor: ["#d9e1d1", "#c4d0b8"], carpet: "#a8862a", lino: "#f3e7bf", wallLow: "#e6c65c", stripe: "#a07c1e", wallUp: "#fcf7ea", top: "#dbd9cf", sky: "#1c2a20", light: "#fff8dc" },
];

const POSTERS = ["Bitte Nummer ziehen", "Ruhe bitte!", "Formular A38", "Rauchen verboten", "Wartezeit: 4 Std.", "Kein Zutritt", "Antrag? Schalter 7", "Heute geschlossen*", "Bitte warten", "Termin = Pflicht", "Kopien: 50 Cent", "Sprechzeiten: Di 9-9:15", "Aufzug defekt", "Treppe benutzen!"];
const ROOM_NAMES = ["Wartebereich", "Meldewesen", "Kasse", "Archiv", "Poststelle", "Kopierraum", "Beglaubigung", "Fundbüro", "Ausländerwesen", "Gewerbeamt", "Kfz-Stelle", "Bürgerservice", "Akten", "Sachgebiet 3b", "Pause"];

export const DEFAULT_SETTINGS = { duration: 120, clerks: "normal", guards: true, events: true, powerups: true, shove: true, size: "normal" };
const FLOOR_LAYOUTS = [
  { rw: 3, rh: 3, iw: 5, ih: 4 },
  { rw: 3, rh: 3, iw: 6, ih: 4 },
  { rw: 4, rh: 3, iw: 5, ih: 4 },
  { rw: 3, rh: 3, iw: 6, ih: 5 },
];
const FLOORS_BY_SIZE = { small: 2, normal: 3, large: 4 };
const DECOR_TYPES = ["plant", "cabinet", "cooler", "printer", "files", "extinguisher", "vending", "chairs", "coffeemachine", "plant", "chairs"];

export function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (R, arr) => arr[Math.floor(R() * arr.length)];
function shuffle(R, arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
function range(a, b) { const o = []; for (let i = a; i <= b; i++) o.push(i); return o; }
const key = (r, c) => r * 1000 + c;

function roomGrid(L) {
  const { rw, rh, iw, ih } = L;
  const rooms = [];
  for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) {
    const r0 = j * (ih + 1) + 1, c0 = i * (iw + 1) + 1;
    rooms.push({ i, j, r0, c0, r1: r0 + ih - 1, c1: c0 + iw - 1, rc: r0 + Math.floor(ih / 2), cc: c0 + Math.floor(iw / 2), id: rooms.length });
  }
  return rooms;
}

// ---------- building: several floors connected by stairs ----------
export function generateBuilding(seed, settings = DEFAULT_SETTINGS) {
  const S = { ...DEFAULT_SETTINGS, ...settings };
  const R = rng(seed);
  const L = pick(R, FLOOR_LAYOUTS);
  const F = FLOORS_BY_SIZE[S.size] || 3;
  const base = roomGrid(L);
  const W = L.rw * (L.iw + 1) + 1, H = L.rh * (L.ih + 1) + 1;

  // stairs between floor f and f+1, same cell on both floors
  const used = Array.from({ length: F }, () => new Set());
  const stairs = [];
  for (let f = 0; f < F - 1; f++) {
    const cands = shuffle(R, base.filter((rm) => !used[f].has(rm.id) && !used[f + 1].has(rm.id)));
    const n = Math.min(cands.length, base.length >= 12 ? 2 : 2);
    for (let k = 0; k < n; k++) {
      const rm = cands[k];
      const right = R() < 0.5;
      const r = rm.r1, c = right ? rm.c1 : rm.c0;
      stairs.push({ lo: f, hi: f + 1, r, c, ar: r - 1, ac: c, room: rm.id });
      used[f].add(rm.id); used[f + 1].add(rm.id);
    }
  }
  const nums = shuffle(R, [1, 2, 3, 4, 5]);
  const tStart = Math.floor(R() * THEMES.length);
  const floors = [];
  for (let f = 0; f < F; f++) {
    floors.push(generateFloor(R, L, {
      f, F, S,
      stationNums: nums.filter((_, i) => i % F === f),
      hasSpawn: f === 0,
      hasExit: f === F - 1,
      stairs: stairs.filter((s) => s.lo === f || s.hi === f).map((s) => ({ ...s, dir: s.lo === f ? "up" : "down", to: s.lo === f ? s.hi : s.lo })),
      theme: THEMES[(tStart + f) % THEMES.length],
    }));
  }
  return { seed, L, F, W, H, floors, stairs, name: pick(R, BUILDINGS), stationFloor: Object.fromEntries(nums.map((n, i) => [n, i % F])) };
}

function generateFloor(R, L, o) {
  const { rw, rh, iw, ih } = L;
  const W = rw * (iw + 1) + 1, H = rh * (ih + 1) + 1;
  const g = Array.from({ length: H }, () => Array(W).fill("#"));
  const rooms = roomGrid(L).map((r) => ({ ...r, nb: [] }));
  for (const rm of rooms) for (let r = rm.r0; r <= rm.r1; r++) for (let c = rm.c0; c <= rm.c1; c++) g[r][c] = ".";
  const roomAt = (i, j) => rooms[j * rw + i];
  const edges = [];
  for (const rm of rooms) {
    if (rm.i + 1 < rw) edges.push([rm, roomAt(rm.i + 1, rm.j), "h"]);
    if (rm.j + 1 < rh) edges.push([rm, roomAt(rm.i, rm.j + 1), "v"]);
  }
  const inTree = new Set();
  const seen = new Set([0]);
  const stack = [rooms[0]];
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const opts = shuffle(R, edges.filter((e) => (e[0] === cur && !seen.has(e[1].id)) || (e[1] === cur && !seen.has(e[0].id))));
    if (!opts.length) { stack.pop(); continue; }
    const e = opts[0];
    const nxt = e[0] === cur ? e[1] : e[0];
    inTree.add(e); seen.add(nxt.id); stack.push(nxt);
  }
  const doorCells = new Set(), openCells = new Set();
  const doors = [];
  for (const e of edges) {
    const [a, b, dir] = e;
    if (!(inTree.has(e) || R() < 0.4)) continue;
    a.nb.push(b.id); b.nb.push(a.id);
    const merge = R() < 0.15;
    if (dir === "h") {
      const wc = a.c1 + 1;
      const rows = merge ? range(a.r0, a.r1) : [a.rc - 1, a.rc];
      for (const r of rows) { g[r][wc] = "."; (merge ? openCells : doorCells).add(key(r, wc)); }
      if (!merge) doors.push({ dir, cells: rows.map((r) => [r, wc]) });
    } else {
      const wr = a.r1 + 1;
      const cols = merge ? range(a.c0, a.c1) : [a.cc - 1, a.cc];
      for (const c of cols) { g[wr][c] = "."; (merge ? openCells : doorCells).add(key(wr, c)); }
      if (!merge) doors.push({ dir, cells: cols.map((c) => [wr, c]) });
    }
  }

  const reserved = new Set();
  for (const s of o.stairs) { reserved.add(key(s.r, s.c)); reserved.add(key(s.ar, s.ac)); }

  const corners = [roomAt(0, 0), roomAt(rw - 1, 0), roomAt(0, rh - 1), roomAt(rw - 1, rh - 1)];
  const spawnRoom = o.hasSpawn ? pick(R, corners) : null;
  const startRoom = spawnRoom || rooms[o.stairs.find((s) => s.dir === "down")?.room ?? 0];
  const dist = new Map([[startRoom.id, 0]]);
  const q = [startRoom];
  while (q.length) { const cur = q.shift(); for (const n of cur.nb) if (!dist.has(n)) { dist.set(n, dist.get(cur.id) + 1); q.push(rooms[n]); } }
  let exitRoom = null;
  if (o.hasExit) {
    const maxD = Math.max(...dist.values());
    exitRoom = pick(R, rooms.filter((r) => dist.get(r.id) === maxD && r !== spawnRoom)) || rooms[rooms.length - 1];
  }
  const others = shuffle(R, rooms.filter((r) => r !== spawnRoom && r !== exitRoom));
  const stationRooms = others.slice(0, o.stationNums.length);

  const deskCol = (rm) => {
    const above = rm.r0 - 1;
    for (const c of [rm.c0 + 1, rm.c1 - 1, rm.cc + 1, rm.c0 + 2]) {
      if (c < rm.c0 || c > rm.c1) continue;
      if (g[above]?.[c] !== "#") continue;
      return c;
    }
    return rm.c0 + 1;
  };
  const stationCells = stationRooms.map((rm, k) => ({ n: o.stationNums[k], r: rm.r0, c: deskCol(rm), room: rm }));
  const exitCell = exitRoom ? { r: exitRoom.r0, c: deskCol(exitRoom), room: exitRoom } : null;
  const solidDesk = new Set([...stationCells, ...(exitCell ? [exitCell] : [])].map((s) => key(s.r, s.c)));

  if (spawnRoom) reserved.add(key(spawnRoom.r0, spawnRoom.c1)); // ticket machine
  const nearOpening = (r, c) => [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].some(([dr, dc]) => { const k = key(r + dr, c + dc); return doorCells.has(k) || openCells.has(k) || reserved.has(k); });
  const nearDesk = (r, c) => [[0, 0], [1, 0], [0, 1], [0, -1], [1, 1], [1, -1]].some(([dr, dc]) => solidDesk.has(key(r - dr, c - dc)));
  let decor = [];
  for (const rm of rooms) {
    const cand = [];
    for (let r = rm.r0; r <= rm.r1; r++) for (let c = rm.c0; c <= rm.c1; c++) {
      const border = r === rm.r0 || r === rm.r1 || c === rm.c0 || c === rm.c1;
      if (!border || nearOpening(r, c) || nearDesk(r, c)) continue;
      if (rm === spawnRoom && Math.abs(r - rm.rc) <= 1 && Math.abs(c - rm.cc) <= 1) continue;
      cand.push([r, c]);
    }
    shuffle(R, cand);
    const n = Math.min(cand.length, 2 + Math.floor(R() * 3));
    for (let k = 0; k < n; k++) {
      const [r, c] = cand[k];
      const rot = r === rm.r0 ? 0 : r === rm.r1 ? Math.PI : c === rm.c0 ? Math.PI / 2 : -Math.PI / 2;
      decor.push({ type: pick(R, DECOR_TYPES), r, c, rot });
    }
  }
  const solidAt = (r, c, withDecor) => g[r]?.[c] !== "." || solidDesk.has(key(r, c)) || (withDecor && decor.some((d) => d.r === r && d.c === c)) || (spawnRoom && r === spawnRoom.r0 && c === spawnRoom.c1);
  const reachable = (withDecor) => {
    const start = [startRoom.rc, startRoom.cc];
    const vis = new Set([key(...start)]);
    const qq = [start];
    while (qq.length) {
      const [r, c] = qq.shift();
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nr = r + dr, nc = c + dc, k = key(nr, nc);
        if (vis.has(k) || solidAt(nr, nc, withDecor)) continue;
        vis.add(k); qq.push([nr, nc]);
      }
    }
    const targets = [...stationCells, ...(exitCell ? [exitCell] : [])].map((s) => key(s.r + 1, s.c)).concat(o.stairs.map((s) => key(s.r, s.c)));
    return targets.every((k) => vis.has(k));
  };
  if (!reachable(true)) decor = [];

  // patrols
  const doorPoint = (a, b) => (a.j === b.j ? [a.rc, b.i > a.i ? a.c1 + 1 : a.c0 - 1] : [b.j > a.j ? a.r1 + 1 : a.r0 - 1, a.cc]);
  const roamPath = (start, len) => {
    const path = [start];
    let cur = start;
    for (let k = 0; k < len; k++) {
      const opts = cur.nb.map((id) => rooms[id]).filter((r) => r !== spawnRoom && r !== path[path.length - 2]);
      if (!opts.length) break;
      cur = pick(R, opts); path.push(cur);
    }
    if (path.length < 2) return null;
    const fwd = [];
    for (let k = 0; k < path.length; k++) {
      fwd.push([path[k].rc, path[k].cc]);
      if (k + 1 < path.length) fwd.push(doorPoint(path[k], path[k + 1]));
    }
    return [...fwd, ...fwd.slice(1, -1).reverse()];
  };
  const S = o.S;
  const counts = { few: [1, 2], normal: [2, 3], many: [4, 5] }[S.clerks] || [2, 3];
  const nClerks = counts[0] + Math.floor(R() * (counts[1] - counts[0] + 1));
  const nonSpawn = rooms.filter((r) => r !== spawnRoom);
  const guardRooms = shuffle(R, [...stationRooms, ...(exitRoom ? [exitRoom] : []), ...nonSpawn]);
  const patrols = [];
  for (let k = 0; k < nClerks; k++) {
    let pts = R() < 0.55 ? roamPath(pick(R, nonSpawn), 2 + Math.floor(R() * 3)) : null;
    if (!pts) {
      const rm = guardRooms[k % guardRooms.length];
      if (rm.c1 - rm.c0 < 2 || rm.r1 - rm.r0 < 2) continue;
      pts = [[rm.r0 + 1, rm.c0 + 1], [rm.r0 + 1, rm.c1 - 1], [rm.r1 - 1, rm.c1 - 1], [rm.r1 - 1, rm.c0 + 1]];
      if (R() < 0.5) pts.reverse();
    }
    patrols.push({ pts, speed: 1.6 + R() * 0.8, offset: R() * 1000, kind: "clerk" });
  }
  if (S.guards && (o.f > 0 || R() < 0.4)) {
    const nGuards = S.clerks === "many" ? 2 : 1;
    for (let k = 0; k < nGuards; k++) {
      const pts = roamPath(pick(R, nonSpawn), 3 + Math.floor(R() * 3));
      if (pts) patrols.push({ pts, speed: 2.5, offset: R() * 1000, kind: "guard" });
    }
  }

  // free interior cells helper
  const freeInterior = (rm) => {
    const r = rm.r0 + 1 + Math.floor(R() * Math.max(1, rm.r1 - rm.r0 - 1));
    const c = rm.c0 + 1 + Math.floor(R() * Math.max(1, rm.c1 - rm.c0 - 1));
    if (solidAt(r, c, true) || reserved.has(key(r, c)) || solidDesk.has(key(r - 1, c))) return null;
    return [r, c];
  };
  const powerSpots = [];
  if (S.powerups) for (const rm of shuffle(R, [...nonSpawn]).slice(0, 3)) {
    const cell = freeInterior(rm);
    if (cell) powerSpots.push({ r: cell[0], c: cell[1], type: (o.f + powerSpots.length) % 2 ? "termin" : "coffee" });
  }
  const puddles = [];
  for (const rm of shuffle(R, [...nonSpawn]).slice(0, 1 + Math.floor(R() * 2))) {
    const cell = freeInterior(rm);
    if (!cell || powerSpots.some((p) => p.r === cell[0] && p.c === cell[1])) continue;
    puddles.push(cell);
    // grow to a 2-cell puddle when possible
    const [r, c] = cell;
    if (!solidAt(r, c + 1, true) && c + 1 < rm.c1 && !reserved.has(key(r, c + 1))) puddles.push([r, c + 1]);
  }

  // posters on wall faces
  const wallCands = [];
  for (let r = 1; r < H - 1; r++) for (let c = 1; c < W - 1; c++) {
    if (g[r][c] !== "#") continue;
    for (const [dr, dc, rot] of [[1, 0, 0], [-1, 0, Math.PI], [0, 1, Math.PI / 2], [0, -1, -Math.PI / 2]]) {
      if (g[r + dr]?.[c + dc] === "." && !solidDesk.has(key(r + dr, c + dc))) wallCands.push({ r, c, dr, dc, rot });
    }
  }
  const posters = shuffle(R, wallCands).slice(0, 10).map((w) => ({ ...w, text: pick(R, POSTERS) }));
  const names = shuffle(R, [...ROOM_NAMES]);
  for (const rm of rooms) {
    rm.floorType = pick(R, ["tiles", "carpet", "lino", "tiles"]);
    rm.label = rm === spawnRoom ? "Eingang · Wartebereich" : rm === exitRoom ? "Aufenthaltstitel" : `${o.f}.${String(rm.id + 1).padStart(2, "0")} ${names[rm.id % names.length]}`;
  }
  return { f: o.f, F: o.F, W, H, g, rooms, doors, spawnRoom, exitCell, stationCells, decor, patrols, powerSpots, posters, puddles, stairs: o.stairs, theme: o.theme };
}

// ---------- textures (cached per colour) ----------
const texCache = new Map();
function cachedTex(id, make) { if (!texCache.has(id)) texCache.set(id, make()); return texCache.get(id); }
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  return t;
}
function floorTex(type, theme) {
  return cachedTex(`${type}|${theme.floor[0]}|${theme.carpet}|${theme.lino}`, () => canvasTex(256, 256, (x) => {
    if (type === "tiles") {
      for (let yy = 0; yy < 4; yy++) for (let xx = 0; xx < 4; xx++) { x.fillStyle = (xx + yy) % 2 ? theme.floor[0] : theme.floor[1]; x.fillRect(xx * 64, yy * 64, 64, 64); }
      x.strokeStyle = "rgba(0,0,0,0.08)"; x.lineWidth = 2;
      for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(i * 64, 0); x.lineTo(i * 64, 256); x.stroke(); x.beginPath(); x.moveTo(0, i * 64); x.lineTo(256, i * 64); x.stroke(); }
    } else if (type === "carpet") {
      x.fillStyle = theme.carpet; x.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 3000; i++) { x.fillStyle = Math.random() < 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.07)"; x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
    } else {
      x.fillStyle = theme.lino; x.fillRect(0, 0, 256, 256);
      x.fillStyle = "rgba(0,0,0,0.05)"; for (let i = 0; i < 8; i++) x.fillRect(0, i * 32, 256, 2);
      for (let i = 0; i < 500; i++) { x.fillStyle = "rgba(0,0,0,0.04)"; x.fillRect(Math.random() * 256, Math.random() * 256, 3, 3); }
    }
  }, true));
}
function wallTex(theme) {
  return cachedTex(`wall|${theme.wallLow}`, () => canvasTex(64, 128, (x) => {
    x.fillStyle = theme.wallUp; x.fillRect(0, 0, 64, 128);
    x.fillStyle = theme.wallLow; x.fillRect(0, 60, 64, 62);
    x.fillStyle = theme.stripe; x.fillRect(0, 56, 64, 6);
    x.fillStyle = "rgba(0,0,0,0.25)"; x.fillRect(0, 122, 64, 6);
  }));
}
function topTex(theme) {
  return cachedTex(`top|${theme.top}|${theme.stripe}`, () => canvasTex(64, 64, (x) => {
    x.fillStyle = theme.top; x.fillRect(0, 0, 64, 64);
    x.strokeStyle = theme.stripe; x.lineWidth = 6; x.strokeRect(0, 0, 64, 64);
  }));
}
const glowTex = () => cachedTex("glow", () => canvasTex(128, 128, (x) => {
  const gr = x.createRadialGradient(64, 64, 4, 64, 64, 64);
  gr.addColorStop(0, "rgba(255,248,225,0.9)"); gr.addColorStop(0.5, "rgba(255,240,200,0.35)"); gr.addColorStop(1, "rgba(255,240,200,0)");
  x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
}));
const puddleTex = () => cachedTex("puddle", () => canvasTex(128, 128, (x) => {
  x.fillStyle = "rgba(90,170,255,0.55)";
  x.beginPath();
  for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI * 2, r = 46 + Math.sin(i * 2.3) * 10 + Math.cos(i * 1.7) * 6; i ? x.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r) : x.moveTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); }
  x.fill();
  x.fillStyle = "rgba(255,255,255,0.45)"; x.beginPath(); x.ellipse(50, 48, 14, 6, -0.5, 0, Math.PI * 2); x.fill();
}));
function labelTex(text, color) {
  return canvasTex(512, 96, (x) => {
    x.fillStyle = color; x.font = "bold 54px sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText(text.toUpperCase(), 256, 50);
  });
}
function posterMesh(text, theme) {
  const t = canvasTex(256, 180, (x) => {
    x.fillStyle = "#fffdf3"; x.fillRect(0, 0, 256, 180);
    x.strokeStyle = theme.stripe; x.lineWidth = 10; x.strokeRect(5, 5, 246, 170);
    x.fillStyle = "#1d2433"; x.font = "bold 30px sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
    const words = text.split(" "); const lines = []; let cur = "";
    for (const w of words) { if (x.measureText(cur + " " + w).width > 220 && cur) { lines.push(cur); cur = w; } else cur = cur ? cur + " " + w : w; }
    lines.push(cur);
    lines.forEach((l, i) => x.fillText(l, 128, 90 + (i - (lines.length - 1) / 2) * 36));
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.63), new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 }));
}

// ---------- props (loaded once) ----------
let protoPromise = null;
function loadProtos() {
  if (!protoPromise) protoPromise = (async () => {
    const opts = {
      desk: { maxXZ: 1.9, height: 1.1 }, stamp: { height: 0.85 }, cabinet: { height: 1.4, maxXZ: 1.2 }, ticket: { height: 1.6, maxXZ: 1.0 },
      plant: { height: 1.4, maxXZ: 1.1 }, chairs: { maxXZ: 1.95, height: 1.0 }, cooler: { height: 1.5, maxXZ: 1.0 }, printer: { height: 1.3, maxXZ: 1.5 },
      files: { height: 1.2, maxXZ: 1.2 }, extinguisher: { height: 0.9, maxXZ: 0.6 }, vending: { height: 1.9, maxXZ: 1.4 }, coffeemachine: { height: 1.4, maxXZ: 1.4 },
      coffee: { height: 0.6 }, termin: { height: 0.25, maxXZ: 0.75 },
    };
    const names = Object.keys(opts);
    const loaded = await Promise.all(names.map((n) => prop(n, opts[n])));
    return Object.fromEntries(names.map((n, i) => [n, loaded[i]]));
  })();
  return protoPromise;
}

// shared simple geometries/materials
const G = {
  plane: new THREE.PlaneGeometry(1, 1),
  box: new THREE.BoxGeometry(1, 1, 1),
};
const M = {
  frame: new THREE.MeshStandardMaterial({ color: "#7a5636", roughness: 0.7 }),
  stairHole: new THREE.MeshBasicMaterial({ color: "#11141c" }),
  warn: new THREE.MeshStandardMaterial({ color: "#ffd23f", roughness: 0.5 }),
};

// ---------- build ----------
export async function buildBuilding(scene, seed, settings) {
  const B = generateBuilding(seed, settings);
  const proto = await loadProtos();
  const floors = B.floors.map((fm) => buildFloor(scene, fm, proto, B));
  floors.forEach((fl, i) => { fl.group.visible = i === 0; });
  return { ...B, floors };
}

function buildFloor(scene, map, proto, B) {
  const { W, H, g, theme } = map;
  const cellToWorld = (r, c) => new THREE.Vector3((c - W / 2 + 0.5) * CS, 0, (r - H / 2 + 0.5) * CS);
  const worldToCell = (x, z) => [Math.floor(z / CS + H / 2), Math.floor(x / CS + W / 2)];
  const group = new THREE.Group();
  scene.add(group);
  const solid = g.map((row) => row.map((ch) => ch === "#"));
  const statics = [];
  const add = (o) => { group.add(o); statics.push(o); return o; };

  // base floor (corridors / door cells)
  const baseTex = floorTex("tiles", theme).clone(); baseTex.needsUpdate = true; baseTex.repeat.set(W / 2, H / 2);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W * CS, H * CS), new THREE.MeshStandardMaterial({ map: baseTex, roughness: 0.92 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  add(floor);

  // per-room floors, labels and light pools
  for (const rm of map.rooms) {
    const a = cellToWorld(rm.r0, rm.c0), b = cellToWorld(rm.r1, rm.c1);
    const wdt = b.x - a.x + CS, dep = b.z - a.z + CS;
    const t = floorTex(rm.floorType, theme).clone(); t.needsUpdate = true; t.repeat.set(wdt / 4, dep / 4);
    const m = new THREE.Mesh(G.plane, new THREE.MeshStandardMaterial({ map: t, roughness: rm.floorType === "carpet" ? 1 : 0.85 }));
    m.scale.set(wdt, dep, 1); m.rotation.x = -Math.PI / 2; m.position.set((a.x + b.x) / 2, 0.005, (a.z + b.z) / 2); m.receiveShadow = true;
    add(m);
    const lbl = new THREE.Mesh(G.plane, new THREE.MeshBasicMaterial({ map: labelTex(rm.label, "rgba(29,36,51,0.16)"), transparent: true, depthWrite: false }));
    lbl.scale.set(Math.min(wdt - 1, 6), Math.min(wdt - 1, 6) * 0.19, 1); lbl.rotation.x = -Math.PI / 2;
    lbl.position.set((a.x + b.x) / 2, 0.012, b.z + CS / 2 - 0.7);
    add(lbl);
    const glow = new THREE.Mesh(G.plane, new THREE.MeshBasicMaterial({ map: glowTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.35 }));
    glow.scale.set(wdt * 0.9, dep * 0.9, 1); glow.rotation.x = -Math.PI / 2; glow.position.set((a.x + b.x) / 2, 0.015, (a.z + b.z) / 2);
    add(glow);
  }

  // walls
  const wallCells = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (g[r][c] === "#") wallCells.push([r, c]);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex(theme), roughness: 0.8 });
  const topMat = new THREE.MeshStandardMaterial({ map: topTex(theme), roughness: 0.9 });
  const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(CS, WALL_H, CS), [wallMat, wallMat, topMat, topMat, wallMat, wallMat], wallCells.length);
  const mtx = new THREE.Matrix4();
  wallCells.forEach(([r, c], i) => { const p = cellToWorld(r, c); mtx.makeTranslation(p.x, WALL_H / 2, p.z); walls.setMatrixAt(i, mtx); });
  walls.castShadow = true; walls.receiveShadow = true;
  add(walls);

  // door frames
  for (const d of map.doors) {
    const ps = d.cells.map(([r, c]) => cellToWorld(r, c));
    const mid = ps[0].clone().add(ps[1]).multiplyScalar(0.5);
    const along = d.dir === "h" ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(G.box, M.frame);
      post.scale.set(d.dir === "h" ? 1.9 : 0.22, WALL_H + 0.08, d.dir === "h" ? 0.22 : 1.9);
      post.position.copy(mid).addScaledVector(along, s * (CS - 0.11)); post.position.y = (WALL_H + 0.08) / 2;
      post.castShadow = true;
      add(post);
    }
  }

  const place = (type, r, c, rot = 0) => {
    const p = cellToWorld(r, c);
    let o = proto[type]?.clone(true);
    if (!o) { o = new THREE.Group(); const b = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1, 1.4), new THREE.MeshStandardMaterial({ color: "#888" })); b.position.y = 0.5; o.add(b); }
    o.position.add(p); o.rotation.y = rot;
    return add(o);
  };
  for (const d of map.decor) { place(d.type, d.r, d.c, d.rot); solid[d.r][d.c] = true; }
  const sr = map.spawnRoom;
  if (sr) { place("ticket", sr.r0, sr.c1, 0); solid[sr.r0][sr.c1] = true; }

  for (const p of map.posters) {
    const mesh = posterMesh(p.text, theme);
    const wp = cellToWorld(p.r, p.c);
    mesh.position.set(wp.x + p.dc * (CS / 2 + 0.01), 0.95, wp.z + p.dr * (CS / 2 + 0.01));
    mesh.rotation.y = p.rot;
    add(mesh);
  }

  // puddles (slippery)
  const puddles = new Set();
  for (const [r, c] of map.puddles) {
    puddles.add(key(r, c));
    const p = cellToWorld(r, c);
    const m = new THREE.Mesh(G.plane, new THREE.MeshBasicMaterial({ map: puddleTex(), transparent: true, depthWrite: false }));
    m.scale.set(2.2, 2.2, 1); m.rotation.x = -Math.PI / 2; m.rotation.z = (r * 7 + c) % 6; m.position.set(p.x, 0.02, p.z);
    add(m);
  }
  if (map.puddles.length) {
    const [r, c] = map.puddles[0];
    const p = cellToWorld(r, c);
    const sign = new THREE.Group();
    for (const s of [-1, 1]) { const leaf = new THREE.Mesh(G.box, M.warn); leaf.scale.set(0.5, 0.75, 0.04); leaf.rotation.x = s * 0.35; leaf.position.set(0, 0.36, s * 0.12); sign.add(leaf); }
    sign.position.set(p.x - 0.8, 0, p.z - 0.8); sign.rotation.y = 0.6;
    add(sign);
    const warnLbl = textSprite("⚠ Rutschgefahr", { bg: "rgba(255,210,63,0.95)", color: "#1d2433", scale: 0.6 });
    warnLbl.position.set(p.x - 0.8, 1.15, p.z - 0.8);
    add(warnLbl);
  }

  // stairs
  const stairs = map.stairs.map((s) => {
    const p = cellToWorld(s.r, s.c);
    if (s.dir === "up") {
      for (let k = 0; k < 4; k++) {
        const step = new THREE.Mesh(G.box, new THREE.MeshStandardMaterial({ color: k % 2 ? theme.wallUp : theme.stripe, roughness: 0.8 }));
        const h = 0.18 * (k + 1);
        step.scale.set(1.8, h, 0.45); step.position.set(p.x, h / 2, p.z + 0.68 - k * 0.45);
        step.castShadow = true; step.receiveShadow = true;
        add(step);
      }
    } else {
      const hole = new THREE.Mesh(G.plane, M.stairHole);
      hole.scale.set(1.8, 1.8, 1); hole.rotation.x = -Math.PI / 2; hole.position.set(p.x, 0.02, p.z);
      add(hole);
      for (let k = 0; k < 3; k++) {
        const line = new THREE.Mesh(G.plane, new THREE.MeshBasicMaterial({ color: theme.stripe }));
        line.scale.set(1.6, 0.12, 1); line.rotation.x = -Math.PI / 2; line.position.set(p.x, 0.025, p.z - 0.5 + k * 0.45);
        add(line);
      }
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.0, 4, 1, Math.PI / 4), new THREE.MeshBasicMaterial({ color: s.dir === "up" ? "#4fd1ff" : "#ff9a3c", transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(p.x, 0.03, p.z);
    add(ring);
    const sign = textSprite(`${s.dir === "up" ? "▲" : "▼"} ${FLOOR_NAMES[s.to]}`, { bg: s.dir === "up" ? "rgba(20,110,160,0.92)" : "rgba(170,90,20,0.92)", scale: 0.8 });
    sign.position.set(p.x, 2.0, p.z);
    add(sign);
    return { ...s, pos: p, arrive: cellToWorld(s.ar, s.ac), ring };
  });

  // counters
  const stations = [];
  const counterClerks = [];
  let exit = null;
  const addCounter = (cell, isExit) => {
    const pos = cellToWorld(cell.r, cell.c);
    place("desk", cell.r, cell.c, 0);
    solid[cell.r][cell.c] = true;
    const label = isExit ? "🏁 Aufenthaltstitel" : `${cell.n} · ${STATIONS[cell.n]}`;
    const sign = textSprite(label, { scale: 1.1, bg: isExit ? "rgba(30,120,60,0.92)" : "rgba(25,40,90,0.9)" });
    sign.position.set(pos.x, 3.4, pos.z);
    add(sign);
    counterClerks.push(pos.clone().add(new THREE.Vector3(0, 0, -0.85)));
    const front = cellToWorld(cell.r + 1, cell.c);
    if (isExit) {
      const glow = new THREE.Mesh(new THREE.RingGeometry(1.4, 1.9, 40), new THREE.MeshBasicMaterial({ color: "#3f6", transparent: true, opacity: 0, side: THREE.DoubleSide }));
      glow.rotation.x = -Math.PI / 2; glow.position.set(pos.x, 0.03, pos.z + 0.6);
      add(glow);
      exit = { pos, front, glow, sign, f: map.f };
      return;
    }
    const s = proto.stamp ? proto.stamp.clone(true) : new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.4, 16), new THREE.MeshStandardMaterial({ color: "#d22" }));
    const holder = new THREE.Group(); holder.add(s); holder.position.set(pos.x, 2.1, pos.z);
    group.add(holder);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.75, 40), new THREE.MeshBasicMaterial({ color: "#ffd23f", transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(pos.x, 0.03, pos.z + 0.6);
    add(ring);
    stations.push({ n: cell.n, name: STATIONS[cell.n], pos, front, holder, ring, sign, f: map.f, cell });
  };
  for (const s of map.stationCells) addCounter(s, false);
  if (map.exitCell) addCounter(map.exitCell, true);
  stations.sort((a, b) => a.n - b.n);

  for (const p of counterClerks) {
    makeCharacter("clerk", "#7a5230", 1.7).then((ch) => {
      ch.root.position.copy(p); ch.setAnim(0); ch.update(0.016);
      group.add(ch.root);
    });
  }

  const powerups = map.powerSpots.map((sp) => {
    const pos = cellToWorld(sp.r, sp.c);
    const holder = new THREE.Group();
    const model = proto[sp.type]?.clone(true);
    if (model) holder.add(model);
    else holder.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshStandardMaterial({ color: sp.type === "coffee" ? "#7a4a2a" : "#e6c34a" })));
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.6, 28), new THREE.MeshBasicMaterial({ color: sp.type === "coffee" ? "#ff9a3c" : "#4fd1ff", transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    halo.rotation.x = -Math.PI / 2; halo.position.y = -0.55;
    holder.add(halo);
    holder.position.set(pos.x, 0.6, pos.z);
    group.add(holder);
    return { type: sp.type, pos, holder, takenUntil: 0 };
  });

  const patrols = map.patrols.map((pt) => {
    const pts = pt.pts.map(([r, c]) => cellToWorld(r, c));
    const segs = []; let Ltot = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const len = a.distanceTo(b);
      segs.push({ a, b, len, start: Ltot }); Ltot += len;
    }
    return { ...pt, segs, L: Ltot };
  });

  // static objects never move: skip per-frame matrix updates
  for (const o of statics) { o.updateMatrixWorld(true); o.matrixAutoUpdate = false; o.traverse((c) => { c.matrixAutoUpdate = false; }); }

  const spawn = sr ? cellToWorld(sr.rc, sr.cc) : stairs.find((s) => s.dir === "down")?.arrive || cellToWorld(map.rooms[0].rc, map.rooms[0].cc);
  return { f: map.f, map, group, solid, stations, exit, spawn, patrols, powerups, puddles, stairs, theme, W, H, cellToWorld, worldToCell, spawnRoom: sr, name: FLOOR_NAMES[map.f] };
}

export function disposeBuilding(scene, building) {
  if (!building) return;
  for (const fl of building.floors) {
    scene.remove(fl.group);
    fl.group.traverse((o) => {
      if (o.isMesh && !o.isSkinnedMesh && o.geometry && o.geometry !== G.plane && o.geometry !== G.box && !o.geometry.userData?.shared) {
        if (o.isInstancedMesh || o.geometry.type === "PlaneGeometry" || o.geometry.type === "RingGeometry") o.geometry.dispose();
      }
    });
  }
}

export function patrolPos(p, t, out) {
  let s = ((t * p.speed + p.offset) % p.L + p.L) % p.L;
  for (const seg of p.segs) {
    if (s <= seg.start + seg.len) {
      const k = seg.len ? (s - seg.start) / seg.len : 0;
      out.pos.lerpVectors(seg.a, seg.b, k);
      out.ry = Math.atan2(seg.b.x - seg.a.x, seg.b.z - seg.a.z);
      return out;
    }
  }
  out.pos.copy(p.segs[0].a);
  return out;
}

export function isSolid(world, x, z) {
  const [r, c] = world.worldToCell(x, z);
  if (r < 0 || c < 0 || r >= world.H || c >= world.W) return true;
  return world.solid[r][c];
}
export function onPuddle(world, x, z) {
  const [r, c] = world.worldToCell(x, z);
  return world.puddles.has(key(r, c));
}

export function hasLOS(world, a, b) {
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.ceil(d / 0.4);
  for (let i = 1; i < steps; i++) {
    const k = i / steps;
    if (isSolid(world, a.x + (b.x - a.x) * k, a.z + (b.z - a.z) * k)) return false;
  }
  return true;
}

export function moveWithCollision(world, pos, dx, dz, radius = 0.38) {
  const ok = (nx, nz) => {
    for (const [ox, oz] of [[radius, radius], [radius, -radius], [-radius, radius], [-radius, -radius], [radius, 0], [-radius, 0], [0, radius], [0, -radius]]) {
      if (isSolid(world, nx + ox, nz + oz)) return false;
    }
    return true;
  };
  let full = true;
  if (ok(pos.x + dx, pos.z)) pos.x += dx; else full = false;
  if (ok(pos.x, pos.z + dz)) pos.z += dz; else full = false;
  return full;
}
