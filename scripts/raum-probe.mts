// Probe-Raum für Browser-Prüfungen (seit C.2b2): ein offener Raum mit zwei Kanälen,
// Rollen, Nachrichten und (seit C.2c) einem Thread, signiert mit Wegwerfschlüsseln – nur für smoke_test.py
// und screenshots.py, nie für ein echtes Relay.
// Aufruf: npx tsx scripts/raum-probe.mts <eigener-pubkey-hex>  ->  {"spaceId": "...", "events": [...], "uebernahme": {...}, "ausblendung": {...}}
// Der eigene Schlüssel bekommt die Rolle „mod“, damit die Aktionen an Nachrichten erscheinen.
import {
  baueCoverageEintrag, baueIssue, baueKommentar, baueRepoAnkuendigung, bauePatch, buildChannelMessage, buildContribution, buildGitRepoRef, buildHide, buildRoleGrant, buildRoles, buildSpace, generateKeypair,
  leseRepoAnkuendigung, raumAdresse, signEvent,
} from "../packages/protocol/src/index.ts";

const ich = process.argv[2] ?? "";
if (!/^[0-9a-f]{64}$/.test(ich)) {
  console.error("eigener Pubkey (hex, 64 Zeichen) fehlt");
  process.exit(1);
}
const [gruender, ada, bo] = [generateKeypair(), generateKeypair(), generateKeypair()];
const spaceId = "probe-raum";
// Gestern 10:00 Uhr (UTC) – zwei Tage im Verlauf, fern von Mitternacht
const heute = Math.floor(Date.now() / 86_400_000) * 86_400;
const gestern = heute - 86_400 + 10 * 3600;

const events = [
  signEvent(buildSpace({
    spaceId, name: "Probe-Raum", ownerPubkey: gruender.pk,
    channels: [
      { id: "allgemein", name: "allgemein", privacy: "offen", writeRoles: [], position: 0 },
      { id: "ankuendigungen", name: "ankündigungen", privacy: "offen", writeRoles: ["mod"], position: 1 },
    ],
  } as never, gestern - 600), gruender.sk),
  signEvent(buildRoles(spaceId, gruender.pk, [
    { id: "mod", name: "Moderator", rank: 50, permissions: ["lesen", "schreiben", "threads", "moderieren", "rollen_vergeben"] },
    { id: "mitglied", name: "Mitglied", rank: 10, permissions: ["lesen", "schreiben", "threads"] },
  ] as never, gestern - 600), gruender.sk),
  ...[[ada.pk, "mitglied"], [bo.pk, "mitglied"], [ich, "mod"]].map(([pk, rolle]) =>
    signEvent(buildRoleGrant(spaceId, gruender.pk, pk!, [rolle!], gestern - 500), gruender.sk)),
];
const nachricht = (von: typeof ada, text: string, zeit: number, bezug: { threadRoot?: string; replyTo?: string } = {}) =>
  signEvent(buildChannelMessage({
    authorPubkey: von.pk, spaceId, channelId: "allgemein", content: text, mentions: [], ...bezug,
  } as never, zeit), von.sk);
const willkommen = nachricht(gruender, "Willkommen im Probe-Raum.", gestern);
// Seit C.2c ein Thread an der ersten Nachricht: eine Antwort und eine Antwort auf die Antwort
const danke = nachricht(bo, "Danke, gelesen.", gestern + 120, { threadRoot: willkommen.id });
events.push(
  willkommen,
  nachricht(gruender, "Regeln stehen im Kanal ankündigungen.", gestern + 60),
  danke,
  nachricht(ada, "Ich auch.", gestern + 150, { threadRoot: willkommen.id, replyTo: danke.id }),
  nachricht(ada, "Hallo! <img src=x onerror=\"window.__raumXss=1\"> bleibt Text.", gestern + 180),
  nachricht(ada, "Zweite Zeile, gleiche Gruppe.", gestern + 240),
);
const morgen = nachricht(bo, "Guten Morgen – ein neuer Tag.", heute + 9 * 3600);
events.push(morgen);
// Seit C.3a ein Repo: Ankündigung (ich bin Maintainer), Bundle-Verweis desselben Eigentümers, ein offener Patch.
// Seit 11.4c gehört es zum Probe-Raum (der Gründer pflegt dort immer Repos) – der Raum zeigt es in seiner Liste
const ankuendigung = signEvent({ ...baueRepoAnkuendigung({
  id: "werkzeug", name: "werkzeug", beschreibung: "Werkzeuge für den Probe-Raum",
  klon: ["https://example.org/werkzeug.git"], maintainer: [ich], raum: raumAdresse(gruender.pk, spaceId),
}, gruender.pk), created_at: gestern }, gruender.sk);
const patchText = `From ${"a".repeat(40)} Mon Sep 17 00:00:00 2001\nFrom: Ada\nSubject: [PATCH] Hammer schärfen\n\n---\n`
  + "diff --git a/hammer.txt b/hammer.txt\n--- a/hammer.txt\n+++ b/hammer.txt\n@@ -1 +1 @@\n-stumpf\n+scharf\n";
