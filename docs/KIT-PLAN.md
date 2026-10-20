# @solana/kit statt web3.js v1 – Plan (A-21)

Stand 10.10.2026, Spur A. Sammlung A-21 (Anhang E): Lohnt der Wechsel, und wie geht er in
Schritten, die jeder für sich grün sind? Kein Code. Neue Abhängigkeiten sind ein STOPP-Punkt.
Freizugeben sind deshalb die Abhängigkeiten und die Antworten auf W1–W3. **Freigegeben am
11.10.2026 (MENSCH): wie vorgeschlagen** (Abschnitt „Entscheidungen vom 11.10.2026“ am Ende).

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

- **A-21a Vektoren** – **fertig** (14.10.2026): `protocol/test/fixtures/solana-vektoren.json`, 17 Nachrichten
  (Protokoll und Knoten 10, App 9, davon 2 gleich). Für jede Transaktion, die App oder Knoten heute bauen, gibt es einen Test
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
  Geteilt (14.10.2026, MENSCH: „Ja“), weil er sonst rund 20 Dateien berührt:
  - **A-21b1** Protokoll: Zahlkanal (`channel.ts`) und Überweisung ohne Internet
    (`sol-offline.ts`) als kit-Anweisungen; eine Übergangsbrücke zu web3.js
    (`TransactionInstruction`) hält die Aufrufer unverändert, bis A-21d/e sie umstellen –
    **fertig** (14.10.2026): `kit-bruecke.ts` (`alsWeb3()`, `ed25519Anweisung()` von Hand),
    `…Anweisung` neben `…Ix` im Zahlkanal, System-Anweisungen aus `@solana-program/system`;
    alle 17 Vektoren unverändert. Die PDA rechnet noch web3.js (kit ist dort asynchron) – mit
    A-21f eine eigene, synchrone Rechnung. Das Bundle wächst im Übergang um 138 KB (beide
    Bibliotheken), A-21f nimmt web3.js heraus;
  - **A-21b2** App: HTLC (`sol-htlc.ts`) und Zahlkanal der App (`zahlkanal.ts`), Relayer –
    **fertig** (14.10.2026): HTLC sperren, einlösen und zurückholen, die Einlösung über einen
    Relayer samt Erstattung, die Überweisung (mit Referenz) und der Zahlkanal der App bauen
    kit-Anweisungen; die Transaktion baut bis A-21d noch web3.js (`alsWeb3()`). kit bekommt die
    App nur über das Protokoll (`kit-bruecke.ts` reicht `AccountRole` und `Instruction` weiter,
    dazu `anweisung()` und `ueberweisungAnweisung()`) – eine eigene Abhängigkeit legte eine
    zweite Kopie von kit 8.4.0 neben die des Protokolls (im Wurzelordner liegt 5.x), und das
    Bundle trüge beide. Die `…Ix`-Fassungen von öffnen, aufstocken, erstatten fielen weg; der
    Knoten nutzt bis A-21e nur `rechneKanalAbIxs()`. Die Referenz nach Solana Pay
    (`solReferenz()`) entsteht ohne web3.js. Unverändert: die HTLC-PDA (`swapAddress()`) über
    web3.js – kit rechnet sie nur mit `crypto.subtle`, und das fehlt der App über http im
    Heimnetz; ebenso das Lesen eines Relay-Auftrags in `pruefeRelayAuftrag()` (Transaktion,
    Signaturen) – das gehört zu A-21d. Alle 17 Vektoren unverändert, Bundle +1 KB.

  `@solana/kit` exakt **8.4.0** (die neueste Fassung 8.5.0 ist jünger als zwei Wochen) und
  `@solana-program/system` 0.15.0 (Peer kit ^8.3.0).
