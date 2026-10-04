/**
 * Anrufe in der App (B-13d2): Vermittler wählen, nur Relay-Kandidaten senden,
 * Zustand als reine Funktion der Ereignisse, eingehende Angebote nur von
 * Kontakten.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANRUF_GRENZEN, LocalSigner, baueAnrufNachricht, buildPrivateDm, generateKeypair, neueAnrufKennung, type TurnZugang,
} from "@freedomstack/protocol";
import {
  KLINGELN_SEK, VERBINDEN_SEK, eingehendesAngebot, iceServerAus, naechsterZustand, nurRelaySdp, sendbarerKandidat, vielleichtAnruf,
  waehleVermittler, type Anruf,
} from "../src/anruf-ablauf.js";

const FP = Array.from({ length: 32 }, (_, i) => (i * 7 % 256).toString(16).toUpperCase().padStart(2, "0")).join(":");
const RELAY = "candidate:842163049 1 udp 41885439 203.0.113.7 50001 typ relay raddr 0.0.0.0 rport 0 generation 0";
const HOST = "candidate:1 1 udp 2122260223 192.168.1.5 54321 typ host generation 0";
const SRFLX = "candidate:2 1 udp 1686052607 198.51.100.23 61000 typ srflx raddr 192.168.1.5 rport 54321";
const sdp = (kandidaten: string[], fingerabdruck = `a=fingerprint:sha-256 ${FP}`) => [
  "v=0", "o=- 1 2 IN IP4 127.0.0.1", "s=-", "t=0 0", "m=audio 9 UDP/TLS/RTP/SAVPF 111", ...kandidaten.map((k) => `a=${k}`), fingerabdruck, "a=mid:0", "",
].join("\r\n");
const zugang = (name: string): TurnZugang => ({ urls: [`turn:${name}:3478`], nutzer: `2000000000:${"x".repeat(16)}`, passwort: "A".repeat(27) + "=", bis: 2_000_000_000 });

test("B-13d2: Vermittler – der eigene zuerst, sonst der aus dem Angebot (fremd), sonst keiner", () => {
  const eigen = zugang("mein.example"), fremd = zugang("ihr.example");
  assert.deepEqual(waehleVermittler(eigen, fremd), { zugang: eigen, fremd: false });
  assert.deepEqual(waehleVermittler(null, fremd), { zugang: fremd, fremd: true }, "T3 B: dann sieht ihr Knoten die IP");
  assert.equal(waehleVermittler(null, undefined), null, "ohne Vermittler kein Anruf");
  assert.deepEqual(iceServerAus(eigen), { urls: ["turn:mein.example:3478"], username: eigen.nutzer, credential: eigen.passwort });
});

test("B-13d2: hinaus nur Relay – andere Kandidaten fallen aus dem SDP, ohne Fingerabdruck geht nichts", () => {
  const roh = sdp([HOST, RELAY, SRFLX]);
  const sauber = nurRelaySdp(roh)!;
  assert.ok(sauber.includes(RELAY) && !sauber.includes("typ host") && !sauber.includes("typ srflx"));
  assert.equal(nurRelaySdp(sdp([RELAY], "a=nichts")), null, "ohne DTLS-Fingerabdruck");
  assert.ok(nurRelaySdp(sdp([])), "Trickle: Kandidaten kommen einzeln");
  const anruf = "a".repeat(32);
  assert.deepEqual(sendbarerKandidat(anruf, { candidate: RELAY, sdpMid: "0", sdpMLineIndex: 0 }),
    { anruf, typ: "kandidat", kandidat: { candidate: RELAY, sdpMid: "0", sdpMLineIndex: 0 } });
  assert.equal(sendbarerKandidat(anruf, { candidate: HOST }), null);
  assert.equal(sendbarerKandidat(anruf, { candidate: SRFLX }), null);
  assert.equal(sendbarerKandidat(anruf, { candidate: "" }), null, "Ende der Sammlung");
});

test("B-13d2: Zustand – ausgehend und eingehend, Fristen, Ende endgültig, Unpassendes ändert nichts", () => {
  const aus: Anruf = { kennung: "a".repeat(32), partner: "b".repeat(64), richtung: "aus", medien: ["audio"], phase: "klingelt", fremderVermittler: false, seit: 1000 };
  const verbindet = naechsterZustand(aus, { art: "antwort", jetzt: 1010 });
  assert.equal(verbindet.phase, "verbindet");
  assert.equal(naechsterZustand(verbindet, { art: "verbunden", jetzt: 1012 }).phase, "verbunden");
  assert.equal(naechsterZustand(aus, { art: "angenommen", jetzt: 1010 }), aus, "annehmen kann nur, wer angerufen wird");
  assert.equal(naechsterZustand(aus, { art: "takt", jetzt: 1000 + KLINGELN_SEK - 1 }), aus);
  assert.deepEqual(naechsterZustand(aus, { art: "takt", jetzt: 1000 + KLINGELN_SEK }), { ...aus, phase: "beendet", grund: "zeit", seit: 1000 + KLINGELN_SEK });
  assert.equal(naechsterZustand(verbindet, { art: "takt", jetzt: 1010 + VERBINDEN_SEK }).grund, "zeit", "Aufbau über den Vermittler hängt");
  const verbunden = naechsterZustand(verbindet, { art: "verbunden", jetzt: 1012 });
  assert.equal(naechsterZustand(verbunden, { art: "takt", jetzt: 99_999 }), verbunden, "ein Gespräch läuft ohne Frist");
  const ende = naechsterZustand(verbunden, { art: "ende", grund: "aufgelegt", jetzt: 1100 });
  assert.deepEqual([ende.phase, ende.grund], ["beendet", "aufgelegt"]);
  assert.equal(naechsterZustand(ende, { art: "antwort", jetzt: 1101 }), ende, "Ende ist endgültig");
  const ein: Anruf = { ...aus, richtung: "ein", phase: "eingehend", fremderVermittler: true };
  assert.equal(naechsterZustand(ein, { art: "antwort", jetzt: 1001 }), ein, "eine Antwort kommt nur zur Anruferin");
  assert.equal(naechsterZustand(ein, { art: "angenommen", jetzt: 1001 }).phase, "verbindet");
  assert.equal(naechsterZustand(ein, { art: "ende", grund: "abgelehnt", jetzt: 1001 }).grund, "abgelehnt");
});

test("B-13d2: eingehendes Angebot – nur von Kontakten; läuft ein Anruf, besetzt; Fremden nie eine Antwort", () => {
  const laufend: Anruf = { kennung: "a".repeat(32), partner: "b".repeat(64), richtung: "aus", medien: ["audio"], phase: "verbunden", fremderVermittler: false, seit: 0 };
  assert.equal(eingehendesAngebot({ vonKontakt: true, laufend: null }), "klingeln");
  assert.equal(eingehendesAngebot({ vonKontakt: true, laufend }), "besetzt");
  assert.equal(eingehendesAngebot({ vonKontakt: true, laufend: { ...laufend, phase: "beendet" } }), "klingeln");
  assert.equal(eingehendesAngebot({ vonKontakt: false, laufend: null }), "still");
  assert.equal(eingehendesAngebot({ vonKontakt: false, laufend }), "still", "auch nicht „besetzt“ – das verriete, dass die App offen ist");
});

test("B-13e: drei Minuten klingeln (T4 A) – kürzer, als das Angebot gilt", () => {
  assert.equal(KLINGELN_SEK, 180);
  assert.ok(KLINGELN_SEK < ANRUF_GRENZEN.ablaufSek, "sonst klingelt ein Angebot, das die Gegenseite nicht mehr annimmt");
});

test("B-13e: Vorfilter am Umschlag – nur was wie ein Anruf aussieht, wird entschlüsselt", async () => {
  const JETZT = 1_790_000_000;
  const ich = new LocalSigner(generateKeypair().sk), du = generateKeypair();
  const [anruf] = await baueAnrufNachricht({
    von: ich, an: [du.pk], nowSecs: JETZT, nachricht: { anruf: neueAnrufKennung(), typ: "ende", grund: "aufgelegt" },
  });
  assert.equal(vielleichtAnruf(anruf!, JETZT), true);
  assert.equal(vielleichtAnruf(anruf!, JETZT + ANRUF_GRENZEN.ablaufSek - 1), true, "bis kurz vor dem Ablauf");
  assert.equal(vielleichtAnruf(anruf!, JETZT + ANRUF_GRENZEN.ablaufSek), false, "abgelaufen");
  assert.equal(vielleichtAnruf(anruf!, JETZT - 61), false, "aus der Zukunft");
  // Chat-Umschläge: zurückdatiert, ohne Ablauf – oder mit Ablauf, der länger läuft (NIP-40, ab einer Stunde)
  const dm = await buildPrivateDm({ signer: ich, recipientPk: du.pk, content: "hallo", nowSecs: JETZT });
  assert.equal(vielleichtAnruf(dm.toRecipient, JETZT), false);
  const mitAblauf = { ...anruf!, tags: [["p", du.pk], ["expiration", String(JETZT + 3600)]] };
  assert.equal(vielleichtAnruf(mitAblauf, JETZT), false, "verschwindende Nachricht");
  assert.equal(vielleichtAnruf({ ...anruf!, tags: [["p", du.pk]] }, JETZT), false, "ohne Ablauf");
  assert.equal(vielleichtAnruf({ ...anruf!, tags: [["p", du.pk], ["expiration", "kaputt"]] }, JETZT), false);
  assert.equal(vielleichtAnruf({ ...anruf!, kind: 4 }, JETZT), false, "nur Umschläge");
});
