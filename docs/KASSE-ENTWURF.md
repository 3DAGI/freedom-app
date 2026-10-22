# Gemeinsame Kasse für Räume über Squads – Entwurf (A-12)

Stand 10.10.2026, Spur A. **Entschieden 09.10.2026 (MENSCH):** kein eigenes Programm;
stattdessen Squads anbinden, die geprüfte Mehrfachsignatur auf Solana
(`docs/neuordnung/SAMMLUNG.md`, A-12). Dieser Entwurf legt fest, *wie*. Freizugeben
sind die Vorschläge V1–V7 und die Antworten auf die Fragen W1–W5. „Wie vorgeschlagen“
genügt; jede Frage lässt sich einzeln anders entscheiden. **Freigegeben am 11.10.2026
(MENSCH)** – mit einer Änderung bei W2 (Abschnitt „Entscheidungen vom 11.10.2026“ am Ende;
er gilt vor den Vorschlägen darüber).

## Worum es geht

Ein Raum soll SOL gemeinsam halten. Geld geht nur hinaus, wenn genug Mitglieder
zustimmen. Ein eigenes Programm bräuchte ein eigenes Audit. Squads v4 ist mehrfach
geprüft und läuft auf Mainnet, seit Ende 2024 unverändert.

## Befunde (gemessen bzw. nachgelesen am 10.10.2026)

| | Squads v4 |
|---|---|
| Programm | `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`, dieselbe Kennung auf Devnet und Mainnet |
| Unveränderlich? | **Mainnet: ja.** Es gibt keine Upgrade-Berechtigung mehr; der Stand ist seit Slot 302 582 236 fest (`ProgramData`, abgefragt). **Devnet: nein.** Squads kann es dort ändern (Berechtigung `HM5y4m…`). Der Devnet-Stand ist neuer (Slot 446 638 068), und sein Programm hat eine andere Prüfsumme als das auf Mainnet. |
| Audits | OtterSec, Neodyme, Certora (mit formaler Verifikation), Trail of Bits; der geprüfte Commit steht im README (`64af733…`) |
| Lizenz | Das Programm steht unter AGPL-3.0. Die App ruft es nur auf der Kette auf; sein Code kommt nicht ins Repo und nicht ins Bundle. Das SDK `@sqds/multisig` 2.1.4 steht unter MIT. |
| SDK | Für den Browser gebündelt: **772 KB (124 KB gzip) ohne web3.js**, 1,5 MB (264 KB gzip) mit. Es zieht `@solana/spl-token` 0.3, `@metaplex-foundation/beet` 0.7.1, `bn.js`, `assert` und `buffer` nach und hängt an web3.js v1 (siehe A-21). Letzte Fassung vom 15.08.2025. |
| Kosten | Gebühr für das Anlegen: 0 auf beiden Netzen (Program-Config, abgefragt). Squads kann sie ändern (Config-Berechtigung `8xgjL6…` auf Mainnet). Dazu kommt die Miete: rund 0,003 SOL für das Multisig-Konto mit fünf Mitgliedern, und Miete für jeden Vorschlag (Transaktion und Abstimmung). Die Miete eines Vorschlags kommt zurück, wenn ein `rent_collector` gesetzt ist. |
| Ablauf | Das Multisig-Konto hält Mitglieder (je mit den Rechten Initiate, Vote, Execute), Schwelle, Zeitschloss und `config_authority`. Der Vault (PDA, Index 0) hält die SOL. Eine Auszahlung läuft so: `vaultTransactionCreate` → `proposalCreate` → `proposalApprove` bis zur Schwelle → `vaultTransactionExecute`. Mitglieder, Schwelle und Zeitschloss ändert ohne `config_authority` nur `configTransactionCreate`/`…Execute`, mit derselben Abstimmung. Jede solche Änderung macht offene Vorschläge ungültig (`staleTransactionIndex`). |
| Öffentlich | Auf der Kette steht alles: die Adressen der Mitglieder, die Schwelle, jeder Vorschlag mit Empfänger und Betrag, jede Stimme. |

