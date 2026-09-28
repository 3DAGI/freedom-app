/**
 * KI über ein Funk-Gateway (Schritt 7.4a): kurze Antwort auf Wunsch,
 * versiegelter Weiterleitungsauftrag, Regeln des Gateways – und die ganze
 * Strecke über einen simulierten Funkkanal (Paketgröße, Verzögerung, Verlust).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEvent, generateKeypair, type NostrEvent } from "../src/event.js";
import { LocalSigner } from "../src/signer.js";
import { buildJobRequest } from "../src/dvm.js";
import { buildPrivateJobRequest, buildPrivateJobResponse, openPrivateJobRequest, openPrivateJobResponse } from "../src/private-job.js";
import { MemoryRelay } from "../src/outbox.js";
import {
  LORA_MTU, MeshKind, MeshPriority, Reassembler, SENDEZEIT_ANTEIL, SENDEZEIT_FENSTER_SEKUNDEN,
  fragment, luftBytes, pruefeMeshInhalt,
} from "../src/mesh-transport.js";
import { LINK_BYTES_PER_SEC } from "../src/mesh-sync.js";
import {
  FUNK_MAX_ZEICHEN, GatewayBuch, KIND_FUNK_WEITERLEITUNG, WEITERLEITUNG_MAX_ANTWORTEN, WEITERLEITUNG_MAX_OFFEN,
  baueWeiterleitung, kuerzeAntwort, kurzParam, leseKurzWunsch, oeffneWeiterleitung,
} from "../src/funk-gateway.js";

const JETZT = 1_800_000_000;
const bytes = (ev: NostrEvent) => new TextEncoder().encode(JSON.stringify(ev));

test("7.4a: kurze Antwort auf Wunsch – Parameter gedeckelt, Unbrauchbares ignoriert, gekürzt ohne zerteiltes Zeichen", () => {
  assert.deepEqual(kurzParam(), ["max_zeichen", "500"]);
  assert.deepEqual(kurzParam(200), ["max_zeichen", "200"]);
  assert.deepEqual(kurzParam(5000), ["max_zeichen", "500"], "höchstens 500");
  assert.throws(() => kurzParam(0));
  const req = (wert?: string) => ({ tags: wert === undefined ? [["i", "x", "text"]] : [["param", "max_zeichen", wert]] });
  assert.equal(leseKurzWunsch(req()), null);
  assert.equal(leseKurzWunsch(req("300")), 300);
  assert.equal(leseKurzWunsch(req("99999")), FUNK_MAX_ZEICHEN);
  for (const kaputt of ["0", "-1", "abc", "1e3", "", "1234567"]) assert.equal(leseKurzWunsch(req(kaputt)), null, kaputt);

  assert.equal(kuerzeAntwort("kurz", 10), "kurz");
  const lang = "Wort ".repeat(200);
  const k = kuerzeAntwort(lang, 500);
  assert.ok([...k].length <= 500 && k.endsWith("…"));
  const emoji = "🙂".repeat(20);
  assert.equal(kuerzeAntwort(emoji, 5), "🙂🙂🙂🙂…", "Codepunkte, kein halbes Emoji");
});

test("7.4a: Weiterleitungsauftrag – versiegelt ans Gateway, vom Sitzungsschlüssel, mit Ablauf; fremde, abgelaufene und zu lange abgelehnt", async () => {
  const sitzung = new LocalSigner(generateKeypair().sk);
  const gateway = new LocalSigner(generateKeypair().sk);
  const { wrap, weiterleitung } = await baueWeiterleitung({ sitzung, gatewayPk: gateway.publicKey(), dauerSecs: 1800, nowSecs: JETZT });
  // Über Funk geht er als Umschlag – ohne den Sitzungsschlüssel offen zu zeigen
  assert.deepEqual(pruefeMeshInhalt(bytes(wrap), MeshKind.NostrEvent), { ok: true, art: "umschlag" });
  assert.ok(!JSON.stringify(wrap).includes(sitzung.publicKey()), "Sitzung nur im versiegelten Kern");
  assert.equal(wrap.tags.find((t) => t[0] === "expiration")?.[1], String(JETZT + 1800));

  assert.deepEqual(await oeffneWeiterleitung(wrap, gateway, JETZT), weiterleitung);
  assert.equal(weiterleitung.sitzung, sitzung.publicKey());
  assert.equal(await oeffneWeiterleitung(wrap, new LocalSigner(generateKeypair().sk), JETZT), null, "anderes Gateway");
  assert.equal(await oeffneWeiterleitung(wrap, gateway, JETZT + 1800), null, "abgelaufen");
  await assert.rejects(() => baueWeiterleitung({ sitzung, gatewayPk: gateway.publicKey(), dauerSecs: 7200, nowSecs: JETZT }));
  await assert.rejects(() => baueWeiterleitung({ sitzung, gatewayPk: "zz", nowSecs: JETZT }));
  assert.equal(KIND_FUNK_WEITERLEITUNG, 25030);
});

test("7.4a: Gateway-Buch – nur Post an gemerkte, laufende Sitzungen, höchstens drei je Sitzung, keine doppelt, begrenzte Zahl", () => {
  const buch = new GatewayBuch();
  const s = generateKeypair().pk;
  assert.ok(buch.merke({ sitzung: s, bis: JETZT + 600, auftragId: "x" }, JETZT));
  assert.deepEqual(buch.offene(JETZT), [s]);
  const umschlag = (an: string, n: number) => ({ id: String(n).padStart(64, "0"), kind: 1059, tags: [["p", an]] }) as unknown as NostrEvent;
  assert.equal(buch.zurueck(umschlag(generateKeypair().pk, 1), JETZT), false, "fremde Sitzung");
  assert.equal(buch.zurueck({ ...umschlag(s, 2), kind: 1 } as NostrEvent, JETZT), false, "kein Umschlag");
  assert.equal(buch.zurueck(umschlag(s, 3), JETZT), true);
  assert.equal(buch.zurueck(umschlag(s, 3), JETZT), false, "nicht doppelt");
  for (let i = 4; i < 3 + WEITERLEITUNG_MAX_ANTWORTEN; i++) assert.equal(buch.zurueck(umschlag(s, i), JETZT), true);
  assert.equal(buch.zurueck(umschlag(s, 99), JETZT), false, "höchstens drei");
  assert.equal(buch.zurueck(umschlag(s, 100), JETZT + 600), false, "abgelaufen");
  assert.deepEqual(buch.offene(JETZT + 600), []);

  const voll = new GatewayBuch();
  for (let i = 0; i < WEITERLEITUNG_MAX_OFFEN; i++) assert.ok(voll.merke({ sitzung: generateKeypair().pk, bis: JETZT + 600, auftragId: "x" }, JETZT));
  assert.equal(voll.merke({ sitzung: generateKeypair().pk, bis: JETZT + 600, auftragId: "x" }, JETZT), false, "Buch voll");
});

/**
 * Simulierter Funkkanal: Pakete höchstens LORA_MTU groß, Verzögerung (die
 * Reihenfolge ändert sich), Verlust einzelner Pakete und Dubletten. Wer
 * etwas vermisst, fordert gezielt nach (`Reassembly.missing`).
 */
