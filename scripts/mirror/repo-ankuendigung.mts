// NIP-34-Spiegel (5.9b) – im Job „spiegel“ (pages.yml): kündigt das Repository des
// Projekts als Kind 30617 an (`projektRepo()`, `baueRepoAnkuendigung()`), signiert mit
// dem Spiegel-Schlüssel, an die Startrelays. NIP-34-Clients und die App (Seite
// Repositories) finden so GitHub und – sobald in spiegel/quellen.json gesetzt – Radicle.
// Aufruf: npx tsx scripts/mirror/repo-ankuendigung.mts [--trocken]
//   --trocken: nur bauen und ausgeben, ohne Schlüssel und ohne Netz
// Umgebung: SPIEGEL_NSEC (wie Blossom), REPO_MAINTAINER (optional, Pubkeys mit Komma).
// Nur für Tests: SPIEGEL_QUELLEN ersetzt spiegel/quellen.json, SPIEGEL_RELAYS die Startrelays.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  OutboxPool, WebSocketRelay, baueRepoAnkuendigung, keypairFromSecret, projektRepo, repoAdresse, signEvent, startUrls,
} from "../../packages/protocol/src/index.ts";
import { spiegelSchluessel } from "./schluessel.mts";

const trocken = process.argv.includes("--trocken");
const git = (...a: string[]) => execFileSync("git", a, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();

// Erster Commit (NIP-34 „euc“) – der älteste Wurzel-Commit; in einem flachen Klon unbekannt.
let ersterCommit: string | undefined;
if (git("rev-parse", "--is-shallow-repository") !== "true") {
  ersterCommit = git("log", "--max-parents=0", "--format=%ct %H", "HEAD").split("\n")
    .map((z) => z.split(" ")).sort((a, b) => Number(a[0]) - Number(b[0]))[0]?.[1];
}
const quellen = JSON.parse(readFileSync(process.env.SPIEGEL_QUELLEN ?? new URL("../../spiegel/quellen.json", import.meta.url), "utf8"));
const repo = projektRepo(quellen, { ersterCommit, maintainer: (process.env.REPO_MAINTAINER ?? "").split(",") });

if (trocken) {
  console.log(JSON.stringify(baueRepoAnkuendigung(repo, "0".repeat(64)), null, 2));
  process.exit(0);
}
const nsec = process.env.SPIEGEL_NSEC;
if (!nsec) {
  console.log("- NIP-34: übersprungen – Secret SPIEGEL_NSEC fehlt");
  process.exit(0);
}
let kp: ReturnType<typeof keypairFromSecret>;
try {
  kp = keypairFromSecret(spiegelSchluessel(nsec));
} catch (e) {
  console.log(`- NIP-34: ${(e as Error).message}`);
  process.exit(1);
}
const ev = signEvent(baueRepoAnkuendigung(repo, kp.pk), kp.sk);
const relays = (process.env.SPIEGEL_RELAYS ?? startUrls().join(",")).split(",").map((u) => new WebSocketRelay(u.trim(), { autoReconnect: false }));
const bericht = await new OutboxPool(relays, { minAcks: 1 }).publish(ev).catch(() => ({ accepted: [] as string[] }));
for (const r of relays) r.close();
console.log(`- NIP-34: Repository \`${repoAdresse(kp.pk, repo.id)}\` angekündigt, ${bericht.accepted.length}/${relays.length} Relays; Klon: ${repo.klon.join(", ")}${ersterCommit ? "" : " (ohne ersten Commit – flacher Klon)"}`);
process.exit(bericht.accepted.length > 0 ? 0 : 1);
