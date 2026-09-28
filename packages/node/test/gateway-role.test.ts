/**
 * Schritt 7.4b2, Abnahme: KI über ein Funk-Gateway gegen den echten
 * `DvmProvider`. Ein simulierter Funkkanal (Pakete ≤ 200 Byte, Verzögerung,
 * Verlust, Dubletten) verbindet die Kundin ohne Netz mit dem Gateway; das
 * Gateway reicht nur Umschläge weiter, fordert Lücken nach und funkt die kurze
 * Antwort in der Sendezeit zurück. Dazu die TCP-Brücke zum Funkgerät.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import {
  FUNK_MAX_ZEICHEN, LaengenRahmen, mitLaenge, KIND_DVM_FEEDBACK, KIND_DVM_TEXT_GENERATION, LORA_MTU, LocalSigner, MemoryRelay, MeshKind,
  MeshPriority, OutboxPool, Reassembler, Sendegedaechtnis, Sendezeitkonto, baueNachforderung, baueWeiterleitung,
  buildJobRequest, buildPrivateJobRequest, fragment, giftWrapMitSigner, generateKeypair, kurzParam, leseNachforderung, messageId,
  openPrivateJobResponse, parseFrame, parseJobResult, type NostrEvent,
} from "@freedomstack/protocol";
import { DvmProvider } from "../src/dvm-provider.js";
import { GatewayRolle, funkBruecke } from "../src/gateway-role.js";
import type { InferenceBackend, InferenceRequest, InferenceResult } from "../src/inference.js";

class LangesBackend implements InferenceBackend {
  name(): string { return "lang"; }
  async available(): Promise<boolean> { return true; }
  async complete(req: InferenceRequest): Promise<InferenceResult> {
    req.onProgress?.("tool:web_search");
    return { output: "Wasser sprudelnd abkochen, dann abkühlen lassen. ".repeat(60), model: "lang", promptTokens: 1, completionTokens: 900, durationMs: 1 };
  }
}

const bytes = (ev: NostrEvent) => new TextEncoder().encode(JSON.stringify(ev));

/** Post des Providers an eine Sitzung – versiegelt, mit Zeitstempel ohne Streuung wie jede Antwort. */
async function postAn(providerSk: Uint8Array, an: string, nowSecs: number, inhalt: string): Promise<NostrEvent> {
  const p = new LocalSigner(providerSk);
  const kern = { pubkey: p.publicKey(), kind: KIND_DVM_TEXT_GENERATION + 1000, created_at: nowSecs, tags: [["p", an]], content: inhalt };
  return giftWrapMitSigner(kern, p, an, { fixedJitter: 0, nowSecs });
}
const leer = () => new Promise((r) => setImmediate(r));

/**
 * Die Seite ohne Netz (wie der Funkknoten der App): zerlegt, merkt, setzt
 * zusammen, fordert nach. `verlust` wählt Rahmen, die beim ersten Mal fehlen.
 */
function kundin() {
  const sammler = new Reassembler();
  const gedaechtnis = new Sendegedaechtnis();
  const angekommen: Uint8Array[] = [];
  return {
    sammler, gedaechtnis, angekommen,
    zerlege(payload: Uint8Array): Uint8Array[] {
      const frames = fragment(payload, MeshKind.NostrEvent, MeshPriority.Nachricht);
      gedaechtnis.merke(messageId(payload), frames);
      return frames;
    },
    empfange(raw: Uint8Array, now: number): Uint8Array[] {
      assert.ok(raw.length <= LORA_MTU, `Rahmen mit ${raw.length} Byte`);
      const st = sammler.add(raw, now);
      if (!st?.payload) return [];
      const n = leseNachforderung(st.payload);
      if (n) return gedaechtnis.nachsenden(n, now);
      angekommen.push(st.payload);
      return [];
    },
  };
}

