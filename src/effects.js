import * as THREE from "three";

// ---------- paper / dust particles (one pooled InstancedMesh each) ----------
export class Particles {
  constructor(scene, { count = 300, size = 0.18, color = "#ffffff", gravity = -9, drag = 1.5, spin = true } = {}) {
    this.geo = new THREE.PlaneGeometry(size, size * 1.3);
    this.mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    scene.add(this.mesh);
    this.p = Array.from({ length: count }, () => ({ life: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(), rv: new THREE.Vector3(), s: 1 }));
    this.i = 0; this.gravity = gravity; this.drag = drag; this.spin = spin;
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.sc = new THREE.Vector3(); this.c = new THREE.Color();
    this.hide();
  }
  hide() { const z = new THREE.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < this.p.length; i++) this.mesh.setMatrixAt(i, z); this.mesh.instanceMatrix.needsUpdate = true; }
  burst(pos, n = 30, { speed = 5, up = 5, colors = ["#ffffff", "#f6f0dc", "#ffe9a8"], life = 1.4, scale = 1 } = {}) {
    for (let k = 0; k < n; k++) {
      const p = this.p[this.i]; this.i = (this.i + 1) % this.p.length;
      p.life = life * (0.6 + Math.random() * 0.6); p.max = p.life;
      p.pos.copy(pos);
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random());
      p.vel.set(Math.cos(a) * s, up * (0.5 + Math.random()), Math.sin(a) * s);
      p.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      p.rv.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);
      p.s = scale * (0.7 + Math.random() * 0.6);
      this.mesh.setColorAt(this.p.indexOf(p), this.c.set(colors[Math.floor(Math.random() * colors.length)]));
    }
    this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt) {
    let any = false;
    for (let i = 0; i < this.p.length; i++) {
      const p = this.p[i];
      if (p.life <= 0) continue;
      any = true;
      p.life -= dt;
      p.vel.y += this.gravity * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - this.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < 0.02) { p.pos.y = 0.02; p.vel.set(0, 0, 0); p.rv.set(0, 0, 0); }
      if (this.spin) { p.rot.x += p.rv.x * dt; p.rot.y += p.rv.y * dt; p.rot.z += p.rv.z * dt; }
      const s = p.life > 0 ? p.s * Math.min(1, p.life / (p.max * 0.3)) : 0;
      this.q.setFromEuler(p.rot); this.sc.set(s, s, s);
      this.m.compose(p.pos, this.q, this.sc);
      this.mesh.setMatrixAt(i, this.m);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------- camera shake ----------
export const shake = { t: 0, amp: 0 };
export function addShake(amp = 0.3, t = 0.35) { shake.amp = Math.max(shake.amp, amp); shake.t = Math.max(shake.t, t); }
export function applyShake(camera, dt) {
  if (shake.t <= 0) return;
  shake.t -= dt;
  const a = shake.amp * Math.max(0, shake.t) * 3;
  camera.position.x += (Math.random() - 0.5) * a;
  camera.position.y += (Math.random() - 0.5) * a;
  camera.position.z += (Math.random() - 0.5) * a;
  if (shake.t <= 0) shake.amp = 0;
}

// ---------- DOM overlays ----------
let fx = null;
function layer() {
  if (fx) return fx;
  fx = document.createElement("div");
  fx.id = "fx";
  document.body.appendChild(fx);
  return fx;
}

export function stampSlam(title, sub = "GESTEMPELT") {
  const el = document.createElement("div");
  el.className = "slam";
  el.innerHTML = `<div class="slamInner"><div class="slamTitle">${title}</div><div class="slamSub">${sub}</div></div>`;
  layer().appendChild(el);
  setTimeout(() => el.classList.add("out"), 900);
  setTimeout(() => el.remove(), 1400);
}

export function flash(color = "rgba(215,38,61,0.45)") {
  const el = document.createElement("div");
  el.className = "flash";
  el.style.boxShadow = `inset 0 0 160px 60px ${color}`;
  layer().appendChild(el);
  setTimeout(() => el.remove(), 600);
}

export function banner(html, ms = 2600, cls = "") {
  const el = document.createElement("div");
  el.className = "banner " + cls;
  el.innerHTML = html;
  layer().appendChild(el);
  setTimeout(() => el.classList.add("out"), ms - 400);
  setTimeout(() => el.remove(), ms);
}

// "!" (or "?") above a clerk
export function alertSprite(ch = "!") {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d");
  x.fillStyle = ch === "!" ? "#ffd23f" : "#ffffff"; x.beginPath(); x.arc(64, 64, 56, 0, Math.PI * 2); x.fill();
  x.lineWidth = 8; x.strokeStyle = "#1d2433"; x.stroke();
  x.fillStyle = ch === "!" ? "#d7263d" : "#1d2433"; x.font = "bold 92px sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(ch, 64, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(0.7, 0.7, 1); s.renderOrder = 11; s.visible = false;
  return s;
}

// Vision cone mesh (flat sector on the floor)
export function coneMesh(range, angle) {
  // Sector centred on +Z (the facing direction used by atan2(x, z) everywhere in the game).
  const geo = new THREE.CircleGeometry(range, 24, Math.PI / 2 - angle / 2, angle);
  geo.rotateX(Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color: "#ffd23f", transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = 0.04;
  m.renderOrder = 2;
  return m;
}