function funk(frames: Uint8Array[], opts: { verloren?: number[]; doppelt?: number[] } = {}): Uint8Array[] {
  for (const f of frames) assert.ok(f.length <= LORA_MTU, "Paketgröße");
  const unterwegs = frames.map((f, i) => ({ f, i })).filter(({ i }) => !(opts.verloren ?? []).includes(i));
  for (const i of opts.doppelt ?? []) unterwegs.push({ f: frames[i]!, i });
  // Verzögerung: rückwärts statt vorwärts – der Empfänger ordnet selbst
  return unterwegs.reverse().map(({ f }) => f);
}

function empfange(frames: Uint8Array[], alle: Uint8Array[], verloren: number[] = []): Uint8Array {
  const r = new Reassembler();
  let stand = null;
  for (const f of funk(frames, { verloren, doppelt: [0] })) stand = r.add(f, JETZT) ?? stand;
  if (!stand?.complete) {
    // Nachfordern: nur, was fehlt – danach vollständig
    assert.deepEqual(stand?.missing, verloren, "gezielt, was fehlt");
    for (const i of stand!.missing) stand = r.add(alle[i]!, JETZT) ?? stand;
  }
  assert.ok(stand?.complete && stand.payload, "vollständig");
  return stand!.payload!;
}

test("7.4a ABNAHME: KI über Funk – Auftrag und Weiterleitung hin, kurze Antwort zurück; über den Funkkanal mit Verzögerung, Verlust und Dubletten", async () => {
  const sitzung = new LocalSigner(generateKeypair().sk);
  const provider = new LocalSigner(generateKeypair().sk);
  const gateway = new LocalSigner(generateKeypair().sk);
  const relay = new MemoryRelay("wss://relay.test");

  // App (ohne Netz): versiegelter Auftrag mit kurzer Antwort + Weiterleitung ans Gateway
  const request = buildJobRequest({ customerPubkey: sitzung.publicKey(), input: "Wie reinige ich Wasser ohne Strom?", bidMsat: 5000, providerPubkey: provider.publicKey(), params: [kurzParam()] }, JETZT);
  const auftrag = await buildPrivateJobRequest({ request, sessionSigner: sitzung, providerPk: provider.publicKey(), nowSecs: JETZT });
  const weiter = await baueWeiterleitung({ sitzung, gatewayPk: gateway.publicKey(), nowSecs: JETZT });
  for (const w of [auftrag.wrap, weiter.wrap]) assert.equal(pruefeMeshInhalt(bytes(w), MeshKind.NostrEvent).ok, true);

  // Funk hin: jedes Paket höchstens LORA_MTU, eines geht verloren und wird nachgefordert
  const buch = new GatewayBuch();
  for (const w of [auftrag.wrap, weiter.wrap]) {
    const frames = fragment(bytes(w), MeshKind.NostrEvent, MeshPriority.Nachricht);
    const angekommen = JSON.parse(new TextDecoder().decode(empfange(frames, frames, frames.length > 2 ? [1] : []))) as NostrEvent;
    assert.equal(angekommen.id, w.id);
    // Gateway: erst die eigene Post öffnen, alles andere unverändert ins Netz
    const wl = await oeffneWeiterleitung(angekommen, gateway, JETZT);
    if (wl) buch.merke(wl, JETZT);
    else await relay.publish(angekommen);
  }
  assert.deepEqual(buch.offene(JETZT), [sitzung.publicKey()], "das Gateway kennt nur den Sitzungsschlüssel");

  // Provider (im Netz): öffnet, liest den Wunsch, kürzt, antwortet versiegelt ohne Zwischenstände
  const [angekommen] = await relay.query({ kinds: [1059], "#p": [provider.publicKey()] });
  const job = await openPrivateJobRequest(angekommen!, provider);
  assert.ok(job.ok);
  const max = leseKurzWunsch(job.request);
  assert.equal(max, 500);
  const antwortText = kuerzeAntwort("Wasser mindestens eine Minute sprudelnd abkochen. ".repeat(40), max!);
  const antwort = buildEvent(provider.publicKey(), 6050, [["e", job.request.id], ["p", sitzung.publicKey()]], antwortText, JETZT + 30);
  await relay.publish((await buildPrivateJobResponse({ response: antwort, providerSigner: provider, sessionPk: sitzung.publicKey(), nowSecs: JETZT + 30 })).wrap);

  // Gateway: Post an die Sitzung holen und nach den Regeln zurückfunken
  const post = (await relay.query({ kinds: [1059], "#p": buch.offene(JETZT + 30) })).filter((w) => buch.zurueck(w, JETZT + 30));
  assert.equal(post.length, 1);
  assert.equal(pruefeMeshInhalt(bytes(post[0]!), MeshKind.NostrEvent).ok, true);
  const zurueck = fragment(bytes(post[0]!), MeshKind.NostrEvent, MeshPriority.Nachricht);
  // Die kurze Antwort passt in die Sendezeit einer Stunde (1 %) – mit Luft
  const sek = luftBytes(bytes(post[0]!).length) / LINK_BYTES_PER_SEC.lora;
  assert.ok(sek < SENDEZEIT_ANTEIL * SENDEZEIT_FENSTER_SEKUNDEN, `${sek.toFixed(1)} s Sendezeit`);

  // App: empfängt über Funk (Verlust, Nachfordern), öffnet mit dem Sitzungsschlüssel
  const ankunft = JSON.parse(new TextDecoder().decode(empfange(zurueck, zurueck, [2]))) as NostrEvent;
  const offen = await openPrivateJobResponse(ankunft, sitzung);
  assert.ok(offen.ok);
  assert.equal(offen.response.content, antwortText);
  assert.ok([...offen.response.content].length <= FUNK_MAX_ZEICHEN);
});
