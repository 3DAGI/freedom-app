# Provider werden – in beiden Schienen verdienen

Stand 8.2c (28.09.2026). Kurzfassung für Betreiber eines Knotens; Einzelheiten
zum Zahlkanal in `docs/ZAHLKANAL.md`, zum Tausch in `docs/SWAPS.md`.

## Einrichten

```bash
bash <(curl -fsSL https://3dagi.github.io/freedom-app/install.sh)   # oder aus dem Repo: bash scripts/install-freedom.sh
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
LND, Ollama, die Abrufe der Werkzeuge des Agenten, Modell-Downloads samt Vorprüfung
bei `registry.ollama.ai` (E9-3) und die Selbstprüfung.

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

**Status (B-11):** Unter Settings → Geräte → „Mein Knoten“ fragt „Status
abfragen“ den Knoten versiegelt nach seinem Stand. Er antwortet nur dem
gekoppelten Besitzer mit:
- Fassung und gestarteten Rollen;
- Modellen;
- Aufträgen und Abgerechnetem seit dem Start;
- Speicher und Relay;
- der Prüfung der Einrichtung vom Start, wie bei `npm run pruefen`, aber ohne Adressen.

Steuern lässt sich der Knoten aus der App nicht.

**Wecken (B-12):** Ist die App zu, weckt der Knoten den Browser des
Besitzers per Web Push – ohne Inhalt und ohne Absender.
- **Schlüssel:** Beim ersten Start legt er einen eigenen VAPID-Schlüssel an
  (`~/.freedom/vapid.json`, nur für ihn lesbar).
- **Push-Adressen:** Angemeldete Adressen liegen in `~/.freedom/wecken.json` –
  ein Zugang zu deinen Browsern, nie weitergeben.
- **Wann er weckt:** Alle 30 s sieht der Knoten nach, ob neue Umschläge an die
  gemeldeten Schlüssel liegen. Er sucht im eigenen Relay und in den Relays aus
  `RELAYS`. Die Relays sehen dabei, dass dein Knoten nach Post an diese
  Schlüssel fragt.
- **Nur im eigenen Relay:** Mit `WECKEN_RELAYS=eigen` sucht er nur dort. Dann
  weckt nur Post, die dort ankommt – etwa wenn sein Relay dein Posteingang ist.
- **Gebremst:** Höchstens ein Weckruf je Browser und Minute.
- **Abgelaufen:** Eine Adresse, die der Push-Dienst nicht mehr kennt, vergisst er.
- **Kontakt im VAPID-Token:** Standard ist die Projektseite;
  `WECKEN_KONTAKT=mailto:…` oder `https://…` ersetzt sie.
- **Grenze:** Relays, die Umschläge nur an angemeldete Empfänger geben, kann der
  Knoten nicht beobachten – Post dort weckt nicht.

