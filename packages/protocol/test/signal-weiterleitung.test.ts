/**
 * B-34e1: Signalverbindung zum Gruppenanruf über den eigenen Knoten – Anfrage versiegelt mit Nachweis, Antwort und Pfad
 * streng gelesen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KIND_DVM_SIGNAL, LocalSigner, SIGNAL_GRENZEN, baueSignalAnfrage, generateKeypair, leseSignalAnfrage, leseSignalPfad,
  leseSignalZugang, neueKopplung, openPrivateJobRequest, signalZugangText,
} from "../src/index.js";

const JETZT = 1_790_000_000;
const ZEICHEN = "a1".repeat(32);

test("B-34e1: Anfrage – nur ein Ziel wss://host[:port] wie in einer Einladung, versiegelt mit Nachweis", async () => {
  assert.deepEqual(leseSignalAnfrage(JSON.stringify({ ziel: "wss://sfu.example.org:7880", bis: JETZT })), { ziel: "wss://sfu.example.org:7880", bis: JETZT });
  assert.deepEqual(leseSignalAnfrage(JSON.stringify({ ziel: "wss://sfu.example.org/", bis: JETZT })), { ziel: "wss://sfu.example.org", bis: JETZT }, "ohne Schrägstrich am Ende");
  for (const falsch of [
    { ziel: "ws://sfu.example.org", bis: JETZT }, { ziel: "https://sfu.example.org", bis: JETZT }, { ziel: "wss://sfu.example.org/rtc", bis: JETZT },
    { ziel: "wss://nutzer:pw@sfu.example.org", bis: JETZT }, { ziel: "wss://sfu.example.org", bis: 0 }, { ziel: "wss://sfu.example.org", bis: 1.5 },
    { ziel: "wss://sfu.example.org" }, { bis: JETZT }, ["wss://sfu.example.org", JETZT],
  ]) {
    assert.equal(leseSignalAnfrage(JSON.stringify(falsch)), null, JSON.stringify(falsch));
  }
  assert.equal(leseSignalAnfrage("{"), null);
  const knoten = generateKeypair();
  const k = neueKopplung(knoten.pk);
  const sitzung = new LocalSigner(generateKeypair().sk);
  await assert.rejects(baueSignalAnfrage({ sitzung, kopplung: k, ziel: "ws://sfu.example.org", bis: JETZT }));
  const { wrap } = await baueSignalAnfrage({ sitzung, kopplung: k, ziel: "wss://sfu.example.org", bis: JETZT });
  assert.equal(wrap.kind, 1059, "nur versiegelt");
  assert.deepEqual(wrap.tags.map((t) => t[0]), ["p"], "offen nur der Empfänger");
  const offen = await openPrivateJobRequest(wrap, new LocalSigner(knoten.sk));
  assert.ok(offen.ok);
  assert.equal(offen.request.kind, KIND_DVM_SIGNAL);
  assert.ok(offen.request.tags.some((t) => t[0] === "besitzer"), "mit Nachweis");
  assert.deepEqual(leseSignalAnfrage(offen.request.tags.find((t) => t[0] === "i")![1]!), { ziel: "wss://sfu.example.org", bis: JETZT });
});

test("B-34e1: Antwort streng – Zeichen 64 Zeichen Hex, Ablauf in der Zukunft und höchstens einen Tag entfernt", () => {
  const gut = { zeichen: ZEICHEN, bis: JETZT + 3600 };
  assert.deepEqual(leseSignalZugang(signalZugangText(gut), JETZT), gut);
  assert.ok(leseSignalZugang(signalZugangText({ zeichen: ZEICHEN, bis: JETZT + SIGNAL_GRENZEN.hoechstensSek + SIGNAL_GRENZEN.spielraumSek }), JETZT), "Spielraum für die Uhren");
  const falsch: Array<[string, unknown]> = [
    ["Zeichen zu kurz", { zeichen: ZEICHEN.slice(2), bis: JETZT + 60 }],
    ["Zeichen groß", { zeichen: ZEICHEN.toUpperCase(), bis: JETZT + 60 }],
    ["abgelaufen", { zeichen: ZEICHEN, bis: JETZT }],
    ["zu lange", { zeichen: ZEICHEN, bis: JETZT + SIGNAL_GRENZEN.hoechstensSek + SIGNAL_GRENZEN.spielraumSek + 1 }],
    ["Ablauf keine Zahl", { zeichen: ZEICHEN, bis: "morgen" }],
    ["Liste", [ZEICHEN, JETZT + 60]],
  ];
  for (const [name, roh] of falsch) assert.equal(leseSignalZugang(JSON.stringify(roh), JETZT), null, name);
  assert.equal(leseSignalZugang("kein json", JETZT), null);
});

test("B-34e1: Pfad im Relay – nur /signal/<zeichen>/rtc[/v1], dahinter höchstens die Anfrage", () => {
  assert.deepEqual(leseSignalPfad(`/signal/${ZEICHEN}/rtc/v1?access_token=x&join_request=y`), { zeichen: ZEICHEN, pfad: "/rtc/v1", anfrage: "?access_token=x&join_request=y" });
  assert.deepEqual(leseSignalPfad(`/signal/${ZEICHEN}/rtc?access_token=x`), { zeichen: ZEICHEN, pfad: "/rtc", anfrage: "?access_token=x" });
  assert.deepEqual(leseSignalPfad(`/signal/${ZEICHEN}/rtc/v1`), { zeichen: ZEICHEN, pfad: "/rtc/v1", anfrage: "" });
  for (const falsch of [
    `/signal/${ZEICHEN}`, `/signal/${ZEICHEN}/`, `/signal/${ZEICHEN}/rtc/v2`, `/signal/${ZEICHEN}/rtc/v1/validate`, `/signal/${ZEICHEN}/rtc/../x`,
    `/signal/${ZEICHEN.slice(1)}/rtc`, `/signal/${ZEICHEN.toUpperCase()}/rtc`, `/x/signal/${ZEICHEN}/rtc`, `/signal/${ZEICHEN}/rtc#frag`, "/", "",
  ]) {
    assert.equal(leseSignalPfad(falsch), null, falsch);
  }
});
