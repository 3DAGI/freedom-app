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

## 6.2 Ehrlicher Modus in der Web-App

- **Vorgehen:** Prüfen, ob ein .onion-Relay erreichbar ist (mit Zeitlimit). Nur
  dann meldet der Bericht „IP-Adresse verborgen“; sonst Hinweis: „native App oder
  Tor Browser nutzen“. Die Aussage kommt aus `privacy-facts.ts` (1.5).
- **Abnahme:** Tests für beide Fälle.

## 6.3 Lightning privat

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
  - **6.3b – offen:** NWC über ein eigenes oder ein .onion-Relay (Einstellung,
    Warnung bei fremdem Klartext-Relay); Empfang über den eigenen Knoten
    (`LnurlDienst`, 8.2b) statt über LNURL-Dienste; ohne öffentliche Adresse
    die Lightning-Adresse bzw. Rechnung eines Kontakts versiegelt erfragen (wie
    die SOL-Adresse, 4.9d); BOLT12 erkennen (Wallet über NWC, Knoten), sonst
    Rechnungen nur verschlüsselt.

## 6.4 Verkehrsmuster – FERTIG (27.09.2026, Spur B)

> Umgesetzt: Kopien einzeln mit Zufallsverzögerung (Standard bis 30 s), Abrufe
> gebündelt im Takt mit Zufall, Bewertung in `docs/MIXNET.md`. Einzelheiten in
> `FORTSCHRITT.md` und `STATUS.md`.

- **Vorgehen:** Gift-Wraps mit zufälliger Verzögerung senden (0–30 Sekunden,
  einstellbar), Abrufe bündeln, Abfrage-Intervalle mit Zufall versehen. Mixnetz
  (etwa Nym) nur als Bewertung in `docs/MIXNET.md`.
