/**
 * Schritt A-12b1: Kasse im Raum – Adresse der Kasse in der Definition (offen nur vom Gründer,
 * privat nur von Admins), Recht „kasse“, Adressen der Mitglieder mit Nachweis, Abweichungen
 * zwischen Raum und Kette (`docs/KASSE-ENTWURF.md` V3–V5).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, type NostrEvent, type UnsignedEvent } from "../src/event.js";
import {
  ALL_PERMISSIONS, JEDER_ROLLE, buildRoleGrant, buildRoles, buildSpace, can, parseRoles, parseSpace, raumAdresse,
} from "../src/spaces.js";
import { raumZustandFuer } from "../src/raum-repo.js";
import { gruppenRaum, raumDefinition, raumRollen, type InneresEvent, type InneresSenden } from "../src/raum-gruppe.js";
import {
  KIND_KASSEN_ADRESSE, baueKassenAdresse, kassenAbweichungen, kassenAdressenOffen, kassenAdressenPrivat, kassenHinweisKanal, kassenNachweisNachricht,
  kassenOrt, mitKassenRecht, mitKassenTag, pruefeKassenNachweis, raumKassenAdresse, signiereKassenAdresse,
} from "../src/raum-kasse.js";
import { kassenAdresse } from "../src/kasse.js";

const besitzer = generateKeypair();
const kassierer = generateKeypair();
const mitglied = generateKeypair();
const fremd = generateKeypair();
const SPACE = "werkstatt-ab12cd";
const RAUM = raumAdresse(besitzer.pk, SPACE);
const ZEIT = 1_790_000_000;
const s = (ev: UnsignedEvent, k: { sk: Uint8Array }) => signEvent(ev, k.sk);
/** Feste Solana-Schlüssel – je Mitglied eine eigene Adresse (V4). */
const sol = (n: number) => new Uint8Array(32).fill(n);
const KASSE = kassenAdresse(signiereKassenAdresse("x", besitzer.pk, sol(99)).adresse);
const ANDERE_KASSE = kassenAdresse(signiereKassenAdresse("x", besitzer.pk, sol(98)).adresse);

function raum(kasse?: string): NostrEvent[] {
  return [
    s(buildSpace({ spaceId: SPACE, name: "Werkstatt", ownerPubkey: besitzer.pk, channels: [], kasse }, ZEIT), besitzer),
    s(buildRoles(SPACE, besitzer.pk, [
      { id: "kasse", name: "Kasse", rank: 30, permissions: ["lesen", "schreiben", "kasse"] },
      { id: "mitglied", name: "Mitglied", rank: 10, permissions: ["lesen", "schreiben"] },
      // „kasse“ in der Rolle für alle zählt nicht – sie bringt nur Grundrechte (B-22)
      { id: JEDER_ROLLE, name: "Jeder", rank: 0, permissions: ["lesen", "schreiben", "threads", "kasse"] },
    ], ZEIT + 1), besitzer),
    s(buildRoleGrant(SPACE, besitzer.pk, kassierer.pk, ["kasse"], ZEIT + 2), besitzer),
    s(buildRoleGrant(SPACE, besitzer.pk, mitglied.pk, ["mitglied"], ZEIT + 3), besitzer),
  ];
}
/** Meldung im offenen Raum, mit gültigem Nachweis der eigenen Adresse. */
function meldung(k: { pk: string; sk: Uint8Array }, n: number, zeit = ZEIT + 10, raumA = RAUM): NostrEvent {
  const { adresse, nachweis } = signiereKassenAdresse(raumA, k.pk, sol(n));
  return s(baueKassenAdresse({ autor: k.pk, raum: raumA, adresse, nachweis, createdAt: zeit }), k);
}
const adresseVon = (ort: string, pk: string, n: number) => signiereKassenAdresse(ort, pk, sol(n)).adresse;

