/**
 * B-32a: Reticulum als zweiter Funkweg – Identität je Gerät (nur in `geheim`, nie in Sicherung oder Export) und der
 * Umschlag in einer LXMF-Nachricht: hinein nur, was `pruefeMeshInhalt()` durchlässt, heraus nur an die eigene Adresse.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MeshKind, SICHERUNG_NIE, buildPrivateDm, generateKeypair, waehleSicherung } from "@freedomstack/protocol";
import { Identity } from "@reticulum/core";
import { waehleExport } from "../src/datenexport.js";
import { eventToMesh } from "../src/mesh-radio.js";
import {
  LS_RETICULUM_IDENTITAET, RETICULUM_ART, RETICULUM_GRENZEN, ReticulumFehler, entpackeAusReticulum, lxmfAdresse, reticulumIdentitaet, verpackeFuerReticulum,
} from "../src/reticulum-umschlag.js";

/** Fehler nur über die Kennung – die Meldung ist kein Text für Nutzer. */
const mitFall = (fall: string, meshFall?: string) => (e: unknown) =>
  e instanceof ReticulumFehler && e.fall === fall && (meshFall === undefined || e.pruefung?.fall === meshFall);
const lies = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

function speicher(start: Record<string, string> = {}) {
  const daten = new Map(Object.entries(start));
  let geschrieben = 0;
  return {
    daten,
    get geschrieben() { return geschrieben; },
    getItem: (k: string) => daten.get(k) ?? null,
    async setItem(k: string, v: string) { geschrieben++; daten.set(k, v); },
  };
}

const alice = generateKeypair();
const bob = generateKeypair();
const dm = await buildPrivateDm({ senderSk: alice.sk, senderPk: alice.pk, recipientPk: bob.pk, content: "Treffen um 19 Uhr" });
const umschlag = eventToMesh(dm.toRecipient);

test("B-32a: Identität je Gerät – zufällig, nur in geheim, beim zweiten Mal dieselbe, nie in Sicherung oder Export", async () => {
  const s = speicher();
  const a = await reticulumIdentitaet(s);
  const gemerkt = s.daten.get(LS_RETICULUM_IDENTITAET)!;
  assert.match(gemerkt, /^[0-9a-f]{128}$/, "64 Byte wie die Python-Referenz");
  const wieder = await reticulumIdentitaet(s);
  assert.equal(s.geschrieben, 1, "nur einmal angelegt");
  assert.equal(hex(await lxmfAdresse(wieder)), hex(await lxmfAdresse(a)));
  assert.equal((await lxmfAdresse(a)).length, 16);
  const andere = await reticulumIdentitaet(speicher());
  assert.notEqual(hex(await lxmfAdresse(andere)), hex(await lxmfAdresse(a)), "zufällig, nie aus einem anderen Schlüssel");

  assert.ok(SICHERUNG_NIE.some((r) => r.test(LS_RETICULUM_IDENTITAET)));
  assert.ok(!(LS_RETICULUM_IDENTITAET in waehleSicherung([LS_RETICULUM_IDENTITAET], () => gemerkt)));
  assert.ok(!(LS_RETICULUM_IDENTITAET in waehleExport([LS_RETICULUM_IDENTITAET], () => gemerkt)));
  const tresor = lies("shell/tresor.ts");
  assert.match(tresor.slice(tresor.indexOf("const GEHEIM_FEST"), tresor.indexOf("const GEHEIM_PRAEFIXE")), /"freedom\.reticulum\.identitaet"/);
  assert.doesNotMatch(lies("reticulum-umschlag.ts"), /localStorage|console\./, "nur über geheim, nichts ins Log");
});

test("B-32a: ein kaputter Eintrag wird nie ersetzt – sonst wäre die Adresse still eine andere", async () => {
  for (const kaputt of ["", "zz".repeat(64), "ab".repeat(63), "AB".repeat(64), "ab".repeat(65)]) {
    const s = speicher({ [LS_RETICULUM_IDENTITAET]: kaputt });
    await assert.rejects(reticulumIdentitaet(s), mitFall("identitaet-kaputt"), JSON.stringify(kaputt));
    assert.equal(s.geschrieben, 0);
    assert.equal(s.daten.get(LS_RETICULUM_IDENTITAET), kaputt);
  }
});