Quellen: Squads v4 auf GitHub (README, IDL im SDK), docs.squads.so (Create Multisig), Konten auf Devnet und Mainnet selbst abgefragt
(`getAccountInfo` für Programm, `ProgramData` und Program-Config), npm (SDK selbst gebündelt
mit esbuild).

## Vorschläge

- **V1 – Eigene Anweisungen statt SDK.** Die App baut die nötigen Anweisungen selbst
  nach der IDL, wie bei HTLC und Zahlkanal: `multisigCreateV2`, `vaultTransactionCreate`,
  `proposalCreate`, `proposalApprove`, `proposalReject`, `vaultTransactionExecute`,
  `configTransactionCreate`/`…Execute`, `vaultTransactionAccountsClose`. Getestet wird
  gegen das echte Programm: Die Tests laden das Mainnet-Programm und das Devnet-Programm
  mit fester Prüfsumme in den lokalen Validator (wie `contracts/solana-channel/pruefen.sh`).
  Vom Programm landet nichts im Repo außer den Layouts.
- **V2 – Ohne Verwalter.** `config_authority` bleibt leer. Kein einzelner Schlüssel, auch
  nicht der des Gründers, ändert Mitglieder oder Schwelle; das geht nur über eine
  Abstimmung mit derselben Schwelle.
- **V3 – Wer Mitglied sein darf, sagt der Raum; wer es ist, sagt die Kette.** Ein neues
  Recht „kasse“ (`Permission` in `spaces.ts`, Spur B, im Pull Request genannt) erlaubt die
  Mitgliedschaft. Mitglied ist man erst, wenn eine Abstimmung einen aufnimmt. Die App
  zeigt Abweichungen: ein Recht ohne Mitgliedschaft, eine Mitgliedschaft ohne Recht. Es
  zählt immer die Kette.
- **V4 – Eine eigene Adresse je Raum und Mitglied.** In der eingebauten Wallet ist die
  Adresse eines Mitglieds eine frische Adresse aus dem Vorrat (4.9c), nie die Hauptadresse.
  Die Mitglieder stehen öffentlich auf der Kette; sonst verbände jede Kasse die Wallets
  ihrer Mitglieder. Mit Wallet Standard wählt man die Adresse selbst, und die App rät zu
  einer neuen.
- **V5 – Ehrlich über das, was öffentlich ist.** In einem offenen Raum steht die Adresse
  der Kasse in der Raumdefinition; die Kasse ist dann öffentlich wie der Raum. In einem
  privaten Raum steht sie nur als inneres Event in der Gruppe. Die Verbindung zum Raum
  bleibt dann in der Gruppe, aber Mitglieder-Adressen, Zahlungen und Stimmen sieht jeder
  auf der Kette. Der Datenschutzbericht bekommt eine Grenze „raum-kasse“. Kein Text
  verspricht eine „private Kasse“.
- **V6 – Stimmen über die Kette, Hinweise über den Raum.** Vorschläge und Stimmen stehen
  nur auf der Kette. Die App meldet einen neuen Vorschlag im Raum (Index der Transaktion)
  und liest den Stand über den `RpcPool` (Stichprobe nach 5.8). Empfänger und Betrag zeigt
  sie vor jeder Stimme aus der Transaktion auf der Kette, nie aus dem Hinweis.
- **V7 – Nur SOL, nur Devnet bis M-8, in Teilschritten:**
  - A-12a Baustein: Anweisungen, Lesen der Konten, Tests gegen beide Programme im Validator.
  - A-12b App: Kasse anlegen und einzahlen.
  - A-12c Auszahlen: Vorschlag, Stimme, Ausführen, Miete zurück.
  - A-12d Mitglieder und Schwelle ändern.
  - A-12e Oberfläche (Spur C).

## Fragen

- **W1 – SDK oder eigene Anweisungen?**
  - **A** SDK: schneller am Ziel, aber +772 KB in `freedom.html` und an web3.js v1
    gebunden, was A-21 erschwert.
  - **B** eigene Anweisungen (V1): keine Abhängigkeit, aber mehr Arbeit. Das
    Nachrichtenformat einer Vault-Transaktion (`VaultTransactionMessage`) ist ein eigenes
    Layout von Squads, und die Tests laufen gegen beide Programme.

  Vorschlag **B**: Das Bundle bleibt klein. Die Tests gegen das unveränderliche
  Mainnet-Programm zeigen, ob die Layouts stimmen.
