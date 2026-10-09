/**
 * Selbstprüfung von der Kommandozeile (Schritt 8.2a): `npm run pruefen` im
 * Ordner `packages/node`, mit derselben Umgebung wie der Knoten. Der
 * Installer ruft sie am Ende auf. Endet mit 1, wenn etwas fehlt, womit der
 * Knoten nicht verdienen kann.
 */
import { DEFAULT_MAINNET_RPCS, RpcPool } from "@freedomstack/protocol";
import { befundeText, holeJson, kettenBlick, pruefeEinrichtung } from "./einrichtung.js";
import { kanalKasseAusUmgebung, kanalOrte } from "./kanal-kasse.js";
import { leseStand, leseWuensche, modellDatei, ollamaTags, wunschDatei } from "./modell-laden.js";
import { modellBefundeText, providerModelle, pruefeModelle } from "./modell-pruefung.js";

const rpcUrl = process.env.SOLANA_RPC_URL || new RpcPool(DEFAULT_MAINNET_RPCS).bestUrl();
const kanal = await kanalKasseAusUmgebung(process.env, { rpcUrl, ...kanalOrte() });
const befunde = await pruefeEinrichtung(process.env, { holen: (u) => holeJson(u), kanal, kette: await kettenBlick(rpcUrl).catch(() => undefined) });
console.log(befundeText(befunde));
// Modelle (E9-3b): wie der Knoten sie anbieten würde – Ollama gefragt, gemerkte Prüfungen und Wünsche gelesen
const modelle = pruefeModelle({
  angeboten: providerModelle(process.env), stand: leseStand(modellDatei()), wuensche: leseWuensche(wunschDatei()),
  ollama: await ollamaTags(process.env.OLLAMA_URL ?? "http://localhost:11434").catch(() => null),
});
if (modelle.length) console.log(modellBefundeText(modelle));
process.exit(befunde.some((b) => b.stufe === "fehler") ? 1 : 0);
