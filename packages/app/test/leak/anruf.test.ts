/**
 * Leak-Szenario Anruf (B-13d2): Was der Browser sammelt, kann Host- und
 * srflx-Kandidaten enthalten. Die App schickt nur, was `nurRelaySdp()` und
 * `sendbarerKandidat()` durchlassen – versiegelt an Person und Gerät. Offen
 * steht kein Anruf-Aufbau, innen nur Relay mit Fingerabdruck; der Zugang zum
 * TURN der Anruferin (T3 B) steht nie offen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LocalSigner, baueAnrufNachricht, generateKeypair, giftUnwrapMitSigner, neueAnrufKennung, regelAnrufNurRelay, regelAutorNicht, regelPTagsNur,
  type NostrEvent,
} from "@freedomstack/protocol";
import { nurRelaySdp, sendbarerKandidat } from "../../src/anruf-ablauf.js";
import { aufzeichnung } from "./aufzeichnung.js";

const FP = Array.from({ length: 32 }, (_, i) => (i * 11 % 256).toString(16).toUpperCase().padStart(2, "0")).join(":");
const RELAY = "candidate:9 1 udp 41885439 203.0.113.7 50001 typ relay raddr 0.0.0.0 rport 0 generation 0";
const HOST = "candidate:1 1 udp 2122260223 192.168.1.5 54321 typ host generation 0";
const SRFLX = "candidate:2 1 udp 1686052607 198.51.100.23 61000 typ srflx raddr 192.168.1.5 rport 54321";
const gesammelt = ["v=0", "o=- 1 2 IN IP4 127.0.0.1", "s=-", "t=0 0", "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  `a=${HOST}`, `a=${SRFLX}`, `a=${RELAY}`, `a=fingerprint:sha-256 ${FP}`, "a=mid:0", ""].join("\r\n");

test("Anruf: hinaus nur versiegelt, innen nur Relay, keine eigene Adresse, der Zugang nie offen", async () => {
  const { pool, relay } = aufzeichnung();
  const ich = new LocalSigner(generateKeypair().sk), du = new LocalSigner(generateKeypair().sk), deinGeraet = new LocalSigner(generateKeypair().sk);
  const anruf = neueAnrufKennung();
  const turn = { urls: ["turn:mein-knoten.example:3478"], nutzer: `${Math.floor(Date.now() / 1000) + 3600}:${"z".repeat(20)}`, passwort: "B".repeat(27) + "=", bis: Math.floor(Date.now() / 1000) + 3600 };
  const nachrichten = [
    { anruf, typ: "angebot" as const, sdp: nurRelaySdp(gesammelt)!, medien: ["audio" as const], turn },
    ...[HOST, SRFLX, RELAY].map((c) => sendbarerKandidat(anruf, { candidate: c, sdpMid: "0", sdpMLineIndex: 0 })).filter((n) => n !== null),
  ];
  assert.equal(nachrichten.length, 2, "von drei gesammelten Kandidaten geht nur der relay-Kandidat einzeln hinaus");
  const innere: NostrEvent[] = [];
  for (const n of nachrichten) {
    for (const w of await baueAnrufNachricht({ von: ich, an: [du.publicKey(), deinGeraet.publicKey()], nachricht: n })) {
      await pool.publish(w);
      for (const s of [du, deinGeraet]) {
        const r = await giftUnwrapMitSigner(w, s);
        if (r.ok && r.inner) innere.push({ id: "", sig: "", ...r.inner });
      }
    }
  }
  const gesendet = relay.gesendet;
  assert.equal(gesendet.length, 4);
  assert.deepEqual(gesendet.map((e) => e.kind), [1059, 1059, 1059, 1059]);
  assert.equal(innere.length, 4, "jede Nachricht je Empfänger einmal");
  assert.deepEqual(regelAnrufNurRelay(gesendet, innere), []);
  assert.deepEqual(regelAutorNicht(gesendet, ich.publicKey()), []);
  assert.deepEqual(regelPTagsNur(gesendet, [du.publicKey(), deinGeraet.publicKey()]), []);
  const offen = JSON.stringify(gesendet);
  for (const geheim of [turn.nutzer, "mein-knoten.example", "192.168.1.5", "198.51.100.23", FP]) assert.ok(!offen.includes(geheim), geheim);
  const innen = JSON.stringify(innere);
  assert.ok(!innen.includes("192.168.1.5") && !innen.includes("198.51.100.23"), "auch innen keine eigene Adresse");
});

test("Anruf: die App sendet nur über diese Bausteine – kein offener Anruf-Aufbau, nicht verzögert wie Chat-Nachrichten", () => {
  const src = readFileSync(new URL("../../src/shell/anruf.ts", import.meta.url), "utf8");
  assert.match(src, /const wraps = await baueAnrufNachricht\(\{ von: state\.signer, an: \[partner, \.\.\.geraete\], nachricht: n \}\);/);
  assert.match(src, /await Promise\.all\(wraps\.map\(\(w\) => veroeffentlicheDm\(w, partner\)\)\);/, "an den Posteingang der Person");
  assert.match(src, /const sdp = nurRelaySdp\(o\.sdp \?\? ""\);/);
  assert.match(src, /const sdp = nurRelaySdp\(a\.sdp \?\? ""\);/);
  assert.match(src, /const n = e\.candidate \? sendbarerKandidat\(kennung, e\.candidate\) : null;/);
  assert.match(src, /new RTCPeerConnection\(\{ iceServers: \[iceServerAus\(zugang\)\], iceTransportPolicy: "relay" \}\)/);
  // Ein publish gibt es nur für die TURN-Anfrage an den eigenen Knoten (versiegelt, über den Weg aus B-9c2)
  assert.deepEqual(src.match(/[\w.]*\.publish\([^)]*\)/g), ["weg.publish(wrap)"], "Anruf-Nachrichten nie am Posteingang vorbei");
});
