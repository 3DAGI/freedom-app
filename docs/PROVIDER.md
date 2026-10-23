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

Ohne Kamera: `npm run koppeln -- --code` zeigt einen Code zum Eintippen
(`7KQ2-9XMB-4TRP`, zehn Minuten gültig). Der Knoten muss dabei laufen – er legt
den Kopplungscode verschlüsselt auf seine Relays, die App findet ihn über den
Code und koppelt wie mit dem QR; danach löscht der Knoten das Event wieder
(Format: `docs/PROTOCOL.md` §35).

**Gratis-Grenze (E9-2):** Mit `STORAGE_GRATIS_MB=<MB>` hält der Knoten Dateien
anderer nur bis zu dieser Größe gratis; Stücke größerer nimmt er nicht auf.
Die Grenze steht in seinem Angebot, und die App fragt beim Abruf nur Knoten,
deren Grenze die Datei fasst. Ohne die Variable hält er jede Größe (bis zur
Quota) und sagt im Angebot nichts dazu; `0` heißt: nichts gratis. Eine
ungültige Angabe heißt: Der Knoten startet nicht. Dateien des Besitzers (unten)
hält er unabhängig davon.

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

## KI-Antrieb: Ollama oder OpenAI-kompatibel (B-29a)

Standard ist Ollama (`OLLAMA_URL`). Ollama arbeitet gleichzeitige Anfragen von
Haus aus nacheinander ab. vLLM, SGLang und TensorFold bündeln sie und haben
eine OpenAI-kompatible Schnittstelle. Der Knoten spricht sie mit:

```bash
KI_ANTRIEB=openai
KI_URL=http://127.0.0.1:8000/v1        # vLLM; SGLang …:30000/v1, TensorFold …:8080/v1
KI_SCHLUESSEL=…                        # nur, wenn der Dienst einen verlangt (--api-key)
PROVIDER_MODELS=Qwen/Qwen2.5-7B-Instruct   # genau die Namen aus <KI_URL>/models
```

- **Nur dieser Rechner oder das Heimnetz:** `KI_URL` zeigt auf localhost, eine
  private Adresse, einen Namen ohne Punkt (Docker-Dienst) oder einen Namen auf
  `.local`, `.lan`, `.internal` oder `.home.arpa`. Ein Dienst im Internet ist
  kein Antrieb – die Fragen der Kunden gingen sonst an einen Dritten.
- **Nie still Ollama:** Eine ungültige Einstellung hält den Knoten an
  (`[ki] … – der Knoten startet nicht`); `npm run pruefen` nennt den Grund.
- **Schlüssel:** Der Knoten schickt `KI_SCHLUESSEL` als Bearer an den Dienst,
  nie ins Log.
- **Werkzeuge** (Websuche und andere) brauchen beim Dienst Werkzeug-Aufrufe.
  vLLM: `--enable-auto-tool-choice --tool-call-parser <Parser zum Modell>`,
  SGLang: `--tool-call-parser <Parser zum Modell>`.
- **Docker:** Läuft der Antrieb auf dem Rechner selbst, `KI_URL` auf dessen
  Adresse im Heimnetz setzen (z. B. `http://192.168.1.20:8000/v1`) oder den
  Antrieb als Dienst ins selbe Compose-Netz stellen (`http://vllm:8000/v1`).
- **Modelle:** Im Angebot steht aus `PROVIDER_MODELS`, was `<KI_URL>/models`
  nennt. Geprüft laden geht seit B-29c1b auch mit diesem Antrieb – von Hugging
  Face in einen Ordner (Abschnitt „Modelle laden, geprüft“, Hugging Face).

### Welcher Antrieb? Messen (B-29b)

```bash
cd ~/freedomstack/packages/node
npm run messen -- --gleichzeitig 1,4,8          # Modell: das erste aus PROVIDER_MODELS
npm run messen -- --modell <name> --anfragen 16 --tokens 256
# Docker: docker compose exec node npm run messen -- --gleichzeitig 1,4,8
```

- **Was es misst:** mit derselben Umgebung wie der Knoten, je Stufe:
  - Tokens je Sekunde über alle gleichzeitigen Anfragen;
  - Antworten je Minute;
  - Median und p95 der Dauer einer Antwort;
  - den Faktor gegenüber der ersten Stufe.
- **Ein Faktor nahe 1** heißt: Der Antrieb arbeitet nacheinander. Ollama
  bedient gleichzeitige Anfragen nur bis `OLLAMA_NUM_PARALLEL` (Umgebung des
  Ollama-Dienstes).
- **Ablauf:** Es stellt feste Übungsfragen ohne Werkzeuge, über denselben Weg
  wie echte Anfragen. Vorher kommt eine Anfrage zum Aufwärmen (Modell laden),
  die nicht zählt.
- **Ausgabe:** Antworten zeigt es nicht, Fehler nur mit Namen.
- **Wann:** am besten, solange der Knoten keine Aufträge bedient. Für einen
  fairen Vergleich zweier Antriebe dasselbe Modell und dieselben Zahlen nehmen.

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
   seine Relays. Seit E9-4 zählt auch ein Manifest, das ein Modellkatalog
   nennt, dem der Knoten folgt – genau dieses, nie ein anderes desselben
   Autors (siehe „Kataloge“ unten). Einen voreingestellten Herausgeber gibt
   es nicht; das eigene Manifest geht immer vor.
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

### Kataloge, denen der Knoten folgt (E9-4)

Wer nicht jedes Modell selbst festhalten will, folgt Modellkatalogen (Kind
38080) von Kuratoren, denen er traut:

```bash
MODELL_KATALOGE=38080:<kurator-hex>:<kennung>,38080:<…>:<…>   # höchstens 20
```

