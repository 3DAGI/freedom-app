# FREEDOM als Telegram Mini App — Stars + TON

Die App läuft als Telegram Mini App (TMA) parallel zur PWA: derselbe Code,
ein eigener Build (`FREEDOM_TMA=1`), Zahlung über **Telegram Stars (XTR)**
und **TON (Gram, Testnet)**. Lightning/Solana bleiben in der PWA — Telegram
erlaubt in Mini Apps keine anderen Blockchains als TON.

**Stand nach der Reparatur (TMA-1, 14.10.2026).** Die Mini-App kam am 13./14.10. ohne
Pull Request direkt auf `main` (lokaler Agent des MENSCHEN). Spur A hat sie geprüft und
repariert:
- **Was geht:** Die App öffnet sich in Telegram (ready, expand, Farben). Der Knoten
  prüft die Signatur (`initData`), legt Stars-Rechnungen an und bucht bezahlte Sterne.
  TON-Zahlungen prüft er gegen toncenter.
- **Was nicht geht:** Stars und TON sind **nicht verdrahtet**. Kein Knopf der App ruft
  `zahleMitStars()` oder `zahleMitTon()` auf, und gebuchte Sterne kauft man nichts. Wofür
  sie zahlen, muss der MENSCH entscheiden (Abschnitt „Offen“).
- **Behoben:**
  - Der Mini-App-Build überschrieb `freedom.html`, sobald `FREEDOM_TMA_API` gesetzt war.
    Pages hätte dann die Telegram-Fassung als Haupt-App veröffentlicht, oder der
    Nachbau-Vergleich hätte jede Veröffentlichung gestoppt. Jetzt liegt sie nur in
    `dist/tma/` und wird wie die App bitgleich nachgebaut.
  - Ein globaler fetch-Patch hängte die Telegram-Signatur an jeden Aufruf derselben
    Herkunft, auf GitHub Pages also an GitHub. Jetzt geht sie nur über `tmaFetch()` an
    den TMA-Server.
  - Das Inline-Skript mit der API-Adresse ließ die CSP nicht zu, Betrieb B konnte also
    nie den Server erreichen. Jetzt steht die Adresse per `define` im Skript.
  - Die CSP erlaubte ganz `telegram.org`, `'self'` und den API-Host als Skriptquelle.
    Jetzt erlaubt sie nur die eine Datei des SDK.
  - TON Connect UI lud die Seite vom Knoten, ohne es zu nutzen. Jetzt lädt sie es nicht
    mehr.
  - Das „Icon“ war eine SVG-Datei mit der Endung `.png` und der Aufschrift „SW“ (aus
    swarm). Die App braucht es nicht mehr.

## Aufbau

| Teil | Ort | Was |
|---|---|---|
| Client-Brücke | `packages/app/src/shell/tma.ts` | initData, ready/expand, Theme, `tmaFetch()` – die Signatur nur an den TMA-Server |
| Stars-Client | `packages/app/src/shell/stars-checkout.ts` | Rechnung anfordern, natives Sheet öffnen, Status |
| TON-Client | `packages/app/src/shell/ton-connect.ts` | Wallet verbinden, Gram senden |
| initData-Verify | `packages/node/src/tma-auth.ts` | HMAC-SHA256 serverseitig (Sicherheit!) |
| Stars-Server | `packages/node/src/stars-server.ts` | createInvoiceLink (XTR), pre_checkout, successful_payment, refund |
| TON-Verify | `packages/node/src/ton-verify.ts` | toncenter getTransactions, Betrag+Kommentar, Replay-Schutz |
| TMA-Server | `packages/node/src/tma-server.ts` | HTTP-Routen `/tma/*`, Long-Polling, Persistenz |

Recycelt aus dem swarm-Projekt: `tonconnect-ui.min.js`, Icon und das
Manifest-Muster stammen aus `~/swarm/mini-app/`. Die Datei `tonconnect-ui.min.js` ist
bitgleich mit `@tonconnect/ui` 2.4.4 (Apache-2.0, `dist/tonconnect-ui.min.js`, SHA-256
`ab1d010e9b9d9af37e98bdfa6248068eccdbeb7bbbee99d86364abd1d9a7611a`). Die App lädt sie seit
TMA-1 nicht mehr. Kommt TON, wird sie im Skript der App gebündelt (Hash der CSP), nicht vom
Server geladen.

