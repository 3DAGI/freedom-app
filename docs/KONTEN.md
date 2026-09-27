# Konten, Wallets und Schlüssel – was der MENSCH anlegt

Stand 27.09.2026. Diese Liste sammelt alles, wofür der Code auf ein Konto, eine
Adresse oder einen Schlüssel wartet. Die Platzhalter im Code beginnen mit
`PLATZHALTER:` – ersetzen genügt, der Code erkennt sie und lässt die Stelle bis
dahin leer (kein Anteil, keine Quelle, kein Upload).

## Grundregeln

1. **Nur Öffentliches zurückgeben:** Adresse, Pubkey (npub/hex), URL. Geheimes
   (Seeds, nsec, Tokens, JWK) nie in den Chat, nie ins Repository.
2. **Geheimes nur hierhin:**
   - für Uploads aus der CI: GitHub → Repository → *Settings → Secrets and
     variables → Actions* (Name steht unten je Eintrag);
   - für den GX10: `~/.freedom/.env` bzw. die Umgebung von `docker-compose`
     (nicht im Repository).
3. **Je Zweck ein eigener Schlüssel.** Ein gestohlener Upload-Token darf kein
   Geld bewegen, ein Hosting-Wallet nicht die Entwicklung.
4. **Empfangsadressen nur selbstverwahrt** (Entscheidung 4.0): keine
   Lightning-Adresse bei einem Verwahrer (Wallet of Satoshi, Custody-Dienste),
   keine Börsen-Adresse.
5. **Datensparsam:** eine Projekt-E-Mail (z. B. die vorhandene Proton-Adresse
   oder ein Alias), kein Klarname, wo er nicht verlangt wird.

## Übersicht

| Nr | Wofür | Dringend für | Art | Platzhalter / Stelle |
|---|---|---|---|---|
| A1 | Codeberg Pages (Spiegel) | 5.3 | Konto + Token | `spiegel/quellen.json` → `codeberg`; Secret `CODEBERG_TOKEN` |
| A2 | IPFS (Spiegel) | 5.3 | eigener Knoten + Pinning-Konto | Secret `PINATA_JWT`; CID schreibt der Upload |
| A3 | Arweave (Spiegel) | 5.3 | Wallet + Guthaben | Secret `ARWEAVE_JWK` |
| A4 | Blossom/Nostr (Spiegel) | 5.3 | Nostr-Schlüssel nur für Spiegel | Secret `SPIEGEL_NSEC`; Variable `BLOSSOM_SERVER` |
| A5 | Torrent (Spiegel) | 5.3 | kein Konto (Seeder optional) | – |
| A6 | .onion-Spiegel und -Relay | 5.3, 5.4 | kein Konto (Tor auf dem GX10) | `spiegel/quellen.json` → `onion` |
| A7 | Hosting-Anteil (1 %) des offiziellen Spiegels | 5.1/5.3 | Lightning-Adresse + SOL-Adresse | `spiegel/freedom-spiegel.json` |
| B1 | Release-Signaturen (mind. 2) | 0.D/5.2 | zwei Nostr-Schlüssel auf zwei Geräten | `TRUSTED_SIGNERS` in `packages/app/src/shell/tabs/settings.ts` |
| C1 | Entwicklung (2,5 %) | 5.1 (Spur A) | Lightning-Adresse über eigenen Knoten | `ENTWICKLUNG` in `packages/protocol/src/aufteilung.ts` |
| C2 | Entwicklung SOL | 5.1/5.9 (Spur A) | Squads-Mehrfachsignatur | `ENTWICKLUNG` |
| D1 | Devnet-SOL-Wallet (Tests) | Abnahmen | Browser-Wallet | – |
| D2 | Lightning-Testnetz (Tests) | 8.3, 8.4, 4.x | Polar oder Testnet-LND | Macaroons (siehe unten) |
| E1 | Relay des GX10 (öffentlich) | 8.4 | Domain + TLS | `RELAY_PUBLIC_URL`, `RELAY_*` (docker-compose) |
| F1 | Radicle-Spiegel des Codes | 8.10 | Radicle-Identität | – |