test("A-12b1: Kasse in der Definition – offen nur vom Gründer, eine unlesbare Adresse heißt keine Kasse", () => {
  const zustand = raumZustandFuer(RAUM, raum(KASSE), ZEIT + 100);
  assert.equal(zustand?.space?.kasse, KASSE, "aus der Definition des Gründers, auch nach den Kanälen (B-20)");
  assert.equal(raumZustandFuer(RAUM, raum(), ZEIT + 100)?.space?.kasse, undefined, "ohne Tag keine Kasse");

  const unterschoben = s(buildSpace({ spaceId: SPACE, name: "Werkstatt", ownerPubkey: fremd.pk, channels: [], kasse: ANDERE_KASSE }, ZEIT + 50), fremd);
  assert.equal(raumZustandFuer(RAUM, [...raum(KASSE), unterschoben], ZEIT + 100)?.space?.kasse, KASSE, "eine neuere Definition eines anderen zählt nicht");

  assert.throws(() => buildSpace({ spaceId: SPACE, name: "W", ownerPubkey: besitzer.pk, channels: [], kasse: "kaputt" }), /Kasse ungültig/);
  const ev = s(buildSpace({ spaceId: SPACE, name: "W", ownerPubkey: besitzer.pk, channels: [] }, ZEIT), besitzer);
  for (const x of ["kaputt", "", `${KASSE.slice(0, -1)}0`, "1".repeat(31), `${KASSE}1`]) {
    const sp = parseSpace({ ...ev, tags: [...ev.tags, ["kasse", x]] });
    assert.equal(sp.name, "W", "der Raum bleibt lesbar");
    assert.equal(sp.kasse, undefined, x);
  }
});

test("A-12b1: Kasse im privaten Raum nur aus der Definition eines Admins", () => {
  const GRUPPE = "5d0e8b2c41f97a3366c1e0b84a2d9f17"; // 16 Byte wie bei MDK
  let n = 0;
  const ev = (von: string, x: InneresSenden): InneresEvent => ({ id: (++n).toString(16).padStart(64, "0"), von, art: x.art, tags: x.tags, text: x.text, zeit: ZEIT + n });
  const ereignisse = [
    ev(besitzer.pk, raumDefinition(GRUPPE, { name: "Familie", kanaele: [], kasse: KASSE })),
    ev(mitglied.pk, raumDefinition(GRUPPE, { name: "Familie", kanaele: [], kasse: ANDERE_KASSE })),
  ];
  const r = gruppenRaum(GRUPPE, ereignisse, { admins: [besitzer.pk], mitglieder: [besitzer.pk, mitglied.pk] });
  assert.equal(r.zustand.space?.kasse, KASSE);
  assert.ok(r.verworfen.some((v) => v.id === ereignisse[1]!.id), "die Definition eines Nicht-Admins ist verworfen");
  assert.equal(gruppenRaum(GRUPPE, [ev(besitzer.pk, raumDefinition(GRUPPE, { name: "Familie", kanaele: [] }))], { admins: [besitzer.pk], mitglieder: [] }).zustand.space?.kasse, undefined);
});

test("A-12b1: Recht „kasse“ – Gründer und Admins immer, sonst nur über eine zugewiesene Rolle", () => {
  assert.ok(ALL_PERMISSIONS.includes("kasse"));
  assert.deepEqual(parseRoles(raum()[1]!).roles.find((r) => r.id === "kasse")?.permissions, ["lesen", "schreiben", "kasse"], "beim Lesen nicht weggefiltert");
  const zustand = raumZustandFuer(RAUM, raum(KASSE), ZEIT + 100)!;
  assert.equal(can(mitglied.pk, "kasse", zustand), false);
  assert.equal(can(fremd.pk, "kasse", zustand), false, "nicht über die Rolle für alle");
  assert.deepEqual(mitKassenRecht(zustand), [besitzer.pk, kassierer.pk].sort());

  const GRUPPE = "c3".repeat(16);
  const privat = gruppenRaum(GRUPPE, [{ id: "1".repeat(64), von: besitzer.pk, art: raumRollen(GRUPPE, []).art, tags: raumRollen(GRUPPE, []).tags, text: "", zeit: ZEIT }],
    { admins: [besitzer.pk], mitglieder: [besitzer.pk, mitglied.pk] });
  assert.deepEqual(mitKassenRecht(privat.zustand), [besitzer.pk], "Admins ja, Mitglieder ohne Rolle nicht");
});