## Bauen und starten

Zwei Betriebsarten — beides mit demselben Code:

**A) Alles auf einem Host** (Node liefert App + API; der Build schreibt nur
`dist/tma/index.html`, der Knoten liefert sie unter `/`):
```bash
cd packages/app && FREEDOM_TMA=1 node build.mjs
cd ../node && FREEDOM_TMA=1 TELEGRAM_BOT_TOKEN=<Token> TON_DEPOT_ADDRESS=<EQ…> npx tsx src/main.ts
```

**B) App statisch auf GitHub Pages, API auf dem Node** (empfohlen für viele Nutzer):
```bash
# 1. Repository → Settings → Secrets and variables → Actions → Variables:
#    FREEDOM_TMA_API = https://<dein-node>.ts.net     (der TMA-Server)
# 2. Push auf main → pages.yml baut /tma/ selbst mit
# 3. BotFather → /newapp → https://3dagi.github.io/freedom-app/tma/
# 4. API-Server wie in A, aber nur der Node (kein Static-Serving nötig)
```

Bei B liegt die App auf Pages (schnell, weltweit ausgeliefert), `/tma/*`
(Stars, TON) läuft gegen den Node:
- Der Build setzt die API-Adresse per `define` ins Skript, denn ein zweites
  Inline-Skript ließe die CSP nicht zu.
- `tmaFetch()` hängt die Signatur nur an Aufrufe an diesen Server; `connect-src https:`
  deckt ihn schon.
- `pages.yml` baut `/tma/` mit derselben Adresse nach (`repro-build.sh`) und veröffentlicht
  nur, was bitgleich ist.
- Cross-Origin mit `Authorization`-Header braucht den gespiegelten
  `Access-Control-Allow-Origin`. Der Server macht das; es schützt die HMAC-Signatur, nicht
  die Origin.

Umgebungsvariablen (Server):

| Variable | Default | Bedeutung |
|---|---|---|
| `FREEDOM_TMA` | – | `1` startet den TMA-Server |
| `TELEGRAM_BOT_TOKEN` | – | **Eigener** Bot, nicht der Hermes-Token |
| `TON_DEPOT_ADDRESS` | – | Empfänger der Gram-Zahlungen |
| `TMA_PORT` | `3601` | HTTP-Port des Mini Apps |
| `TON_TESTNET` | `1` | `0` = Mainnet |
| `TONCENTER_API_KEY` | – | höheres RPC-Limit |
| `TELEGRAM_API_BASE` | `https://api.telegram.org` | Bot-API-Basis — nur für Tests/Proxies umbiegen |
| `TMA_STATISCH` | `packages/app/dist` | Wo freedom.html liegt (nur für Betriebsart A) |

Build-Variable (nur für Betriebsart B):

| Variable | Bedeutung |
|---|---|
| `FREEDOM_TMA_API` | Herkunft des TMA-Servers beim App-Build: nur https, ohne Pfad (z. B. `https://gx10-7f4a.tail0aa21d.ts.net`), sonst bricht der Build ab. In `build-site.sh` und als Repository-Variable für pages.yml gesetzt → `/tma/` wird mitgebaut und nachgebaut. Leer = gleiche Herkunft (Betriebsart A). Der Web-Build liest sie nie. |

## Bot einrichten (BotFather)

1. `@BotFather` → `/newbot` → Name + Username → **Token notieren**
2. `/newapp` → denselben Bot wählen → **HTTPS-URL** des Nodes angeben
3. Mini App öffnen: `https://t.me/<botname>?startapp` oder Menü-Button

Ohne HTTPS akzeptiert Telegram kein Mini App. Lokal testen geht über
Tailscale-Funnel, ngrok oder Cloudflare-Tunnel.

## Sicherheit

- **initData wird serverseitig verifiziert** (`tma-auth.ts`): HMAC über den
  Bot-Token, `auth_date` maximal 24 h alt, timing-sicherer Vergleich.
  `initDataUnsafe.user.id` im Browser wird NIE für die Autorisierung
  benutzt — nur zur Anzeige.
