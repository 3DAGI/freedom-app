# Upgrade-Recht der Solana-Programme (Schritt 5.9)

Anleitung für den MENSCHEN. Der Agent ändert keine Upgrade-Rechte, deployt
nicht und setzt nie `--final` (CLAUDE.md, „Verboten“). Er ergänzt danach nur
Texte und Prüfungen – mit den Werten, die du ihm nennst.

## Worum es geht

Wer das Upgrade-Recht eines Programms hält, kann dessen Code jederzeit
austauschen – auch so, dass gesperrte Beträge (HTLC, Zahlkanal) anders
ausgezahlt werden. Heute hält es ein einzelner Schlüssel:

| Programm | Ort | Stand |
|---|---|---|
| HTLC (Swaps, Deposits) | `contracts/solana-htlc` | Devnet `3UmRRrMySUbPwRfV4x7c1A6ah94K7SQt3dDH2uqqdeZ8`, Upgrade-Recht `FsUyQBHzW1dKEaj7MRBEh4UadqbbTAdgdcrfoTdTP3rA` (`DEPLOY.md`). Der Code nennt `B6W19U…` – welche ID gilt, ist offen (Schritt 0.G). |
| Zahlkanal | `contracts/solana-channel` | nicht deployt; `KANAL_PROGRAMM_ID` ist ein Platzhalter ohne Schlüssel |

Ziel für die Testphase auf Mainnet: Das Upgrade-Recht liegt bei einer
**Squads-Mehrfachsignatur mit Zeitverzögerung**, zum Beispiel 2 von 3
Hardware-Wallets und 7 Tage Verzögerung. Dann gilt:

- Ein einzelner gestohlener Schlüssel reicht für ein Upgrade nicht.
- Jedes Upgrade steht vorher sichtbar auf der Kette. Swaps und Sperren laufen
  Stunden, Zahlkanäle Tage – wer dem neuen Code nicht traut, löst vor dem
  Wirksamwerden ein oder holt zurück. Die Verzögerung sollte deshalb **länger
  sein als die längste Laufzeit einer Sperre**.
- Unveränderlich (`--final`) ist das Programm damit noch nicht. Ob und wann es
  das wird, entscheidest du nach Audits und Testphase (`GO-LIVE.md`). Die
  Website sagt heute: erst nach der Testphase unveränderlich.

## Vorher

- Erst auf **Devnet** üben – Squads läuft dort auch. Mainnet erst, wenn jeder
  Schritt einmal geklappt hat.
- Solana-CLI (Agave). Für den Zahlkanal dieselbe Version wie beim Bauen
  (Agave 3.1.10, `contracts/solana-channel/pruefen.sh`).
- Drei Mitglieder: Hardware-Wallets (Ledger o. ä.), möglichst bei getrennten
  Personen oder Orten. Keines davon ist der heutige Upgrade-Schlüssel.
- Etwas SOL für Gebühren auf der Wallet, die die Mehrfachsignatur anlegt.

## 1. Mehrfachsignatur anlegen

In der Squads-App (app.squads.so, Squads v4) mit der Wallet des ersten
Mitglieds verbinden, das Netz wählen (zuerst Devnet) und eine neue Squad
anlegen:

- Mitglieder: die drei Adressen der Hardware-Wallets.
- Schwelle: 2.
- Zeitverzögerung (Time lock): z. B. 604800 Sekunden (7 Tage). Sie gilt
  zwischen der Genehmigung und der Ausführung jedes Vorschlags.

Notiere danach zwei Adressen: die der Mehrfachsignatur und die ihres
**Vaults** (Index 0). Das Upgrade-Recht bekommt der **Vault**, nicht die
Mehrfachsignatur selbst.

Die Bezeichnungen in der Oberfläche ändern sich gelegentlich; maßgeblich ist
die Dokumentation von Squads (docs.squads.so).

## 2. Upgrade-Recht übertragen

