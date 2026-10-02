/**
 * Anrufe – Oberfläche (B-13d3, Entscheidungen T1 A, T2 A, T3 B): Knöpfe im
 * Kopf der Unterhaltung, angerufen wird nur auf Klick und nur in 1:1; die
 * Leiste zeigt Sicherheitscode und – vor dem Annehmen ohne eigenen Vermittler –
 * wer die IP sieht. Nur DOM mit Text, Medien nur als Ströme.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { kommunikation } from "../src/texte/kommunikation.js";
import { datenschutz } from "../src/texte/datenschutz.js";
import { PRIVACY_FACTS } from "@freedomstack/protocol";

const lies = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const ohneKommentare = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

test("B-13d3: Knöpfe im Kopf der Unterhaltung, mit Namen für Vorleser – verdrahtet beim Start, angerufen nur auf Klick", () => {
  const html = lies("shell/index.html");
  for (const [id, titel, aria, symbol] of [["chat-anruf", "komm.anrufen", "komm.anrufKnopf", "phone"], ["chat-video", "komm.videoanruf", "komm.videoKnopf", "video"]]) {
    assert.match(html, new RegExp(`<button id="${id}" type="button" [^>]*data-i18n-title="${titel.replace(".", "\\.")}" data-i18n-aria="${aria.replace(".", "\\.")}"><span class="ic" data-icon="${symbol}"></span></button>`));
  }
  const kopf = html.slice(html.indexOf('<div class="chat-kopf">'), html.indexOf('<div id="chat-thread"'));
  assert.match(kopf, /id="chat-back"[\s\S]*id="chat-anruf"[\s\S]*id="chat-video"/, "nicht in der Eingabezeile – dort ist mobil kein Platz");
  const app = lies("shell/app.ts");
  assert.match(app, /import \{ wireAnrufe \} from "\.\/anruf-ui\.js";/);
  assert.match(app, /\n {2}wireAnrufe\(\);\n/);
  const ui = ohneKommentare(lies("shell/anruf-ui.ts"));
  const wire = ui.slice(ui.indexOf("export function wireAnrufe("));
  assert.match(wire, /addEventListener\("click", \(\) => void anrufen\(video\)\)/);
  assert.doesNotMatch(wire.replace(/addEventListener\("click"[^\n]*/g, ""), /rufeAn\(|anrufen\(/, "beim Start ruft niemand an");
  assert.match(ui, /if \(!c \|\| c\.type !== "dm"\) return toast\(t\("komm\.anrufNur11"\), true\);/, "nur 1:1");
});

test("B-13d3: Leiste – nur DOM mit Text; T3 B: vor dem Annehmen der Hinweis, ohne jeden Vermittler kein Annehmen", () => {
  const ui = ohneKommentare(lies("shell/anruf-ui.ts"));
  assert.doesNotMatch(ui, /innerHTML|insertAdjacentHTML|outerHTML/);
  assert.doesNotMatch(ui, /getUserMedia|RTCPeerConnection/, "Medien und Verbindung nur in anruf.ts");
  assert.doesNotMatch(ui, /\.message\b/, "Fehler nur über fehlerText()");
  const eingehend = ui.slice(ui.indexOf('if (anruf.phase === "eingehend") {'), ui.indexOf('} else if (anruf.phase === "beendet")'));
  assert.match(eingehend, /if \(anruf\.fremderVermittler\) zeilen\.push\(el\("p", t\("komm\.anrufFremd", \{ name: wer \}\), "mono-sm warn"\)\);/);
  assert.match(eingehend, /an\.disabled = !anruf\.fremderVermittler && !meineKopplung\(\);/);
  assert.ok(eingehend.indexOf("komm.anrufFremd") < eingehend.indexOf("komm.anrufAnnehmen"), "der Hinweis steht vor dem Knopf");
  assert.match(ui, /sicherheitscode\(ich, anruf\.partner\)/, "der Code aus den Personen (B-4), nicht aus Geräteschlüsseln");
  assert.match(ui, /const ich = sprichtFuer\(\);/);
  // Eigenes Bild stumm, das Gegenüber nur als Strom
  assert.match(ui, /eigenesBild\.autoplay = eigenesBild\.muted = eigenesBild\.playsInline = true;/);
  assert.match(ui, /entferntesMedium\.srcObject = a\.entfernt;/);
  assert.doesNotMatch(ui, /\.src = /, "keine Adresse als Quelle");
});

test("B-13d3: Texte in beiden Sprachen; der Hinweis nennt, wer die IP sieht", () => {
  const ui = lies("shell/anruf-ui.ts") + lies("shell/index.html");
  const schluessel = [...new Set([...ui.matchAll(/"(komm\.(?:anruf|videoanruf|videoKnopf)\w*)"/g)].map((m) => m[1]!))];
  assert.ok(schluessel.length >= 20, `zu wenige Schlüssel gefunden: ${schluessel.length}`);
  for (const k of schluessel) {
    const eintrag = (kommunikation as Record<string, { de: string; en: string }>)[k];
    assert.ok(eintrag?.de && eintrag?.en, k);
  }
  assert.match(kommunikation["komm.anrufFremd"].de, /Knoten der anrufenden Person – er sieht deine IP-Adresse/);
  assert.match(kommunikation["komm.anrufFremd"].en, /caller's node – it sees your IP address/);
});

test("B-13d3: Datenschutzbericht – beide Aussagen mit Text, deutsch wortgleich mit dem Protokoll", () => {
  const texte = datenschutz as Record<string, { de: string; en: string }>;
  for (const [id, aussage, grund] of [["anruf-ip", "ds.fAnrufIp", undefined], ["anruf-vermittler", "ds.fAnrufVermittler", "ds.gAnrufVermittler"]] as const) {
    const f = PRIVACY_FACTS.find((x) => x.id === id)!;
    assert.equal(texte[aussage]?.de, f.aussage, id);
    assert.ok(texte[aussage]?.en, id);
    if (grund) assert.equal(texte[grund]?.de, f.grund, id);
  }
});
