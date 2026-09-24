# Start — Schritt für Schritt

Von hier bis zu den ersten paar hundert Nutzern. Mit konkreten Adressen,
Befehlen und Reihenfolge.

**Zeitrahmen:** acht bis zwölf Wochen nebenberuflich. Die ersten drei Wochen
sind Technik, danach ist es Arbeit mit Menschen.

---

# Teil 0 — Die Contribution-Frage vorweg

Du hast gefragt: eigenes Git, GitHub, interne Community oder Discord?

## Code: **GitHub.** Ohne Zögern.

Der Grund ist unbequem und trotzdem richtig: **Entwickler sind dort.** Wer
deinen Code verbessern will, hat bereits ein Konto, kennt die Oberfläche und
kann in fünf Minuten einen Pull Request schicken. Verlangst du dafür, dass er
erst deinen Git-Client lernt, hat er Arbeit *bevor* er entschieden hat, ob er
helfen will. Genau dort verlierst du ihn.

Ein Beitrag, der nicht zustande kommt, ist teurer als jede Inkonsequenz.

**Die Ironie gehört offen benannt, nicht versteckt.** Schreib es in die README,
im ersten Satz:

> Dieses Projekt liegt auf GitHub, obwohl es eine Alternative dazu baut.
> Grund: Wir wollen es euch leicht machen mitzuarbeiten, nicht schwer.
> Sobald Freedom Git so gut ist, dass ein Beitrag dort einfacher ist als hier,
> ziehen wir um — und dieser Satz verschwindet.

Das nimmt dir jeder ab. Was dir niemand abnimmt, ist so zu tun, als wäre die
Frage nicht da.

**Dazu ein Spiegel in eurem eigenen Git.** Zwei Gründe: Es beweist, dass die
Funktion existiert, und es ist eure Versicherung, falls GitHub euch eines Tages
sperrt. Ein Cron-Job, der täglich spiegelt, genügt.

## Community: **euer eigener Raum, plus Nostr.**

Hier gilt das Gegenteil. Eine Discord-Community für ein Projekt, das Discord
ersetzt, ist die eine Inkonsequenz, die dir wirklich schadet — sie sagt, dass
du deinem eigenen Produkt nicht traust.

Also:

- **Offizieller Raum in FreedomStack.** Klein und langsam am Anfang. Genau
  deshalb wirst du merken, was fehlt.
- **Präsenz auf Nostr**, wo die Leute heute schon sind. Nicht als Ersatz,
  sondern als Weg dorthin.
- **GitHub Issues und Discussions** für alles Technische.

**Kein Discord, kein Telegram-Hauptkanal.** Du wirst versucht sein, weil es
schneller wächst. Widersteh dem: Der erste Nutzer, der fragt „warum nicht
einfach Discord?", ist dein wichtigstes Gespräch — und du kannst es nur führen,
wenn die Antwort nicht „wir nutzen auch Discord" lautet.

---

# Teil 1 — Dein lokaler Agent (Woche 1)

Alles hier läuft mit Claude Code auf deiner Maschine. Arbeite die Blöcke in
dieser Reihenfolge ab; jeder endet mit etwas Nachprüfbarem.

## 1.1 Arbeitsumgebung

```bash
mkdir ~/freedomstack && cd ~/freedomstack
tar xzf ~/Downloads/freedomstack-komplett.tar.gz
npm install --workspaces --include-workspace-root

# Muss alles grün sein, bevor du irgendetwas änderst
cd packages/protocol && npm test && cd ../..
cd packages/node && npm test && cd ../..
cd packages/app && npm test && cd ../..
python3 scripts/check-wiring.py
python3 scripts/check-website.py
```

**Wenn hier etwas rot ist, nicht weitermachen.** Das wäre ein Umgebungsproblem,
und es später zu finden ist ungleich teurer.

## 1.2 Werkzeuge installieren

```bash
# Rust und Solana
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"

# Anchor über den Versionsmanager
cargo install --git https://github.com/coral-xyz/anchor avm --force
avm install latest && avm use latest

anchor --version && solana --version
```

