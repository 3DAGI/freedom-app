/**
 * Git-over-Freedom-Blobs: Standard-git-Repos als Blob-Manifeste.
 *
 * Prinzip (wie Buzz Projects, aber dezentral ueber Nostr):
 * - Ein git-repo ist intern ein store aus content-addressed objekten
 *   (blobs, trees, commits — je sha1-adressiert in .git/objects)
 * - `git bundle` / `git pack-objects` erzeugt EINE datei mit allen objekten:
 *   perfekt fuer unseren blob-layer (chunked + erasure + manifest)
 * - Push  = bundle erstellen -> uploadBlob -> repo-manifest-event publizieren
 *   Clone = manifest laden -> assemble -> `git clone` aus der bundle-datei
 *
 * Kinds:
 *   GIT_REPO_REF = 38042 — name + blobId der aktuellen head-bundle-version
 *
 * Die clone-url ist dann: freedom://git/<name> (in-app) oder man laedt das
 * bundle herunter und macht `git clone <file>.bundle` (normales git-cli!).
 */
import { UnsignedEvent, buildEvent, getTag } from "./event.js";
import { KIND_GIT_REPO_REF } from "./kinds.js";

export interface GitRepoRef {
  /** Repo-name (d-tag, ersetzbar). */
  name: string;
  /** Blob-manifest-id des aktuellen bundles. */
  blobId: string;
  /** git HEAD-sha (kurz, fuer anzeige). */
  headSha: string;
  /** branch (default main). */
  branch: string;
  /** commit-message des heads. */
  message: string;
  /** monoton steigende versionsnummer. */
  version: number;
}

export function buildGitRepoRef(r: GitRepoRef, ownerPubkey: string): UnsignedEvent {
  return buildEvent(ownerPubkey, KIND_GIT_REPO_REF, [
    ["d", r.name],
    ["blob", r.blobId],
    ["head", r.headSha],
    ["branch", r.branch],
    ["version", String(r.version)],
  ], r.message);
}

export function parseGitRepoRef(ev: UnsignedEvent): GitRepoRef & { ownerPubkey: string } {
  if (ev.kind !== KIND_GIT_REPO_REF) throw new Error(`kein git-repo-ref: kind ${ev.kind}`);
  const req = (n: string): string => {
    const v = getTag(ev, n);
    if (!v) throw new Error(`repo-ref ohne ${n}`);
    return v;
  };
  return {
    ownerPubkey: ev.pubkey,
    name: req("d"),
    blobId: req("blob"),
    headSha: req("head"),
    branch: req("branch"),
    version: Number(req("version")),
    message: ev.content,
  };
}

// ------------------------------------------------------------- Bundle-Helper

/** Erstellt ein git-bundle aus einem lokalen repo (node-only).
 *  Aequivalent zu: git -C <repoPath> bundle create - --all */
export async function createGitBundle(repoPath: string, tmpOut: string): Promise<{ bytes: Uint8Array; headSha: string; branch: string; message: string }> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);

  await run("git", ["-C", repoPath, "bundle", "create", tmpOut, "--all"]);
  const fs = await import("node:fs/promises");
  const buf = await fs.readFile(tmpOut);
  const headSha = (await run("git", ["-C", repoPath, "rev-parse", "HEAD"])).stdout.trim();
  const branch = (await run("git", ["-C", repoPath, "rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
  const message = (await run("git", ["-C", repoPath, "log", "-1", "--pretty=%s"])).stdout.trim();
  return { bytes: new Uint8Array(buf), headSha, branch, message };
}

/** Stellt ein repo aus einem bundle wieder her (clone-faehig). */
export async function restoreGitBundle(bundleBytes: Uint8Array, targetDir: string): Promise<void> {
  const fs = await import("node:fs/promises");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);

  await fs.mkdir(targetDir.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  const tmpBundle = `${targetDir}.bundle`;
  await fs.writeFile(tmpBundle, bundleBytes);
  await run("git", ["clone", tmpBundle, targetDir]);
  await fs.unlink(tmpBundle).catch(() => {});
}

function join(...parts: string[]): string {
  return parts.filter(Boolean).join("/").replace(/\/+/g, "/");
}