async function aufbau() {
  const relay = new MemoryRelay(`mem://gateway-${Math.random()}`);
  const pool = new OutboxPool([relay], { minAcks: 1 });
  const kp = generateKeypair();
  const provider = new DvmProvider({
    keypair: kp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "s",
    privatePowBits: 8, freeTierUntil: Math.floor(Date.now() / 1000) + 3600,
  }, pool, new LangesBackend());
  // Simulierte Uhr: Warten (Sendetakt, Sendezeit) lässt nur die Zeit laufen
  const uhr = { t: Math.floor(Date.now() / 1000) };
  const konto = new Sendezeitkonto();
  const inDieLuft: Uint8Array[] = [];
  const gateway = new GatewayRolle({
    strecke: { async send(f) { inDieLuft.push(f); }, async close() { /* nichts */ } },
    gateway: new LocalSigner(kp.sk), netz: pool, konto,
    jetzt: () => uhr.t, schlafe: async (ms) => { uhr.t += ms / 1000; }, log: () => {},
  });
  return { relay, pool, kp, provider, uhr, konto, inDieLuft, gateway };
}

test("7.4b2 Abnahme: Auftrag über Funk, Antwort vom echten Provider gekürzt zurück – mit Verlust, Dubletten, in der Sendezeit", async () => {
  const { relay, kp, provider, uhr, konto, inDieLuft, gateway } = await aufbau();
  const sitzung = new LocalSigner(generateKeypair().sk);
  const k = kundin();

  const { wrap: weiter } = await baueWeiterleitung({ sitzung, gatewayPk: kp.pk, nowSecs: uhr.t });
  const request = buildJobRequest({ customerPubkey: sitzung.publicKey(), input: "Wie reinige ich Wasser?", bidMsat: 0, providerPubkey: kp.pk, params: [kurzParam()] });
  const { wrap: auftrag } = await buildPrivateJobRequest({ request, sessionSigner: sitzung, providerPk: kp.pk, powBits: 8 });

  // Hin: Weiterleitung, dann Auftrag – Reihenfolge verdreht, Rahmen 2 fehlt, Rahmen 0 doppelt
  const rahmen = [...k.zerlege(bytes(weiter)), ...k.zerlege(bytes(auftrag))];
  const auftragsRahmen = fragment(bytes(auftrag), MeshKind.NostrEvent);
  assert.ok(auftragsRahmen.length >= 4);
  for (const f of [...rahmen].reverse()) if (f !== rahmen[rahmen.length - auftragsRahmen.length + 2]) await gateway.empfange(f);
  await gateway.empfange(rahmen[0]);
  assert.equal((await relay.query({ kinds: [1059], "#p": [kp.pk] })).length, 0, "unvollständig: noch nichts im Netz, die Weiterleitung nie");

  // Das Gateway fordert nach 20 s Ruhe genau die Lücke nach, die Kundin sendet sie nach
  uhr.t += 20;
  assert.equal(gateway.fordereNach(), 1);
  await gateway.pump();
  const nachforderung = inDieLuft.splice(0);
  assert.equal(nachforderung.length, 1, "eine Nachforderung, ein Rahmen");
  const nach = nachforderung.flatMap((f) => k.empfange(f, uhr.t));
  assert.equal(nach.length, 1);
  for (const f of nach) await gateway.empfange(f);
  const imNetz = await relay.query({ kinds: [1059], "#p": [kp.pk] });
  assert.deepEqual(imNetz.map((e) => e.id), [auftrag.id], "genau der Auftrag – die Weiterleitung bleibt beim Gateway");

  // Der echte Provider antwortet übers Netz; das Gateway funkt zurück (ein Rahmen geht verloren)
  assert.equal((await provider.pollOnce()).length, 1);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(await gateway.holePost(), 1, "nur das Ergebnis – keine Zwischenstände");
  await gateway.pump();
  const antwort = inDieLuft.splice(0);
  assert.ok(antwort.length >= 3 && antwort.length <= 20, `${antwort.length} Rahmen`);
  for (const [i, f] of antwort.entries()) if (i !== 1) k.empfange(f, uhr.t);
  assert.equal(k.angekommen.length, 0);
  uhr.t += 20;
  const [luecke] = k.sammler.faelligeNachforderungen(uhr.t);
  for (const f of fragment(baueNachforderung(luecke.msgId, luecke.fehlend), MeshKind.NostrEvent, luecke.priority)) await gateway.empfange(f);
  await gateway.pump();
  for (const f of inDieLuft.splice(0)) k.empfange(f, uhr.t);
  assert.equal(k.angekommen.length, 1, "vollständig");

  const offen = await openPrivateJobResponse(JSON.parse(new TextDecoder().decode(k.angekommen[0])), sitzung);
  assert.ok(offen.ok);
  assert.equal(offen.response.kind, KIND_DVM_TEXT_GENERATION + 1000);
  const text = parseJobResult(offen.response).output;
  assert.ok([...text].length <= FUNK_MAX_ZEICHEN && text.endsWith("…"), "gekürzt");
  // Sendezeit des Gateways: Nachforderung, Antwort (zweimal verschlüsselt rund
  // 3 KB) und ein nachgesendeter Rahmen passen in die 36 s einer Stunde – mit
  // Luft für eine zweite Antwort, nicht für viele
  const verbraucht = konto.budget - konto.frei(uhr.t);
  assert.ok(verbraucht > 5 && verbraucht < 18, `${verbraucht} s Sendezeit`);
  assert.ok((await relay.query({ kinds: [1059], "#p": [sitzung.publicKey()] })).length >= 1);

  // Kein zweites Mal: dieselbe Post wird nicht noch einmal gefunkt
  assert.equal(await gateway.holePost(), 0);
});

