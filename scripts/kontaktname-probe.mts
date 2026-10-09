// Namen von Kontakten für Browser-Prüfungen (seit C-33): Ein Fremder mit veröffentlichtem Profil (Kind 0)
// schreibt eine versiegelte Direktnachricht (NIP-17). Der Name trägt HTML – die App darf es nur als Text
// zeigen. Signiert mit Wegwerfschlüsseln; nur für smoke_test.py, nie für ein echtes Relay.
// Aufruf: npx tsx scripts/kontaktname-probe.mts <eigener Schlüssel hex>
//   ->  {"absender": "<hex>", "name": "...", "events": [...]}
import { buildPrivateDm, buildProfile, generateKeypair, signEvent } from "../packages/protocol/src/index.ts";

const ich = process.argv[2] ?? "";
if (!/^[0-9a-f]{64}$/.test(ich)) throw new Error("eigener Schlüssel fehlt");
const jetzt = Math.floor(Date.now() / 1000);
const absender = generateKeypair();
const name = "Ada <b>Probe</b>";
const dm = await buildPrivateDm({
  senderSk: absender.sk, senderPk: absender.pk, recipientPk: ich, nowSecs: jetzt - 20, content: "Hallo, kennst du mich?",
});
const events = [
  dm.toRecipient,
  // Ein älteres Profil mit anderem Namen – es gilt das neueste
  signEvent(buildProfile(absender.pk, { name: "Alt" }, jetzt - 600), absender.sk),
  signEvent(buildProfile(absender.pk, { name: "ada", display_name: name } as never, jetzt - 60), absender.sk),
];
console.log(JSON.stringify({ absender: absender.pk, name, events }));
