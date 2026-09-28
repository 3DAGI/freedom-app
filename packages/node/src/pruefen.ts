/**
 * Selbstprüfung von der Kommandozeile (Schritt 8.2a): `npm run pruefen` im
 * Ordner `packages/node`, mit derselben Umgebung wie der Knoten. Der
 * Installer ruft sie am Ende auf. Endet mit 1, wenn etwas fehlt, womit der
 * Knoten nicht verdienen kann.
 */
import { DEFAULT_MAINNET_RPCS, RpcPool } from "@freedomstack/protocol";
import { befundeText, holeJson, kettenBlick, pruefeEinrichtung } from "./einrichtung.js";
import { kanalKasseAusUmgebung, kanalOrte } from "./kanal-kasse.js";

const rpcUrl = process.env.SOLANA_RPC_URL || new RpcPool(DEFAULT_MAINNET_RPCS).bestUrl();
const kanal = await kanalKasseAusUmgebung(process.env, { rpcUrl, ...kanalOrte() });
const befunde = await pruefeEinrichtung(process.env, { holen: (u) => holeJson(u), kanal, kette: await kettenBlick(rpcUrl).catch(() => undefined) });
console.log(befundeText(befunde));
process.exit(befunde.some((b) => b.stufe === "fehler") ? 1 : 0);
