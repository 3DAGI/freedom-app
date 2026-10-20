// Mein Knoten für Browser-Prüfungen der Projekte-Seite (VKe): ein Wegwerf-Knoten, der Code-Aufträge (5080) so beantwortet
// wie `handleCode` im Knoten – versiegelt an den Sitzungsschlüssel, nur mit Besitzer-Nachweis. Ein Lauf hat genau einen
// Schritt, der auf Freigabe wartet; erst nach „ja“ kommen Ausgabe und Ergebnis. Nur für smoke_test.py, nie für ein echtes
// Relay. Verlauf, Änderungen und Zurück (VKe2) mit einem Commit, die Vorschau (VKg1b) mit fester Adresse. Seit VKg2b auch der
// Zugang zum TURN (5079, aus PROBE_TURN und PROBE_TURN_SECRET) und das Bild: `bild` nur, wenn PROBE_BILD_ANTWORT auf eine Datei mit
// der Antwort zeigt (sonst bleibt der Auftrag offen), `bild-ende` mit ok. Aufruf:
//   npx tsx scripts/knoten-code-probe.mts                       -> {"knoten": "<hex>", "sk": "<hex>", "geheimnis": "<hex>"}
//   npx tsx scripts/knoten-code-probe.mts antworte <sk> <geheimnis>   (alle Umschläge an den Knoten als JSON auf stdin)
//     -> [{"fuer": "<Id des Umschlags>", "aktion": "<Aktion>", "events": [<Umschlag>…]}]   – je Auftrag die Antworten, so oft gefragt, wie es ihn gibt
//   npx tsx scripts/knoten-code-probe.mts angebot <sk> <geheimnis>    (dieselben Umschläge) -> [{"fuer": …, "sdp": "<Angebot der App>"}]
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  KIND_DVM_KNOTEN_CODE, KIND_DVM_TURN, LocalSigner, buildEvent, buildJobResult, buildPrivateJobResponse, codeAntwortText, codeSchrittText,
  generateKeypair, istBesitzer, leseCodeAuftrag, openPrivateKundenEvent, signEvent, turnZugangText, type CodeAntwort, type NostrEvent,
} from "../packages/protocol/src/index.ts";

