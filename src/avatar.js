import * as THREE from "three";
import { makeCharacter } from "./assets.js";

export const MODELS = [
  { id: "player", name: "Student" },
  { id: "p_business", name: "Business" },
  { id: "p_grandma", name: "Oma" },
  { id: "p_tourist", name: "Tourist" },
  { id: "p_punk", name: "Punk" },
  { id: "p_scientist", name: "Forscherin" },
];
export const COLORS = [null, "#ff7a1a", "#2fb4ff", "#9b5cff", "#2ecc71", "#ff4f7b", "#ffd23f", "#1d2433", "#ffffff"];
export const HATS = [["none", "Keiner"], ["cap", "Kappe"], ["tyrol", "Tirolerhut"], ["crown", "Krone"], ["party", "Partyhut"], ["tophat", "Zylinder"]];
export const GLASSES = [["none", "Keine"], ["sun", "Sonnenbrille"], ["nerd", "Nerdbrille"]];
export const BEARDS = [["none", "Ohne"], ["stache", "Schnurrbart"]];
export const DEFAULT_AVATAR = { m: "player", c: null, hat: "none", gl: "none", br: "none" };

export function sanitize(a = {}) {
  const ok = (v, list) => (list.some((x) => (Array.isArray(x) ? x[0] : x.id ?? x) === v) ? v : undefined);
  return {
    m: ok(a.m, MODELS) ?? "player",
    c: typeof a.c === "string" && /^#[0-9a-f]{6}$/i.test(a.c) ? a.c : null,
    hat: ok(a.hat, HATS) ?? "none",
    gl: ok(a.gl, GLASSES) ?? "none",
    br: ok(a.br, BEARDS) ?? "none",
  };
}
export function loadAvatar() {
  try { return sanitize(JSON.parse(localStorage.getItem("sr_avatar") || "{}")); } catch { return { ...DEFAULT_AVATAR }; }
}
export function saveAvatar(a) { try { localStorage.setItem("sr_avatar", JSON.stringify(a)); } catch {} }

// ---------- accessory meshes (metres, origin at the attachment point) ----------
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });
function hatMesh(type, tint) {
  const g = new THREE.Group();
  const add = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  if (type === "cap") {
    const mat = std(tint || "#d7263d");
    add(new THREE.SphereGeometry(0.125, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat, 0, -0.02, 0);
    const brim = add(new THREE.BoxGeometry(0.2, 0.015, 0.13), mat, 0, -0.015, 0.13);
    brim.rotation.x = 0.12;
  } else if (type === "tyrol") {
    const felt = std("#3f5e3a");
    add(new THREE.CylinderGeometry(0.17, 0.17, 0.015, 24), felt, 0, -0.01, 0);
    add(new THREE.CylinderGeometry(0.075, 0.1, 0.13, 20), felt, 0, 0.06, 0);
    add(new THREE.CylinderGeometry(0.102, 0.102, 0.025, 20), std("#7a4a2a"), 0, 0.01, 0);
    const feather = add(new THREE.ConeGeometry(0.015, 0.2, 8), std("#e8e2d0"), 0.09, 0.1, -0.02);
    feather.rotation.z = -0.5;
  } else if (type === "crown") {
    const gold = std("#ffd23f", { metalness: 0.7, roughness: 0.25 });
    add(new THREE.CylinderGeometry(0.11, 0.11, 0.07, 12, 1, true), gold, 0, 0.02, 0).material.side = THREE.DoubleSide;
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; add(new THREE.ConeGeometry(0.025, 0.06, 6), gold, Math.cos(a) * 0.1, 0.085, Math.sin(a) * 0.1); }
    add(new THREE.SphereGeometry(0.02, 8, 6), std("#d7263d"), 0, 0.02, 0.11);
  } else if (type === "party") {
    const cone = add(new THREE.ConeGeometry(0.08, 0.24, 18), std(tint || "#9b5cff"), 0, 0.11, 0);
    cone.rotation.z = 0.15;
    add(new THREE.SphereGeometry(0.03, 10, 8), std("#ffd23f"), -0.018, 0.235, 0);
  } else if (type === "tophat") {
    const black = std("#1d2433");
    add(new THREE.CylinderGeometry(0.16, 0.16, 0.012, 24), black, 0, -0.01, 0);
    add(new THREE.CylinderGeometry(0.095, 0.095, 0.2, 20), black, 0, 0.095, 0);
    add(new THREE.CylinderGeometry(0.097, 0.097, 0.03, 20), std("#d7263d"), 0, 0.02, 0);
  }
  return g;
}
function glassesMesh(type) {
  const g = new THREE.Group();
  if (type === "sun") {
    const lens = new THREE.MeshStandardMaterial({ color: "#111", roughness: 0.15, metalness: 0.4 });
    for (const s of [-1, 1]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.045, 0.012), lens); m.position.set(s * 0.045, 0, 0); g.add(m); }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.012, 0.012), lens); bar.position.set(0, 0.018, 0); g.add(bar);
  } else if (type === "nerd") {
    const frame = std("#1d2433");
    for (const s of [-1, 1]) { const m = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.007, 6, 18), frame); m.position.set(s * 0.045, 0, 0); g.add(m); }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.008, 0.008), frame); g.add(bridge);
  }
  return g;
}
function stacheMesh() {
  const g = new THREE.Group();
  const mat = std("#3b2a1e");
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.05, 4, 8), mat);
    m.rotation.z = s * (Math.PI / 2 - 0.35); m.position.set(s * 0.028, -0.006, 0);
    g.add(m);
  }
  return g;
}

