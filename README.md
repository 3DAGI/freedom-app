# freedomstack

Ein betreiberloses Protokoll für unzensierbare Kommunikation, bezahlte KI-Nutzung
und chainübergreifenden Werttransfer — ohne dass irgendeine Partei Gelder
verwahrt oder das System abschalten kann.

## Architektur

```
freedomstack/
├─ packages/
│  ├─ protocol/     Betreiberloser Kern (Nostr, DVM, Zaps, HTLC-Swap,
│  │                PoW, Web-of-Trust, 1%-Fee-Split) — 45 Tests
│  ├─ node/         Provider-Knoten: DVM-Daemon + Ollama (lokal, GX10)
│  │                — 4 Tests, inkl. Live-Inferenz
│  └─ app/          Client-Core für die App (Chat / KI / Wallet / Verdienen)
│                   — 3 Tests, E2E User↔Provider
└─ contracts/
   └─ solana-htlc/  Anchor-HTLC (initialize/claim/refund) — kompiliert,
                     3 On-Chain-Tests auf Localnet grün
```

**Tatsächlicher Stand (nachgemessen, nicht geschätzt):**

| Paket | grün | übersprungen | rot |
|---|---|---|---|
| protocol | 901 | 5 (live: LND, Devnet) | 0 |
| node | 158 | 7 (live: Ollama, ComfyUI) | 0 |
| app | 153 | 0 | 0 |

`.github/workflows/ci.yml` prüft bei jedem Push Tests, Typen, App-Build,
Installer- und Gate-Server-Syntax sowie die Fee-Invarianten. Der Grund: die
fünf roten Tests der Ausgangsanalyse waren unbemerkt eingecheckt worden, weil
niemand sie automatisch ausführte.

Die Darstellungslogik der App liegt in `shell-logic.ts` — ohne DOM und deshalb
tatsächlich prüfbar. `shell/app.ts` importiert sie, statt eine zweite Kopie zu
halten; die Tests decken damit den Code ab, der wirklich läuft. Schwerpunkt sind
feindliche Eingaben aus fremden Relay-Events, denn genau dort steckte schon
einmal ein XSS-Loch.

## Design-Invarianten — NICHT VERLETZEN

1. **Non-custodial ausnahmslos.** Das Protokoll hält nie fremde Gelder. Fees
   werden an der Quelle dreigeteilt. Kein Topf, kein "sammeln und auszahlen".
2. **Keyless & immutable on-chain.** Kein Upgrade-Authority, keine Admin-Funktion.
3. **Kein Mixer, kein Auto-Mixing von Fees.** Die 5%-Protokollfee fließt
   transparent in Lightning-Sats (privat by design, kein öffentliches Ledger).
4. **Kein eigener Token.** Basis läuft mit BTC/SOL.
5. **Keine Bridge, wo ein Swap genügt.** Atomic Swaps (HTLC) tauschen native Assets.
6. **Neue Funktion = neue Event-Kind**, kein neuer HTTP-Endpunkt.
7. **Multi-Relay, nie Single-Relay.**
8. **Timelock-Ordnung:** `T_lightning > T_sol` mit Sicherheitspuffer.

## Provider werden

Zwei Wege, je nachdem wie verbindlich es sein soll:

```bash
# Container — nichts am System, rückstandsfrei entfernbar
NODE_LUD16=du@wallet.cash REGION=eu docker compose up -d

# Installer — systemd-Dienst, für den Dauerbetrieb
NODE_LUD16=du@wallet.cash bash <(curl -fsSL https://freedomstack.io/install.sh)
```

Ohne `NODE_LUD16` startet nichts. Ein Provider, der arbeitet und dessen
Einnahmen nirgendwo ankommen, ist schlimmer als einer, der gar nicht startet.

## Gebühren

**Protokollfee: 2,5 %** — ohne privilegierten Empfänger.

| Anteil | ppm | Empfänger |
|---|---|---|
| 80 % | 20.000 (2,0 %) | Reward-Pool |
| 20 % | 5.000 (0,5 %) | Referral |