**Alles über meinen Knoten (B-9c):** Mit dem Haken unter Settings → Geräte →
„Mein Knoten“ schickt die App KI-Anfragen an deinen Knoten und Halte-Aufträge
nur an sein Relay, nie an fremde. Dafür braucht der Knoten `RELAY_ENABLED=1`.
Die App findet das Relay auf einem von zwei Wegen:
- `RELAY_PUBLIC_URL` (wss:// oder ws://….onion): Der Knoten kündigt sie in
  seiner Relay-Liste an.
- Die App kommt vom Knoten selbst (oben).

Findet sie kein Relay, geht nichts an den Knoten. Der Knoten liest sein Relay
im eigenen Prozess, eine Verbindung zu sich selbst in `RELAYS` ersetzt er. An
seinem Relay meldet sich die App mit dem Schlüssel der jeweiligen Anfrage an,
nur so bekommt sie die versiegelte Antwort.

## Modelle laden, geprüft (E9-3)

```bash
cd ~/freedomstack/packages/node
npm run modell -- qwen2.5:0.5b --aus-registry   # beim ersten Mal: festhalten, was die Registry jetzt nennt
npm run modell -- qwen2.5:0.5b                  # später: erneut laden und gegen das Festgehaltene prüfen
npm run modell                                  # Stand: geprüft, lädt, gescheitert
# Docker: docker compose exec node npm run modell -- qwen2.5:0.5b --aus-registry
```

Der Name ist der Name bei Ollama. `npm run modell` merkt den Wunsch nur vor
(`~/.freedom/modell-wunsch.json`); der laufende Knoten erledigt den Rest:

1. **Manifest:** Es zählt nur ein Modell-Manifest (Kind 38057), das der Knoten
   selbst signiert hat. Mit `--aus-registry` legt er es an: Er fragt
   `registry.ollama.ai`, welche Dateien das Modell jetzt hat, signiert daraus
   sein Manifest und veröffentlicht es. Ohne `--aus-registry` sucht er es über
   seine Relays. Manifeste von Kuratoren aus Modellkatalogen kommen später
   dazu (E9-4); einen voreingestellten Herausgeber gibt es nicht.
2. **Speicher prüfen:** Er prüft, ob das Modell in den Speicher passt –
   `MODELL_SPEICHER_GB`, sonst der Arbeitsspeicher des Rechners.
3. **Vorab vergleichen:** Nennt die Registry andere Dateien als das Manifest,
   lädt er nichts. Das ist der Fall, wenn das Modell dort seit dem Festhalten
   ersetzt wurde: Wer die neue Fassung will, hält sie mit `--aus-registry`
   neu fest.
4. **Laden:** Ollama lädt und prüft jede Schicht gegen ihre Summe.
5. **Abgleichen:** Erst wenn die geladenen Schichten genau die des Manifests
   sind, steht das Modell im Angebot – neben `PROVIDER_MODELS`, wie bisher.

Lädt jemand unter demselben Namen später etwas anderes in Ollama, fällt das
Modell aus dem Angebot. Gemerkt wird das mit dem Fingerabdruck, den Ollama
nennt (`~/.freedom/modelle.json`). Im Log steht `[modell] <name>: geprüft, im
Angebot` oder `nicht angeboten (<Kennung>)`; `npm run modell` zeigt dazu den
Grund.

Die Prüfung sagt nur, ob die Bytes die festgehaltenen sind – nicht, ob ein
Modell gut, sicher oder legal ist. Ein Manifest für Ollama hat:
- `model`: den Namen bei Ollama, mit Tag;
- `upstream`: `ollama:<derselbe Name>`;
- je Datei den Namen ihres Blobs (`sha256-<hex>`), mit Summe und Größe – alle
  Schichten und die Konfiguration aus dem Manifest der Registry.

## Anrufe über den eigenen Knoten (B-13, im Aufbau)

Anrufe laufen nur über einen Vermittler (TURN) auf deinem Knoten – dein
Gegenüber sieht nie deine IP. Den Vermittler stellt coturn als eigener Dienst;
der Knoten vergibt dafür nur kurzlebige Zugänge an deine Geräte.

- **coturn einrichten (B-13b):**
  - **Installer:** Er fragt nach dem öffentlichen Namen dieses Rechners
    (`TURN_NAME`, leer: keine Anrufe), installiert coturn und richtet den Dienst
    `freedom-turn` ein. Er läuft als du, mit `~/.freedom/turnserver.conf`.
  - **Docker:** einmal
    `bash scripts/turn-einrichten.sh ./turnserver.conf <name> --docker >> .env`,
    dann `docker compose --profile anrufe up -d`. Beide Dateien stehen in
    `.gitignore`.
  - **Die Datei** (0600) erlaubt nur Zugänge vom Knoten (`use-auth-secret`). Sie
    vermittelt nie in private, lokale oder reservierte Netze (`denied-peer-ip`),
    begrenzt Sitzungen und Bandbreite und schreibt kein Protokoll.
  - **Freigeben:** UDP und TCP 3478 sowie UDP 49160–49200 an Firewall und Router.
- **Umgebung des Knotens:**
  - `TURN_SECRET`: dasselbe Geheimnis, mindestens 32 Zeichen;
  - `TURN_URLS`: z. B. `turns:knoten.example.org:5349?transport=tcp,turn:knoten.example.org:3478`;
  - optional `TURN_GUELTIG_SEK` (Standard 3600, höchstens 86400).
- **Nie halb:** Fehlt eines davon oder ist es ungültig, vergibt der Knoten keine
  Zugänge. Im Log steht `[turn] …`.
- **Wer einen Zugang bekommt:** nur gekoppelte Geräte des Besitzers, versiegelt.
  Der Zugang steht nie im Log.

## Funk-Gateway (7.4b2, 7.5d)

Ein Knoten mit Netz und Funkgerät reicht kurze KI-Anfragen aus dem Funk ins
Netz und funkt die Antworten zurück. Er sieht dabei nur Umschläge – weder
Frage noch Antwort noch wer fragt.

- **Meshtastic-Gerät mit WLAN (seit 7.5d):** `FUNK_GATEWAY=meshtastic:<ip>`
  (Port 4403, sonst `meshtastic:<ip>:<port>`). Auf dem Gerät gehört dazu ein
  zweiter Kanal „freedom“ mit dem öffentlichen Schlüssel aus
  [`MESHTASTIC.md`](MESHTASTIC.md), dazu Region und Senden an. Was fehlt, steht
  beim Start im Log (`[funk] Meshtastic: …`, mit dem Schlüssel zum Abtippen);
  anlegen lässt sich der Kanal in der App (Netz › Mesh, per USB oder
  Bluetooth) oder in der Meshtastic-App. Ohne den Kanal funkt der Knoten nichts.
  Das Gerät hält per WLAN nur eine Verbindung – eine neue wirft die alte hinaus.
  Die Meshtastic-App daher über Bluetooth verbinden, sonst verdrängen sich App
  und Knoten gegenseitig (der Knoten verbindet alle 30 s neu).
- **Eigenes Funkgerät mit Längenpräfix:** `FUNK_GATEWAY=host:port` – eine
  TCP-Brücke zum Gerät, z. B.
  `socat TCP-LISTEN:4403,reuseaddr FILE:/dev/ttyUSB0,raw`; je Rahmen zwei Byte
  Länge, dann der Rahmen.
- **Sendezeit:** höchstens 1 % je Stunde. Mit Meshtastic zählt die Sendezeit,
  die das Gerät mit seinem Preset braucht (LongFast: rund 1,9 s je Rahmen) –
  eine Antwort mit 500 Zeichen (16 Rahmen) kostet so rund eine halbe Minute,
  bei 1 % schafft ein Gateway etwa eine Antwort je Stunde.

## Was die Kette zeigt

Dein Knoten hat **eine** SOL-Adresse: Alle Zahlkanäle an ihn und seine
Auszahlungen sind auf der Kette miteinander verbunden (Entscheidung 4.5 A,
im Datenschutzbericht unter „Bewusste Grenzen“). Wer das nicht will, nimmt nur
Lightning an.
