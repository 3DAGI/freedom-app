/**
 * Anruf-Aufbau (B-13c, T1 A, T2 A): nur versiegelt, je Empfänger ein
 * Umschlag mit Ablauf; im SDP nur Relay-Kandidaten und ein DTLS-Fingerabdruck
 * – eine eigene Adresse geht nie hinaus und wird nie gelesen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANRUF_GRENZEN, KIND_ANRUF, KIND_GIFT_WRAP, LocalSigner, baueAnrufNachricht, generateKeypair, giftWrapMitSigner, istRelayKandidat,
  neueAnrufKennung, oeffneAnrufNachricht, pruefeSdpNurRelay, regelAnrufNurRelay, type AnrufNachricht, type TurnZugang,
} from "../src/index.js";

const FP = Array.from({ length: 32 }, (_, i) => (i * 7 % 256).toString(16).toUpperCase().padStart(2, "0")).join(":");
const RELAY = "candidate:842163049 1 udp 41885439 203.0.113.7 50001 typ relay raddr 0.0.0.0 rport 0 generation 0";
const sdp = (kandidaten: string[] = [RELAY], fingerabdruck = `a=fingerprint:sha-256 ${FP}`) => [
  "v=0", "o=- 4611731400430051336 2 IN IP4 127.0.0.1", "s=-", "t=0 0", "a=group:BUNDLE 0", "m=audio 9 UDP/TLS/RTP/SAVPF 111", "c=IN IP4 0.0.0.0",
  ...kandidaten.map((k) => `a=${k}`), "a=ice-ufrag:abcd", "a=ice-pwd:abcdefghijklmnopqrstuvwx", fingerabdruck, "a=setup:actpass", "a=mid:0",
  "a=sendrecv", "a=rtpmap:111 opus/48000/2", "",
].join("\r\n");
const JETZT = 1_790_000_000;

test("B-13c: Angebot an Person und Gerät – je ein Umschlag, Ablauf in fünf Minuten, ohne Zeitversatz; nur der Empfänger öffnet", async () => {
  const ich = new LocalSigner(generateKeypair().sk);
  const person = new LocalSigner(generateKeypair().sk), geraet = new LocalSigner(generateKeypair().sk), fremd = new LocalSigner(generateKeypair().sk);
  const anruf = neueAnrufKennung();
  assert.match(anruf, /^[0-9a-f]{32}$/);
  const n: AnrufNachricht = { anruf, typ: "angebot", sdp: sdp(), medien: ["audio", "video"] };
  const wraps = await baueAnrufNachricht({ von: ich, an: [person.publicKey(), geraet.publicKey(), person.publicKey()], nachricht: n, nowSecs: JETZT });
  assert.equal(wraps.length, 2, "je Empfänger einmal");
  for (const [w, an] of [[wraps[0]!, person], [wraps[1]!, geraet]] as const) {
    assert.equal(w.kind, KIND_GIFT_WRAP);
    assert.deepEqual(w.tags, [["p", an.publicKey()], ["expiration", String(JETZT + ANRUF_GRENZEN.ablaufSek)]], "offen nur Empfänger und Ablauf");
    assert.equal(w.created_at, JETZT, "kein Zeitversatz – ein Anruf ist jetzt");
    assert.deepEqual(await oeffneAnrufNachricht(w, an, JETZT + 10), { von: ich.publicKey(), nachricht: n });
  }
  assert.equal(await oeffneAnrufNachricht(wraps[0]!, fremd, JETZT), null, "nicht für Fremde");
  assert.equal(await oeffneAnrufNachricht(wraps[0]!, geraet, JETZT), null, "nur der Empfänger im Kern");
  assert.equal(await oeffneAnrufNachricht(wraps[0]!, person, JETZT + ANRUF_GRENZEN.ablaufSek + 1), null, "älter als fünf Minuten: vorbei");
  assert.equal(await oeffneAnrufNachricht(wraps[0]!, person, JETZT - 120), null, "aus der Zukunft");
  // Antwort, Kandidat, Ende
  for (const m of [
    { anruf, typ: "antwort", sdp: sdp([]) },
    { anruf, typ: "kandidat", kandidat: { candidate: RELAY, sdpMid: "0", sdpMLineIndex: 0 } },
    { anruf, typ: "ende", grund: "aufgelegt" },
  ] as AnrufNachricht[]) {
    const [w] = await baueAnrufNachricht({ von: person, an: [ich.publicKey()], nachricht: m, nowSecs: JETZT });
    assert.deepEqual((await oeffneAnrufNachricht(w!, ich, JETZT))!.nachricht, m);
  }
});

test("B-13c: nur Relay – Host, srflx, prflx und mDNS gehen nie hinaus; ohne SHA-256-Fingerabdruck auch nicht", async () => {
  assert.ok(pruefeSdpNurRelay(sdp()) && pruefeSdpNurRelay(sdp([])), "Relay oder Trickle ohne Kandidaten");
  assert.ok(istRelayKandidat(RELAY));
  const fremdeAdressen = [
    "candidate:1 1 udp 2122260223 192.168.1.5 54321 typ host generation 0",
    "candidate:2 1 udp 1686052607 198.51.100.23 61000 typ srflx raddr 192.168.1.5 rport 54321",
    "candidate:3 1 udp 1845501695 198.51.100.23 61001 typ prflx raddr 192.168.1.5 rport 54321",
    "candidate:4 1 udp 2122260223 3f1c2b6e-1a2b-4c3d-9e8f-0123456789ab.local 54321 typ host",
    "candidate:5 1 tcp 1518280447 192.168.1.5 9 typ host tcptype active",
  ];
  for (const k of fremdeAdressen) {
    assert.equal(istRelayKandidat(k), false, k);
    assert.equal(pruefeSdpNurRelay(sdp([RELAY, k])), false, "ein einziger genügt, um die IP zu verraten");
  }
  assert.equal(pruefeSdpNurRelay(sdp([RELAY], "a=fingerprint:sha-1 AB:CD")), false, "nur SHA-256");
  assert.equal(pruefeSdpNurRelay(sdp([RELAY], "a=ice-lite")), false, "ohne Fingerabdruck");
  assert.equal(pruefeSdpNurRelay(`x${sdp()}`), false);
  assert.equal(pruefeSdpNurRelay(sdp().padEnd(ANRUF_GRENZEN.sdpZeichen + 1, "a")), false, "begrenzt");
  assert.equal(istRelayKandidat(`${RELAY}\r\na=candidate:1 1 udp 1 192.168.1.5 1 typ host`), false, "keine zweite Zeile einschmuggeln");

  const ich = new LocalSigner(generateKeypair().sk), du = generateKeypair().pk;
  const anruf = neueAnrufKennung();
  for (const nachricht of [
    { anruf, typ: "angebot", sdp: sdp([RELAY, fremdeAdressen[0]!]), medien: ["audio"] },
    { anruf, typ: "antwort", sdp: sdp([fremdeAdressen[1]!]) },
    { anruf, typ: "kandidat", kandidat: { candidate: fremdeAdressen[3]!, sdpMid: "0", sdpMLineIndex: 0 } },
    { anruf, typ: "angebot", sdp: sdp(), medien: ["video"] },
    { anruf, typ: "angebot", sdp: sdp(), medien: ["audio", "audio"] },
    { anruf, typ: "ende", grund: "weil" },
    { anruf: "kurz", typ: "ende", grund: "aufgelegt" },
  ]) await assert.rejects(baueAnrufNachricht({ von: ich, an: [du], nachricht: nachricht as AnrufNachricht }), /Anruf-Nachricht ungültig/, JSON.stringify(nachricht).slice(0, 80));
  await assert.rejects(baueAnrufNachricht({ von: ich, an: [], nachricht: { anruf, typ: "ende", grund: "zeit" } }), /Empfänger ungültig/);
});

test("B-13c: was ein anderer Client versiegelt, liest die App nur, wenn es den Regeln folgt", async () => {
  const ich = new LocalSigner(generateKeypair().sk), du = new LocalSigner(generateKeypair().sk);
  const anruf = neueAnrufKennung();
  const kern = (inhalt: unknown, tags: string[][] = [["p", du.publicKey()], ["anruf", anruf]], kind = KIND_ANRUF) =>
    ({ pubkey: ich.publicKey(), kind, created_at: JETZT, tags, content: JSON.stringify(inhalt) });
  const wrap = (k: ReturnType<typeof kern>) => giftWrapMitSigner(k, ich, du.publicKey(), { fixedJitter: 0, nowSecs: JETZT });
  const host = sdp(["candidate:1 1 udp 2122260223 192.168.1.5 54321 typ host"]);
  for (const k of [
    kern({ anruf, typ: "angebot", sdp: host, medien: ["audio"] }),
    kern({ anruf, typ: "ende", grund: "aufgelegt" }, [["p", du.publicKey()], ["anruf", neueAnrufKennung()]]),
    kern({ anruf, typ: "ende", grund: "aufgelegt" }, [["anruf", anruf]]),
    kern({ anruf, typ: "ende", grund: "aufgelegt" }, undefined, 14),
  ]) assert.equal(await oeffneAnrufNachricht(await wrap(k), du, JETZT), null, k.content.slice(0, 60));
  const gut = await wrap(kern({ anruf, typ: "ende", grund: "besetzt" }));
  assert.deepEqual((await oeffneAnrufNachricht(gut, du, JETZT))!.nachricht, { anruf, typ: "ende", grund: "besetzt" });
});

/** Zugang zum TURN der Anruferin – Form wie aus `turnZugang()` des Knotens. */
const zugang = (bis: number, urls = ["turn:knoten.example:3478?transport=udp", "turns:knoten.example:5349"]): TurnZugang =>
  ({ urls, nutzer: `${bis}:${"x".repeat(16)}`, passwort: "A".repeat(27) + "=", bis });

