/**
 * Schritt 2.2b-c2: MLS über Nostr – Einladungen an den Posteingang (erst nach
 * dem Commit), Gruppennachrichten nur an die Relays der Gruppe, Abos mit `#h`,
 * Empfang mit Zustellung nach dem Commit, Einladung erkennen und annehmen.
 * Echte Engine, Relays als Aufzeichnungs-Relays je Adresse.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { schnorr } from "@noble/curves/secp256k1.js";
import { LocalSigner, buildPrivateDm, fromHex, generateKeypair, toHex, type NostrEvent } from "@freedomstack/protocol";
import { KIND_GRUPPENNACHRICHT, Mls, ladeMls } from "@freedomstack/mls";
import { LS_MLS_KP } from "../src/mls-keypackage.js";
import {
  aendereGruppe, empfangeGruppe, gruendeGruppe, gruppenAbos, nimmEinladungAn, oeffneEinladung, schreiteFort, sendeInGruppe, type MlsNetz,
} from "../src/mls-nostr.js";
import { AufzeichnungsRelay } from "./leak/aufzeichnung.js";

ladeMls(gunzipSync(readFileSync(new URL("../../mls/dist/freedom_mls_bg.wasm.gz", import.meta.url))));

const GRUPPE = ["wss://gruppe-a.test", "wss://gruppe-b.test"];

/** Mehrere Relays je Adresse; Posteingänge je Konto; `aus` lässt Adressen ablehnen. */
class Netz implements MlsNetz {
  relays = new Map<string, AufzeichnungsRelay>();
  eingaenge = new Map<string, string[]>();
  aus = new Set<string>();
  relay(url: string): AufzeichnungsRelay {
    if (!this.relays.has(url)) this.relays.set(url, new AufzeichnungsRelay());
    return this.relays.get(url)!;
  }
  async sendeAn(ev: NostrEvent, urls: readonly string[]): Promise<number> {
    let n = 0;
    for (const u of urls) {
      if (this.aus.has(u)) continue;
      await this.relay(u).publish(ev);
      n++;
    }
    return n;
  }
  async posteingang(pk: string): Promise<string[]> {
    return this.eingaenge.get(pk) ?? [];
  }
  /** Was an dieser Adresse ankam. */
  an(url: string): NostrEvent[] {
    return this.relay(url).gesendet;
  }
}

function person(netz: Netz, name: string) {
  const kp = generateKeypair();
  const signer = new LocalSigner(kp.sk);
  const mls = new Mls(signer, (id) => toHex(schnorr.sign(fromHex(id), kp.sk)));
  const gesichert: number[] = [];
  const sichern = async () => { gesichert.push(mls.zustand().length); };
  netz.eingaenge.set(kp.pk, [`wss://eingang-${name}.test`]);
  return { pk: kp.pk, signer, mls, gesichert, sichern, netz };
}
type Person = ReturnType<typeof person>;
const ohneSpeicher = { removeItem: () => {} };
const kpVon = async (p: Person) => p.signer.signEvent(await p.mls.keyPackage("ab".repeat(32)));

async function gruppeZuDritt() {
  const netz = new Netz();
  const [a, b, c] = [person(netz, "a"), person(netz, "b"), person(netz, "c")];
  const g = await gruendeGruppe({ mls: a.mls, netz, sichern: a.sichern, name: "Hafenrunde", keyPackages: [await kpVon(b), await kpVon(c)], relays: GRUPPE });
  for (const p of [b, c]) {
    const wrap = netz.an(`wss://eingang-${p === b ? "b" : "c"}.test`)[0]!;
    const e = await oeffneEinladung(wrap, p.signer);
    await nimmEinladungAn({ mls: p.mls, sichern: p.sichern, speicher: ohneSpeicher, einladung: e! });
  }
  return { netz, a, b, c, gruppe: g.gruppe, g };
}

/** Was ein Mitglied über sein Abo an den Relays der Gruppe liest. */
async function liesAbo(p: Person, netz: Netz, gruppe: string, seit = 0): Promise<NostrEvent[]> {
  const abo = gruppenAbos(p.mls).find((x) => x.gruppe === gruppe)!;
  const alle = new Map<string, NostrEvent>();
  for (const url of abo.relays) for (const ev of await netz.relay(url).query(abo.filter)) alle.set(ev.id, ev);
  return [...alle.values()].filter((e) => e.created_at >= seit);
}

