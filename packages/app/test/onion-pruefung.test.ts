/**
 * Schritt 6.2: Ehrlicher Modus der Web-App – „IP-Adresse verborgen“ nur, wenn
 * dieser Browser ein .onion-Relay erreicht (also ueber Tor laeuft); sonst die
 * Luecke mit „native App oder Tor Browser nutzen“. Beide Faelle, mit
 * Zeitlimit, und die Verdrahtung in den Datenschutzbericht.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PRIVACY_FACTS, faktenDieserSitzung, privacyFactsText } from "@freedomstack/protocol";
import { ONION_HOECHSTENS, onionKandidaten, onionRelay, pruefeOnion, type Sonde, type SondenFabrik } from "../src/onion-pruefung.js";

const ONION_A = "ws://abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrstuv.onion";
const ONION_B = "wss://bcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrstuvw.onion";

/** Nachgestellte WebSockets: je URL „oeffnet“, „scheitert“ oder „schweigt“. */
function fabrik(verhalten: Record<string, "oeffnet" | "scheitert" | "schweigt" | "wirft">) {
  const versucht: string[] = [];
  const geschlossen: string[] = [];
  const f: SondenFabrik = (url) => {
    versucht.push(url);
    const v = verhalten[url] ?? "scheitert";
    if (v === "wirft") throw new Error("SecurityError");
    const s: Sonde = { onopen: null, onerror: null, onclose: null, close: () => { geschlossen.push(url); } };
    setTimeout(() => {
      if (v === "oeffnet") (s.onopen as (() => void) | null)?.();
      if (v === "scheitert") {
        (s.onerror as (() => void) | null)?.();
        (s.onclose as (() => void) | null)?.();
      }
    }, 5);
    return s;
  };
  return { f, versucht, geschlossen };
}

test("6.2: .onion-Relay erreichbar → „erreichbar“, und der Bericht sagt „IP-Adresse verborgen“", async () => {
  const { f, versucht, geschlossen } = fabrik({ [ONION_A]: "scheitert", [ONION_B]: "oeffnet" });
  const r = await pruefeOnion([ONION_A, ONION_B], f, 1000);
  assert.equal(r, "erreichbar");
  assert.deepEqual(versucht, [ONION_A, ONION_B]);
  assert.ok(geschlossen.includes(ONION_B), "die Verbindung bleibt nicht offen");
  assert.match(privacyFactsText(faktenDieserSitzung(r)), /✓ IP-Adresse verborgen/);
});

test("6.2: kein .onion-Relay erreichbar → „nicht-erreichbar“, der Bericht nennt native App oder Tor Browser", async () => {
  const { f } = fabrik({ [ONION_A]: "scheitert", [ONION_B]: "wirft" });
  const r = await pruefeOnion([ONION_A, ONION_B], f, 1000);
  assert.equal(r, "nicht-erreichbar");
  const t = privacyFactsText(faktenDieserSitzung(r));
  assert.doesNotMatch(t, /IP-Adresse verborgen/);
  assert.match(t, /Noch nicht: Relays sehen deine IP-Adresse nicht\..*Native App oder Tor Browser nutzen/);
});

test("6.2: Zeitlimit – ein Relay, das schweigt, gilt als nicht erreichbar", async () => {
  const { f, geschlossen } = fabrik({ [ONION_A]: "schweigt" });
  const t0 = Date.now();
  assert.equal(await pruefeOnion([ONION_A], f, 50), "nicht-erreichbar");
  assert.ok(Date.now() - t0 < 1000);
  assert.deepEqual(geschlossen, [ONION_A], "der Versuch wird abgebrochen");
});

test("6.2: ohne bekanntes .onion-Relay wird nichts versucht – „keine-onion“", async () => {
  const { f, versucht } = fabrik({});
  assert.equal(await pruefeOnion([], f, 50), "keine-onion");
  assert.equal(versucht.length, 0);
  assert.match(privacyFactsText(faktenDieserSitzung("keine-onion")), /Prüfen ging nicht/);
});

test("6.2: Kandidaten – nur .onion-Relays, eingetragenes zuerst, ohne Doppelte, höchstens drei", () => {
  assert.equal(onionRelay(`${ONION_A}/`), ONION_A);
  assert.equal(onionRelay("wss://relay.damus.io"), null, "klare Adressen pruefen nichts");
  assert.equal(onionRelay("https://x.onion"), null, "kein Relay-Schema");
  assert.equal(onionRelay(42), null);
  const viele = Array.from({ length: 6 }, (_, i) => `ws://${String(i).repeat(56)}.onion`);
  const k = onionKandidaten(ONION_B, ["wss://relay.damus.io", ONION_A, `${ONION_B}/`, ...viele, null, 7]);
  assert.equal(k.length, ONION_HOECHSTENS);
  assert.deepEqual(k.slice(0, 2), [ONION_B, ONION_A]);
  assert.deepEqual(onionKandidaten(null, ["wss://nos.lol"]), []);
});

test("6.2 verdrahtet: Bericht rechnet nur bei erreichbarem .onion-Relay mit Tor, Aussage aus privacy-facts", () => {
  const ds = readFileSync(new URL("../src/shell/datenschutz.ts", import.meta.url), "utf8");
  assert.match(ds, /network: tor === "erreichbar" \? "tor" : "klar",/);
  // Seit 8.16g2b1 in der Sprache der Oberfläche: faktenText() nimmt die Aussagen dieser Sitzung
  assert.match(ds, /const hinweise: string\[\] = \[faktenText\(tor\)\];/);
  assert.match(readFileSync(new URL("../src/datenschutz-bericht.ts", import.meta.url), "utf8"), /const facts = faktenDieserSitzung\(tor\);/);
  assert.match(ds, /pruefeOnion\(kandidaten, \(u\) => new WebSocket\(u\)\)/);
  assert.doesNotMatch(ds, /das kann die App nicht prüfen\./, "der alte Pauschalsatz ist weg");
  const settings = ["settings", "sicherung", "mesh"].map((d) => readFileSync(new URL(`../src/shell/tabs/${d}.ts`, import.meta.url), "utf8")).join("\n");
  assert.match(settings, /pruefen\.onclick = \(\) => void zeigeDatenschutz\(true\);/);
  assert.match(settings, /localStorage\.setItem\(LS_ONION_PRUEFRELAY, url\)/);
  // Nur in Bedienelementen (Verbindung, Pruef-Relay, erneut pruefen) – nicht mehr beim Start in wireMeshTab().
  assert.equal(settings.match(/zeigeDatenschutz\(/g)?.length, 3);
  const html = readFileSync(new URL("../src/shell/index.html", import.meta.url), "utf8");
  assert.match(html, /id="onion-pruefrelay"/);
  assert.match(html, /id="onion-pruefen"/);
  // Beim Start prueft die App nichts – erst, wenn der Bericht gezeigt wird (switchTab).
  const app = readFileSync(new URL("../src/shell/app.ts", import.meta.url), "utf8");
  assert.match(app, /if \(name === "settings"\) \{[^}]*void zeigeDatenschutz\(\);/);
  assert.equal(PRIVACY_FACTS.find((x) => x.id === "ip")?.status, "offen", "fest bleibt die Luecke offen");
});
