/**
 * Der Datenschutzbericht darf nur als "belegt" zeigen, was ein Leak-Test prueft
 * (Schritt 1.5). Jede belegte Aussage braucht hier ein Szenario, das gruen ist.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PRIVACY_FACTS, faktenDieserSitzung, ipFaktFuer, privacyFactsText } from "../src/privacy-facts.js";
import { buildPrivateDm } from "../src/private-dm.js";
import { buildEvent, generateKeypair } from "../src/event.js";
import {
  LEAK_REGELN, regelAutorNicht, regelKeinKind4, regelKeinKlartext, regelKeinKlartextPrompt, regelKeineSolAdresse, regelKeineZahlungsdaten,
  regelKundeVerborgen, regelPTagsNur, regelUploadVerschluesselt, regelAnmeldungNichtOffen, regelKopienEntkoppelt,
} from "../src/leak-rules.js";
import { zufallsVerzoegerung } from "../src/verkehr.js";
import { WebSocketRelay } from "../src/ws-relay.js";
import { baueRelayAuth } from "../src/relay-zugang.js";
import { LAYER_CELL_DEGREES, baueCoverageEintrag, baueCoverageWiderruf, buildCoverageAnnouncement, toCell } from "../src/coverage.js";
import { signEvent } from "../src/event.js";
import { buildJobRequest, buildJobResult } from "../src/dvm.js";
import { buildPrivateDispute, buildPrivateJobRequest, buildPrivateJobResponse, buildPrivateSessionEvent, buildPrivateUrteil } from "../src/private-job.js";
import { buildDispute, buildResolution } from "../src/disputes-relays.js";
import { verschluesseleDatei } from "../src/datei-krypto.js";
import { buildPrivateKontaktliste } from "../src/kontaktliste.js";
import { buildBlob } from "../src/blob.js";
import { buildSessionOpen, buildSessionPayment } from "../src/stream.js";
import { LocalSigner } from "../src/signer.js";
import { buildPrivateSolTrinkgeld } from "../src/sol-trinkgeld.js";
import { MeshKind, fragment, pruefeMeshInhalt } from "../src/mesh-transport.js";
import { regelBesitzerVersiegelt, regelMeshVerschluesselt } from "../src/leak-rules.js";
import { neueKopplung } from "../src/kopplung.js";
import { KIND_ANRUF, baueAnrufNachricht, neueAnrufKennung } from "../src/anruf.js";
import { giftUnwrapMitSigner } from "../src/gift-wrap.js";
import { regelAnrufNurRelay } from "../src/leak-rules.js";
import { baueWeckAnmeldung } from "../src/wecken.js";
import { versiegleSwapAnfrage, versiegleSwapAntwort } from "../src/swap-versiegelt.js";
import { buildAdressAnfrage, buildAdressAntwort } from "../src/trinkgeld-adresse.js";
import { regelKeinBolt11, regelSolAdresseFrisch } from "../src/leak-rules.js";
import { deriveSolanaKey } from "../src/derivation.js";
import { base58 } from "@scure/base";
import { baueAnteilAnfrage, baueAnteilUebergabe, baueAnteilUmschlag, neueTeilung, oeffneAnteil, oeffneAnteilAnfrage } from "../src/nachfolge-anteile.js";
import { buildSuccessionPlan, secretHashOf, splitSecret } from "../src/succession.js";
import { buildStateBackup, deriveBackupKey, waehleSicherung } from "../src/state-backup.js";
import { baueStueckAbruf } from "../src/blob.js";
import { regelMlsGruppe } from "../src/leak-rules.js";
import { baueRaumMeldung, raumDefinition, raumNachricht } from "../src/raum-gruppe.js";
import { baueRufUmschlaege } from "../src/quittung.js";
import { buildProfile, oeffentlichesProfil } from "../src/profile.js";
import { buildAnonZapRequest, buildZapRequest } from "../src/zap.js";
import { buildRechnungsAnfrage, buildRechnungsAntwort } from "../src/ln-rechnung.js";
import { knotenSchluessel, rechnung } from "./bolt11-hilfe.js";
import { regelKeineLnAdresse, regelRaumRepoPrivat, regelZapAnonym } from "../src/leak-rules.js";
import { raumRepoAnkuendigung, raumRepoBundle, raumRepoIssue, raumRepoIssueStatus, raumRepoKommentar, raumRepoPatch } from "../src/raum-repo.js";
import { fromHex, toHex } from "../src/htlc.js";
import { LOKAL_STANDARD_ADRESSE, lokaleKiAdresse, lokaleKiAnfrage } from "../src/ki-lokal.js";
import type { NostrEvent, UnsignedEvent } from "../src/event.js";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { schnorr } from "@noble/curves/secp256k1.js";

// MLS-Engine (2.2b-d2) – dynamisch geladen: packages/mls liegt ausserhalb von rootDir
interface MlsKontoT {
  keyPackage(platz: string): Promise<UnsignedEvent>;
  gruppeAnlegen(name: string, kps: NostrEvent[], relays: string[]): Promise<{ gruppe: string; einladungen: NostrEvent[] }>;
  senden(gruppe: string, text: string): Promise<{ events: NostrEvent[] }>;
  sendenEvent(gruppe: string, art: number, tags: string[][], text: string): Promise<{ events: NostrEvent[]; inneres?: string }>;
}
interface MlsModulT {
  Mls: new (signer: LocalSigner, beweis: (id: string) => string) => MlsKontoT;
  ladeMls(wasm: Uint8Array): void;
}

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
  // Seit 5.6: der Pruefer aus dem eigenen Netz, genannt in der Reklamation; sein Urteil geht versiegelt zurueck.
  const pruefer = new LocalSigner(generateKeypair().sk);
  const dispute = buildDispute({
    jobId: "d".repeat(64), customerPubkey: sitzung.publicKey(), providerPubkey: b.pk, reason: "unbrauchbar", amountMsat: 7000, note: NOTIZ,
    pruefer: [pruefer.publicKey()],
  });
  const { wraps } = await buildPrivateDispute({
    dispute, sessionSigner: sitzung, empfaenger: [{ pk: b.pk }, { pk: pruefer.publicKey() }],
    materialFuerPruefer: { frage: GEHEIM, antwort: NOTIZ },
  });
  const urteil = buildResolution({ jobId: "d".repeat(64), reviewerPubkey: pruefer.publicKey(), resolution: "erstattet", refundMsat: 7000, note: NOTIZ });
  const { wraps: urteilWraps } = await buildPrivateUrteil({ urteil, prueferSigner: pruefer, kundePk: sitzung.publicKey(), providerPk: b.pk });
  return { wraps, urteilWraps, sitzung: sitzung.publicKey(), pruefer: pruefer.publicKey() };
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

/** Die Argumente von `sendenEvent()` aus einem inneren Event (Art, Tags, Text). */
const alsArgs = (x: { art: number; tags: string[][]; text: string }): [number, string[][], string] => [x.art, x.tags, x.text];

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
  "ki-lokal": async () => {
    // Die Frage geht nur an eine Adresse dieses Rechners – und ist kein Event, also an kein Relay.
    const anfrage = lokaleKiAnfrage({ adresse: LOKAL_STANDARD_ADRESSE, modell: "llama3.2:3b", frage: PROMPT });
    const woanders = anfrage && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(anfrage.url).hostname) ? 0 : 1;
    const fremd = ["https://relay.damus.io", "http://192.168.1.20:11434", "http://localhost.boese.example", "http://nutzer:pw@localhost:11434", "ws://localhost:11434"]
      .filter((a) => lokaleKiAdresse(a) !== undefined || lokaleKiAnfrage({ adresse: a, modell: "m", frage: PROMPT }) !== undefined).length;
    const events: NostrEvent[] = [];
    return woanders + fremd + regelKeinKlartextPrompt(events, [PROMPT]).length;
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
    const { wraps, urteilWraps, sitzung, pruefer } = await privateReklamation();
    const alle = [...wraps, ...urteilWraps];
    // Das Urteil geht an den Sitzungsschluessel (wie jede KI-Antwort) und den Provider – an niemanden sonst.
    return regelKeineZahlungsdaten(alle).length + regelKeinKlartext(alle, [NOTIZ, GEHEIM, "unbrauchbar", "erstattet"]).length
      + regelKundeVerborgen(wraps, sitzung).length + regelKundeVerborgen(alle, a.pk).length + regelAutorNicht(alle, pruefer).length
      + regelPTagsNur(urteilWraps, [sitzung, b.pk]).length;
  },
  "sol-trinkgeld": async () => {
    // Wie die App seit 4.7b: Beleg versiegelt an Empfaenger und eigene Kopie.
    const an = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtVb", sig = "3".repeat(88);
    const wraps = await buildPrivateSolTrinkgeld({ empfaenger: b.pk, signatur: sig, lamports: 2_345_678, an, kette: "solana:mainnet", notiz: NOTIZ }, new LocalSigner(a.sk));
    return regelKeineSolAdresse(wraps, [an]).length + regelKeinKlartext(wraps, [sig, "2345678", NOTIZ]).length + regelAutorNicht(wraps, a.pk).length;
  },
  "ln-oeffentlich": async () => {
    // Wie die App seit 6.3: Profil ohne Lightning-Adresse (Häkchen aus), Zap-Anfrage anonym.
    // Gegenprobe: mit Häkchen bzw. mit der Identität signiert fänden die Regeln sie.
    const ln = "ada@wallet.example";
    const entwurf = { name: "Ada", lud16: ln };
    const profil = signEvent(buildProfile(a.pk, oeffentlichesProfil(entwurf, { lightning: false })), a.sk);
    const offen = signEvent(buildProfile(a.pk, oeffentlichesProfil(entwurf, { lightning: true })), a.sk);
    const zap = { recipientPubkey: b.pk, amountMsat: 21_000, relays: ["wss://relay.example"] };
    const anonym = buildAnonZapRequest(zap);
    const mitName = signEvent(buildZapRequest({ ...zap, senderPubkey: a.pk }), a.sk);
    const gegenprobe = regelKeineLnAdresse([offen], [ln]).length === 1 && regelZapAnonym([mitName], a.pk).length === 1;
    return regelKeineLnAdresse([profil], [ln]).length + regelZapAnonym([anonym], a.pk).length + regelKeinBolt11([profil, anonym]).length + (gegenprobe ? 0 : 1);
  },
  "ln-rechnung": async () => {
    // Wie die App seit 6.3b: Anfrage und Antwort im Umschlag, zwischen Identitäten.
    const pr = rechnung(knotenSchluessel(), "lnbc210n", new Uint8Array(32).fill(4));
    const { wrap, anfrageId } = await buildRechnungsAnfrage({ von: new LocalSigner(a.sk), anPk: b.pk, betragMsat: 21_000 });
    const antwort = await buildRechnungsAntwort({ von: new LocalSigner(b.sk), anPk: a.pk, anfrageId, bolt11: pr });
    const alle = [wrap, antwort];
    return regelKeinBolt11(alle).length + regelKeinKlartext(alle, ["21000", pr]).length + regelAutorNicht(alle, a.pk).length + regelAutorNicht(alle, b.pk).length;
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
  "dm-mls": async () => {
    // Wie die App 1:1 über MLS sendet (2.2b-d2): Einladung im Umschlag, Nachricht als Kind 445 – echte Engine
    const { Mls, ladeMls } = (await import(["@freedomstack", "mls"].join("/"))) as MlsModulT;
    ladeMls(gunzipSync(readFileSync(new URL("../../mls/dist/freedom_mls_bg.wasm.gz", import.meta.url))));
    const konto = (k: typeof a) => new Mls(new LocalSigner(k.sk), (id) => toHex(schnorr.sign(fromHex(id), k.sk)));
    const [ma, mb] = [konto(a), konto(b)];
    const kpB = await new LocalSigner(b.sk).signEvent(await mb.keyPackage("ab".repeat(32)));
    const g = await ma.gruppeAnlegen("", [kpB], ["wss://gruppe.test"]);
    const s = await ma.senden(g.gruppe, GEHEIM);
    const alle = [...g.einladungen, ...s.events];
    if (g.einladungen.length !== 1 || s.events.length !== 1) return 1;
    return regelKeinKlartext(alle, [GEHEIM]).length + regelAutorNicht(alle, a.pk).length + regelPTagsNur(g.einladungen, [b.pk]).length +
      regelMlsGruppe(alle, { gruppenIds: [g.gruppe], identitaeten: [a.pk, b.pk] }).length;
  },
  "raeume": async () => {
    // Wie die App private Räume anlegt und schreibt (2.3b): Kanäle und Nachricht als innere Events – echte Engine
    const { Mls, ladeMls } = (await import(["@freedomstack", "mls"].join("/"))) as MlsModulT;
    ladeMls(gunzipSync(readFileSync(new URL("../../mls/dist/freedom_mls_bg.wasm.gz", import.meta.url))));
    const konto = (k: typeof a) => new Mls(new LocalSigner(k.sk), (id) => toHex(schnorr.sign(fromHex(id), k.sk)));
    const [ma, mb] = [konto(a), konto(b)];
    const kpB = await new LocalSigner(b.sk).signEvent(await mb.keyPackage("cd".repeat(32)));
    const g = await ma.gruppeAnlegen("Werkstatt am Fluss", [kpB], ["wss://gruppe.test"]);
    const def = raumDefinition(g.gruppe, { name: "Werkstatt am Fluss", kanaele: [{ id: "geheimplanung", name: "geheimplanung", privacy: "verschluesselt", writeRoles: [], position: 0 }] });
    const msg = raumNachricht({ kanal: "geheimplanung", text: GEHEIM, erwaehnt: [b.pk] });
    const events: NostrEvent[] = [];
    for (const s of [def, msg]) events.push(...(await ma.sendenEvent(g.gruppe, s.art, s.tags, s.text)).events);
    const alle = [...g.einladungen, ...events];
    if (events.length !== 2) return 1;
    return regelKeinKlartext(alle, [GEHEIM, "Werkstatt am Fluss", "geheimplanung"]).length + regelAutorNicht(alle, a.pk).length +
      regelPTagsNur(g.einladungen, [b.pk]).length + regelMlsGruppe(alle, { gruppenIds: [g.gruppe], identitaeten: [a.pk, b.pk] }).length;
  },
  "relay-anmeldung": async () => {
    // Wie die App seit 8.4c: WebSocketRelay mit `anmelden` – gegen einen Relay, der
    // Umschlaege nur Angemeldeten gibt. Mitgeschnitten wird, was die App sendet.
    const gesendet: unknown[][] = [];
    class Leitung {
      static OPEN = 1;
      readyState = 1;
      onopen: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onmessage: ((m: { data: string }) => void) | null = null;
      private angemeldet = false;
      constructor(public url: string) {
        setTimeout(() => { this.onopen?.(); this.an(["AUTH", "challenge-1"]); }, 0);
      }
      private an(m: unknown[]): void { this.onmessage?.({ data: JSON.stringify(m) }); }
      send(d: string): void {
        const m = JSON.parse(d) as [string, { id: string; kinds?: number[] }, { kinds?: number[] }?];
        gesendet.push(m);
        if (m[0] === "AUTH") { this.angemeldet = true; this.an(["OK", m[1].id, true, ""]); }
        else if (m[0] === "EVENT") this.an(["OK", m[1].id, true, ""]);
        else if (m[0] === "REQ") this.an(this.angemeldet || !(m[2]?.kinds ?? []).includes(1059) ? ["EOSE", m[1]] : ["CLOSED", m[1], "auth-required: anmelden"]);
      }
      close(): void { this.readyState = 3; this.onclose?.(); }
    }
    const g = globalThis as { WebSocket?: unknown };
    const vorher = g.WebSocket;
    g.WebSocket = Leitung;
    try {
      const r = new WebSocketRelay("wss://relay.test", {
        autoReconnect: false, timeoutMs: 2000, anmelden: async (u, c) => signEvent(baueRelayAuth(a.pk, u, c), a.sk),
      });
      await r.publish(signEvent(buildEvent(a.pk, 1, [], "hallo"), a.sk));
      await r.query({ kinds: [1] });
      const vonSelbst = gesendet.filter((m) => m[0] === "AUTH").length; // nie ohne Verlangen
      await r.query({ kinds: [1059], "#p": [a.pk] });
      r.close();
      const anmeldungen = gesendet.filter((m) => m[0] === "AUTH").map((m) => m[1] as NostrEvent);
      const richtig = anmeldungen.length === 1 && anmeldungen[0]!.kind === 22242 && anmeldungen[0]!.pubkey === a.pk
        && anmeldungen[0]!.tags.some((t) => t[0] === "challenge" && t[1] === "challenge-1");
      const nochmal = gesendet.filter((m) => m[0] === "REQ" && ((m[2] as { kinds?: number[] })?.kinds ?? []).includes(1059)).length === 2;
      const veroeffentlicht = gesendet.filter((m) => m[0] === "EVENT").map((m) => m[1] as NostrEvent);
      return vonSelbst + (richtig ? 0 : 1) + (nochmal ? 0 : 1) + regelAnmeldungNichtOffen(veroeffentlicht).length;
    } finally {
      if (vorher) g.WebSocket = vorher; else delete g.WebSocket;
    }
  },
  "versand-einzeln": async () => {
    // Wie die App seit 6.4 (shell/versand.ts): je Kopie eine eigene Verzoegerung aus zufallsVerzoegerung(30 s).
    // Fester Zufall, damit das Szenario wiederholbar ist; ohne Verzoegerung gingen alle im selben Augenblick.
    const handy = generateKeypair().pk;
    const dm = await buildPrivateDm({ signer: new LocalSigner(a.sk), recipientPk: b.pk, content: GEHEIM, weitereEmpfaenger: [handy] });
    const kopien = [dm.toRecipient, dm.toSelf, ...dm.weitere.map((k) => k.wrap)];
    const werte = [0.11, 0.52, 0.93];
    const mit = kopien.map((ev, i) => ({ ev, zeitMs: 1_000_000 + zufallsVerzoegerung(30_000, () => werte[i]!) }));
    const ohne = kopien.map((ev) => ({ ev, zeitMs: 1_000_000 + zufallsVerzoegerung(0) }));
    return regelKopienEntkoppelt(mit).length + (regelKopienEntkoppelt(ohne).length === kopien.length - 1 ? 0 : 1);
  },
  "ruf-kontakte": async () => {
    // Wie die App seit 5.5c (ruf-teilen.ts): je Kontakt ein Umschlag, nacheinander im Abruftakt (15–45 s Abstand)
    const [k1, k2] = [generateKeypair().pk, generateKeypair().pk];
    const provider = "e5".repeat(32);
    const zeilen = [{ provider, auftraege: 12, belegt: 3, umfangMsat: 421_000, umfangLamports: 9_876_543, reklamationen: 1 }];
    const wraps = await baueRufUmschlaege({ von: new LocalSigner(a.sk), an: [k1, k2], zeilen });
    if (wraps.length !== 2) return 1;
    const gesendet = wraps.map((ev, i) => ({ ev, zeitMs: 1_000_000 + i * 15_000 }));
    return regelAutorNicht(wraps, a.pk).length + regelKeinKlartext(wraps, [provider, "421000", "9876543"]).length
      + regelPTagsNur(wraps, [k1, k2]).length + regelKeineZahlungsdaten(wraps).length + regelKopienEntkoppelt(gesendet).length;
  },
  "raum-repos": async () => {
    // Wie die App seit 11.4b: Repo, Bundle-Verweis mit Schlüssel, Patch und Status als innere Events – echte Engine
    const { Mls, ladeMls } = (await import(["@freedomstack", "mls"].join("/"))) as MlsModulT;
    ladeMls(gunzipSync(readFileSync(new URL("../../mls/dist/freedom_mls_bg.wasm.gz", import.meta.url))));
    const konto = (k: typeof a) => new Mls(new LocalSigner(k.sk), (id) => toHex(schnorr.sign(fromHex(id), k.sk)));
    const [ma, mb] = [konto(a), konto(b)];
    const kpB = await new LocalSigner(b.sk).signEvent(await mb.keyPackage("ef".repeat(32)));
    const g = await ma.gruppeAnlegen("", [kpB], ["wss://gruppe.test"]);
    const KEY = "5a".repeat(32);
    const repo = { eigentuemer: a.pk, id: "geheimprojekt" };
    const patchText = `From ${"1".repeat(40)} Mon Sep 17 00:00:00 2001\nSubject: [PATCH] Geheime Änderung\n\n---\ndiff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-x\n+y\n`;
    const innen = [
      raumRepoAnkuendigung(g.gruppe, { id: repo.id, name: "Geheimprojekt", klon: [] }),
      raumRepoBundle(g.gruppe, { name: repo.id, blobId: "b".repeat(64), headSha: "c".repeat(40), branch: "main", message: "Stand", version: 1, schluessel: { alg: "aes-gcm", key: KEY, nonce: "6b".repeat(12), ox: "7c".repeat(32) } }),
      raumRepoPatch(g.gruppe, { repo, text: patchText }),
    ];
    const events: NostrEvent[] = [];
    for (const s of innen) events.push(...(await ma.sendenEvent(g.gruppe, s.art, s.tags, s.text)).events);
    // Seit C-17a: ein Issue, ein Kommentar dazu (Bezug ist die Id des inneren Events) und sein Status
    const issue = await ma.sendenEvent(g.gruppe, ...alsArgs(raumRepoIssue(g.gruppe, { repo, betreff: "Geheimes Issue", text: "Geheime Schritte" })));
    if (!issue.inneres) return 1;
    const bezug = { id: issue.inneres, autor: a.pk, kind: 1621 };
    for (const s of [
      raumRepoKommentar(g.gruppe, { wurzel: bezug, text: "Geheimer Kommentar" }),
      raumRepoIssueStatus(g.gruppe, { issue: { id: issue.inneres, autor: a.pk, repoAdresse: `30617:${a.pk}:${repo.id}` }, status: "erledigt", eigentuemer: a.pk }),
    ]) events.push(...(await ma.sendenEvent(g.gruppe, ...alsArgs(s))).events);
    events.push(...issue.events);
    const alle = [...g.einladungen, ...events];
    if (events.length !== innen.length + 3) return 1;
    return regelRaumRepoPrivat(alle, { repoIds: [repo.id], schluessel: [KEY], innere: [issue.inneres] }).length
      + regelKeinKlartext(alle, ["Geheimprojekt", "Geheime Änderung", KEY, "Geheimes Issue", "Geheime Schritte", "Geheimer Kommentar"]).length +
      regelAutorNicht(alle, a.pk).length + regelMlsGruppe(alle, { gruppenIds: [g.gruppe], identitaeten: [a.pk, b.pk] }).length;
  },
  "raum-meldung": async () => {
    // Wie die App seit 8.5 meldet: je Moderator ein Umschlag, nie in die Gruppe, nie offen
    const mods = [generateKeypair(), generateKeypair()];
    const ziel = "d4".repeat(32);
    const wraps = await baueRaumMeldung({ von: new LocalSigner(a.sk), moderatoren: mods.map((m) => m.pk), gruppe: "c3".repeat(16), ziel, autor: b.pk, grund: "spam", notiz: GEHEIM });
    if (wraps.length !== 2) return 1;
    return regelAutorNicht(wraps, a.pk).length + regelKeinKlartext(wraps, [GEHEIM, ziel, b.pk]).length + regelPTagsNur(wraps, mods.map((m) => m.pk)).length;
  },
  "geraete-kopien": async () => {
    // Wie die App seit 8.6b: an die Person, sich selbst und je Geraet ein eigener Umschlag.
    const [handy, tablet] = [generateKeypair().pk, generateKeypair().pk];
    const dm = await buildPrivateDm({ signer: new LocalSigner(a.sk), recipientPk: b.pk, content: GEHEIM, weitereEmpfaenger: [tablet, handy] });
    const alle = [dm.toRecipient, dm.toSelf, ...dm.weitere.map((k) => k.wrap)];
    if (alle.length !== 4) return 1;
    return regelKeinKlartext(alle, [GEHEIM]).length + regelAutorNicht(alle, a.pk).length + regelPTagsNur(alle, [a.pk, b.pk, handy, tablet]).length;
  },
  "anruf-ip": async () => {
    // Wie die App seit B-13d2: Angebot an Person und Gerät, nur Relay-Kandidaten, versiegelt; ein Host-Kandidat geht nicht hinaus
    const FP = Array.from({ length: 32 }, (_, i) => (i * 5 % 256).toString(16).toUpperCase().padStart(2, "0")).join(":");
    const relay = "candidate:842163049 1 udp 41885439 203.0.113.7 50001 typ relay raddr 0.0.0.0 rport 0 generation 0";
    const sdp = (k: string) => ["v=0", "o=- 1 2 IN IP4 127.0.0.1", "s=-", "t=0 0", "m=audio 9 UDP/TLS/RTP/SAVPF 111", `a=${k}`, `a=fingerprint:sha-256 ${FP}`, "a=mid:0", ""].join("\r\n");
    const geraet = generateKeypair();
    const anruf = neueAnrufKennung();
    const wraps = await baueAnrufNachricht({ von: new LocalSigner(a.sk), an: [b.pk, geraet.pk], nachricht: { anruf, typ: "angebot", sdp: sdp(relay), medien: ["audio"] } });
    const innere = await Promise.all(wraps.map(async (w, i) => ({ id: "", sig: "", ...(await giftUnwrapMitSigner(w, new LocalSigner([b, geraet][i]!.sk))).inner! })));
    if (innere.length !== 2 || innere.some((e) => e.kind !== KIND_ANRUF)) return 1;
    let hostGingHinaus = 1;
    await baueAnrufNachricht({ von: new LocalSigner(a.sk), an: [b.pk], nachricht: { anruf, typ: "angebot", sdp: sdp("candidate:1 1 udp 2122260223 192.168.1.5 54321 typ host generation 0"), medien: ["audio"] } })
      .catch(() => { hostGingHinaus = 0; });
    return hostGingHinaus + regelAnrufNurRelay(wraps, innere).length + regelAutorNicht(wraps, a.pk).length
      + regelPTagsNur(wraps, [b.pk, geraet.pk]).length + regelKeinKlartext(wraps, [anruf, FP, "203.0.113.7"]).length;
  },
  "abdeckung-zelle": async () => {
    const [lat, lon] = [48.137154, 11.576124];
    const funde = (["lora", "bluetooth"] as const).flatMap((layer) => {
      const ev = signEvent(buildCoverageAnnouncement({ pubkey: a.pk, layer, cell: toCell(lat, lon, LAYER_CELL_DEGREES[layer]), region: "" }), a.sk);
      return regelKeinKlartext([ev], [String(lat), String(lon), lat.toFixed(4), lon.toFixed(4)]);
    });
    return funde.length;
  },
  "abdeckung-schluessel": async () => {
    // Wie die App seit 5.10: je Eintrag ein Wegwerfschluessel, mit Ablauf; der Widerruf vom selben.
    const [lat, lon] = [48.137154, 11.576124];
    const eintraege = (["lora", "bluetooth"] as const).map((layer) => baueCoverageEintrag({ layer, cell: toCell(lat, lon, LAYER_CELL_DEGREES[layer]), region: "" }));
    const events = [...eintraege.map((e) => e.event), baueCoverageWiderruf(eintraege[0]!.event.id, eintraege[0]!.wegwerfSk)];
    const verschieden = new Set(eintraege.map((e) => e.event.pubkey)).size === eintraege.length ? 0 : 1;
    const ohneAblauf = eintraege.filter((e) => !e.event.tags.some((t) => t[0] === "expiration")).length;
    return regelAutorNicht(events, a.pk).length + verschieden + ohneAblauf;
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
  assert.deepEqual(PRIVACY_FACTS.filter((f) => !f.regel).map((f) => f.id).sort(), ["dm-forward-secrecy", "ip", "werbe-name"]);
});

