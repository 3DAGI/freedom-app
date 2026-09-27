/**
 * Schritt 2.2b-c: KeyPackages nach Marmot – Platz (d-Tag), Form, Auswahl,
 * Erneuern, Veröffentlichen (erst sichern, dann senden) und Suchen über die
 * NIP-65-Liste des Kontakts; Ende zu Ende über das Aufzeichnungs-Relay mit der
 * echten Engine und verschlüsselt gesichertem Zustand.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { schnorr } from "@noble/curves/secp256k1.js";
import { LocalSigner, fromHex, generateKeypair, toHex, type NostrEvent, type RelayFilter, type UnsignedEvent } from "@freedomstack/protocol";
import { KIND_KEY_PACKAGE, Mls, ladeMls } from "@freedomstack/mls";
import {
  KP_ERNEUERN_S, LS_MLS_KP, LS_MLS_PLATZ, kpErneuern, kpGueltig, kpPlatz, kpVerbraucht,
  sucheKeyPackages, veroeffentlicheKeyPackage, waehleKeyPackages,
} from "../src/mls-keypackage.js";
import { MlsZustand, mlsSchluessel } from "../src/mls-speicher.js";
import { SpeicherImRam, geheimSpeicher } from "../src/vault.js";
import { aufzeichnung } from "./leak/aufzeichnung.js";
import { setLang } from "../src/i18n.js";

// Meldungen hier auf Deutsch prüfen (seit 8.16g2a über Schlüssel in der Sprache der Oberfläche)
setLang("de");

ladeMls(gunzipSync(readFileSync(new URL("../../mls/dist/freedom_mls_bg.wasm.gz", import.meta.url))));

class FakeStorage {
  werte = new Map<string, string>();
  getItem(k: string): string | null { return this.werte.get(k) ?? null; }
  setItem(k: string, v: string): void { this.werte.set(k, v); }
  removeItem(k: string): void { this.werte.delete(k); }
  key(i: number): string | null { return [...this.werte.keys()][i] ?? null; }
  get length(): number { return this.werte.size; }
}

function person() {
  const kp = generateKeypair();
  const signer = new LocalSigner(kp.sk);
  const beweis = (id: string) => toHex(schnorr.sign(fromHex(id), kp.sk));
  return { pk: kp.pk, signer, beweis, mls: new Mls(signer, beweis) };
}

const PLATZ = "ab".repeat(32);
const bob = person();
const roh = await bob.mls.keyPackage(PLATZ);
const echt = await bob.signer.signEvent(roh);
/** Bobs KeyPackage mit geänderten Tags/Inhalt, von Bob gültig signiert. */
const variante = (f: (e: UnsignedEvent) => UnsignedEvent) => bob.signer.signEvent(f(structuredClone(roh)));
const tagsOhne = (e: UnsignedEvent, name: string) => e.tags.filter((t) => t[0] !== name);

test("Platz: 32 Zufallsbytes hex, bleibt gleich; Unsinn im Speicher → neu", () => {
  const s = new FakeStorage();
  const p = kpPlatz(s);
  assert.match(p, /^[0-9a-f]{64}$/);
  assert.equal(kpPlatz(s), p);
  assert.notEqual(kpPlatz(new FakeStorage()), p);
  s.setItem(LS_MLS_PLATZ, "geraet-1");
  assert.match(kpPlatz(s), /^[0-9a-f]{64}$/);
});

test("Form: das KeyPackage der Engine ist gültig – mit Platz als d, i als KeyPackageRef", () => {
  assert.equal(echt.kind, KIND_KEY_PACKAGE);
  assert.ok(kpGueltig(echt, bob.pk));
  assert.equal(echt.tags.find((t) => t[0] === "d")?.[1], PLATZ);
  assert.match(echt.tags.find((t) => t[0] === "i")![1]!, /^[0-9a-f]{64}$/);
});