- Nennt ein Eintrag im Katalog ein Manifest (viertes Feld), lädt der Knoten
  das Modell auch nach diesem Manifest – genau nach dieser Id. Ein späteres,
  anderes Manifest desselben Kurators zählt erst, wenn sein Katalog es nennt.
- Das eigene Manifest geht vor. Nennen mehrere Kataloge verschiedene Dateien,
  wählt der Knoten keines (`manifest.uneinig`).
- Der Knoten fragt seine Relays nach den Katalogen dieser Kuratoren, höchstens
  alle zehn Minuten. Die Relays sehen damit, welchen Kuratoren er folgt.
- Eine ungültige Adresse in `MODELL_KATALOGE` heißt: Der Knoten startet nicht.
- Einen Katalog mit Manifest-Ids veröffentlicht man in der App (Agent › Netz ›
  Modelle › „Katalog veröffentlichen“): die Id am Ende der Zeile. Die Id des
  eigenen Manifests nennt `npm run modell`.

### Von Hugging Face, für einen OpenAI-kompatiblen Antrieb (B-29c1b)

```bash
cd ~/freedomstack/packages/node
# mit KI_ANTRIEB=openai in der Umgebung des Knotens
npm run modell -- Qwen/Qwen2.5-7B-Instruct --aus-hf   # beim ersten Mal: festhalten, was Hugging Face jetzt nennt
npm run modell -- Qwen/Qwen2.5-7B-Instruct            # später: erneut laden und gegen das Festgehaltene prüfen
# Docker: docker compose exec node npm run modell -- Qwen/Qwen2.5-7B-Instruct --aus-hf
```

Der Name ist die Kennung bei Hugging Face (`org/repo`). Der Ablauf gleicht dem
über Ollama:

1. **Manifest:** Mit `--aus-hf` fragt der Knoten Hugging Face nach dem
   neuesten Commit und dessen Dateien und signiert daraus sein Manifest. Große
   Dateien nennt Hugging Face mit SHA-256. Kleine lädt der Knoten, prüft sie
   gegen ihre Git-Kennung und rechnet die Summe selbst.
2. **Vorab vergleichen:** Hugging Face muss am Commit des Manifests dieselben
   Namen, Größen und Summen nennen.
3. **Laden:** Der Knoten lädt jede Datei nach `MODELL_ORDNER/<org>/<repo>`
   (Vorgabe `~/.freedom/modelle`) und prüft sie dabei.
4. **Abgleichen:** Im Ordner darf nichts liegen, was nicht im Manifest steht –
   der Antrieb läse es mit.

**Nur, was beim Laden keinen Code ausführen kann:** safetensors, Konfiguration
und Tokenizer aus der obersten Ebene des Repos. Pickle-Dateien (`.bin`, `.pt`)
und Python lädt der Knoten nie. Ein Repo ohne safetensors und `config.json` lädt
er nicht. Modelle mit Anmeldung bei Hugging Face („gated“) gehen nicht.

**Den Antrieb auf den Ordner zeigen lassen**, unter dem Namen aus dem Manifest:

```bash
vllm serve ~/.freedom/modelle/Qwen/Qwen2.5-7B-Instruct --served-model-name Qwen/Qwen2.5-7B-Instruct
```

**Im Angebot** steht das Modell nur, solange der Antrieb es unter diesem Namen
nennt (`<KI_URL>/models`) und der Ordner unverändert ist. Ändert sich eine
Datei, kommt eine dazu oder fehlt eine, fällt es heraus, bis es neu geprüft
ist. Läuft der Antrieb in einem eigenen Container, braucht er denselben Ordner
(nur lesend). Welchen Ordner er lädt, bestimmt sein Start – der Knoten prüft
den Ordner, nicht den Speicher des Antriebs.

Ein Manifest für Hugging Face hat:
- `model`: die Kennung bei Hugging Face;
- `upstream`: `hf:<Kennung>@<Commit>`;
- je Datei den Namen im Repo, mit Summe und Größe.

### Im Schwarm: Freedom-Knoten, Pirate Face, Hugging Face (B-29c2)

```bash
# in der Umgebung des Knotens, zusätzlich zu KI_ANTRIEB=openai
TORRENT=1                     # aria2c als Torrent-Client (Docker: im Image; sonst apt-get install aria2)
TORRENT_PORT=6881             # TCP und UDP freigeben, sonst teilt der Knoten nur ausgehend
TORRENT_HOCHLADEN_KBS=0       # höchstens so viel hochladen (KiB/s), 0 = ohne Grenze

npm run modell -- Qwen/Qwen2.5-7B-Instruct --aus-hf --magnet "magnet:?xt=urn:btih:…"   # Magnet z. B. von pirateface.co
```

Mit `TORRENT=1` holt der Knoten ein Modell **zuerst aus dem Schwarm**:
1. von anderen Freedom-Knoten, die dieselbe Fassung „vorhalten“ (Kind 38058
   mit Magnet und Inhalts-Kennung);