## A – Spiegel der App (5.3)

**A1 Codeberg Pages.** Konto auf codeberg.org (nur E-Mail), Repository
`freedom-app` anlegen, darin später der Branch `pages` – Codeberg liefert ihn als
`https://<nutzer>.codeberg.page/freedom-app/` aus. Token: *Settings →
Applications → Generate Token*, Rechte nur `write:repository`. Mir gibst du:
den Nutzernamen (für die URL). Das Token kommt als Secret `CODEBERG_TOKEN`.

**A2 IPFS.** Empfehlung: zwei Kopien.
- Eigener Knoten auf dem GX10 (Kubo, `ipfs init && ipfs daemon`, kein Konto) – pinnt dauerhaft.
- Ein Pinning-Dienst als zweite Kopie: Pinata (kostenloser Tarif reicht für
  eine Datei je Version) – *API Keys → New Key*, nur `pinFileToIPFS`; das JWT
  als Secret `PINATA_JWT`. Alternativ Filebase (S3-Schlüssel).
Mir gibst du: nichts – den CID schreibt der Upload in das Release-Manifest.

**A3 Arweave.** Wallet mit der Browser-Erweiterung *Wander* (früher ArConnect)
oder auf der Kommandozeile erzeugen; die Schlüsseldatei (JWK, JSON) sicher
aufbewahren. Guthaben über *Turbo* (ardrive.io/turbo) – bezahlbar auch mit SOL;
je Version wenige MB, die Kosten liegen bei Cent-Beträgen (vor dem Kauf auf
der Seite nachsehen). Der Code nutzt `@ardrive/turbo-sdk` bereits. Mir gibst
du: die Arweave-Adresse (öffentlich). Die JWK kommt als Secret `ARWEAVE_JWK`
(Inhalt der Datei).

**A4 Blossom/Nostr.** Einen eigenen Nostr-Schlüssel nur für Spiegel erzeugen
(in der App: neue Identität, *Settings → Identität exportieren*, oder mit
`nak key generate`) – nicht die Projekt-Identität, nicht die Release-Signierer.
Dazu ein bis drei Blossom-Server wählen, die Dateien dieser Größe annehmen
(Bedingungen und Größenlimit vorher auf der Seite prüfen; manche verlangen ein
Abo in Sats). Mir gibst du: den npub des Spiegel-Schlüssels und die
Server-Adressen. Der nsec kommt als Secret `SPIEGEL_NSEC`.

**A5 Torrent.** Kein Konto. Der Build erzeugt `.torrent` und Magnet-Link mit
der Pages-Adresse als Webseed – laden geht dann auch ohne Seeder. Optional:
`transmission-daemon` auf dem GX10 als dauerhafter Seeder.

**A6 .onion.** Tor auf dem GX10, in der `torrc`:
`HiddenServiceDir /var/lib/tor/freedom/` und `HiddenServicePort 80 127.0.0.1:<port>`
(Webserver mit `site/`); für das Relay ein zweiter Dienst auf den Relay-Port.
Mir gibst du: die `.onion`-Adresse(n) aus `hostname`. Nützt auch 5.4 (geprüfte
.onion-Adresse für die Startliste) und 6.2.

**A7 Zahladressen fürs Hosting.** Wer die App ausliefert, bekommt 1 % jeder
KI-Zahlung, die über diese Auslieferung läuft (Entscheidung 4.0). Für den
offiziellen Spiegel (GitHub Pages) brauchst du:
- **Lightning-Adresse, selbstverwahrt:** am einfachsten über den eigenen LND
  auf dem GX10 mit dem LNURL-Server des Knotens (`LNURL_ENABLED=1`,
  `LNURL_BACKEND=lnd`) → `hosting@<deine-domain>`. Alternativen: Alby Hub
  (selbst betrieben) oder Zeus mit eigenem Knoten und Lightning-Adresse.
