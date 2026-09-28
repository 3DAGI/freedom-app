// Probe-Raum für Browser-Prüfungen (seit C.2b2): ein offener Raum mit zwei Kanälen,
// Rollen, Nachrichten und (seit C.2c) einem Thread, signiert mit Wegwerfschlüsseln – nur für smoke_test.py
// und screenshots.py, nie für ein echtes Relay.
// Aufruf: npx tsx scripts/raum-probe.mts <eigener-pubkey-hex>  ->  {"spaceId": "...", "events": [...]}
// Der eigene Schlüssel bekommt die Rolle „mod“, damit die Aktionen an Nachrichten erscheinen.
import {
  buildChannelMessage, buildRoleGrant, buildRoles, buildSpace, generateKeypair, signEvent,
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
  nachricht(bo, "Guten Morgen – ein neuer Tag.", heute + 9 * 3600),
);
console.log(JSON.stringify({ spaceId, events }));
