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

## 2.2a MLS: Entscheidung und Spike – WARTET AUF MENSCH (25.09.2026)

> Spike erledigt, Vorlage in [`docs/MLS-ENTSCHEIDUNG.md`](../MLS-ENTSCHEIDUNG.md), Quellen unter `docs/mls-spike/`. Das ist kein Workspace-Paket, damit ts-mls nicht ins Lockfile kommt. Empfehlung: MDK per WASM, mit CSP `'wasm-unsafe-eval'`, Rust in CI, eigenem Browser-Speicher und einer grob doppelt so großen App. Die Marmot-Spezifikation ist neu gefasst (app components statt MIPs); ts-mls kennt den MLS-Extensions-Draft nicht.

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

## 2.2b MLS nach Marmot für 1:1 und Gruppen – CODE FERTIG (26.09.2026)

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
- **Aufteilung (26.09.2026):**
  - **2.2b-a – Baustein:** `packages/mls` – MDK (fester Stand) + `mdk.patch` +
    eigene Crate als WASM, reproduzierbar gebaut (`bauen.sh`, CI `mls.yml`);
    API für KeyPackage (Kind 30443), Gruppe, Einladung (Kind 1059), Nachricht
    (Kind 445), Hinzufügen, Entfernen, Konvergenz, Zustand; Brücken zum Signer
    der App, die nur Kontobeweis (Kind 450) und Siegel (Kind 13) signieren;
    Tests nach der Abnahme der Karte (Node). Noch nicht in der App.
  - **2.2b-b – Einbau:** WASM gzip-komprimiert in `freedom.html`, CSP
    `'wasm-unsafe-eval'`, Laden erst bei Bedarf; Smoke-Test.
  - **2.2b-c – Nostr**, geteilt (26.09.2026, zu groß für einen Schritt):
    - **c1 – Konto:** Zustand verschlüsselt (eigene IndexedDB `freedom-mls`,
      Schlüssel in `geheim`), KeyPackages (Platz, Form und Auswahl nach Marmot,
      erneuern, veröffentlichen an die eigenen NIP-65-Schreib-Relays, beim
      Kontakt suchen), Routing der Gruppe (`h`, Relays) aus der Engine.
    - **c2 – Nachrichten:** Einladungen an den Posteingang (Kind 10050),
      Commit vor Einladung, Gruppennachrichten an die Relays der Gruppe mit
      Bestätigung, Abos `#h`, Empfang und Konvergenz; KeyPackage nach einer
      Einladung erneuern; Leak-Regeln. Beides Bausteine – in der Oberfläche
      erst mit d.
  - **2.2b-d – 1:1 als MLS-Gruppe:** in der Oberfläche; NIP-17 als Rückfall für
    Kontakte ohne KeyPackage; mit Bunker (NIP-46) gesperrt, weil der Kontobeweis
    synchron signiert werden muss. Geteilt (26.09.2026):
    - **d1 – Konto und Empfang:** Konto in der App (Engine, Zustand, Verlauf
      verschlüsselt und an die Identität gebunden), KeyPackage beim Öffnen einer
      1:1-Unterhaltung, Einladungen von Kontakten annehmen, Gruppennachrichten
      abholen und im Chat zeigen („· MLS“); gesperrt mit Bunker und als Gerät.
    - **d2 – Senden:** 1:1 standardmäßig als MLS-Gruppe, NIP-17 als Rückfall;
      Datenschutzbericht und Texte. Einladungen von Fremden werden – wie ihre
      NIP-17-Nachrichten – zur „Anfrage“, sonst ginge ihre erste Nachricht verloren.
  - **2.2b-e – Geräte:** mehrere Geräte als eigene Mitglieder. **Entschieden
    26.09.2026 (MENSCH): A**, dazu **MLS nur mit Tresor**. Bis e2: Hat eine
    Seite Geräte (8.6), bleibt es bei NIP-17 (2.2b-d3) – so bekommt jedes Gerät
    weiter jede Nachricht. Geteilt:
    - **e1 – FERTIG:** MLS nur mit Tresor; in 1:1-Gruppen sind beide Seiten Admin (in
      MDK dürfen nur Admins einladen und entfernen – sonst könnte niemand außer
      dem Gründer Geräte aufnehmen); als Gerät ein eigenes Konto unter dem
      Geräteschlüssel, KeyPackage an die Schreib-Relays der Person.
    - **e2 – FERTIG:** Gruppen mit Geräten: gründen mit Person und gültigen Geräten
      beider Seiten (alle Admin), Einladungen an Geräte an den Posteingang der
      Person; vor jedem Senden Mitglieder mit den Vollmachten abgleichen –
      fehlende einladen, entzogene und fremde entfernen, geht das nicht:
      NIP-17; Einladung als 1:1 erkennen, wenn alle Mitglieder zu zwei Personen
      gehören; Nachrichten von Geräten der Person zuordnen (`ordneDmZu`). Dann
      entfällt d3. Grenze: Gruppen, die eine andere App ohne dich als Admin
      gegründet hat, erreichen deine Geräte nicht.
    Die Frage war: Marmot bindet ein Blatt an ein Konto über den
    Kontobeweis (Kind 450) und das KeyPackage (Kind 30443), beide signiert mit
    dem Kontoschlüssel – den hat ein Gerät (8.6c) nicht. Marmots eigenes
    Mehrgeräte-Verfahren ist ein Entwurf („branch draft“, nicht übernommen).
    - **A – Geräte als eigene Mitglieder unter ihrem Geräteschlüssel**
      (Empfehlung, **gewählt**): Wer eine Gruppe gründet oder erweitert, lädt die Person und
      ihre Geräte mit gültiger Vollmacht (`geraeteBuch.kopienFuer()`, wie NIP-17
      seit 8.6b); die App ordnet Geräte über die Vollmacht der Person zu; ein
      Entzug entfernt das Gerät per Commit. Geht ohne Hauptgerät online, ohne
      Entwurf. Nachteil: Andere Marmot-Apps (White Noise) sehen die Geräte als
      eigene Mitglieder.
    - **B – Geräte als weitere Blätter der Person** (Marmot-Weg): Das
      Hauptgerät signiert Kontobeweis und KeyPackage je Gerät (beim Koppeln
      und alle 30 Tage), Beitritt zu bestehenden Gruppen per Einladung oder
      später per Marmot-Entwurf. Nachteil: Hauptgerät muss regelmäßig online
      sein; Teile hängen am Entwurf.
    - **C – vorerst nicht:** Mit Geräten bleibt es bei NIP-17 (heutiger Stand).