events.push(
  ankuendigung,
  signEvent({ ...buildGitRepoRef({ name: "werkzeug", blobId: "b".repeat(64), headSha: "local", branch: "main", message: "bundle", version: 1 }, gruender.pk), created_at: gestern + 60 }, gruender.sk),
  signEvent({ ...bauePatch({ repo: leseRepoAnkuendigung(ankuendigung), text: patchText }, ada.pk), created_at: gestern + 300 }, ada.sk),
);
// Seit C-17b ein offenes Issue von Bo mit einem Kommentar von Ada
const issue = signEvent({ ...baueIssue({ repo: { eigentuemer: gruender.pk, id: "werkzeug" }, betreff: "Hammer klemmt", text: "Seit gestern <b>fest</b>.", labels: ["bug"] }, bo.pk), created_at: gestern + 500 }, bo.sk);
events.push(issue, signEvent({ ...baueKommentar({ wurzel: { id: issue.id, autor: bo.pk, kind: issue.kind }, text: "Bei mir auch." }, ada.pk), created_at: gestern + 600 }, ada.sk));
// Seit C.3a2 Beiträge (38056) zu „werkzeug“: Ada an zwei Tagen, Bo einmal – und einer zu einem anderen Repo
const beitrag = (von: typeof ada, repo: string, zeit: number) =>
  signEvent(buildContribution({ repoId: repo, authorPubkey: von.pk, kind: "patch", summary: "Beitrag", ref: `${repo}-${zeit}` }, zeit), von.sk);
events.push(beitrag(ada, "werkzeug", gestern - 86_400), beitrag(ada, "werkzeug", gestern), beitrag(bo, "werkzeug", gestern + 400), beitrag(bo, "anderes", gestern));
// Seit C.4a Abdeckung (38055) für die Karte, je Eintrag ein Wegwerfschlüssel: drei Funkknoten in einem
// Gebiet (gezeigt), zwei in einem anderen (unter der Schwelle), ein Provider im Netz mit Namen, drei
// Bluetooth-Geräte mit einem Namen, der Text bleiben muss
const vorEinerStunde = Math.floor(Date.now() / 1000) - 3600;
const abdeckung = (layer: "online" | "lora" | "bluetooth", cell: string, region = "") =>
  baueCoverageEintrag({ layer, cell, region }, vorEinerStunde).event;
events.push(
  ...[1, 2, 3].map(() => abdeckung("lora", "48.00,11.00")),
  ...[1, 2].map(() => abdeckung("lora", "52.00,13.00")),
  abdeckung("online", "50.00,8.00", "Probe-Stadt"),
  ...[1, 2, 3].map(() => abdeckung("bluetooth", "47.00,8.00", "<b>fett</b> Tal")),
);
// Seit B-7: eine neuere Definition derselben Kennung von einem Fremden – nicht in `events`: Der Smoke-Test legt sie erst nach dem
// Beitreten nach und prüft, dass der Raum beim Gründer bleibt
const fremd = generateKeypair();
const uebernahme = signEvent(buildSpace({
  spaceId, name: "Übernommen", ownerPubkey: fremd.pk,
  channels: [{ id: "allgemein", name: "allgemein", privacy: "offen", writeRoles: [], position: 0 }],
} as never, heute + 10 * 3600), fremd.sk);
// Seit B-19: der Gründer blendet Bos Nachricht aus – ebenfalls erst nachgelegt (die anderen Prüfungen sehen den Verlauf vollständig)
const ausblendung = signEvent({ ...buildHide(spaceId, gruender.pk, morgen.id, "Nicht zum Thema"), created_at: heute + 11 * 3600 }, gruender.sk);
console.log(JSON.stringify({ spaceId, events, uebernahme, ausblendung }));
