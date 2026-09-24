# Phase 0 – Sicherheit sofort (Rest)

**Erledigt:** 0.1 XSS über Provider-Daten, 0.2 Einlösefrist im Programmcode,
0.3 CSP, 0.4 ehrliche Texte, 0.5 Prüfsumme im Build (live seit 24.09.2026);
0.C Einlösen mit Sicherheitsabstand im Client (live). Offen sind diese Schritte:

---

## 0.B innerHTML-Prüfung

1. `python3 scripts/check_innerhtml.py packages/app/src --markdown > docs/INNERHTML-AUDIT.md`
   (Stand 24.09.: rund 60 Fundstellen).
2. Jede Fundstelle bewerten. Kommt der Wert aus Relays, von Providern, aus
   Profilen, Räumen, Dateinamen oder URLs: `escapeHtml()` (Text), `ganzeZahl()`
   (Zahl) oder `textContent`. Eigene Konstanten und Übersetzungen sind in
   Ordnung – in `scripts/innerhtml-ausnahmen.txt` als `datei|ausdruck|Begründung`.
3. In `.github/workflows/ci.yml` ergänzen:
   `python3 scripts/check_innerhtml.py packages/app/src --ausnahmen scripts/innerhtml-ausnahmen.txt --streng`

**Abnahme:** Audit vollständig, 0 unbewertete Fundstellen, CI-Schritt aktiv.

## 0.D Signierte Releases – MENSCH nötig

- **MENSCH:** Signierschlüssel offline erzeugen, nur den öffentlichen Schlüssel (hex) weitergeben.
- **Agent:** Pubkey in `TRUSTED_SIGNERS` (`packages/app/src/shell/app.ts`);
  `scripts/publish-release.mjs` prüfen (Schlüssel nur aus der Umgebung, nie
  geloggt); Echtheitsprüfung mit einem eigens erzeugten TEST-Schlüssel testen.
- **Abnahme:** „eigene Echtheit prüfen“ meldet in der veröffentlichten App „geprüft“.

## 0.E Wallet-Erweiterungen unter der CSP – MENSCH

Die App lokal öffnen (`cd packages/app/dist && python3 -m http.server 3500`),
Phantom, Solflare und Alby verbinden, in der Browser-Konsole nach „Content
Security Policy“ suchen. Blockiert etwas: gezielte CSP-Ergänzung, nie
`'unsafe-inline'` für Skripte.

## 0.F Texte angleichen

Website und App-Texte an den Code anpassen, unter anderem: Fußzeile „Kein
Unternehmen“ (MENSCH: Firmenname, Impressum); „drei Einnahmen“; „Reputation ist
öffentlich nachprüfbar“; Mirrors und 1-Klick-Launcher als „geplant“; interne
Notiz „ARM64-GX10“ entfernen; Code-Links aufs Repository; Whitepaper „Kern in
drei Sätzen“ (es sind sechs); „Kein Topf, kein Sammeln“ und „keinen
privilegierten Empfänger“ bis 5.1 ehrlich beschreiben; „Das Solana-Programm ist
unveränderlich“ → „wird … unveränderlich gemacht“; FAQ „Dazu kommen 2,5 % …“ →
„Davon gehen …“; KI über Funk „Stunden“ korrigieren; Solana per Datei braucht
eine Durable Nonce; Werben-Texte (0,375 % mit zweiter Ebene; Stufen höchstens
+14 % bzw. +60 %).

**Abnahme:** `check-website.py` grün; jede geänderte Aussage im Bericht.

## 0.G Solana-Programm-ID abgleichen – MENSCH-Entscheidung

Im Code steht überall `B6W19UfZ1iYDoJYaSesZDiP96TpeZACQu3Xs6VSJ4kJk`, laut
`DEPLOY.md` wurde nach `3UmRRrMySUbPwRfV4x7c1A6ah94K7SQt3dDH2uqqdeZ8` deployt.
Anchor lehnt jeden Aufruf ab, wenn `declare_id!` nicht zur Adresse passt.

```bash
solana program show B6W19UfZ1iYDoJYaSesZDiP96TpeZACQu3Xs6VSJ4kJk --url devnet
solana program show 3UmRRrMySUbPwRfV4x7c1A6ah94K7SQt3dDH2uqqdeZ8 --url devnet
```

- **A)** Upgrade-Recht von `B6W19U…` liegt bei euch: dorthin deployen, `3UmRR…` schließen.
- **B)** Sonst auf `3UmRR…` umstellen: `declare_id!`, `Anchor.toml`,
  `HTLC_PROGRAM_ID` (`packages/app/src/sol-htlc.ts`), Vorgabe in
  `packages/protocol/src/solana-adapter.ts`; neu bauen, Upgrade, Devnet-Tests.

Hinweis: `anchor build` mit Anchor 0.30.1 scheitert oft an `proc-macro2`;
häufige Lösung `cargo update -p proc-macro2 --precise 1.0.94` (prüfen).

## 0.H Instabilen Test reparieren

`packages/node/test/sol-deposit-job.test.ts`, Test „Provider verarbeitet Job
gegen Deposit, bietet SOL-Zahlung an“, scheitert in etwa 1 von 8 Läufen (auch
ohne Änderungen). Ursache finden (vermutlich Zeit- oder Reihenfolge-Abhängigkeit
zwischen Deposit- und Job-Event), reparieren, dann 20 Läufe am Stück grün:
`for i in $(seq 20); do node --import tsx --test test/sol-deposit-job.test.ts | grep "^# fail"; done`

## 0.I Veröffentlichung über GitHub Actions – MENSCH

Siehe `START-HIER.md`, Weg A: Pages-Quelle „GitHub Actions“, danach
veröffentlicht `pages.yml` bei jedem Merge nach `main`. Der Agent prüft danach
live: Prüfsumme der Datei = `freedom.html.sha256` = Wert auf der Startseite.

## 0.J Event-Felder streng prüfen – Befund aus 0.B, MENSCH-Freigabe

`verifyEvent()` (`packages/protocol/src/event.ts`) dekodiert `pubkey`, `id` und
`sig` mit `fromHex()` = `Buffer.from(h, "hex")`. Das bricht beim ersten
ungültigen Zeichen still ab. Ein Event mit `pubkey` = 64 gültige Hex-Zeichen
plus angehängtem Text (z. B. HTML) besteht deshalb die Prüfung: Die Signatur
wird gegen den echten Schlüssel geprüft, der Text läuft mit. Nachgewiesen am
24.09. mit einem Wegwerf-Skript.

- **Vorgehen:** Vor der Signaturprüfung verlangen: `pubkey` und `id` genau
  `/^[0-9a-f]{64}$/`, `sig` genau `/^[0-9a-f]{128}$/` (so schreibt NIP-01 es
  vor), `created_at` ganze Zahl, `kind` ganze Zahl, `tags` Array aus
  String-Arrays, `content` String. Negativtests für jeden Fall; prüfen, ob
  `fromHex()` auch anderswo Fremddaten dekodiert.
- **Warum MENSCH:** Die Änderung liegt im Signaturpfad (STOPP-Regel in `CLAUDE.md`).
- **Abnahme:** Das Event aus dem Nachweis wird abgelehnt; alle Suiten grün.