test("Form: abgelehnt – fremder Autor, verändert, geteilte oder doppelte Listen, ohne Kontobeweis-Komponente, falscher d, Version, Inhalt", async () => {
  assert.equal(kpGueltig(echt, generateKeypair().pk), false, "anderer Autor");
  assert.equal(kpGueltig({ ...echt, content: echt.content.slice(4) }, bob.pk), false, "Signatur passt nicht mehr");
  const falsch: [string, (e: UnsignedEvent) => UnsignedEvent][] = [
    ["Liste geteilt", (e) => ({ ...e, tags: [...e.tags, ["app_components", "0x8009"]] })],
    ["Wert doppelt", (e) => ({ ...e, tags: e.tags.map((t) => (t[0] === "mls_proposals" ? [...t, t[1]!] : t)) })],
    ["ohne 0x8009", (e) => ({ ...e, tags: e.tags.map((t) => (t[0] === "app_components" ? t.filter((w) => w !== "0x8009") : t)) })],
    ["leere Liste", (e) => ({ ...e, tags: e.tags.map((t) => (t[0] === "mls_extensions" ? ["mls_extensions"] : t)) })],
    ["Großbuchstaben", (e) => ({ ...e, tags: e.tags.map((t) => (t[0] === "mls_ciphersuite" ? ["mls_ciphersuite", "0X0001"] : t)) })],
    ["d kein Zufallswert", (e) => ({ ...e, tags: e.tags.map((t) => (t[0] === "d" ? ["d", "geraet-1"] : t)) })],
    ["ohne i", (e) => ({ ...e, tags: tagsOhne(e, "i") })],
    ["Version", (e) => ({ ...e, tags: e.tags.map((t) => (t[0] === "mls_protocol_version" ? [t[0], "2.0"] : t)) })],
    ["Inhalt kein Base64", (e) => ({ ...e, content: e.content + "!" })],
    ["falsche Art", (e) => ({ ...e, kind: 443 })],
  ];
  for (const [was, f] of falsch) assert.equal(kpGueltig(await variante(f), bob.pk), false, was);
});

test("Auswahl: je Platz das neueste, dann das neueste, bei Gleichstand kleineres i; Ungültiges fällt heraus", async () => {
  const mitZeit = (zeit: number, d = PLATZ, i?: string) => variante((e) => ({
    ...e, created_at: zeit, tags: e.tags.map((t) => (t[0] === "d" ? ["d", d] : t[0] === "i" && i ? ["i", i] : t)),
  }));
  const alt = await mitZeit(1000);
  const neu = await mitZeit(2000);
  const anderer = await mitZeit(1500, "cd".repeat(32));
  assert.deepEqual(waehleKeyPackages([alt, anderer, neu], bob.pk).map((e) => e.id), [neu.id, anderer.id]);
  const hoch = await mitZeit(3000, "01".repeat(32), "ff".repeat(32));
  const tief = await mitZeit(3000, "02".repeat(32), "00".repeat(32));
  assert.deepEqual(waehleKeyPackages([hoch, tief], bob.pk).map((e) => e.id), [tief.id, hoch.id]);
  assert.deepEqual(waehleKeyPackages([{ ...neu, sig: "00".repeat(64) }, alt], bob.pk).map((e) => e.id), [alt.id]);
  assert.deepEqual(waehleKeyPackages([echt], generateKeypair().pk), []);
});

test("Erneuern: ohne, nach 30 Tagen, verbraucht oder unplausibel – sonst nicht", () => {
  const s = new FakeStorage();
  const jetzt = 1_800_000_000;
  assert.equal(kpErneuern(s, jetzt), true);
  s.setItem(LS_MLS_KP, JSON.stringify({ id: "x", zeit: jetzt - 86_400 }));
  assert.equal(kpErneuern(s, jetzt), false);
  assert.equal(kpErneuern(s, jetzt - 86_400 + KP_ERNEUERN_S), true);
  s.setItem(LS_MLS_KP, JSON.stringify({ id: "x", zeit: jetzt + 86_400 }));
  assert.equal(kpErneuern(s, jetzt), true, "aus der Zukunft");
  s.setItem(LS_MLS_KP, "{kaputt");
  assert.equal(kpErneuern(s, jetzt), true);
  s.setItem(LS_MLS_KP, JSON.stringify({ id: "x", zeit: jetzt }));
  kpVerbraucht(s);
  assert.equal(kpErneuern(s, jetzt), true);
});