- **Stars-Preise stehen fest im Server** (`stars-server.ts`, Tabelle
  `PREISE`). Der Request-Preis wird ignoriert — 1 Stern für alles ist
  damit unmöglich.
- **Vor `successful_payment` wird nichts gutgeschrieben.**
  `answerPreCheckoutQuery(ok)` allein garantiert keine Zahlung.
- **TON-Zahlungen**: exakter Betrag + eindeutiger Kommentar
  (`freedom:<auftrag>:<nonce>`), jede tx-Hash wird nur einmal gutgeschrieben
  (Replay-Schutz, persistiert in `~/.freedom/tma/tma-ton.json`).

## Tests

```bash
cd packages/node
npx tsx --test test/tma-auth.test.ts   # 9 Tests: HMAC, Manipulation, Alter
npx tsx --test test/ton-verify.test.ts # 6 Tests: Betrag, Kommentar, Replay
```

## Bezahlen im Mini App

**Stars (XTR)** — der bequeme Weg für Nutzer ohne Wallet:
1. Client → `POST /tma/stars/invoice {auftrag}` → `{link, stars}`
2. `Telegram.WebApp.openInvoice(link)` — natives Sheet
3. Server: `pre_checkout_query` → `answerPreCheckoutQuery(ok)`
4. Server: `successful_payment` → Sterne gutschreiben, `charge_id` speichern

**TON (Gram)** — der dezentrale Weg:
1. Client → `POST /tma/ton/invoice {auftrag, nano}` → `{an, kommentar}`
2. `tonConnectUI.sendTransaction(...)` — Wallet bestätigt
3. Server pollt toncenter, prüft Betrag + Kommentar, markiert verbraucht

## Bekannte Grenzen

- Long-Polling statt Webhook: der Node hat keinen öffentlichen HTTPS-Port.
  Updates kommen mit bis zu 30 s Verzögerung — für digitale Güter okay,
  für zeitkritische Abläufe nicht.
- WalletConnect ist in TMAs von Telegram blockiert — nur TON Connect.
- `openInvoice` existiert nur in Telegram selbst; im Browser öffnet der
  t.me-Link in einem neuen Tab.

## Offen – Entscheidungen des MENSCHEN (TMA-1)

Bis zur Antwort bleiben Stars und TON unverdrahtete Bausteine.

| Nr. | Frage | Optionen | Empfehlung |
|---|---|---|---|
| T1 | Wofür zahlen Sterne? Sie gehen an den Besitzer des Bots, also verwahrt und zentral. Das passt nicht zu A+ (94 % an den Provider) und nicht zu RM2 W1 A (kein Guthaben beim Provider). | A Spende oder Trinkgeld an den Betreiber des Bots, ohne Gegenleistung in der App · B Guthaben nur für KI-Anfragen an den eigenen Knoten des Bot-Besitzers, in Texten als „verwahrt“ benannt · C streichen | **B** – Telegram verlangt Sterne für digitale Güter; ehrlich benannt wie Cashu (E4b V5) |
| T2 | TON als dritte Kette? | A TON Connect für Telegram-Nutzer (Testnet) · B weglassen, Sterne reichen | **B** – Ziel ist „Sats und SOL gleichwertig“; TON erst nach A-17 und RM2 neu prüfen |
| T3 | Das SDK von `telegram.org` im Mini-App-Build (eine fremde Skriptquelle, nur dort) | A so lassen (der Weg, den Telegram beschreibt) · B eigene Brücke über die Web-Events von Telegram, ohne fremdes Skript (~60 Zeilen, nur in Telegram testbar) | **A** jetzt, B später prüfen |
| T4 | Lightning und SOL in der Mini-App: Telegram erlaubt dort für Krypto nur TON (siehe oben) | A in der Mini-App ausblenden · B zeigen und die Sperre des Bots riskieren | **A**, falls T1 B |
| T5 | Datenschutz: Telegram sieht, wer die App öffnet, und `initData` (Telegram-ID, Name, Benutzername, Foto-Adresse) geht an den TMA-Server | Grenze „telegram“ im Datenschutzbericht, nur in der Mini-App (mit Szenario in `privacy-facts.test.ts`) | **ja**, mit T1 |