test("B-32a: Umschlag hin und zurück – LXMF von Alice an Bob, signiert mit Alices Identität", async () => {
  const [a, b] = [await Identity.generate(), await Identity.generate()];
  const [adrA, adrB] = [await lxmfAdresse(a), await lxmfAdresse(b)];
  const wire = await verpackeFuerReticulum({ payload: umschlag, kind: MeshKind.NostrEvent, von: a, an: adrB, eigeneSchluessel: [alice.pk] });
  assert.equal(hex(wire.subarray(0, 16)), hex(adrB), "direkte Form: Ziel zuerst");
  assert.equal(hex(wire.subarray(16, 32)), hex(adrA), "dann der Absender");
  assert.deepEqual(await entpackeAusReticulum(wire, adrB), { kind: MeshKind.NostrEvent, payload: umschlag });

  const { Message } = await import("@reticulum/lxmf/src/message.js");
  const m = await Message.deserialize(wire, adrB);
  assert.equal(await m.verifySignature(a), true, "Alice hat signiert");
  assert.equal(await m.verifySignature(b), false);
  assert.equal(m.title, "");
  assert.equal(m.content, "", "Titel und Inhalt bleiben leer – alles steht in den Feldern");
});

test("B-32a: Felder mit Zahlen als Schlüssel (wie die Python-Referenz), nicht als Text", async () => {
  const a = await Identity.generate();
  const wire = await verpackeFuerReticulum({ payload: umschlag, kind: MeshKind.NostrEvent, von: a, an: await lxmfAdresse(a), eigeneSchluessel: [] });
  const art = new TextEncoder().encode(RETICULUM_ART);
  // msgpack: 0xcc 0xfb (uint8 251), dann fixstr der Länge 14
  const typ = Buffer.from([0xcc, 0xfb, 0xa0 | art.length, ...art]);
  assert.ok(Buffer.from(wire).includes(typ), "FIELD_CUSTOM_TYPE als Zahl 0xFB");
  assert.ok(Buffer.from(wire).includes(Buffer.from([0xcc, 0xfc, 0xc5])), "FIELD_CUSTOM_DATA als Zahl 0xFC, Daten als bin 16");
  assert.ok(!Buffer.from(wire).includes(Buffer.from("\xa3251", "latin1")), "nie der Text \"251\"");
});

test("B-32a: hinaus geht nur, was über Funk darf – kein Klartext, keine eigene Kopie, gültige Adresse, Größe", async () => {
  const a = await Identity.generate();
  const an = await lxmfAdresse(await Identity.generate());
  const pack = (payload: Uint8Array, kind: MeshKind, weiter: Partial<{ an: Uint8Array; eigene: string[] }> = {}) =>
    verpackeFuerReticulum({ payload, kind, von: a, an: weiter.an ?? an, eigeneSchluessel: weiter.eigene ?? [alice.pk] });
  await assert.rejects(pack(new TextEncoder().encode("Treffen um 19 Uhr"), MeshKind.PlainText), mitFall("inhalt", "klartext"));
  await assert.rejects(pack(new TextEncoder().encode("{\"kind\":1}"), MeshKind.NostrEvent), mitFall("inhalt", "kein-umschlag"));
  await assert.rejects(pack(eventToMesh(dm.toSelf), MeshKind.NostrEvent), mitFall("inhalt", "eigener-schluessel"), "die eigene DM-Kopie geht nie hinaus");
  await assert.rejects(pack(umschlag, MeshKind.NostrEvent, { an: an.slice(0, 15) }), mitFall("adresse"));
  await assert.rejects(pack(new Uint8Array(RETICULUM_GRENZEN.nutzlast + 1), MeshKind.NostrEvent), mitFall("zu-gross"));
});

