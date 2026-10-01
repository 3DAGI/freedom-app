# Provider werden – in beiden Schienen verdienen

Stand 8.2c (28.09.2026). Kurzfassung für Betreiber eines Knotens; Einzelheiten
zum Zahlkanal in `docs/ZAHLKANAL.md`, zum Tausch in `docs/SWAPS.md`.

## Einrichten

```bash
curl -fsSL https://freedomstack.io/install.sh | bash      # oder: bash scripts/install-freedom.sh
```

Der Installer fragt die **Lightning-Adresse** (dorthin zahlt die App deinen
Anteil) und optional die eigene **SOL-Auszahlungsadresse**. Mit ihr legt er den
Solana-Schlüssel des Knotens an (`~/.freedom/solana-kanal.json`, nur für dich
lesbar) und schaltet den Zahlkanal ein. Auf die Adresse des Knotens gehören
etwa 0,01 SOL für die Gebühren der Einlösungen; was er verdient, bringt er
gebündelt an deine Auszahlungsadresse (einmal am Tag, ab 0,1 SOL).

## Prüfen

```bash
cd ~/freedomstack/packages/node && npm run pruefen          # Docker: docker compose exec node npm run pruefen
```

Dasselbe steht beim Start im Log (`[einrichtung]`). Geprüft wird, was die App
zum Bezahlen braucht: Die Lightning-Adresse stellt aus dem Browser (CORS)
Rechnungen über kleine Beträge aus; der Zahlkanal-Schlüssel passt, das
Programm liegt auf der Kette, es ist SOL für Gebühren da, die Auszahlung ist
eingerichtet. ✗ heißt: So verdient der Knoten nicht.

## Lightning beim eigenen Knoten (8.2b)

Eine Lightning-Adresse bei einem verwahrenden Dienst ist bequem, aber das Geld
gehört bis zur Auszahlung dem Dienst. Mit einem eigenen LND stellt der Knoten
die Rechnungen selbst aus:

1. Eine Macaroon, die **nur Rechnungen** darf – der Knoten startet mit keiner
   anderen:
   `lncli bakemacaroon invoices:read invoices:write --save_to ~/.freedom/lnurl.macaroon`
2. In der Umgebung des Knotens:
   `LNURL_ENABLED=1`, `LNURL_BASE_URL=https://knoten.example.org`,
   `LNURL_LND_MACAROON=~/.freedom/lnurl.macaroon`, `LND_REST=https://127.0.0.1:8080`
   (selbstsigniertes Zertifikat nur lokal: `LND_INSECURE_TLS=1`), optional
   `LNURL_NAME` (Standard `provider`), `LNURL_PORT` (Standard 3601).
3. Ein Reverse-Proxy mit TLS leitet zwei Pfade an `127.0.0.1:3601` weiter,
   z. B. mit Caddy:

   ```
   knoten.example.org {
     reverse_proxy /.well-known/lnurlp/* 127.0.0.1:3601
     reverse_proxy /lnurlp/* 127.0.0.1:3601
   }
   ```
4. `NODE_LUD16=provider@knoten.example.org` – dann `npm run pruefen`.

Mit Docker ist `127.0.0.1` der Container selbst: LND dann über das Netz des
Hosts erreichbar machen (`network_mode: host`) oder mit einem Zertifikat, dem
der Container vertraut – ein selbstsigniertes nimmt der Knoten nur lokal an.

Der Server nimmt keine Kommentare an, stellt höchstens 30 Rechnungen je
Minute aus (`LNURL_PRO_MINUTE`) und gibt nach außen nie Meldungen von LND
weiter. Die Rechnung trägt als Beschreibung den Hash der Metadaten (LUD-06).

## Tor (8.2c)

Mit `TOR_SOCKS=127.0.0.1:9050` (ein laufender Tor-Dienst) gehen alle
Verbindungen des Knotens zu Relays durch Tor: Die Relays sehen die Adresse
eines Tor-Ausgangs statt deiner. Den Namen eines Relays löst Tor auf, nicht
dein Rechner – `.onion`-Relays gehen damit auch. Ist `TOR_SOCKS` gesetzt, aber
ungültig, startet der Knoten nicht; ist Tor nicht erreichbar, verbindet er
gar nicht – nie still ohne Tor.

**Nicht** über Tor gehen: Solana-RPC (sieht die Adresse deines Knotens),
LND, Ollama, die Abrufe der Werkzeuge des Agenten, Modell-Downloads und die
Selbstprüfung.

Der eigene Relay als Onion-Dienst, in der `torrc`:

```
HiddenServiceDir /var/lib/tor/freedom-relay/
HiddenServicePort 80 127.0.0.1:7777
```

