#!/usr/bin/env node
/**
 * NIP-17-Gegenstelle fuer den Interop-Test (Schritt 2.1).
 *
 * Bewusst UNABHAENGIG von FreedomStack: nur nostr-tools. Die Gegenstelle
 * spielt zwei fremde Clients:
 *   Bot B – antwortet auf jede Nachricht von Konto A mit "Antwort von Bot B: …"
 *   Fremder C – schreibt Konto A einmal an (muss in der App als „Anfrage“ erscheinen)
 *
 * Ohne --relays startet das Skript ein kleines lokales Relay (ws://127.0.0.1:PORT).
 * Mit --relays wss://a,wss://b nutzt es echte Relays (Live-Test).
 *
 * Aufruf:  node scripts/interop/nip17-bot.mjs [--relays URL,URL] [--port 7447]
 *                                             [--dauer 240] [--ausgabe /tmp/nip17-interop]
 * Ausgabe: <ausgabe>/schluessel.json (NUR Wegwerf-Testschluessel), <ausgabe>/status.json
 */
import wsPaket from "ws";
// ws ab Version 8 exportiert WebSocketServer, aeltere Versionen nur .Server.
const WebSocketServer = wsPaket.WebSocketServer ?? wsPaket.Server;
const WebSocket = wsPaket.WebSocket ?? wsPaket;
import { mkdirSync, writeFileSync } from "node:fs";
import { generateSecretKey, getPublicKey, verifyEvent } from "nostr-tools/pure";
import * as nip17 from "nostr-tools/nip17";
import * as nip59 from "nostr-tools/nip59";
import * as nip19 from "nostr-tools/nip19";

const arg = (name, vorgabe) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : vorgabe;
};
const PORT = Number(arg("port", "7447"));
const DAUER = Number(arg("dauer", "240"));
const AUSGABE = arg("ausgabe", "/tmp/nip17-interop");
const RELAYS = arg("relays", "") ? arg("relays", "").split(",") : [`ws://127.0.0.1:${PORT}`];
const hex = (b) => Buffer.from(b).toString("hex");
mkdirSync(AUSGABE, { recursive: true });

// ------------------------------------------------ kleines lokales Relay (NIP-01)
if (!arg("relays", "")) {
  const events = [];
  const abos = new Map();
  const passt = (ev, f) => {
    if (f.ids && !f.ids.includes(ev.id)) return false;
    if (f.kinds && !f.kinds.includes(ev.kind)) return false;
    if (f.authors && !f.authors.includes(ev.pubkey)) return false;
    if (f.since && ev.created_at < f.since) return false;
    if (f.until && ev.created_at > f.until) return false;
    for (const k of Object.keys(f)) {
      if (k.startsWith("#") && !ev.tags.some((t) => t[0] === k.slice(1) && f[k].includes(t[1]))) return false;
    }
    return true;
  };
  const wss = new WebSocketServer({ host: "127.0.0.1", port: PORT });
  wss.on("connection", (ws) => {
    abos.set(ws, new Map());
    ws.on("message", (raw) => {
      let m;
      try { m = JSON.parse(String(raw)); } catch { return; }
      if (m[0] === "EVENT") {
        const ev = m[1];
        const ok = verifyEvent(ev);
        if (ok && !events.some((e) => e.id === ev.id)) {
          events.push(ev);
          for (const [sock, subs] of abos) {
            for (const [id, filter] of subs) {
              if (filter.some((f) => passt(ev, f))) sock.send(JSON.stringify(["EVENT", id, ev]));
            }
          }
        }
        ws.send(JSON.stringify(["OK", ev.id, ok, ok ? "" : "invalid: signature"]));
      } else if (m[0] === "REQ") {
        const [, id, ...filter] = m;
        abos.get(ws)?.set(id, filter);
        const limit = Math.min(...filter.map((f) => f.limit ?? Infinity));
        events
          .filter((e) => filter.some((f) => passt(e, f)))
          .sort((a, b) => b.created_at - a.created_at)
          .slice(0, Number.isFinite(limit) ? limit : undefined)
          .forEach((e) => ws.send(JSON.stringify(["EVENT", id, e])));
        ws.send(JSON.stringify(["EOSE", id]));
      } else if (m[0] === "CLOSE") {
        abos.get(ws)?.delete(m[1]);
      }
    });
    ws.on("close", () => abos.delete(ws));
  });
  console.log(`Lokales Relay: ws://127.0.0.1:${PORT}`);
}

// ------------------------------------------------ Wegwerf-Schluessel
const skA = generateSecretKey(), skB = generateSecretKey(), skC = generateSecretKey();
const pkA = getPublicKey(skA), pkB = getPublicKey(skB), pkC = getPublicKey(skC);
writeFileSync(`${AUSGABE}/schluessel.json`, JSON.stringify({
  hinweis: "Nur Wegwerf-Testschlüssel. Nach dem Test löschen.",
  relays: RELAYS,
  a: { hex: hex(skA), pubkey: pkA, npub: nip19.npubEncode(pkA) },
  b: { pubkey: pkB, npub: nip19.npubEncode(pkB) },
  c: { pubkey: pkC, npub: nip19.npubEncode(pkC) },
}, null, 1));

const status = { bEmpfangen: [], bAntworten: 0, cGesendet: false, fehler: [] };
const speichern = () => writeFileSync(`${AUSGABE}/status.json`, JSON.stringify(status, null, 1));
speichern();

// ------------------------------------------------ Verbindungen der Gegenstelle
const gesehen = new Set();
const sockets = RELAYS.map((url) => {
  const ws = new WebSocket(url);
  ws.on("open", () => {
    ws.send(JSON.stringify(["REQ", "bot-b", { kinds: [1059], "#p": [pkB] }]));
  });
  ws.on("message", (raw) => {
    let m;
    try { m = JSON.parse(String(raw)); } catch { return; }
    if (m[0] !== "EVENT" || m[1] !== "bot-b") return;
    const wrap = m[2];
    if (gesehen.has(wrap.id)) return;
    gesehen.add(wrap.id);
    try {
      const rumor = nip59.unwrapEvent(wrap, skB);
      if (rumor.pubkey !== pkA) return;
      status.bEmpfangen.push(rumor.content);
      const antwort = nip17.wrapEvent(skB, { publicKey: pkA }, `Antwort von Bot B: ${rumor.content}`);
      senden(antwort);
      status.bAntworten++;
    } catch (e) {
      status.fehler.push(`Bot B konnte nicht öffnen: ${e.message}`);
    }
    speichern();
  });
  ws.on("error", (e) => { status.fehler.push(`${url}: ${e.message}`); speichern(); });
  return ws;
});
function senden(ev) {
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(["EVENT", ev]));
  }
}

// Fremder C schreibt Konto A an – sobald die Verbindungen stehen.
setTimeout(() => {
  senden(nip17.wrapEvent(skC, { publicKey: pkA }, "Hallo von C – Interop-Anfrage"));
  status.cGesendet = true;
  speichern();
}, 2000);

console.log(`Gegenstelle bereit. B: ${nip19.npubEncode(pkB)} · Laufzeit ${DAUER} s`);
setTimeout(() => process.exit(0), DAUER * 1000);
