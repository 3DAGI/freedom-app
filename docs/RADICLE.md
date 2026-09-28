# Quellcode auf Radicle spiegeln (Schritt 5.9)

Anleitung für den MENSCHEN. Radicle ist ein Netz für Git ohne Server: Knoten
halten Repositories untereinander vor, jeder Stand ist signiert. Fällt GitHub
weg oder sperrt das Repository, bleibt der Code dort erreichbar – so wie die
App über ihre Spiegel (5.3).

Stand der Anleitung: Radicle 1.x. Befehle ändern sich gelegentlich –
maßgeblich sind `rad --help` und radicle.xyz.

## 1. Einrichten (einmal, am besten auf dem GX10)

```bash
curl -sSf https://radicle.xyz/install | sh   # installiert rad und radicle-node
rad auth                                      # eigene Radicle-Identität, mit Passphrase
rad node start                                # der eigene Knoten – er hält das Repository vor
```

Die Radicle-Identität ist ein eigener Schlüssel, nicht die Nostr-Identität des
Projekts und kein Schlüssel der App. Die Passphrase gehört in deinen
Passwortspeicher, nicht in das Repository.

## 2. Repository anlegen

In einem Klon von GitHub, auf `main`:

```bash
git clone https://github.com/3DAGI/freedom-app.git && cd freedom-app
rad init --name freedom-app --description "FreedomStack – Nachrichten, Zahlungen und KI ohne Betreiber" \
  --default-branch main --public
rad .                                         # zeigt die Kennung: rad:z…
```

`rad init` legt die Gegenstelle `rad` an und veröffentlicht den Stand im Netz.

## 3. Aktuell halten

Nach jedem Merge nach `main` (etwa per cron auf dem GX10, alle 30 Minuten):

```bash
git -C ~/freedom-app fetch origin main
git -C ~/freedom-app push rad origin/main:refs/heads/main
```

Gepusht wird nur, was schon auf GitHub steht – der Radicle-Stand ist ein
Spiegel, keine zweite Quelle für Änderungen. Beiträge kommen weiter über Pull
Requests oder als NIP-34-Patches (App, Seite Repositories).

## 4. Bekannt machen

- `spiegel/quellen.json`: den Eintrag `radicle` von `PLATZHALTER:rad:<repository-id>`
  auf die echte Kennung setzen (`rad:z…`). Dann zeigt ihn die Startseite unter
  den Bezugsquellen, und das Release-Manifest nennt ihn.
- Die NIP-34-Ankündigung des Repositorys (Kind 30617, 5.9b) nimmt die Kennung
  als Klon-Adresse auf – NIP-34-Clients und die App finden den Spiegel so.
- Andere halten ihn vor mit `rad seed rad:z…`; klonen mit `rad clone rad:z…`.

## Checkliste (MENSCH)

- [ ] Radicle auf dem GX10 einrichten (`rad auth`, `rad node start`).
- [ ] `rad init` im Klon, Kennung notieren.
- [ ] cron für das Nachschieben nach jedem Merge.
- [ ] Kennung in `spiegel/quellen.json` eintragen (oder mir nennen).
