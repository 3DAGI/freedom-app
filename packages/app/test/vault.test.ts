/**
 * Tests fuer den Tresor (Schritt 1.2): Rundreise, falsche Passphrase,
 * manipulierte Daten (GCM-Tag und Kopf), Herabstufen der Iterationen und ein
 * Speicher-Scan, der kein bekanntes Geheimnis im Klartext finden darf.
 *
 * Laeuft gegen die echte WebCrypto von Node mit den echten Parametern
 * (600.000 Iterationen) – deshalb dauern die Tests einige Sekunden.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FalschePassphrase,
  PBKDF2_ITERATIONEN,
  SpeicherImRam,
  createVault,
  geheimSpeicher,
  sollSperren,
  sperrMinuten,
  uebernehme,
  unlock,
  vaultExists,
} from "../src/vault.js";

const PASS = "korrekt pferd batterie";
// Ein Test-Schluessel, nur fuer diese Datei erzeugt – kein echtes Geheimnis.
const NSEC_HEX = "7f3c9a1e5b2d4c6e8f0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60";
const NWC = "nostr+walletconnect://abc?relay=wss%3A%2F%2Frelay.example&secret=" + "5e".repeat(32);

async function tresorMitDaten(): Promise<SpeicherImRam> {
  const sp = new SpeicherImRam();
  const v = await createVault(PASS, sp);
  await v.set("freedom.nsec", NSEC_HEX);
  await v.set("freedom.nwc.uri", NWC);
  v.lock();
  return sp;
}

function kopf(sp: SpeicherImRam): Record<string, unknown> {
  return JSON.parse(sp.blob!) as Record<string, unknown>;
}

test("Rundreise: anlegen, setzen, sperren, entsperren – Werte sind wieder da", async () => {
  const sp = await tresorMitDaten();
  const v = await unlock(PASS, sp);
  assert.equal(v.get("freedom.nsec"), NSEC_HEX);
  assert.equal(v.get("freedom.nwc.uri"), NWC);
  assert.equal(v.get("gibt.es.nicht"), undefined);
  assert.deepEqual(v.keys().sort(), ["freedom.nsec", "freedom.nwc.uri"]);
  await v.delete("freedom.nwc.uri");
  v.lock();
  const w = await unlock(PASS, sp);
  assert.equal(w.get("freedom.nwc.uri"), undefined, "geloeschter Wert bleibt geloescht");
  assert.equal(w.get("freedom.nsec"), NSEC_HEX);
});

test("falsche Passphrase: FalschePassphrase, Daten bleiben unveraendert", async () => {
  const sp = await tresorMitDaten();
  const vorher = sp.blob;
  await assert.rejects(unlock("falsche passphrase", sp), FalschePassphrase);
  await assert.rejects(unlock(PASS + " ", sp), FalschePassphrase);
  assert.equal(sp.blob, vorher);
  assert.equal((await unlock(PASS, sp)).get("freedom.nsec"), NSEC_HEX);
});

test("manipulierter Geheimtext oder Tag: scheitert am GCM-Tag", async () => {
  const sp = await tresorMitDaten();
  const k = kopf(sp);
  const ct = Buffer.from(k.ct as string, "base64");
  for (const stelle of [0, Math.floor(ct.length / 2), ct.length - 1]) { // Anfang, Mitte, Tag
    const kaputt = Buffer.from(ct);
    kaputt[stelle] ^= 0x01;
    const sp2 = new SpeicherImRam();
    sp2.blob = JSON.stringify({ ...k, ct: kaputt.toString("base64") });
    await assert.rejects(unlock(PASS, sp2), FalschePassphrase, `Byte ${stelle}`);
  }
});

test("manipulierter Kopf: IV, Salt, Version, Verfahren, Iterationen – jede Aenderung scheitert", async () => {
  const sp = await tresorMitDaten();
  const k = kopf(sp);
  const iv = Buffer.from(k.iv as string, "base64");
  iv[0] ^= 0x01;
  const salt = Buffer.from(k.salt as string, "base64");
  salt[0] ^= 0x01;
  for (const aenderung of [
    { iv: iv.toString("base64") },
    { salt: salt.toString("base64") },
    { v: 2 },
    { kdf: "PBKDF2-SHA1" },
    { iter: PBKDF2_ITERATIONEN + 1 },
  ]) {
    const sp2 = new SpeicherImRam();
    sp2.blob = JSON.stringify({ ...k, ...aenderung });
    await assert.rejects(unlock(PASS, sp2), FalschePassphrase, JSON.stringify(aenderung));
  }
});

/** Zaehlt Schluesselableitungen – abgelehnt werden soll VOR dem Ableiten. */
async function ableitungen(f: () => Promise<unknown>): Promise<number> {
  const subtle = crypto.subtle as SubtleCrypto & { deriveKey: SubtleCrypto["deriveKey"] };
  const orig = subtle.deriveKey;
  let n = 0;
  subtle.deriveKey = function (this: SubtleCrypto, ...a: Parameters<SubtleCrypto["deriveKey"]>) {
    n++;
    return orig.apply(this, a);
  } as SubtleCrypto["deriveKey"];
  try { await f().catch(() => undefined); } finally { subtle.deriveKey = orig; }
  return n;
}

