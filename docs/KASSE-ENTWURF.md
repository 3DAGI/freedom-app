# Gemeinsame Kasse für Räume über Squads – Entwurf (A-12)

Stand 10.10.2026, Spur A. **Entschieden 09.10.2026 (MENSCH):** kein eigenes Programm;
stattdessen Squads anbinden, die geprüfte Mehrfachsignatur auf Solana
(`docs/neuordnung/SAMMLUNG.md`, A-12). Dieser Entwurf legt fest, *wie*. Freizugeben
sind die Vorschläge V1–V7 und die Antworten auf die Fragen W1–W5. „Wie vorgeschlagen“
genügt; jede Frage lässt sich einzeln anders entscheiden.

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