test("4.5b: eine SOL-Adresse je Knoten steht als bewusste Grenze im Bericht – mit Grund und Entscheidung", () => {
  const f = PRIVACY_FACTS.find((x) => x.id === "provider-adresse");
  assert.equal(f?.status, "grenze");
  assert.equal(f?.regel, "keine-zahlungsdaten", "welche Anfrage über welchen Kanal lief, steht in keinem Event");
  const t = privacyFactsText();
  const grenzen = t.slice(t.indexOf("Bewusste Grenzen:"));
  assert.match(grenzen, /△ Betreibst du einen Knoten, hat er eine SOL-Adresse: .*Entscheidung 4\.5 A/);
});

test("11.2b: die Abfrage eines Werbe-Namens steht als Grenze im Bericht – kein Event, deshalb ohne Regel", () => {
  const f = PRIVACY_FACTS.find((x) => x.id === "werbe-name");
  assert.equal(f?.status, "grenze");
  assert.equal(f?.regel, undefined, "die Abfrage geht per https an die Domain, nicht als Event an ein Relay");
  const t = privacyFactsText();
  const grenzen = t.slice(t.indexOf("Bewusste Grenzen:"));
  assert.match(grenzen, /△ Kommst du über einen Werbelink mit Namen \(name@domain\), fragt die App diese Domain beim ersten Start einmal .*Werbelinks mit Schlüssel fragen niemanden\./);
});

