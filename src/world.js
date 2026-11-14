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

export const THEMES = [
  { name: "KVR München", floor: ["#cfc6b0", "#bdb39b"], wallLow: "#8fbf9f", stripe: "#5e8f73", wallUp: "#f1ead3", top: "#6b6f78", sky: "#1d2433", light: "#fff3d6" },
  { name: "Bürgerbüro Pasing", floor: ["#c9d3dc", "#b3bfca"], wallLow: "#e3a76f", stripe: "#b5703a", wallUp: "#f6efe4", top: "#5d5a66", sky: "#241d33", light: "#ffeccc" },
  { name: "Finanzamt Mitte", floor: ["#d8cfd6", "#c4b8c2"], wallLow: "#8aa4d6", stripe: "#4a64a0", wallUp: "#eef0f6", top: "#565b6b", sky: "#14202e", light: "#e8f0ff" },
  { name: "Jobcenter Nord", floor: ["#d6d0b8", "#c2b998"], wallLow: "#c98fb6", stripe: "#8f5280", wallUp: "#f7efe8", top: "#605a5a", sky: "#2a1b24", light: "#fff0e6" },
  { name: "Standesamt", floor: ["#d3dccb", "#bdc9b2"], wallLow: "#e6c65c", stripe: "#a8862a", wallUp: "#fbf6e8", top: "#5a5f55", sky: "#1c2a20", light: "#fff8dc" },
];

const POSTERS = ["Bitte Nummer ziehen", "Ruhe bitte!", "Formular A38", "Rauchen verboten", "Wartezeit: 4 Std.", "Kein Zutritt", "Antrag? Schalter 7", "Heute geschlossen*", "Bitte warten", "Termin = Pflicht", "Kopien: 50 Cent", "Sprechzeiten: Di 9-9:15"];

export const DEFAULT_SETTINGS = { duration: 120, clerks: "normal", guards: true, events: true, powerups: true, shove: true, size: "normal" };
const LAYOUTS = {
  small: [{ rw: 3, rh: 3, iw: 5, ih: 4 }, { rw: 3, rh: 3, iw: 6, ih: 4 }],
  normal: [{ rw: 3, rh: 3, iw: 6, ih: 4 }, { rw: 4, rh: 3, iw: 5, ih: 4 }, { rw: 3, rh: 3, iw: 7, ih: 5 }, { rw: 4, rh: 3, iw: 6, ih: 4 }, { rw: 3, rh: 4, iw: 6, ih: 4 }],
  large: [{ rw: 4, rh: 4, iw: 6, ih: 4 }, { rw: 5, rh: 3, iw: 6, ih: 4 }, { rw: 4, rh: 4, iw: 5, ih: 5 }],
};

const DECOR_TYPES = ["plant", "cabinet", "cooler", "printer", "files", "extinguisher", "vending", "chairs", "coffeemachine"];

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

