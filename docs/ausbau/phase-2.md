# Phase 2 – Ende-zu-Ende-verschlüsselte Kommunikation

Erst NIP-17, weil der Code schon existiert; dann MLS nach dem Marmot-Protokoll
für Forward Secrecy. NIP-17 bleibt Rückfall für Kontakte ohne MLS.

---

## 2.1 Direktnachrichten nach NIP-17 – CODE ERLEDIGT (24.09.2026)

> Umgesetzt in `packages/protocol/src/private-dm.ts` und in `sendChatMessage()`, `ladeDmNachrichten()`, `syncDmInbox()`, `newDm()` in `app.ts`; `giftUnwrap()` prüft die Siegel-Signatur. Tests: `test/private-dm.test.ts`, `test/privacy-facts.test.ts`, `app/test/dm-verdrahtung.test.ts`. **Offen:** Veröffentlichung und der Interop-Test mit Amethyst oder 0xchat (MENSCH). Die folgende Karte bleibt als Referenz.

- **Voraussetzung:** 1.3 und 1.5.
- **Stellen:** `sendChatMessage()` und `loadChatMessages()` (Kommunikation),
  `packages/protocol/src/gift-wrap.ts` (`giftWrap`, `giftUnwrap` vorhanden),
  Abo eingehender DMs, `DMS_GIFT_WRAPPED`, Dialog „neue DM“.
- **Vorgehen:**
  1. Senden: Rumor Kind 14 (unsigniert, Tag `["p", empfänger]`) → Seal Kind 13 →
     Gift-Wrap Kind 1059 an den Empfänger UND eine zweite Hülle an dich selbst,
     damit eigene Geräte den Verlauf sehen. Zeitstempel der Hüllen zufällig bis zu
     zwei Tage zurück.
  2. Relays: Posteingangs-Relays des Empfängers aus Kind 10050 lesen; die eigene
     Liste als Kind 10050 veröffentlichen (Einstellung unter Settings); Rückfall
     auf gemeinsame Relays.
  3. Empfangen: Abo auf Kind 1059 mit `#p` = eigener Schlüssel; entpacken; der
     pubkey des Seals und der pubkey des Rumors müssen übereinstimmen, sonst
     verwerfen.
  4. Alte Kind-4-Nachrichten weiter anzeigen, markiert „ältere Verschlüsselung“;
     nie mehr Kind 4 senden.
  5. `DMS_GIFT_WRAPPED = true`; Beschriftung: „Relays sehen nicht, wer schreibt –
     nur, dass du eine Nachricht erhältst.“
  6. npub-Eingabe im Dialog „neue DM“ in Hex umwandeln (`decodeNpub`).
- **Abnahme:** Leak-Regel „keine Kind-4-Events“ grün (todo entfernt); Tests für
  Senden, Empfangen, Selbstkopie, gefälschten Seal und npub-Eingabe.
- **MENSCH:** Nachricht hin und zurück mit Amethyst oder 0xchat.

---

## 2.2a MLS: Entscheidung und Spike

- **Ziel:** festlegen, ob die Web-App MDK (Rust, Marmot-Referenz, per WASM) oder
  ts-mls (TypeScript, nicht auditiert) nutzt.
- **Vorgehen:** Spike in `packages/mls-spike/`, nicht in die App bündeln:
  (a) MDK mit wasm-pack bauen – Größe, Bauaufwand, CSP-Folgen (braucht
  `'wasm-unsafe-eval'`); (b) ts-mls – Gruppe mit zwei Mitgliedern, Nachricht,
  Mitglied entfernen. Die Marmot-Spezifikation (MIPs, GitHub-Organisation
  `marmot-protocol`) lesen und die Pflichtteile auflisten.
- **Ergebnis:** `docs/MLS-ENTSCHEIDUNG.md` mit Tabelle (Größe, Audit-Stand,
  Interop mit White Noise, Aufwand, CSP) und Empfehlung. Dann STOPP.
- **MENSCH:** entscheiden.

---

## 2.2b MLS nach Marmot für 1:1 und Gruppen

