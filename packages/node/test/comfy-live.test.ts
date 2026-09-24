/**
 * ComfyUI Live-Test: echtes image_gen via SDXL (skip wenn ComfyUI offline).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ComfyExecutor } from "../src/comfy.js";
import { ImageGenExecutor } from "../src/tools.js";
import { KIND_DVM_IMAGE_GEN } from "@freedomstack/protocol";

const COMFY = process.env.COMFY_URL ?? "http://127.0.0.1:8188";

test("ComfyExecutor: live SDXL text2img (skip wenn ComfyUI offline)", async (t) => {
  const comfy = new ComfyExecutor({ baseUrl: COMFY, timeoutMs: 180_000 });
  if (!(await comfy.up())) { t.skip("ComfyUI offline"); return; }
  const r = await comfy.generateImage("a cypherpunk cat, neon green on black, terminal aesthetic");
  assert.ok(r.ok, `image_gen ok: ${r.error ?? ""}`);
  assert.ok(r.files.length > 0, "Datei erzeugt");
  assert.ok(r.urls[0].includes("/view?filename="), "URL vorhanden");
  console.log(`    [comfy-live] bild=${r.files[0]} url=${r.urls[0]} (${r.durationMs}ms)`);
});

test("ImageGenExecutor (Tool): via ToolRegistry-Interface (skip wenn offline)", async (t) => {
  const ex = new ImageGenExecutor(COMFY);
  const comfy = new ComfyExecutor({ baseUrl: COMFY });
  if (!(await comfy.up())) { t.skip("ComfyUI offline"); return; }
  const res = await ex.run({ kind: KIND_DVM_IMAGE_GEN, name: "image_gen", input: "a freedom bird, emerald green" });
  assert.ok(res.ok, `tool ok: ${res.output.slice(0, 80)}`);
  assert.ok(res.output.includes("/view?filename="), "URL im Output");
  console.log(`    [comfy-tool] ${res.output.slice(0, 90)}`);
});