- **SOL-Adresse:** eigene Wallet nur fürs Hosting (Phantom, Solflare oder
  Backpack – neues Konto anlegen, Seed offline sichern), besser später eine
  Squads-Mehrfachsignatur wie bei der Entwicklung.
Mir gibst du: beide Adressen. Sie kommen in `spiegel/freedom-spiegel.json`.
Andere Spiegel legen ihre eigene Datei daneben – jeder Betreiber bekommt so
seinen Anteil, ohne dass jemand eine Liste pflegen muss.

## B – Signierte Releases (0.D, 5.2)

**B1** Mindestens zwei Nostr-Schlüssel auf zwei getrennten Geräten (die App
prüft „echt“ erst ab zwei Signaturen). Vorschlag: Amber auf einem
Android-Telefon und nsecBunker bzw. eine zweite Amber-Installation auf einem
zweiten Gerät, oder eine zweite Person. Keiner davon ist die
Projekt-Identität. Mir gibst du: beide Pubkeys (npub oder hex) für
`TRUSTED_SIGNERS`.

## C – Entwicklung (5.1, Spur A)

**C1** Lightning-Adresse der Entwicklung über einen eigenen Knoten (wie A7,
aber eigener Name, z. B. `entwicklung@…`). **C2** SOL an eine
Squads-Mehrfachsignatur (squads.so), etwa 2-von-3 mit Hardware-Wallets
(Ledger o. ä.). Beides setzt Spur A in `ENTWICKLUNG` ein.

## D – Test und Abnahme (kein echtes Geld)

**D1 Devnet-SOL:** eine Browser-Wallet (Phantom/Solflare) auf *Devnet*
umstellen, SOL vom Faucet (faucet.solana.com). In der App den RPC
`https://api.devnet.solana.com` eintragen (Settings).
**D2 Lightning-Testnetz:** am einfachsten *Polar* (lokal, Regtest, mehrere
Knoten per Klick) oder ein Testnet-LND auf dem GX10. Macaroons nur mit den
nötigen Rechten backen:
- Relay (8.4): `lncli bakemacaroon invoices:read invoices:write`
- LP (8.3): `lncli bakemacaroon invoices:read invoices:write offchain:read offchain:write info:read`

## E – Relay des GX10 (8.4)

**E1** Eine (Sub-)Domain, die auf den GX10 zeigt, TLS davor (z. B. Caddy:
`relay.<domain> { reverse_proxy 127.0.0.1:7777 }`). Dann `RELAY_ENABLED=1`,
`RELAY_PUBLIC_URL=wss://relay.<domain>`; für bezahlten Zugang zusätzlich
`RELAY_PREIS_SATS` + `RELAY_LND_MACAROON` bzw. `RELAY_PREIS_LAMPORTS` +
`RELAY_SOL_ADRESSE` (eigene Adresse, nicht die der Entwicklung).

## F – Code-Spiegel (8.10)

**F1** Radicle: `rad auth` erzeugt eine Identität (kein Konto), dann
`rad init` im Repository und einen Seed-Knoten wählen. Mir gibst du: die
`rad:`-Adresse des Repositories.

## Rückgabe an mich

Am einfachsten als eine Liste im Chat, nur öffentliche Werte:

```
codeberg-nutzer: …
onion-app: ….onion
onion-relay: ….onion
hosting-lightning: …@…
hosting-sol: …
spiegel-npub: npub…
blossom-server: https://…, https://…
arweave-adresse: …
release-signer-1: npub…
release-signer-2: npub…
radicle: rad:…
```

Die Secrets (`CODEBERG_TOKEN`, `PINATA_JWT`, `ARWEAVE_JWK`, `SPIEGEL_NSEC`)
trägst du selbst in GitHub ein – dann laufen die Uploads beim nächsten Release
von allein; fehlt eines, überspringt die CI diesen Spiegel mit einem Hinweis.
