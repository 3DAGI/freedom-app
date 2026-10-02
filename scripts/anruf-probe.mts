// Anruf für Browser-Prüfungen (seit B-13d3): ein Angebot eines Wegwerf-Kontakts an den eigenen Schlüssel, nur
// Relay-Kandidat, mit kurzlebigem Zugang zu einem erfundenen Vermittler (T3 B, `turn.example` – erreicht wird
// nichts) – nur für smoke_test.py, nie für ein echtes Relay. Zweiter Aufruf: einen Umschlag der App an den
// Anrufer öffnen (der Wegwerfschlüssel steht dafür in der Ausgabe – er gilt nur für diesen Test).
// Aufruf: npx tsx scripts/anruf-probe.mts <eigener Schlüssel hex>
//   ->  {"anrufer": "<hex>", "sk": "<hex>", "kennung": "<hex>", "events": [<Umschlag>]}
//         npx tsx scripts/anruf-probe.mts oeffne <sk hex>  (Umschlag als JSON auf stdin)
//   ->  {"von": "<hex>", "nachricht": {...}} oder null
import { readFileSync } from "node:fs";
import { LocalSigner, baueAnrufNachricht, generateKeypair, neueAnrufKennung, oeffneAnrufNachricht } from "../packages/protocol/src/index.ts";

if (process.argv[2] === "oeffne") {
  const sk = process.argv[3] ?? "";
  if (!/^[0-9a-f]{64}$/.test(sk)) throw new Error("Schlüssel fehlt");
  const r = await oeffneAnrufNachricht(JSON.parse(readFileSync(0, "utf8")), new LocalSigner(Uint8Array.from(Buffer.from(sk, "hex"))));
  console.log(JSON.stringify(r));
} else {
  const ich = process.argv[2] ?? "";
  if (!/^[0-9a-f]{64}$/.test(ich)) throw new Error("eigener Schlüssel fehlt");
  const jetzt = Math.floor(Date.now() / 1000);
  const anrufer = generateKeypair();
  const fp = Array.from({ length: 32 }, (_, i) => (i * 11 % 256).toString(16).toUpperCase().padStart(2, "0")).join(":");
  const sdp = [
    "v=0", "o=- 4611731400430051336 2 IN IP4 127.0.0.1", "s=-", "t=0 0", "a=group:BUNDLE 0", "m=audio 9 UDP/TLS/RTP/SAVPF 111", "c=IN IP4 0.0.0.0",
    "a=candidate:842163049 1 udp 41885439 203.0.113.7 50001 typ relay raddr 0.0.0.0 rport 0 generation 0",
    "a=ice-ufrag:abcd", "a=ice-pwd:abcdefghijklmnopqrstuvwx", `a=fingerprint:sha-256 ${fp}`, "a=setup:actpass", "a=mid:0", "a=sendrecv",
    "a=rtpmap:111 opus/48000/2", "",
  ].join("\r\n");
  const bis = jetzt + 600;
  const kennung = neueAnrufKennung();
  const events = await baueAnrufNachricht({
    von: new LocalSigner(anrufer.sk), an: [ich], nowSecs: jetzt,
    nachricht: { anruf: kennung, typ: "angebot", sdp, medien: ["audio"], turn: { urls: ["turn:turn.example:3478"], nutzer: `${bis}:probe-zugang`, passwort: "A".repeat(27) + "=", bis } },
  });
  console.log(JSON.stringify({ anrufer: anrufer.pk, sk: Buffer.from(anrufer.sk).toString("hex"), kennung, events }));
}
