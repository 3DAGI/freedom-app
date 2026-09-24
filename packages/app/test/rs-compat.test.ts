/** Verifiziert: browser-shim (GF(256)) und node-lib erzeugen KOMPATIBLE codes. */
import { encode as encShim, reconstruct as recShim } from "../src/shell/shims/reed-solomon.js";

async function main() {
  const { encode: encLib, reconstruct: recLib } = await import("wasm-reed-solomon-erasure");

  const data: Uint8Array[] = [];
  for (let i = 0; i < 16; i++) {
    const a = new Uint8Array(1000);
    for (let j = 0; j < a.length; j++) a[j] = (i * 31 + j * 7) % 256;
    data.push(a);
  }

  // shim-encode
  const shimShards = encShim(data, 8);
  // lib-encode
  const libShards = encLib(data as unknown as Uint8Array[], 8);

  console.log("shim shards:", shimShards.length, "| lib shards:", libShards.length);
  // data-shards identisch (systematisch)
  let dataSame = true;
  for (let i = 0; i < 16; i++) if (Buffer.from(shimShards[i]).toString("hex") !== Buffer.from(libShards[i]).toString("hex")) dataSame = false;
  console.log("data-shards identisch:", dataSame);

  // WICHTIG: parity-shards muessen IDENTISCH sein, damit ein shim-seeder und
  // ein lib-seeder am gleichen blob mitarbeiten koennen.
  let paritySame = true;
  for (let i = 16; i < 24; i++) if (Buffer.from(shimShards[i]).toString("hex") !== Buffer.from(libShards[i]).toString("hex")) paritySame = false;
  console.log("parity-shards identisch:", paritySame, "(erforderlich fuer netz-kompatibilitaet)");

  // shim-reconstruct von lib-encoded:
  const damaged = libShards.map((s) => new Uint8Array(s));
  for (let i = 0; i < 6; i++) damaged[i] = new Uint8Array(0);
  const rec1 = recShim(damaged, 8);
  console.log("shim rekonstruiert lib-shards:", rec1 !== null && Buffer.from(rec1[0]).toString("hex") === Buffer.from(data[0]).toString("hex"));

  // lib-reconstruct von shim-encoded:
  const damaged2 = shimShards.map((s) => new Uint8Array(s));
  for (let i = 0; i < 6; i++) damaged2[i] = new Uint8Array(0);
  const rec2 = recLib(damaged2 as unknown as Uint8Array[], 8, Uint32Array.from([0,1,2,3,4,5]));
  console.log("lib rekonstruiert shim-shards:", rec2 !== null && Buffer.from(rec2[0]).toString("hex") === Buffer.from(data[0]).toString("hex"));
}

main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
