/**
 * Repos nur auf diesem Gerät (Sammlung B-2, S1 „B mit Wechsel“): Angaben und
 * Bundle bleiben lokal – das Bundle verschlüsselt, sein Schlüssel in der Liste
 * (`geheim`). Nichts geht auf ein Relay, nichts in die Sicherung; die
 * Notfall-Löschung kennt die Datenbank.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ProtokollFehler, SICHERUNG_NIE, WIPE_DATENBANKEN, generateKeypair, waehleSicherung } from "@freedomstack/protocol";
import { type BundleSpeicher, LOKAL_MAX, LS_REPOS_LOKAL, LokaleRepos, LokalVoll, bundleSchluessel, leseLokaleRepos } from "../src/lokale-repos.js";
import { waehleExport } from "../src/datenexport.js";

const ICH = generateKeypair().pk;
const ANDERE = generateKeypair().pk;
const JETZT = 1_800_000_000;
const KLAR = new TextEncoder().encode("# Bundle v2 git bundle mit Geheimrezept ".repeat(20));

function aufbau(): { repos: LokaleRepos; liste: Map<string, string>; bundles: Map<string, Uint8Array> } {
  const liste = new Map<string, string>();
  const bundles = new Map<string, Uint8Array>();
  const speicher: BundleSpeicher = {
    lies: async (k) => bundles.get(k) ?? null,
    lege: async (k, v) => { bundles.set(k, Uint8Array.from(v)); },
    loesche: async (k) => { bundles.delete(k); },
  };
  const geheim = { getItem: (k: string) => liste.get(k) ?? null, setItem: async (k: string, v: string) => { liste.set(k, v); } };
  return { repos: new LokaleRepos(geheim, speicher, () => JETZT), liste, bundles };
}

test("B-2: anlegen, Bundle ablegen und lesen – verschlüsselt, ohne Raum, nur die eigenen Karten", async () => {
  const { repos, liste, bundles } = aufbau();
  await repos.merke(ICH, { id: "geheim-projekt", name: "Geheim", klon: [], beschreibung: "nur hier", raum: `34700:${ANDERE}:space:x` });
  await repos.legeBundleAb(ICH, "geheim-projekt", KLAR);
  // Chiffrat in der Datenbank, Schlüssel in der Liste – kein Klartext an beiden Stellen
  assert.equal(bundles.size, 1);
  const [schluessel, chiffrat] = [...bundles][0]!;
  const r = repos.finde(ICH, "geheim-projekt")!;
  assert.equal(schluessel, bundleSchluessel(ICH, "geheim-projekt", r.bundle!.schluessel.ox));
  assert.ok(!new TextDecoder().decode(chiffrat).includes("Geheimrezept"));
  assert.ok(!liste.get(LS_REPOS_LOKAL)!.includes("Geheimrezept"));
  assert.deepEqual(await repos.holeBundle(ICH, "geheim-projekt"), KLAR);
  // Ein Raum ist öffentlich – ein lokales Repo hat keinen
  assert.equal(r.angaben.raum, undefined);
  const [k, ...mehr] = repos.karten(ICH);
  assert.equal(mehr.length, 0);
  assert.equal(k!.schluessel, `lokal:${ICH}:geheim-projekt`, "nie mit einem öffentlichen Repo gleicher Kennung vermischt");
  assert.deepEqual(k!.lokal, { bundle: { zeit: JETZT, bytes: KLAR.length } });
  assert.equal(k!.eigentuemer, ICH);
  assert.equal(k!.beschreibung, "nur hier");
  assert.equal(k!.repo?.raum, undefined);
  assert.equal(k!.bundle, undefined, "keine Referenz ins Netz");
  assert.deepEqual(repos.karten(ANDERE), [], "nur die eigene Identität");
  assert.deepEqual(repos.karten(undefined), []);
  // Neue Version: frischer Schlüssel, die alte verschwindet erst danach
  const neu = new TextEncoder().encode("zweite Fassung");
  await repos.legeBundleAb(ICH, "geheim-projekt", neu);
  assert.equal(bundles.size, 1);
  assert.notEqual(repos.finde(ICH, "geheim-projekt")!.bundle!.schluessel.key, r.bundle!.schluessel.key);
  assert.deepEqual(await repos.holeBundle(ICH, "geheim-projekt"), neu);
  // Angaben ändern behält das Bundle
  await repos.merke(ICH, { id: "geheim-projekt", name: "Umbenannt", klon: ["https://example.org/x.git"] });
  assert.equal(repos.karten(ICH)[0]!.name, "Umbenannt");
  assert.deepEqual(await repos.holeBundle(ICH, "geheim-projekt"), neu);
});

test("B-2: streng gelesen – Kaputtes fällt weg, verändertes Chiffrat wirft", async () => {
  for (const roh of [null, "", "kein json", "{}", "5", JSON.stringify([null, 3, "x"])]) assert.deepEqual(leseLokaleRepos(roh), [], String(roh));
  const gut = { eigentuemer: ICH, angaben: { id: "a", name: "A", klon: [] }, zeit: JETZT };
  const schluessel = { alg: "aes-gcm", key: "1".repeat(64), nonce: "2".repeat(24), ox: "3".repeat(64) };
  const liste = [
    gut,
    { ...gut, angaben: { id: "a", name: "doppelt", klon: [] } },
    { ...gut, eigentuemer: "zu-kurz" },
    { ...gut, angaben: { id: "../x", name: "Pfad", klon: [] } },
    { ...gut, angaben: { id: "b", name: "B", klon: ["ftp://nein"] } },
    { ...gut, angaben: { id: "c", name: "C", klon: "kein Feld" } },
    { ...gut, angaben: { id: "d", name: "D", klon: [], maintainer: ["kein-schluessel"] } },
    { ...gut, angaben: { id: "e", name: "E", klon: [] }, zeit: -1 },
    { ...gut, angaben: { id: "f", name: "F", klon: [] }, bundle: { zeit: JETZT, bytes: 1, schluessel: { ...schluessel, key: "zz" } } },
    { ...gut, angaben: { id: "g", name: "G", klon: [] }, bundle: { zeit: JETZT, bytes: 1, schluessel } },
  ];
  assert.deepEqual(leseLokaleRepos(JSON.stringify(liste)).map((r) => [r.angaben.id, r.angaben.name]), [["a", "A"], ["g", "G"]]);
  // Verändertes Chiffrat: GCM und Prüfsumme schlagen an
  const { repos, bundles } = aufbau();
  await repos.merke(ICH, { id: "x", name: "X", klon: [] });
  assert.equal(await repos.holeBundle(ICH, "x"), null, "ohne Bundle nichts");
  await repos.legeBundleAb(ICH, "x", KLAR);
  const [k, c] = [...bundles][0]!;
  c[5] = c[5]! ^ 1;
  bundles.set(k, c);
  await assert.rejects(repos.holeBundle(ICH, "x"));
  bundles.clear();
  assert.equal(await repos.holeBundle(ICH, "x"), null, "Chiffrat weg → nichts, kein Fehler im Schlüssel");
});

test("B-2: Grenzen, Prüfung wie beim Ankündigen, Löschen", async () => {
  const { repos, bundles, liste } = aufbau();
  await assert.rejects(repos.merke(ICH, { id: "x", name: "X", klon: ["ftp://nein"] }), (e: unknown) => e instanceof ProtokollFehler && e.kennung === "repo-klon");
  await assert.rejects(repos.legeBundleAb(ICH, "fehlt", KLAR), "nur für gemerkte Repos");
  for (let i = 0; i < LOKAL_MAX; i++) await repos.merke(ICH, { id: `r${i}`, name: `R${i}`, klon: [] });
  await assert.rejects(repos.merke(ICH, { id: "eins-zu-viel", name: "X", klon: [] }), LokalVoll);
  await repos.merke(ICH, { id: "r0", name: "geändert", klon: [] });
  await repos.merke(ANDERE, { id: "fremd", name: "Fremd", klon: [] });
  assert.equal(repos.alle().length, LOKAL_MAX + 1, "die Grenze gilt je Identität");
  await repos.legeBundleAb(ICH, "r1", KLAR);
  await repos.entferne(ICH, "r1");
  assert.equal(repos.finde(ICH, "r1"), undefined);
  assert.equal(bundles.size, 0, "das Chiffrat geht mit");
  assert.ok(!liste.get(LS_REPOS_LOKAL)!.includes('"r1"'));
});

test("B-2: nie auf Relays – nicht in der Sicherung, nicht im Export, im Tresor, in der Notfall-Löschung", () => {
  assert.ok(SICHERUNG_NIE.some((r) => r.test(LS_REPOS_LOKAL)));
  assert.ok(!(LS_REPOS_LOKAL in waehleSicherung([LS_REPOS_LOKAL], () => "[]")));
  assert.ok(!(LS_REPOS_LOKAL in waehleExport([LS_REPOS_LOKAL], () => "[]")));
  assert.ok(WIPE_DATENBANKEN.includes("freedom-repos"));
  const tresor = readFileSync(new URL("../src/shell/tresor.ts", import.meta.url), "utf8");
  assert.match(tresor.slice(tresor.indexOf("const GEHEIM_FEST"), tresor.indexOf("const GEHEIM_PRAEFIXE")), /"freedom\.repos\.lokal"/);
  const ablage = readFileSync(new URL("../src/shell/lokale-repos-ablage.ts", import.meta.url), "utf8");
  assert.match(ablage, /const DATENBANK = "freedom-repos";/);
  assert.match(ablage, /export const lokaleRepos = new LokaleRepos\(geheim, bundles\);/);
  assert.doesNotMatch(ablage, /publish|ensurePool|fetch\(|localStorage/, "nur IndexedDB und geheim");
});