test("A-12b1: Nachweis – die Adresse stimmt genau diesem Schlüssel an genau diesem Ort zu", () => {
  const { adresse, nachweis } = signiereKassenAdresse(RAUM, kassierer.pk, sol(2));
  assert.equal(pruefeKassenNachweis(RAUM, kassierer.pk, adresse, nachweis), true);
  assert.equal(pruefeKassenNachweis(RAUM, fremd.pk, adresse, nachweis), false, "anderer Schlüssel");
  assert.equal(pruefeKassenNachweis(raumAdresse(fremd.pk, SPACE), kassierer.pk, adresse, nachweis), false, "anderer Raum");
  assert.equal(pruefeKassenNachweis(RAUM, kassierer.pk, adresseVon(RAUM, kassierer.pk, 3), nachweis), false, "andere Adresse");
  for (const x of ["", nachweis.slice(2), nachweis.toUpperCase(), `${nachweis}00`]) assert.equal(pruefeKassenNachweis(RAUM, kassierer.pk, adresse, x), false);
  assert.equal(pruefeKassenNachweis(RAUM, kassierer.pk, "kaputt", nachweis), false);
  assert.equal(new TextDecoder().decode(kassenNachweisNachricht(RAUM, kassierer.pk)), `freedomstack-kasse-v1:${RAUM}:${kassierer.pk}`, "lesbar für die Wallet");

  assert.equal(kassenOrt(RAUM), RAUM);
  assert.equal(kassenOrt("ab".repeat(16)), `mls:${"ab".repeat(16)}`);
  for (const x of ["", "werkstatt", "ab".repeat(8), `34700:${besitzer.pk}:x`]) assert.throws(() => kassenOrt(x), x);

  // Eine fremde Adresse mit deren Nachweis ausgeben: scheitert schon beim Bauen
  assert.throws(() => baueKassenAdresse({ autor: fremd.pk, raum: RAUM, adresse, nachweis }), /Nachweis/);
  assert.throws(() => baueKassenAdresse({ autor: kassierer.pk, raum: "werkstatt", adresse, nachweis }), /Raum-Adresse/);
  assert.throws(() => raumKassenAdresse("werkstatt", adresse, nachweis));
  assert.throws(() => raumKassenAdresse("ab".repeat(16), adresse, "kaputt"));
});

test("A-12b1: Adressen im offenen Raum – je Schlüssel die neueste, nur an diese Adresse, nie eine fremde", () => {
  const JETZT = ZEIT + 1000;
  const alt = meldung(kassierer, 2, ZEIT + 10);
  const neu = meldung(kassierer, 3, ZEIT + 20);
  assert.deepEqual(kassenAdressenOffen(RAUM, [neu, alt], JETZT), new Map([[kassierer.pk, adresseVon(RAUM, kassierer.pk, 3)]]));

  // Dieselbe Kennung bei einem anderen Gründer ist ein anderer Raum
  assert.equal(kassenAdressenOffen(RAUM, [meldung(mitglied, 4, ZEIT, raumAdresse(fremd.pk, SPACE))], JETZT).size, 0);
  const umgelenkt = s({ ...neu, tags: neu.tags.map((t) => (t[0] === "a" ? ["a", raumAdresse(fremd.pk, SPACE)] : t)) }, kassierer);
  assert.equal(kassenAdressenOffen(RAUM, [umgelenkt], JETZT).size, 0, "nur Meldungen an genau diese Adresse");
  // Fremde Adresse samt Nachweis übernommen und selbst signiert: zählt nicht
  const geklaut = s({ ...neu, pubkey: fremd.pk, created_at: ZEIT + 30 }, fremd);
  assert.deepEqual([...kassenAdressenOffen(RAUM, [neu, geklaut], JETZT).keys()], [kassierer.pk]);
  // Nennt die neueste einen kaputten Nachweis, gilt für ihn keine – nie still die ältere
  const kaputt = s({ ...neu, created_at: ZEIT + 40, tags: neu.tags.map((t) => (t[0] === "sol" ? [t[0], t[1]!, "0".repeat(128)] : t)) }, kassierer);
  assert.equal(kassenAdressenOffen(RAUM, [neu, kaputt], JETZT).has(kassierer.pk), false);
  // Zwei nennen dieselbe Adresse (die Adresse stimmte beiden zu): gilt für keinen
  const zweimal = [meldung(kassierer, 5), meldung(mitglied, 5)];
  assert.equal(kassenAdressenOffen(RAUM, zweimal, JETZT).size, 0);
  // Weit in der Zukunft: zählt nicht
  assert.equal(kassenAdressenOffen(RAUM, [meldung(mitglied, 6, JETZT + 601)], JETZT).size, 0);
  assert.equal(kassenAdressenOffen(RAUM, [meldung(mitglied, 6, JETZT + 600)], JETZT).size, 1);
  // Falsches Kind, falsches d-Tag, keine Raum-Adresse
  assert.equal(kassenAdressenOffen(RAUM, [s({ ...neu, kind: 34703 }, kassierer)], JETZT).size, 0);
  assert.equal(kassenAdressenOffen(RAUM, [s({ ...neu, tags: neu.tags.map((t) => (t[0] === "d" ? ["d", "kasse:anders"] : t)) }, kassierer)], JETZT).size, 0);
  assert.equal(kassenAdressenOffen("werkstatt", [neu], JETZT).size, 0);
  assert.equal(neu.kind, KIND_KASSEN_ADRESSE);
});

