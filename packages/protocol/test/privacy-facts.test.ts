/**
 * Der Datenschutzbericht darf nur als "belegt" zeigen, was ein Leak-Test prueft
 * (Schritt 1.5). Jede belegte Aussage braucht hier ein Szenario, das gruen ist.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PRIVACY_FACTS, privacyFactsText } from "../src/privacy-facts.js";
import { buildPrivateDm } from "../src/private-dm.js";
import { generateKeypair } from "../src/event.js";
import {
  LEAK_REGELN, regelAutorNicht, regelKeinKind4, regelKeinKlartext, regelKeinKlartextPrompt, regelKeineSolAdresse, regelKeineZahlungsdaten,
  regelKundeVerborgen, regelPTagsNur, regelUploadVerschluesselt,
} from "../src/leak-rules.js";
import { LAYER_CELL_DEGREES, buildCoverageAnnouncement, toCell } from "../src/coverage.js";
import { signEvent } from "../src/event.js";
import { buildJobRequest, buildJobResult } from "../src/dvm.js";
import { buildPrivateDispute, buildPrivateJobRequest, buildPrivateJobResponse, buildPrivateSessionEvent } from "../src/private-job.js";
import { buildDispute } from "../src/disputes-relays.js";
import { verschluesseleDatei } from "../src/datei-krypto.js";
import { buildPrivateKontaktliste } from "../src/kontaktliste.js";
import { buildBlob } from "../src/blob.js";
import { buildSessionOpen, buildSessionPayment } from "../src/stream.js";
import { LocalSigner } from "../src/signer.js";
import { buildPrivateSolTrinkgeld } from "../src/sol-trinkgeld.js";
import { MeshKind, fragment, pruefeMeshInhalt } from "../src/mesh-transport.js";
import { regelMeshVerschluesselt } from "../src/leak-rules.js";
import { versiegleSwapAnfrage, versiegleSwapAntwort } from "../src/swap-versiegelt.js";
import { buildAdressAnfrage, buildAdressAntwort } from "../src/trinkgeld-adresse.js";
import { regelKeinBolt11, regelSolAdresseFrisch } from "../src/leak-rules.js";
import { deriveSolanaKey } from "../src/derivation.js";
import { base58 } from "@scure/base";
import { baueAnteilAnfrage, baueAnteilUebergabe, baueAnteilUmschlag, neueTeilung, oeffneAnteil, oeffneAnteilAnfrage } from "../src/nachfolge-anteile.js";
import { buildSuccessionPlan, secretHashOf, splitSecret } from "../src/succession.js";
import { buildStateBackup, deriveBackupKey, waehleSicherung } from "../src/state-backup.js";
import { baueStueckAbruf } from "../src/blob.js";

const a = generateKeypair();
const b = generateKeypair();
const GEHEIM = "streng geheimer Inhalt 4711";

const PROMPT = "Wie lese ich meinen Laborbefund?";

/** Wie die App seit 3.1: Anfrage vom Sitzungsschluessel, im Umschlag an den Provider (a = Identitaet). */
async function privateKiAnfrage() {
  const sitzung = new LocalSigner(generateKeypair().sk);
  const request = buildJobRequest({ customerPubkey: sitzung.publicKey(), input: PROMPT, bidMsat: 1000, providerPubkey: b.pk });
  const { wrap } = await buildPrivateJobRequest({ request, sessionSigner: sitzung, providerPk: b.pk });
  return { wrap, sitzung: sitzung.publicKey() };
}

const ANTWORT = "Der Wert liegt im Normbereich.";
// Testvektor aus BOLT 11 – oeffentlich, kein Geheimnis.
const BOLT11 = "lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp";

/**
 * Eine ganze private KI-Runde wie seit 3.2e (a = Identitaet, b = Provider):
 * Sitzung, Anfrage, Antwort mit Betrag und Rechnung, Beleg – alles versiegelt.
 */
