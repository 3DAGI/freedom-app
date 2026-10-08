# Phase 6 – Netzwerk-Privatsphäre

Verschlüsselung schützt Inhalte und Absender, nicht die IP-Adresse gegenüber
Relays, RPC-Anbietern und Lightning-Diensten.

## 6.1 Native Apps mit eingebautem Tor

- **Stellen:** neu `packages/launcher/` (Tauri 2), lädt `dist/freedom.html`.
- **Vorgehen:**
  1. Die Rust-Seite startet arti (Tor in Rust) und stellt der App eine lokale
     Brücke bereit: WebSocket- und HTTP-Weiterleitung nur für die App, auf
     127.0.0.1, zufälliger Port, zufälliges Zugangstoken.
  2. Läuft die App in der Hülle (`window.__FREEDOM_NATIVE__`), leitet sie Relay-,
     RPC-, NWC- und LNURL-Verbindungen über die Brücke; .onion-Relays sind erlaubt.
  3. Umschalter „Direkt / Tor“ mit Hinweis auf das langsamere Tempo.
  4. Falls in 2.2a so entschieden: MDK nativ über Rust einbinden.
- **Abnahme:** Test mit Aufzeichnungs-Relay in einer Testumgebung: Im Tor-Modus
  kommt keine Verbindung von der echten IP-Adresse.
- **MENSCH:** Builds für Desktop und Android testen; für iOS klären, ob Tor dort
  zulässig und umsetzbar ist.
- **Aufteilung (Spur C, C-23, 07.10.2026 nach Entscheidung N2):** a Desktop
  (Linux, Windows) – a1 Hülle ✓ (eigenes Schema, Navigation nur im eigenen
  Ursprung, CI), a2 Update der Oberfläche prüfen ✓ (Release-Manifest 38054, k von
  n, nie älter als die laufende), a3 Update installieren (die Hülle prüft
  Signaturen und Prüfsumme selbst – a3a ✓ mit `k256`; a3b ✓ Ablage, alte Fassung als
  Rückfall nur über den Start; a3c ✓ Knopf in der App), a4a Pakete ✓ (deb,
  AppImage, Installer für Windows – als Artefakt der CI, unsigniert), a4b
  Selbst-Update der Hülle (Signierschlüssel: MENSCH); b Tor – arti freigegeben
  07.10.2026, Desktop zuerst: b1a ✓ Hülle (SOCKS5 nur fürs eigene Webview, Wahl
  Direkt/Tor, nie still direkt), b1b ✓ Schalter in der App, b2 Android – b2a ✓ Hülle (HTTP CONNECT, Proxy über androidx.webkit, Warteseite bis er gilt), b2b Schalter in der App; c Android – c1 ✓ APK zum Testen (CI, Wegwerf-Schlüssel je Lauf), c2 fester
  Schlüssel und Verteilung (MENSCH). Schritt 1–3 oben gehören zu b.

## 6.2 Ehrlicher Modus in der Web-App

- **Vorgehen:** Prüfen, ob ein .onion-Relay erreichbar ist (mit Zeitlimit). Nur
  dann meldet der Bericht „IP-Adresse verborgen“; sonst Hinweis: „native App oder
  Tor Browser nutzen“. Die Aussage kommt aus `privacy-facts.ts` (1.5).
- **Abnahme:** Tests für beide Fälle.

## 6.3 Lightning privat – FERTIG (28.09.2026, Spur B)

> Umgesetzt in a, b1 und b2: Lightning-Adresse im Profil nur auf Wunsch, Zaps
> anonym, Rechnungen versiegelt beim Kontakt erfragt (Empfang mit der eigenen
> Wallet, ohne LNURL-Dienst), NWC auf Wunsch nur über eigenes oder
> .onion-Relay, BOLT12 erkannt. Einzelheiten in `FORTSCHRITT.md` und `STATUS.md`.

- **Vorgehen:** NWC über ein eigenes oder ein .onion-Relay (Einstellung); Empfang
  über den eigenen Knoten statt über LNURL-Dienste; BOLT12 dort, wo Wallet und
  Knoten es unterstützen (erkennen), sonst Rechnungen nur verschlüsselt; keine
  Lightning-Adresse im öffentlichen Profil als Standard.
- **Abnahme:** Leak-Regel: keine Rechnung und keine Lightning-Adresse öffentlich
  neben einer Identität.
- **Übernommen von Spur A (Spur B, 28.09.), Aufteilung:**
  - **6.3a – FERTIG:** Leak-Regeln `keine-ln-adresse` (keine Lightning-Adresse
    des Nutzers in öffentlichen Events) und `zap-anonym` (Zap-Anfragen nie von
    der Identität, immer „anon“). Lightning-Adresse im Profil nur mit Häkchen
    (`oeffentlichesProfil()`, `profil-lightning.ts`; wer vor 6.3 eine
    gespeichert hatte, hat sie veröffentlicht – das übernimmt die Einstellung
    einmal), Befund „ln-profil“ im Datenschutzbericht. Zaps im Chat anonym nach
    NIP-57 (`buildAnonZapRequest()`, Wegwerf-Schlüssel je Zap) – die Quittung
    des Empfänger-Servers nennt den Zahler nicht. Aussage „ln-oeffentlich“ mit
    Szenario.
  - **6.3b1 – FERTIG:** Rechnung versiegelt erfragen (`ln-rechnung.ts`, Kind
    25022/25023 im Umschlag): Ohne öffentliche Adresse fragt der Zap-Dialog den
    Empfänger nach einer Rechnung über den Betrag; dessen App antwortet nur
    Kontakten, nur auf frische Anfragen, gebremst, mit einer Rechnung der
    eigenen Wallet (NWC `make_invoice`) – Empfang ohne LNURL-Dienst. Der Zahler
    nimmt nur eine gültige Rechnung über genau den Betrag. Aussage
    „ln-rechnung“ mit Szenario.
  - **6.3b2 – FERTIG:** Einstellung „NWC nur über mein eigenes oder ein
    .onion-Relay“ (Währung → Lightning, eigenes Relay als Feld):
    `waehleNwcRelays()` nimmt nur diese aus der Verbindung der Wallet, nennt sie
    keines, verbindet die App nicht (statt still über ein fremdes); sonst
    Befund „nwc-relay-fremd“ im Datenschutzbericht. BOLT12 erkannt
    (`bolt12Methoden()`, Anzeige im Status) – NIP-47 legt die Methoden noch
    nicht fest, darum bleibt es bei versiegelten Rechnungen (6.3b1).
    Provider-Knoten empfangen schon über den eigenen LND (`LnurlDienst`, 8.2b).
    Nebenbei: die SOL-Adress-Anfrage (4.9d) geht an den Posteingang.

## 6.4 Verkehrsmuster – FERTIG (27.09.2026, Spur B)

> Umgesetzt: Kopien einzeln mit Zufallsverzögerung (Standard bis 30 s), Abrufe
> gebündelt im Takt mit Zufall, Bewertung in `docs/MIXNET.md`. Einzelheiten in
> `FORTSCHRITT.md` und `STATUS.md`.

- **Vorgehen:** Gift-Wraps mit zufälliger Verzögerung senden (0–30 Sekunden,
  einstellbar), Abrufe bündeln, Abfrage-Intervalle mit Zufall versehen. Mixnetz
  (etwa Nym) nur als Bewertung in `docs/MIXNET.md`.