test("A-12b1: Adressen im privaten Raum – nur innere Events dieser Gruppe, Nachweis für die Gruppe", () => {
  const GRUPPE = "9e41c07b5a2d38f6e1b0c4d7a8f25e93";
  const ORT = kassenOrt(GRUPPE);
  let n = 0;
  const ev = (von: string, x: InneresSenden, zeit = ZEIT + ++n): InneresEvent => ({ id: (++n).toString(16).padStart(64, "0"), von, art: x.art, tags: x.tags, text: x.text, zeit });
  const k = signiereKassenAdresse(ORT, kassierer.pk, sol(2));
  const m = signiereKassenAdresse(ORT, mitglied.pk, sol(3));
  const offenSigniert = signiereKassenAdresse(RAUM, fremd.pk, sol(4));
  const ereignisse = [
    ev(kassierer.pk, raumKassenAdresse(GRUPPE, k.adresse, k.nachweis)),
    ev(mitglied.pk, raumKassenAdresse("ab".repeat(16), m.adresse, m.nachweis)), // andere Gruppe
    ev(fremd.pk, raumKassenAdresse(GRUPPE, offenSigniert.adresse, offenSigniert.nachweis)), // Nachweis für einen offenen Raum
  ];
  assert.deepEqual(kassenAdressenPrivat(GRUPPE, ereignisse, ZEIT + 1000), new Map([[kassierer.pk, k.adresse]]));
  assert.equal(kassenAdressenPrivat("kaputt", ereignisse, ZEIT + 1000).size, 0);
  assert.equal(raumKassenAdresse(GRUPPE, k.adresse, k.nachweis).art, KIND_KASSEN_ADRESSE);
});

test("A-12b1: Abweichungen – Recht ohne Mitgliedschaft, Mitgliedschaft ohne Recht; es zählt die Kette", () => {
  const zustand = raumZustandFuer(RAUM, raum(KASSE), ZEIT + 100)!;
  const adressen = kassenAdressenOffen(RAUM, [meldung(besitzer, 1), meldung(kassierer, 2), meldung(mitglied, 3)], ZEIT + 1000);
  const a = (k: { pk: string }, n: number) => adresseVon(RAUM, k.pk, n);
  const unbekannt = adresseVon(RAUM, fremd.pk, 7);
  const kette = (...l: string[]) => l.map((adresse) => ({ adresse, rechte: 7 }));

  assert.deepEqual(kassenAbweichungen({ mitglieder: kette(a(besitzer, 1), a(kassierer, 2)), adressen, zustand }),
    { rechtOhneMitgliedschaft: [], mitgliedschaftOhneRecht: [] }, "alles im Lot");

  const ab = kassenAbweichungen({ mitglieder: kette(a(besitzer, 1), a(mitglied, 3), unbekannt), adressen, zustand });
  assert.deepEqual(ab.rechtOhneMitgliedschaft, [{ pubkey: kassierer.pk, adresse: a(kassierer, 2) }]);
  assert.deepEqual(ab.mitgliedschaftOhneRecht, [{ adresse: a(mitglied, 3), pubkey: mitglied.pk }, { adresse: unbekannt }]);

  const ohneMeldung = kassenAbweichungen({ mitglieder: kette(a(besitzer, 1)), adressen: new Map([[besitzer.pk, a(besitzer, 1)]]), zustand });
  assert.deepEqual(ohneMeldung.rechtOhneMitgliedschaft, [{ pubkey: kassierer.pk }], "ohne genannte Adresse");
});

