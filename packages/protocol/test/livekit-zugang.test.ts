/**
 * B-34a: Zugänge zum Gruppenanruf des eigenen Knotens – Anfrage versiegelt mit Nachweis, Antwort streng gelesen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KIND_DVM_LIVEKIT, LIVEKIT_GRENZEN, LocalSigner, baueLivekitAnfrage, generateKeypair, istLivekitUrl, leseLivekitAnfrage,
  leseLivekitZugaenge, livekitZugaengeText, neueKopplung, openPrivateJobRequest, type LivekitZugaenge,
} from "../src/index.js";

const RAUM = "ab".repeat(16);
const JETZT = 1_790_000_000;
const token = (n: number) => `eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ${n}In0.c2lnbmF0dXI${n}`;
const gut = (anzahl = 2): LivekitZugaenge => ({
  url: "wss://knoten.example.org", raum: RAUM, bis: JETZT + 3600,
  zugaenge: Array.from({ length: anzahl }, (_, i) => ({ kennung: `${i}`.repeat(16).slice(0, 16), token: token(i) })),
});

test("B-34a: Adresse des SFU nur wss://host[:port]", () => {
  for (const u of ["wss://knoten.example.org", "wss://knoten.example.org:7880", "wss://knoten.example.org/"]) assert.ok(istLivekitUrl(u), u);
  for (const u of ["ws://knoten.example.org", "https://knoten.example.org", "wss://user:pw@knoten", "wss://knoten/pfad?x=1", "wss://" + "a".repeat(200), ""]) {
    assert.ok(!istLivekitUrl(u), u);
  }
});

test("B-34a: Anfrage – nur ein zufälliger Raum und 1 bis 25 Zugänge, versiegelt mit Nachweis", async () => {
  assert.deepEqual(leseLivekitAnfrage(JSON.stringify({ raum: RAUM, anzahl: 3 })), { raum: RAUM, anzahl: 3 });
  for (const falsch of [{ raum: "AB".repeat(16), anzahl: 1 }, { raum: RAUM.slice(2), anzahl: 1 }, { raum: RAUM, anzahl: 0 }, { raum: RAUM, anzahl: LIVEKIT_GRENZEN.teilnehmer + 1 },
    { raum: RAUM, anzahl: 1.5 }, { raum: RAUM }, [RAUM, 1]]) {
    assert.equal(leseLivekitAnfrage(JSON.stringify(falsch)), null, JSON.stringify(falsch));
  }
  assert.equal(leseLivekitAnfrage("{"), null);
  const knoten = generateKeypair();
  const k = neueKopplung(knoten.pk);
  const sitzung = new LocalSigner(generateKeypair().sk);
  await assert.rejects(baueLivekitAnfrage({ sitzung, kopplung: k, raum: "kein-raum", anzahl: 2 }));
  const { wrap } = await baueLivekitAnfrage({ sitzung, kopplung: k, raum: RAUM, anzahl: 4 });
  assert.equal(wrap.kind, 1059, "nur versiegelt");
  assert.deepEqual(wrap.tags.map((t) => t[0]), ["p"], "offen nur der Empfänger");
  const offen = await openPrivateJobRequest(wrap, new LocalSigner(knoten.sk));
  assert.ok(offen.ok);
  assert.equal(offen.request.kind, KIND_DVM_LIVEKIT);
  assert.ok(offen.request.tags.some((t) => t[0] === "besitzer"), "mit Nachweis");
  assert.deepEqual(leseLivekitAnfrage(offen.request.tags.find((t) => t[0] === "i")![1]!), { raum: RAUM, anzahl: 4 });
});

test("B-34a: Antwort streng – derselbe Raum, genau so viele Zugänge, verschiedene Kennungen, Ablauf höchstens einen Tag", () => {
  const frage = { raum: RAUM, anzahl: 2 };
  assert.deepEqual(leseLivekitZugaenge(livekitZugaengeText(gut()), frage, JETZT), gut());
  const mit = (aenderung: Partial<LivekitZugaenge>) => livekitZugaengeText({ ...gut(), ...aenderung });
  const falsch: Array<[string, string]> = [
    ["anderer Raum", mit({ raum: "cd".repeat(16) })],
    ["zu wenige", mit({ zugaenge: gut(1).zugaenge })],
    ["zu viele", mit({ zugaenge: gut(3).zugaenge })],
    ["doppelte Kennung", mit({ zugaenge: [gut().zugaenge[0]!, { ...gut().zugaenge[1]!, kennung: gut().zugaenge[0]!.kennung }] })],
    ["Kennung kein Hex", mit({ zugaenge: [{ kennung: "x".repeat(16), token: token(1) }, gut().zugaenge[1]!] })],
    ["Token kein JWT", mit({ zugaenge: [{ kennung: "0".repeat(16), token: "kein jwt" }, gut().zugaenge[1]!] })],
    ["Token zu lang", mit({ zugaenge: [{ kennung: "0".repeat(16), token: `a.${"b".repeat(LIVEKIT_GRENZEN.tokenZeichen)}.c` }, gut().zugaenge[1]!] })],
    ["abgelaufen", mit({ bis: JETZT })],
    ["zu lange gültig", mit({ bis: JETZT + LIVEKIT_GRENZEN.hoechstensSek + 1 })],
    ["unverschlüsselt", mit({ url: "ws://knoten.example.org" })],
    ["kein JSON", "{"],
  ];
  for (const [fall, text] of falsch) assert.equal(leseLivekitZugaenge(text, frage, JETZT), null, fall);
});