- **A-21c RPC.** Der `RpcPool` bleibt der einzige Weg (Stichprobe 5.8). kit spricht über einen
  eigenen Transport auf dem Pool (`createSolanaRpcFromTransport`). Betroffen sind
  `deposit-verify.ts`, `verdienst.ts` und `solana-adapter.ts` – **fertig** (15.10.2026):
  `kit-rpc.ts` mit `poolTransport()`/`poolRpc()` (jede Anfrage über `pool.call()`, Fehler der
  Kette als `SolanaError` mit Code, sonst `rpc-unerreichbar`) und den Lesern `leseKonto()`,
  `leseProgrammKonten()`, `leseGuthaben()`. Über kit lesen jetzt: Sperren und das Preimage der
  Einlösung (`AnchorSolanaHtlc.get()`/`getRevealedPreimage()`, `reader(rpc)`), die
  Deposit-Prüfung des Knotens, die Kanäle des Knotens und das Kanal-Programm im Verdienen-Tab
  (`programmBereit()`), der Rückhol-Wächter und die Prüfung der Gegenseite im Tausch – die App
  über `solRpc()` auf ihrem gemeinsamen Pool. Dabei behoben: `getRevealedPreimage()` las vier Byte
  Länge vor dem Preimage, die das Programm (`[u8; 32]`) nie schrieb, und fand es nie – der LP hätte
  die Hold-Invoice nicht abgerechnet. Noch über web3.js lesen, weil sie die Verbindung mit
  Schreibpfaden teilen: `kanalAufKette()` und die Zahlschienen (A-21d), die Lesestellen des
  Knotens (A-21e). Ganzzahlen über 2^53 (etwa `rentEpoch`) kommen wie bei web3.js gerundet an.
  Bundle +44 KB (RPC-Schicht von kit), bis A-21f web3.js geht.
- **A-21d Signieren.** Ein kit-Signer über `@noble/curves` für `LocalSigner` und die eingebaute
  Wallet mit ihren frischen Adressen. Wallet Standard bekommt Bytes wie heute.
  Geteilt (17.10.2026), weil er rund 15 Dateien in Protokoll und App berührt. Eine Probe zeigte
  vorher, dass kit für alle Fälle des Protokolls dieselben Nachrichten baut wie web3.js, auch mit
  Durable Nonce:
  - **A-21d1** Baustein und SOL ohne Internet – **fertig** (17.10.2026): `kit-transaktion.ts`
    mit `baueTransaktion()` (Blockhash oder Durable Nonce; kit stellt das Weiterschalten an den
    Anfang), `signiereMit()` (`@noble/curves`, nur für Adressen, die die Nachricht verlangt; den
    Schlüssel hält und nullt der Aufrufer), `alsDraht()`/`ausDraht()`, `leseNachricht()` (nur
    legacy, Rollen aus dem Kopf) und `neuerKontoSchluessel()`. Über kit laufen jetzt das
    Nonce-Konto (anlegen, schließen), die Überweisung ohne Internet und ihre Prüfung
    (`sol-offline.ts`); die eingebaute Wallet signiert sie mit `signiereTransaktion()`.
    Gesendet wird bis A-21d2 noch über `Connection.sendRawTransaction()` – die Bytes kommen
    aus `alsDraht()`. Alle 17 Vektoren unverändert, Signaturen gleich denen von web3.js;
  - **A-21d2** Wallet-Schnittstelle und alle Bauer der App – **fertig** (17.10.2026; neu
    geschnitten: die Schnittstelle müssen alle Wallets und alle Aufrufer zugleich wechseln, und
    die HTLC-Bauer umzustellen kostete nicht mehr als eine Übergangshilfe): `WalletSigner`
    hat nur noch `signiereTransaktion()` mit kit-Transaktionen – die eingebaute Wallet direkt
    (ihr `signiere()` für web3.js fiel), Wallet Standard als Bytes (`alsAnbieter()`), Wallets
    nur mit `window.solana` über `ueberWeb3()` (baut das `Transaction`-Objekt aus den Bytes,
    bis W4). Über kit bauen jetzt HTLC sperren, einlösen und zurückholen, die Einlösung über
    einen Relayer, der Zahlkanal und die Überweisung (`signiertVonWallet()`,
    `buildSolTransfer()`). Gesendet wird noch über `Connection.sendRawTransaction()` mit den
    Bytes aus `alsDraht()`. Alle 17 Vektoren unverändert;
  - **A-21d3** Senden und Bestätigen über den Pool (`solRpc()`) statt einer eigenen
    `Connection`, die übrigen Lesestellen der App (Blockhash, Guthaben, Miete, Kanal) und
    `pruefeRelayAuftrag()` (Protokoll) über kit; danach braucht die App web3.js nur noch für
    die Brücke (W4). Geteilt (17.10.2026), rund zehn Dateien in der App:
    - **A-21d3a** Baustein und Zahlschienen – **fertig** (17.10.2026): `kit-rpc.ts` bekommt
      `neuesterBlockhash()`, `sendeTransaktion()` (Base64, immer mit Vorabsimulation),
      `warteAufBestaetigung()` (fragt nach, bis „confirmed“; über der letzten Blockhöhe ohne
      Bestätigung `tx-abgelaufen`, ohne Websocket) und `txFehlerText()` (Fehler der Kette mit
      BigInt). Über den Pool laufen jetzt die Überweisung (`buildSolTransfer()` nimmt eine
      `SolRpc`), das Senden der Schienen, Nonce-Konto anlegen, lesen und schließen, das
      Einreichen einer Offline-Überweisung und die Wahl des Absenders. Der zweite Pool in
      `sol-transfer.ts` fällt. Senden und Nachfragen einer Transaktion gehen an denselben
      Anbieter (`RpcPool.einVorgang()`) – sonst sähen beim Verteilen alle die Signatur;
    - **A-21d3b** HTLC, Tausch, Relayer, Zahlkanal, Wächter, Quittungen und Hinterlegen der App
      über `solRpc()` – **fertig** (20.10.2026): `signiertVonWallet()` fragt den Blockhash über
      den Pool, `sendeUndWarte()` (`sol-htlc.ts`) sendet mit Vorabsimulation und wartet über
      `warteAufBestaetigung()`; sperren, einlösen, zurückholen, die Einlösung über einen Relayer
      (deren Stand liest `leseSignaturStand()`), Zahlkanal öffnen, aufstocken und erstatten, der
      Wächter und die Quittungen laufen über den Pool, je Transaktion ein Vorgang
      (`einVorgang()`). Programmfehler liest `programmFehlerCode()` (Protokoll) – aus dem Fehler
      der Kette (BigInt), aus der Ursache des `SolanaError` und aus altem Text. In der App
      bleibt web3.js nur für `swapAddress()` (PDA synchron, ohne `crypto.subtle`) und die
      Brücke `ueberWeb3()` (W4);
    - **A-21d3c** `pruefeRelayAuftrag()` (Protokoll) über kit.
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