test("A-12b2b: mitKassenTag – die Kasse kommt dazu oder ersetzt die alte, alles andere bleibt", () => {
  const tags = [["d", `space:${SPACE}`], ["name", "Werkstatt"], ["agentenketten", "10"]];
  assert.deepEqual(mitKassenTag(tags, KASSE), [...tags, ["kasse", KASSE]]);
  assert.deepEqual(mitKassenTag([...tags, ["kasse", ANDERE_KASSE]], KASSE), [...tags, ["kasse", KASSE]]);
  assert.equal(parseSpace(s({ ...raum()[0]!, tags: mitKassenTag(raum()[0]!.tags, KASSE) }, besitzer)).kasse, KASSE);
  assert.throws(() => mitKassenTag(tags, "kaputt"), /Kasse ungültig/);
  assert.deepEqual(tags.length, 3, "die übergebenen Tags bleiben unverändert");
});

test("A-12c2: Kanal für den Hinweis – der erste nach Position, in den man schreiben darf", () => {
  const kanal = (id: string, position: number, writeRoles: string[]) => ({ id, name: id, privacy: "offen" as const, writeRoles, position });
  const kanaele = [kanal("allgemein", 2, []), kanal("ankuendigungen", 0, ["kasse"]), kanal("plaudern", 1, ["mitglied"])];
  const evs = raum(KASSE);
  evs[0] = s(buildSpace({ spaceId: SPACE, name: "Werkstatt", ownerPubkey: besitzer.pk, channels: kanaele, kasse: KASSE }, ZEIT), besitzer);
  const zustand = raumZustandFuer(RAUM, evs, ZEIT + 100)!;
  assert.equal(kassenHinweisKanal(zustand, besitzer.pk), "ankuendigungen", "der Gründer schreibt überall");
  assert.equal(kassenHinweisKanal(zustand, kassierer.pk), "ankuendigungen");
  assert.equal(kassenHinweisKanal(zustand, mitglied.pk), "plaudern", "nicht in einen Kanal nur für andere Rollen");
  assert.equal(kassenHinweisKanal(zustand, fremd.pk), "allgemein", "über die Rolle für alle nur, wo jeder schreibt");

  const nurKasse = raum(KASSE);
  nurKasse[0] = s(buildSpace({ spaceId: SPACE, name: "Werkstatt", ownerPubkey: besitzer.pk, channels: [kanal("ankuendigungen", 0, ["kasse"])], kasse: KASSE }, ZEIT), besitzer);
  assert.equal(kassenHinweisKanal(raumZustandFuer(RAUM, nurKasse, ZEIT + 100)!, mitglied.pk), undefined, "kein Kanal zum Schreiben – kein Hinweis");
  assert.equal(kassenHinweisKanal(raumZustandFuer(RAUM, raum(KASSE), ZEIT + 100)!, besitzer.pk), undefined, "ohne Kanäle kein Hinweis");

  const GRUPPE = "5d0e8b2c41f97a3366c1e0b84a2d9f17";
  const def = raumDefinition(GRUPPE, { name: "Familie", kanaele: [kanal("b", 1, []), kanal("a", 0, [])] });
  const privat = gruppenRaum(GRUPPE, [{ id: "1".repeat(64), von: besitzer.pk, art: def.art, tags: def.tags, text: "", zeit: ZEIT }],
    { admins: [besitzer.pk], mitglieder: [besitzer.pk, mitglied.pk] });
  assert.equal(kassenHinweisKanal(privat.zustand, besitzer.pk), "a", "privat ebenso nach Position");
});