if (process.argv[2] !== "antworte" && process.argv[2] !== "angebot") {
  const k = generateKeypair();
  console.log(JSON.stringify({ knoten: k.pk, sk: Buffer.from(k.sk).toString("hex"), geheimnis: randomBytes(32).toString("hex") }));
} else {
  const sk = Uint8Array.from(Buffer.from(process.argv[3] ?? "", "hex"));
  const geheimnis = process.argv[4] ?? "";
  if (sk.length !== 32 || !/^[0-9a-f]{64}$/.test(geheimnis)) throw new Error("Schlüssel oder Geheimnis fehlt");
  const knoten = new LocalSigner(sk);
  const pk = knoten.publicKey();
  const jetzt = Math.floor(Date.now() / 1000);
  const umschlaege = JSON.parse(readFileSync(0, "utf8")) as NostrEvent[];
  const offen = [];
  for (const w of umschlaege) {
    const o = await openPrivateKundenEvent(w, knoten);
    if (o.ok && (o.request.kind === KIND_DVM_KNOTEN_CODE || o.request.kind === KIND_DVM_TURN) && istBesitzer(o.request as NostrEvent, [geheimnis], jetzt)) {
      offen.push({ w, r: o.request as NostrEvent });
    }
  }
  if (process.argv[2] === "angebot") {
    console.log(JSON.stringify(offen.flatMap(({ w, r }) => { const a = leseCodeAuftrag(r); return a?.aktion === "bild" ? [{ fuer: w.id, sdp: a.sdp }] : []; })));
    process.exit(0);
  }
  const versiegelt = (ev: ReturnType<typeof buildEvent>, an: NostrEvent) =>
    buildPrivateJobResponse({ response: signEvent(ev, sk), providerSigner: knoten, sessionPk: an.pubkey }).then((x) => x.wrap);
  const ergebnis = (an: NostrEvent, a: CodeAntwort) => versiegelt(buildJobResult({
    providerPubkey: pk, requestId: an.id, requestKind: an.kind, customerPubkey: an.pubkey, output: codeAntwortText(a), amountMsat: 0,
  }), an);
  const schritt = (an: NostrEvent, s: Parameters<typeof codeSchrittText>[0]) =>
    versiegelt(buildEvent(pk, 7000, [["e", an.id], ["p", an.pubkey], ["status", "partial"]], codeSchrittText(s)), an);
  const aus = [];
  for (const { w, r } of offen) {
    if (r.kind === KIND_DVM_TURN) {
      // TURN-REST wie der Knoten (turn.ts): Nutzer <Ablauf>:<Zufall>, Passwort HMAC-SHA1 mit dem Geheimnis von coturn
      const bis = jetzt + 600, nutzer = `${bis}:${randomBytes(9).toString("base64url")}`;
      const passwort = createHmac("sha1", process.env.PROBE_TURN_SECRET ?? "").update(nutzer).digest("base64");
      const text = turnZugangText({ urls: [process.env.PROBE_TURN ?? ""], nutzer, passwort, bis });
      aus.push({ fuer: w.id, aktion: "turn", events: [await versiegelt(buildJobResult({
        providerPubkey: pk, requestId: r.id, requestKind: r.kind, customerPubkey: r.pubkey, output: text, amountMsat: 0,
      }), r)] });
      continue;
    }
    const a = leseCodeAuftrag(r);
    if (!a) continue;
    const datei = process.env.PROBE_BILD_ANTWORT ?? "";
    if (a.aktion === "bild" && !(datei && existsSync(datei))) continue;
    const events: NostrEvent[] = [];
    if (a.aktion === "liste") events.push(await ergebnis(r, { aktion: "liste", projekte: [{ name: "app", schritte: 1, geaendert: jetzt }] }));
    else if (a.aktion === "neu") events.push(await ergebnis(r, { aktion: "neu", projekt: a.projekt }));
    else if (a.aktion === "auftrag") events.push(await schritt(r, { nr: 1, art: "befehl", gedanke: "Ich lege index.html an.", befehl: "echo hallo > index.html", wartet: true }));
    else if (a.aktion === "freigabe") {
      const lauf = offen.find((x) => x.r.id === a.lauf)?.r;
      events.push(await ergebnis(r, { aktion: "freigabe", ok: !!lauf && a.schritt === 1 }));
      if (lauf && a.schritt === 1) {
        events.push(await schritt(lauf, { nr: 1, art: "ausgabe", ausgabe: a.ja ? "hallo" : "abgelehnt", code: a.ja ? 0 : 1, gekuerzt: false }));
        events.push(await ergebnis(lauf, { aktion: "auftrag", ende: "fertig", schritte: 1, abschluss: a.ja ? "Fertig: **index.html** angelegt." : "Nichts geändert." }));
      }
    } else if (a.aktion === "stopp") events.push(await ergebnis(r, { aktion: "stopp", ok: false }));
    else if (a.aktion === "verlauf") events.push(await ergebnis(r, { aktion: "verlauf", commits: [{ id: "1a".repeat(20), nachricht: "Schritt 1", zeit: jetzt, dateien: 1 }] }));
    else if (a.aktion === "diff") {
      const text = [`From ${a.commit} Mon Sep 17 00:00:00 2001`, "From: Freedom-Agent <agent@knoten.invalid>", "Subject: [PATCH] Schritt 1", "", "---",
        " index.html | 1 +", "", "diff --git a/index.html b/index.html", "new file mode 100644", "--- /dev/null", "+++ b/index.html", "@@ -0,0 +1 @@", "+hallo", ""].join("\n");
      events.push(await ergebnis(r, { aktion: "diff", commit: a.commit, text, gekuerzt: false }));
    } else if (a.aktion === "zurueck") events.push(await ergebnis(r, { aktion: "zurueck", commit: "2b".repeat(20) }));
    else if (a.aktion === "vorschau") events.push(await ergebnis(r, { aktion: "vorschau", url: `http://192.168.1.20:3603/${"5c".repeat(32)}/` }));
    else if (a.aktion === "bild") events.push(await ergebnis(r, { aktion: "bild", sdp: readFileSync(datei, "utf8") }));
    else if (a.aktion === "bild-ende") events.push(await ergebnis(r, { aktion: "bild-ende", ok: true }));
    aus.push({ fuer: w.id, aktion: a.aktion, events });
  }
  console.log(JSON.stringify(aus));
}
