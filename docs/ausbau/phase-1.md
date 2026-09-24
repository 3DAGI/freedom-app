# Phase 1 – Fundament: Schlüssel, Speicher, Leak-Tests

Alles Weitere hängt davon ab, dass Schlüssel sauber abgeleitet, getrennt und
geschützt sind. Reihenfolge: 1.0 → 1.1 → 1.2 → 1.3 → 1.4 → 1.5.

---

## 1.0 `app.ts` aufteilen (ohne Verhaltensänderung)

- **Voraussetzung:** Phase 0 fertig.
- **Ziel:** `packages/app/src/shell/app.ts` (über 5.600 Zeilen) in Module je Tab
  zerlegen. Macht alle weiteren Schritte kleiner und erlaubt parallele Arbeit.
- **Neue Dateien:** `shell/state.ts` (gemeinsamer Zustand wie `state`, `pool`),
  `shell/ui.ts` (`$`, `toast`, `escapeHtml`, `ganzeZahl`, `icon`),
  `shell/tabs/agent.ts`, `kommunikation.ts`, `waehrung.ts`, `earn.ts`,
  `profil.ts`, `settings.ts`, `shell/datenschutz.ts`.
- **Vorgehen:**
  1. Zuerst nur die Hilfsfunktionen nach `ui.ts` verschieben; bauen, testen,
     Smoke-Test, Commit.
  2. Dann je Tab ein Commit: Code wörtlich verschieben, Imports ergänzen. Keine
     Umbenennungen, keine Logikänderung.
  3. `boot()` bleibt in `app.ts` und ruft die `wire…()`-Funktionen der Tabs auf.
  4. `build.mjs` bleibt unverändert; esbuild bündelt weiter zu einer Datei, der
     CSP-Hash wird automatisch neu berechnet.
- **Nicht ändern:** Element-IDs, localStorage-Schlüssel, Event-Formate, Texte.
- **Abnahme:** alle Prüfbefehle grün; keine Datei über 1.500 Zeilen; der Diff
  zeigt nur Verschiebungen. Bericht: Tabelle „alte Zeilenbereiche → neue Datei“.
- **MENSCH:** einmal alle Tabs im Browser anklicken, Desktop und Handy.

---

## 1.1 Ein Seed, getrennte Schlüssel – ERLEDIGT (24.09.2026)

> Umgesetzt in `packages/protocol/src/derivation.ts` (SLIP-10, `m/44'/501'/n'/0'`), geprüft gegen die offiziellen SLIP-0010-Testvektoren; Übersicht in `docs/SCHLUESSEL.md`. Noch offen: der Phantom-Abgleich (MENSCH) und die Verdrahtung in der Oberfläche mit Schritt 4.2.

- **Stellen:** `packages/app/src/identity.ts` (heutige NIP-06-Ableitung), neu
  `packages/protocol/src/derivation.ts` mit Tests.
- **Vorgehen:**
  1. `deriveNostr(seed, account = 0)` – Pfad m/44'/1237'/account'/0/0, identisch
     zur heutigen Ableitung.
  2. `deriveSolana(seed, index)` – SLIP-10 Ed25519, Pfad m/44'/501'/index'/0',
     nur gehärtete Schritte. Selbst umsetzen mit HMAC-SHA512 aus `@noble/hashes`
     (Schlüssel „ed25519 seed“), öffentlicher Schlüssel über
     `@noble/curves/ed25519` – keine neue Abhängigkeit nötig.
  3. `deriveBackupKey(seed)` – den bestehenden Pfad aus `state-backup.ts`
     übernehmen, nicht ändern.
  4. Tests mit den offiziellen SLIP-0010-Testvektoren für Ed25519 (Vektor 1 und
     2 der Spezifikation) und ein Test, dass `deriveNostr` für eine feste
     Test-Phrase denselben Schlüssel liefert wie `identity.ts` heute.
  5. Alle Pfade als Tabelle in `docs/SCHLUESSEL.md`.
