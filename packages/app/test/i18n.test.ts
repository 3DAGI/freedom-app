/**
 * Schritt 8.16 (Variante B): Deutsch und Englisch vollständig. Findet
 * fehlende, unbenutzte und rohe Texte. Rohtext zählt in index.html je
 * Bereich und im Code je Datei (`i18n-offen.ts`): fertige stehen auf 0,
 * offene dürfen nur sinken, neue Dateien sind von Anfang an fertig.
 * Fertig: Rahmen (8.16a), Kommunikation (8.16c), Agent-Seite und tabs/agent.ts (8.16d1).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { join as pfad, relative } from "node:path";
import { BEREICHE, LANGS, detectLang, gebietsschema, gespeicherteSprache, getLang, setLang, t } from "../src/i18n.js";
import { OFFEN_CODE, OFFEN_HTML } from "./i18n-offen.js";
import { rohtexte, rohtexteImCode } from "./i18n-rohtext.js";

const SRC = new URL("../src/", import.meta.url).pathname;
const html = readFileSync(join(SRC, "shell/index.html"), "utf8");
const dateien = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (e.name === "texte" ? [] : dateien(join(dir, e.name))) : e.name.endsWith(".ts") && e.name !== "i18n.ts" ? [join(dir, e.name)] : []);
const quellen = dateien(SRC).map((f) => ({ datei: relative(SRC, f), text: readFileSync(f, "utf8") }));
const code = quellen.map((q) => q.text).join("\n");
const alle = Object.assign({}, ...Object.values(BEREICHE)) as Record<string, { de: string; en: string }>;

test("8.16: nur Deutsch und Englisch – jeder Text in beiden, nicht leer, mit denselben Platzhaltern, in genau einem Bereich", () => {
  assert.deepEqual(LANGS.map((l) => l.code), ["de", "en"]);
  const gesehen = new Map<string, string>();
  const platzhalter = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const [bereich, texte] of Object.entries(BEREICHE)) {
    for (const [k, v] of Object.entries(texte)) {
      assert.ok(!gesehen.has(k), `${k} in ${bereich} und ${gesehen.get(k)}`);
      gesehen.set(k, bereich);
      assert.deepEqual(Object.keys(v).sort(), ["de", "en"], k);
      assert.ok(v.de.trim() && v.en.trim(), `${k}: leer`);
      assert.deepEqual(platzhalter(v.de), platzhalter(v.en), `${k}: Platzhalter verschieden`);
    }
  }
});

test("8.16: t() – aktuelle Sprache, Werte eingesetzt, Unbekanntes sichtbar; Sprache aus Wahl oder Browser", () => {
  const vorher = getLang();
  try {
    setLang("de");
    assert.equal(t("navComm"), "Kommunikation");
    setLang("en");
    assert.equal(t("navComm"), "Chat");
    assert.equal(t("gibt-es-nicht"), "gibt-es-nicht", "unbekannt → der Schlüssel selbst");
    assert.equal(t("{n} von {m}", { n: 2, m: 5 }), "2 von 5");
    assert.equal(t("{n} und {x}", { n: 1 }), "1 und {x}", "fehlender Wert bleibt sichtbar");
  } finally {
    setLang(vorher);
  }
  assert.equal(detectLang("de-AT"), "de");
  assert.equal(detectLang("DE"), "de");
  assert.equal(detectLang("en-US"), "en");
  assert.equal(detectLang("fr-FR"), "en", "andere Sprachen → Englisch");
  assert.equal(gespeicherteSprache("de"), "de");
  assert.equal(gespeicherteSprache("fr"), null, "bis 8.16 gewählt, gibt es nicht mehr");
  assert.equal(gespeicherteSprache(null), null);
});

test("8.16: Oberfläche – jeder Schlüssel aus index.html und jedes t(…) im Code existiert, jeder Text wird benutzt", () => {
  const ausHtml = [...html.matchAll(/data-(?:i18n(?:-ph|-title|-aria)?|prompt-key)="([^"]+)"/g)].map((m) => m[1]);
  const ausCode = [...code.matchAll(/\bt\(\s*["'`]([\w.-]+)["'`]/g)].map((m) => m[1]);
  assert.ok(ausHtml.length > 30);
  for (const k of [...ausHtml, ...ausCode]) assert.ok(k in alle, `Schlüssel fehlt: ${k}`);
  const benutzt = (k: string) => ausHtml.includes(k) || code.includes(`"${k}"`) || code.includes(`'${k}'`);
  const unbenutzt = Object.keys(alle).filter((k) => !benutzt(k));
  assert.deepEqual(unbenutzt, [], "unbenutzte Texte");
});

test("8.16: Rohtext-Suche – findet Text und Attribute ohne Schlüssel, übersieht Eigennamen und Übersetztes", () => {
  const probe = `<header title="Kopf">FREEDOM <span data-i18n="x">Hallo</span> Offen</header>
    <section id="page-x"><p data-i18n="y">Übersetzt <b>auch innen</b></p><input placeholder="Suche" /><input placeholder="Suche" data-i18n-ph="z" />
    <button aria-label="Schließen" data-i18n-aria="w">×</button><!-- Kommentar zählt nicht --><script>var s = "Code";</script>
    <span>12 sats</span><span>Lightning</span><svg><text>Grafik</text></svg><div>Noch roh</div></section><footer>Fuß</footer>`;
  assert.deepEqual(rohtexte(probe), [
    { bereich: "rahmen", text: 'title="Kopf"' },
    { bereich: "rahmen", text: "Offen" },
    { bereich: "page-x", text: 'placeholder="Suche"' },
    { bereich: "page-x", text: "Noch roh" },
    { bereich: "rahmen", text: "Fuß" },
  ]);
});

test("8.16: kein roher Text in fertigen Bereichen von index.html, in offenen nicht mehr als bisher", () => {
  const je: Record<string, string[]> = {};
  for (const r of rohtexte(html)) (je[r.bereich] ??= []).push(r.text);
  for (const bereich of new Set([...Object.keys(je), ...Object.keys(OFFEN_HTML)])) {
    const gefunden = je[bereich] ?? [];
    assert.ok(bereich in OFFEN_HTML, `neuer Bereich ${bereich}: in OFFEN_HTML eintragen`);
    assert.ok(gefunden.length <= OFFEN_HTML[bereich], `${bereich}: ${gefunden.length} rohe Texte (erlaubt ${OFFEN_HTML[bereich]})${OFFEN_HTML[bereich] === 0 ? `: ${gefunden.join(" | ")}` : ""}`);
  }
});

test("8.16: Rohtext-Suche im Code – findet sichtbaren Text, auch in Vorlagen, übersieht Code und Vermerktes", () => {
  const probe = [
    'toast("Nicht gesendet – kein Relay");',
    'el.textContent = "lade…";',
    'const x = prompt("Raum-Kennung:");',
    'box.innerHTML = `<div class="muted">${items.map((i) => `<b title="Zap senden">${i}</b>`).join("")}</div>`;',
    'const s = `${n} Antwort ·`;',
    'document.querySelector("button span");',
    'document.querySelectorAll<HTMLElement>(".sec-progress span");',
    'localStorage.getItem("freedom.lang");',
    'console.warn("nur für Entwickler");',
    'el.className = "mono-sm muted";',
    'block.append(el("div", r.text, "mono-sm muted"));',
    'const s = "e-mail senden";',
    'if (e.key === "Enter") senden();',
    'const h = { "Content-Type": "text/html" };',
    'const re = /Nicht gesendet/;',
    '// toast("im Kommentar");',
    'const kanal = { name: "ankündigungen" }; // kein UI-Text',
    'toast(t("komm.erledigt"));',
  ].join("\n");
  assert.deepEqual(rohtexteImCode(probe).map((f) => [f.zeile, f.text]), [
    [1, "Nicht gesendet – kein Relay"],
    [2, "lade…"],
    [3, "Raum-Kennung:"],
    [4, '<b title="Zap senden"> </b>'],
    [5, "  Antwort ·"],
    [12, "e-mail senden"],
  ]);
});

test("8.16: kein roher Text im Code fertiger und neuer Dateien, in offenen nicht mehr als bisher", () => {
  for (const { datei, text } of quellen) {
    const gefunden = rohtexteImCode(text);
    const erlaubt = OFFEN_CODE[datei] ?? 0;
    assert.ok(gefunden.length <= erlaubt,
      `${datei}: ${gefunden.length} rohe Texte (erlaubt ${erlaubt})${erlaubt === 0 ? `: ${gefunden.map((f) => `${f.zeile}: ${f.text}`).join(" | ")}` : ""}`);
  }
  for (const datei of Object.keys(OFFEN_CODE)) assert.ok(quellen.some((q) => q.datei === datei), `${datei} gibt es nicht mehr – aus OFFEN_CODE streichen`);
});

test("8.16a: Rahmen – Navigation und Kopfzeile über Schlüssel, gespeicherte Sprache geprüft, das nie gezeigte Wallet-Gate ist weg", () => {
  const app = readFileSync(join(SRC, "shell/app.ts"), "utf8");
  assert.match(app, /setLang\(gespeicherteSprache\(localStorage\.getItem\("freedom\.lang"\)\) \?\? detectLang\(\)\);\s*document\.documentElement\.lang = getLang\(\);/);
  assert.match(app, /querySelectorAll\("\[data-i18n-title\]"\)/);
  assert.match(app, /querySelectorAll\("\[data-i18n-aria\]"\)/);
  for (const k of ["navAi", "navComm", "navWallet", "navEarn", "navProfile", "navSettings"]) assert.match(html, new RegExp(`<span data-i18n="${k}">`));
  assert.doesNotMatch(html, /id="gate"|gate-lightning|gate-solana|gate-local/);
  assert.doesNotMatch(app, /#gate/);
});

test("8.16b: Zahlen und Daten im Gebietsschema der Sprache; ein Sprachwechsel zeichnet den offenen Tab neu", () => {
  const vorher = getLang();
  try {
    setLang("en");
    assert.equal(gebietsschema(), "en-US");
    setLang("de");
    assert.equal(gebietsschema(), "de-DE");
  } finally {
    setLang(vorher);
  }
  assert.match(readFileSync(pfad(SRC, "shell/tabs/kommunikation.ts"), "utf8"), /toLocaleTimeString\(gebietsschema\(\), \{/, "Uhrzeit im Raum");
  const app = readFileSync(pfad(SRC, "shell/app.ts"), "utf8");
  assert.match(app, /applyI18n\(\);\s*\/\/[^\n]*\n\s*const offen = document\.querySelector<HTMLElement>\("\.app-nav button\.active"\)\?\.dataset\.tab;\s*if \(offen\) switchTab\(offen\);/);
});

test("8.16c: Kommunikation – Texte über Schlüssel; die Markierung abgelöster Unterhaltungen in beiden Sprachen erkannt", () => {
  const kom = readFileSync(pfad(SRC, "shell/tabs/kommunikation.ts"), "utf8");
  assert.match(kom, /import \{ gebietsschema, t \} from "\.\.\/\.\.\/i18n\.js";/);
  assert.doesNotMatch(kom, /"de-DE"/);
  assert.ok(!("shell/tabs/kommunikation.ts" in OFFEN_CODE) && OFFEN_HTML["page-comm"] === 0, "fertig: Seite und Code auf 0");
  // Die Markierung steht im gespeicherten Namen – eine Unterhaltung aus der anderen Sprache bleibt erkannt
  const marke = /^\((alter Schlüssel|old key)\) /;
  assert.match(kom, /const ALT_MARKE = \/\^\\\(\(alter Schlüssel\|old key\)\\\) \/;/);
  const vorher = getLang();
  try {
    for (const l of ["de", "en"] as const) {
      setLang(l);
      assert.match(t("komm.alterSchluessel", { name: "Ana" }), marke, l);
    }
    setLang("en");
    assert.equal(t("komm.gemeldet", { n: 2 }), "Reported – sealed to 2 moderator(s)");
    setLang("de");
    assert.equal(t("komm.eineAntwort", { n: 1 }), "1 Antwort");
    assert.equal(t("komm.antworten", { n: 3 }), "3 Antworten");
  } finally {
    setLang(vorher);
  }
});

test("8.16d1: Agent – Seite und tabs/agent.ts über Schlüssel; eigene Meldungen nicht umgedeutet, Beispiel-Prompts in der Sprache", () => {
  const ag = readFileSync(pfad(SRC, "shell/tabs/agent.ts"), "utf8");
  assert.ok(!("shell/tabs/agent.ts" in OFFEN_CODE) && OFFEN_HTML["page-ai"] === 0, "fertig: Seite und Code auf 0");
  assert.doesNotMatch(ag, /"de-DE"/);
  // Eigene Meldungen sind schon übersetzt – explainError deutet sie nicht nach deutschen Mustern um
  assert.match(ag, /if \(e instanceof EigeneMeldung\) return e\.message;/);
  assert.match(ag, /if \(\/relay\|websocket\|eose\|pool\/\.test\(m\)\) return t\("agent\.fehlerRelay"\);/);
  // Beispiele: der gesendete Prompt folgt der Sprache, nicht nur die Beschriftung
  assert.match(ag, /const prompt = t\(\(b as HTMLElement\)\.dataset\.promptKey \?\? ""\);/);
  for (const n of [1, 2, 3]) assert.match(html, new RegExp(`data-prompt-key="agent\\.beispiel${n}Prompt"`));
  assert.doesNotMatch(html, /data-prompt="/);
  // Beim Öffnen des Tabs neu gezeichnet – so folgen Verlauf und Budget einem Sprachwechsel
  assert.match(readFileSync(pfad(SRC, "shell/app.ts"), "utf8"), /if \(name === "ai"\) \{ zeigeVerlaeufe\(\); updateBudgetBar\(\);/);
  const vorher = getLang();
  try {
    setLang("en");
    assert.equal(t("agent.beispiel1Prompt"), "Explain the Nostr protocol in one sentence.");
    assert.equal(t("agent.sitzung", { bezahlt: 3, max: 10, pct: 30 }), "session: 3/10 sats (30%)");
  } finally {
    setLang(vorher);
  }
});

test("8.16e: Agent-Rest, Währung, Zahlwege und Swaps – über Schlüssel; Texte des Protokolls aus den Zahlen neu gebildet", async () => {
  const fertig = [
    "shell/tabs/agent-netz.ts", "streitfall.ts", "shell/streitfall-ui.ts", "shell/pruefauftraege-ui.ts", "shell/ki-zahlung.ts",
    "modell-kataloge.ts", "werkzeug-preise.ts", "ki-kontext.ts", "shell/tabs/waehrung.ts", "shell/eingebaute-wallet.ts",
    "shell/offline-zahlung.ts", "shell/zahlschienen.ts", "swap-client.ts", "sol-htlc.ts", "rueck-swap.ts", "rails.ts",
    "sol-wallet.ts", "solana-connect.ts", "zap-zahlung.ts", "refund-watcher.ts", "relay-kauf.ts", "rpc-stichprobe.ts",
    "sol-offline-zahlung.ts", "wallet-standard.ts", "trinkgeld-beleg.ts", "chat-zap.ts", "sol-transfer.ts",
    "relay-einloesung.ts", "preis-anzeige.ts",
  ];
  for (const d of fertig) {
    assert.ok(!(d in OFFEN_CODE), `${d} fertig`);
    assert.doesNotMatch(readFileSync(pfad(SRC, d), "utf8"), /"de-DE"/, d);
  }
  assert.equal(OFFEN_HTML["page-wallet"], 0);
  const lies = (d: string) => readFileSync(pfad(SRC, d), "utf8");
  // Deutsche Texte des Protokolls nicht mehr anzeigen – die App bildet sie aus den Feldern
  assert.doesNotMatch(lies("shell/tabs/agent-netz.ts"), /m\.note\b/);
  assert.doesNotMatch(lies("shell/pruefauftraege-ui.ts"), /DISPUTE_LABEL/);
  assert.doesNotMatch(lies("shell/tabs/waehrung.ts"), /caps\.note|swapPrivacyCheck/);
  assert.match(lies("shell/tabs/waehrung.ts"), /const pruefung = tauschPruefung\(\{/);
  // Der Prüfer hat eine Art, keinen Text – angezeigt über den Schlüssel
  assert.match(lies("shell/tabs/agent.ts"), /pruefer\.art === "provider" \?/);
  assert.doesNotMatch(lies("shell/tabs/agent.ts"), /eigener Provider| je Aufruf/);
  // Knöpfe, deren Text der Code ändert, tragen den neuen Schlüssel – ein Sprachwechsel setzt nicht zurück
  assert.match(lies("shell/tabs/waehrung.ts"), /btn\.dataset\.i18n = "waehr\.knopfVerbunden";\s*btn\.textContent = t\("waehr\.knopfVerbunden"\);/);
  assert.match(lies("shell/app.ts"), /nbWallet\.dataset\.i18n = "waehr\.solDeposit";/);

  const { modellNotiz } = await import("../src/shell/tabs/agent-netz.js");
  const { reklamationText, prueferAusNetz, PRUEFER_ART } = await import("../src/streitfall.js");
  const { tauschPruefung, describeHtlcError, nextStep } = await import("../src/swap-client.js");
  const { kursZeile, ausMsat } = await import("../src/preis-anzeige.js");
  const { werkzeugPreisText } = await import("../src/werkzeug-preise.js");
  const vorher = getLang();
  try {
    setLang("en");
    assert.equal(modellNotiz({ seeders: 1, missingFiles: [] }), "A single seeder. If it disappears, the model is gone.");
    assert.equal(modellNotiz({ seeders: 3, missingFiles: ["b"] }), "1 file(s) missing in the network – not loadable like this, even with 3 seeders.");
    assert.equal(modellNotiz({ seeders: 5, missingFiles: [] }), "5 seeders, complete.");
    const r = { jobId: "a".repeat(64), providerPk: "b".repeat(64), pruefer: "c".repeat(64), prueferName: "Anna", sitzungSk: "d".repeat(64), grund: "unbrauchbar" as const, betragMsat: 21_000, at: 1 };
    assert.equal(reklamationText(r), "waiting for the verdict of Anna");
    assert.equal(reklamationText({ ...r, urteil: { ergebnis: "erstattet", erstattungMsat: 21_000, notiz: "", at: 2 } }),
      "Anna rules in your favor – 21 sats back. This applies only between you and the provider; the provider has to refund you.");
    const [p] = prueferAusNetz([], ["e".repeat(64)], []);
    assert.equal(t(PRUEFER_ART[p!.art]), "own provider");
    // Prüfung vor dem Tausch: dieselben Befunde wie das Protokoll, in der Sprache der Oberfläche
    const jetzt = 1_800_000_000;
    const befund = tauschPruefung({ usage: [{ address: "x", uses: 2, firstUsed: 1, lastUsed: 2 }], lamports: 1_000_000_000, lastSwapAt: jetzt - 120, nowSecs: jetzt, randomFn: () => 0.5 });
    assert.equal(befund.ok, false);
    assert.equal(befund.befunde.length, 3);
    assert.match(befund.befunde[0]!, /^An address was used twice\./);
    assert.match(befund.befunde[1]!, /^1\.000 SOL is a round amount\./);
    assert.match(befund.befunde[2]!, /^The last swap was 2 minutes ago\./);
    assert.deepEqual(befund.schritte, ["Use a fresh address (number 1).", "Change the amount to 1.001500 SOL.", "Wait, if it matters."]);
    assert.equal(tauschPruefung({ usage: [], lamports: 123_456_789 }).ok, true);
    assert.equal(describeHtlcError("custom program error: 0x1773"), "The preimage doesn't match the hashlock.");
    assert.equal(nextStep({ phase: "zahlbar", message: "", safeToPay: true }), "Checked. The invoice can be paid now.");
    // Kurswarnungen aus den Zahlen; weicht ihre Zahl ab (anderer Aufruf), gelten die des Protokolls
    const kurs = { satsProSol: 150_000, quellen: 2, streuung: 0.2, warnungen: ["a", "b"] };
    assert.deepEqual(kursZeile(kurs), { text: "Rate: 1 SOL ≈ 150,000 sats (median of 2 sources) ⚠ Rate from only 2 source(s); Rate sources differ by up to 20%", warnung: true });
    assert.equal(kursZeile({ ...kurs, warnungen: ["a", "b", "c"] }).text, "Rate: 1 SOL ≈ 150,000 sats (median of 2 sources) ⚠ a; b; c");
    assert.equal(ausMsat(21_000), "21 sats (SOL: no rate)");
    assert.equal(werkzeugPreisText({ msat: 5000, angeboten: false }, { satsProSol: 100_000 }), "5 sats ≈ 0.00005 SOL per call (guide price)");
    setLang("de");
    assert.equal(ausMsat(1_500_000, { satsProSol: 150_000 }), "1.500 sats ≈ 0,01 SOL");
    assert.match(tauschPruefung({ usage: [], lamports: 1_000_000_000, randomFn: () => 0 }).befunde[0]!, /^1,000 SOL ist ein runder Betrag\./);
  } finally {
    setLang(vorher);
  }
});

test("8.16f: Earn, Profil, Settings – über Schlüssel; Sätze des Protokolls auf Deutsch wortgleich, auf Englisch übersetzt", async () => {
  for (const d of ["shell/tabs/earn.ts", "shell/tabs/profil.ts", "shell/tabs/repos.ts", "shell/tabs/settings.ts", "repo-ansicht.ts", "protokoll-texte.ts"]) {
    assert.ok(!(d in OFFEN_CODE), `${d} fertig`);
    assert.doesNotMatch(readFileSync(pfad(SRC, d), "utf8"), /"de-DE"/, d);
  }
  for (const b of Object.keys(OFFEN_HTML)) assert.equal(OFFEN_HTML[b], 0, `${b}: index.html fertig`);
  // Deutsche Sätze des Protokolls werden nicht mehr angezeigt – die App bildet sie aus den Feldern
  const earn = readFileSync(pfad(SRC, "shell/tabs/earn.ts"), "utf8");
  const profil = readFileSync(pfad(SRC, "shell/tabs/profil.ts"), "utf8");
  assert.doesNotMatch(earn, /healthNote\)|bf\.note|z\.label|c\.label|r\.cells\)\.message|coverageConsentText/);
  assert.doesNotMatch(profil, /profileDisclosure|badgeSourceLabel|q\.quest\.title|q\.detail|bild\.warning|\/IP-Adresse\//);
  // Was der Code einmal füllt, zeichnet das Öffnen des Tabs in der neuen Sprache neu (Browser-Test 8.16f)
  const app = readFileSync(pfad(SRC, "shell/app.ts"), "utf8");
  assert.match(app, /if \(name === "profile"\) \{[^}]*zeigeProfilTexte\(\);/);
  assert.match(app, /if \(name === "earn"\) \{[^}]*void ladeAbdeckung\(\);/);
  assert.match(earn, /if \(hier && !localStorage\.getItem\("freedom\.coverage\.cell"\)\) hier\.textContent = t\("earn\.standortGebraucht"\);/);

  const P = await import("@freedomstack/protocol");
  const T = await import("../src/protokoll-texte.js");
  const vorher = getLang();
  try {
    setLang("de");
    // Repo-Zustand und Verteilung der Arbeit
    const jetzt = 1_800_000_000;
    const beitrag = (autor: string, alterTage: number) => ({
      ...P.buildContribution({ repoId: "r", authorPubkey: autor, kind: "push", summary: "x", ref: `${autor}${alterTage}` }, jetzt - alterTage * 86400),
      id: "0".repeat(64), sig: "0".repeat(128), pubkey: autor,
    });
    const [a, b, c] = ["a", "b", "c"].map((x) => x.repeat(64));
    for (const evs of [[], [beitrag(a!, 3)], [beitrag(a!, 60)], [beitrag(a!, 400)]]) {
      const o = P.buildRepoOverview("r", evs as never, jetzt);
      assert.equal(T.repoZustand(o, jetzt), o.healthNote);
    }
    for (const evs of [[], [beitrag(a!, 1)], [beitrag(a!, 1), beitrag(a!, 2), beitrag(a!, 3), beitrag(b!, 1)], [beitrag(a!, 1), beitrag(b!, 2), beitrag(c!, 3)]]) {
      const o = P.buildRepoOverview("r", evs as never, jetzt);
      const bf = P.busFactor(o.contributors);
      assert.equal(T.busFaktorText(bf.count, o.contributors), bf.note);
    }
    // Abdeckung: Ebenen, „hier“ und die Einwilligung vor dem Eintragen
    const lagen = ["online", "lora", "bluetooth"] as const;
    for (const l of lagen) {
      assert.equal(T.ebeneName(l), P.LAYER_LABEL[l]);
      assert.equal(T.abdeckungEinwilligung(l), P.coverageConsentText(l));
    }
    const zelle = (layer: (typeof lagen)[number]) => ({ cell: P.toCell(52.5, 13.4, P.LAYER_CELL_DEGREES[layer]), layer, nodes: 3, center: null, region: "", label: "" });
    for (const auswahl of [[], ["online"], ["lora"], ["online", "lora"], ["online", "lora", "bluetooth"], ["bluetooth"]] as const) {
      const hier = P.coverageAt(52.5, 13.4, auswahl.map(zelle));
      assert.equal(T.abdeckungHier(hier), hier.message, auswahl.join("+"));
    }
    // Profil, Bild, Aufgaben, Abzeichen
    for (const p of [{}, { name: "A", about: "B", lud16: "a@b.c" }, { picture: "https://x.example/a.png" }, { picture: "freedom-blob:abc", website: "https://w", chains: { solana: "S" } }]) {
      assert.deepEqual(T.profilOffenlegung(p), P.profileDisclosure(p));
    }
    for (const url of [undefined, "https://x.example/a.png", "javascript:alert(1)", "freedom-blob:x"]) assert.equal(T.bildWarnung(url), P.inspectPicture(url).warning);
    for (const q of P.QUESTS) {
      assert.equal(T.aufgabeTitel(q.id), q.title);
      assert.equal(T.aufgabeText(q.id), q.description);
    }
    for (const eingabe of [{}, { backedUp: true, relayDays: 9, activeReferrals: 2 }]) {
      for (const q of P.evaluateQuests({ pubkey: a!, performances: [], ...eingabe })) assert.equal(T.aufgabeStand(q), q.detail, q.quest.id);
    }
    const def = { id: "x", name: "X", description: "", issuerPubkey: b! };
    for (const held of [{ definition: def, source: "verdient" as const, awardedAt: 1, basis: "7 von 7 Tagen." }, { definition: def, source: "verdient" as const, awardedAt: 1 }, { definition: def, source: "verliehen" as const, awardedAt: 1 }, { definition: def, source: "selbst" as const, awardedAt: 1 }]) {
      assert.equal(T.abzeichenHerkunft(held), P.badgeSourceLabel(held as never));
    }
    // Englisch
    setLang("en");
    assert.equal(T.abdeckungHier({ online: true, lora: false, bluetooth: false }), "Providers available in your area. In a network outage there is no radio coverage here — a node would close the gap.");
    assert.equal(T.busFaktorText(1, [{} as never]), "One person alone. If they drop out, the project stops.");
    assert.equal(T.profilOffenlegung({})[0], "An empty profile reveals nothing. That is a valid choice.");
    assert.equal(T.aufgabeStand({ quest: P.QUESTS.find((q) => q.id === "provider_7_tage")!, done: true, zaehler: { ist: 9, soll: 7 } }), "9 of 7 days.");
    assert.match(T.abdeckungEinwilligung("lora"), /^THINK ABOUT THIS\.[\s\S]*Only from 3 nodes[\s\S]*expires\nafter 7 days/);
    assert.equal(t("set.nfPlan", { schwelle: 2, von: 3, frist: 180, warte: 30 }), "2 of 3 trusted people, inactivity period 180 days, waiting time 30 days.");
  } finally {
    setLang(vorher);
  }
});