**App-Gebühr: 2,5 %**, deklariert im Job-Event (`client_fee`-Tag), sichtbar in
der Oberfläche, vom Nutzer abschaltbar und von einem Fork entfernbar.

Der Entwickler-Anteil lag früher im Protokoll. Damit führte jeder Provider
automatisch an eine Adresse ab, die er nicht ändern konnte — die Definition
eines Intermediärs. Solange eine Fee nicht entfernt werden *kann*, gibt es
einen Betreiber, egal was hier steht.

Für den Nutzer bleibt es bei 5 % gesamt. Nur die Frage, an wen und wofür, ist
jetzt beantwortbar. Provider akzeptieren App-Gebühren bis maximal 10 % — ohne
diese Grenze wäre die Offenheit der Client-Schicht ein Werkzeug gegen den Nutzer.


## Quickstart

```bash
# Alles testen
cd packages/protocol && npm install && npm test   # 45 Tests
cd ../node && npm test                            # 4 Tests (1x Live-Ollama)
cd ../app && npm test                             # 3 Tests

# Provider-Knoten starten (verdient sats via DVM-Jobs)
cd packages/node
NODE_LUD16=you@wallet.cash node --import tsx src/main.ts

# Solana-HTLC bauen + on-chain testen
cd contracts/solana-htlc
anchor build
# Validator mit freien Ports (8000/8899 oft belegt):
solana-test-validator --ledger .anchor/test-ledger \
  --rpc-port 8891 --faucet-port 9901 --gossip-port 18000 \
  --dynamic-port-range 18001-18100 \
  --bpf-program 6Y2i8iBHHii2AmZjCPwKtksqvjwU3GyPW2Xuzsn8Dh2p \
  target/deploy/solana_htlc.so --reset &
ANCHOR_PROVIDER_URL=http://127.0.0.1:8891 \
ANCHOR_WALLET=~/.config/solana/id.json \
npx ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts   # 3 Tests
```

## Compute-Netzwerk: Was sinnvoll ist (und was nicht)

- **Kein Modell-Tensor-Sharding über WAN.** Internet-Latenz ist Faktor 1000–10000
  zu langsam für Layer-Splits. Petals-Style funktioniert nur in Rechenzentren.
- **Die Shard-Einheit ist der JOB, nicht das Modell.** Viele Provider mit vollen
  lokalen Modellen (7–13B, GX10: bis 70B-Q4) = linearer Durchsatz.
- **Vertrauen durch Redundanz:** Wichtige Jobs an 3 Provider, Konsens-Vergleich
  client-seitig (später als optionales DVM-Feature).
- **MoE auf Netz-Ebene:** Verschiedene Provider hosten Spezialmodelle, der
  DVM-Marktplatz routet per `model`-Param.

## Roadmap

| # | Aufgabe | Status |
|---|---------|--------|
| A | WebSocketRelay (echte Relays statt Mocks) | ✅ |
| B | DVM-Provider-Daemon (GX10 + Ollama) | ✅ live getestet |
| C | Solana-HTLC kompilieren + on-chain testen | ✅ 3 Tests grün |
| D | App Client-Core (Chat/KI/Wallet-Tabs) | ✅ Grundgerüst |
| E | Echte Lightning-Adapter (LND/CLN Hold-Invoices) | ✅ live getestet |
| F | Swap-Daemon: LP-Knoten (Liquidität + fee_ppm verdienen) | ✅ |
| G | Devnet-Deployment HTLC + echter Solana-Adapter | ✅ deployed + live |
| H1 | App-Shell: PWA (4 Tabs, Single-File, Seeker-tauglich) | ✅ freedom.html |
| H2 | Mainnet + `set-upgrade-authority --final` (immutable) | ⬜ |

## Rechtlicher Hinweis

Technisches Referenzprojekt, keine Rechts- oder Anlageberatung. Betrieb einzelner
Komponenten kann regulatorische Pflichten auslösen (MiCA/AMLR) — siehe
`docs/Master-Whitepaper.md` Abschnitt 14.