// ---------- procedural floor plan ----------
export function generateMap(seed, settings = DEFAULT_SETTINGS) {
  const S = { ...DEFAULT_SETTINGS, ...settings };
  const R = rng(seed);
  const L = pick(R, LAYOUTS[S.size] || LAYOUTS.normal);
  const { rw, rh, iw, ih } = L;
  const W = rw * (iw + 1) + 1, H = rh * (ih + 1) + 1;
  const g = Array.from({ length: H }, () => Array(W).fill("#"));
  const rooms = [];
  for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) {
    const r0 = j * (ih + 1) + 1, c0 = i * (iw + 1) + 1;
    const room = { i, j, r0, c0, r1: r0 + ih - 1, c1: c0 + iw - 1, rc: r0 + Math.floor(ih / 2), cc: c0 + Math.floor(iw / 2), id: rooms.length, nb: [] };
    for (let r = room.r0; r <= room.r1; r++) for (let c = room.c0; c <= room.c1; c++) g[r][c] = ".";
    rooms.push(room);
  }
  const roomAt = (i, j) => rooms[j * rw + i];
  const edges = [];
  for (const rm of rooms) {
    if (rm.i + 1 < rw) edges.push([rm, roomAt(rm.i + 1, rm.j), "h"]);
    if (rm.j + 1 < rh) edges.push([rm, roomAt(rm.i, rm.j + 1), "v"]);
  }
  // spanning tree (random DFS) + extra loops
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
  const doorCells = new Set();
  const openCells = new Set(); // merged walls
  const key = (r, c) => r * 1000 + c;
  for (const e of edges) {
    const [a, b, dir] = e;
    const use = inTree.has(e) || R() < 0.4;
    if (!use) continue;
    a.nb.push(b.id); b.nb.push(a.id);
    const merge = R() < 0.18;
    if (dir === "h") {
      const wc = a.c1 + 1;
      const rows = merge ? range(a.r0, a.r1) : [a.rc - 1, a.rc];
      for (const r of rows) { g[r][wc] = "."; (merge ? openCells : doorCells).add(key(r, wc)); }
    } else {
      const wr = a.r1 + 1;
      const cols = merge ? range(a.c0, a.c1) : [a.cc - 1, a.cc];
      for (const c of cols) { g[wr][c] = "."; (merge ? openCells : doorCells).add(key(wr, c)); }
    }
  }
  // spawn = random corner, exit = farthest room
  const corners = [roomAt(0, 0), roomAt(rw - 1, 0), roomAt(0, rh - 1), roomAt(rw - 1, rh - 1)];
  const spawnRoom = pick(R, corners);
  const dist = new Map([[spawnRoom.id, 0]]);
  const q = [spawnRoom];
  while (q.length) { const cur = q.shift(); for (const n of cur.nb) if (!dist.has(n)) { dist.set(n, dist.get(cur.id) + 1); q.push(rooms[n]); } }
  const maxD = Math.max(...dist.values());
  const exitRoom = pick(R, rooms.filter((r) => dist.get(r.id) === maxD && r !== spawnRoom));
  const others = shuffle(R, rooms.filter((r) => r !== spawnRoom && r !== exitRoom));
  const stationRooms = others.slice(0, 5);

  const deskCol = (rm) => {
    const above = rm.r0 - 1;
    for (const c of [rm.c0 + 1, rm.c1 - 1, rm.cc + 1, rm.c0 + 2]) {
      if (c < rm.c0 || c > rm.c1) continue;
      if (g[above]?.[c] === "." || g[above]?.[c - 1] === "." && false) continue;
      if (g[above]?.[c] !== "#") continue;
      return c;
    }
    return rm.c0 + 1;
  };
  const stationCells = stationRooms.map((rm, k) => ({ n: k + 1, r: rm.r0, c: deskCol(rm), room: rm }));
  const exitCell = { r: exitRoom.r0, c: deskCol(exitRoom), room: exitRoom };
  const solidDesk = new Set([...stationCells, exitCell].map((s) => key(s.r, s.c)));

  // decor on room border cells away from doors/openings/desks
  const nearOpening = (r, c) => {
    for (const [dr, dc] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const k = key(r + dr, c + dc);
      if (doorCells.has(k) || openCells.has(k)) return true;
    }
    return false;
  };
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

  // reachability check; drop decor if something becomes unreachable
  const solidAt = (r, c, withDecor) => g[r]?.[c] !== "." || solidDesk.has(key(r, c)) || (withDecor && decor.some((d) => d.r === r && d.c === c));
  const reachable = (withDecor) => {
    const start = [spawnRoom.rc, spawnRoom.cc];
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
    return [...stationCells, exitCell].every((s) => vis.has(key(s.r + 1, s.c)));
  };
  if (!reachable(true)) decor = decor.filter((d) => d.type === "plant" && false);

  // patrols: some guard a counter room, others roam through doors between rooms
  const doorPoint = (a, b) => {
    if (a.j === b.j) return [a.rc, b.i > a.i ? a.c1 + 1 : a.c0 - 1];
    return [b.j > a.j ? a.r1 + 1 : a.r0 - 1, a.cc];
  };
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
    const back = fwd.slice(1, -1).reverse();
    return [...fwd, ...back];
  };
  const patrols = [];
  const counts = { few: [2, 3], normal: [4, 5], many: [7, 8] }[S.clerks] || [4, 5];
  const nClerks = counts[0] + Math.floor(R() * (counts[1] - counts[0] + 1));
  const nonSpawn = rooms.filter((r) => r !== spawnRoom);
  const guardRooms = shuffle(R, [...stationRooms, exitRoom]);
  for (let k = 0; k < nClerks; k++) {
    const roam = R() < 0.55;
    let pts = null;
    if (roam) pts = roamPath(pick(R, nonSpawn), 2 + Math.floor(R() * 3));
    if (!pts) {
      const rm = guardRooms[k % guardRooms.length];
      if (rm.c1 - rm.c0 < 2 || rm.r1 - rm.r0 < 2) continue;
      pts = [[rm.r0 + 1, rm.c0 + 1], [rm.r0 + 1, rm.c1 - 1], [rm.r1 - 1, rm.c1 - 1], [rm.r1 - 1, rm.c0 + 1]];
      if (R() < 0.5) pts.reverse();
    }
    patrols.push({ pts, speed: 1.6 + R() * 0.8, offset: R() * 1000, kind: "clerk" });
  }
  if (S.guards) {
    const nGuards = (S.clerks === "many" ? 2 : 1) + (R() < 0.5 ? 1 : 0);
    for (let k = 0; k < nGuards; k++) {
      const pts = roamPath(pick(R, nonSpawn), 3 + Math.floor(R() * 3));
      if (pts) patrols.push({ pts, speed: 2.5, offset: R() * 1000, kind: "guard" });
    }
  }

  // power-up spots: interior, non-border cells of non-spawn rooms
  const powerSpots = [];
  for (const rm of S.powerups ? shuffle(R, rooms.filter((r) => r !== spawnRoom)).slice(0, 6) : []) {
    const r = rm.r0 + 1 + Math.floor(R() * Math.max(1, rm.r1 - rm.r0 - 1));
    const c = rm.c0 + 1 + Math.floor(R() * Math.max(1, rm.c1 - rm.c0 - 1));
    if (solidAt(r, c, true)) continue;
    powerSpots.push({ r, c, type: powerSpots.length % 2 ? "termin" : "coffee" });
  }

  // posters on wall faces
  const posters = [];
  const wallCands = [];
  for (let r = 1; r < H - 1; r++) for (let c = 1; c < W - 1; c++) {
    if (g[r][c] !== "#") continue;
    for (const [dr, dc, rot] of [[1, 0, 0], [-1, 0, Math.PI], [0, 1, Math.PI / 2], [0, -1, -Math.PI / 2]]) {
      if (g[r + dr]?.[c + dc] === "." && !solidDesk.has(key(r + dr, c + dc))) wallCands.push({ r, c, dr, dc, rot });
    }
  }
  for (const w of shuffle(R, wallCands).slice(0, 14)) posters.push({ ...w, text: pick(R, POSTERS) });

  const theme = pick(R, THEMES);
  const floorNo = 1 + Math.floor(R() * 9);
  return { seed, W, H, g, rooms, spawnRoom, exitCell, stationCells, decor, patrols, powerSpots, posters, theme, floorNo };
}
function range(a, b) { const o = []; for (let i = a; i <= b; i++) o.push(i); return o; }

