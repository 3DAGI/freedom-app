# Eingebaute Lightning-Wallet – Entwurf (E4b, A-17)

Stand 09.10.2026, Spur A. **Entschieden 09.10.2026 (MENSCH): E4b D**: Breez SDK
(Spark) eingebaut, dazu Cashu nur für kleine Beträge und ohne Netz (NUT-11,
NUT-12); Cashu immer als verwahrt benennen und die Mint nennen
(`docs/neuordnung/SAMMLUNG.md`, Abschnitt 5, E4b; Anhang E). Dieser Entwurf
legt fest, *wie*. Freizugeben sind die Vorschläge V1–V6 und die Antworten auf
die Fragen W1–W5. „Wie vorgeschlagen“ genügt; jede Frage lässt sich einzeln
anders entscheiden.

## Worum es geht

Heute zahlt die App Lightning nur über eine fremde Wallet per NWC (E4 A vom
04.10.). Wer keine hat, kann mit Lightning nichts bezahlen – „alles soll auch
nur mit Lightning gehen“ (MENSCH 09.10.). SOL hat seit 4.2 eine eingebaute
Wallet; Lightning soll gleichziehen.

## Befunde (gemessen bzw. nachgelesen am 09.10.2026)

| | Breez SDK (Spark) | Cashu (cashu-ts) |
|---|---|---|
| Paket | `@breeztech/breez-sdk-spark` 0.26.1, MIT | `@cashu/cashu-ts` 4.11.0, MIT oder Apache-2.0 |
| Größe | WASM 12,5 MB, **gzip 5,1 MB** (je Ziel: web, bundler, nodejs, deno) | rund 2 MB entpackt; Abhängigkeiten `@noble`/`@scure` in Version 2 (die App nutzt teils Version 1 – doppelt im Bundle) |
| Wer verwahrt | Nach eigener Aussage niemand: Ein vorab signierter Ausstieg auf die Kette ist jederzeit möglich. Aber zwei von drei Spark-Betreibern signieren jede Übertragung mit, und der Ausstieg ohne sie ist in der Praxis kaum erprobt. | Die Mint: Hinter den Token steht ihr Versprechen. Freedom verwahrt nichts, der Nutzer trägt das Risiko der Mint. |
| Schlüssel | eigener Seed (BIP-39) oder externer Signer | Token im Speicher der App, Schlüssel für NUT-11 (P2PK) |
| Konto | **API-Schlüssel von Breez** für Mainnet (kostenlos, per Formular – MENSCH); Regtest ohne Schlüssel, Testgeld vom Faucet von Lightspark | keins; die Mint wählt der Nutzer |
| Ohne Netz | nein | ja – Token übergeben (NUT-12 prüft die Signatur der Mint offline, NUT-11 bindet an einen Schlüssel) |
| Was andere sehen | Spark-Betreiber und Breez-Server sehen Zahlungen der Wallet; LSP-Rolle für Lightning | die Mint sieht Ein- und Auszahlungen, nicht die Übergaben zwischen Nutzern (Blind-Signaturen) |

Quellen: Breez SDK Spark (Getting Started, Install JavaScript, Testing), npm
(Paketgrößen, selbst entpackt), Cashu NUT-11/NUT-12, Sammlung Anhang E.

## Vorschläge

- **V1 – Ein Zahlweg mehr, nichts fällt weg.** Die eingebaute Wallet wird eine
  weitere Schiene neben NWC (`PaymentRail`, 4.1); NWC bleibt. Alle Geldwege
  laufen wie heute nur über die Schienen (`check-wiring.py`: „0
  Wallet-Zugriffe außerhalb der Schienen“).
- **V2 – Schlüssel nur im Tresor.** Seed der Spark-Wallet und Cashu-Token liegen
  nur im Tresor (`geheim`), nie in `localStorage`, nie in der Sicherung ohne
  Verschlüsselung; Tresor-Pflicht vor Geld wie seit 1.2c. Beim Löschen im
  Notfall (Panik, `WIPE_DATENBANKEN`) sind sie weg – Hinweis vorher.
