#!/usr/bin/env node
// Minimal Meshy API client for the jam.
// Key: MESHY_API_KEY env, else ~/.claude.json -> mcpServers.meshy.env.MESHY_API_KEY. Never printed.
//
// Usage:
//   node tools/meshy.mjs balance
//   node tools/meshy.mjs gen <name> "<prompt>" [--rig] [--poly 15000] [--model latest]
//     -> public/models/<name>.glb  (+ <name>_walk.glb, <name>_run.glb with --rig)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOST = "https://api.meshy.ai";
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../public/models");
const LOG = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../assets-log");

function key() {
  if (process.env.MESHY_API_KEY) return process.env.MESHY_API_KEY;
  const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".claude.json"), "utf8"));
  const k = cfg?.mcpServers?.meshy?.env?.MESHY_API_KEY;
  if (!k) throw new Error("MESHY_API_KEY not found in env or ~/.claude.json");
  return k;
}
const KEY = key();

async function api(method, p, body) {
  const r = await fetch(HOST + p, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${p} -> ${r.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (name, msg) => console.log(`[${new Date().toLocaleTimeString("de-DE")}] ${name}: ${msg}`);

async function waitTask(name, p, id) {
  let last = -1;
  for (;;) {
    const t = await api("GET", `${p}/${id}`);
    if (t.progress !== last) { log(name, `${p.split("/").pop()} ${t.status} ${t.progress ?? ""}%`); last = t.progress; }
    if (t.status === "SUCCEEDED") return t;
    if (t.status === "FAILED" || t.status === "CANCELED" || t.status === "EXPIRED")
      throw new Error(`${name} task ${id} ${t.status}: ${JSON.stringify(t.task_error ?? {})}`);
    await sleep(5000);
  }
}

async function download(url, file) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  return fs.statSync(file).size;
}

function record(name, data) {
  fs.mkdirSync(LOG, { recursive: true });
  fs.writeFileSync(path.join(LOG, `${name}.json`), JSON.stringify(data, null, 2));
}

async function gen(name, prompt, { rig = false, poly = 15000, model = "latest" } = {}) {
  const T = "/openapi/v2/text-to-3d";
  const preview = await api("POST", T, {
    mode: "preview",
    prompt,
    ai_model: model,
    moderation: false,
    should_remesh: true,
    topology: "triangle",
    target_polycount: poly,
    ...(rig ? { pose_mode: "t-pose" } : {}),
  });
  const previewId = preview.result;
  log(name, `preview task ${previewId}`);
  await waitTask(name, T, previewId);

  const refine = await api("POST", T, { mode: "refine", preview_task_id: previewId, enable_pbr: false });
  const refineId = refine.result;
  log(name, `refine task ${refineId}`);
  const done = await waitTask(name, T, refineId);
  const glb = done.model_urls?.glb;
  if (!glb) throw new Error(`${name}: no glb url`);
  const size = await download(glb, path.join(OUT, `${name}.glb`));
  log(name, `saved ${name}.glb (${(size / 1e6).toFixed(1)} MB)`);
  const rec = { name, prompt, model, poly, previewId, refineId, thumbnail: done.thumbnail_url };

  if (rig) {
    const R = "/openapi/v1/rigging";
    const rt = await api("POST", R, { input_task_id: refineId, height_meters: 1.75 });
    const rigId = rt.result;
    log(name, `rig task ${rigId}`);
    const rr = await waitTask(name, R, rigId);
    const res = rr.result ?? {};
    if (res.rigged_character_glb_url) await download(res.rigged_character_glb_url, path.join(OUT, `${name}_rigged.glb`));
    const a = res.basic_animations ?? {};
    if (a.walking_glb_url) await download(a.walking_glb_url, path.join(OUT, `${name}_walk.glb`));
    if (a.running_glb_url) await download(a.running_glb_url, path.join(OUT, `${name}_run.glb`));
    log(name, `saved rigged + walk/run`);
    rec.rigId = rigId;
  }
  record(name, rec);
  log(name, "DONE");
}

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === "balance") {
    const b = await api("GET", "/openapi/v1/balance");
    console.log("Meshy balance:", b.balance);
  } else if (cmd === "gen") {
    const [name, prompt, ...flags] = rest;
    const opt = { rig: flags.includes("--rig") };
    const pi = flags.indexOf("--poly"); if (pi >= 0) opt.poly = Number(flags[pi + 1]);
    const mi = flags.indexOf("--model"); if (mi >= 0) opt.model = flags[mi + 1];
    await gen(name, prompt, opt);
  } else {
    console.log("usage: balance | gen <name> \"<prompt>\" [--rig] [--poly N] [--model id]");
  }
} catch (e) {
  console.error("ERROR:", e.message);
  process.exit(1);
}
