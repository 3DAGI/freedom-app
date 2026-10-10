# @solana/kit statt web3.js v1 – Plan (A-21)

Stand 10.10.2026, Spur A. Sammlung A-21 (Anhang E): Lohnt der Wechsel, und wie geht er in
Schritten, die jeder für sich grün sind? Kein Code. Neue Abhängigkeiten sind ein STOPP-Punkt.
Freizugeben sind deshalb die Abhängigkeiten und die Antworten auf W1–W3.

## Befunde (gemessen am 10.10.2026)

- **Anteil am Bundle.** Gemessen mit esbuild, gleiche Einstellungen wie `build.mjs`, Metafile:
  - Das JavaScript in `freedom.html` hat 7,66 MB. Davon sind 3,95 MB die MLS-Engine (WASM als
    Text) und 2,40 MB eigener Code.
  - web3.js v1 und seine Abhängigkeiten belegen **rund 760 KB**: `@solana/web3.js` 459,
    `bn.js` 98, `@solana/errors` 62, `@solana/buffer-layout` 52, `uuid` 17, `borsh` 16,
    `rpc-websockets` 15, `text-encoding-utf-8` 13, `superstruct` 12, `eventemitter3` 7, `jayson` 5,
    `base-x` 4 (KB).
  - `bn.js` und `buffer` nutzen auch andere Pakete; ganz entfallen sie nicht unbedingt.
- **Dasselbe mit kit.** `@solana/kit` 8.4.0 (MIT) und `@solana-program/system` 0.15.0
  (Apache-2.0) wurden für die Aufgaben der App gebündelt: RPC, Adressen, PDA, Nachrichten,
  Drahtformat, Dekodieren, Überweisung, Durable Nonce. Ergebnis: **228 KB (47 KB gzip)**.
  Ersparnis rund 530 KB, etwa 7 % von `freedom.html`.
- **Keine Eile.** web3.js v1 wird weiter gepflegt (1.99.0 vom 07.10.2026). kit dagegen erscheint
  schnell in neuen Fassungen (Hauptversion 8 im Jahr 2026, täglich Vorabversionen). Deshalb
  exakt pinnen und nur bewusst aktualisieren.
- **Wo web3.js steckt:** 29 Dateien (App 15, Knoten 6, Protokoll 8). Die App lädt es meist mit
  `import()`. In der einen Datei ist es trotzdem ganz enthalten.
- **Stellen, die Sorgfalt brauchen:**
  - Die Ed25519-Anweisung zur Prüfung einer Gutschrift (`protocol/src/channel.ts`, Zahlkanal).
  - Durable Nonce für SOL ohne Internet (`sol-offline.ts`, `SYSVAR_RECENT_BLOCKHASHES`).
  - `sendAndConfirmTransaction` (`solana-adapter.ts`).
  - Die eigenen Borsh-Layouts (HTLC, Zahlkanal) bleiben, wie sie sind.
- **Signieren.** kit signiert mit Web Crypto (Ed25519 als `CryptoKey`). Unsere Regel lautet: den
  rohen Schlüssel nur kurz halten und danach nullen (`mitRohemSchluessel`, `LocalSigner`). kit
  erlaubt eigene Signer (`TransactionPartialSigner`). Ein Signer über `@noble/curves`, das schon
  im Bundle ist, hält die Regel ein und braucht kein Ed25519 in Web Crypto. Das fehlt in älteren
  Browsern.

## Teilschritte

Jeder Schritt ist ein eigener Pull Request, unter 400 Zeilen und für sich grün.

- **A-21a Vektoren.** Für jede Transaktion, die App oder Knoten heute bauen, gibt es einen Test
  mit festen Schlüsseln und festem Blockhash. Er hält die Bytes der Nachricht fest, die web3.js v1
  heute erzeugt. Abgedeckt sind:
  - HTLC: sperren, einlösen, zurückholen;
  - Zahlkanal: öffnen, aufstocken, Gutschrift einlösen mit Ed25519;
  - Relayer: Einlösung mit Erstattung;
  - Überweisung ohne Internet;
  - Senden und Trinkgeld.

  Jeder spätere Schritt muss dieselben Bytes liefern.
- **A-21b Protokoll.** Anweisungen werden zu kit-`Instruction`s mit Adressen als Text
  (`channel.ts`, `relayer.ts`, `sol-offline.ts`, `relay-zugang.ts`, in der App `sol-htlc.ts` und
  `zahlkanal.ts`). Die Ed25519-Anweisung wird von Hand gebaut, und die Vektoren müssen stimmen.
- **A-21c RPC.** Der `RpcPool` bleibt der einzige Weg (Stichprobe 5.8). kit spricht über einen
  eigenen Transport auf dem Pool (`createSolanaRpcFromTransport`). Betroffen sind
  `deposit-verify.ts`, `verdienst.ts` und `solana-adapter.ts`.
- **A-21d Signieren.** Ein kit-Signer über `@noble/curves` für `LocalSigner` und die eingebaute
  Wallet mit ihren frischen Adressen. Wallet Standard bekommt Bytes wie heute.
- **A-21e Knoten.** `dvm-provider.ts`, `einrichtung.ts`, `kanal-kasse.ts`, `main.ts`,
  `relayer-dienst.ts`, `sol-auszahlung.ts`.
- **A-21f Aufräumen.** `@solana/web3.js` verschwindet aus allen `package.json`. Danach Bundle
  messen, `check-wiring` laufen lassen und die Fallstricke anpassen. Die Regel „kein
  `readBigInt64LE`“ bleibt.

## Fragen

- **W1 – Abhängigkeiten.** `@solana/kit` (MIT) und `@solana-program/system` (Apache-2.0), beide
  exakt gepinnt. Freigeben?
- **W2 – Signieren über `@noble/curves`** statt Web Crypto (Schlüssel nur kurz, danach genullt;
  läuft auch in älteren Browsern)? Vorschlag: ja.
- **W3 – Wann?** A-12 (Kasse über Squads) braucht neue Anweisungen. Werden sie gleich für kit
  geschrieben, entfällt ein Umbau. Vorschlag: A-21a und A-21b vor A-12a, den Rest danach. Oder
  erst nach Mainnet (M-8), weil der Gewinn mit 7 % klein ist.

## Was dieser Plan nicht tut

Er enthält keinen Code und keine neue Abhängigkeit. Die Messwerte stammen aus einem eigenen
Ordner außerhalb des Repos.