- **V3 – Cashu nur klein und nur ausdrücklich.** Höchstens ein fester Betrag im
  Cashu-Topf (Vorschlag 10.000 sats), Mint vom Nutzer gewählt und überall
  genannt („verwahrt von <Mint>“); nie Vorgabe, nie automatisch aufgefüllt.
  Gedacht für Zahlen ohne Netz (Funk, Mesh) und für Kleinstbeträge.
- **V4 – Erst Regtest, dann Mainnet.** Bausteine und Tests gegen Regtest (kein
  Schlüssel, kein echtes Geld); Mainnet erst mit API-Schlüssel des MENSCHEN
  (als Secret, nie im Code) und nach einer Durchsicht der Texte.
- **V5 – Ehrliche Texte.** Datenschutzbericht: Grenze „lightning-spark“ (wer die
  Zahlungen sieht, 2-von-3-Betreiber, Ausstieg kaum erprobt) und
  „cashu-verwahrt“ (die Mint hält das Geld). App und Website sagen nie
  „nicht verwahrend“ ohne diese Einschränkung.
- **V6 – Teilschritte.** A-17a Baustein Spark (Schiene, Regtest-Tests,
  ohne Oberfläche) · A-17b Oberfläche Spark (Spur C oder A nach Absprache) ·
  A-17c Cashu-Baustein (Mint wählen, Token senden/empfangen, NUT-11/12) ·
  A-17d Cashu über Funk/Mesh (Token nur im Umschlag, `pruefeMeshInhalt()`).

## Fragen

- **W1 – Wie kommt das WASM in die App (5,1 MB gzip)?**
  A eingebettet in `freedom.html` wie die MLS-Engine (+ rund 6,8 MB als Base64;
  die App wüchse von 8 auf rund 15 MB) · B als eigene Datei neben der App
  (`freedom-spark.wasm`), nur auf Klick geladen, mit fester Prüfsumme im
  Bundle, reproduzierbar gebaut und über `pages.yml` veröffentlicht wie
  `freedom-sw.js` · C nur in der Hülle (Desktop/Android), nicht im Browser.
  Vorschlag **B**: Wer Lightning nicht nutzt, lädt nichts; die Prüfsumme
  bindet die Datei an den Stand der App.
- **W2 – Welcher Seed?** A aus der Merkphrase der Identität abgeleitet (eigener
  Pfad, eine Sicherung für alles) · B eigener Seed im Tresor (getrennt: ein
  Leck des einen trifft das andere nicht, aber eine zweite Sicherung).
  Vorschlag **A** mit eigenem, festem Pfad – sonst verliert man Geld beim
  Gerätewechsel, weil die zweite Sicherung fehlt.
- **W3 – Standard-Schiene?** Wird die eingebaute Wallet zur Vorgabe für
  Lightning, wenn kein NWC verbunden ist? Vorschlag **ja**, mit Rückfrage vor dem
  ersten Aufladen.
- **W4 – Höchstbetrag Cashu** (V3): 10.000 sats? Anderer Wert?
- **W5 – API-Schlüssel:** Der MENSCH beantragt ihn bei Breez (Formular, kostenlos)
  und legt ihn als Secret ab – in der App steht er im Klartext im Bundle (ein
  Browser kann ihn nicht verbergen). Breez sieht damit, dass die App Freedom
  ist, nicht wer sie nutzt. Einverstanden?

## Was dieser Entwurf nicht tut

Kein Code, keine neue Abhängigkeit in diesem Schritt. Die Abhängigkeiten
(`@breeztech/breez-sdk-spark`, `@cashu/cashu-ts`) kommen erst mit A-17a bzw.
A-17c, mit Größe und Lizenz im Pull Request.