test("B-32a: heraus nur an die eigene Adresse und nur die eigene Art – sonst null", async () => {
  const a = await Identity.generate();
  const [adrB, adrC] = [await lxmfAdresse(await Identity.generate()), await lxmfAdresse(await Identity.generate())];
  const wire = await verpackeFuerReticulum({ payload: umschlag, kind: MeshKind.NostrEvent, von: a, an: adrB, eigeneSchluessel: [] });
  assert.equal(await entpackeAusReticulum(wire, adrC), null, "an jemand anderen – nie als opportunistisch gelesen");
  assert.equal(await entpackeAusReticulum(wire.slice(16), adrB), null, "ohne Ziel am Anfang");
  assert.equal(await entpackeAusReticulum(wire.slice(0, 100), adrB), null, "abgeschnitten");
  assert.equal(await entpackeAusReticulum(new Uint8Array(RETICULUM_GRENZEN.draht + 1).fill(1).map((x, i) => (i < 16 ? adrB[i]! : x)), adrB), null, "zu groß");

  const { Message } = await import("@reticulum/lxmf/src/message.js");
  const fremd = async (fields: Map<number, unknown>) =>
    (await new Message({ sourceHash: await lxmfAdresse(a), destinationHash: adrB, title: "", content: "", fields }).serialize(a)).wireData;
  const daten = (kind: number, p: Uint8Array) => Uint8Array.from([kind, ...p]);
  const klar = new TextEncoder().encode("Treffen um 19 Uhr");
  const faelle: Array<[string, Map<number, unknown>]> = [
    ["andere Art", new Map<number, unknown>([[0xfb, "sideband/x"], [0xfc, daten(MeshKind.NostrEvent, umschlag)]])],
    ["ohne Art", new Map<number, unknown>([[0xfc, daten(MeshKind.NostrEvent, umschlag)]])],
    ["Daten als Text", new Map<number, unknown>([[0xfb, RETICULUM_ART], [0xfc, "x"]])],
    ["nur das Art-Byte", new Map<number, unknown>([[0xfb, RETICULUM_ART], [0xfc, Uint8Array.from([MeshKind.NostrEvent])]])],
    ["Klartext", new Map<number, unknown>([[0xfb, RETICULUM_ART], [0xfc, daten(MeshKind.PlainText, klar)]])],
    ["kein Umschlag", new Map<number, unknown>([[0xfb, RETICULUM_ART], [0xfc, daten(MeshKind.NostrEvent, new TextEncoder().encode("{}"))]])],
  ];
  for (const [fall, felder] of faelle) assert.equal(await entpackeAusReticulum(await fremd(felder), adrB), null, fall);
  const gut = await fremd(new Map<number, unknown>([[0xfb, RETICULUM_ART], [0xfc, daten(MeshKind.NostrEvent, umschlag)]]));
  assert.deepEqual(await entpackeAusReticulum(gut, adrB), { kind: MeshKind.NostrEvent, payload: umschlag }, "dieselbe Form von außen gebaut");
});

test("B-32a: LXMF kostet wenig – die Grenze auf dem Draht trägt die größte Nutzlast", async () => {
  const a = await Identity.generate();
  const wire = await verpackeFuerReticulum({ payload: umschlag, kind: MeshKind.NostrEvent, von: a, an: await lxmfAdresse(a), eigeneSchluessel: [] });
  const aufschlag = wire.length - umschlag.length;
  assert.ok(aufschlag < 200, `LXMF kostet ${aufschlag} Byte`);
  // ab 65 536 Byte Daten braucht msgpack zwei Byte mehr für die Länge (bin 32 statt bin 16)
  assert.ok(RETICULUM_GRENZEN.nutzlast + 1 + aufschlag + 2 <= RETICULUM_GRENZEN.draht);
});

test("B-32a: Bibliothek exakt gepinnt, EUPL-1.2, nur in reticulum-umschlag.ts (seit B-32b1 auch rnode-funk.ts) und erst bei Bedarf geladen", async () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { dependencies: Record<string, string> };
  for (const name of ["@reticulum/core", "@reticulum/lxmf"]) {
    assert.equal(pkg.dependencies[name], "0.9.12", `${name} exakt gepinnt`);
    const da = JSON.parse(readFileSync(new URL(`../../../node_modules/${name}/package.json`, import.meta.url), "utf8")) as { version: string; license: string };
    assert.deepEqual([da.version, da.license], ["0.9.12", "EUPL-1.2"], name);
  }
  const { readdirSync } = await import("node:fs");
  const src = new URL("../src/", import.meta.url);
  const nutzer = (readdirSync(src, { recursive: true }) as string[])
    .filter((f) => /\.ts$/.test(f) && /@reticulum\//.test(readFileSync(new URL(f, src), "utf8")))
    .map((f) => f.replaceAll("\\", "/")).sort();
  assert.deepEqual(nutzer, ["reticulum-typen.d.ts", "reticulum-umschlag.ts", "rnode-funk.ts"]);
  for (const d of ["reticulum-umschlag.ts", "rnode-funk.ts"]) {
    assert.doesNotMatch(lies(d), /^import (?!type )[^;]*@reticulum/m, `${d}: nur dynamisch – die Bibliothek lädt nie beim Start`);
  }
});