// ---------- textures ----------
function floorTexture(theme, W, H) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const x = c.getContext("2d");
  for (let yy = 0; yy < 4; yy++) for (let xx = 0; xx < 4; xx++) { x.fillStyle = (xx + yy) % 2 ? theme.floor[0] : theme.floor[1]; x.fillRect(xx * 64, yy * 64, 64, 64); }
  x.fillStyle = "rgba(0,0,0,0.05)";
  for (let i = 0; i < 400; i++) x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(W / 2, H / 2); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function wallTexture(theme) {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 128;
  const x = c.getContext("2d");
  x.fillStyle = theme.wallUp; x.fillRect(0, 0, 64, 128);
  x.fillStyle = theme.wallLow; x.fillRect(0, 60, 64, 68);
  x.fillStyle = theme.stripe; x.fillRect(0, 56, 64, 6);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function posterMesh(text, theme) {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 180;
  const x = c.getContext("2d");
  x.fillStyle = "#fffdf3"; x.fillRect(0, 0, 256, 180);
  x.strokeStyle = theme.stripe; x.lineWidth = 10; x.strokeRect(5, 5, 246, 170);
  x.fillStyle = "#1d2433"; x.font = "bold 30px sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
  const words = text.split(" "); const lines = []; let cur = "";
  for (const w of words) { if (x.measureText(cur + " " + w).width > 220 && cur) { lines.push(cur); cur = w; } else cur = cur ? cur + " " + w : w; }
  lines.push(cur);
  lines.forEach((l, i) => x.fillText(l, 128, 90 + (i - (lines.length - 1) / 2) * 36));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.63), new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 }));
}

