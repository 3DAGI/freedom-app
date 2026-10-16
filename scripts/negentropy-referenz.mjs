#!/usr/bin/env node
/**
 * Testvektoren für Negentropy (Schritt B-35a, NIP-77, Entscheidung NG1 B: eigene
 * Umsetzung, Vektoren aus der Referenz). Lädt die JS-Referenz von Doug Hoyte
 * (hoytech/negentropy, MIT) an einem festen Commit, prüft ihre Prüfsumme und
 * führt sie in einer VM aus, die nur `crypto` sieht. Dann spielt sie Abgleiche
 * zwischen zwei Seiten mit festen Zufallsmengen durch und schreibt je Nachricht
 * Länge und SHA-256 und das Ergebnis nach `packages/protocol/test/fixtures/negentropy-referenz.json`
 * – die Mengen selbst baut der Test mit demselben Zufall (`zufall()`, `mengen()`) nach.
 *
 *   node scripts/negentropy-referenz.mjs
 *
 * Nur neu erzeugen, wenn sich die Fälle ändern – die Referenz ist gepinnt.
 */
import { createHash } from "node:crypto";
import * as crypto from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const COMMIT = "b3687652922785c6f3b6c00684f51c6977965784";
const SHA256 = "9950c44f8569aa2502643206f3676985907551c851cd93a68f59ea463fbfc3fb";
const URL_REF = `https://raw.githubusercontent.com/hoytech/negentropy/${COMMIT}/js/Negentropy.js`;
const ZIEL = join(dirname(fileURLToPath(import.meta.url)), "..", "packages", "protocol", "test", "fixtures", "negentropy-referenz.json");

const quelle = await (await fetch(URL_REF)).text();
const summe = createHash("sha256").update(quelle).digest("hex");
if (summe !== SHA256) throw new Error(`Referenz hat eine andere Prüfsumme: ${summe}`);
const modul = { exports: {} };
vm.runInNewContext(quelle, { module: modul, exports: modul.exports, require: (n) => { if (n !== "crypto") throw new Error(n); return crypto; }, Uint8Array, Number, Math, Object, Error, Array, DataView });
// über Zeichenketten: die Namen der Referenz sind nicht unsere (check-wiring.py zählt Bezeichner in scripts/)
const RefAbgleich = modul.exports["Negentropy"], RefSpeicher = modul.exports["NegentropyStorageVector"];

/** Fester Zufall (xorshift32) – dieselben Mengen bei jedem Lauf. */
function zufall(seed) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    return x;
  };
}
const id = (r) => Array.from({ length: 32 }, () => (r() & 0xff).toString(16).padStart(2, "0")).join("");

/** Zwei Mengen: gemeinsame, nur hier, nur dort; Zeiten in einem Bereich, manche gleich (Präfix-Grenzen). */
export function mengen(seed, gemeinsam, nurA, nurB, zeiten) {
  const r = zufall(seed);
  const eintrag = () => ({ zeit: 1_700_000_000 + (r() % zeiten), id: id(r) });
  const g = Array.from({ length: gemeinsam }, eintrag);
  return { a: [...g, ...Array.from({ length: nurA }, eintrag)], b: [...g, ...Array.from({ length: nurB }, eintrag)] };
}

async function spiele(fall) {
  const speicher = (liste) => {
    const s = new RefSpeicher();
    for (const e of liste) s.insert(e.zeit, e.id);
    s.seal();
    return s;
  };
  const client = new RefAbgleich(speicher(fall.a), fall.rahmen);
  const relay = new RefAbgleich(speicher(fall.b), fall.rahmen);
  const nachrichten = [];
  const habe = [], brauche = [];
  let msg = await client.initiate();
  for (let runde = 0; msg !== null && runde < 50; runde++) {
    nachrichten.push(msg);
    const [antwort] = await relay.reconcile(msg);
    nachrichten.push(antwort);
    const [weiter, h, b] = await client.reconcile(antwort);
    habe.push(...h);
    brauche.push(...b);
    msg = weiter;
  }
  const liste = (ids) => ({ anzahl: ids.length, sha256: createHash("sha256").update(ids.sort().join(",")).digest("hex") });
  const kurz = (hex) => ({ bytes: hex.length / 2, sha256: createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex") });
  return { name: fall.name, rahmen: fall.rahmen, mengen: fall.mengen, erste: nachrichten[0], nachrichten: nachrichten.map(kurz), habe: liste(habe), brauche: liste(brauche) };
}

const fall = (name, rahmen, ...m) => ({ name, rahmen, mengen: m, ...mengen(...m) });
const FAELLE = [
  fall("leer", 0, 1, 0, 0, 0, 1),
  fall("gleich", 0, 2, 300, 0, 0, 1000),
  fall("klein", 0, 3, 5, 3, 4, 10),
  fall("einseitig", 0, 4, 0, 0, 40, 100),
  fall("gross", 0, 5, 1500, 40, 25, 100_000),
  fall("gleiche-zeiten", 0, 6, 400, 30, 30, 3),
  fall("rahmen-4096", 4096, 7, 600, 300, 250, 1000),
];

const ergebnis = { referenz: URL_REF, sha256: SHA256, faelle: [] };
for (const f of FAELLE) ergebnis.faelle.push(await spiele(f));
writeFileSync(ZIEL, `${JSON.stringify(ergebnis, null, 1)}\n`);
console.log(`${ergebnis.faelle.length} Fälle, ${ergebnis.faelle.reduce((n, f) => n + f.nachrichten.length, 0)} Nachrichten → ${ZIEL}`);
