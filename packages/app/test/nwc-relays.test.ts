/**
 * Schritt 6.3b2: Die Wallet-Verbindung (NWC) auf Wunsch nur über das eigene
 * oder ein .onion-Relay; der Datenschutzbericht sagt, wenn ein fremdes Relay
 * mitsieht. Nebenbei: die SOL-Adress-Anfrage geht an den Posteingang.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_CONFIG, auditPrivacy, formatNwcUri, generateKeypair } from "@freedomstack/protocol";
import { LS_NWC_EIGENES_RELAY, LS_NWC_NUR_PRIVAT, nwcRelayEinstellung, nwcUeberFremdesRelay } from "../src/nwc-relays.js";

const speicher = (w: Record<string, string> = {}) => ({ getItem: (k: string) => w[k] ?? null });
const ONION = "ws://abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz23456.onion";
const uri = (relays: string[]) => {
  const client = generateKeypair();
  return formatNwcUri({ walletPubkey: generateKeypair().pk, relays, secretKey: client.sk, clientPubkey: client.pk });
};

test("6.3b2: Einstellung lesen – aus, wenn nichts gesetzt ist", () => {
  assert.deepEqual(nwcRelayEinstellung(speicher()), { nurPrivat: false });
  assert.deepEqual(nwcRelayEinstellung(speicher({ [LS_NWC_NUR_PRIVAT]: "1", [LS_NWC_EIGENES_RELAY]: " wss://mein.relay.example " })), { nurPrivat: true, eigenes: "wss://mein.relay.example" });
});

test("6.3b2: fremdes Relay erkannt – ohne Verbindung, nur .onion oder nur das eigene nicht", () => {
  const eigen = { [LS_NWC_EIGENES_RELAY]: "wss://mein.relay.example" };
  assert.equal(nwcUeberFremdesRelay(null, speicher()), false, "ohne Verbindung");
  assert.equal(nwcUeberFremdesRelay(uri(["wss://relay.wallet.example"]), speicher()), true);
  assert.equal(nwcUeberFremdesRelay(uri([ONION]), speicher()), false);
  assert.equal(nwcUeberFremdesRelay(uri(["wss://mein.relay.example"]), speicher(eigen)), false);
  assert.equal(nwcUeberFremdesRelay(uri(["wss://mein.relay.example", "wss://relay.wallet.example"]), speicher(eigen)), true, "ohne Einstellung auch das fremde");
  assert.equal(nwcUeberFremdesRelay(uri(["wss://mein.relay.example", "wss://relay.wallet.example"]), speicher({ ...eigen, [LS_NWC_NUR_PRIVAT]: "1" })), false, "mit Einstellung nur das eigene");
  assert.equal(nwcUeberFremdesRelay("kaputt", speicher()), false);
  assert.ok(auditPrivacy({ ...DEFAULT_CONFIG, nwcFremdesRelay: true }).some((f) => f.id === "nwc-relay-fremd"));
  assert.ok(!auditPrivacy(DEFAULT_CONFIG).some((f) => f.id === "nwc-relay-fremd"));
});

test("Verdrahtung (6.3b2): Pool der Wallet nur aus der Auswahl, BOLT12 angezeigt, Einstellung verdrahtet, Bericht", () => {
  const w = readFileSync(new URL("../src/shell/tabs/waehrung.ts", import.meta.url), "utf8");
  assert.match(w, /const wahl = waehleNwcRelays\(conn\.relays, nwcRelayEinstellung\(localStorage\)\);\s*if \("fehler" in wahl\) \{/);
  assert.match(w, /wahl\.relays\.map\(\(u\) => new WebSocketRelay\(u\)\)/);
  assert.doesNotMatch(w, /conn\.relays\.map/, "nie an der Auswahl vorbei");
  assert.match(w, /const bolt12 = bolt12Methoden\(info\.methods\);/);
  assert.match(readFileSync(new URL("../src/shell/app.ts", import.meta.url), "utf8"), /\n  wireNwcRelays\(\);\n/);
  const html = readFileSync(new URL("../src/shell/index.html", import.meta.url), "utf8");
  assert.match(html, /<input type="checkbox" id="nwc-privat" \/>/);
  assert.match(html, /<input id="nwc-eigenes-relay" /);
  assert.match(readFileSync(new URL("../src/shell/datenschutz.ts", import.meta.url), "utf8"), /nwcFremdesRelay: nwcUeberFremdesRelay\(geheim\.getItem\("freedom\.nwc\.uri"\), localStorage\),/);
});

test("6.3b2: SOL-Adress-Anfrage geht an den Posteingang des Empfängers", () => {
  const z = readFileSync(new URL("../src/chat-zap.ts", import.meta.url), "utf8");
  assert.match(z, /frageAdresseAn\(\{ pool, speicher: geheim, signer: appState\.signer!, empfaenger: state\.recipientPubkey, kette, sende: veroeffentlicheDm \}\)/);
  assert.match(readFileSync(new URL("../src/trinkgeld-adresse.ts", import.meta.url), "utf8"), /await \(p\.sende \? p\.sende\(wrap, p\.empfaenger\) : p\.pool\.publish\(wrap\)\);/);
});