- **W2 – Schwelle.** Vorgabe ist die Mehrheit der Mitglieder, mindestens 2. Der Gründer
  kann sie beim Anlegen ändern; danach nur noch über eine Abstimmung (V2). Einverstanden?
- **W3 – Zeitschloss.** Vorgabe 0. Wählbar sind 1 h und 24 h; dann kann ein Mitglied eine
  angenommene Auszahlung noch vor der Ausführung sehen und im Raum Alarm schlagen.
  Einverstanden, oder eine andere Vorgabe?
- **W4 – Neues Recht „kasse“** (V3)? Die andere Möglichkeit: Der Gründer wählt die
  Mitglieder frei, ohne Bezug zu den Rechten des Raums. Vorschlag: das neue Recht.
- **W5 – Kassen auch in offenen Räumen?** Dort sieht jeder Ein- und Auszahlungen und
  weiß, zu welchem Raum sie gehören. Vorschlag: ja, mit Hinweis beim Anlegen; in privaten
  Räumen bleibt die Zuordnung in der Gruppe (V5).

## Was dieser Entwurf nicht tut

Er enthält keinen Code, keine neue Abhängigkeit und keinen Deploy (Squads läuft schon).
Spending Limits (kleine Auszahlungen ohne Abstimmung) und Kassen für SPL-Token kommen
frühestens nach A-12d, als eigener Punkt.

## Entscheidungen vom 11.10.2026 (MENSCH)

Dieser Abschnitt gilt vor den Vorschlägen oben.

| Nr. | Entscheidung |
|---|---|
| V1–V7 | wie vorgeschlagen |
| W1 | **B** – eigene Anweisungen nach der IDL, kein SDK |
| W2 | **Wählbar beim Anlegen** – Wunsch MENSCH: „ob der Gründer entscheiden kann oder ob DAO mit Mehrheitsrecht“. Ausgestaltung unten |
| W3 | **0** als Vorgabe, 1 h oder 24 h wählbar |
| W4 | **Neues Recht „kasse“** |
| W5 | **Ja**, auch in offenen Räumen, mit Hinweis beim Anlegen |

### Zwei Arten von Kasse (W2)

Squads gibt jedem Mitglied eigene Rechte: vorschlagen, abstimmen, ausführen (Initiate, Vote,
Execute). Daraus werden zwei Arten, gewählt beim Anlegen:

- **„Gründer entscheidet“:**
  - Nur der Gründer darf abstimmen und ausführen; die Schwelle ist 1.
  - Die übrigen Mitglieder mit dem Recht „kasse“ dürfen Auszahlungen vorschlagen.
  - Mitglieder und Art ändert nur der Gründer, über eine Abstimmung mit seiner einen Stimme.
  - Ehrlich gesagt heißt das: Über das Geld verfügt der Gründer allein. Freedom verwahrt
    trotzdem nichts. Die App sagt das beim Anlegen und bei jeder Einzahlung.
- **„Mehrheit“ (DAO):**
  - Jedes Mitglied darf vorschlagen, abstimmen und ausführen.
  - Die Schwelle ist die Mehrheit, mindestens 2.
  - Mitglieder, Schwelle und Art ändert nur eine Abstimmung mit derselben Schwelle (V2).

Für beide gilt: `config_authority` bleibt leer (V2). Kein Schlüssel ändert die Kasse am
Programm vorbei, auch nicht der des Gründers. Die Art steht auf der Kette (Rechte und
Schwelle); die App liest sie von dort, nie aus dem Raum. Ein Wechsel der Art ist eine
Änderung der Konfiguration und macht offene Vorschläge ungültig (`staleTransactionIndex`).

## Umsetzung