test("Gründen: Einladungen nur an den Posteingang der Eingeladenen; ohne Posteingang → nicht zugestellt", async () => {
  const netz = new Netz();
  const [a, b, d] = [person(netz, "a"), person(netz, "b"), person(netz, "d")];
  netz.eingaenge.delete(d.pk);
  const g = await gruendeGruppe({ mls: a.mls, netz, sichern: a.sichern, name: "x", keyPackages: [await kpVon(b), await kpVon(d)], relays: GRUPPE });
  assert.deepEqual(g.nichtZugestellt, [d.pk]);
  assert.deepEqual(netz.an("wss://eingang-b.test").map((e) => e.kind), [1059]);
  for (const u of GRUPPE) assert.equal(netz.an(u).length, 0, "an die Gruppen-Relays geht keine Einladung");
  assert.equal(a.gesichert.length, 1, "vor dem Zustellen gesichert");
});

test("Einladung erkennen: nur Kind 444 an mich; NIP-17-Nachricht, fremder Umschlag → null; annehmen verbraucht das KeyPackage", async () => {
  const netz = new Netz();
  const [a, b] = [person(netz, "a"), person(netz, "b")];
  const g = await gruendeGruppe({ mls: a.mls, netz, sichern: a.sichern, name: "x", keyPackages: [await kpVon(b)], relays: GRUPPE });
  const wrap = netz.an("wss://eingang-b.test")[0]!;
  const e = await oeffneEinladung(wrap, b.signer);
  assert.deepEqual({ von: e?.von, relays: e?.relays }, { von: a.pk, relays: GRUPPE });
  assert.equal(await oeffneEinladung(wrap, a.signer), null, "nicht an mich");
  const dm = await buildPrivateDm({ signer: a.signer, recipientPk: b.pk, content: "hallo" });
  assert.equal(await oeffneEinladung(dm.toRecipient, b.signer), null, "NIP-17 ist keine Einladung");
  const speicher = new Map<string, string>([[LS_MLS_KP, "{}"]]);
  const ls = { removeItem: (k: string) => speicher.delete(k) } as unknown as Storage;
  assert.equal(await nimmEinladungAn({ mls: b.mls, sichern: b.sichern, speicher: ls, einladung: e! }), g.gruppe);
  assert.equal(speicher.has(LS_MLS_KP), false, "KeyPackage gilt als verbraucht");
  assert.equal(b.gesichert.length, 1);
});

test("Nachricht: nur an die Relays der Gruppe, über das #h-Abo gelesen", async () => {
  const { netz, a, b, c, gruppe } = await gruppeZuDritt();
  assert.equal(await sendeInGruppe({ mls: a.mls, netz, sichern: a.sichern, gruppe, text: "Treffen um 7" }), true);
  for (const u of GRUPPE) assert.deepEqual(netz.an(u).map((e) => e.kind), [KIND_GRUPPENNACHRICHT]);
  for (const u of ["wss://eingang-b.test", "wss://eingang-c.test"]) assert.ok(netz.an(u).every((e) => e.kind === 1059));
  for (const p of [b, c]) {
    const evs = await liesAbo(p, netz, gruppe);
    assert.equal(evs.length, 1, "doppelt an zwei Relays, einmal gelesen");
    const r = await empfangeGruppe({ mls: p.mls, sichern: p.sichern, ev: evs[0]! });
    assert.deepEqual(r.nachrichten.map((n) => [n.text, n.von]), [["Treffen um 7", a.pk]]);
  }
});