- **Nicht ändern:** den Nostr-Pfad – bestehende Identitäten müssen gleich bleiben.
- **Abnahme:** Testvektoren grün; `docs/SCHLUESSEL.md` vollständig.
- **MENSCH:** eine reine Test-Phrase in Phantom importieren und prüfen, dass die
  Adresse zu `deriveSolana(seed, 0)` passt; die Adresse als Erwartungswert in den
  Test übernehmen.

---

## 1.2 Verschlüsselter Speicher (Tresor) – CODE FERTIG (24.09.2026)

> Umgesetzt in vier Teilen (#13–#16), Bericht in `STATUS.md` Abschnitte 52–55. Abweichung nach MENSCH-Entscheidung vom 24.09.: erst benutzen, dann einrichten – der Tresor ist Schritt 5 der Sicherheitsliste und der Führung, Pflicht erst vor Geld-Geheimnissen; die Migration läuft beim Einrichten statt beim ersten Start. Passkey (Schritt 2, optional) ist zurückgestellt. Offen: MENSCH-Prüfungen unten.

- **Stellen:** neu `packages/app/src/vault.ts`; alle Geheimnisse im Browser:
  `grep -rn "localStorage\.\(get\|set\)Item" packages/app/src | grep -i "nsec\|mnemonic\|nwc\|agentHistory\|chats\|swap\|secret\|preimage"`
- **Vorgehen:**
  1. `vault.ts`: `createVault(passphrase)`, `unlock(passphrase)`, `lock()`,
     `get(key)`, `set(key, value)`. AES-GCM 256 über WebCrypto; Schlüssel per
     PBKDF2-SHA256 mit 600.000 Iterationen und zufälligem Salt; Daten als ein
     verschlüsselter Blob in IndexedDB, nicht in localStorage.
  2. Optional Passkey: WebAuthn mit PRF-Erweiterung → 32 Byte → HKDF →
     AES-Schlüssel. Nur anbieten, wenn der Browser PRF unterstützt.
  3. Entsperr-Dialog beim Start; automatische Sperre nach 15 Minuten
     Inaktivität (einstellbar).
  4. Migration: beim ersten Start alle Klartextwerte übernehmen, durch
     Entschlüsseln und Vergleichen prüfen, dann löschen.
  5. Keine WASM-Bibliothek ohne Rückfrage – die CSP müsste dafür
     `'wasm-unsafe-eval'` erlauben.
- **Abnahme:** Tests für Rundreise, falsche Passphrase, manipulierte Daten
  (GCM-Tag) und einen Speicher-Scan, der keinen bekannten Schlüssel im Klartext
  findet; Smoke-Test grün.
- **MENSCH:** Entsperren auf Handy und Desktop ausprobieren; prüfen, dass der
  Verlust der Passphrase über die 12 Wörter lösbar ist.

---

## 1.3 Signer-Schnittstelle – CODE FERTIG (24.09.2026)

> Umgesetzt in sechs Teilen (a–f, PRs #17–#22). `keypair.sk` 46 → 0; der rohe Schlüssel liegt nur noch im `LocalSigner` (`mitSchluessel()` für Sicherung, Nachfolge, Swap-Adressen, Export). `Nip46Signer` neu nach NIP-46 statt aus `devices.ts` (dort gab es keine Teile; Entscheidung 24.09.). Anmelden per Bunker unter Settings → Geräte. Offen: MENSCH-Test mit einem echten Bunker.

- **Stellen:** neu `packages/protocol/src/signer.ts`; App: jede Stelle mit
  `keypair.sk` (`grep -rn "keypair.sk" packages/app/src | wc -l` vorher und
  nachher in den Bericht).
- **Vorgehen:**
  1. `interface Signer { publicKey(): string; signEvent(ev): Promise<NostrEvent>;
     nip44Encrypt(peer, text): Promise<string>; nip44Decrypt(peer, text): Promise<string> }`
  2. `interface SolanaSigner { publicKey(): string; signTransaction(tx): Promise<unknown> }`
  3. `LocalSigner` (Schlüssel aus dem Tresor) und `Nip46Signer` (vorhandene Teile
     aus `devices.ts` nutzen).
  4. Alle Aufrufer schrittweise umstellen.
- **Abnahme:** `grep -rn "keypair.sk" packages/app/src` findet nur noch
  `LocalSigner`; Tests für beide Signer.

---

## 1.4 Verdrahtungsprüfung erweitern

- **Stellen:** `scripts/check-wiring.py`.
- **Vorgehen:** zusätzlich alle `export function`, `export async function` und
  `export class` prüfen; Ausnahmen in `scripts/wiring-ausnahmen.txt`, jede mit
  Begründung; Modus `--streng` für die CI.
- **Abnahme:** Auf einem Hilfszweig mit dem Stand vor Schritt 2.1 meldet die
  Prüfung `giftWrap` als unverdrahtet (Ausgabe in den Bericht); die CI nutzt `--streng`.

---

## 1.5 Leak-Tests – CODE FERTIG (24.09.2026)

> Schon da: `packages/protocol/src/leak-rules.ts` (Regeln), `packages/protocol/src/privacy-facts.ts` (Aussagen des Datenschutzberichts, „belegt“ nur mit Szenario – erzwungen durch `test/privacy-facts.test.ts`), DM-Szenarien in `test/private-dm.test.ts`, Verdrahtungstest `packages/app/test/dm-verdrahtung.test.ts`. Der Bericht der App liest `privacyFactsText()`. Seit 1.5a: Aufzeichnungs-Relay `packages/app/test/leak/aufzeichnung.ts`, Regeln für Prompt, Kunden-Schlüssel, bolt11, SOL-Adresse, frische Adresse, verschlüsselte Uploads (`LEAK_REGELN`), Szenarien DM, Anhang, KI-Anfrage, `npm run test:leak` in der CI. Seit 1.5b: Szenarien Raum, Swap, Profil, Abdeckung, SOL-Zahlung (Aufzeichnungs-RPC, echter `lockDeposit`); jede Aussage in `privacy-facts.ts` verweist auf ihre Regel (außer Forward Secrecy und IP – kein Event-Mitschnitt prüft sie). Heutige Lecks als `todo`: Anhänge (2.4), Räume (2.3), Prompt und Kunden-Schlüssel (3.1), SOL-Adresse im Swap und wiederverwendete Zahladresse (4.9).

- **Stellen:** neu `packages/app/test/leak/`, neu
  `packages/protocol/src/privacy-facts.ts`, `privacy-audit.ts`, Datenschutzbericht
  der App, `package.json` der App (Skript `test:leak`).
- **Vorgehen:**
  1. Aufzeichnungs-Relay: dieselbe Schnittstelle wie der Relay-Pool der App
     (`publish`, `query`, `subscribe`), speichert jedes gesendete Event.
     Aufzeichnungs-RPC für Solana ebenso.
  2. Szenarien als Tests: DM senden, Raum-Nachricht, KI-Anfrage, Swap starten,
     Profil speichern, Abdeckung eintragen, Datei anhängen.
  3. Regeln, je eine Testfunktion: keine Kind-4-Events; kein Klartext-Prompt in
     Kind 5xxx; weder Hauptschlüssel noch npub des Kunden als Autor oder p-Tag von
     Job-Events; keine bolt11 und keine Solana-Adresse in öffentlichen Events;
     keine wiederverwendete SOL-Zahladresse; Uploads nur verschlüsselt.
  4. Heute verletzte Regeln als `todo` markieren (node:test
     `{ todo: "Schritt 2.1" }` usw.) – sie werden in ihrem Schritt grün.
  5. `privacy-facts.ts`: Liste von Aussagen, jede mit Verweis auf ihre Regel. Der
     Datenschutzbericht zeigt nur Aussagen, deren Regel grün ist. Ein Test prüft,
     dass jede Aussage eine existierende Regel hat.
  6. CI-Schritt `npm run test:leak`.
- **Abnahme:** Die Leak-Tests laufen, die heutigen Lecks (Kind 4,
  Klartext-Prompts …) stehen sichtbar als `todo`, und der Bericht in der App zeigt
  nur belegte Aussagen.