- **A-12a1 (21.10.2026):** Baustein `packages/protocol/src/kasse.ts`. Er legt die Kasse an
  (`multisig_create_v2`, beide Arten nach W2), liest Kasse und Einstellungen des Programms und
  bestimmt die Art nur aus dem Stand auf der Kette (`kassenArt()`). Getestet gegen das Programm
  von Mainnet und von Devnet, je mit fester Prüfsumme (`contracts/squads/pruefen.sh`, CI
  `kasse.yml`). Die Bytes der Anweisung gleichen denen des SDK (Vektoren „kasse-anlegen-…“).
  Festgelegt dabei:
  - Die Miete abgeschlossener Vorschläge geht an den Tresor der Kasse (`rent_collector`).
    Ohne `rent_collector` bliebe sie liegen; an ein Mitglied verbände sie es mit der Kasse.
    Bestätigt am 21.10.2026 (MENSCH: „Passt“).
  - Das Schatzamt (Empfänger der Gebühr für das Anlegen) kommt aus den Einstellungen des
    Programms auf der Kette. Ein anderes lehnt Squads ab.
  - Mitglieder liest die App nur von der Kette; die Reihenfolge legt das Programm fest.
- **A-12a2 (21.10.2026):** Auszahlen. Vorschlagen legt die Vault-Transaktion (eine Überweisung aus Tresor 0
  an einen Empfänger) und den Vorschlag in einem Zug an; abstimmen (`proposal_approve`/`proposal_reject`),
  ausführen und abschließen (`vault_transaction_accounts_close`, Miete an den Tresor) sind je eine Anweisung.
  Empfänger und Betrag liest `leseAuszahlung()` von der Kette – nur in genau der Form, die die App baut;
  jede andere Transaktion ist keine Auszahlung (V6). Der Vorschlagende zahlt die Miete beider Konten; sie
  kommt beim Abschließen in den Tresor, nicht zu ihm zurück.
- **A-12b1 (21.10.2026):** Kasse im Raum, Protokoll (`raum-kasse.ts`, `docs/PROTOCOL.md` §42). Neues Recht
  „kasse“ (W4, `spaces.ts`); die Adresse der Kasse steht als Tag `kasse` in der Definition – offen nur in der des
  Gründers, privat nur in der eines Admins (V5). Jedes Mitglied nennt dem Raum seine Adresse für die Kasse (Kind 34704,
  privat nur als inneres Event) samt Nachweis: Die Adresse signiert Ort und Nostr-Schlüssel, so gibt niemand eine
  fremde als seine aus. `kassenAbweichungen()` zeigt Recht ohne Mitgliedschaft und Mitgliedschaft ohne Recht (V3).
- **A-12b2a (21.10.2026):** In der App nennt, wer das Recht „kasse“ hat, dem Raum eine frische Adresse der eingebauten
  Wallet (Raum-Menü). Die Wallet signiert dafür nur den festen Text des Nachweises, keine beliebigen Bytes. Offen geht die
  Meldung an die Adresse des Raums, privat nur in die Gruppe; vorher sagt die App, was öffentlich wird. Der
  Datenschutzbericht nennt die Grenze „raum-kasse“. Wer die private Definition neu schreibt (Raumstand, Kanäle,
  Agentenketten), gibt die Kasse mit. Verbundene Wallets (Wallet Standard) folgen als b2d.
- **A-12b2b (22.10.2026):** Anlegen in der App – offen der Gründer, privat ein Admin, nur solange der Raum keine Kasse hat.
  Mitglieder sind die eigene genannte Adresse und die genannten Adressen derer mit dem Recht „kasse“; wer keine genannt hat,
  fehlt und kommt später nur über eine Abstimmung dazu (A-12d). Nur Devnet (V7): Die App fragt dafür nur eigene Endpunkte,
  deren Genesis-Hash Devnet ist (`endpunkteImNetz()`), nie den gemeinsamen Pool – er wiche bei einem Ausfall auf Mainnet
  aus. Der Create-Key ist frisch, unterschreibt im Protokoll (`baueKasseAnlegen()`) und wird gleich genullt. Die Miete rechnet
  `kassenKontoGroesse()` (im Validator gegen die echte Länge geprüft). Vor dem Senden zeigt die App Miete, Gebühr von Squads
  und die zahlende Adresse; sie steht als Ersteller auf der Kette, deshalb zahlt am liebsten die Adresse für die Kasse (V4),
  sonst sagt der Text, dass eine andere damit verbunden wird. Bei „Gründer entscheidet“ sagt er, dass der Gründer allein
  verfügt. Danach steht die Kasse in der Definition – offen eine neue des Gründers, privat über die Stelle mit den Ketten;
  scheitert das, fragt die App, bis es gelingt oder man abbricht.
