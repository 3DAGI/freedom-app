/**
 * Knoten mit dem Besitzer koppeln (Sammlung B-8b): `npm run koppeln` im Ordner
 * `packages/node`, mit derselben Umgebung wie der Knoten. Zeigt den
 * Kopplungscode als QR und als Text – beim ersten Mal neu erzeugt. Mit
 * `npm run koppeln -- --neu` entsteht ein neues Geheimnis; bisher gekoppelte
 * Geräte gelten dann nicht mehr als Besitzer. Der Code ist ein Schlüssel:
 * nur dem eigenen Gerät zeigen.
 */
import { kopplungscode } from "@freedomstack/protocol";
import { erneuereKopplung, kopplungImTerminal, kopplungsDatei, leseKopplung } from "./kopplung-datei.js";
import { SchluesselFehler, knotenSchluesselDatei, ladeKnotenSchluessel } from "./knoten-schluessel.js";

// Derselbe Schlüssel wie der Knoten (B-40): NODE_SECRET_KEY oder ~/.freedom/node-key – hier nie neu anlegen
let knoten: string;
try {
  knoten = ladeKnotenSchluessel(process.env.NODE_SECRET_KEY, knotenSchluesselDatei(), { anlegen: false }).pk;
} catch (e) {
  console.error(e instanceof SchluesselFehler ? e.message : "Schlüssel des Knotens nicht lesbar – mit derselben Umgebung wie der Knoten aufrufen.");
  process.exit(1);
}
const datei = kopplungsDatei();
const neu = process.argv.includes("--neu");
const k = (!neu && leseKopplung(datei, knoten)) || erneuereKopplung(datei, knoten);
console.log(kopplungImTerminal(k));
console.log("");
console.log(kopplungscode(k));
console.log("");
console.log(neu ? "Neues Geheimnis – bisher gekoppelte Geräte gelten nicht mehr als Besitzer." : `Gemerkt in ${datei}.`);
console.log("Nur dem eigenen Gerät zeigen: In der App unter „Mein Knoten koppeln“ scannen oder einfügen.");