test("Herabstufen: weniger Iterationen werden gar nicht erst versucht", async () => {
  const sp = await tresorMitDaten();
  for (const iter of [1, 1000, PBKDF2_ITERATIONEN - 1, 1e12, "600000"]) {
    const sp2 = new SpeicherImRam();
    sp2.blob = JSON.stringify({ ...kopf(sp), iter });
    await assert.rejects(unlock(PASS, sp2), FalschePassphrase, String(iter));
    assert.equal(await ableitungen(() => unlock(PASS, sp2)), 0, `abgeleitet trotz iter=${iter}`);
  }
  assert.equal(await ableitungen(() => unlock(PASS, sp)), 1, "der echte Tresor wird abgeleitet");
  assert.equal(kopf(sp).iter, 600_000);
  assert.equal(kopf(sp).kdf, "PBKDF2-SHA256");
});

test("kaputte Blobs: kein JSON, fehlende Felder, falsche Laengen", async () => {
  const sp = await tresorMitDaten();
  const k = kopf(sp);
  for (const blob of [
    "kein json",
    "null",
    JSON.stringify({ ...k, ct: undefined }),
    JSON.stringify({ ...k, iv: Buffer.alloc(8).toString("base64") }),
    JSON.stringify({ ...k, salt: Buffer.alloc(8).toString("base64") }),
    JSON.stringify({ ...k, iv: "%%%" }),
  ]) {
    const sp2 = new SpeicherImRam();
    sp2.blob = blob;
    await assert.rejects(unlock(PASS, sp2), FalschePassphrase, blob.slice(0, 40));
  }
});

test("Speicher-Scan: kein Geheimnis und kein Schluesselname im gespeicherten Blob", async () => {
  const sp = await tresorMitDaten();
  const blob = sp.blob!;
  const verboten = [
    NSEC_HEX, NSEC_HEX.toUpperCase(), Buffer.from(NSEC_HEX, "hex").toString("base64"),
    Buffer.from(NSEC_HEX).toString("base64"), NWC, "walletconnect", "5e5e5e5e",
    "freedom.nsec", "freedom.nwc", PASS,
  ];
  for (const v of verboten) assert.ok(!blob.includes(v), `im Klartext gefunden: ${v.slice(0, 20)}`);
});

test("jede Speicherung bekommt eine neue IV", async () => {
  const sp = new SpeicherImRam();
  const v = await createVault(PASS, sp);
  const ivs = new Set<string>();
  for (let i = 0; i < 5; i++) {
    await v.set("x", "gleicher wert");
    ivs.add(kopf(sp).iv as string);
  }
  assert.equal(ivs.size, 5);
});

test("gesperrt: get und set werfen, erst unlock oeffnet wieder", async () => {
  const sp = new SpeicherImRam();
  const v = await createVault(PASS, sp);
  await v.set("a", "1");
  v.lock();
  assert.equal(v.locked, true);
  assert.throws(() => v.get("a"), /gesperrt/);
  assert.throws(() => v.keys(), /gesperrt/);
  assert.throws(() => void v.set("a", "2"), /gesperrt/);
  assert.equal((await unlock(PASS, sp)).get("a"), "1");
});