test("B-13d3: Anrufe – die IP vor dem Gegenüber belegt, der Vermittler als Grenze mit Grund", () => {
  assert.equal(PRIVACY_FACTS.find((x) => x.id === "anruf-ip")?.status, "belegt");
  const f = PRIVACY_FACTS.find((x) => x.id === "anruf-vermittler");
  assert.equal(f?.status, "grenze");
  assert.equal(f?.regel, "anruf-nur-relay");
  assert.match(f?.grund ?? "", /versiegelt und kurzlebig/, "T3 B: der Zugang reist nur versiegelt");
  assert.match(f?.aussage ?? "", /solange sie offen ist, bei ihren Relays eine Abfrage nach Umschlägen an dich offen – die Relays sehen also, wann sie läuft\./, "B-13e: das Abo für Anrufe");
  const t = privacyFactsText();
  assert.match(t.slice(0, t.indexOf("Bewusste Grenzen:")), /✓ Bei Anrufen sieht dein Gegenüber deine IP-Adresse nicht/);
  assert.match(t.slice(t.indexOf("Bewusste Grenzen:")), /△ Ein Anruf läuft immer über einen Vermittler \(TURN\) .*die App sagt dir das vor dem Annehmen\./);
});

test("B-12d2: Wecken steht als Grenze im Bericht – die Anmeldung selbst ist versiegelt, die Push-Adresse nie offen", async () => {
  const f = PRIVACY_FACTS.find((x) => x.id === "wecken");
  assert.equal(f?.status, "grenze");
  assert.equal(f?.regel, "besitzer-versiegelt");
  const t = privacyFactsText();
  assert.match(t.slice(t.indexOf("Bewusste Grenzen:")), /△ Mit „Wecken“ in „Mein Knoten“ sieht der Push-Dienst deines Browsers .*nicht, was kam und von wem\./);
  // Szenario: Anmeldung beim eigenen Knoten – die Push-Adresse ist ein Zugang zum Browser, sie steht nur im Kern
  const knoten = generateKeypair(), ich = generateKeypair(), geraet = generateKeypair();
  const kopplung = neueKopplung(knoten.pk);
  const endpunkt = "https://push.example.org/wpush/v2/" + "a".repeat(120);
  const { wrap } = await baueWeckAnmeldung({
    sitzung: new LocalSigner(generateKeypair().sk), kopplung, anmeldung: { aktion: "an", endpunkt, schluessel: [ich.pk, geraet.pk] },
  });
  assert.deepEqual(regelBesitzerVersiegelt([wrap]), []);
  const offen = JSON.stringify(wrap);
  for (const geheim of [endpunkt, ich.pk, geraet.pk]) assert.ok(!offen.includes(geheim), "nichts davon offen");
  assert.deepEqual(wrap.tags, [["p", knoten.pk]], "nur der Knoten als Empfänger");
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
  // Seit 2.3b: private Räume belegt (MLS); öffentlich nur ausdrücklich
  assert.match(t, /✓ Private Räume – der Standard – sind Ende-zu-Ende-verschlüsselt \(MLS\)/);
  // 4.6c benannte die offene Rechnung als Luecke, seit 4.9b ist sie versiegelt.
  assert.match(t, /✓ Beim Tausch SOL → sats sehen Relays deine Lightning-Rechnung nicht\./);
  // Seit 4.9 (Entscheidung A): gesendete Zahlungen als bewusste Grenze, mit Grund.
  assert.match(t, /Bewusste Grenzen:\n△ Gesendete SOL-Zahlungen kommen nicht von frischen Adressen.*Entscheidung 4\.9 A/);
  // Seit 2.2b-d2: 1:1 über MLS belegt; Forward Secrecy nur dort, der Rückfall NIP-17 als Grenze mit Grund.
  assert.match(t, /✓ Direktnachrichten an Kontakte, die MLS können, laufen über MLS/);
  assert.match(t, /△ Forward Secrecy haben Direktnachrichten nur über MLS\..*NIP-17 kennt keine Forward Secrecy/);
});

