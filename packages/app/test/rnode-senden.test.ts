/**
 * B-32b3: Senden über Reticulum an die Gegenstelle – die Adresse nur geprüft und nur in `geheim`, gesendet nur aus
 * `sendeUeberFunk()`, wenn kein Meshtastic-Gerät verbunden ist; Fehler nur über ihre Kennung.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MeshKind } from "@freedomstack/protocol";

const ls = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => void ls.set(k, v),
  removeItem: (k: string) => void ls.delete(k), key: (i: number) => [...ls.keys()][i] ?? null,
  get length() { return ls.size; },
};
const { LS_RETICULUM_GEGENSTELLE, leseLxmfAdresse } = await import("../src/reticulum-funk.js");
const { RETICULUM_FAELLE, ReticulumFehler } = await import("../src/reticulum-umschlag.js");
const { reticulumFehlerText, sendeUeberReticulum } = await import("../src/shell/rnode-ui.js");
const { setLang, t } = await import("../src/i18n.js");
const lies = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const hex = (b: Uint8Array | null) => (b ? Buffer.from(b).toString("hex") : null);

test("B-32b3: Gegenstelle nur als LXMF-Adresse – 32 Zeichen Hex, auch in spitzen Klammern wie Reticulum sie zeigt", () => {
  const a = "0123456789abcdef0123456789ABCDEF";
  assert.equal(hex(leseLxmfAdresse(a)), a.toLowerCase());
  assert.equal(hex(leseLxmfAdresse(`  <${a}>  `)), a.toLowerCase());
  assert.equal(leseLxmfAdresse(a)!.length, 16);
  for (const falsch of [null, undefined, "", a.slice(1), `${a}0`, `${a.slice(1)}g`, `lxmf:${a}`, `<${a}`.slice(0, 20), `${a} ${a}`]) {
    assert.equal(leseLxmfAdresse(falsch), null, String(falsch));
  }
  assert.equal(LS_RETICULUM_GEGENSTELLE, "freedom.reticulum.gegenstelle", "unter freedom.reticulum. – nie in Sicherung oder Export");
});

test("B-32b3: ohne laufende RNode oder ohne Gegenstelle sendet Reticulum nichts – der Aufrufer nimmt den Datei-Weg", async () => {
  assert.equal(await sendeUeberReticulum(new Uint8Array(10), MeshKind.SolanaTx, []), false, "nicht verbunden");
  ls.set(LS_RETICULUM_GEGENSTELLE, "0123456789abcdef0123456789abcdef");
  assert.equal(await sendeUeberReticulum(new Uint8Array(10), MeshKind.SolanaTx, []), false, "Gegenstelle allein reicht nicht");
  ls.clear();
});

test("B-32b3: jeder Fall hat einen eigenen Text in beiden Sprachen – nie die Meldung der Bibliothek", () => {
  for (const sprache of ["de", "en"] as const) {
    setLang(sprache);
    const texte = RETICULUM_FAELLE.map((f) => reticulumFehlerText(new ReticulumFehler(f)));
    assert.equal(new Set(texte).size, RETICULUM_FAELLE.length, `${sprache}: je Fall ein Text`);
    for (const x of texte) assert.doesNotMatch(x, /^set\./, `${sprache}: übersetzt`);
    assert.equal(reticulumFehlerText(new Error("Link timed out at 0x1f")), t("set.rnodeSendenNicht"), "fremde Meldung → fester Text");
  }
  setLang("en");
});

test("B-32b3: verdrahtet – ohne Meshtastic über Reticulum an die Gegenstelle, gemerkt nur in geheim, KI über Funk bleibt bei Meshtastic", () => {
  const mesh = lies("src/shell/tabs/mesh.ts");
  assert.match(mesh, /if \(!meshNode \|\| !funkGeraetVerbunden\(\)\) \{\n[^\n]*\n\s+const \{ sendeUeberReticulum \} = await import\("\.\.\/rnode-ui\.js"\);\n\s+return sendeUeberReticulum\(payload, kind, state\.keypair \? \[state\.keypair\.pk\] : \[\]\);/);
  assert.match(mesh, /const rnodeAdressen = \$\("#mesh-rnode-adressen"\);/);
  assert.match(lies("src/shell/index.html"), /<button id="mesh-rnode-adressen" class="ghost"[^>]*data-i18n="set\.rnodeAdressen">/);
  // KI über Funk braucht das Gateway im Knoten (B-32d) – bis dahin nur Meshtastic
  assert.match(lies("src/shell/tabs/agent.ts"), /if \(!funkGeraetVerbunden\(\)\) throw new EigeneMeldung\(t\("agent\.funkKeinGeraet"\)\);/);
  assert.match(mesh, /export function funkGeraetVerbunden\(\): boolean \{\n\s+const art = meshNode\?\.transportArt;\n\s+return art === "seriell" \|\| art === "bluetooth";/);
  const ui = lies("src/shell/rnode-ui.ts");
  assert.match(ui, /const an = leseLxmfAdresse\(geheim\.getItem\(LS_RETICULUM_GEGENSTELLE\)\);\n\s+if \(!funk \|\| !an\) return false;/);
  assert.match(ui, /if \(neu\) await geheim\.setItem\(LS_RETICULUM_GEGENSTELLE, hex\(neu\)\);\n\s+else await geheim\.removeItem\(LS_RETICULUM_GEGENSTELLE\);/);
  assert.match(ui, /\{ art: "qr", name: "qr", label: t\("set\.rnodeEigeneQr"\), wert: eigene \}/, "die eigene Adresse ist nicht geheim");
  assert.doesNotMatch(ui, /localStorage[^\n]*GEGENSTELLE/, "die Gegenstelle nur in geheim");
  assert.doesNotMatch(ui, /\.message\b|console\./, "nur feste Texte, nichts ins Log");
  assert.match(lies("src/shell/tresor.ts"), /"freedom\.reticulum\.gegenstelle"/, "die Gegenstelle ist ein Geheimnis – sie verrät, mit wem man funkt");
  for (const sprache of ["de", "en"] as const) {
    setLang(sprache);
    for (const k of ["set.rnodeAdressen", "set.rnodeAdressenTitel", "set.rnodeAdressenText", "set.rnodeEigeneQr", "set.rnodeEigene",
      "set.rnodeGegenstelle", "set.rnodeKeineAdresse", "set.rnodeEigeneGegenstelle", "set.rnodeGegenstelleMerken",
      "set.rnodeGegenstelleGemerkt", "set.rnodeGegenstelleWeg", "set.rnodeSendet", "set.rnodeSendenNicht"]) {
      assert.notEqual(t(k), k, `${sprache}: ${k}`);
    }
  }
  setLang("en");
});

test("B-32b3: die Grenze im Bericht nennt die Gegenstelle – ihre Adresse steht in jedem Paket an sie offen", async () => {
  const { PRIVACY_FACTS } = await import("@freedomstack/protocol");
  const f = PRIVACY_FACTS.find((x) => x.id === "reticulum-ankuendigung")!;
  assert.match(f.aussage, /jedes, das du an deine Gegenstelle sendest, deren Adresse/);
  assert.match(f.grund ?? "", /Gesendet wird nur an die Gegenstelle, die du selbst festlegst – sie erfährt deine Adresse/);
  const { faktAussage } = await import("../src/datenschutz-bericht.js");
  setLang("en");
  assert.match(faktAussage(f), /every one you send to your peer, the peer's address/);
});