async function privateKiRunde() {
  const sitzung = new LocalSigner(generateKeypair().sk);
  const provider = new LocalSigner(b.sk);
  const sp = sitzung.publicKey();
  const open = await buildPrivateSessionEvent({ sessionSigner: sitzung, providerPk: b.pk, event: buildSessionOpen({
    customerPubkey: sp, providerPubkey: b.pk, sessionId: "s1", maxTotalMsat: 100_000, maxRatePerKTokenMsat: 1000, settleEveryMsat: 20_000, ttlSecs: 3600,
  }) });
  const { wrap: anfrage, requestId } = await buildPrivateJobRequest({ sessionSigner: sitzung, providerPk: b.pk, request: buildJobRequest({
    customerPubkey: sp, input: PROMPT, bidMsat: 1000, providerPubkey: b.pk,
  }) });
  const antwort = await buildPrivateJobResponse({ providerSigner: provider, sessionPk: sp, response: buildJobResult({
    providerPubkey: b.pk, requestId, requestKind: 5050, customerPubkey: sp, output: ANTWORT, amountMsat: 7000, bolt11: BOLT11,
    usage: { model: "m", promptTokens: 3, completionTokens: 7 },
  }) });
  const beleg = await buildPrivateSessionEvent({ sessionSigner: sitzung, providerPk: b.pk, event: buildSessionPayment({
    customerPubkey: sp, sessionId: "s1", seq: 1, cumulativeMsat: 7000, unitsSinceLast: 7,
  }) });
  return { wraps: [open.wrap, anfrage, antwort.wrap, beleg.wrap] };
}

const NOTIZ = "Antwort zum Laborbefund war unbrauchbar";

/** Reklamation wie seit 3.4: vom Sitzungsschluessel, versiegelt an Provider (b) und Pruefer. */
async function privateReklamation() {
  const sitzung = new LocalSigner(generateKeypair().sk);
  const dispute = buildDispute({
    jobId: "d".repeat(64), customerPubkey: sitzung.publicKey(), providerPubkey: b.pk, reason: "unbrauchbar", amountMsat: 7000, note: NOTIZ,
  });
  const { wraps } = await buildPrivateDispute({ dispute, sessionSigner: sitzung, empfaenger: [{ pk: b.pk }, { pk: generateKeypair().pk }] });
  return { wraps, sitzung: sitzung.publicKey() };
}

const SOL_ADRESSE = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

/**
 * Tausch in beiden Richtungen wie seit 4.9b: Anfragen versiegelt von je einem
 * Wegwerf-Schluessel an den LP (b), Antworten versiegelt zurueck.
 */
async function versiegelterTausch() {
  const lp = new LocalSigner(b.sk);
  const hin = await versiegleSwapAnfrage({ kunde: new LocalSigner(generateKeypair().sk), lpPk: b.pk, tags: [
    ["offer", "lp-1"], ["amount_sats", "21000"], ["hashlock", "ab".repeat(32)], ["solana_address", SOL_ADRESSE],
  ] });
  const rueckKunde = new LocalSigner(generateKeypair().sk);
  const rueck = await versiegleSwapAnfrage({ kunde: rueckKunde, lpPk: b.pk, tags: [["offer", "lp-1-buy"], ["bolt11", BOLT11]] });
  const antworten = await Promise.all([
    versiegleSwapAntwort({ lp, kundePk: generateKeypair().pk, anfrageId: hin.anfrageId, tags: [["swap_id", "swap-1"], ["amount_lamports", "1000"]], content: BOLT11 }),
    versiegleSwapAntwort({ lp, kundePk: rueckKunde.publicKey(), anfrageId: rueck.anfrageId, tags: [["status", "EINGELOEST"]], content: "" }),
  ]);
  return [hin.wrap, rueck.wrap, ...antworten];
}