## 1.3 Der Auftrag an den Agenten

Gib Claude Code genau das — nicht mehr auf einmal:

> Im Verzeichnis `contracts/solana-htlc` liegt ein Anchor-Programm. Es wurde
> geändert (`[u8; 32]` statt `Vec<u8>` für das Preimage, `close = initiator`),
> aber nie kompiliert.
>
> Aufgabe:
> 1. `anchor build` zum Laufen bringen. Fehler beheben, nichts an der Logik
>    ändern.
> 2. Die Tests in `tests/` gegen einen lokalen Validator laufen lassen.
> 3. Berichte, welche Program-ID beim Build herauskommt.
>
> Ändere NICHTS an den Zeitschlossregeln oder an der Preimage-Kodierung ohne
> Rückfrage. Diese Teile haben Tests im Protokollpaket, die dazu passen müssen.

Danach, als getrennter Auftrag:

> Deploye auf Devnet und prüfe drei Dinge einzeln:
> 1. Sperren funktioniert
> 2. Einlösen mit korrektem Preimage funktioniert
> 3. **Die Miete fließt beim Einlösen an den Initiator zurück** — Kontostand
>    vorher und nachher vergleichen und die Differenz nennen
>
> Punkt 3 ist der eigentliche Test: Wenn `close = initiator` nicht wirkt,
> versickert bei jedem Swap Geld.

## 1.4 Die Program-ID an drei Stellen

```bash
grep -rn "HTLC_PROGRAM_ID\|declare_id" \
  packages/app/src/sol-htlc.ts \
  packages/protocol/src/solana-adapter.ts \
  contracts/solana-htlc/programs/solana-htlc/src/lib.rs
```

Alle drei müssen dieselbe ID tragen. Danach nochmal alle Tests.

> ⚠ **Programm und Client müssen zusammen raus.** Borsh kodiert ein festes
> Array ohne Längenpräfix. Altes Programm plus neuer Client ergibt abgelehnte
> Transaktionen ohne verwertbare Fehlermeldung — du suchst dann tagelang an der
> falschen Stelle.

## 1.5 Lightning im Testnet