test("B-13d1: Angebot mit Zugang zum TURN der Anruferin (T3 B) – nur gültig, nur im versiegelten Kern", async () => {
  const ich = new LocalSigner(generateKeypair().sk), du = new LocalSigner(generateKeypair().sk);
  const anruf = neueAnrufKennung();
  const turn = zugang(JETZT + 3600);
  const n: AnrufNachricht = { anruf, typ: "angebot", sdp: sdp(), medien: ["audio"], turn };
  const [w] = await baueAnrufNachricht({ von: ich, an: [du.publicKey()], nachricht: n, nowSecs: JETZT });
  assert.deepEqual((await oeffneAnrufNachricht(w!, du, JETZT))!.nachricht, n);
  assert.ok(!JSON.stringify(w).includes(turn.nutzer) && !JSON.stringify(w).includes("knoten.example"), "Zugang nie offen");
  // Ohne Zugang bleibt das Angebot wie bisher
  const ohne: AnrufNachricht = { anruf, typ: "angebot", sdp: sdp(), medien: ["audio"] };
  const [w2] = await baueAnrufNachricht({ von: ich, an: [du.publicKey()], nachricht: ohne, nowSecs: JETZT });
  assert.equal("turn" in (await oeffneAnrufNachricht(w2!, du, JETZT))!.nachricht, false);
  // Negativfälle – geprüft wie leseTurnZugang()
  for (const [falsch, warum] of [
    [zugang(JETZT - 1), "abgelaufen"],
    [zugang(JETZT + 90_000), "mehr als einen Tag"],
    [zugang(JETZT + 3600, ["http://knoten.example"]), "keine turn:-Adresse"],
    [{ ...zugang(JETZT + 3600), nutzer: "1:kurz" }, "Nutzer passt nicht zum Ablauf"],
    [{ ...zugang(JETZT + 3600), passwort: "kurz" }, "Passwort nicht nach TURN-REST"],
    ["turn:knoten.example", "kein Objekt"],
  ] as const) {
    await assert.rejects(baueAnrufNachricht({ von: ich, an: [du.publicKey()], nachricht: { ...ohne, turn: falsch as TurnZugang }, nowSecs: JETZT }), /Zugang/, warum);
  }
  // Auch beim Lesen: Läuft der Zugang ab, bevor der Anruf ankommt, gilt das Angebot nicht
  const kurz: AnrufNachricht = { ...ohne, turn: zugang(JETZT + 30) };
  const [w3] = await baueAnrufNachricht({ von: ich, an: [du.publicKey()], nachricht: kurz, nowSecs: JETZT });
  assert.equal(await oeffneAnrufNachricht(w3!, du, JETZT + 60), null);
});

