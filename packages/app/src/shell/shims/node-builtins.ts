/**
 * Browser-Shims für Node-Builtins, die von node-only Bibliotheken (turbo-sdk,
 * git-Helper) importiert werden. Im Browser werden diese Codepfade NIE
 * ausgeführt — die Shims existieren nur, damit esbuild bundeln kann.
 */

// --- fs / fs/promises ---
export const createReadStream = () => { throw new Error("node-only"); };
export const createWriteStream = () => { throw new Error("node-only"); };
export const statSync = () => { throw new Error("node-only"); };
export const promises = {
  readFile: async () => { throw new Error("node-only"); },
  writeFile: async () => { throw new Error("node-only"); },
  stat: async () => { throw new Error("node-only"); },
  readdir: async () => [],
  mkdir: async () => undefined,
  unlink: async () => undefined,
};
export default {
  createReadStream,
  createWriteStream,
  statSync,
  promises,
};

// --- stream ---
export class Readable {
  pipe() { throw new Error("node-only"); }
}
export class Transform {}
export class PassThrough extends Readable {}
export class Writable {}

// --- path ---
export function join(..._parts: string[]): string { throw new Error("node-only"); }
export function dirname(_p: string): string { throw new Error("node-only"); }
export function resolve(..._parts: string[]): string { throw new Error("node-only"); }

// --- crypto (zusätzliche Exporte neben crypto.ts) ---
export const constants = {};
export function createSign(): never { throw new Error("node-only"); }

// --- util (zusätzliche) ---
export function promisify(): never { throw new Error("node-only"); }