- **A-12b2c (22.10.2026):** Stand und Einzahlen. „Kasse …“ im Raum-Menü liest die Kasse von der Kette (nur Devnet, eigene
  Endpunkte) und zeigt Tresor, Guthaben, Art, Wartezeit und Mitglieder, dazu jede Abweichung zum Raum (V3): Recht ohne
  Mitgliedschaft (mit oder ohne genannte Adresse), Mitgliedschaft ohne Recht (bekannt oder unbekannt). Es zählt die Kette.
  Eingezahlt wird an den Tresor, nur in eine Kasse, die die App so anlegen würde (`kassenArt()`, ohne Verwalter) – eine
  andere zeigt sie nur. Vorher die Rückfrage mit dem Zahler (am liebsten die eigene Adresse für die Kasse), danach das
  Tageslimit der Wallet; bei „Gründer entscheidet“ sagt sie, dass der Gründer allein verfügt (W2). Die erste Einzahlung
  muss die Miete des Tresors decken.
- **A-12b2d (22.10.2026):** Adresse aus einer verbundenen Wallet (V4: man wählt sie selbst, die App rät zu einem neuen
  Konto). Nur ohne eingebaute Wallet – die geht vor, weil sie eine frische Adresse aus dem Vorrat nimmt; mit gesperrtem
  Tresor erst entsperren. Die Wallet signiert den festen Text des Nachweises (`solana:signMessage`, bei `window.solana`
  `signMessage`); setzt sie einen eigenen Vorspann davor (`signedMessage` weicht ab) oder ist die Signatur nicht Ed25519
  mit 64 Byte, nimmt die App sie nicht. Vor dem Senden prüft sie den Nachweis gegen Adresse, Ort und Schlüssel. Ohne
  Tresor verlangt sie für diesen Weg keinen. Anlegen und einzahlen bleiben bei der eingebauten Wallet. Damit ist A-12b fertig.
- **A-12c1 (22.10.2026):** Auszahlen in der App. „Kasse …“ zeigt die jüngsten zehn Vorschläge von der Kette – Betrag,
  Empfänger, Status, Stimmen, bei Wartezeit ab wann (V6) – und bietet nur an, was das Programm jetzt annimmt
  (`vorschlagsSchritte()`): vorschlagen (mit dem Recht), dafür oder dagegen (aktiv, nicht veraltet, nicht zum zweiten Mal
  gleich; eine Stimme lässt sich umkehren), auszahlen (angenommen, nach der Wartezeit – im selben Zug abgeschlossen, die
  Miete geht in den Tresor) und abschließen (ausgeführt, abgelehnt, abgebrochen oder veraltet; das darf jeder). Diese Regeln
  prüft der Validator gegen beide Programme. Nur mit der eingebauten Wallet und nur auf Devnet; unterschrieben wird mit der
  eigenen Adresse für die Kasse. Hat sie kein Guthaben, zahlt eine andere eigene Adresse Gebühr und Miete (`mietZahler`,
  SDK-Vektor) – die Rückfrage sagt, dass sie damit verbunden wird. Ein Vorschlag, nach dem im Tresor weniger als die Miete
  bliebe, geht nicht hinaus. Über eine Transaktion anderer Form stimmt die App nicht ab.
