// Bezugsquellen aus spiegel/quellen.json (5.3) – geprueft wie in der App: gesetzt und noch offen.
// Aufruf: npx tsx scripts/spiegel-quellen.mts [site-ordner]  ->  {"gesetzt":[{art,url}],"offen":[art]}
// Mit site-ordner kommt der Magnet-Link dieser Auslieferung dazu (5.3b, freedom.magnet von torrent.mts).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { leseQuellen } from "../packages/protocol/src/index.ts";

const pfad = new URL("../spiegel/quellen.json", import.meta.url);
const roh = JSON.parse(readFileSync(pfad, "utf8")) as { quellen: { art: string; url: string }[] };
const magnet = process.argv[2] ? join(process.argv[2], "freedom.magnet") : "";
if (magnet && existsSync(magnet)) roh.quellen.push({ art: "torrent", url: readFileSync(magnet, "utf8").trim() });
console.log(JSON.stringify(leseQuellen(roh)));
