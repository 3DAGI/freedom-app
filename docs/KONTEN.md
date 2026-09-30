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
| B1 | Release-Signaturen (mind. 2) | 0.D/5.2 | zwei Nostr-Schlüssel auf zwei Geräten | `TRUSTED_SIGNERS` in `packages/app/src/release-signierer.ts` (bis 11.2a in `settings.ts`) |
| C1 | Entwicklung (2,5 %) | 5.1 (Spur A) | Lightning-Adresse über eigenen Knoten | `ENTWICKLUNG` in `packages/protocol/src/aufteilung.ts` |
| C2 | Entwicklung SOL | 5.1/5.9 (Spur A) | Squads-Mehrfachsignatur | `ENTWICKLUNG` |
| D1 | Devnet-SOL-Wallet (Tests) | Abnahmen | Browser-Wallet | – |
| D2 | Lightning-Testnetz (Tests) | 8.3, 8.4, 4.x | Polar oder Testnet-LND | Macaroons (siehe unten) |
| E1 | Relay des GX10 (öffentlich) | 8.4 | Domain + TLS | `RELAY_PUBLIC_URL`, `RELAY_*` (docker-compose) |
| F1 | Radicle-Spiegel des Codes | 8.10 | Radicle-Identität | – |
| F2 | NIP-34-Ankündigung des Repositorys | 5.9b | – (Spiegel-Schlüssel aus A4) | optional Variable `REPO_MAINTAINER` |
| F3 | Upgrade-Recht der Programme | 5.9 | Squads-Mehrfachsignatur, Hardware-Wallets | – (`docs/SOLANA-UPGRADE-AUTHORITY.md`) |

## A – Spiegel der App (5.3)

**A1 Codeberg Pages.** Konto auf codeberg.org (nur E-Mail), Repository
`freedom-app` anlegen, darin später der Branch `pages` – Codeberg liefert ihn als
`https://<nutzer>.codeberg.page/freedom-app/` aus. Token: *Settings →
Applications → Generate Token*, Rechte nur `write:repository`. Mir gibst du:
den Nutzernamen (für die URL in `spiegel/quellen.json` – daraus liest der Job
auch, wohin er pusht). Das Token kommt als Secret `CODEBERG_TOKEN`. Der Job
ersetzt den Branch `pages` bei jedem Release durch die aktuelle Seite.

**A2 IPFS.** Empfehlung: zwei Kopien.
- Ein Pinning-Dienst: Pinata (kostenloser Tarif reicht für eine Datei je
  Version) – *API Keys → New Key*, nur `pinFileToIPFS`; das JWT als Secret
  `PINATA_JWT`. Der Job rechnet den CID selbst nach und übernimmt ihn nur, wenn
  Pinata denselben meldet.
- Eigener Knoten auf dem GX10 (Kubo, `ipfs init && ipfs daemon`, kein Konto)
  als dauerhafte zweite Kopie: nach jedem Release den Befehl aus der
  Zusammenfassung des Jobs ausführen (`ipfs pin add <cid>`). Nicht
  `ipfs add` ohne `--cid-version=1` – das ergäbe einen anderen CID.
Mir gibst du: nichts – den CID schreibt der Job in sein Ergebnis.

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
Abo in Sats). Mir gibst du: den npub des Spiegel-Schlüssels. Der nsec kommt
als Secret `SPIEGEL_NSEC`; die Server-Adressen (nur `https://`, mit Komma
getrennt) trägst du als **Variable** `BLOSSOM_SERVER` ein (*Settings → Secrets
and variables → Actions → Variables*) – sie sind nicht geheim. Übernommen wird
ein Server nur, wenn er dieselbe Prüfsumme meldet.

**A5 Torrent.** Kein Konto, läuft schon (5.3b): Jeder Bau legt
`freedom.torrent` neben die App, mit der Pages-Adresse als Webseed – laden geht
auch ohne Seeder; der Magnet-Link steht auf der Startseite. Optional:
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
`rad init` im Repository und einen Seed-Knoten wählen – Schritt für Schritt in
`docs/RADICLE.md`. Mir gibst du: die `rad:`-Adresse des Repositories.

**F2** NIP-34 (5.9b): Beim Release kündigt der Job „spiegel“ das Repository als
Kind 30617 an, signiert mit dem Spiegel-Schlüssel aus A4 (kein neues Konto).
Wer Patches aus der App annehmen darf, trägst du optional als **Variable**
`REPO_MAINTAINER` ein (Pubkeys in Hex, mit Komma) – sonst nur der
Spiegel-Schlüssel, den nur die CI hat.

**F3** Upgrade-Recht der Solana-Programme: Squads-Mehrfachsignatur mit
Zeitverzögerung, Schritt für Schritt in `docs/SOLANA-UPGRADE-AUTHORITY.md`.

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
trägst du selbst in GitHub ein; fehlt eines, überspringt die CI diesen Spiegel
mit einem Hinweis.

## Ein Release spiegeln

Nicht bei jedem Push – Uploads kosten Guthaben und Kontingent. Für ein Release:
1. GitHub → *Actions → pages → Run workflow*, Haken bei **spiegeln**. Der Job
   `spiegel` lädt die eben veröffentlichte `freedom.html` hoch: IPFS (Pinata),
   Blossom, Arweave (Turbo) und die ganze Seite nach Codeberg Pages.
2. In der Zusammenfassung des Laufs steht, was hochgeladen und was
   übersprungen wurde, dazu der Befehl für den GX10 (`ipfs pin add …`).
3. Das Artefakt **spiegel-ergebnis** herunterladen. Jeder Signierer ruft dann
   `SPIEGEL_ERGEBNIS=spiegel-ergebnis.json node scripts/publish-release.mjs <version>`
   auf – die Quellen kommen nur ins Manifest, wenn sie zur selbst gebauten
   Datei passen (gleiche Prüfsumme).
