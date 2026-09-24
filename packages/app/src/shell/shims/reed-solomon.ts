/**
 * Browser-Adapter fuer Reed-Solomon Erasure Coding.
 *
 * Reine GF(256)-Implementierung (kein WASM, keine Node-Builtins) — identische
 * API zu wasm-reed-solomon-erasure:
 *   encode(data: Uint8Array[], parity: number) -> Uint8Array[]
 *   reconstruct(shards, parity, deadIdx) -> Uint8Array[]
 *
 * Systematischer Vandermonde-Code (wie Backblaze/RAID-6-Familie).
 */

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function initGaloisField() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function gfDiv(a: number, b: number): number {
  if (b === 0) throw new Error("gf div by 0");
  if (a === 0) return 0;
  return GF_EXP[(GF_LOG[a] + 255 - GF_LOG[b]) % 255];
}

/** Systematische Encoding-Matrix.
 *  Die 8x16-Parity-Matrix ist die EXAKTE Matrix der rust reed-solomon-erasure
 *  lib (via Einheitsvektor-Abfrage extrahiert) — damit sind Browser-Shim und
 *  Node-Lib bit-identisch kompatibel (Seeder untereinander mischbar). */
// prettier-ignore
const PARITY_MATRIX_16_8: number[][] = [
  [33,181,246,133,223,2,183,135,62,221,74,164,141,218,97,48],
  [181,33,133,246,2,223,135,183,221,62,164,74,218,141,48,97],
  [246,133,33,181,183,135,223,2,74,164,62,221,97,48,141,218],
  [133,246,181,33,135,183,2,223,164,74,221,62,48,97,218,141],
  [223,2,183,135,33,181,246,133,141,218,97,48,62,221,74,164],
  [2,223,135,183,181,33,133,246,218,141,48,97,221,62,164,74],
  [183,135,223,2,246,133,33,181,97,48,141,218,74,164,62,221],
  [135,183,2,223,133,246,181,33,48,97,218,141,164,74,221,62],
];

function buildMatrix(dataShards: number, totalShards: number): Uint8Array[] {
  const rows: Uint8Array[] = [];
  for (let r = 0; r < dataShards; r++) {
    const row = new Uint8Array(totalShards);
    row[r] = 1;
    rows.push(row);
  }
  for (let p = 0; p < totalShards - dataShards; p++) {
    const row = new Uint8Array(totalShards);
    if (dataShards === 16 && totalShards === 24) {
      // exakte rust-rs-matrix (netz-kompatibilitaet)
      const pm = PARITY_MATRIX_16_8[p];
      for (let c = 0; c < dataShards; c++) row[c] = pm[c];
    } else {
      // fallback: vandermonde fuer andere konfigurationen
      for (let c = 0; c < dataShards; c++) {
        row[c] = gfExp2((p + 1) * c);
      }
    }
    rows.push(row);
  }
  return rows;
}

/** 2^e mod GF(256). */
function gfExp2(e: number): number {
  return GF_EXP[e % 255];
}

/** Matrix invertieren ueber GF(256) (gauss-jordan). */
function invertMatrix(rows: Uint8Array[], n: number): Uint8Array[] | null {
  const aug: Uint8Array[] = rows.map((r, i) => {
    const a = new Uint8Array(n * 2);
    a.set(r.slice(0, n));
    a[n + i] = 1;
    return a;
  });
  for (let col = 0; col < n; col++) {
    let pivot = -1;
    for (let r = col; r < n; r++) if (aug[r][col] !== 0) { pivot = r; break; }
    if (pivot === -1) return null;
    [aug[col], aug[pivot]] = [aug[pivot], aug[col]];
    const invP = gfDiv(1, aug[col][col]);
    for (let c = 0; c < n * 2; c++) aug[col][c] = gfMul(aug[col][c], invP);
    for (let r = 0; r < n; r++) {
      if (r !== col && aug[r][col] !== 0) {
        const f = aug[r][col];
        for (let c = 0; c < n * 2; c++) aug[r][c] ^= gfMul(f, aug[col][c]);
      }
    }
  }
  return aug.map((r) => r.slice(n));
}

export function encode(dataShardsIn: Uint8Array[], parityShards: number): Uint8Array[] {
  const dataShards = dataShardsIn.length;
  const total = dataShards + parityShards;
  if (total > 255) throw new Error("max 255 shards");
  const shardLen = dataShardsIn[0]?.length ?? 0;
  const matrix = buildMatrix(dataShards, total);
  const out: Uint8Array[] = [...dataShardsIn.map((s) => new Uint8Array(s))];
  for (let p = 0; p < parityShards; p++) {
    const parityRow = matrix[dataShards + p];
    const shard = new Uint8Array(shardLen);
    for (let c = 0; c < dataShards; c++) {
      const coef = parityRow[c];
      if (coef === 0) continue;
      const src = dataShardsIn[c];
      for (let j = 0; j < shardLen; j++) shard[j] ^= gfMul(coef, src[j]);
    }
    out.push(shard);
  }
  return out;
}

export function reconstruct(
  shards: Uint8Array[],
  parityShards: number,
  _deadIndexes?: Uint32Array | number[],
): Uint8Array[] | null {
  const total = shards.length;
  const dataShards = total - parityShards;
  const shardLen = shards.find((s) => s && s.length > 0)?.length ?? 0;

  const aliveIdx: number[] = [];
  shards.forEach((s, i) => { if (s && s.length > 0) aliveIdx.push(i); });

  // alle data-shards da? nichts zu tun.
  const missingAll: number[] = [];
  shards.forEach((s, i) => { if (!s || s.length === 0) missingAll.push(i); });
  if (missingAll.length === 0) return shards.map((s) => new Uint8Array(s));
  if (aliveIdx.length < dataShards) return null;

  const matrix = buildMatrix(dataShards, total);
  // Backblaze-Verfahren: S = Matrix der LEBENDEN Zeilen (dataShards viele),
  // D = M_missing * S^-1 — rekonstruierte shards = Kombis der lebenden Daten.
  const used = aliveIdx.slice(0, dataShards);
  const subRows = used.map((i) => matrix[i]);
  const sInv = invertMatrix(subRows, dataShards);
  if (!sInv) return null;

  const out = shards.map((s) => (s && s.length > 0 ? new Uint8Array(s) : new Uint8Array(shardLen)));
  for (const target of missingAll) {
    const mRow = matrix[target];
    // decode-zeile: mRow * S^-1
    const coefRow = new Uint8Array(dataShards);
    for (let k = 0; k < dataShards; k++) {
      let acc = 0;
      for (let c = 0; c < dataShards; c++) {
        if (mRow[c] === 0) continue;
        acc ^= gfMul(mRow[c], sInv[c][k]);
      }
      coefRow[k] = acc;
    }
    const rec = new Uint8Array(shardLen);
    for (let k = 0; k < dataShards; k++) {
      const coef = coefRow[k];
      if (coef === 0) continue;
      const src = shards[used[k]];
      for (let j = 0; j < shardLen; j++) rec[j] ^= gfMul(coef, src[j]);
    }
    out[target] = rec;
  }
  return out;
}