test("anlegen: Mindestlaenge, nie einen vorhandenen Tresor ueberschreiben", async () => {
  const sp = new SpeicherImRam();
  await assert.rejects(createVault("kurz", sp), /zu kurz/);
  assert.equal(await vaultExists(sp), false);
  await createVault(PASS, sp);
  assert.equal(await vaultExists(sp), true);
  const vorher = sp.blob;
  await assert.rejects(createVault("andere passphrase", sp), /schon einen Tresor/);
  assert.equal(sp.blob, vorher);
  await assert.rejects(unlock(PASS, new SpeicherImRam()), /Kein Tresor/);
});

test("gleichzeitige Schreibvorgaenge: der zuletzt gesetzte Stand gewinnt", async () => {
  const sp = new SpeicherImRam();
  const v = await createVault(PASS, sp);
  await Promise.all([v.set("a", "1"), v.set("b", "2"), v.set("a", "3")]);
  v.lock();
  const w = await unlock(PASS, sp);
  assert.equal(w.get("a"), "3");
  assert.equal(w.get("b"), "2");
});

test("Passphrase in anderer Unicode-Zusammensetzung oeffnet denselben Tresor (NFC)", async () => {
  const sp = new SpeicherImRam();
  const zusammen = "café-tresor-1";   // é als ein Zeichen
  const zerlegt = "café-tresor-1";   // e + Akzent
  const v = await createVault(zusammen, sp);
  await v.set("k", "v");
  v.lock();
  assert.equal((await unlock(zerlegt, sp)).get("k"), "v");
});

// ------------------------------------------------------------- Uebernahme aus localStorage

class FakeStorage {
  werte = new Map<string, string>();
  getItem(k: string): string | null { return this.werte.get(k) ?? null; }
  setItem(k: string, v: string): void { this.werte.set(k, v); }
  removeItem(k: string): void { this.werte.delete(k); }
  key(i: number): string | null { return [...this.werte.keys()][i] ?? null; }
  get length(): number { return this.werte.size; }
}

test("Uebernahme: Werte stehen im Tresor, der Klartext ist danach weg", async () => {
  const sp = new SpeicherImRam();
  const ls = new FakeStorage();
  ls.setItem("freedom.nsec", NSEC_HEX);
  ls.setItem("freedom.lang", "de");
  const v = await createVault(PASS, sp);
  const uebernommen = await uebernehme(v, ls, ["freedom.nsec", "freedom.fehlt"], () => unlock(PASS, sp));
  assert.deepEqual(uebernommen, ["freedom.nsec"]);
  assert.equal(ls.getItem("freedom.nsec"), null, "Klartext geloescht");
  assert.equal(ls.getItem("freedom.lang"), "de", "nicht genannte Werte bleiben");
  v.lock();
  assert.equal((await unlock(PASS, sp)).get("freedom.nsec"), NSEC_HEX);
  assert.ok(!sp.blob!.includes(NSEC_HEX));
});

test("Uebernahme: scheitert die Kontrolle, bleibt der Klartext stehen", async () => {
  const sp = new SpeicherImRam();
  const ls = new FakeStorage();
  ls.setItem("freedom.nsec", NSEC_HEX);
  const v = await createVault(PASS, sp);
  // Kontrolle liest einen anderen Stand (z. B. Schreiben nicht angekommen)
  const leer = new SpeicherImRam();
  await createVault(PASS, leer);
  await assert.rejects(uebernehme(v, ls, ["freedom.nsec"], () => unlock(PASS, leer)), /nicht bestätigt/);
  assert.equal(ls.getItem("freedom.nsec"), NSEC_HEX, "Klartext bleibt, nichts geht verloren");
  // Kontrolle wirft (z. B. Speicher nicht lesbar)
  await assert.rejects(uebernehme(v, ls, ["freedom.nsec"], () => Promise.reject(new Error("weg"))), /weg/);
  assert.equal(ls.getItem("freedom.nsec"), NSEC_HEX);
});