// ---------- props (loaded once) ----------
let protoPromise = null;
function loadProtos() {
  if (!protoPromise) protoPromise = (async () => {
    const names = ["desk", "stamp", "cabinet", "ticket", "plant", "chairs", "cooler", "printer", "files", "extinguisher", "vending", "coffeemachine", "coffee", "termin"];
    const opts = {
      desk: { maxXZ: 1.9, height: 1.1 }, stamp: { height: 0.85 }, cabinet: { height: 1.4, maxXZ: 1.2 }, ticket: { height: 1.6, maxXZ: 1.0 },
      plant: { height: 1.4, maxXZ: 1.1 }, chairs: { maxXZ: 1.95, height: 1.0 }, cooler: { height: 1.5, maxXZ: 1.0 }, printer: { height: 1.3, maxXZ: 1.5 },
      files: { height: 1.2, maxXZ: 1.2 }, extinguisher: { height: 0.9, maxXZ: 0.6 }, vending: { height: 1.9, maxXZ: 1.4 }, coffeemachine: { height: 1.4, maxXZ: 1.4 },
      coffee: { height: 0.6 }, termin: { height: 0.25, maxXZ: 0.75 },
    };
    const loaded = await Promise.all(names.map((n) => prop(n, opts[n])));
    return Object.fromEntries(names.map((n, i) => [n, loaded[i]]));
  })();
  return protoPromise;
}

