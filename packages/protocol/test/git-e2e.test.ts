/** E2E: git-repo -> bundle -> blob-layer (chunked+erasure) -> rekonstruieren -> git clone. */
import { createGitBundle, restoreGitBundle } from "../src/git.js";
import { buildBlob, assembleBlob } from "../src/blob.js";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

async function main() {
  const work = join(tmpdir(), `freedom-git-test-${Date.now()}`);
  await fs.mkdir(work, { recursive: true });
  const repoA = join(work, "repo-a");
  const bundleFile = join(work, "repo-a.bundle");
  const repoB = join(work, "repo-b");

  // 1. test-repo erstellen
  await run("git", ["init", "-b", "main", repoA]);
  await run("git", ["-C", repoA, "config", "user.email", "test@freedom"]);
  await run("git", ["-C", repoA, "config", "user.name", "tester"]);
  await fs.writeFile(join(repoA, "README.md"), "# Freedom Git Test\n\ntorrent-artig ueber nostr.\n");
  await run("git", ["-C", repoA, "add", "."]);
  await run("git", ["-C", repoA, "commit", "-m", "initial commit"]);
  // zweiter commit mit mehr inhalt
  await fs.writeFile(join(repoA, "src.ts"), "console.log('hello freedom');\n".repeat(100));
  await run("git", ["-C", repoA, "add", "."]);
  await run("git", ["-C", repoA, "commit", "-m", "add src"]);

  // 2. bundle erstellen
  const { bytes, headSha, branch, message } = await createGitBundle(repoA, bundleFile);
  console.log("bundle:", bytes.length, "bytes | head:", headSha.slice(0, 8), "| branch:", branch);

  // 3. durch den blob-layer (chunked + erasure)
  const { manifest, chunkEvents } = await buildBlob({ name: "repo-a.bundle", mime: "application/x-bundle", bytes }, "a".repeat(64));
  console.log("shards:", chunkEvents.length);

  // simuliert das netz: alle chunks sammeln, 6 data-shards gehen verloren
  const chunks = new Map<number, string>();
  chunkEvents.forEach((ev) => {
    const idx = Number(ev.tags.find((t) => t[0] === "index")![1]);
    chunks.set(idx, ev.content);
  });
  for (let i = 0; i < 6; i++) chunks.delete(i);
  console.log("6 shards 'verloren' — rekonstruiere…");

  const r = await assembleBlob(manifest, chunks);
  if (!r.complete || Buffer.from(r.bytes).toString() !== Buffer.from(bytes).toString()) throw new Error("blob-roundtrip fehlgeschlagen!");
  console.log("bundle byte-identisch rekonstruiert ✓");

  // 4. git clone aus dem rekonstruierten bundle
  await restoreGitBundle(r.bytes, repoB);
  const log = (await run("git", ["-C", repoB, "log", "--oneline"])).stdout.trim();
  console.log("clone log:\n" + log.split("\n").map((l) => "  " + l).join("\n"));

  if (!log.includes("add src")) throw new Error("clone unvollstaendig!");
  console.log("E2E GIT-UEBER-BLOBS OK ✓");

  await fs.rm(work, { recursive: true, force: true });
}

main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