- **W4 – Injizierte Wallets ohne Wallet Standard** (vor A-21f, 17.10.2026). Ältere Erweiterungen
  bieten nur `window.solana`; deren `signTransaction()` verlangt ein `Transaction`-Objekt von
  web3.js. Phantom, Solflare und Backpack melden sich heute auch über den Wallet Standard, der
  Bytes nimmt – den nimmt die App schon zuerst. **A** den Weg über `window.solana` mit A-21f
  streichen (die App nennt dann nur Wallets mit Wallet Standard), **B** web3.js allein für
  diesen Weg behalten (nachgeladen; mit Abhängigkeiten gemessen rund 760 KB), **C** ein eigenes Objekt nachbauen, das wie
  eine `Transaction` aussieht (zerbrechlich). Vorschlag: **A**.

## Was dieser Plan nicht tut

Er enthält keinen Code und keine neue Abhängigkeit. Die Messwerte stammen aus einem eigenen
Ordner außerhalb des Repos.

## Entscheidungen vom 11.10.2026 (MENSCH)

Wie vorgeschlagen:

| Nr. | Entscheidung |
|---|---|
| W1 | **Freigegeben:** `@solana/kit` (MIT) und `@solana-program/system` (Apache-2.0), exakt gepinnt |
| W2 | **Ja** – Signieren über `@noble/curves`, Schlüssel nur kurz, danach genullt |
| W3 | **A-21a und A-21b vor A-12a**, der Rest danach – die Anweisungen der Kasse entstehen gleich für kit |

## Entscheidung vom 14.10.2026 (MENSCH)

„Ja zu allen deinen Vorschlägen“: A-21b in zwei Teilen (A-21b1 Protokoll mit Übergangsbrücke,
A-21b2 App), `@solana/kit` exakt 8.4.0.
