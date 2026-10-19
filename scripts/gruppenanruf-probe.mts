// Mein Knoten für die Browser-Prüfung der Gruppenanrufe (B-34d): ein Wegwerf-Knoten, der Zugänge zum Gruppenanruf (5081) und
// zum eigenen Vermittler (5079) so beantwortet wie `handleLivekit`/`handleTurn` im Knoten – versiegelt an den
// Sitzungsschlüssel, nur mit Besitzer-Nachweis. Seit B-34e2 auch den Status (5077, mit der Rolle „signal“) und die
// Weiterleitung des Signals (5082, `handleSignal`); `relayliste` ist seine Relay-Liste (10002) mit `wss://<name>.probe.test`.
// Der SFU (`wss://sfu.probe.test`) ist nur eine Adresse: Die Relay-Attrappe nimmt die Verbindung an und schließt sie. Nur für
// smoke_test.py, nie für ein echtes Relay. Aufruf:
//   npx tsx scripts/gruppenanruf-probe.mts [name]                   -> {"knoten": "<hex>", "sk": "<hex>", "geheimnis": "<hex>", "relayliste": <Event>}
//   npx tsx scripts/gruppenanruf-probe.mts antworte <sk> <geheimnis>   (alle Umschläge an den Knoten als JSON auf stdin)
//     -> [{"fuer": "<Id des Umschlags>", "kind": 5081|5079|5077|5082, "events": [<Umschlag>]}]
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  KIND_DVM_KNOTEN_STATUS, KIND_DVM_LIVEKIT, KIND_DVM_SIGNAL, KIND_DVM_TURN, KIND_RELAY_LIST, LocalSigner, buildEvent, buildJobResult,
  buildPrivateJobResponse, generateKeypair, getTag, istBesitzer, knotenStatusText, leseLivekitAnfrage, leseSignalAnfrage, livekitZugaengeText,
  openPrivateKundenEvent, signEvent, signalZugangText, turnZugangText, type NostrEvent,
} from "../packages/protocol/src/index.ts";

const b64url = (s: string) => Buffer.from(s).toString("base64url");

if (process.argv[2] !== "antworte") {
  const k = generateKeypair();
  const name = /^[a-z0-9-]{1,30}$/.test(process.argv[2] ?? "") ? process.argv[2] : "knoten";
  const relayliste = signEvent(buildEvent(k.pk, KIND_RELAY_LIST, [["r", `wss://${name}.probe.test`]], ""), k.sk);
  console.log(JSON.stringify({ knoten: k.pk, sk: Buffer.from(k.sk).toString("hex"), geheimnis: randomBytes(32).toString("hex"), relayliste }));
} else {
  const sk = Uint8Array.from(Buffer.from(process.argv[3] ?? "", "hex"));
  const geheimnis = process.argv[4] ?? "";
  if (sk.length !== 32 || !/^[0-9a-f]{64}$/.test(geheimnis)) throw new Error("Schlüssel oder Geheimnis fehlt");
  const knoten = new LocalSigner(sk);
  const pk = knoten.publicKey();
  const jetzt = Math.floor(Date.now() / 1000);
  const aus = [];
  for (const w of JSON.parse(readFileSync(0, "utf8")) as NostrEvent[]) {
    const o = await openPrivateKundenEvent(w, knoten);
    if (!o.ok || !istBesitzer(o.request as NostrEvent, [geheimnis], jetzt)) continue;
    const r = o.request as NostrEvent;
    let output: string | null = null;
    if (r.kind === KIND_DVM_LIVEKIT) {
      const a = leseLivekitAnfrage(getTag(r, "i") ?? "");
      if (!a) continue;
      const zugaenge = Array.from({ length: a.anzahl }, (_, i) => {
        const kennung = randomBytes(8).toString("hex");
        return { kennung, token: `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify({ sub: kennung, n: i }))}.${randomBytes(32).toString("base64url")}` };
      });
      output = livekitZugaengeText({ url: "wss://sfu.probe.test", raum: a.raum, bis: jetzt + 3600, zugaenge });
    } else if (r.kind === KIND_DVM_TURN) {
      output = turnZugangText({ urls: ["turns:turn.probe.test:5349"], nutzer: `${jetzt + 3600}:probe0001`, passwort: `${randomBytes(20).toString("base64").slice(0, 27)}=`, bis: jetzt + 3600 });
    } else if (r.kind === KIND_DVM_KNOTEN_STATUS) {
      output = knotenStatusText({
        fassung: "0.1.0", seit: jetzt - 60, rollen: ["relay", "turn", "livekit", "signal"], modelle: [],
        auftraege: { erledigt: 0, gratis: 0, abgelehnt: 0 }, abgerechnetMsat: 0, speicher: null, relay: { events: 0, verbindungen: 1 },
      });
    } else if (r.kind === KIND_DVM_SIGNAL) {
      const a = leseSignalAnfrage(getTag(r, "i") ?? "");
      if (!a || a.bis <= jetzt) continue;
      output = signalZugangText({ zeichen: randomBytes(32).toString("hex"), bis: Math.min(a.bis, jetzt + 86_400) });
    }
    if (output === null) continue;
    const ergebnis = signEvent(buildJobResult({ providerPubkey: pk, requestId: r.id, requestKind: r.kind, customerPubkey: r.pubkey, output, amountMsat: 0 }), sk);
    const { wrap } = await buildPrivateJobResponse({ response: ergebnis, providerSigner: knoten, sessionPk: r.pubkey });
    aus.push({ fuer: w.id, kind: r.kind, events: [wrap] });
  }
  console.log(JSON.stringify(aus));
}
