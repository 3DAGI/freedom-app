# Provider werden – in beiden Schienen verdienen

Stand 8.2b (28.09.2026). Kurzfassung für Betreiber eines Knotens; Einzelheiten
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

## Was die Kette zeigt

Dein Knoten hat **eine** SOL-Adresse: Alle Zahlkanäle an ihn und seine
Auszahlungen sind auf der Kette miteinander verbunden (Entscheidung 4.5 A,
im Datenschutzbericht unter „Bewusste Grenzen“). Wer das nicht will, nimmt nur
Lightning an.
