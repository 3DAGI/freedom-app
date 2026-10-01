/**
 * Knoten mit dem Besitzer koppeln (Sammlung B-8b): `npm run koppeln` im Ordner
 * `packages/node`, mit derselben Umgebung wie der Knoten. Zeigt den
 * Kopplungscode als QR und als Text – beim ersten Mal neu erzeugt. Mit
 * `npm run koppeln -- --neu` entsteht ein neues Geheimnis; bisher gekoppelte
 * Geräte gelten dann nicht mehr als Besitzer. Der Code ist ein Schlüssel:
 * nur dem eigenen Gerät zeigen.
 */
import { kopplungscode, toHex } from "@freedomstack/protocol";
import { schnorr } from "@noble/curves/secp256k1.js";
import { erneuereKopplung, kopplungImTerminal, kopplungsDatei, leseKopplung } from "./kopplung-datei.js";

const sk = process.env.NODE_SECRET_KEY ?? "";
if (!/^[0-9a-f]{64}$/.test(sk)) {
  console.error("NODE_SECRET_KEY fehlt oder ist ungültig – mit derselben Umgebung wie der Knoten aufrufen.");
  process.exit(1);
}
const knoten = toHex(schnorr.getPublicKey(Uint8Array.from(Buffer.from(sk, "hex"))));
const datei = kopplungsDatei();
const neu = process.argv.includes("--neu");
const k = (!neu && leseKopplung(datei, knoten)) || erneuereKopplung(datei, knoten);
console.log(kopplungImTerminal(k));
console.log("");
console.log(kopplungscode(k));
console.log("");
console.log(neu ? "Neues Geheimnis – bisher gekoppelte Geräte gelten nicht mehr als Besitzer." : `Gemerkt in ${datei}.`);
console.log("Nur dem eigenen Gerät zeigen: In der App unter „Mein Knoten koppeln“ scannen oder einfügen.");