// ------------------------------------------------------------ 6.2: IP je Sitzung geprueft

test("6.2: „geprüft“ steht nie in der festen Liste – nur als Ergebnis der .onion-Prüfung", () => {
  assert.equal(PRIVACY_FACTS.filter((f) => f.status === "geprueft").length, 0);
  const ip = PRIVACY_FACTS.find((f) => f.id === "ip")!;
  assert.equal(ip.status, "offen");
  assert.equal(ip.schritt, "6.1", "offen bleibt nur die native App");
});

test("6.2: .onion-Relay erreichbar → Bericht sagt „IP-Adresse verborgen“, mit der Grenze", () => {
  const f = ipFaktFuer("erreichbar");
  assert.equal(f.status, "geprueft");
  const t = privacyFactsText(faktenDieserSitzung("erreichbar"));
  assert.match(t, /In dieser Sitzung geprüft:\n✓ IP-Adresse verborgen: Diese Sitzung erreicht ein \.onion-Relay/);
  assert.match(t, /leitest du nur \.onion-Adressen über Tor, sehen andere Relays deine IP weiter/);
  assert.doesNotMatch(t, /Noch nicht: Relays sehen deine IP-Adresse nicht/);
  // Die Pruefung ersetzt nur die Aussage „ip“ – alles andere bleibt, wie es ist.
  assert.equal(faktenDieserSitzung("erreichbar").length, PRIVACY_FACTS.length);
  assert.deepEqual(faktenDieserSitzung("erreichbar").filter((x) => x.id !== "ip"), PRIVACY_FACTS.filter((x) => x.id !== "ip"));
});

