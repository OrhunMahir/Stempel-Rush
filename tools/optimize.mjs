// Shrink Meshy models for the web.
// Reads originals from assets-src/models-raw/, writes to public/models/.
//  - props / rigged characters: WebP textures (max 1024px, props 512px), dedup, prune
//  - *_walk / *_run: drop meshes + textures, keep only the skeleton animation
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { NodeIO, PropertyType } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, textureCompress, reorder, quantize, meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
await MeshoptEncoder.ready;

const RAW = "assets-src/models-raw";
const OUT = "public/models";
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });

for (const f of fs.readdirSync(RAW).filter((f) => f.endsWith(".glb"))) {
  const name = f.replace(".glb", "");
  // unrigged character originals are only kept as raw backups
  if (fs.existsSync(path.join(RAW, `${name}_rigged.glb`))) { fs.rmSync(path.join(OUT, f), { force: true }); continue; }
  const doc = await io.read(path.join(RAW, f));
  const animOnly = /_(walk|run)$/.test(name);
  if (animOnly) {
    const root = doc.getRoot();
    for (const node of root.listNodes()) { node.setMesh(null); node.setSkin(null); }
    for (const m of root.listMeshes()) {
      for (const p of m.listPrimitives()) {
        for (const sem of p.listSemantics()) p.getAttribute(sem)?.dispose();
        p.getIndices()?.dispose();
        p.dispose();
      }
      m.dispose();
    }
    for (const s of root.listSkins()) s.dispose();
    for (const mat of root.listMaterials()) mat.dispose();
    for (const t of root.listTextures()) t.dispose();
    await doc.transform(prune({ propertyTypes: [PropertyType.MESH, PropertyType.MATERIAL, PropertyType.TEXTURE, PropertyType.ACCESSOR, PropertyType.SKIN], keepLeaves: true }));
  } else {
    const size = /_rigged$/.test(name) ? 640 : 512;
    await doc.transform(
      dedup(),
      textureCompress({ encoder: sharp, targetFormat: "webp", resize: [size, size], quality: 82 }),
      prune({ keepLeaves: true }),
      reorder({ encoder: MeshoptEncoder }),
      quantize(),
      meshopt({ encoder: MeshoptEncoder, level: "medium" }),
    );
  }
  await io.write(path.join(OUT, f), doc);
  const a = fs.statSync(path.join(RAW, f)).size, b = fs.statSync(path.join(OUT, f)).size;
  console.log(`${f.padEnd(20)} ${(a / 1e6).toFixed(2)} MB -> ${(b / 1e6).toFixed(2)} MB`);
}
