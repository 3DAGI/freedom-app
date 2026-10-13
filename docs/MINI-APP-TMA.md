# FREEDOM als Telegram Mini App — Stars + TON

Die App läuft als Telegram Mini App (TMA) parallel zur PWA: derselbe Code,
ein eigener Build (`FREEDOM_TMA=1`), Zahlung über **Telegram Stars (XTR)**
und **TON (Gram, Testnet)**. Lightning/Solana bleiben in der PWA — Telegram
erlaubt in Mini Apps keine anderen Blockchains als TON.

## Aufbau

| Teil | Ort | Was |
|---|---|---|
| Client-Brücke | `packages/app/src/shell/tma.ts` | initData, ready/expand, fetch-Patch, Theme |
| Stars-Client | `packages/app/src/shell/stars-checkout.ts` | Rechnung anfordern, natives Sheet öffnen, Status |
| TON-Client | `packages/app/src/shell/ton-connect.ts` | Wallet verbinden, Gram senden |
| initData-Verify | `packages/node/src/tma-auth.ts` | HMAC-SHA256 serverseitig (Sicherheit!) |
| Stars-Server | `packages/node/src/stars-server.ts` | createInvoiceLink (XTR), pre_checkout, successful_payment, refund |
| TON-Verify | `packages/node/src/ton-verify.ts` | toncenter getTransactions, Betrag+Kommentar, Replay-Schutz |
| TMA-Server | `packages/node/src/tma-server.ts` | HTTP-Routen `/tma/*`, Long-Polling, Persistenz |

Recycelt aus dem swarm-Projekt: `tonconnect-ui.min.js`, Icon und das
Manifest-Muster stammen aus `~/swarm/mini-app/`.

## Bauen und starten

```bash
# 1. TMA-Build der App (Telegram-SDK + TON Connect im Header)
cd packages/app && FREEDOM_TMA=1 npm run build

# 2. Node mit Mini-App-Server (Port 3601)
cd ../node && \
  FREEDOM_TMA=1 \
  TELEGRAM_BOT_TOKEN=<eigener Bot aus BotFather> \
  TON_DEPOT_ADDRESS=<TON-Adresse für Gram-Zahlungen> \
  TONCENTER_API_KEY=<optional> \
  npx tsx src/main.ts
```

Umgebungsvariablen:

| Variable | Default | Bedeutung |
|---|---|---|
| `FREEDOM_TMA` | – | `1` startet den TMA-Server |
| `TELEGRAM_BOT_TOKEN` | – | **Eigener** Bot, nicht der Hermes-Token |
| `TON_DEPOT_ADDRESS` | – | Empfänger der Gram-Zahlungen |
| `TMA_PORT` | `3601` | HTTP-Port des Mini Apps |
| `TON_TESTNET` | `1` | `0` = Mainnet |
| `TONCENTER_API_KEY` | – | höheres RPC-Limit |
| `TMA_STATISCH` | `packages/app/dist` | Wo freedom.html liegt |
| `TELEGRAM_API_BASE` | `https://api.telegram.org` | Bot-API-Basis — nur für Tests/Proxies umbiegen |

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