const SZENARIEN: Record<string, () => Promise<number>> = {
  "dm-inhalt": async () => {
    const d = await buildPrivateDm({ senderSk: a.sk, senderPk: a.pk, recipientPk: b.pk, content: GEHEIM });
    return regelKeinKlartext([d.toRecipient, d.toSelf], [GEHEIM]).length;
  },
  "dm-absender": async () => {
    const d = await buildPrivateDm({ senderSk: a.sk, senderPk: a.pk, recipientPk: b.pk, content: GEHEIM });
    return regelAutorNicht([d.toRecipient, d.toSelf], a.pk).length;
  },
  "dm-kein-kind4": async () => {
    const d = await buildPrivateDm({ senderSk: a.sk, senderPk: a.pk, recipientPk: b.pk, content: GEHEIM });
    return regelKeinKind4([d.toRecipient, d.toSelf]).length;
  },
  "ki-prompt": async () => {
    const { wrap } = await privateKiAnfrage();
    return regelKeinKlartextPrompt([wrap], [PROMPT]).length + regelKeinKlartext([wrap], [PROMPT]).length;
  },
  "ki-kunde": async () => {
    const { wrap, sitzung } = await privateKiAnfrage();
    return regelKundeVerborgen([wrap], a.pk).length + regelKundeVerborgen([wrap], sitzung).length;
  },
  "ki-antwort": async () => {
    const { wraps } = await privateKiRunde();
    return regelKeinKlartext(wraps, [ANTWORT]).length;
  },
  "ki-zahlung": async () => {
    const { wraps } = await privateKiRunde();
    return regelKeineZahlungsdaten(wraps).length;
  },
  kontakte: async () => {
    // Wie die App seit 2.5b, wenn eingeschaltet: alle Eintraege verschluesselt an sich selbst.
    const ich = new LocalSigner(a.sk);
    const liste = [{ pk: b.pk, name: "Beratungsstelle" }];
    const ev = signEvent(await buildPrivateKontaktliste(liste, ich), a.sk);
    return regelKeinKlartext([ev], [b.pk, "Beratungsstelle"]).length + regelPTagsNur([ev], []).length;
  },
  anhaenge: async () => {
    // Wie die App seit 2.4: nur das Chiffrat ins Blob-Netz, ohne Name und Typ.
    const datei = crypto.getRandomValues(new Uint8Array(30_000));
    const { chiffrat } = verschluesseleDatei(datei);
    const { manifestEvent, chunkEvents } = await buildBlob({ name: "", mime: "application/octet-stream", bytes: chiffrat }, a.pk);
    const events = [manifestEvent, ...chunkEvents].map((e) => signEvent(e, a.sk));
    return regelUploadVerschluesselt(events, datei).length;
  },
  "ki-reklamation": async () => {
    const { wraps, sitzung } = await privateReklamation();
    return regelKeineZahlungsdaten(wraps).length + regelKeinKlartext(wraps, [NOTIZ, "unbrauchbar"]).length
      + regelKundeVerborgen(wraps, sitzung).length + regelKundeVerborgen(wraps, a.pk).length;
  },
  "sol-trinkgeld": async () => {
    // Wie die App seit 4.7b: Beleg versiegelt an Empfaenger und eigene Kopie.
    const an = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtVb", sig = "3".repeat(88);
    const wraps = await buildPrivateSolTrinkgeld({ empfaenger: b.pk, signatur: sig, lamports: 2_345_678, an, kette: "solana:mainnet", notiz: NOTIZ }, new LocalSigner(a.sk));
    return regelKeineSolAdresse(wraps, [an]).length + regelKeinKlartext(wraps, [sig, "2345678", NOTIZ]).length + regelAutorNicht(wraps, a.pk).length;
  },
  "sol-adresse": async () => {
    const wraps = await versiegelterTausch();
    return regelKeineSolAdresse(wraps, [SOL_ADRESSE]).length + regelAutorNicht(wraps, a.pk).length;
  },
  "swap-rechnung": async () => regelKeinBolt11(await versiegelterTausch()).length,
  "sol-empfang": async () => {
    // Wie die eingebaute Wallet seit 4.9c: Hauptadresse (Konto 0) und der Vorrat (Konten 1, 2, …) aus demselben Seed.
    const seed = crypto.getRandomValues(new Uint8Array(64));
    const adressen = [0, 1, 2, 3].map((i) => base58.encode(deriveSolanaKey(seed, i).publicKey));
    return regelSolAdresseFrisch(adressen).length;
  },
  mesh: async () => {
    // Wie die App seit 7.1b: nur der Umschlag an den Empfaenger geht ueber Funk
    // oder in die Datei – die eigene Kopie und alles Offene lehnt die Regel ab.
    const d = await buildPrivateDm({ senderSk: a.sk, senderPk: a.pk, recipientPk: b.pk, content: GEHEIM });
    const bytes = (x: unknown) => new TextEncoder().encode(JSON.stringify(x));
    const darf = (x: unknown) => pruefeMeshInhalt(bytes(x), MeshKind.NostrEvent, { eigeneSchluessel: [a.pk] }).ok;
    const offen = signEvent({ pubkey: a.pk, created_at: 1, kind: 4, tags: [["p", b.pk]], content: GEHEIM }, a.sk);
    const abgelehnt = [d.toSelf, offen].filter(darf).length;
    const gesendet = [d.toRecipient].filter(darf).map(bytes);
    if (gesendet.length !== 1) return 1;
    const pakete = [...gesendet, ...gesendet.flatMap((g) => fragment(g, MeshKind.NostrEvent))];
    return abgelehnt + regelMeshVerschluesselt(pakete, { schluessel: [a.pk], klartexte: [GEHEIM] }).length;
  },
  "sol-trinkgeld-adresse": async () => {
    // Wie die App seit 4.9d: Anfrage von der Identitaet (a) an den Empfaenger (b), Antwort versiegelt zurueck.
    const { wrap, anfrageId } = await buildAdressAnfrage({ von: new LocalSigner(a.sk), anPk: b.pk, kette: "solana:mainnet" });
    const antwort = await buildAdressAntwort({ von: new LocalSigner(b.sk), anPk: a.pk, anfrageId, adresse: SOL_ADRESSE, kette: "solana:mainnet" });
    return regelKeineSolAdresse([wrap, antwort], [SOL_ADRESSE]).length + regelAutorNicht([wrap, antwort], a.pk).length + regelAutorNicht([wrap, antwort], b.pk).length;
  },
  "nachfolge-anteile": async () => {
    // Wie die App seit 8.11: Plan oeffentlich, Anteile versiegelt an die Vertrauten (b, c), Uebergabe versiegelt an den Sammler (b).
    const c = generateKeypair();
    const teilung = neueTeilung();
    const secretHash = secretHashOf(a.sk);
    const teile = splitSecret(a.sk, 2, 2);
    const plan = signEvent(buildSuccessionPlan({ ownerPubkey: a.pk, guardians: [b.pk, c.pk], threshold: 2, inactivityDays: 180, graceDays: 30, secretHash }), a.sk);
    const an = [b, c];
    const umschlaege = await Promise.all(teile.map((t, i) => baueAnteilUmschlag({ von: new LocalSigner(a.sk), an: an[i]!.pk, anteil: t, schwelle: 2, anzahl: 2, secretHash, teilung })));
    const { wrap: anfrage } = await baueAnteilAnfrage({ von: new LocalSigner(b.sk), an: c.pk, besitzer: a.pk, teilung });
    const offen = (await oeffneAnteilAnfrage(anfrage, new LocalSigner(c.sk)))!;
    const anteilC = (await oeffneAnteil(umschlaege[1]!, new LocalSigner(c.sk)))!;
    const uebergabe = await baueAnteilUebergabe({ von: new LocalSigner(c.sk), anfrage: offen, anteil: anteilC });
    const alle = [plan, ...umschlaege, anfrage, uebergabe];
    const hex = (x: Uint8Array) => Array.from(x, (y) => y.toString(16).padStart(2, "0")).join("");
    return regelKeinKlartext(alle, [...teile.map((t) => hex(t.data)), hex(a.sk)]).length + regelAutorNicht(umschlaege, a.pk).length;
  },
  "zustand-sicherung": async () => {
    // Wie die App seit 8.12: nur die feste Liste, verschluesselt mit dem abgeleiteten Schluessel.
    const geraet: Record<string, string> = {
      "freedom.nsec": "ab".repeat(32), "freedom.nwc.uri": "nostr+walletconnect://x?secret=" + "cd".repeat(32),
      "freedom.swap.x": "ef".repeat(32), "freedom.mls.epoche": "gruppen-schluessel",
      "freedom.chats": JSON.stringify([{ id: b.pk, name: GEHEIM }]), "freedom.petnames": JSON.stringify([[b.pk, "Chef"]]),
    };
    const r = await buildStateBackup(a.pk, deriveBackupKey(a.sk), waehleSicherung(Object.keys(geraet), (k) => geraet[k] ?? null));
    const ev = signEvent(r.event, a.sk);
    return regelKeinKlartext([ev], [GEHEIM, "Chef", "ab".repeat(32), "cd".repeat(32), "ef".repeat(32), "gruppen-schluessel"]).length;
  },
  "speicher-abruf": async () => {
    // Wie die App seit 8.9b: frischer Sitzungsschluessel je Download, ein Umschlag je Knoten und Stueck.
    const sitzung = new LocalSigner(generateKeypair().sk);
    const blobId = "c3".repeat(32);
    const wraps = await Promise.all([0, 1, 2].map(async (index) => (await baueStueckAbruf({ sitzung, knotenPk: b.pk, blobId, index })).wrap));
    return regelKeinKlartext(wraps, [blobId]).length + regelAutorNicht(wraps, a.pk).length + regelAutorNicht(wraps, sitzung.publicKey()).length;
  },
  "abdeckung-zelle": async () => {
    const [lat, lon] = [48.137154, 11.576124];
    const funde = (["lora", "bluetooth"] as const).flatMap((layer) => {
      const ev = signEvent(buildCoverageAnnouncement({ pubkey: a.pk, layer, cell: toCell(lat, lon, LAYER_CELL_DEGREES[layer]), region: "" }), a.sk);
      return regelKeinKlartext([ev], [String(lat), String(lon), lat.toFixed(4), lon.toFixed(4)]);
    });
    return funde.length;
  },
};

