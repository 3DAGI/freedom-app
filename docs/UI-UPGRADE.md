# UI-Upgrade — Arbeitsdokument

**Start:** 2026-08-24 · **Basis-Commit:** `6ca0018` (hedged requests)
**Backup:** Git-Tag `ui-backup-20260824`, Branch `backup/pre-ui-upgrade`,
File-Archiv `~/freedom-backup-20260824.tar.gz` (1 GB, inkl. node_modules)

---

## Rollback (falls etwas schiefläuft)

```bash
# Alles zurück auf den Backup-Stand:
git checkout backup/pre-ui-upgrade -- packages/app/src packages/website
npm run build --workspaces && cp packages/app/dist/freedom.html packages/website/

# Oder komplett:
git reset --hard ui-backup-20260824
```

Die Website wird nach JEDER Stufe gebaut und deployed (`gated-server :3600`
liest bei jedem Request von der Disk — kein Neustart nötig).

---

## Ziel-Design (unverändert: Terminal-Ästhetik)

| Token | Wert | Nutzung |
|---|---|---|
| `--bg` | #050505 | Hintergrund |
| `--card` | #0A0A0A | Cards |
| `--border` | #1E1E1E | Rahmen |
| `--accent` | #7BC80A | Primär/Grün |
| `--text` | #E0E0E0 / #A1A1AA | Text/Muted |

Neu dazu:
- `--font-body`: Inter/system-ui (Fließtext), Mono bleibt Headlines/Labels/Zahlen/Code
- `--container-max`: 1200px, zentriert
- Icon-Set: SVG stroke 16px (Lucide-Style inline), ersetzt Emojis in Nav/Cards

---

## STUFE A — Bugs + Layout-Fundament

### A1. Referral-Bug fixen ✅ Kriterien
- [ ] `referralSub` zeigt echten i18n-Text statt „referralSub"
- [ ] Referral-URL = `window.location.origin + path + ?ref=<pubkey>`
      (kein localhost auf Produktion; Code sichtbar im Input)
- [ ] Copy-Button kopiert die vollständige URL

### A2. Leaderboard robust
- [ ] Tabelle: Rang | Alias(pkShort) | Jobs | Sats | Tier-Badge | Modelle | Tools
- [ ] Skeleton-Zeilen während des Ladens
- [ ] Timeout 10s → Error-State mit Retry-Button
- [ ] Leer-State mit CTA („Werde der erste Provider")

### A3. Trust-Bar sichtbar
- [ ] Track immer sichtbar (dunkler Balken)
- [ ] Marker bei 10 XP (classic) und 50 XP (pro) mit Labels
- [ ] Füllung grün; aktueller Tier-Badge daneben

### A4. Container + Navigation
- [ ] `.tab-page { max-width: 1200px; margin-inline: auto; }`
- [ ] Desktop ≥1024px: linke Sidebar-Nav (vertikal, Icons+Labels,
      aktiver Tab = grüner Left-Border + leichter BG) statt Bottom-Bar
- [ ] Mobile <1024px: Bottom-Tab-Bar bleibt (Aktiv-State dezenter:
      grüner Text + Icon, kein full-width Block)

### A5. Sprachvereinheitlichung
- [ ] Entscheidung: **Deutsch als Default** (Zielgruppe), EN via Sprachschalter
- [ ] Alle hartcodierten EN-Strings ins i18n (REFRESH→Aktualisieren etc.)

## STUFE B — Design-Polish
- [ ] SVG-Icons inline (nav, cards, buttons) — Emojis raus
- [ ] Buttons: Primary gefüllt/grün · Ghost outlined; width:auto;
      Action-Rows rechtsbündig
- [ ] Body-Font Inter für p/li/span; Mono für h*, label, code, Zahlen
- [ ] Hover: border-color accent + subtle glow (box-shadow 0 0 12px rgba(123,200,10,.15))
- [ ] Empty-States: Icon + Titel + Beschreibung + CTA-Button
- [ ] Landing: Hero-Glow (radial-gradient), Feature-Grid 4 Karten,
      How-it-works 3 Schritte, Trust-Badges, Footer, Terminal-Demo später (D19 optional)

## STUFE C — Agent-UX (Herzstück)
- [ ] C1 Fortschritts-Chips: Status-Zeile über Antwort-Bubble:
      `[🔍 scan] → [✓ provider] → [⚙️ running] → [⚡ paid]`;
      Zustände aus bestehenden Events ableiten (feedback/result/paid)
- [ ] C2 Modell-Karten: beim Klick auf Modell-Dropdown → Popover mit Karten
      (Name kurz, „~2s" Benchmark statisch je Modell-Klasse, Preis-Spanne aus
      Caps, Tool-Icons); Auswahl schreibt zurück ins Dropdown (State bleibt)
- [ ] C3 Inline-Media: image/video/audio Results direkt in Bubble rendern
      (bereits teils vorhanden — konsolidieren + Progressbar beim Blob-Download)
- [ ] C4 Stop-Button: send-btn wird während laufendem Job zum Stop → bricht
      waitForAnswer ab (AbortController), zeigt „abgebrochen"
- [ ] C5 Session-Sidebar: Konversationen in localStorage (id, titel, ts);
      Liste über dem Thread; Neu/Laden/Umbenennen/Löschen
- [ ] C6 Code-Blöcke: ```-Blöcke in Antworten → <pre><code> + Copy-Button;
      minimales Highlighting (keywords, strings) ohne Library
- [ ] C7 Kosten-Schätzung live: bid-input oninput → geschätzte Tokens
      (prompt.length/4) × rate → „~X sats" neben fee-preview

## STUFE D — Landing
- [ ] D19 Terminal-Demo im Hero (getippte Animation: prompt → antwort → ⚡ paid)
- [ ] D20 Feature-Grid: 💬 Chat (NIP-44) · ⚡ Pay-per-Job · 🖥️ Earn (Provider) · 🔀 Atomic Swaps
- [ ] D21 How-it-works: 01 Connect → 02 Ask → 03 Pay (Mono-Nummerierung)
- [ ] D22 Trust-Badges: Lightning · Nostr · Solana · Non-Custodial · Open Source
- [ ] D23 Footer: Protokoll-Spec · GitHub · Nostr-Community · Impressum-Platzhalter

---

## Verifizierung nach jeder Stufe

```bash
npm run build --workspaces          # tsc + bundle müssen sauber sein
cp packages/app/dist/freedom.html packages/website/freedom.html
# Browser-Check (Playwright-Smoke): alle Tabs laden, 0 console-errors,
# geänderte Elemente sichtbar (Screenshot-Vergleich)
```

Mobile-Check (Phase 1.4) NACH Stufe B/C auf 390×844 (Seeker-Viewport).

## Bekannte Fallstricke

1. **index.html ist die Quelle** — Änderungen an website/freedom.html gehen beim
   nächsten Build verloren (das war der chat-zap/leaderboard-Bug!)
2. **turbo-sdk/arweave-mirror ist external** im Bundle — nicht wieder einbauen
3. **wasm-reed-solomon-erasure alias** auf reed-solomon.ts Shim — nicht entfernen
   (Node/Browser-Kompatibilität der Erasure-Shards!)
4. **i18n**: neue Strings in beide Sprachdateien, sonst erscheint der Key roh
5. **data-i18n Attribute** nicht löschen beim Umstylen — applyI18n() braucht sie
