// Torrent der App (5.3b): .torrent und Magnet-Link neben freedom.html, die Auslieferung als Webseed.
// Aufruf: npx tsx scripts/mirror/torrent.mts <site-ordner> <basis-url>   (basis-url: https://…/ der Seite)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { baueTorrent } from "../../packages/protocol/src/index.ts";

const [ordner, basis] = process.argv.slice(2);
if (!ordner || !basis) {
  console.error("Aufruf: torrent.mts <site-ordner> <basis-url>");
  process.exit(1);
}
const webseed = new URL("freedom.html", basis.endsWith("/") ? basis : `${basis}/`).href;
const t = baueTorrent(readFileSync(join(ordner, "freedom.html")), "freedom.html", [webseed]);
writeFileSync(join(ordner, "freedom.torrent"), t.torrent);
writeFileSync(join(ordner, "freedom.magnet"), `${t.magnet}\n`);
console.log(t.magnet);