---

## 2.3 Räume als MLS-Gruppen

- **Stellen:** `spaces.ts`, `moderation.ts`, `group-crypto.ts` (wird ersetzt), Räume-Ansicht.
- **Vorgehen:** private Räume und Kanäle = MLS-Gruppen; Rollen über MLS-Proposals
  plus eine signierte Rollenliste innerhalb der Gruppe; öffentliche Räume (Kind 42)
  nur als ausdrücklich „öffentlich“ markierte Option; Standard für neue Räume: privat.
- **Abnahme:** Tests mit 50 Mitgliedern, Entfernen samt Schlüsselwechsel,
  Moderatorrechte; der Hinweis bei öffentlichen Räumen ist sichtbar.

> Drei Teile (26.09.2026, Spur B): **a** Baustein – innere Events mit Art und
> Tags im MLS-Baustein, Moderatoren = Admins der Gruppe (per Commit),
> `raum-gruppe.ts`, Engine-Test mit 50 Mitgliedern; **b** Räume in der App
> (privat als Standard, öffentlich nur ausdrücklich); **c** Moderation
> zusammen mit 8.5. Kanäle sind in a eine Ordnung innerhalb der Gruppe – alle
> Mitglieder lesen alle Kanäle; ein Kanal nur für wenige wäre eine eigene Gruppe.

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

## 2.5 Metadaten minimieren – CODE FERTIG (25.09.2026)

> Zwei Teile. a: Ablauf nach NIP-40 je DM-Unterhaltung (im Inhalt exakt, auf dem Umschlag zufällig später, damit er den Sendezeitpunkt nicht verrät; die App blendet Abgelaufenes aus), Kurzzeile im Datenschutzbericht, Wache gegen offene Reaktionen, Lesebestätigungen, Tippanzeigen und Kontaktlisten (die App hat keine davon). b: Kontaktliste optional als NIP-51-Liste (Kind 30000, alle Einträge verschlüsselt an sich selbst), Standard aus. Beim Einschalten wird erst geladen, dann gesichert, und nur bei Änderung; beim Ausschalten wird die Liste geleert. Der Abgleich führt zusammen – Löschen wird nicht übertragen.

- **Vorgehen:** Ablauf nach NIP-40 pro Unterhaltung (mit Hinweis „Löschen ist eine
  Bitte an die Relays“); Lesebestätigungen, Tippanzeige und Reaktionen nur
  innerhalb der Gruppe; Kontaktliste optional privat als verschlüsselte
  NIP-51-Liste (Standard: aus).
- **Abnahme:** Tests und Leak-Regeln grün; der Datenschutzbericht zeigt „Inhalt,
  Absender: verborgen; IP-Adresse: sichtbar ohne Tor“.