test("Einladen: Commit an die Gruppen-Relays, danach die Einladung; neues Mitglied liest mit", async () => {
  const { netz, a, b, gruppe } = await gruppeZuDritt();
  const d = person(netz, "d");
  const r = await aendereGruppe({ mls: a.mls, netz, sichern: a.sichern, gruppe, einladen: [await kpVon(d)] });
  assert.deepEqual(r, { angenommen: true, nichtZugestellt: [] });
  const e = await oeffneEinladung(netz.an("wss://eingang-d.test")[0]!, d.signer);
  await nimmEinladungAn({ mls: d.mls, sichern: d.sichern, speicher: ohneSpeicher, einladung: e! });
  for (const ev of await liesAbo(b, netz, gruppe)) await empfangeGruppe({ mls: b.mls, sichern: b.sichern, ev });
  await sendeInGruppe({ mls: a.mls, netz, sichern: a.sichern, gruppe, text: "mit Dora" });
  // Reihenfolge aus dem Senden – das Relay sortiert nach Sekunden, gleiche Sekunde ist Zufall
  const neu = netz.an(GRUPPE[0]!).at(-1)!;
  assert.ok((await liesAbo(d, netz, gruppe)).some((e) => e.id === neu.id), "über das Abo sichtbar");
  assert.deepEqual((await empfangeGruppe({ mls: d.mls, sichern: d.sichern, ev: neu })).nachrichten.map((n) => n.text), ["mit Dora"]);
  assert.deepEqual(a.mls.mitglieder(gruppe).length, 4);
});

test("Einladen scheitert, wenn kein Gruppen-Relay den Commit annimmt: keine Einladung, Epoche unverändert", async () => {
  const { netz, a, gruppe } = await gruppeZuDritt();
  const d = person(netz, "d");
  const epoche = a.mls.epoche(gruppe);
  for (const u of GRUPPE) netz.aus.add(u);
  const r = await aendereGruppe({ mls: a.mls, netz, sichern: a.sichern, gruppe, einladen: [await kpVon(d)] });
  assert.deepEqual(r, { angenommen: false, nichtZugestellt: [] });
  assert.equal(netz.an("wss://eingang-d.test").length, 0, "niemand eingeladen");
  assert.equal(a.mls.epoche(gruppe), epoche);
  assert.equal(a.mls.mitglieder(gruppe).length, 3);
});

test("Entfernen: das entfernte Mitglied liest danach nichts mehr; Nachricht vor dem Commit wird nachgereicht", async () => {
  const { netz, a, b, c, gruppe } = await gruppeZuDritt();
  const rm = await aendereGruppe({ mls: a.mls, netz, sichern: a.sichern, gruppe, entfernen: [b.pk] });
  assert.equal(rm.angenommen, true);
  await sendeInGruppe({ mls: a.mls, netz, sichern: a.sichern, gruppe, text: "ohne Bob" });
  const [commit, nachricht] = netz.an(GRUPPE[0]!).slice(-2);
  assert.deepEqual((await liesAbo(c, netz, gruppe)).map((e) => e.id).sort(), [commit!.id, nachricht!.id].sort(), "beide über das Abo");
  // Umgekehrte Reihenfolge: erst die Nachricht, dann der Commit
  const frueh = await empfangeGruppe({ mls: c.mls, sichern: c.sichern, ev: nachricht! });
  assert.equal(frueh.nachrichten.length, 0);
  const nachCommit = await empfangeGruppe({ mls: c.mls, sichern: c.sichern, ev: commit! });
  const w = nachCommit.wartezeit?.[gruppe];
  assert.ok(w !== undefined, "zurückgehaltene Nachricht meldet eine Wartezeit");
  await new Promise((r) => setTimeout(r, w + 20));
  assert.deepEqual((await schreiteFort({ mls: c.mls, netz, sichern: c.sichern, gruppe })).nachrichten.map((n) => n.text), ["ohne Bob"]);
  for (const ev of [commit!, nachricht!]) {
    const r = await empfangeGruppe({ mls: b.mls, sichern: b.sichern, ev }).catch(() => ({ nachrichten: [] as unknown[] }));
    assert.equal(r.nachrichten.length, 0, "Bob liest nichts");
  }
});

test("Merken vor Sichern (2.2b-d1): der Verlauf bekommt die Nachricht, bevor der Zustand gesichert wird", async () => {
  const { netz, a, b, gruppe } = await gruppeZuDritt();
  await sendeInGruppe({ mls: a.mls, netz, sichern: a.sichern, gruppe, text: "zuerst merken" });
  const ablauf: string[] = [];
  const r = await empfangeGruppe({
    mls: b.mls, ev: netz.an(GRUPPE[0]!).at(-1)!,
    merken: async (n) => { ablauf.push(`merken ${n.map((x) => x.text).join()}`); },
    sichern: async () => { ablauf.push("sichern"); },
  });
  assert.deepEqual(ablauf, ["merken zuerst merken", "sichern"]);
  assert.equal(r.nachrichten.length, 1);
});
