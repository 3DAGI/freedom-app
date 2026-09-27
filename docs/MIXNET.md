# Mixnetz – Bewertung (Schritt 6.4)

Stand 27.09.2026. Nur eine Bewertung: Die App baut kein Mixnetz ein.

## Was ein Mixnetz lösen würde

Verschlüsselung (NIP-44, NIP-17, MLS) schützt Inhalt und Absender. Übrig bleibt
der **Verkehr**: Wer beobachtet, wann eine IP-Adresse etwas an ein Relay schickt
und wann bei einem Empfänger etwas ankommt, kann Gespräche verbinden – ohne
eine Nachricht zu lesen. Tor verbirgt die IP-Adresse vor dem Relay (6.1, 6.2),
nicht aber die Zeitpunkte: Ein Beobachter an beiden Enden (etwa derselbe
Relay-Betreiber, der Absender und Empfänger bedient) sieht, dass zwei Ereignisse
zeitlich zusammenfallen.

Ein Mixnetz (Loopix-Bauart, z. B. **Nym**) mischt Pakete über mehrere Knoten,
hält sie zufällig zurück und füllt die Leitung mit Deckverkehr. Dann sieht auch
ein Beobachter des ganzen Netzes nicht mehr, welches Paket zu welchem gehört.

## Was die App seit 6.4 selbst tut

- **Kopien einzeln verzögert:** Jede Kopie einer Direktnachricht (an den
  Empfänger, an dich, an Geräte) geht mit eigener Zufallsverzögerung hinaus,
  Standard bis 30 Sekunden (Settings → Datenschutz). Vorher gingen sie im selben
  Augenblick hinaus – ein Relay, das Posteingang von Absender und Empfänger ist,
  sah zwei Umschläge gleichzeitig und wusste, wer mit wem schreibt, obwohl jeder
  einen Wegwerf-Schlüssel trägt.
- **Abrufe gebündelt, mit Zufall:** Posteingang, private Räume und Urteile
  laufen in einem gemeinsamen Takt mit zufälligem Abstand (etwa 15–45 s je
  Schlag) statt in festen Rastern je Funktion, an denen man die App erkennt.
- **Zeitstempel verschleiert** (schon seit 2.1/2.5): Umschläge tragen eine
  zufällige Zeit in der Vergangenheit, der Ablauf eine zufällig spätere.

Das ist kein Mixnetz: Die Verzögerung verbirgt nicht, **dass** du zu einer Zeit
aktiv warst, nur **welche** Umschläge zusammengehören. Die IP-Adresse sieht das
Relay weiterhin (außer über Tor).

## Nym im Browser – Befund

| Frage | Befund |
|---|---|
| Läuft es in einer Web-App? | Nym bietet ein SDK als WebAssembly und einen „mixFetch“ für HTTP. WebSockets zu beliebigen Relays gehen nicht direkt; der Verkehr endet an einem **Exit** („Network Requester“), der ihn ins normale Netz gibt. |
| Wer sieht was? | Der Exit sieht Ziel-Relay und Inhalt der Verbindung (bei `wss://` nur TLS). Das Relay sieht den Exit statt deiner IP – wie bei Tor. |
| Latenz | Sekunden je Anfrage (Mischverzögerung plus Deckverkehr). Für Direktnachrichten tragbar, für Live-Abos (KI-Antworten, Swaps mit Fristen) nicht. |
| Größe und CSP | Das WASM-Paket ist mehrere MB groß und bräuchte `'wasm-unsafe-eval'` – das steht seit 2.2b-b nur für die MLS-Engine drin. Weiteres WASM ist eine MENSCH-Entscheidung (CLAUDE.md). |
| Kosten | Nym-Bandbreite wird mit NYM-Token bezahlt („zk-nyms“). Das wäre eine dritte Währung neben Sats und SOL – widerspricht Ziel 1 (Sats und SOL gleichwertig). |
| Abhängigkeit | Ein weiterer Dienst mit eigenem Token und eigener Knotenliste; fällt er aus, braucht die App einen Rückweg ohne Mixnetz. |

## Empfehlung

1. **Jetzt:** Verzögerung und gebündelte Abrufe (6.4) plus Tor, wo verfügbar
   (6.1 native Apps mit eingebautem Tor, 6.2 ehrliche Anzeige im Browser).
2. **Kein Nym in der Web-App**, solange Bezahlung nur in NYM-Token geht und
   weiteres WASM nötig wäre. Die Einstellung „Mixnetz“ in Settings →
   Datenschutz bleibt ehrlich: „nur wirksam, wenn du selbst eines nutzt“ (etwa
   NymVPN auf dem Gerät).
3. **Später prüfen:** ein Mixnetz nur für den Versand von Direktnachrichten
   (nicht für Live-Abos), in den nativen Apps (6.1) neben Tor – sobald es ohne
   eigenen Token bezahlbar ist oder ein Betreiber aus dem Netz einen Exit
   stellt.

## Offen

- Deckverkehr (leere Umschläge in zufälligen Abständen) würde auch verbergen,
  **wann** du schreibst. Er kostet Relay-Speicher und bei bezahlten Relays Geld;
  ohne Absprache mit den Relay-Betreibern (8.4) nicht einbauen.
- MLS-Gruppennachrichten (Kind 445) gehen als ein Event je Nachricht an die
  Relays der Gruppe – dort gibt es keine Kopien, die zusammenfallen könnten; sie
  gehen sofort hinaus.