Dann `RELAY_PUBLIC_URL=ws://<adresse>.onion` (aus
`/var/lib/tor/freedom-relay/hostname`). Erreichbar ist er nur für Clients mit
Tor – die App erkennt das und sagt es im Datenschutzbericht (6.2).

## Die App vom eigenen Knoten (B-10)

Der Relay liefert auf seinem Port auch die App aus, aber nur einen
reproduzierbaren Build mit bekannter Prüfsumme:

```bash
cd ~/freedomstack/packages/app && node build.mjs          # baut dist/freedom.html und zeigt die SHA-256
```

In der Umgebungsdatei setzt du `APP_SHA256=<64 Hex-Zeichen>`. Die Summe nimmst
du von der Website (Startseite, `freedom.html.sha256`), aus dem Release oder aus
`bash scripts/repro-build.sh`.
- `APP_DATEI` ist nur nötig, wenn die Datei woanders liegt. Standard ist
  `packages/app/dist/freedom.html` im eigenen Checkout.
- Der Knoten prüft die Datei beim Start und liefert danach nur die geprüfte
  Fassung aus dem Speicher – eine spätere Änderung der Datei geht nie hinaus.
- Ist die Summe anders, liefert er nichts aus. Im Log steht dann
  `[app] nicht ausgeliefert: …`.
- Gleiche Summe heißt: derselbe Quelltext, dieselbe Node-Hauptversion
  (`.nvmrc`) und dieselben Abhängigkeiten.

Erreichbar ist die App so:
- **Im Heimnetz:** unter `http://<rechner>:7777/`, also auf demselben Port wie
  der Relay (nur mit `RELAY_ENABLED=1`).
- **Über Tor:** mit dem Onion-Dienst oben unter `http://<adresse>.onion/`.
- **Prüfsumme:** sie steht unter `/freedom.html.sha256` und im ETag, zum
  Vergleich mit der Website.

**Grenzen über http im Heimnetz:**
- Der Browser zählt die Seite nicht als sicheren Kontext. WebCrypto fehlt dann,
  also gibt es keinen Tresor. Damit fehlt auch alles, was einen Tresor braucht
  (Wallet verbinden, MLS), und die Kamera. Die App sagt das, wenn man den Tresor
  einrichten will.
- Wer sich im selben Netz dazwischenschaltet, kann die Datei unterwegs verändern.
- Sicher sind `.onion` im Tor Browser und `http://localhost` auf dem Rechner
  des Knotens selbst.
- Die App unter einer neuen Adresse hat eigene Daten. Die Identität kommt per
  Schlüssel mit oder als Gerät (Settings → Geräte).

## Mit dem Besitzer koppeln (B-8)

```bash
cd ~/freedomstack/packages/node && npm run koppeln           # Docker: docker compose exec node npm run koppeln
```

Zeigt den Kopplungscode als QR und als Text; beim ersten Aufruf entsteht ein
Geheimnis in `~/.freedom/kopplung.json` (nur für den Knoten lesbar). Das
Gerät des Besitzers liest ihn ein – in der App unter Settings → Geräte →
„Mein Knoten koppeln“. Danach rechnet der Knoten Anfragen dieses Geräts gratis, ohne
Gebot und ohne Kontingent; erkannt wird der Besitzer nur an einem Nachweis im
versiegelten Auftrag, nie offen. Der Code ist ein Schlüssel: nur dem eigenen
Gerät zeigen. `npm run koppeln -- --neu` erzeugt ein neues Geheimnis – alle
bisher gekoppelten Geräte gelten dann nicht mehr als Besitzer. Im Log steht
beim Start `[kopplung] mit dem Besitzer gekoppelt` oder `nicht gekoppelt`.

Mit `STORAGE_ENABLED=1` hält der Knoten verschlüsselte Dateien seines
Besitzers dauerhaft (B-9b): Nach jedem Hochladen (Repo-Bundles, Anhänge)
schickt die App einen versiegelten Auftrag mit dem Nachweis – abschaltbar unter
Settings → Geräte → „Mein Knoten“. Der Knoten holt die Stücke von den Relays
und verdrängt sie nie.
Sie zählen zur Quota (`STORAGE_QUOTA_MB`); ist sie damit voll, hält er keine
weiteren. Welche er hält, steht in `gehalten.json` im Speicherordner – nur
Prüfsummen, keine Namen. Im Log steht `[speicher] für den Besitzer gehalten: …`.

## Was die Kette zeigt

Dein Knoten hat **eine** SOL-Adresse: Alle Zahlkanäle an ihn und seine
Auszahlungen sind auf der Kette miteinander verbunden (Entscheidung 4.5 A,
im Datenschutzbericht unter „Bewusste Grenzen“). Wer das nicht will, nimmt nur
Lightning an.
