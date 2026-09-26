# MLS für FreedomStack – Entscheidungsvorlage (Schritt 2.2a)

Stand 25.09.2026. Die Entscheidung trifft der MENSCH. Die Spike-Quellen liegen unter
[`docs/mls-spike/`](mls-spike/README.md); nichts davon ist in die App gebündelt.

## Die Frage

Direktnachrichten und Räume sollen auf MLS nach Marmot umziehen (2.2b, 2.3). Dafür
kommen zwei Wege in Frage:

- **MDK** (Rust, die Marmot-Implementierung) per WASM im Browser.
- **ts-mls** (TypeScript, RFC 9420) mit einer selbst gebauten Marmot-Schicht darauf.

## Was sich seit der Karte geändert hat

- **Marmot ist neu gefasst.** Das Repo `marmot-protocol/marmot` trägt eine neue, als
  „adopted“ markierte Spezifikation. Die MIPs gelten als veraltet (`mip-coverage.md`).
- **Neue Grundlage für den Gruppenzustand.** Er liegt jetzt in
  MLS-`app_data_dictionary`-Komponenten aus dem MLS-Extensions-Draft, etwa Name,
  Admins, Nostr-Routing und Ablauf.
- **KeyPackages ändern sich.** Sie brauchen `last_resort_key_package` und
  `app_data_update` in den Fähigkeiten.
- **Pflicht-Ciphersuite** ist `0x0001` (X25519, AES-128-GCM, SHA-256, Ed25519).
- **MDK** (0.10.4) setzt das um, auf einem OpenMLS-Fork, der auf einen Commit
  festgenagelt ist. Das Repo führt die White-Noise-Integration, UniFFI-Bindings für
  App-Laufzeiten und Tamarin-Modelle.

## Was die Spikes gemessen haben

| Kriterium | MDK / OpenMLS per WASM | ts-mls |
|---|---|---|
| Läuft: 2 Mitglieder, Nachricht, Entfernen | ja – OpenMLS-Kern (MDK-Fork) als WASM in Node und Chromium: Bob liest „Hallo Bob“; nach dem Entfernen liest er nichts mehr | ja – in Node: Bob liest die Nachricht; nach dem Entfernen scheitert das Entschlüsseln |
| Größe im Browser | OpenMLS-Kern allein: **1,43 MB WASM, 456 KB gzip** (+11 KB JS). Die MDK-Engine (57.000 Zeilen Rust) kommt noch dazu. Eingebettet in die Ein-Datei-App als Base64 +33 %: grob **+2 MB auf heute 2,1 MB** | **214 KB, 67 KB gzip** im Bündel; davon ~90 KB `@noble`, teils schon in der App |
| CSP | braucht **`'wasm-unsafe-eval'`** – ohne verweigert Chromium das Modul (`CompileError`, im Spike belegt) | keine Änderung (JS und WebCrypto) |
| Marmot-Konformität | MDK **ist** die Marmot-Implementierung: `app_data_dictionary`, `app_data_update`, KeyPackage-Regeln, Account-Identity-Proof, Nostr-Transport (Kind 30443, 444, 445) | kennt den Extensions-Draft nicht. Erweiterungen und Proposals gehen nur als Rohbytes; die ganze Marmot-Schicht müssten wir selbst schreiben und gegen MDK testen |
| Interop mit White Noise | wahrscheinlich, weil gleicher Code – der Test bleibt MENSCH-Aufgabe | offen; hängt an unserer Nachbildung der Marmot-Schicht |
| Audit | keinen Audit-Bericht gefunden; Tamarin-Modelle im MDK-Repo; OpenMLS ist verbreitet, MDK nutzt aber einen Fork | laut README **keine formale Sicherheitsprüfung** |
| Browser-Speicher | **fehlt.** MDK hat nur SQLite/SQLCipher (nicht für den Browser). Nötig ist ein eigener `StorageProvider`: 16 Teil-Traits, rund 140 Methoden, auf dem Tresor bzw. IndexedDB | Zustand ist ein JS-Objekt; Speichern im Tresor ist einfach |
| Build | Rust 1.97.1 und clang mit wasm32-Backend in CI und `pages.yml`; die MDK-Kernbausteine bauen in 81 s, der Spike in 36 s | nichts Neues außer der npm-Abhängigkeit |
| Neue Abhängigkeiten | MDK-Crates (Git), OpenMLS-Fork, wasm-bindgen | `ts-mls` (MIT, 1.6.4), `@hpke/core`, `@noble/curves` und `@noble/ciphers` (die letzten beiden schon in der App) |
| Aufwand für 2.2b | groß: API-Schicht mit wasm-bindgen, Browser-Speicher, Nostr-Anbindung, CSP, CI-Toolchain – dafür die Marmot-Logik fertig | groß anders herum: Marmot-Schicht selbst (Komponenten, Commit-Regeln, KeyPackages, Konvergenz), dauerhaft nachzuziehen, wenn Marmot sich bewegt |

## Empfehlung

**MDK per WASM.** Das Ziel von 2.2b ist Marmot mit Interop zu White Noise. Nur MDK
setzt die neue Fassung heute vollständig um, und sie bewegt sich noch. Eine eigene
Nachbildung auf ts-mls hieße, sicherheitskritische Gruppenlogik selbst zu schreiben
und ungeprüft hinter der Referenz herzulaufen. Das widerspricht „jeder Schritt
vollständig fertig“.

Der Preis ist hoch und gehört in die Entscheidung:

1. **CSP:** `'wasm-unsafe-eval'` in `build.mjs`. Laut CLAUDE.md nur nach Rückfrage.
2. **Größe:** die App wächst grob auf das Doppelte (~4 MB).
   - Alternative: die WASM-Datei neben der App ausliefern und erst beim ersten
     MLS-Chat laden. Das bricht aber das Ein-Datei-Prinzip samt Prüfsumme.
3. **Build:** Rust-Toolchain und clang in CI und `pages.yml`.
4. **2.2b wird groß** und braucht mehrere Teile: Browser-Speicher auf dem Tresor,
   API-Schicht, Anbindung, dann erst die Oberfläche.

**Wenn einer dieser Punkte nicht geht:**
- ts-mls nur für eine eigene, **nicht** Marmot-kompatible Gruppenverschlüsselung.
- Damit entfiele die Interop mit White Noise, und die Karte 2.2b müsste man anpassen.
- Eine Zwischenlösung, die Marmot „ungefähr“ spricht, empfehle ich nicht.

## MENSCH: bitte entscheiden

> **Entschieden 26.09.2026: A.** Ob die WASM-Datei eingebettet oder nachgeladen
> wird, schlägt der Agent zu Beginn von 2.2b mit Messwerten vor.

- [x] **A – MDK per WASM** (empfohlen), mit
  - CSP `'wasm-unsafe-eval'`,
  - Rust in CI und `pages.yml`,
  - entweder WASM eingebettet (~4 MB, eine Datei) **oder** nachgeladen (zweite Datei).
- [ ] **B – ts-mls** mit eigener Marmot-Schicht (Interop unsicher, ohne Audit).
- [ ] **C – ts-mls ohne Marmot**: eigene Gruppenverschlüsselung, kein White Noise; Karte 2.2b anpassen.