test("jede belegte Aussage hat ein Szenario", () => {
  for (const f of PRIVACY_FACTS.filter((x) => x.status === "belegt")) {
    assert.ok(SZENARIEN[f.id], `Kein Szenario fuer belegte Aussage "${f.id}"`);
  }
});

test("alle Szenarien fuer belegte Aussagen sind ohne Verstoss", async () => {
  for (const f of PRIVACY_FACTS.filter((x) => x.status === "belegt")) {
    assert.equal(await SZENARIEN[f.id](), 0, f.id);
  }
});

test("belegte Aussagen nennen ihre Regel, und jede genannte Regel gibt es", () => {
  for (const f of PRIVACY_FACTS) {
    if (f.status === "belegt") assert.ok(f.regel, `Belegte Aussage "${f.id}" ohne Regel`);
    if (f.regel) assert.ok(f.regel in LEAK_REGELN, `Aussage "${f.id}": Regel "${f.regel}" gibt es nicht`);
  }
  // Ohne Regel nur, was kein Event-Mitschnitt pruefen kann.
  assert.deepEqual(PRIVACY_FACTS.filter((f) => !f.regel).map((f) => f.id).sort(), ["dm-forward-secrecy", "ip"]);
});

test("Grenzen nennen ihren Grund", () => {
  for (const f of PRIVACY_FACTS.filter((x) => x.status === "grenze")) {
    assert.ok(f.grund && f.grund.length > 20, `Grenze "${f.id}" ohne Grund`);
  }
});