// ------------------------------------------------------------- Geheimspeicher (1.2c)

test("Geheimspeicher ohne Tresor: wie bisher localStorage", async () => {
  const ls = new FakeStorage();
  const g = geheimSpeicher(() => null, () => false, ls);
  await g.setItem("freedom.chats", "[1]");
  assert.equal(ls.getItem("freedom.chats"), "[1]");
  assert.equal(g.getItem("freedom.chats"), "[1]");
  assert.deepEqual(g.keys(), ["freedom.chats"]);
  await g.removeItem("freedom.chats");
  assert.equal(ls.length, 0);
});

test("Geheimspeicher mit offenem Tresor: alles verschluesselt, nichts in localStorage", async () => {
  const ls = new FakeStorage();
  const sp = new SpeicherImRam();
  const v = await createVault(PASS, sp);
  const g = geheimSpeicher(() => v, () => true, ls);
  await g.setItem("freedom.nwc.uri", NWC);
  assert.equal(g.getItem("freedom.nwc.uri"), NWC);
  assert.deepEqual(g.keys(), ["freedom.nwc.uri"]);
  assert.equal(ls.length, 0, "kein Klartext in localStorage");
  assert.ok(!sp.blob!.includes("walletconnect"));
  v.lock();
  assert.equal((await unlock(PASS, sp)).get("freedom.nwc.uri"), NWC, "nach dem Speichern wieder lesbar");
});

test("Geheimspeicher: eingerichtet, aber gesperrt – nie Ausweichen auf localStorage", async () => {
  const ls = new FakeStorage();
  ls.setItem("freedom.chats", "alter klartext");
  const sp = new SpeicherImRam();
  const v = await createVault(PASS, sp);
  v.lock();
  for (const tresor of [() => null, () => v]) {
    const g = geheimSpeicher(tresor, () => true, ls);
    assert.equal(g.getItem("freedom.chats"), null, "kein Lesen aus localStorage");
    assert.deepEqual(g.keys(), []);
    await assert.rejects(g.setItem("freedom.chats", "neu"), /gesperrt/);
    await assert.rejects(g.removeItem("freedom.chats"), /gesperrt/);
  }
  assert.equal(ls.getItem("freedom.chats"), "alter klartext", "localStorage unberuehrt");
  assert.equal(ls.length, 1);
});

// ------------------------------------------------------------- Automatische Sperre (1.2d)

test("Sperre: nach der eingestellten Zeit ohne Eingabe, nie vorher", () => {
  const basis = { letzteEingabe: 0, minuten: 15, offen: true, beschaeftigt: false };
  assert.equal(sollSperren({ ...basis, jetzt: 15 * 60_000 - 1 }), false);
  assert.equal(sollSperren({ ...basis, jetzt: 15 * 60_000 }), true);
  assert.equal(sollSperren({ ...basis, jetzt: 3 * 60 * 60_000 }), true);
});

test("Sperre: nicht, wenn aus (0), schon gesperrt oder ein Geldvorgang laeuft", () => {
  const spaet = { jetzt: 10 * 60 * 60_000, letzteEingabe: 0 };
  assert.equal(sollSperren({ ...spaet, minuten: 0, offen: true, beschaeftigt: false }), false, "0 = nie");
  assert.equal(sollSperren({ ...spaet, minuten: 15, offen: false, beschaeftigt: false }), false);
  assert.equal(sollSperren({ ...spaet, minuten: 15, offen: true, beschaeftigt: true }), false,
    "nicht mitten in einen Tausch hinein");
});

test("Sperre: Einstellung lesen – Standard 15, 0 erlaubt, Unsinn faellt auf den Standard", () => {
  assert.equal(sperrMinuten(null), 15);
  assert.equal(sperrMinuten(""), 15);
  assert.equal(sperrMinuten("0"), 0);
  assert.equal(sperrMinuten("5"), 5);
  assert.equal(sperrMinuten("7.9"), 7);
  for (const u of ["-1", "abc", "1e9", "NaN", "Infinity"]) assert.equal(sperrMinuten(u), 15, u);
});
