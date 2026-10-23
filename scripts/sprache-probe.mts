// Mein Knoten für die Browser-Prüfung „Als Text“ (B-38c1): ein Wegwerf-Knoten, der Statusabfragen (5077) mit der Rolle
// `sprache` beantwortet und Aufträge für Text aus Sprache (5083) wie `handleSprache` im Knoten – nur versiegelt, nur mit
// Besitzer-Nachweis, Ton über `holeVerschluesselt()` aus den Events der App, nur nach `pruefeWav()`. Statt Whisper misst er
// die Tonhöhe (Nulldurchgänge): Stimmt sie, hat der Browser richtig auf 16 kHz gewandelt. Mit PROBE_ROLLEN="" fehlt die
// Rolle. Nur für smoke_test.py, nie für ein echtes Relay. Aufruf:
//   npx tsx scripts/sprache-probe.mts                              -> {"knoten": "<hex>", "sk": "<hex>", "geheimnis": "<hex>"}
//   npx tsx scripts/sprache-probe.mts antworte <sk> <geheimnis>    (alle Events der App als JSON auf stdin)
//     -> [{"fuer": "<Id des Umschlags>", "art": "status" | "sprache", "events": [<Umschlag>]}]
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  KIND_DVM_KNOTEN_STATUS, KIND_DVM_TEXT_AUS_SPRACHE, LocalSigner, MemoryRelay, SPRACHE_GRENZEN, buildEvent, buildJobResult,
  buildPrivateJobResponse, generateKeypair, getTag, istBesitzer, knotenStatusText, leseSpracheAuftrag, openPrivateKundenEvent,
  pruefeWav, signEvent, transkriptText, type NostrEvent, type StatusRolle,
} from "../packages/protocol/src/index.ts";
import { holeVerschluesselt } from "../packages/node/src/blob-holen.ts";

/** Tonhöhe aus den Nulldurchgängen zwischen dem ersten und dem letzten – Stille am Rand zählt nicht. */
function tonhoehe(wav: Uint8Array): number {
  const d = new DataView(wav.buffer, wav.byteOffset + 44, wav.byteLength - 44);
  const wechsel: number[] = [];
  let vorher = 0;
  for (let i = 0; i < d.byteLength / 2; i++) {
    const p = d.getInt16(i * 2, true);
    const zeichen = p > 2000 ? 1 : p < -2000 ? -1 : 0;
    if (zeichen === 0) continue;
    if (vorher !== 0 && zeichen !== vorher) wechsel.push(i);
    vorher = zeichen;
  }
  if (wechsel.length < 2) return 0;
  return ((wechsel.length - 1) / 2) / ((wechsel.at(-1)! - wechsel[0]!) / SPRACHE_GRENZEN.abtastrate);
}

if (process.argv[2] !== "antworte") {
  const k = generateKeypair();
  console.log(JSON.stringify({ knoten: k.pk, sk: Buffer.from(k.sk).toString("hex"), geheimnis: randomBytes(32).toString("hex") }));
} else {
  const sk = Uint8Array.from(Buffer.from(process.argv[3] ?? "", "hex"));
  const geheimnis = process.argv[4] ?? "";
  if (sk.length !== 32 || !/^[0-9a-f]{64}$/.test(geheimnis)) throw new Error("Schlüssel oder Geheimnis fehlt");
  const knoten = new LocalSigner(sk);
  const pk = knoten.publicKey();
  const jetzt = Math.floor(Date.now() / 1000);
  const events = JSON.parse(readFileSync(0, "utf8")) as NostrEvent[];
  const netz = new MemoryRelay("mem://probe");
  for (const ev of events) await netz.publish(ev).catch(() => {});
  const versiegelt = (ev: ReturnType<typeof buildEvent>, an: NostrEvent) =>
    buildPrivateJobResponse({ response: signEvent(ev, sk), providerSigner: knoten, sessionPk: an.pubkey }).then((x) => x.wrap);
  const ergebnis = (an: NostrEvent, output: string) =>
    versiegelt(buildJobResult({ providerPubkey: pk, requestId: an.id, requestKind: an.kind, customerPubkey: an.pubkey, output, amountMsat: 0 }), an);
  const abgelehnt = (an: NostrEvent, fall: string) =>
    versiegelt(buildEvent(pk, 7000, [["e", an.id], ["p", an.pubkey], ["status", "error"], ["fall", fall]], `error: ${fall}`), an);
  const rollen = (process.env.PROBE_ROLLEN ?? "sprache").split(",").filter(Boolean) as StatusRolle[];
  const aus = [];
  for (const w of events.filter((e) => e.kind === 1059)) {
    const o = await openPrivateKundenEvent(w, knoten);
    if (!o.ok || !istBesitzer(o.request as NostrEvent, [geheimnis], jetzt)) continue;
    const r = o.request as NostrEvent;
    if (r.kind === KIND_DVM_KNOTEN_STATUS) {
      const status = knotenStatusText({
        fassung: "probe", seit: jetzt, rollen, modelle: [], auftraege: { erledigt: 0, gratis: 0, abgelehnt: 0 }, abgerechnetMsat: 0, speicher: null, relay: null,
      });
      aus.push({ fuer: w.id, art: "status", events: [await ergebnis(r, status)] });
    } else if (r.kind === KIND_DVM_TEXT_AUS_SPRACHE) {
      const a = leseSpracheAuftrag(getTag(r, "i") ?? "");
      const wav = a && await holeVerschluesselt(netz, { ...a.ton, hoechstBytes: 44 + SPRACHE_GRENZEN.sekunden * SPRACHE_GRENZEN.abtastrate * 2 });
      const geprueft = wav ? pruefeWav(wav) : null;
      const antwort = !a ? await abgelehnt(r, "sprache-auftrag") : !wav ? await abgelehnt(r, "sprache-ton") : !geprueft?.ok ? await abgelehnt(r, "sprache-wav")
        : await ergebnis(r, transkriptText({ text: `Probe: ${Math.round(tonhoehe(wav) / 10) * 10} Hz, Sprache ${a.sprache}`, sekunden: geprueft.sekunden }));
      aus.push({ fuer: w.id, art: "sprache", events: [antwort] });
    }
  }
  console.log(JSON.stringify(aus));
}
