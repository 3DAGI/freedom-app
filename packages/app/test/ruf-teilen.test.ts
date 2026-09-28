/**
 * Schritt 5.5c: Ruf mit Kontakten teilen – nur mit Zustimmung, versiegelt, je
 * Schlag des Abruftakts höchstens ein Umschlag; empfangene Zusammenfassungen
 * nur von Kontakten, im Tresor, je Kontakt die neueste.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LocalSigner, SICHERUNG_EINTRAEGE, SICHERUNG_NIE, berechneRuf, generateKeypair, oeffneRufUmschlag, waehleSicherung,
  type NostrEvent, type RufVonKontakt, type RufZeile,
} from "@freedomstack/protocol";
import {
  LS_RUF_GESENDET, LS_RUF_KONTAKTE, LS_RUF_TEILEN, RUF_ABSTAND_SECS, RUF_KONTAKTE_MAX, RUF_PRUEFEN_JEDEN, RufVersand, RufVonKontakten,
  faelligeEmpfaenger, fingerabdruck,
} from "../src/ruf-teilen.js";

const lies = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const JETZT = 1_800_000_000;

function speicher() {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

const zeile = (provider: string, auftraege = 3): RufZeile => ({ provider, auftraege, belegt: 1, umfangMsat: 63_000, umfangLamports: 0, reklamationen: 0 });

test("5.5c: Zusammenfassungen der Kontakte – je Kontakt die neueste, nur Kontakte zählen, Kaputtes fällt weg", async () => {
  const s = speicher();
  const buch = new RufVonKontakten(s);
  const [k1, k2, fremd] = [generateKeypair().pk, generateKeypair().pk, generateKeypair().pk];
  const p = generateKeypair().pk;
  const r = (von: string, zeit: number, auftraege = 3): RufVonKontakt => ({ von, zeit, zeilen: [zeile(p, auftraege)] });
  assert.equal(await buch.nimm(r(k1, 10)), true);
  assert.equal(await buch.nimm(r(k1, 9, 99)), false, "ältere ersetzt die neuere nicht");
  assert.equal(await buch.nimm(r(k1, 11, 5)), true);
  await buch.nimm(r(k2, 10));
  await buch.nimm(r(fremd, 10));
  const kontakte = new Set([k1, k2]);
  assert.deepEqual(buch.alle(kontakte).map((x) => [x.von, x.zeilen[0].auftraege]).sort(), [[k1, 5], [k2, 3]].sort());
  assert.equal(buch.alle(new Set([k2])).length, 1, "wer kein Kontakt mehr ist, zählt nicht mehr");

  const roh = JSON.parse(s.m.get(LS_RUF_KONTAKTE)!) as unknown[];
  s.m.set(LS_RUF_KONTAKTE, JSON.stringify([...roh, { von: "zz", zeit: 1, zeilen: [] }, { ...r(k2, 99), zeilen: [{ ...zeile(p), belegt: 9 }] }, null]));
  assert.equal(buch.alle(new Set([k1, k2, fremd])).length, 3);
  s.m.set(LS_RUF_KONTAKTE, "kaputt");
  assert.deepEqual(buch.alle(kontakte), []);

  s.m.clear();
  for (let i = 0; i < RUF_KONTAKTE_MAX + 2; i++) await buch.nimm(r(generateKeypair().pk, i + 1));
  assert.equal(JSON.parse(s.m.get(LS_RUF_KONTAKTE)!).length, RUF_KONTAKTE_MAX);
});

test("5.5c: fällige Empfänger – neuer Stand höchstens einmal am Tag an alle, sonst nur neue Kontakte", () => {
  const [k1, k2, k3] = [generateKeypair().pk, generateKeypair().pk, generateKeypair().pk];
  assert.deepEqual(faelligeEmpfaenger({ kontakte: [k1, k2, k1, "quatsch"], fp: "a", stand: null, jetzt: JETZT }), { an: [k1, k2], neuerStand: true });
  const stand = { fp: "a", zeit: JETZT, an: [k1, k2] };
  assert.deepEqual(faelligeEmpfaenger({ kontakte: [k1, k2, k3], fp: "a", stand, jetzt: JETZT + 10 }), { an: [k3], neuerStand: false });
  assert.deepEqual(faelligeEmpfaenger({ kontakte: [k1, k2, k3], fp: "b", stand, jetzt: JETZT + RUF_ABSTAND_SECS - 1 }), { an: [], neuerStand: false });
  assert.deepEqual(faelligeEmpfaenger({ kontakte: [k1, k2, k3], fp: "b", stand, jetzt: JETZT + RUF_ABSTAND_SECS }), { an: [k1, k2, k3], neuerStand: true });
  assert.notEqual(fingerabdruck([zeile(k1)]), fingerabdruck([zeile(k1, 4)]));
});

function versand(o: { zustimmung?: () => boolean; geraet?: () => boolean; kontakte: string[]; zeilen: RufZeile[]; kaputt?: Set<string> }) {
  const ich = new LocalSigner(generateKeypair().sk);
  const s = speicher();
  let uhr = JETZT;
  const gesendet: { wrap: NostrEvent; an: string }[] = [];
  const v = new RufVersand({
    zustimmung: o.zustimmung ?? (() => true),
    signer: () => (o.geraet?.() ? null : ich),
    kontakte: () => o.kontakte,
    zeilen: () => o.zeilen,
    sende: async (wrap, an) => {
      if (o.kaputt?.has(an)) return false;
      gesendet.push({ wrap, an });
      return true;
    },
    speicher: s,
    jetzt: () => uhr,
  });
  const takte = async (n: number) => { for (let i = 0; i < n; i++) await v.takt(); };
  return { v, s, ich, gesendet, takte, stelle: (sek: number) => { uhr += sek; } };
}

test("5.5c: Versand nur mit Zustimmung, je Schlag ein Umschlag, nur an Kontakte – und die öffnen ihn", async () => {
  const kontakte = [generateKeypair(), generateKeypair(), generateKeypair()];
  const p = generateKeypair().pk;
  let ja = false;
  const x = versand({ zustimmung: () => ja, kontakte: kontakte.map((k) => k.pk), zeilen: [zeile(p, 7)] });
  await x.takte(3 * RUF_PRUEFEN_JEDEN);
  assert.equal(x.gesendet.length, 0, "ohne Zustimmung nichts");
  assert.equal(x.s.m.size, 0);

  ja = true;
  assert.ok(await x.v.takt());
  assert.equal(x.gesendet.length, 1, "ein Umschlag je Schlag");
  await x.takte(2);
  assert.deepEqual(x.gesendet.map((g) => g.an), kontakte.map((k) => k.pk));
  assert.ok(x.gesendet.every((g) => g.wrap.kind === 1059 && g.wrap.pubkey !== x.ich.publicKey()));
  assert.ok(x.gesendet.every((g) => g.wrap.tags.every((t) => t[0] !== "p" || t[1] === g.an)), "je Umschlag nur sein Empfänger");
  assert.deepEqual(x.v.stand()?.an, kontakte.map((k) => k.pk));

  // Der Kontakt öffnet ihn – als Zusammenfassung seines Kontakts
  const r = await oeffneRufUmschlag(x.gesendet[0].wrap, new LocalSigner(kontakte[0].sk), new Set([x.ich.publicKey()]));
  assert.deepEqual(r?.zeilen, [zeile(p, 7)]);
  assert.equal(await oeffneRufUmschlag(x.gesendet[0].wrap, new LocalSigner(kontakte[0].sk), new Set()), null, "von keinem Kontakt: zählt nicht");

  // Unverändert: nichts mehr; Zustimmung zurückgezogen: nichts
  await x.takte(3 * RUF_PRUEFEN_JEDEN);
  assert.equal(x.gesendet.length, 3);
});

test("5.5c: neue Kontakte bekommen den Stand, ein neuer Stand geht erst nach einem Tag, Unzustellbare pausieren", async () => {
  const [k1, k2, k3] = [generateKeypair().pk, generateKeypair().pk, generateKeypair().pk];
  const p = generateKeypair().pk;
  const kontakte = [k1, k2];
  const zeilen = [zeile(p, 2)];
  const kaputt = new Set([k2]);
  const x = versand({ kontakte, zeilen, kaputt });
  await x.takte(2);
  assert.deepEqual(x.gesendet.map((g) => g.an), [k1], "k2 ohne Posteingang");
  kaputt.clear();
  kontakte.push(k3);
  await x.takte(RUF_PRUEFEN_JEDEN + 1);
  assert.deepEqual(x.gesendet.map((g) => g.an), [k1, k3], "k3 neu; k2 pausiert einen Tag");

  zeilen[0] = zeile(p, 9);
  await x.takte(2 * RUF_PRUEFEN_JEDEN);
  assert.equal(x.gesendet.length, 2, "neuer Stand – aber noch kein Tag vergangen");
  x.stelle(RUF_ABSTAND_SECS);
  await x.takte(RUF_PRUEFEN_JEDEN + 3);
  assert.deepEqual(x.gesendet.slice(2).map((g) => g.an), [k1, k2, k3], "nach einem Tag an alle, auch den pausierten");
  assert.equal(x.v.stand()?.fp, fingerabdruck([zeile(p, 9)]));
});

test("5.5c: als Gerät, ohne Quittungen oder ohne Kontakte geht nichts hinaus", async () => {
  const k = generateKeypair().pk;
  for (const o of [
    { geraet: () => true, kontakte: [k], zeilen: [zeile(generateKeypair().pk)] },
    { kontakte: [k], zeilen: [] },
    { kontakte: [], zeilen: [zeile(generateKeypair().pk)] },
  ]) {
    const x = versand(o);
    await x.takte(2 * RUF_PRUEFEN_JEDEN);
    assert.equal(x.gesendet.length, 0);
  }
});

test("5.5c: Zusammenfassungen von Kontakten heben den Ruf – eine Stimme je Kontakt", () => {
  const p = generateKeypair().pk;
  const [k1, k2] = [generateKeypair().pk, generateKeypair().pk];
  const r = berechneRuf({ quittungen: [], vonKontakten: [
    { von: k1, zeit: 1, zeilen: [{ ...zeile(p, 20), belegt: 20 }] },
    { von: k1, zeit: 2, zeilen: [{ ...zeile(p, 40), belegt: 40 }] },
    { von: k2, zeit: 1, zeilen: [{ ...zeile(p, 10), belegt: 10 }] },
  ] }).get(p)!;
  assert.deepEqual([r.kontakte, r.auftraege, r.eigene], [2, 25, 0], "je Kontakt die neueste, zur Hälfte");
});

test("5.5c: verdrahtet – Empfang am Ende der Kette, Versand im Abruftakt, Zustimmung in den Settings", () => {
  assert.match(lies("shell/tabs/kommunikation.ts"), /\?\? \(await alsRaumMeldung\(w\)\) \?\? \(await alsRufZusammenfassung\(w\)\);/);
  assert.match(lies("shell/app.ts"), /abrufTakt\.melde\("ruf", \(\) => import\("\.\/ruf\.js"\)\.then\(\(r\) => r\.rufTakt\(\)\), 1\);/);
  const ruf = lies("shell/ruf.ts");
  assert.match(ruf, /signer: \(\) => \(alsGeraet\(\) \? null : state\.signer\)/, "als Gerät nicht");
  assert.match(ruf, /posteingangVon\(an\)[\s\S]*veroeffentlicheAn\(wrap, ziele\)/, "an den Posteingang des Kontakts");
  assert.doesNotMatch(ruf + lies("ruf-teilen.ts"), /publish\(|signiere|veroeffentlicheWeit|setInterval/);
  assert.match(lies("shell/quittungen.ts"), /aktuellerRuf\(vonKontakten: readonly RufVonKontakt\[\] = rufVonKontakten\.alle\(new Set\(kontakteJetzt\(\)\)\)\)/);
  assert.match(lies("shell/tabs/settings.ts"), /setzeRufTeilen\(ruf\.checked\)/);
  assert.match(lies("shell/index.html"), /<input type="checkbox" id="ruf-teilen" \/>/);
});

test("5.5c: Zusammenfassungen und Versandstand nur im Tresor und nie in der Sicherung – die Zustimmung schon", () => {
  const tresor = lies("shell/tresor.ts");
  for (const k of [LS_RUF_KONTAKTE, LS_RUF_GESENDET]) {
    assert.match(tresor, new RegExp(`const GEHEIM_FEST = \\[[^\\]]*"${k.replace(/\./g, "\\.")}"`), k);
    assert.ok(SICHERUNG_NIE.some((r) => r.test(k)), k);
  }
  assert.ok(SICHERUNG_EINTRAEGE.includes(LS_RUF_TEILEN));
  const gesichert = waehleSicherung([LS_RUF_KONTAKTE, LS_RUF_GESENDET, LS_RUF_TEILEN], () => "1");
  assert.equal(gesichert[LS_RUF_TEILEN], "1");
  assert.ok(!(LS_RUF_KONTAKTE in gesichert) && !(LS_RUF_GESENDET in gesichert));
});
