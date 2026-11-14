import * as THREE from "three";
import { prop, textSprite, makeCharacter } from "./assets.js";

export const CS = 2; // cell size (m)
export const WALL_H = 1.5;

// # wall, + door, S spawn, 1-5 stamp counters, E exit counter, T ticket machine
export const MAP = [
  "#######################",
  "#S....#.......#.......#",
  "#.....#...1...#...2...#",
  "#.....#.......#.......#",
  "#.....+.......+.......#",
  "#.....#.......#.......#",
  "####+#####+#######+####",
  "#.....................#",
  "#..T..............T...#",
  "#.....................#",
  "####+#######+#####+####",
  "#.......#.......#.....#",
  "#...3...#...4...#..5..#",
  "#.......#.......#.....#",
  "#.......+.......+...E.#",
  "#######################",
];
export const H = MAP.length;
export const W = MAP[0].length;

export const STATIONS = {
  1: "Anmeldung",
  2: "Meldebescheinigung",
  3: "Krankenkasse",
  4: "Steuer-ID",
  5: "Fingerabdruck",
};

export const cellToWorld = (r, c) => new THREE.Vector3((c - W / 2 + 0.5) * CS, 0, (r - H / 2 + 0.5) * CS);
export const worldToCell = (x, z) => [Math.floor(z / CS + H / 2), Math.floor(x / CS + W / 2)];

// Decor: [type, r, c, rotY]
const DECOR = [
  ["chairs", 8, 7, 0], ["chairs", 8, 13, 0],
  ["plant", 1, 5, 0], ["plant", 5, 1, 0], ["plant", 1, 7, 0], ["plant", 5, 13, 0], ["plant", 5, 21, 0],
  ["plant", 11, 1, 0], ["plant", 13, 15, 0], ["plant", 11, 21, 0], ["plant", 13, 9, 0],
  ["cabinet", 3, 1, Math.PI / 2], ["cabinet", 5, 7, 0], ["cabinet", 3, 13, -Math.PI / 2], ["cabinet", 5, 15, 0],
  ["cabinet", 11, 7, 0], ["cabinet", 11, 9, 0], ["cabinet", 13, 21, -Math.PI / 2],
];

// Clerk patrols in cells; a 2-point loop is a back-and-forth.
export const PATROLS = [
  { pts: [[7, 1], [7, 21]], speed: 2.4, offset: 0 },
  { pts: [[9, 21], [9, 1]], speed: 2.1, offset: 9 },
  { pts: [[1, 8], [1, 12], [4, 12], [4, 8]], speed: 2.0, offset: 3 },
  { pts: [[1, 16], [1, 21], [4, 21], [4, 16]], speed: 2.2, offset: 5 },
  { pts: [[14, 1], [14, 15]], speed: 2.3, offset: 2 },
  { pts: [[11, 17], [11, 20], [13, 20], [13, 17]], speed: 1.8, offset: 7 },
];

function floorTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    g.fillStyle = (x + y) % 2 ? "#cfc6b0" : "#bdb39b";
    g.fillRect(x * 64, y * 64, 64, 64);
  }
  g.fillStyle = "rgba(0,0,0,0.05)";
  for (let i = 0; i < 400; i++) g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(W / 2, H / 2);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function wallTexture() {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#f1ead3"; g.fillRect(0, 0, 64, 128);
  g.fillStyle = "#8fbf9f"; g.fillRect(0, 60, 64, 68);
  g.fillStyle = "#5e8f73"; g.fillRect(0, 56, 64, 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export async function buildWorld(scene) {
  const solid = MAP.map((row) => [...row].map((ch) => ch === "#"));
  const stations = [];
  let exit = null;
  const spawn = [];

  // Floor
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(W * CS, H * CS),
    new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.9 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Walls (instanced)
  const wallCells = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (MAP[r][c] === "#") wallCells.push([r, c]);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.8 });
  const topMat = new THREE.MeshStandardMaterial({ color: "#6b6f78" });
  const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(CS, WALL_H, CS), [wallMat, wallMat, topMat, topMat, wallMat, wallMat], wallCells.length);
  const m = new THREE.Matrix4();
  wallCells.forEach(([r, c], i) => {
    const p = cellToWorld(r, c);
    m.makeTranslation(p.x, WALL_H / 2, p.z);
    walls.setMatrixAt(i, m);
  });
  walls.castShadow = true; walls.receiveShadow = true;
  scene.add(walls);

  // Load props once
  const [desk, stamp, cabinet, ticket, plant, chairs] = await Promise.all([
    prop("desk", { maxXZ: 1.9, height: 1.1 }),
    prop("stamp", { height: 0.85 }),
    prop("cabinet", { height: 1.4, maxXZ: 1.2 }),
    prop("ticket", { height: 1.6, maxXZ: 1.0 }),
    prop("plant", { height: 1.4, maxXZ: 1.1 }),
    prop("chairs", { maxXZ: 1.95, height: 1.0 }),
  ]);
  const proto = { desk, stamp, cabinet, ticket, plant, chairs };
  const place = (type, r, c, rot = 0, color = "#888") => {
    const p = cellToWorld(r, c);
    let o = proto[type]?.clone(true);
    if (!o) {
      o = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1, 1.6), new THREE.MeshStandardMaterial({ color }));
      o.position.y = 0.5;
      const g = new THREE.Group(); g.add(o); o = g;
    }
    o.position.add(p);
    o.rotation.y = rot;
    scene.add(o);
    return o;
  };

  for (const [type, r, c, rot] of DECOR) { place(type, r, c, rot); solid[r][c] = true; }

  // Clerk proto for behind counters (static, no animation)
  const counterClerks = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const ch = MAP[r][c];
    if (ch === "S") spawn.push(cellToWorld(r, c));
    if (ch === "T") { place("ticket", r, c, 0, "#c33"); solid[r][c] = true; }
    if ((ch >= "1" && ch <= "5") || ch === "E") {
      const isExit = ch === "E";
      const pos = cellToWorld(r, c);
      place("desk", r, c, 0, isExit ? "#3a6" : "#a87");
      solid[r][c] = true;
      const label = isExit ? "🏁 Aufenthaltstitel" : `${ch} · ${STATIONS[ch]}`;
      const sign = textSprite(label, { scale: 1.1, bg: isExit ? "rgba(30,120,60,0.9)" : "rgba(25,40,90,0.88)" });
      sign.position.set(pos.x, 3.4, pos.z);
      scene.add(sign);
      counterClerks.push(pos.clone().add(new THREE.Vector3(0, 0, -0.85)));
      if (isExit) {
        const glow = new THREE.Mesh(new THREE.RingGeometry(1.4, 1.9, 40), new THREE.MeshBasicMaterial({ color: "#3f6", transparent: true, opacity: 0.0, side: THREE.DoubleSide }));
        glow.rotation.x = -Math.PI / 2; glow.position.set(pos.x, 0.03, pos.z);
        scene.add(glow);
        exit = { pos, glow };
      } else {
        let s = stamp ? stamp.clone(true) : new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.4, 16), new THREE.MeshStandardMaterial({ color: "#d22" }));
        const holder = new THREE.Group(); holder.add(s);
        holder.position.set(pos.x, 2.1, pos.z);
        scene.add(holder);
        const ring = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.75, 40), new THREE.MeshBasicMaterial({ color: "#ffd23f", transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2; ring.position.set(pos.x, 0.03, pos.z);
        scene.add(ring);
        stations.push({ n: Number(ch), name: STATIONS[ch], pos, holder, ring });
      }
    }
  }
  stations.sort((a, b) => a.n - b.n);

  // Static clerks behind counters
  for (const p of counterClerks) {
    makeCharacter("clerk", "#7a5230", 1.7).then((ch) => {
      ch.root.position.copy(p);
      ch.root.rotation.y = 0; // face +z (towards the player side)
      ch.setAnim(0);
      ch.update(0.016); // apply idle pose (otherwise the bind T-pose shows)
      scene.add(ch.root);
    });
  }

  // Patrols in world space
  const patrols = PATROLS.map((pt) => {
    const pts = pt.pts.map(([r, c]) => cellToWorld(r, c));
    const segs = [];
    let L = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const len = a.distanceTo(b);
      segs.push({ a, b, len, start: L });
      L += len;
    }
    return { ...pt, segs, L };
  });

  return { solid, stations, exit, spawn: spawn[0], patrols };
}

export function patrolPos(p, t, out) {
  let s = ((t * p.speed + p.offset) % p.L + p.L) % p.L;
  for (const seg of p.segs) {
    if (s <= seg.start + seg.len) {
      const k = (s - seg.start) / seg.len;
      out.pos.lerpVectors(seg.a, seg.b, k);
      out.ry = Math.atan2(seg.b.x - seg.a.x, seg.b.z - seg.a.z);
      return out;
    }
  }
  out.pos.copy(p.segs[0].a);
  return out;
}

export function isSolid(world, x, z) {
  const [r, c] = worldToCell(x, z);
  if (r < 0 || c < 0 || r >= H || c >= W) return true;
  return world.solid[r][c];
}

// Circle vs solid grid, axis-separated.
export function moveWithCollision(world, pos, dx, dz, radius = 0.38) {
  const tryAxis = (nx, nz) => {
    for (const [ox, oz] of [[radius, radius], [radius, -radius], [-radius, radius], [-radius, -radius], [radius, 0], [-radius, 0], [0, radius], [0, -radius]]) {
      if (isSolid(world, nx + ox, nz + oz)) return false;
    }
    return true;
  };
  if (tryAxis(pos.x + dx, pos.z)) pos.x += dx;
  if (tryAxis(pos.x, pos.z + dz)) pos.z += dz;
}