2. dann über den Magnet aus `--magnet`, etwa von [Pirate Face](https://pirateface.co/)
   (Torrents offener Modelle von Hugging Face);
3. erst dann direkt von Hugging Face.

Woher die Bytes kommen, ist gleich: Der Knoten wählt nur die Dateien des
Manifests, prüft jede gegen ihre SHA-256 und legt nur Geprüftes in den
Modellordner.

**Danach teilt er selbst:** Aus dem geprüften Ordner baut er den
**Freedom-Torrent** des Modells. Jeder Knoten mit denselben Bytes baut denselben
(gleicher Name, gleiche Dateien, gleiche Stückgröße), auch wenn er das Modell
von Hugging Face hat. Den Magnet meldet er im Netz („ich halte vor“, erneuert
täglich).

**Was dabei sichtbar ist:** Wer teilt, zeigt seine IP-Adresse im Schwarm –
anderen Teilnehmern, Trackern und dem DHT. Das ist bei BitTorrent so und lässt
sich nicht verbergen. Deshalb ist `TORRENT` aus, bis du es einschaltest.

**Grenzen:**
- Nur für Modelle von Hugging Face im Ordner. Ollama hält seine Gewichte selbst.
- aria2c läuft als eigenes Programm. Seine Steuerung hört nur auf 127.0.0.1,
  mit einem Geheimnis je Start, das nur in einer Datei steht (0600).
- aria2c endet mit dem Knoten.

## Werkzeuge über MCP (B-31a)

Der Knoten kann dem Modell Werkzeuge aus MCP-Servern anbieten, die auf diesem
Rechner laufen – etwa Wikipedia ohne Internet (Kiwix, B-31b). Welche, legst nur
du fest: in `~/.freedom/mcp.json`.

```json
{
  "server": {
    "wiki": {
      "befehl": ["/usr/bin/python3", "/opt/mcp/wiki/server.py"],
      "nurLesbar": ["/opt/mcp/wiki", "/daten/zim"]
    }
  }
}
```

- **Nur in der Sandbox:** Jeder Server läuft in bubblewrap wie der Motor (VKb):
  ohne Netz, Wurzel nur lesbar, leere Umgebung, begrenzte Prozesse und
  Speicher. Ohne Sandbox startet kein Server (Log `[werkzeuge] MCP-Server aus`).
- **`befehl`:** Programm mit absolutem Pfad und seine Argumente.
- **`nurLesbar`:** Ordner, die der Server braucht, nur lesbar unter demselben
  Pfad (höchstens 8). Der Ordner des Programms kommt dazu, wenn er nicht unter
  `/usr` liegt. Nie die Wurzel, dein Home, einen Ordner darüber oder
  `~/.freedom` – dort liegt der Schlüssel des Knotens.
- **Grenzen:** höchstens 4 Server, je Server 32 Werkzeuge. Für das Modell heißen
  sie `mcp__<server>__<werkzeug>` und haben dieselben Grenzen wie die
  eingebauten Werkzeuge (Eingabe 2000 Zeichen, 20 Sekunden, Ausgabe gekürzt auf
  4000 Zeichen). Gratis-Antworten bekommen keine Werkzeuge.
- **Ungültige Datei** hält den Knoten an (`[werkzeuge] … – der Knoten startet
  nicht`); `npm run pruefen` zeigt dasselbe. Startet ein Server nicht, läuft der
  Knoten ohne ihn weiter.
- **Was durchfließt,** ist Inhalt einer KI-Anfrage: Der Knoten schreibt es nie
  ins Log, nach außen gehen nur feste Fehlertexte.

### Wikipedia ohne Internet (Kiwix, B-31b)

Kiwix ist eingebaut: Statt `befehl` nennst du nur die ZIM-Dateien (Archive von
[download.kiwix.org](https://download.kiwix.org/zim/), etwa Wikipedia ohne Bilder).

```json
{ "server": { "wiki": { "kiwix": ["/daten/zim/wikipedia_de_all_nopic.zim"] } } }
```

- **Was läuft:** `kiwix-serve` aus Debian (Paket `kiwix-tools`, GPL-3.0+, ein
  eigenes Programm, rund 5 MB) und eine kleine Brücke des Knotens
  (`packages/node/mcp/kiwix-bruecke.mjs`, nur Node) – beide in der Sandbox, ohne
  Netz; `kiwix-serve` hört nur auf 127.0.0.1 in der Sandbox.
- **Für das Modell:** `mcp__wiki__search` (Volltextsuche, höchstens 10 Treffer mit
  Pfad) und `mcp__wiki__read` (ein Artikel als Text, ohne Skripte). Gelesen wird
  nur ein Pfad aus der Suche (`<buch>/<eintrag>`), nie eine andere Adresse.
- **Einrichten:** `apt-get install kiwix-tools` (im Docker-Bild schon dabei), ZIM
  ablegen, `mcp.json` wie oben. Der Installer tut beides mit
  `KIWIX_ZIM=/pfad/a.zim[,/pfad/b.zim]` – eine vorhandene `mcp.json` lässt er
  stehen. Unter Docker den Ordner nur lesend einbinden (`./zim:/daten/zim:ro`).
- **Ohne `kiwix-serve`** startet der Server nicht, der Knoten läuft ohne ihn
  weiter (Log `[werkzeuge] MCP wiki startet nicht (ProgrammFehlt) – … (Paket
  kiwix-tools)`).
- **Ohne Internet:** Die Suche verlässt den Rechner nicht – passend zu einem
  Funk-Gateway (7.4), das ohne Netz antwortet.
- **Beim Vibecoden (seit VKd2a)** bekommt auch der Coding-Agent dieselben ZIM-Dateien
  (unten, „Kiwix“ bei den Werkzeugen des Motors).

## Text aus Sprache (B-38b, im Aufbau)

Der eigene Knoten macht aus Sprachnachrichten Text – nur für dich (gekoppelt, versiegelt, `docs/PROTOCOL.md` §43), mit
`whisper-cli` aus [whisper.cpp](https://github.com/ggml-org/whisper.cpp) (MIT) je Auftrag in der Sandbox, ohne Netz. Die App
fragt erst mit B-38c („Als Text“).

- **Programm:** `scripts/whisper-bauen.sh <ordner>` baut `whisper-cli` aus den Quellen in fester Fassung (v1.9.5, Commit
  geprüft), ohne OpenMP, ohne Server – rund zwei Minuten, braucht `cmake`, `git` und einen C++-Compiler. Mit
  `WHISPER_CUDA=1` für die GPU (braucht das CUDA-Toolkit). Unter Docker baut `docker-compose.sprache.yml` es ins Bild.
- **Modell:** ein ggml-Modell von whisper.cpp – auf dem GX10 `large-v3-turbo-q5_0` (547 MiB), ohne GPU `base` (SP-W4).
  Geprüft laden wie andere Modelle (seit B-38b3b2, mit jedem KI-Antrieb):

  ```bash
  npm run modell -- --whisper --aus-hf        # beim ersten Mal: festhalten, was Hugging Face jetzt nennt (Vorgabe nach WHISPER_GPU)
  npm run modell -- --whisper base            # ein anderes Modell; später ohne --aus-hf gegen das Festgehaltene laden
  npm run modell                              # Stand – nennt die geprüfte Datei
  # Docker: docker compose exec node npm run modell -- --whisper --aus-hf
  ```

  Der laufende Knoten lädt genau die eine Datei `ggml-<name>.bin` aus dem Repo von whisper.cpp bei Hugging Face
  (`ggerganov/whisper.cpp`, am Commit des Manifests), prüft SHA-256 und Größe beim Laden und dass sie mit `ggml` beginnt,
  und legt sie nach `MODELL_ORDNER/whisper/`. Whisper nimmt seit B-38b3b3 je Auftrag das zuletzt geprüfte Modell, dessen
  Datei unverändert ist – erst dann nennt der Status die Rolle „Text aus Sprache“. Wer das Modell selbst ablegt, setzt
  `WHISPER_MODELL` (geht vor, ohne Prüfung gegen ein Manifest) und vergleicht die SHA-1 aus `models/README.md` von
  whisper.cpp (etwa `e050f7970618a659205450ad97eb95a18d69c9ee` für large-v3-turbo-q5_0).
- **Einstellen:** `WHISPER_MODELL` (absoluter Pfad zu einem selbst abgelegten Modell; leer: das geprüfte), `WHISPER_CLI` (Vorgabe
  `/usr/local/bin/whisper-cli`), `WHISPER_THREADS` (Vorgabe 4), `WHISPER_FRIST_SEK` (Vorgabe 600), `WHISPER_GPU=1` nur mit
  CUDA-Bau. Ungültig heißt aus – das Log sagt, warum (`[sprache] …`).
- **Sandbox:** Ohne bubblewrap läuft nichts. Unter Docker geht sie nur mit den Regeln aus `docker-compose.sprache.yml`
  (dieselben wie beim Vibecoden):

  ```bash
  docker compose -f docker-compose.yml -f docker-compose.sprache.yml up -d --build
  # Modell geprüft laden (landet in /home/node/.freedom/modelle/whisper/), Whisper nimmt es von selbst:
  docker compose exec node npm run modell -- --whisper large-v3-turbo-q5_0 --aus-hf
  # oder selbst ins Volume und WHISPER_MODELL=/home/node/.freedom/whisper/ggml-large-v3-turbo-q5_0.bin setzen:
  docker compose exec node mkdir -p /home/node/.freedom/whisper
  docker compose cp ggml-large-v3-turbo-q5_0.bin node:/home/node/.freedom/whisper/
  ```
- **Was der Knoten sieht:** den Ton nur kurz in einem eigenen Ordner (0700), den Text nur bis zur Antwort – nie im Log.
  Ein Auftrag zur Zeit; der Status nennt die Rolle „Text aus Sprache (Whisper)“.

## Agent auf dem Knoten (11.3d1a, im Aufbau)

Ein Agent ist ein eigenes Mitglied in offenen Räumen und antwortet, wenn ihn
jemand erwähnt. Er läuft auf deinem Knoten und hat einen eigenen Schlüssel
(`~/.freedom/agent-key`, beim ersten Start angelegt, 0600) – nie den des Knotens.

```bash
KNOTEN_AGENT=1
AGENT_NAME=Lektor                                  # Pflicht, höchstens 64 Zeichen
AGENT_PERSONA="Du bist Lektor. Antworte knapp."    # Anweisung an das Modell – bleibt auf dem Knoten
AGENT_ABOUT=…                                      # freiwillig, öffentlich auf der Karte
AGENT_MODELL=qwen3.8:27b                           # freiwillig, ein angebotenes Modell
AGENT_BESITZER=<hex>                               # freiwillig; gilt erst mit deiner Bestätigung in der App
AGENT_PRIVAT=besitzer                              # freiwillig: private Räume – besitzer oder alle (11.3d2a)
AGENT_REPO=1                                       # freiwillig: Repo-Aufträge in der Sandbox (11.5c2a)
```

- **Karte:** Beim Start und mit jedem Erneuern des Angebots veröffentlicht der
  Knoten die Karte des Agenten (Kind 38090, „läuft auf dem Knoten, wer fragt,
  zahlt“). Die Persona steht nicht darin.
- **Bezahlt** jede Antwort, wer fragt: Seine App schickt einen versiegelten
  Auftrag mit dem Verweis auf die Erwähnung, bezahlt wie jede KI-Antwort.
  Der Knoten prüft die Erwähnung im Raum:
  - Darf der Fragende dort schreiben?
  - Hat der Agent die Rolle `agent`?
  - Ist die Erwähnung noch nicht beantwortet?
  Nur dann rechnet er, mit Persona, dem Verlauf des Kanals bis zur Erwähnung
  und der Erwähnung selbst, und antwortet im Raum. Agenten antworten keinem
  Agenten, wenn der Fragende zahlt.
- **In den Raum** holt ihn der Gründer: Rolle `agent` für seinen Schlüssel (er
  steht im Log, `[agent] … pubkey=…`).
- **Ungültige Angaben** halten den Knoten an (`[agent] … – der Knoten startet nicht`).
- **Fragen** (seit 11.3d1b2): Wer den Agenten im Raum mit „@Name“ erwähnt,
  sieht in der App den Preis (höchstens 100 sats je Antwort, mit der Rate deines
  Angebots) und schickt nach der Bestätigung einen versiegelten Auftrag mit
  Verweis an deinen Knoten – über Lightning oder einen Zahlkanal zu dir.
- **Private Räume** (seit 11.3d2a, nur mit `AGENT_PRIVAT`): Der Agent wird
  volles Mitglied der MLS-Gruppe und **liest alles im Raum mit**.
  - `besitzer`: nur Einladungen von `AGENT_BESITZER`; `alle`: von jedem.
    Höchstens 20 Gruppen.
  - Der Knoten veröffentlicht dafür Relay-Listen und ein KeyPackage des Agenten
    und gleicht alle 15 Sekunden ab.
  - Fremde Relays einer Gruppe nur `wss://` und öffentlich, höchstens 10, über
    Tor, wenn der Knoten Tor nutzt.
  - Auf der Platte nur verschlüsselt, alles 0600 neben `agent-key`:
    `agent-mls.json` (Schlüssel), `agent-mls.zustand`, `agent-mls.raumstand`
    (Kanäle, Rollen, Karten). Chat-Nachrichten hält der Knoten nur im Speicher;
    die MLS-Engine behält sie wie bei jedem Mitglied in ihrem verschlüsselten
    Zustand.
  - Geht `agent-mls.json` verloren, sind die Gruppen weg – mit `agent-key`
    sichern.
  - **Antworten** (seit 11.3d2b) wie im offenen Raum: nur auf einen bezahlten
    Auftrag mit Verweis, dieselben Prüfungen, die Antwort verschlüsselt in der
    Gruppe. Die App fragt seit 11.3d2c auch in privaten Räumen; wer deinen
    Agenten einlädt, sieht vorher eine Warnung, und im Raum steht danach ein
    Hinweis, dass dein Knoten alles mitliest.
- **Repo-Aufträge** (seit 11.5c2a, nur mit `AGENT_REPO=1`; private Räume seit 11.5c2b): Zeigt die
  Erwähnung auf ein Repo des Raums, bearbeitet der Agent dessen Code und reicht einen
  Patch ein.
  - Nur, wenn die Sandbox geht (bubblewrap mit Nutzer-Namensräumen, Log
    `[agent] Repo-Aufträge an|aus – …`); unter Docker nur mit
    `docker-compose.vibecoden.yml`. Ohne Netz in der Sandbox, nichts vom Knoten darin.
  - Der Code kommt nur aus dem neuesten Bundle-Verweis eines Pflegers, geprüft wie
    beim Halten, der Arbeitsordner liegt im Arbeitsspeicher und ist danach weg.
  - Der Agent arbeitet wie mini-swe-agent: ein Befehl je Antwort, höchstens 50
    Schritte und 30 Minuten, ein Auftrag zugleich. Den Patch baut der Knoten, nicht
    das Modell; angenommen wird er nur von Menschen mit Recht im Raum.
  - **Bezahlt** nur, nie gratis: nach Tokens der Antworten zu deinem Preis, höchstens
    das Gebot – dort hört der Agent auf. Die Rechenzeit der Sandbox trägst du.
  - **Pakete** (seit 11.5c3, nur offene Räume): Vor dem ersten Schritt holt dein Knoten, was
    `package-lock.json` und `requirements.txt` des Repos mit Prüfsumme nennen – nur per GET von
    `registry.npmjs.org`, `pypi.org` und `files.pythonhosted.org`, mit `TOR_SOCKS` durch Tor. Die Sandbox
    sieht sie nur lesbar, npm und pip installieren daraus ohne Netz und ohne Install-Skripte. Ein neues
    Paket fragt der Agent mit Namen und fester Version an (`paket_holen`, höchstens 20 je Auftrag) – auch
    das holt der Knoten, nie die Sandbox. Die Registry sieht dabei Paketnamen und die IP deines Knotens
    (ohne Tor). Höchstens 500 Pakete, 200 MB und 10 Minuten je Auftrag; scheitert das Holen, arbeitet der
    Agent ohne Pakete, und die Antwort sagt es.
  - **Private Räume** (seit 11.5c2b): nur mit `AGENT_PRIVAT`, und nur, wenn dein Modell
    auf diesem Rechner läuft (`OLLAMA_URL` auf `localhost`, `127.0.0.1` oder `[::1]`) –
    sonst lehnt der Agent ab. Der Code der Gruppe geht so an keinen anderen Rechner.
    Repo und Schlüssel des Bundles liest der Agent als Mitglied aus der Gruppe; Patch und
    Antwort gehen nur verschlüsselt in die Gruppe. Unter Docker zeigt `OLLAMA_URL` auf
    den Dienst `ollama` – das gilt nicht als dieser Rechner.
- **Noch nicht:** das Budget des Einladers (11.3d3, nach dem Upgrade des
  Zahlkanals).

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

## Gruppenanrufe über den eigenen Knoten (B-34, im Aufbau)

Ab drei Personen läuft ein Anruf über einen SFU auf deinem Knoten: LiveKit als eigener Dienst (wie coturn). Der Knoten
vergibt nur Zugänge – je Teilnehmer einen, mit einer zufälligen Kennung, nur für diesen Anruf und kurz gültig. Bild und
Ton verschlüsselt die App (B-34b/c); der SFU sieht, wer wann spricht und wie viel, aber nicht was.

- **Einrichten (Docker):** einmal
  `bash scripts/livekit-einrichten.sh ./livekit.yaml <name> --docker >> .env`, dann
  `docker compose --profile livekit up -d`. Die Datei (0600, in `.gitignore`) hat zufälligen Schlüssel und Geheimnis,
  höchstens 25 Teilnehmer je Raum, keinen eigenen TURN, kein Redis, Protokoll erst ab „warn“.
- **Erreichbar machen:**
  - Das Signal hört nur auf `127.0.0.1:7880`. Davor gehört ein Reverse-Proxy mit TLS, der `wss://<name>` dorthin
    weiterreicht.
  - An Firewall und Router freigeben: TCP 7881 und UDP 50000–50100.
- **Umgebung des Knotens:** `LIVEKIT_URL` (`wss://…`), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (mindestens 32 Zeichen) –
  die drei Zeilen aus dem Skript; optional `LIVEKIT_GUELTIG_SEK` (Standard 3600, höchstens 86400).
- **Nie halb:** Fehlt eines oder ist es ungültig, vergibt der Knoten keine Zugänge. Im Log steht `[livekit] …`; die
  Rolle „Gruppenanrufe“ zeigt der Status in der App.
- **Wer einen Zugang bekommt:** nur gekoppelte Geräte des Besitzers, versiegelt (Kind 5081). Zugänge stehen nie im Log.
- **Noch nicht:** der Schlüssel aus der Gruppe (B-34b), Beitreten in der App (B-34c), Oberfläche (B-34d); der Installer
  richtet LiveKit noch nicht ein.

## Vibecoden auf dem eigenen Knoten (A-31, im Aufbau)

Vom Handy aus Programme auf deinem Knoten bauen lassen
(`docs/VIBECODEN-ENTWURF.md`). Seit VKc1 legt der Knoten Projekte an und
listet sie auf; den Agenten, der darin arbeitet, bringt VKc2.

- **Einschalten:** `VIBECODEN=1` in der Umgebung. Ein anderer Wert als `0` oder `1`
  hält den Start an. Nötig ist git; das Docker-Bild bringt es mit. Fehlt es, bleibt
  Vibecoden aus, und im Log steht `[code] …`.
- **Projekte:** je Projekt ein Ordner in `~/.freedom/projekte` (0700) mit eigenem
  git, Zweig `main`; unter Docker im Volume `freedom-state`. Ein Projekt lässt
  sich dort auch ohne Freedom mit git öffnen.
- **Wer darf:** nur gekoppelte Geräte des Besitzers, versiegelt (Kind 5080). Ins
  Log kommen nur Zahlen, nie Projektnamen.
- **Sandbox (seit VKb):** Code führt der Knoten nur in bubblewrap aus
  (`apt install bubblewrap`, das Docker-Bild bringt es mit) – ohne Netz, die
  Wurzel nur lesbar (aus `/etc` nur `/etc/alternatives` und der Cache des Laders), schreibbar nur der Projektordner (darin `.git` nur lesbar),
  leere Umgebung; dein Home und `~/.freedom` sieht der Code nicht. Grenzen je
  Befehl: 60 s, 120 s Rechenzeit, Dateien bis 512 MB, 1024 offene Dateien,
  `/tmp` mit 512 MB, seit 11.5s3 4 GB Arbeitsspeicher je Prozess (ein Befehl mit
  vielen Prozessen kann zusammen mehr belegen – das begrenzt die Sandbox noch nicht),
  seit 11.5s4a höchstens 1024 Prozesse und Threads je Befehl (gegen Fork-Bomben).
  Diese Grenze zählt der Kernel nicht, wenn der Knoten als root läuft – betreib ihn
  als eigenen Nutzer (das Docker-Bild tut das); sonst warnt das Log beim Start.
  Seit 11.5s2 sperrt ein seccomp-Filter Kernaufrufe, die kein Werkzeug braucht
  (`io_uring`, Schlüsselbund, eBPF, neue Namensräume) – auf x86_64 und arm64.
  Ob sie geht, steht beim Start im Log (`[code] Sandbox …`) und in
  `npm run pruefen`. Ohne bubblewrap oder ohne Nutzer-Namensräume läuft kein
  Code – nie direkt auf dem Rechner. **Unter Docker** sperrt das
  Standard-Seccomp Nutzer-Namensräume; dann meldet die Prüfung das (Abhilfe unten). Ubuntu ab 24.04
  kann sie per AppArmor sperren (`kernel.apparmor_restrict_unprivileged_userns`).
- **Agent (seit VKc3a):** Hermes Agent (Nous Research, MIT) über ACP, nur in der
  Sandbox. Der Knoten sucht ihn als venv in `HERMES_ORDNER` (Vorgabe `/opt/hermes`,
  mit `bin/python` und `bin/hermes-acp`). Ohne Docker: `python3 -m venv /opt/hermes &&
  /opt/hermes/bin/pip install --require-hashes --only-binary :all: --no-deps -r
  docker/hermes-requirements.txt` (Hermes 0.19.0, jedes Paket mit Prüfsumme; das Python
  dazu muss unter `/usr` liegen). Das Modell erreicht
  Hermes nur über eine Brücke des Knotens zum eigenen Antrieb (Ollama oder `KI_URL`) –
  kein Nous Portal, kein Dienst im Internet. Welches Modell: `CODE_MODELL`, sonst das
  erste im Angebot; es muss Werkzeuge aufrufen können (Tool-Calling), und Ollama
  braucht langen Kontext (`OLLAMA_CONTEXT_LENGTH=65536`). Gedächtnis und Skills von
  Hermes liegen je Projekt in `~/.freedom/hermes/<projekt>`, nie im Repo. Fehlt
  Hermes, steht es im Log, und Aufträge werden mit `code-ohne-motor` abgelehnt.
- **Werkzeuge (seit VKd1):** Hermes kann über deinen Knoten im Netz suchen
  (DuckDuckGo, nur Kurzantworten) und öffentliche Seiten als Text lesen (Freedom-MCP,
  `POST /mcp` an derselben Brücke). Die Sandbox selbst bleibt ohne Netz; es gehen nur
  diese zwei Werkzeuge hinaus (Pakete gehen seit VKd3 eigene Wege, unten), mit den Grenzen der Werkzeuge des Knotens (http und
  https, keine privaten Adressen, nur Text, Größe und Zeit begrenzt) und ohne Tor – die Suchmaschine und die Seiten sehen die IP deines
  Knotens und, was in Suchanfrage oder Adresse steht. Hermes fragt vor diesen
  Aufrufen nicht; in der App erscheinen sie als Schritt. Gelesen werden nur Seiten,
  deren Adresse im Auftrag oder in einem Suchergebnis steht (seit VKd1b, wie bei
  Claude) – keine Adresse, die der Agent selbst baut, kein Link aus einer gelesenen
  Seite. Die Suchanfrage selbst ist frei.
- **Browser (seit VKk1):** Hermes kann durchklicken, was er baut – Playwright MCP
  (Microsoft, Apache-2.0, aus `playwright-core`) steuert Chromium ohne Kopf, beide in
  der Sandbox des Motors und ohne Netz: Der Browser sieht nur Seiten, die der Agent in
  derselben Sandbox ausliefert (etwa `python3 -m http.server`), nie das Internet oder
  deinen Rechner. Ausgeführt werden nur die Werkzeuge zum Sehen, Klicken und Tippen,
  nicht `browser_run_code_unsafe` (beliebiger Code im Server). Unter Docker bringt das
  Bild mit `VIBECODEN=1` Chromium und Schriften aus Debian mit (einige hundert MB); sonst
  sucht der Knoten `/usr/lib/chromium/chromium` und `/opt/google/chrome/chrome`, oder
  du nennst den Pfad in `MCP_BROWSER` (`aus` schaltet den Browser ab). Fehlt Chromium
  oder Playwright (optionale Abhängigkeit), läuft der Motor ohne Browser, und das Log
  sagt es.
- **Kiwix (seit VKd2a):** Stehen in `mcp.json` ZIM-Dateien (oben, „Wikipedia ohne
  Internet“), bekommt Hermes sie von selbst – dieselben Dateien und dieselbe Brücke,
  als Kind des Motors in dessen Sandbox, ohne Netz, die Ordner nur lesbar. Der Agent
  kann damit nachschlagen (`search`, `read`), ohne dass etwas den Rechner verlässt.
  `MCP_KIWIX=aus` schaltet es für den Motor ab; fehlt `kiwix-serve`, läuft er ohne,
  und das Log sagt es.
- **Pakete (seit VKd3):** `npm install` und `pip install` im Projekt gehen über
  dieselbe Brücke. Der Knoten holt nur von registry.npmjs.org, pypi.org und
  files.pythonhosted.org, nur lesend, ohne Weiterleitung, mit `TOR_SOCKS` durch Tor,
  je Datei bis 50 MB, je Stunde höchstens 20 000 Abrufe und 4 GB. Prüfsummen rechnen
  npm und pip selbst. Die Registry sieht die IP deines Knotens (oder den Ausgang von
  Tor) und die Namen der Pakete. Andere Adressen (GitHub, CDNs) gehen aus der
  Sandbox nicht.
- **Vorschau (seit VKg1a, wie Replit):** Der Knoten zeigt ein Projekt live im
  Browser deines Handys – echt gerendert, durchklickbar, nach jeder Änderung des
  Agenten beim Neuladen neu. Dafür `VORSCHAU_URL` setzen: die Adresse, unter der
  dein Handy den Knoten erreicht, etwa `http://192.168.1.20:3603` im Heimnetz, eine
  eigene Domain mit https über einen Reverse-Proxy oder eine `.onion`-Adresse
  (Tor auf `127.0.0.1:3603`). Der Port ist `VORSCHAU_PORT` (Standard 3603) – nie der
  Port von Relay und App, und hinter einem Reverse-Proxy nie dieselbe Domain wie die
  App, sonst käme die Vorschau an deren Speicher. Der Knoten lauscht auf
  `VORSCHAU_HOST` (Standard alle Adressen). Ohne `VORSCHAU_URL` gibt es keine
  Vorschau, ein ungültiger Wert hält den Start an. Wer die Adresse samt Zeichen
  kennt, sieht das Projekt; das Zeichen bekommt nur der Besitzer, versiegelt, und es
  ändert sich bei jedem Start. Über http im Heimnetz kann mitlesen, wer im selben
  Netz ist – für unterwegs `.onion` oder https. Ausgeliefert wird nur gelesen:
  `dist/` oder `build/`, wenn dort eine `index.html` liegt, sonst das Projekt, nie
  `.git`, `.env` oder Verweise hinaus. Nennt `package.json` ein Skript `dev` (seit
  VKg1c), startet der Knoten beim ersten Aufruf der Vorschau `npm run dev` in der
  Sandbox – ohne Netz, wie jeden Code des Projekts – und leitet die Vorschau dorthin
  weiter, auch Hot Reload: Änderungen des Agenten erscheinen ohne Neuladen. Der
  Server muss in der Sandbox auf `127.0.0.1:5173` lauschen; Vite tut das von selbst,
  andere nehmen `PORT`. Höchstens drei laufen zugleich, nach 30 Minuten ohne Aufruf
  endet einer; ohne Sandbox zeigt die Vorschau nur die Dateien.
- **Bild (seit VKg2a2, für Programme ohne Web):** Spiele und Programme mit Fenster
  (Python mit pygame oder tkinter, später Godot und andere) zeigt der Knoten als
  Bildstrom in der App – auch unterwegs ohne `VORSCHAU_URL`. Das Programm nennt
  `.freedom/start` im Projekt (ein Befehl für `sh`), sonst startet der Knoten
  `main.py`. Web-Projekte zeigt Chromium im Bild (seit VKg2c1, derselbe wie für den
  Motor: `MCP_BROWSER`, sonst Chromium aus Debian) – mit Skript `dev` in
  `package.json` der Dev-Server wie in der Vorschau, sonst `index.html`; WebGL rechnet
  dort SwiftShader in Software. Es läuft in einer Sandbox ohne Netz auf einem virtuellen Bildschirm;
  eine zweite Sandbox kodiert das Bild (VP8 in Software; seit VKg2c2 H.264 über
  NVENC, wo es die GPU gibt – `BILD_KODIERER=vp8` erzwingt VP8) und schickt es über
  WebRTC nur über deinen TURN (B-13, `TURN_URLS` und `TURN_SECRET`). Den TURN
  erreicht nur diese zweite Sandbox, über einen Tunnel des Knotens, der nur die
  Adressen der App erlaubt. Liegt coturn auf demselben Rechner und ist sein
  öffentlicher Name von innen nicht erreichbar, nennt `TURN_INTERN` die Adresse für
  den Knoten (etwa `127.0.0.1:3478`). Gebraucht werden Xvfb, GStreamer mit
  `webrtcbin` und PyGObject (`xvfb gstreamer1.0-plugins-good gstreamer1.0-plugins-bad
  gstreamer1.0-nice gir1.2-gst-plugins-bad-1.0 python3-gi python3-xlib`); fehlt etwas, sagt es das
  Log, und die App bekommt `code-bild-aus`. Höchstens zwei Bilder laufen zugleich,
  eines endet spätestens mit dem Zugang zum TURN (`TURN_GUELTIG_SEK`, Standard eine
  Stunde). Maus, Berührung und Tasten aus der App gehen nur an diesen Bildschirm
  (seit VKg2a3, dafür `python3-xlib`). In der App öffnet „Bild“ auf dem Blatt des
  Projekts die Ansicht (seit VKg2b) – die App muss den TURN des Knotens erreichen.
  Unter Docker bringt `docker-compose.vibecoden.yml` alle Pakete mit (seit VKg2c1, rund
  270 MB);
  läuft coturn mit dem Profil „anrufe“ auf demselben Rechner, ist `TURN_INTERN`
  dort `host.docker.internal:3478`. NVENC unter Docker (seit VKg2c2) nur mit
  NVIDIA Container Toolkit und der dritten Datei: `docker compose -f
  docker-compose.yml -f docker-compose.vibecoden.yml -f docker-compose.nvenc.yml
  up -d --build`. Die GPU bekommt dann nur die Bild-Sandbox, nie der Code des
  Projekts; das Log sagt beim Start „H.264 über NVENC“ und je Bild den Kodierer.
- **Unter Docker (seit VKc3b):** `docker compose -f docker-compose.yml -f
  docker-compose.vibecoden.yml up -d --build`. Die Ergänzung baut Hermes ins Bild
  (rund 40 MB Pakete, venv etwa 135 MB, mit MCP seit VKd1 rund 7 MB mehr, dazu python3 und ripgrep) und gibt dem
  Container, was bubblewrap braucht: das Seccomp-Profil `docker/seccomp-vibecoden.json`
  (das Standardprofil von Docker plus Namensräume: `clone`, `unshare`, `mount`,
  `umount2`, `pivot_root`, `setns`, `sethostname`), `systempaths=unconfined` (sonst
  verdeckt Docker Teile von `/proc`, und die Sandbox bekommt kein eigenes) und
  `apparmor=unconfined` (das Profil `docker-default` auf Ubuntu und DGX OS verbietet
  `mount`). Der Knoten läuft weiter als Nutzer ohne Fähigkeiten; die Sandbox legt
  darin ihren eigenen, engeren Filter an. Ohne die Ergänzung bleibt das Bild schlank,
  und die Selbstprüfung meldet, dass keine Sandbox geht. Gemessen mit Docker 29: ohne
  Ergänzung keine Sandbox, mit ihr laufen die Sandbox-Tests im Container grün.
  Die Ergänzung gibt außerdem den Port der Vorschau frei (3603, auf allen Adressen;
  für Tor oder einen Reverse-Proxy auf demselben Rechner `VORSCHAU_BIND=127.0.0.1`)
  und reicht `VORSCHAU_URL` durch.

## Gratis-Start (A-14)

Neue Kunden fragen zuerst gratis. Dein Knoten verschenkt dafür ein Budget je
Tag für alle zusammen und nennt es im Angebot. Ein Kontingent je Person geht
nicht, ohne Anfragen zu verknüpfen – Schlüssel kosten nichts.

- **Budget je Tag:** `GRATIS_TOKENS_TAG`, Standard 100 000 Tokens (Frage samt
  Verlauf und Antwort), Tag nach UTC; `0` schaltet ab. Das Budget liegt nur im
  Speicher – nach einem Neustart beginnt es neu.
- **Je Antwort:** `GRATIS_TOKENS_JE_ANTWORT`, Standard 2 000 – der Knoten
  begrenzt beim Modell. Werkzeuge und Schwarm gibt es gratis nicht.
- **Rechenarbeit:** `GRATIS_POW_BITS`, Standard 16 – so viel muss der Umschlag
  einer Gratis-Anfrage tragen (bezahlte: `PRIVATE_POW_BITS`, Standard 12).
- **Leer:** Ist das Budget verbraucht, lehnt der Knoten mit der Kennung
  `gratis-leer` ab; die App sagt das dem Kunden.
- **Erste 24 Stunden (Bootstrap):** Der Knoten verdient noch nichts. Fragen
  mit Gebot beantwortet er gratis, nach derselben Regel – sonst scheiterte die
  erste Frage jedes Kunden.
- **Ungültige Werte:** Der Knoten startet nicht (`[gratis] …` im Log), statt
  still etwas anderes zu verschenken.

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