// Tint clothes and attach accessories. Call right after makeCharacter (root at origin, unrotated).
export function decorate(char, av) {
  if (!char || char.primitive) return char;
  const a = sanitize(av);
  if (a.c) {
    const col = new THREE.Color(a.c);
    char.root.traverse((o) => { if (o.isMesh && o.material && !o.userData.acc) { o.material = o.material.clone(); o.material.color.lerp(col, 0.45); } });
  }
  char.update?.(0.001);
  const root = char.root;
  root.updateMatrixWorld(true);
  let head = null, top = null, front = null;
  root.traverse((o) => { if (o.name === "Head") head = o; if (o.name === "head_end") top = o; if (o.name === "headfront") front = o; });
  if (!head) return char;
  const wp = (o) => o.getWorldPosition(new THREE.Vector3());
  const headP = wp(head);
  const topP = top ? wp(top) : headP.clone().add(new THREE.Vector3(0, 0.22, 0));
  const frontP = front ? wp(front) : headP.clone().add(new THREE.Vector3(0, 0.1, 0.11));
  const attach = (mesh, pos) => {
    mesh.traverse((o) => { o.userData.acc = true; });
    root.add(mesh);
    mesh.position.copy(root.worldToLocal(pos.clone()));
    root.updateMatrixWorld(true);
    head.attach(mesh);
  };
  if (a.hat !== "none") attach(hatMesh(a.hat, a.c), topP.clone().add(new THREE.Vector3(0, -0.035, 0)));
  if (a.gl !== "none") attach(glassesMesh(a.gl), new THREE.Vector3(frontP.x, Math.max(frontP.y, headP.y + 0.07), frontP.z + 0.01));
  if (a.br !== "none") attach(stacheMesh(), new THREE.Vector3(frontP.x, Math.max(frontP.y, headP.y + 0.07) - 0.06, frontP.z + 0.005));
  return char;
}

export async function makeAvatar(av, ringColor, height = 1.75) {
  const a = sanitize(av);
  const ch = await makeCharacter(a.m, ringColor, height);
  return decorate(ch, a);
}

// ---------- small rotating 3D preview ----------
export class Preview {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    this.camera.position.set(0, 1.25, 4.2);
    this.camera.lookAt(0, 0.95, 0);
    this.scene.add(new THREE.HemisphereLight("#fff8e8", "#6a6f80", 1.6));
    const d = new THREE.DirectionalLight("#ffffff", 2.2); d.position.set(2, 4, 3); this.scene.add(d);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.75, 40), new THREE.MeshBasicMaterial({ color: "#000", transparent: true, opacity: 0.12 }));
    disc.rotation.x = -Math.PI / 2; this.scene.add(disc);
    this.char = null; this.running = false; this.token = 0;
  }
  async set(av) {
    const tk = ++this.token;
    const ch = await makeAvatar(av, "#ff7a1a");
    if (tk !== this.token) return;
    if (this.char) this.scene.remove(this.char.root);
    ch.setAnim?.(1);
    this.char = ch;
    this.scene.add(ch.root);
  }
  start() {
    if (this.running) return;
    this.running = true;
    const w = this.canvas.clientWidth || 220, h = this.canvas.clientHeight || 260;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    let last = performance.now();
    const tick = () => {
      if (!this.running) return;
      const now = performance.now(); const dt = (now - last) / 1000; last = now;
      if (this.char) { this.char.root.rotation.y += dt * 0.9; this.char.update?.(dt); }
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(tick);
    };
    tick();
  }
  stop() { this.running = false; }
}
