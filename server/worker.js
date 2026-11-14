// Stempel Rush realtime server: one Durable Object per room.
import { DurableObject } from "cloudflare:workers";

const COLORS = ["#ff7a1a", "#2fb4ff", "#9b5cff", "#2ecc71", "#ff4f7b", "#ffd23f", "#00d1b2", "#c0c0c0"];
const RACE_MS = 120_000;
const POINTS = [5, 3, 2];
const COUNTDOWN_MS = 3_500;
const RESULTS_MS = 12_000;
const TICK_MS = 66;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
      const room = (url.searchParams.get("room") || "MUC").toUpperCase().slice(0, 12);
      const stub = env.ROOM.get(env.ROOM.idFromName(room));
      return stub.fetch(req);
    }
    return env.ASSETS.fetch(req);
  },
};

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.players = new Map(); // id -> player
    this.phase = "lobby";
    this.phaseEndsAt = 0;
    this.raceStart = 0;
    this.seed = 1;
    this.results = [];
    this.timer = null;
    this.nextId = 1;
    this.round = 0;
    this.scores = new Map(); // name -> points
  }

  async fetch(req) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    const id = String(this.nextId++);
    const usedColors = new Set([...this.players.values()].map((p) => p.color));
    const color = COLORS.find((c) => !usedColors.has(c)) ?? COLORS[Number(id) % COLORS.length];
    const p = { id, ws: server, name: "Gast", color, x: 0, z: 0, ry: 0, anim: 0, stamps: 0, finished: false, finishMs: 0, host: false, hits: 0 };
    this.players.set(id, p);

    server.addEventListener("message", (ev) => this.onMessage(p, ev.data));
    const bye = () => {
      this.players.delete(id);
      this.broadcast({ t: "left", id });
      if (this.players.size === 0) this.reset();
    };
    server.addEventListener("close", bye);
    server.addEventListener("error", bye);

    this.send(p, { t: "welcome", id, color, phase: this.phase, phaseEndsAt: this.phaseEndsAt, raceStart: this.raceStart, seed: this.seed, round: this.round, now: Date.now(), results: this.results, scores: this.scoreList() });
    this.ensureTimer();
    return new Response(null, { status: 101, webSocket: client });
  }

  onMessage(p, raw) {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    switch (m.t) {
      case "hello":
        p.name = String(m.name || "Gast").slice(0, 16);
        p.host = !!m.host;
        break;
      case "s": // state
        if (typeof m.x === "number") { p.x = m.x; p.z = m.z; p.ry = m.ry; p.anim = m.a | 0; p.stamps = m.st | 0; }
        break;
      case "start":
        if (this.phase === "lobby" || this.phase === "results") this.startCountdown();
        break;
      case "hit":
        p.hits++;
        this.broadcast({ t: "hit", id: p.id, line: m.line | 0 });
        break;
      case "stamp":
        this.broadcast({ t: "stamp", id: p.id, n: m.n | 0 });
        break;
      case "shove": {
        const target = this.players.get(String(m.target));
        if (target && this.phase === "race") this.send(target, { t: "shoved", by: p.name, dx: +m.dx || 0, dz: +m.dz || 0 });
        this.broadcast({ t: "fxshove", id: p.id, target: String(m.target) });
        break;
      }
      case "finish":
        if (this.phase === "race" && !p.finished) {
          p.finished = true;
          p.finishMs = Date.now() - this.raceStart;
          this.results.push({ id: p.id, name: p.name, color: p.color, ms: p.finishMs });
          this.broadcast({ t: "finish", id: p.id, name: p.name, ms: p.finishMs, place: this.results.length });
          const racers = [...this.players.values()].filter((q) => !q.host);
          if (racers.length > 0 && racers.every((q) => q.finished)) this.endRace();
        }
        break;
      case "ping":
        this.send(p, { t: "pong", c: m.c, now: Date.now() });
        break;
    }
  }

  startCountdown() {
    this.phase = "countdown";
    this.round++;
    this.seed = (Math.random() * 1e9) | 0;
    this.results = [];
    this.raceStart = Date.now() + COUNTDOWN_MS;
    this.phaseEndsAt = this.raceStart;
    for (const p of this.players.values()) { p.finished = false; p.finishMs = 0; p.stamps = 0; p.hits = 0; }
    this.broadcastPhase();
  }

  endRace() {
    this.phase = "results";
    this.phaseEndsAt = Date.now() + RESULTS_MS;
    // Unfinished racers ranked by stamps
    const unfinished = [...this.players.values()]
      .filter((p) => !p.finished && !p.host)
      .sort((a, b) => b.stamps - a.stamps)
      .map((p) => ({ id: p.id, name: p.name, color: p.color, ms: 0, stamps: p.stamps }));
    this.results = [...this.results, ...unfinished];
    this.results.forEach((r, i) => {
      const pts = r.ms ? (POINTS[i] ?? 1) : 0;
      r.pts = pts;
      this.scores.set(r.name, (this.scores.get(r.name) || 0) + pts);
      r.total = this.scores.get(r.name);
    });
    this.broadcastPhase();
  }

  reset() {
    this.phase = "lobby";
    this.results = [];
    this.scores.clear();
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  ensureTimer() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  tick() {
    const now = Date.now();
    if (this.phase === "countdown" && now >= this.raceStart) {
      this.phase = "race";
      this.phaseEndsAt = this.raceStart + RACE_MS;
      this.broadcastPhase();
    } else if (this.phase === "race" && now >= this.phaseEndsAt) {
      this.endRace();
    } else if (this.phase === "results" && now >= this.phaseEndsAt) {
      this.phase = "lobby";
      this.broadcastPhase();
    }
    const ps = [];
    for (const p of this.players.values()) ps.push([p.id, p.name, p.color, +p.x.toFixed(2), +p.z.toFixed(2), +p.ry.toFixed(2), p.anim, p.stamps, p.finished ? 1 : 0, p.host ? 1 : 0]);
    this.broadcast({ t: "snap", now, ps });
  }

  broadcastPhase() {
    this.broadcast({ t: "phase", phase: this.phase, phaseEndsAt: this.phaseEndsAt, raceStart: this.raceStart, seed: this.seed, round: this.round, now: Date.now(), results: this.results, scores: this.scoreList() });
  }

  scoreList() {
    return [...this.scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }

  send(p, m) {
    try { p.ws.send(JSON.stringify(m)); } catch {}
  }

  broadcast(m) {
    const s = JSON.stringify(m);
    for (const p of this.players.values()) { try { p.ws.send(s); } catch {} }
  }
}