test("offene Aussagen nennen den Schritt, der sie schliesst", () => {
  for (const f of PRIVACY_FACTS.filter((x) => x.status === "offen")) {
    assert.ok(f.schritt, `Offene Aussage "${f.id}" ohne Schritt`);
  }
});

test("der Berichtstext trennt Belegtes und Offenes", () => {
  const t = privacyFactsText();
  assert.match(t, /Durch Tests belegt:/);
  assert.match(t, /Bekannte Lücken:/);
  assert.match(t, /✓ KI-Anfragen sind für Relays nicht lesbar\./);
  assert.match(t, /✓ KI-Antworten sind für Relays nicht lesbar\./);
  assert.match(t, /✓ Reklamationen sind nicht öffentlich – sie gehen versiegelt/);
  assert.match(t, /○ Noch nicht: Räume sind Ende-zu-Ende-verschlüsselt\. \(Ausbauplan 2\.3\)/);
  // 4.6c benannte die offene Rechnung als Luecke, seit 4.9b ist sie versiegelt.
  assert.match(t, /✓ Beim Tausch SOL → sats sehen Relays deine Lightning-Rechnung nicht\./);
  // Seit 4.9 (Entscheidung A): gesendete Zahlungen als bewusste Grenze, mit Grund.
  assert.match(t, /Bewusste Grenzen:\n△ Gesendete SOL-Zahlungen kommen nicht von frischen Adressen.*Entscheidung 4\.9 A/);
});
