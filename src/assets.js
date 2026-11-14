import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const cache = {};

export function loadGLB(name) {
  if (!(name in cache)) {
    cache[name] = loader.loadAsync(`./models/${name}.glb`).catch(() => null);
  }
  return cache[name];
}

// Wrap obj in a group so that it stands on y=0, centred on x/z, scaled to `height` (or to fit `maxXZ` footprint).
export function fit(obj, { height, maxXZ } = {}) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  let s = 1;
  if (height) s = height / (size.y || 1);
  if (maxXZ) s = Math.min(height ? s : Infinity, maxXZ / (Math.max(size.x, size.z) || 1));
  obj.scale.multiplyScalar(s);
  const box2 = new THREE.Box3().setFromObject(obj);
  const c = box2.getCenter(new THREE.Vector3());
  obj.position.x -= c.x;
  obj.position.z -= c.z;
  obj.position.y -= box2.min.y;
  const g = new THREE.Group();
  g.add(obj);
  return g;
}

export function shadowify(obj) {
  obj.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
  return obj;
}

// Remove horizontal root motion so the character walks in place (we move it ourselves).
function inPlace(clip) {
  const c = clip.clone();
  for (const tr of c.tracks) {
    if (!tr.name.endsWith(".position")) continue;
    const v = tr.values;
    const x0 = v[0], z0 = v[2];
    for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
  }
  return c;
}

export async function prop(name, opts) {
  const g = await loadGLB(name);
  if (!g) return null;
  return shadowify(fit(g.scene.clone(true), opts));
}

function primitiveCharacter(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.8, 4, 12), mat);
  body.position.y = 0.75;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), new THREE.MeshStandardMaterial({ color: "#f2c9a0" }));
  head.position.y = 1.5;
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.2), mat);
  nose.position.set(0, 1.5, 0.28);
  g.add(body, head, nose);
  return shadowify(g);
}

// base: "player" | "clerk"
export async function makeCharacter(base, color = "#ff7a1a", height = 1.75) {
  const [rig, walk, run] = await Promise.all([loadGLB(`${base}_rigged`), loadGLB(`${base}_walk`), loadGLB(`${base}_run`)]);
  if (!rig) {
    const root = primitiveCharacter(color);
    let t = 0;
    return {
      root, primitive: true,
      setAnim() {},
      update(dt, moving) { t += dt * (moving ? 12 : 0); root.children[0].position.y = 0.75 + Math.abs(Math.sin(t)) * 0.06; },
    };
  }
  const model = SkeletonUtils.clone(rig.scene);
  model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  // Meshy rigging output is already in metres (height_meters: 1.75); Box3 on skinned meshes is unreliable.
  model.scale.multiplyScalar(height / 1.75);
  const root = new THREE.Group();
  root.add(model);
  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  const walkClip = walk?.animations?.[0];
  const runClip = run?.animations?.[0];
  if (walkClip) actions.walk = mixer.clipAction(inPlace(walkClip));
  if (runClip) actions.run = mixer.clipAction(inPlace(runClip));
  let current = null;
  const idle = actions.walk;
  if (idle) { idle.play(); idle.paused = true; idle.time = 0; current = "idle"; }
  return {
    root, mixer, actions,
    setAnim(a) { // 0 idle, 1 walk, 2 run
      const name = a === 2 ? (actions.run ? "run" : "walk") : a === 1 ? "walk" : "idle";
      if (name === current) return;
      const next = name === "idle" ? actions.walk : actions[name];
      for (const k in actions) if (actions[k] !== next) actions[k].fadeOut(0.15);
      if (next) {
        next.reset().fadeIn(0.15).play();
        next.paused = name === "idle";
        if (name === "idle") next.time = 0;
      }
      current = name;
    },
    update(dt) { mixer.update(dt); },
  };
}

export function textSprite(text, { color = "#fff", bg = "rgba(20,20,30,0.75)", size = 48, scale = 1 } = {}) {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  ctx.font = `bold ${size}px system-ui, sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + size;
  c.width = w; c.height = size * 1.6;
  ctx.font = `bold ${size}px system-ui, sans-serif`;
  ctx.fillStyle = bg;
  const r = size * 0.5;
  ctx.beginPath(); ctx.roundRect(0, 0, c.width, c.height, r); ctx.fill();
  ctx.fillStyle = color; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, c.width / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  const h = 0.5 * scale;
  s.scale.set((h * c.width) / c.height, h, 1);
  s.renderOrder = 10;
  return s;
}