test("B-13d1: Leak-Regel anruf-nur-relay – nie offen, innen nur Relay mit Fingerabdruck", () => {
  const ev = (kind: number, content: string) => ({ id: "e".repeat(64), pubkey: "a".repeat(64), created_at: JETZT, kind, tags: [], content, sig: "" });
  const anruf = neueAnrufKennung();
  const gut = [
    ev(KIND_ANRUF, JSON.stringify({ anruf, typ: "angebot", sdp: sdp(), medien: ["audio"] })),
    ev(KIND_ANRUF, JSON.stringify({ anruf, typ: "antwort", sdp: sdp([]) })),
    ev(KIND_ANRUF, JSON.stringify({ anruf, typ: "kandidat", kandidat: { candidate: RELAY, sdpMid: "0", sdpMLineIndex: 0 } })),
    ev(KIND_ANRUF, JSON.stringify({ anruf, typ: "ende", grund: "aufgelegt" })),
  ];
  assert.deepEqual(regelAnrufNurRelay([ev(KIND_GIFT_WRAP, "x")], gut), []);
  const HOST = "candidate:1 1 udp 2122260223 192.168.1.5 54321 typ host generation 0";
  assert.equal(regelAnrufNurRelay(gut).length, 4, "offen gesendet ist jeder Anruf-Aufbau ein Fund – auch ein gültiger");
  assert.equal(regelAnrufNurRelay([], [ev(KIND_ANRUF, JSON.stringify({ anruf, typ: "angebot", sdp: sdp([HOST]), medien: ["audio"] }))]).length, 1, "Host im SDP");
  assert.equal(regelAnrufNurRelay([], [ev(KIND_ANRUF, JSON.stringify({ anruf, typ: "antwort", sdp: sdp([], "a=nichts") }))]).length, 1, "ohne Fingerabdruck");
  assert.equal(regelAnrufNurRelay([], [ev(KIND_ANRUF, JSON.stringify({ anruf, typ: "kandidat", kandidat: { candidate: HOST } }))]).length, 1, "Host als Kandidat");
  assert.equal(regelAnrufNurRelay([], [ev(KIND_ANRUF, "kein json")]).length, 1);
  assert.equal(regelAnrufNurRelay([], [ev(KIND_ANRUF, JSON.stringify({ anruf, typ: "unbekannt" }))]).length, 1);
});