Am einfachsten mit **Polar** (https://lightningpolar.com) — grafisch, in
Minuten aufgesetzt.

```bash
export LND_REST_URL="https://127.0.0.1:8080"
export LND_MACAROON_HEX="$(xxd -p -c 1000 ~/.polar/.../admin.macaroon)"
cd packages/protocol && LIVE=1 npm test
```

Prüfe drei Pfade einzeln: Hold-Invoice erstellen, mit Preimage abrechnen,
abbrechen und Rückfluss sehen.

## 1.6 Der erste vollständige Job

```bash
NODE_LUD16=du@wallet.cash REGION=eu docker compose up -d
docker compose logs -f
```

Im Log muss stehen:
```
[publish] N Mechanismus/Mechanismen aktiv
```
Steht dort etwas unter „inaktiv", ist das in Ordnung — aber lies es.

Dann: App öffnen, Wallet verbinden, eine Frage stellen, bezahlen.
**„Diese Zahlung prüfen" drücken.** Alle Posten müssen „belegt" zeigen.

**Meilenstein 1 ✅** — wenn ein Fremder das kann.

---

# Teil 2 — Dezentral veröffentlichen (Woche 2–3)

Die App ist **eine HTML-Datei**. Das ist der ganze Trick: Sie lässt sich
überallhin legen, und jede Kopie ist vollständig.

## 2.1 Schlüssel und Vertrauen

```bash
# Auf einer Maschine ohne Netz, wenn möglich
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Auf Papier und auf einen Stick. **Nicht** in einen Passwortmanager mit Cloud.

Pubkey daraus in `packages/app/src/shell/app.ts` → `TRUSTED_SIGNERS`. Solange
die Liste leer ist, prüft die App gegen niemanden und sagt das auch.

## 2.2 Website veröffentlichen

Nicht nur die App hochladen — die ganze Website:

```bash
scripts/build-site.sh site
```

Das Skript baut die App frisch, legt Prüfsumme und `.nojekyll` dazu, setzt
lesbare Dateirechte und lässt interne Dateien draußen (`DEPLOY.md` enthält
einen lokalen Pfad). Danach den Inhalt von `site/` ins Pages-Repository.

Ergebnis: Startseite unter `/`, App unter `/freedom.html`.

Besser, sobald das Hauptrepository auf GitHub liegt: `.github/workflows/pages.yml`
erledigt das bei jedem Push automatisch und veröffentlicht nur bei grünen
Tests. Dafür Repository → Settings → Pages → Source auf „GitHub Actions"
stellen; das zweite Repository entfällt damit.

## 2.2 Sechs Orte

| Ort | Adresse | Wozu |
|---|---|---|
| Eigene Domain | `freedomstack.io` oder ähnlich | Der offizielle Weg |
| GitHub Pages | `<user>.github.io/freedom` | Kostenlos, hohe Verfügbarkeit |
| Codeberg Pages | `codeberg.org` → Pages | Europäisch, nicht US-abhängig |
| IPFS | über `web3.storage` oder `pinata.cloud` | Inhaltsadressiert |
| Arweave | über `ardrive.io` | Dauerhaft, einmal bezahlt |
| Torrent | Magnet-Link | Braucht keinen Anbieter |

Der Sinn ist nicht Redundanz um ihrer selbst willen: **Jeder einzelne Ort kann
weggenommen werden, alle zusammen nicht.**

## 2.3 Release veröffentlichen

```bash
cd packages/app && node build.mjs
sha256sum dist/freedom.html

RELEASE_SECRET_KEY=<hex> \
RELEASE_SOURCES="https://freedomstack.io/freedom.html,ipfs://<cid>,magnet:?xt=..." \
  node scripts/publish-release.mjs 0.1.0
```

**Die Prüfsumme an drei Orte, die nicht zusammen fallen können:**
1. Auf eure Website
2. Ins Release-Manifest auf den Relays (macht das Skript)
3. In einen Nostr-Beitrag von eurem Account

Punkt 2 ist der wichtige: Das Manifest liegt **auf den Relays, nicht neben der
Datei**. Wer die Datei austauschen könnte, könnte auch eine danebenliegende
Prüfsumme austauschen.

Danach in der App „eigene Echtheit prüfen" — muss „geprüft" sagen.

## 2.4 Native Apps (Woche 4–6, parallel)

Für Push braucht ihr native Hüllen. Tauri ist der kleinste Weg:

```bash
npm create tauri-app@latest
```

| Plattform | Weg | Push |
|---|---|---|
| Android | Tauri → APK, direkt + F-Droid | Vordergrunddienst, eigene Verbindung |
| Windows/macOS/Linux | Tauri | Dauerverbindung |
| iOS | Tauri iOS | Inhaltsleerer Weckruf über APNs |

**Android nicht nur im Play Store.** Direkte APK auf eurer Seite und
**F-Droid** (https://f-droid.org) — dort ist eure Zielgruppe, und niemand kann
euch entfernen.

---

# Teil 3 — Konten anlegen (Woche 3)

Genau diese, in dieser Reihenfolge. Mehr ist Ballast.

## Zuerst: Nostr

Euer eigenes Netz. Wäre absurd, es nicht zu benutzen.

- Profil in eurer eigenen App anlegen
- NIP-05-Verifikation über eure Domain (`_@freedomstack.io`)
- Auf **primal.net**, **damus.io**, **iris.to** sichtbar

## X/Twitter

Unangenehm, aber die Bitcoin- und Nostr-Entwicklerszene ist dort. Du brauchst
es zum Zuhören mehr als zum Senden.

## GitHub

Ist selbst ein soziales Netz für Entwickler. Profil ausfüllen, Repository mit
gutem README, Topics setzen: `nostr`, `lightning`, `bitcoin`, `p2p`,
`self-hosted`, `local-llm`.

## Stacker News — **unterschätzt, sehr wirksam**

https://stacker.news — aktive Bitcoin- und Lightning-Community, die Beiträge
in Sats belohnt. Die Zielgruppe stimmt besser als überall sonst: Leute, die
Lightning tatsächlich benutzen und Software beurteilen können.

## YouTube

Nur für das eine Video: Flugmodus an, Zahlung kommt trotzdem an. Dafür reicht
ein Konto ohne weitere Pflege.

## Was du **nicht** brauchst

Instagram, TikTok, LinkedIn, Facebook. Eure Nutzer sind dort nicht, und jedes
Konto kostet Zeit, die in Woche 5 fehlt.

---

# Teil 4 — Die ersten Nutzer (Woche 4–10)

**Reihenfolge ist alles: erst Provider, dann Nutzer.** Ein Kunde ohne Provider
bekommt nichts; ein Provider ohne Kunden geht wieder. Aber ein Provider bleibt
länger geduldig.

## 4.1 Die ersten fünf Provider — persönlich

Nicht posten. **Fragen.** Fünf Leute, die eine GPU haben und die du kennst.

Bei jedem dabeisitzen (Videocall, zwanzig Minuten) und **mitschreiben, wo es
hakt**. Das ist die wertvollste Information dieser ganzen Phase — wertvoller
als hundert Anmeldungen.

Messen: **Wie lange vom Entschluss bis zum ersten verdienten Sat?** Über dreißig
Minuten ist zu lang.

## 4.2 r/LocalLLaMA — eure wichtigste Quelle

https://reddit.com/r/LocalLLaMA

Genau eure Provider: Menschen mit GPUs, die lokale Modelle betreiben und sich
fragen, ob sich das je rechnet.

**Was funktioniert** — ein technischer Beitrag ohne Verkauf:

> *„Ich habe ein Protokoll gebaut, über das man ungenutzte GPU-Zeit gegen
> Lightning-Sats vermietet. Kein Konto, keine Firma dazwischen, Bezahlung pro
> Anfrage. Hier ist, wie die Abrechnung funktioniert und was ich dabei über
> Hold-Invoices gelernt habe — [technische Details]. Läuft mit Ollama, ein
> Befehl."*

**Was nicht funktioniert:** „Verdiene Geld mit deiner GPU!" Das riecht nach
Betrug und wird entsprechend behandelt.

## 4.3 Weitere Orte, nach Eignung

| Ort | Adresse | Zielgruppe |
|---|---|---|
| r/selfhosted | reddit.com/r/selfhosted | Leute, die Knoten betreiben |
| Stacker News | stacker.news | Lightning-Nutzer mit Urteilsvermögen |
| r/nostr | reddit.com/r/nostr | Die Kommunikationsseite |
| Nostr selbst | über eure App | Wo eure Nutzer schon sind |
| r/Bitcoin | reddit.com/r/Bitcoin | Groß, aber streng — nur mit Substanz |
| Lobsters | lobste.rs | Technisch anspruchsvoll, braucht Einladung |

**Für jeden Ort ein anderer Beitrag.** Derselbe Text überall gepostet wird als
Spam erkannt und schadet mehr, als er bringt.

## 4.4 Was du in Phase 1 **nicht** tust

- ❌ **Hacker News.** Einmal pro Projekt wirksam. Verbrennst du das mit fünf
      Providern, ist es weg.
- ❌ **Product Hunt.** Falsches Publikum.
- ❌ Bezahlte Werbung. Du weißt noch nicht, wer deine Nutzer sind.
- ❌ „Das dezentrale ChatGPT." Seid ihr nicht und wollt ihr nicht sein.

## 4.5 Die Worte

**Nicht sagen:** unzensierbar, für immer, anonym, revolutionär, 100 %.

Jedes davon ist entweder falsch oder nicht beweisbar — und ihr habt ein Modul
gebaut, das genau nachrechnet, warum „anonym" nicht stimmt.

**Sagen:**

> „Kommunikation und Zahlungen, die weiterlaufen, wenn das Netz ausfällt."
>
> „KI-Rechenzeit gegen Sats. Kein Konto, kein Abo, kein Betreiber."
>
> „Läuft als eine einzige HTML-Datei. Du kannst sie weitergeben."

Konkret, nachprüfbar, ohne Versprechen, das ihr nicht halten könnt.

---

# Teil 5 — Die Geschichte (Woche 10–12)

Erst wenn Meilenstein 3 und 4 stehen.

1. Zwei LoRa-Geräte kaufen — **Meshtastic-kompatibel**, etwa 40 € das Stück
   (https://meshtastic.org/docs/hardware/devices)
2. Nachrichtenversand über Funk testen
3. **Eine Solana-Transaktion über Funk einreichen** — das ist das Bild
4. Video: Flugmodus an, Zahlung kommt an, ein Schnitt, keine Musik
5. Dann erst breit kommunizieren — **jetzt** ist Hacker News dran

---

# Teil 6 — Mitentwickler (ab Woche 12)

## 6.1 Vorbereiten

- `CONTRIBUTING.md`: Was ihr annehmt, was nicht, wie ihr entscheidet
- **Richtung schriftlich**, drei Absätze. Ohne das diskutiert ihr jede Woche neu
- Anteil der App-Gebühr für Beitragsrunden festlegen (10–20 %) und **nennen**
- Issues mit `good first issue` markieren — das ist der Weg, über den
  Erstbeiträge fast ausschließlich kommen

## 6.2 Mit Kopfgeldern anfangen

Ein Kopfgeld ist ein **Vertrag**, offene Mitarbeit eine **Beziehung** — und die
kostet Zeit, die du in Phase 1 bis 5 nicht hast.

- Drei bis fünf klar beschriebene Aufgaben
- Beträge, die ernst gemeint sind. 50 € für zwei Tage ist eine Beleidigung
- **Sofort auszahlen.** Die erste Auszahlung entscheidet, ob eine zweite Person
  mitmacht

---

# Der Zeitplan

| Woche | Was | Fertig, wenn |
|---|---|---|
| 1 | Devnet, LND, erster Job | Ein Fremder kann bezahlen und prüfen |
| 2–3 | Mainnet, Release, sechs Orte | Jemand lädt, prüft Echtheit, bezahlt |
| 3 | Konten, Repository öffentlich | Auffindbar |
| 4–6 | Fünf Provider persönlich, native Apps | Ein Job läuft ohne dich |
| 6–10 | r/LocalLLaMA, Stacker News, Nostr | Zehn fremde Nutzer kommen wieder |
| 10–12 | Mesh-Video, breite Kommunikation | Das Video existiert |
| 12+ | Kopfgelder | Ein Fremder hat einen Fehler behoben |

---

# Die drei Fehler, die das am ehesten scheitern lassen

**1. Zu früh Reichweite.** Ein Ansturm auf ein Netz mit fünf Providern erzeugt
hunderte schlechte erste Eindrücke. Die bekommst du nicht zurück.

**2. Der Schlüsselverlust beim ersten Nutzer.** Jemand löscht seine
Browserdaten, verliert alles und schreibt darüber. Der erzwungene
Backup-Dialog und die Zustandssicherung sind genau dagegen gebaut — nimm sie
nicht raus, auch wenn sie beim Testen nerven.

**3. Alles gleichzeitig verbessern.** Solange du allein bist, darf immer nur
eines aktiv besser werden. Die anderen bleiben in ihrer einfachen Form — aber
sie müssen **funktionieren**. Eine Funktion, die zu 40 % läuft, ist schlimmer
als eine, die es noch nicht gibt.

---

# Wöchentlich, ab jetzt

- Dashboard ansehen: Provider, Abdeckungslücken, gefährdete Modelle
- Auf **jede** Rückmeldung persönlich antworten — in dieser Phase ist das deine
  wichtigste Tätigkeit
- Eine Sache aus den Rückmeldungen beheben. Nicht fünf.

Monatlich: Fee-Beweise stichprobenartig prüfen. Quartalsweise: Beitragsrunde.
Bei jedem Release: Manifest veröffentlichen, Prüfsumme an drei Orte.