```bash
URL=https://api.devnet.solana.com            # später Mainnet
PROGRAMM=<PROGRAMM_ID>
VAULT=<VAULT_ADRESSE>

solana program show "$PROGRAMM" --url "$URL"          # heutiges Upgrade-Recht prüfen
solana program set-upgrade-authority "$PROGRAMM" \
  --new-upgrade-authority "$VAULT" \
  --skip-new-upgrade-authority-signer-check \
  --upgrade-authority <heutiger-schluessel.json> \
  --url "$URL"
solana program show "$PROGRAMM" --url "$URL"          # Authority muss jetzt $VAULT sein
```

`--skip-new-upgrade-authority-signer-check` ist nötig, weil der Vault eine
Programm-Adresse ohne privaten Schlüssel ist und nicht mitsignieren kann.
Genau deshalb: **die Vault-Adresse zweimal prüfen**, am besten gegen die
Anzeige in Squads. Eine falsche Adresse macht das Programm faktisch
unveränderlich – oder übergibt es jemand anderem.

Danach den alten Upgrade-Schlüssel nicht wegwerfen, aber sicher verwahren:
Er kann nichts mehr, belegt aber, wer das Programm ursprünglich deployt hat.

## 3. Ein Upgrade über die Mehrfachsignatur

```bash
# Nachbauen und prüfen, was hochgeladen wird (Zahlkanal: pruefen.sh baut mit festen Werkzeugen)
bash contracts/solana-channel/pruefen.sh --werkzeuge
SO=contracts/solana-channel/target/deploy/solana_channel.so   # HTLC: siehe DEPLOY.md, „Build notes“
sha256sum "$SO"

solana program write-buffer "$SO" --url "$URL"                # gibt <BUFFER> aus
solana program set-buffer-authority <BUFFER> --new-buffer-authority "$VAULT" --url "$URL"
```

Dann in Squads beim Programm (Bereich für Entwickler bzw. Programme) ein
Upgrade mit `<BUFFER>` vorschlagen, als Empfänger der Buffer-Miete eine eigene
Adresse angeben. Zwei Mitglieder genehmigen; ausführen lässt es sich erst nach
der Zeitverzögerung.

Wer prüfen will, dass auf der Kette liegt, was gebaut wurde, vergleicht die
Prüfsumme des Programms auf der Kette mit der des Builds – etwa mit
`solana-verify get-program-hash <PROGRAMM_ID>` und
`solana-verify get-executable-hash "$SO"` (OtterSec,
`solana-verify`).

## 4. Öffentlich machen

Sag mir (dem Agenten) danach: Programm-ID, Vault-Adresse, Schwelle,
Verzögerung und das Netz. Dann trage ich sie in App-Texte, Website und die
Prüfungen ein – vorher behauptet dort nichts, dass es eine Mehrfachsignatur
gibt.

Jeder Vorschlag und jede Ausführung der Squad stehen auf der Kette; wer die
Programme nutzt, kann die Vault-Adresse beobachten.

## 5. Später: unveränderlich

`--final` entfernt das Upgrade-Recht endgültig – danach ist jeder Fehler im
Programm endgültig (`contracts/solana-htlc/README.md`). Liegt das Recht beim
Vault, geht auch das nur als Vorschlag der Mehrfachsignatur, mit derselben
Verzögerung. Vorher: Audits, lange Testphase, Bug-Bounty (`GO-LIVE.md`).

## Checkliste (MENSCH)

- [ ] 0.G klären: welche HTLC-Programm-ID gilt (`B6W19U…` im Code oder `3UmRR…` laut `DEPLOY.md`).
- [ ] Squad auf Devnet anlegen, ein Programm übertragen, ein Upgrade einmal durchspielen.
- [ ] Verzögerung festlegen: länger als die längste Sperre (Zahlkanal-Ablauf, Swap-Fristen).
- [ ] Mainnet: Squad anlegen, HTLC und Zahlkanal nach dem Deploy übertragen.
- [ ] Mir Programm-IDs, Vault, Schwelle und Verzögerung nennen – dann Texte und Prüfungen.
