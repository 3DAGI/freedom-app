/**
 * Selbstprüfung von der Kommandozeile (Schritt 8.2a): `npm run pruefen` im
 * Ordner `packages/node`, mit derselben Umgebung wie der Knoten. Der
 * Installer ruft sie am Ende auf. Endet mit 1, wenn etwas fehlt, womit der
 * Knoten nicht verdienen kann.
 */
import { DEFAULT_MAINNET_RPCS, RpcPool } from "@freedomstack/protocol";
import { befundeText, holeJson, kettenBlick, pruefeEinrichtung } from "./einrichtung.js";
import { kanalKasseAusUmgebung, kanalOrte } from "./kanal-kasse.js";
import { antriebAusUmgebung, antriebModelle } from "./ki-antrieb.js";
import { leseStand, leseWuensche, modellDatei, wunschDatei } from "./modell-laden.js";
import { modellBefundeText, providerModelle, pruefeModelle } from "./modell-pruefung.js";

const rpcUrl = process.env.SOLANA_RPC_URL || new RpcPool(DEFAULT_MAINNET_RPCS).bestUrl();
const kanal = await kanalKasseAusUmgebung(process.env, { rpcUrl, ...kanalOrte() });
const befunde = await pruefeEinrichtung(process.env, { holen: (u) => holeJson(u), kanal, kette: await kettenBlick(rpcUrl).catch(() => undefined) });
console.log(befundeText(befunde));
// KI-Antrieb (B-29a): ungültig startet der Knoten nicht
const { antrieb, grund } = antriebAusUmgebung(process.env);
if (!antrieb) console.log(`✗ KI-Antrieb: ${grund}`);
// Modelle (E9-3b): wie der Knoten sie anbieten würde – den Antrieb gefragt, gemerkte Prüfungen und Wünsche gelesen
const modelle = antrieb ? pruefeModelle({
  angeboten: providerModelle(process.env), stand: leseStand(modellDatei()), wuensche: leseWuensche(wunschDatei()),
  ollama: await antriebModelle(antrieb).catch(() => null), antrieb: antrieb.art,
}) : [];
if (modelle.length) console.log(modellBefundeText(modelle));
process.exit(!antrieb || befunde.some((b) => b.stufe === "fehler") ? 1 : 0);