- **Voraussetzung:** 2.2a entschieden.
- **Vorgehen:**
  1. KeyPackages veröffentlichen und regelmäßig erneuern.
  2. Gruppe anlegen; Einladung (Welcome) per Gift-Wrap.
  3. Gruppennachrichten wie in Marmot: je Nachricht ein Wegwerfschlüssel,
     Gruppen-ID gehasht.
  4. Gruppenzustand im Tresor (1.2); mehrere Geräte als eigene Mitglieder.
  5. 1:1 standardmäßig als MLS-Gruppe; NIP-17 als Rückfall für Kontakte ohne KeyPackage.
- **Nicht ändern:** den NIP-17-Pfad – er bleibt Rückfall.
- **Abnahme:** Tests für Nachricht, Hinzufügen, Entfernen (entferntes Mitglied
  liest nach dem Commit nichts mehr), Reihenfolge und Wiederholung. Leak-Regeln:
  Relays sehen nur Chiffretext, gehashte Gruppen-IDs und nicht verknüpfbare Schlüssel.
- **MENSCH:** Interop-Test mit White Noise.

---

## 2.3 Räume als MLS-Gruppen

- **Stellen:** `spaces.ts`, `moderation.ts`, `group-crypto.ts` (wird ersetzt), Räume-Ansicht.
- **Vorgehen:** private Räume und Kanäle = MLS-Gruppen; Rollen über MLS-Proposals
  plus eine signierte Rollenliste innerhalb der Gruppe; öffentliche Räume (Kind 42)
  nur als ausdrücklich „öffentlich“ markierte Option; Standard für neue Räume: privat.
- **Abnahme:** Tests mit 50 Mitgliedern, Entfernen samt Schlüsselwechsel,
  Moderatorrechte; der Hinweis bei öffentlichen Räumen ist sichtbar.

---

## 2.4 Verschlüsselte Anhänge – CODE FERTIG (25.09.2026)

> Zwei Teile: a Protokoll-Baustein `datei-krypto.ts` (AES-256-GCM je Datei; Schlüssel, Nonce und Klartext-Hash nur in der Nachricht) und b App. Chat-Anhänge über 32 KB gehen nur verschlüsselt ins Blob-Netz oder zu Blossom, ohne Name und Typ. Kleinere reisen inline in der DM und sind damit verschlüsselt. Der Empfänger lädt, entschlüsselt und prüft. Git-Bundles bleiben mit Absicht öffentlich. In Räumen steht der Schlüssel bis 2.3 so offen wie der Text. MLS/MIP-04 folgt mit 2.2b. Nebenbei behoben: Der Download nahm nie einen Chunk vom Relay an, und DMs mit Anhängen ab etwa 48 KB sprengten die NIP-44-Grenze.

- **Stellen:** `packages/app/src/blob-client.ts`, Anhänge im Chat.
- **Vorgehen:** AES-GCM mit zufälligem Schlüssel je Datei vor dem Upload;
  Schlüssel, Nonce, Hash, Typ und Größe nur in der verschlüsselten Nachricht; bei
  MLS nach Marmot MIP-04 (Schlüssel aus dem Gruppen-Exporter). Vorschaubilder
  ebenfalls verschlüsselt.
- **Abnahme:** Leak-Regel „Uploads nur verschlüsselt“ grün; Tests: Upload ≠
  Klartext, Entschlüsseln klappt, Manipulation fällt auf.

---

## 2.5 Metadaten minimieren – IN ARBEIT

> Aufgeteilt: a Ablauf nach NIP-40 je DM-Unterhaltung (im Inhalt exakt, auf dem Umschlag zufällig später, damit er den Sendezeitpunkt nicht verrät; die App blendet Abgelaufenes aus), Kurzzeile im Datenschutzbericht, Wache gegen offene Reaktionen, Lesebestätigungen, Tippanzeigen und Kontaktlisten (die App hat keine davon) ✓; b Kontaktliste optional privat als verschlüsselte NIP-51-Liste (Standard: aus).

- **Vorgehen:** Ablauf nach NIP-40 pro Unterhaltung (mit Hinweis „Löschen ist eine
  Bitte an die Relays“); Lesebestätigungen, Tippanzeige und Reaktionen nur
  innerhalb der Gruppe; Kontaktliste optional privat als verschlüsselte
  NIP-51-Liste (Standard: aus).
- **Abnahme:** Tests und Leak-Regeln grün; der Datenschutzbericht zeigt „Inhalt,
  Absender: verborgen; IP-Adresse: sichtbar ohne Tor“.