test("7.4b2: zurück nur für gemerkte Sitzungen und nur Neues – fremde Post, alte Antworten, falsche Aufträge bleiben im Netz", async () => {
  const { relay, pool, kp, uhr, inDieLuft, gateway } = await aufbau();
  const sitzung = new LocalSigner(generateKeypair().sk);
  const fremd = new LocalSigner(generateKeypair().sk);
  const antwortAn = (an: LocalSigner, nowSecs: number) => postAn(kp.sk, an.publicKey(), nowSecs, "x");
  // Ohne Weiterleitung geht nichts zurück
  await pool.publish(await antwortAn(sitzung, uhr.t));
  assert.equal(await gateway.holePost(), 0);

  // Weiterleitung von einem anderen Schlüssel als dem der Sitzung: ungültig, nie im Netz
  const alt = await antwortAn(sitzung, uhr.t - 3600);
  await pool.publish(alt);
  const { wrap: fremdeWeiterleitung } = await baueWeiterleitung({ sitzung: fremd, gatewayPk: generateKeypair().pk, nowSecs: uhr.t });
  for (const f of fragment(bytes(fremdeWeiterleitung), MeshKind.NostrEvent)) await gateway.empfange(f);
  const { wrap: weiter } = await baueWeiterleitung({ sitzung, gatewayPk: kp.pk, nowSecs: uhr.t });
  for (const f of fragment(bytes(weiter), MeshKind.NostrEvent)) await gateway.empfange(f);
  assert.equal((await relay.query({ kinds: [1059], "#p": [kp.pk] })).length, 0, "Weiterleitungen nie ins Netz");
  // Die fremde Weiterleitung (an ein anderes Gateway) ging als gewöhnlicher Umschlag ins Netz – das ist ihr Ziel
  assert.equal((await relay.query({ ids: [fremdeWeiterleitung.id] })).length, 1);

  await pool.publish(await antwortAn(fremd, uhr.t));
  const neu = await antwortAn(sitzung, uhr.t + 5);
  await pool.publish(neu);
  // Nur die neue Post der gemerkten Sitzung: nicht die fremde, nicht die von vor einer Stunde
  assert.equal(await gateway.holePost(), 2, "die beiden seit der Weiterleitung");
  await gateway.pump();
  const r = new Reassembler();
  const ids = inDieLuft.flatMap((f) => { const p = r.add(f, uhr.t)?.payload; return p ? [JSON.parse(new TextDecoder().decode(p)).id] : []; });
  assert.ok(ids.includes(neu.id) && !ids.includes(alt.id));
  assert.ok(inDieLuft.every((f) => parseFrame(f).kind === MeshKind.NostrEvent));

  // Kaputtes und Klartext kommen nicht ins Netz
  for (const f of fragment(new TextEncoder().encode("Hilfe am Bahnhof"), MeshKind.PlainText)) await gateway.empfange(f);
  assert.equal((await relay.query({ kinds: [1059] })).length, 5);
});

