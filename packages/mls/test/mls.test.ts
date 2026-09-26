/**
 * Schritt 2.2b-a: MLS nach Marmot mit der echten MDK-Engine (WASM aus dist/).
 * Geprüft wird, was die Karte verlangt – Nachricht, Hinzufügen, Entfernen
 * (entferntes Mitglied liest nach dem Commit nichts mehr), Wiederholung,
 * Reihenfolge – und was Relays sehen: nur Chiffretext, Umschläge und nicht
 * verknüpfbare Schlüssel.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { schnorr } from "@noble/curves/secp256k1.js";
import { LocalSigner, fromHex, generateKeypair, toHex, type NostrEvent } from "@freedomstack/protocol";
import { KIND_GRUPPENNACHRICHT, KIND_KEY_PACKAGE, Mls, beweisBruecke, ladeMls, signerBruecke } from "../src/index.js";

ladeMls(gunzipSync(readFileSync(new URL("../dist/freedom_mls_bg.wasm.gz", import.meta.url))));

const RELAYS = ["wss://nostr.mom", "wss://offchain.pub"];
const schlafe = (ms: number) => new Promise((r) => setTimeout(r, ms));

function person() {
  const kp = generateKeypair();
  const signer = new LocalSigner(kp.sk);
  const beweis = (idHex: string) => toHex(schnorr.sign(fromHex(idHex), kp.sk));
  return { pk: kp.pk, signer, beweis, mls: new Mls(signer, beweis) };
}
type Person = ReturnType<typeof person>;

const keyPackage = async (p: Person) => p.signer.signEvent(await p.mls.keyPackage("geraet-1"));
const fuer = (einladungen: NostrEvent[], pk: string) => einladungen.find((e) => e.tags.some((t) => t[0] === "p" && t[1] === pk))!;

async function gruppeZuDritt() {
  const [a, b, c] = [person(), person(), person()];
  const g = await a.mls.gruppeAnlegen("Test", [await keyPackage(b), await keyPackage(c)], RELAYS);
  for (const p of [b, c]) assert.equal(await p.mls.beitreten(fuer(g.einladungen, p.pk)), g.gruppe);
  return { a, b, c, gruppe: g.gruppe, einladungen: g.einladungen };
}

async function konvergiere(p: Person, gruppe: string) {
  const w = p.mls.wartezeit(gruppe);
  if (w !== undefined) await schlafe(w + 20);
  return p.mls.fortschreiten(gruppe);
}

test("KeyPackage: Kind 30443 mit den Marmot-Tags, vom Konto selbst; fremd unterschrieben abgelehnt", async () => {
  const [a, b, c] = [person(), person(), person()];
  const kp = await keyPackage(b);
  assert.equal(kp.kind, KIND_KEY_PACKAGE);
  assert.equal(kp.pubkey, b.pk);
  assert.deepEqual(kp.tags.map((t) => t[0]), ["d", "mls_protocol_version", "i", "mls_ciphersuite", "mls_extensions", "mls_proposals", "app_components"]);
  assert.ok(kp.tags.some((t) => t[0] === "mls_ciphersuite" && t[1] === "0x0001"), "Pflicht-Ciphersuite");
  // Carol unterschreibt Bobs KeyPackage: gehört nicht dem Absender
  const falsch = await c.signer.signEvent({ ...(await b.mls.keyPackage("geraet-2")), pubkey: c.pk });
  await assert.rejects(a.mls.gruppeAnlegen("x", [falsch], RELAYS), /gehört nicht dem Absender|credential/i);
});

test("Gruppe: Einladungen einzeln im Umschlag, nicht von der Identität; alle drei sind Mitglied", async () => {
  const { a, b, c, gruppe, einladungen } = await gruppeZuDritt();
  assert.equal(einladungen.length, 2);
  for (const e of einladungen) {
    assert.equal(e.kind, 1059);
    assert.ok(![a.pk, b.pk, c.pk].includes(e.pubkey), "Umschlag von einem Wegwerf-Schlüssel");
  }
  assert.equal(new Set(einladungen.map((e) => e.id)).size, 2);
  for (const p of [a, b, c]) assert.deepEqual(p.mls.mitglieder(gruppe).sort(), [a.pk, b.pk, c.pk].sort());
});

test("Nachricht: Kind 445 von einem Wegwerf-Schlüssel, nur h-Tag, kein Klartext; alle lesen, Wiederholung ignoriert", async () => {
  const { a, b, c, gruppe } = await gruppeZuDritt();
  const s = await a.mls.senden(gruppe, "Hallo Gruppe 4711");
  assert.equal(s.events.length, 1);
  const ev = s.events[0];
  assert.equal(ev.kind, KIND_GRUPPENNACHRICHT);
  assert.ok(![a.pk, b.pk, c.pk].includes(ev.pubkey));
  assert.deepEqual(ev.tags.map((t) => t[0]), ["h"]);
  assert.ok(!JSON.stringify(ev).includes("4711"), "kein Klartext");
  assert.notEqual(ev.tags[0][1], gruppe, "gehashte Gruppen-Id, nicht die MLS-Gruppen-Id");
  for (const p of [b, c]) {
    const r = await p.mls.empfangen(ev);
    assert.deepEqual(r.nachrichten.map((n) => [n.text, n.von]), [["Hallo Gruppe 4711", a.pk]]);
  }
  const zweimal = await b.mls.empfangen(ev);
  assert.equal(zweimal.nachrichten.length, 0);
  assert.equal(zweimal.ergebnis, "Ignored");
  const zweite = await a.mls.senden(gruppe, "zweite");
  assert.notEqual(zweite.events[0].pubkey, ev.pubkey, "jede Nachricht ein neuer Schlüssel");
});

test("Entfernen: nach dem Commit liest das entfernte Mitglied nichts mehr, die anderen schon", async () => {
  const { a, b, c, gruppe } = await gruppeZuDritt();
  const rm = await a.mls.entfernen(gruppe, [b.pk]);
  assert.ok(rm.ausstehend);
  await a.mls.bestaetigt(rm.ausstehend!);
  for (const p of [c, b]) {
    await p.mls.empfangen(rm.events[0]);
    await konvergiere(p, gruppe);
  }
  assert.deepEqual(a.mls.mitglieder(gruppe).sort(), [a.pk, c.pk].sort());
  assert.deepEqual(c.mls.mitglieder(gruppe).sort(), [a.pk, c.pk].sort());
  const s = await a.mls.senden(gruppe, "ohne Bob");
  assert.deepEqual((await c.mls.empfangen(s.events[0])).nachrichten.map((n) => n.text), ["ohne Bob"]);
  const bob = await b.mls.empfangen(s.events[0]).catch(() => ({ nachrichten: [] as unknown[] }));
  assert.equal(bob.nachrichten.length, 0, "Bob liest nichts mehr");
});

test("Hinzufügen: ein neues Mitglied liest danach mit, alte Nachrichten nicht", async () => {
  const { a, b, gruppe } = await gruppeZuDritt();
  const vorher = await a.mls.senden(gruppe, "vor Dora");
  const d = person();
  const inv = await a.mls.einladen(gruppe, [await keyPackage(d)]);
  assert.equal(inv.einladungen.length, 1);
  await a.mls.bestaetigt(inv.ausstehend!);
  await b.mls.empfangen(inv.events[0]);
  await konvergiere(b, gruppe);
  assert.equal(await d.mls.beitreten(inv.einladungen[0]), gruppe);
  const nachher = await a.mls.senden(gruppe, "mit Dora");
  assert.deepEqual((await d.mls.empfangen(nachher.events[0])).nachrichten.map((n) => n.text), ["mit Dora"]);
  assert.deepEqual((await b.mls.empfangen(nachher.events[0])).nachrichten.map((n) => n.text), ["mit Dora"]);
  const alt = await d.mls.empfangen(vorher.events[0]).catch(() => ({ nachrichten: [] as unknown[] }));
  assert.equal(alt.nachrichten.length, 0, "Dora liest nichts von vor ihrem Beitritt");
});

test("Zustand: exportieren, neu laden, weiter senden und lesen", async () => {
  const { a, c, gruppe } = await gruppeZuDritt();
  const z = c.mls.zustand();
  assert.ok(z.length > 0);
  const c2 = new Mls(c.signer, c.beweis, z);
  assert.ok(c2.gruppen().includes(gruppe));
  const s = await c2.senden(gruppe, "wieder da");
  assert.deepEqual((await a.mls.empfangen(s.events[0])).nachrichten.map((n) => [n.text, n.von]), [["wieder da", c.pk]]);
});

test("Manipuliert: veränderte oder falsch signierte Events werden abgewiesen", async () => {
  const { a, b, gruppe } = await gruppeZuDritt();
  const s = await a.mls.senden(gruppe, "echt");
  const ev = s.events[0];
  const inhalt = ev.content.slice(0, -4) + (ev.content.endsWith("AAAA") ? "BBBB" : "AAAA");
  await assert.rejects(b.mls.empfangen({ ...ev, content: inhalt }));
  await assert.rejects(b.mls.empfangen({ ...ev, sig: "00".repeat(64) }));
  assert.deepEqual((await b.mls.empfangen(ev)).nachrichten.map((n) => n.text), ["echt"]);
});

test("Brücken signieren nur ihr Eigenes: Kontobeweis nur Kind 450, Signer nur Siegel (Kind 13)", async () => {
  const p = person();
  const fremd = JSON.stringify({ pubkey: p.pk, created_at: 1, kind: 1, tags: [], content: "hallo" });
  assert.throws(() => beweisBruecke(p.pk, p.beweis)(fremd), /kein Marmot-Kontobeweis/);
  await assert.rejects(signerBruecke(p.signer).signEvent(fremd), /nur Siegel/);
  const fremderAutor = JSON.stringify({ pubkey: generateKeypair().pk, created_at: 1, kind: 13, tags: [], content: "x" });
  await assert.rejects(signerBruecke(p.signer).signEvent(fremderAutor), /nur Siegel/);
});

test("Reihenfolge: eine Nachricht vor ihrem Commit wird zurückgehalten und danach zugestellt", async () => {
  const { a, b, c, gruppe } = await gruppeZuDritt();
  const rm = await a.mls.entfernen(gruppe, [b.pk]);
  await a.mls.bestaetigt(rm.ausstehend!);
  const s = await a.mls.senden(gruppe, "nach dem Commit");
  const zuFrueh = await c.mls.empfangen(s.events[0]);
  assert.equal(zuFrueh.ergebnis, "TransportDeferred");
  assert.equal(zuFrueh.nachrichten.length, 0);
  await c.mls.empfangen(rm.events[0]);
  const f = await konvergiere(c, gruppe);
  assert.deepEqual(f.nachrichten.map((n) => n.text), ["nach dem Commit"]);
  assert.equal((await c.mls.empfangen(s.events[0])).ergebnis, "Ignored", "nicht doppelt");
});
