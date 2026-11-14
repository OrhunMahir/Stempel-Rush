// Tiny WebAudio sound manager. Files live in /audio/<name>.mp3; missing files fall back to a beep.
let ctx = null;
const buffers = {};
let musicNode = null;
let musicGain = null;

export const LINES = {
  hit: [
    "Haben Sie überhaupt einen Termin?",
    "Nehmen Sie bitte eine Nummer!",
    "Dafür bin ich nicht zuständig.",
    "Das Formular ist unvollständig!",
    "Kommen Sie nächste Woche wieder.",
    "Ohne Anmeldung geht hier gar nichts!",
  ],
  stamp: ["Gestempelt. Der Nächste, bitte!", "So. Zack. Erledigt.", "Na gut. Ausnahmsweise."],
  spot: ["HALT! Stehen bleiben!", "Sie da! Wo ist Ihre Wartenummer?", "Hier wird NICHT gerannt!", "Moment mal, junger Mensch!", "Zurück in die Schlange!"],
};

export function unlock() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
}

async function load(name) {
  if (name in buffers) return buffers[name];
  buffers[name] = (async () => {
    try {
      const r = await fetch(`./audio/${name}.mp3`);
      if (!r.ok) return null;
      const ab = await r.arrayBuffer();
      return await ctx.decodeAudioData(ab);
    } catch { return null; }
  })();
  return buffers[name];
}

export function preload(names) { if (ctx) names.forEach(load); }

function beep(freq = 440, dur = 0.12, type = "square", vol = 0.08) {
  if (!ctx) return;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
  o.connect(g).connect(ctx.destination);
  o.start(); o.stop(ctx.currentTime + dur);
}

const FALLBACK = {
  stamp_sfx: () => { beep(120, 0.15, "square", 0.2); },
  ding: () => { beep(880, 0.25, "sine", 0.15); setTimeout(() => beep(660, 0.3, "sine", 0.12), 140); },
  buzz: () => beep(90, 0.35, "sawtooth", 0.12),
  tick: () => beep(1200, 0.05, "square", 0.05),
};

export async function play(name, { vol = 1, rate = 1 } = {}) {
  if (!ctx) return;
  const b = await load(name);
  if (!b) { (FALLBACK[name] || (() => beep()))(); return; }
  const src = ctx.createBufferSource();
  src.buffer = b; src.playbackRate.value = rate;
  const g = ctx.createGain(); g.gain.value = vol;
  src.connect(g).connect(ctx.destination);
  src.start();
}

let musicName = null;
export async function music(name = "music", vol = 0.25) {
  if (!ctx || musicName === name) return;
  musicName = name;
  const b = await load(name);
  if (!b || musicName !== name) return;
  const old = musicNode, oldGain = musicGain;
  musicNode = ctx.createBufferSource();
  musicNode.buffer = b; musicNode.loop = true;
  musicGain = ctx.createGain(); musicGain.gain.value = 0;
  musicGain.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.6);
  musicNode.connect(musicGain).connect(ctx.destination);
  musicNode.start();
  if (old) { oldGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6); setTimeout(() => { try { old.stop(); } catch {} }, 700); }
}

let ambNode = null;
export async function ambience(name = "ambience", vol = 0.16) {
  if (!ctx || ambNode) return;
  const b = await load(name);
  if (!b || ambNode) return;
  ambNode = ctx.createBufferSource(); ambNode.buffer = b; ambNode.loop = true;
  const g = ctx.createGain(); g.gain.value = vol;
  ambNode.connect(g).connect(ctx.destination); ambNode.start();
}

export function musicVolume(v) { if (musicGain) musicGain.gain.value = v; }