test("7.4b2: Sendezeit – über Funk in keiner Stunde mehr als 36 s, auch bei viel Post", async () => {
  const { pool, kp, uhr, konto } = await aufbau();
  // Eigene Strecke, die mitschreibt, wann was in die Luft ging
  const gesendet: { t: number; sek: number }[] = [];
  const gateway = new GatewayRolle({
    strecke: { async send(f) { gesendet.push({ t: uhr.t, sek: f.length / 200 }); }, async close() { /* nichts */ } },
    gateway: new LocalSigner(kp.sk), netz: pool, konto,
    jetzt: () => uhr.t, schlafe: async (ms) => { uhr.t += ms / 1000; }, log: () => {},
  });
  for (let i = 0; i < 5; i++) {
    const s = new LocalSigner(generateKeypair().sk);
    const { wrap } = await baueWeiterleitung({ sitzung: s, gatewayPk: kp.pk, nowSecs: uhr.t });
    for (const f of fragment(bytes(wrap), MeshKind.NostrEvent)) await gateway.empfange(f);
    await pool.publish(await postAn(kp.sk, s.publicKey(), uhr.t, "y".repeat(2000)));
  }
  assert.equal(await gateway.holePost(), 5);
  await gateway.pump();
  const summe = gesendet.reduce((x, g) => x + g.sek, 0);
  assert.ok(summe > 3 * 36, `genug Post für mehrere Stunden: ${summe} s`);
  for (const g of gesendet) {
    const stunde = gesendet.filter((h) => h.t >= g.t && h.t < g.t + 3600).reduce((x, h) => x + h.sek, 0);
    assert.ok(stunde <= 36 + 1e-9, `${stunde} s ab ${g.t - gesendet[0].t} s`);
  }
});

test("7.4b2: TCP-Brücke – Längenpräfix, zerstückelter Strom, verschobene Bytes, Rahmen in beide Richtungen", async () => {
  // LaengenRahmen allein: zerstückelt, null und zu lang überspringen
  const l = new LaengenRahmen();
  const a = new Uint8Array(150).fill(7);
  const b = new Uint8Array(12).fill(9);
  const strom = Uint8Array.from([0, 0, 0xff, 0xff, ...mitLaenge(a), ...mitLaenge(b)]);
  const raus = [...l.push(strom.subarray(0, 3)), ...l.push(strom.subarray(3, 80)), ...l.push(strom.subarray(80))];
  assert.deepEqual(raus, [a, b]);
  assert.throws(() => mitLaenge(new Uint8Array(LORA_MTU + 1)), /passt nicht/);
  assert.throws(() => mitLaenge(new Uint8Array(0)), /passt nicht/);
  assert.throws(() => funkBruecke("keinport", () => {}), /host:port/);
  assert.throws(() => funkBruecke("127.0.0.1:70000", () => {}), /host:port/);

  // Ein „Funkgerät“ hinter socat: nimmt Rahmen an und sendet selbst welche
  const beimGeraet: Uint8Array[] = [];
  let verbunden: net.Socket | undefined;
  const server = net.createServer((s) => {
    verbunden = s;
    const leser = new LaengenRahmen();
    s.on("data", (d: Buffer) => beimGeraet.push(...leser.push(new Uint8Array(d))));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as net.AddressInfo).port;
  const empfangen: Uint8Array[] = [];
  const bruecke = funkBruecke(`127.0.0.1:${port}`, (f) => empfangen.push(f), () => {});
  while (!verbunden) await leer();
  await new Promise((r) => setTimeout(r, 20));
  await bruecke.send(a);
  const x = mitLaenge(b);
  verbunden.write(x.subarray(0, 1));
  await new Promise((r) => setTimeout(r, 20));
  verbunden.write(x.subarray(1));
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(beimGeraet, [a]);
  assert.deepEqual(empfangen, [b]);
  await bruecke.close();
  await assert.rejects(bruecke.send(a), /getrennt/);
  await new Promise<void>((r) => server.close(() => r()));
});