test("6.2: nicht erreichbar → nie „verborgen“, sondern Lücke mit „native App oder Tor Browser“", () => {
  for (const p of ["nicht-erreichbar", "keine-onion"] as const) {
    const f = ipFaktFuer(p);
    assert.equal(f.status, "offen");
    assert.match(f.hinweis ?? "", /Native App oder Tor Browser nutzen/);
    const t = privacyFactsText(faktenDieserSitzung(p));
    assert.doesNotMatch(t, /IP-Adresse verborgen|In dieser Sitzung geprüft/);
    assert.match(t, /○ Noch nicht: Relays sehen deine IP-Adresse nicht\. \(Ausbauplan 6\.1\) – /);
  }
  // Ein nicht erreichbares Relay kann auch nur aus sein – keine Gewissheit behaupten.
  assert.match(ipFaktFuer("nicht-erreichbar").hinweis!, /erreicht kein \.onion-Relay – dein Browser läuft wohl nicht über Tor \(oder die geprüften Relays sind gerade aus\)/);
  assert.match(ipFaktFuer("keine-onion").hinweis!, /Prüfen ging nicht: Die App kennt kein \.onion-Relay/);
  // Ohne Pruefung: der Text wie bisher, ohne Hinweis.
  assert.equal(privacyFactsText(faktenDieserSitzung()), privacyFactsText());
  assert.match(privacyFactsText(), /○ Noch nicht: Relays sehen deine IP-Adresse nicht\. \(Ausbauplan 6\.1\)\n/);
});