- **A-12a3 (22.10.2026):** Baustein „Konfiguration ändern“ (für A-12d). Vorschlagen (`config_transaction_create` und Vorschlag in
  einem Zug), ausführen und abschließen nach der IDL; die Änderungen sind nur Mitglied dazu oder weg, Schwelle und Wartezeit (0,
  1 h, 24 h) – keine Ausgabelimits, kein anderer `rent_collector`. `kassenAenderungen()` stellt sie so zusammen, dass die Kasse
  ihre Art behält (W2): Wer dazukommt, bekommt die Rechte der Art, die Schwelle folgt der Mehrheit, der Gründer bleibt.
  `kassenStandNach()` rechnet den Stand danach wie das Programm, mit dessen Prüfungen. Festgestellt im Validator (beide
  Programme): Kommt ein Mitglied dazu, wächst das Konto der Kasse um zehn Plätze auf einmal (`kassenKontoGroesseNach()`), die
  Miete dafür zahlt, wer ausführt. Jede Änderung macht offene Vorschläge veraltet; eine veraltete Auszahlung lässt sich noch
  ausführen, eine veraltete Änderung nicht mehr – nur abschließen. Das Programm prüft die Wartezeit vor dem Veralten. Die App
  liest Änderungen in der Liste der Vorschläge mit und zeigt sie bis A-12d nur.
- **A-12d1 (22.10.2026):** Mitglieder und Wartezeit in der App ändern. „Kasse ändern …“ bietet dazu nur an, wer im Raum das Recht
  „kasse“ hat und eine Adresse genannt hat (V3), weg jedes Mitglied, dazu die Wartezeit (W3); `kassenAenderungen()` stellt die Änderung
  aus dem frisch gelesenen Stand so zusammen, dass die Art bleibt (W2) – die Schwelle folgt der Mehrheit, frei wählbar ist sie nicht.
  Änderungen stehen in der Liste mit dem, was sich laut Kette ändert, und den Namen im Raum, wo jemand die Adresse genannt hat; abstimmen,
  ausführen (im selben Zug abgeschlossen) und abschließen wie bei Auszahlungen. Für eine Änderung, nach der die Kasse eine andere Art hätte
  (etwa aus einem anderen Programm), stimmt die App nicht und führt sie nicht aus (`behaeltArt()`). Die Miete eines Vorschlags rechnet
  `konfigurationKontoGroessen()` (im Validator gegen beide Programme geprüft); wächst das Konto der Kasse, zahlt der Ausführende den Zuwachs –
  die Rückfrage nennt ihn vorher.
- **A-12c2 (22.10.2026):** Hinweis im Raum auf neue Vorschläge (V6). Nach „vorschlagen“ und „Kasse ändern …“ schreibt die App eine
  gewöhnliche Nachricht mit der Nummer des Vorschlags in den ersten Kanal, in den der Vorschlagende schreiben darf
  (`kassenHinweisKanal()`) – offen signiert an den Raum (Kind 42), privat nur als inneres Event der Gruppe, ohne Erwähnung. Kein eigenes
  Format: Was ein Vorschlag auszahlt oder ändert, liest jedes Mitglied von der Kette. Die Rückfrage sagt vorher, dass der Hinweis folgt;
  ging er nicht hinaus, sagt die App es (der Vorschlag steht trotzdem auf der Kette). Nach Stimmen, Ausführen und Abschließen kein Hinweis.
- **Geteilt:** A-12a in a1 (Anlegen, Lesen), a2 (Auszahlen) und a3 (Konfiguration ändern, für A-12d; fertig).
  A-12d in d1 (Mitglieder dazu und weg, Wartezeit; fertig) und d2 (Wechsel der Art, Gründer ↔ Mehrheit – „ein Wechsel der Art ist
  eine Änderung der Konfiguration“: die Rechte eines Mitglieds ändert Squads nur über weg und wieder dazu).
  A-12b (App: anlegen, einzahlen) braucht nur a1, A-12c (Auszahlen in der App) a2. A-12b in b1 (Protokoll:
  Recht, Definition, Adressen, Abweichungen) und b2 (App) – b2 in a (Adresse nennen, Grenze), b (anlegen), c (einzahlen,
  Stand, Abweichungen) und d (Adresse aus einer verbundenen Wallet). A-12c in c1 (Auszahlen mit der eingebauten Wallet), c2
  (Hinweis im Raum auf neue Vorschläge, V6; fertig) und c3 (abstimmen und auszahlen mit einer verbundenen Wallet).