// ---------- build ----------
export async function buildWorld(scene, seed, settings) {
  const map = generateMap(seed, settings);
  const { W, H, g, theme } = map;
  const cellToWorld = (r, c) => new THREE.Vector3((c - W / 2 + 0.5) * CS, 0, (r - H / 2 + 0.5) * CS);
  const worldToCell = (x, z) => [Math.floor(z / CS + H / 2), Math.floor(x / CS + W / 2)];
  const group = new THREE.Group();
  scene.add(group);
  const solid = g.map((row) => row.map((ch) => ch === "#"));
  const proto = await loadProtos();

  // floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W * CS, H * CS), new THREE.MeshStandardMaterial({ map: floorTexture(theme, W, H), roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  group.add(floor);

  // walls (instanced)
  const wallCells = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (g[r][c] === "#") wallCells.push([r, c]);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTexture(theme), roughness: 0.8 });
  const topMat = new THREE.MeshStandardMaterial({ color: theme.top });
  const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(CS, WALL_H, CS), [wallMat, wallMat, topMat, topMat, wallMat, wallMat], wallCells.length);
  const m = new THREE.Matrix4();
  wallCells.forEach(([r, c], i) => { const p = cellToWorld(r, c); m.makeTranslation(p.x, WALL_H / 2, p.z); walls.setMatrixAt(i, m); });
  walls.castShadow = true; walls.receiveShadow = true;
  group.add(walls);

  const place = (type, r, c, rot = 0) => {
    const p = cellToWorld(r, c);
    let o = proto[type]?.clone(true);
    if (!o) { o = new THREE.Group(); const b = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1, 1.4), new THREE.MeshStandardMaterial({ color: "#888" })); b.position.y = 0.5; o.add(b); }
    o.position.add(p); o.rotation.y = rot;
    group.add(o);
    return o;
  };

  for (const d of map.decor) { place(d.type, d.r, d.c, d.rot); solid[d.r][d.c] = true; }
  // ticket machine next to spawn
  const sr = map.spawnRoom;
  place("ticket", sr.r0, sr.c1, 0); solid[sr.r0][sr.c1] = true;

  // posters
  for (const p of map.posters) {
    const mesh = posterMesh(p.text, theme);
    const wp = cellToWorld(p.r, p.c);
    mesh.position.set(wp.x + p.dc * (CS / 2 + 0.01), 0.95, wp.z + p.dr * (CS / 2 + 0.01));
    mesh.rotation.y = p.rot;
    group.add(mesh);
  }

  // counters
  const stations = [];
  const counterClerks = [];
  const addCounter = (cell, isExit) => {
    const pos = cellToWorld(cell.r, cell.c);
    place("desk", cell.r, cell.c, 0);
    solid[cell.r][cell.c] = true;
    const label = isExit ? "🏁 Aufenthaltstitel" : `${cell.n} · ${STATIONS[cell.n]}`;
    const sign = textSprite(label, { scale: 1.1, bg: isExit ? "rgba(30,120,60,0.92)" : "rgba(25,40,90,0.9)" });
    sign.position.set(pos.x, 3.4, pos.z);
    group.add(sign);
    counterClerks.push(pos.clone().add(new THREE.Vector3(0, 0, -0.85)));
    const front = cellToWorld(cell.r + 1, cell.c);
    if (isExit) {
      const glow = new THREE.Mesh(new THREE.RingGeometry(1.4, 1.9, 40), new THREE.MeshBasicMaterial({ color: "#3f6", transparent: true, opacity: 0, side: THREE.DoubleSide }));
      glow.rotation.x = -Math.PI / 2; glow.position.set(pos.x, 0.03, pos.z + 0.6);
      group.add(glow);
      return { pos, front, glow, sign };
    }
    const s = proto.stamp ? proto.stamp.clone(true) : new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.4, 16), new THREE.MeshStandardMaterial({ color: "#d22" }));
    const holder = new THREE.Group(); holder.add(s); holder.position.set(pos.x, 2.1, pos.z);
    group.add(holder);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.75, 40), new THREE.MeshBasicMaterial({ color: "#ffd23f", transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(pos.x, 0.03, pos.z + 0.6);
    group.add(ring);
    stations.push({ n: cell.n, name: STATIONS[cell.n], pos, front, holder, ring, sign });
  };
  for (const s of map.stationCells) addCounter(s, false);
  const exit = addCounter(map.exitCell, true);
  stations.sort((a, b) => a.n - b.n);

  for (const p of counterClerks) {
    makeCharacter("clerk", "#7a5230", 1.7).then((ch) => {
      ch.root.position.copy(p); ch.setAnim(0); ch.update(0.016);
      group.add(ch.root);
    });
  }

  // power-ups
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

  // patrols in world space
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

  const spawn = cellToWorld(sr.rc, sr.cc);
  return { map, group, solid, stations, exit, spawn, patrols, powerups, theme, W, H, cellToWorld, worldToCell, spawnRoom: sr };
}

export function disposeWorld(scene, world) {
  if (!world) return;
  scene.remove(world.group);
  world.group.traverse((o) => {
    if (o.isMesh && !o.isSkinnedMesh) {
      if (o.geometry && o.isInstancedMesh) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const mt of mats) if (mt?.map?.isCanvasTexture) mt.map.dispose();
    }
  });
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

// Line of sight on the grid (walls and decor block).
export function hasLOS(world, a, b) {
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.ceil(d / 0.4);
  for (let i = 1; i < steps; i++) {
    const k = i / steps;
    if (isSolid(world, a.x + (b.x - a.x) * k, a.z + (b.z - a.z) * k)) return false;
  }
  return true;
}

// Circle vs solid grid, axis-separated. Returns true if fully moved.
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
