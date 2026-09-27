// Bezugsquellen aus spiegel/quellen.json (5.3) – geprueft wie in der App: gesetzt und noch offen.
// Aufruf: npx tsx scripts/spiegel-quellen.mts  ->  {"gesetzt":[{art,url}],"offen":[art]}
import { readFileSync } from "node:fs";
import { leseQuellen } from "../packages/protocol/src/index.ts";

const pfad = new URL("../spiegel/quellen.json", import.meta.url);
console.log(JSON.stringify(leseQuellen(JSON.parse(readFileSync(pfad, "utf8")))));