test("Veröffentlichen: erst sichern, dann senden; nimmt kein Relay an → Fehler, nichts gemerkt", async () => {
  const p = person();
  const s = new FakeStorage();
  const ablauf: string[] = [];
  const ev = await veroeffentlicheKeyPackage({
    mls: p.mls, signer: p.signer, speicher: s,
    sichern: async () => { ablauf.push("sichern"); },
    senden: async (e) => { ablauf.push(`senden ${e.kind}`); return 1; },
  });
  assert.deepEqual(ablauf, ["sichern", `senden ${KIND_KEY_PACKAGE}`]);
  assert.ok(kpGueltig(ev, p.pk));
  assert.equal(ev.tags.find((t) => t[0] === "d")?.[1], s.getItem(LS_MLS_PLATZ));
  assert.deepEqual(JSON.parse(s.getItem(LS_MLS_KP)!), { id: ev.id, zeit: ev.created_at });
  const s2 = new FakeStorage();
  await assert.rejects(veroeffentlicheKeyPackage({ mls: p.mls, signer: p.signer, speicher: s2, sichern: async () => {}, senden: async () => 0 }), /kein Relay/);
  assert.equal(s2.getItem(LS_MLS_KP), null);
});

test("Ende zu Ende: Bob veröffentlicht (Zustand verschlüsselt gesichert), Alice findet es über Bobs NIP-65-Liste, lädt ein; Bob tritt nach Neuladen bei", async () => {
  const { pool, relay } = aufzeichnung();
  const [alice, b] = [person(), person()];
  const ls = new FakeStorage();
  const zustand = new MlsZustand(new SpeicherImRam(), await mlsSchluessel(geheimSpeicher(() => null, () => false, ls)));
  await pool.publish(await b.signer.signEvent({
    pubkey: b.pk, created_at: Math.floor(Date.now() / 1000), kind: 10002, content: "",
    tags: [["r", "wss://schreib.test", "write"], ["r", "wss://lese.test", "read"]],
  }));
  await veroeffentlicheKeyPackage({
    mls: b.mls, signer: b.signer, speicher: ls,
    sichern: () => zustand.sichern(b.mls.zustand()),
    senden: async (e) => (await pool.publish(e)).accepted.length,
  });

  const gefragt: (readonly string[] | undefined)[] = [];
  const kps = await sucheKeyPackages({
    pk: b.pk,
    abfrage: async (f: RelayFilter, urls?: readonly string[]) => { gefragt.push(urls); return pool.query(f); },
  });
  assert.deepEqual(gefragt, [undefined, ["wss://schreib.test"]], "KeyPackages nur an Bobs Schreib-Relays");
  assert.equal(kps.length, 1);
  const g = await alice.mls.gruppeAnlegen("Hafenrunde", kps, ["wss://gruppe.test"]);

  const bNeu = new Mls(b.signer, b.beweis, await zustand.laden());
  assert.equal(await bNeu.beitreten(g.einladungen[0]!), g.gruppe);
  const s = await alice.mls.senden(g.gruppe, "Willkommen");
  assert.deepEqual((await bNeu.empfangen(s.events[0]!)).nachrichten.map((n) => n.text), ["Willkommen"]);
  // Was das Relay sah: Liste und KeyPackage von Bob – nichts, was nur Bob wissen darf
  assert.deepEqual(relay.gesendet.map((e: NostrEvent) => e.kind), [10002, KIND_KEY_PACKAGE]);
  assert.ok(!JSON.stringify(relay.gesendet).includes(ls.getItem("freedom.mls.schluessel")!));
});
