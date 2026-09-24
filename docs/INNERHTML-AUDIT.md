# innerHTML-Audit

Erzeugt mit `python3 scripts/check_innerhtml.py packages/app/src --ausnahmen scripts/innerhtml-ausnahmen.txt --markdown` – nicht von Hand bearbeiten.

Geprüft wird jede Zuweisung an `innerHTML`/`outerHTML` und jedes `insertAdjacentHTML` in `.ts`-Dateien: jeder Teil der rechten Seite, der im HTML landen kann. Sicher ohne Eintrag sind Literale, Vergleiche, Negationen und Schutzfunktionen (`escapeHtml`, `ganzeZahl`, `Math.*`, `Number`, `icon`, `t`). Alle übrigen Stellen stehen unten mit Begründung aus `scripts/innerhtml-ausnahmen.txt`; Fremddaten gehören nie dorthin.

Nicht abgedeckt: andere Eingänge wie `href` oder `src`, die per Eigenschaft gesetzt werden – die muss man beim Hinzufügen selbst prüfen.

| Datei | Zeile | Ausdruck | Bewertung |
|---|---|---|---|
| `packages/app/src/offline-queue.ts` | 73 | `pending.length` | Länge eines lokalen Arrays (eigene Offline-Warteschlange) |
| `packages/app/src/shell/app.ts` | 265 | `` woerter.map((w) => `<li>${escapeHtml(w)}</li>`).join("") `` | Callback liefert nur ein Template mit escapeHtml(w) |
| `packages/app/src/shell/app.ts` | 272 | `` positionen.map((p) => `<label class="mono-sm">Nr. ${p + 1} <input data-pos="${p}" class="mono-sm" style="width:110px" au `` | Callback liefert nur ein Template; einzige Werte sind die Positionen p |
| `packages/app/src/shell/app.ts` | 272 | `p` | Zahl: Position aus pickChallengePositions(), lokal erzeugt |
| `packages/app/src/shell/app.ts` | 273 | `p` | Zahl: Position aus pickChallengePositions(), lokal erzeugt |
| `packages/app/src/shell/app.ts` | 425 | `` (Zuweisung) st.map((s) => { const name = escapeHtml(s.label ?? new URL(s.url).hostname); return s.available ? `<span class="ok">${na `` | Callback liefert nur Templates; Name und Fehlertext mit escapeHtml |
| `packages/app/src/shell/app.ts` | 428 | `name` | name = escapeHtml(label oder hostname), eine Zeile darüber |
| `packages/app/src/shell/app.ts` | 428 | `s.lastLatencyMs` | lokal gemessene Latenz in ms (rpc-pool.ts: Date.now() - start) |
| `packages/app/src/shell/app.ts` | 429 | `name` | name = escapeHtml(label oder hostname) |
| `packages/app/src/shell/app.ts` | 468 | `cls` | feste Klassennamen ok/err/warn |
| `packages/app/src/shell/app.ts` | 560 | `(Zuweisung) r.models.slice(0, 20).map((m) => { const cls = m.availability === "gut" ? "ok" : m.availability === "knapp" ? "warn" : "` | Callback liefert nur Templates; Name, Quantisierung, Hinweis mit escapeHtml |
| `packages/app/src/shell/app.ts` | 564 | `cls` | feste Klassennamen ok/warn/err |
| `packages/app/src/shell/app.ts` | 702 | `` (Zuweisung) o.contributors.slice(0, 15).map((c) => `<div class="usage-row"><span>${escapeHtml(pkShort(c.pubkey))}</span>` + `<span>$ `` | Callback: Template mit escapeHtml(pkShort(c.pubkey)); Zahlen siehe folgende Zeilen |
| `packages/app/src/shell/app.ts` | 704 | `c.activeDays` | lokal gezählt in buildRepoOverview() (git-contributors.ts) |
| `packages/app/src/shell/app.ts` | 704 | `c.contributions` | lokal gezählt in buildRepoOverview() (git-contributors.ts: e.c.length) |
| `packages/app/src/shell/app.ts` | 762 | `` (Zuweisung) ids.map((id) => { const kurz = id.slice(0, 2).toUpperCase(); return `<button class="space-pill" data-space="${escapeHtml `` | Callback: Template mit escapeHtml(id) und escapeHtml(kurz); aria-current ist ein Vergleich |
| `packages/app/src/shell/app.ts` | 813 | `` (Zuweisung) st.space.channels.map((c) => { const b = badges.get(c.id); const marke = b?.mentions ? `<span class="mention">${b.mentio `` | Callback: Template mit escapeHtml(c.id) und escapeHtml(c.name); marke/schloss siehe folgende Zeilen |
| `packages/app/src/shell/app.ts` | 818 | `b.mentions` | lokal gezählt in unreadBadges() |
| `packages/app/src/shell/app.ts` | 823 | `schloss` | feste Zeichen: Schloss-Entity oder # |
| `packages/app/src/shell/app.ts` | 823 | `marke` | festes Markup oder Template mit dem lokalen Zähler b.mentions |
| `packages/app/src/shell/app.ts` | 861 | `` (Zuweisung) topLevel.map((m) => { const t = threads.get(m.id); const antworten = t ? `<button class="thread-link" data-root="${escap `` | Callback: Templates mit escapeHtml für IDs, Autor, Zeit und Inhalt |
| `packages/app/src/shell/app.ts` | 865 | `t.replies.length` | Länge eines lokal gebauten Arrays (Threads) |
| `packages/app/src/shell/app.ts` | 866 | `t.participants.length` | Länge eines lokal gebauten Arrays (Threads) |
| `packages/app/src/shell/app.ts` | 877 | `antworten` | Template mit escapeHtml(m.id) und lokalen Zählern |
| `packages/app/src/shell/app.ts` | 877 | `modKnopf` | Template mit escapeHtml(m.id) und escapeHtml(m.authorPubkey) |
| `packages/app/src/shell/app.ts` | 924 | `(Zuweisung) zeilen.join("")` | zeilen enthält nur Templates mit escapeHtml (direkt darüber gebaut) |
| `packages/app/src/shell/app.ts` | 1126 | `farbe` | aus der festen Tabelle ACCENT_HEX nach normalizeStyle() |
| `packages/app/src/shell/app.ts` | 1128 | `avatar` | Template mit escapeHtml(bild) bzw. escapeHtml(Anfangsbuchstabe), direkt darüber gebaut |
| `packages/app/src/shell/app.ts` | 1132 | `farbe` | aus der festen Tabelle ACCENT_HEX nach normalizeStyle() |
| `packages/app/src/shell/app.ts` | 1158 | `` (Zuweisung) werte.map((w) => `<option value="${escapeHtml(w)}"${w === aktiv ? " selected" : ""}>${escapeHtml(w)}</option>`).join("") `` | Callback: Template mit escapeHtml(w); selected ist ein Vergleich |
| `packages/app/src/shell/app.ts` | 1198 | `` (Zuweisung) zeilen.map((z) => `<div>${escapeHtml(z)}</div>`).join("") `` | Callback: Template mit escapeHtml(z) |
| `packages/app/src/shell/app.ts` | 1262 | `` (Zuweisung) alle.map((b) => `<div class="badge-row"> <span class="badge-chip ${escapeHtml(b.source)}">${escapeHtml(b.source)}</span> `` | Callback: Template, alle Werte mit escapeHtml |
| `packages/app/src/shell/app.ts` | 1440 | `` (Zuweisung) d.map((x) => { const cls = x.status === "aktiv" ? "ok" : x.status === "abgelaufen" ? "warn" : "muted"; return `<div clas `` | Callback: Templates mit escapeHtml(label, status, devicePubkey) |
| `packages/app/src/shell/app.ts` | 1443 | `cls` | feste Klassennamen ok/warn/muted |
| `packages/app/src/shell/app.ts` | 1807 | `` (Zuweisung) offlineCapabilities(link).map((f) => `<div class="usage-row"><span>${f.works ? "✓" : "✕"} ${escapeHtml(f.feature)}</span `` | Callback: Template mit escapeHtml; Haken/Kreuz fest |
| `packages/app/src/shell/app.ts` | 1819 | `` (Zuweisung) p.map((m) => `${escapeHtml(m.label)} — ${m.framesLeft} Pakete offen`).join("<br>") `` | Callback: Template mit escapeHtml(m.label) und lokalem Zähler |
| `packages/app/src/shell/app.ts` | 1819 | `m.framesLeft` | lokaler Zähler der eigenen Mesh-Warteschlange |
| `packages/app/src/shell/app.ts` | 1839 | `` (Zuweisung) zusammen.map((z) => `<div class="usage-row"><span>${symbol[z.layer]} ${escapeHtml(z.label)}</span>` + `<span class="${z. `` | Callback: Template mit escapeHtml(z.label); Symbol und Zähler siehe folgende Zeilen |
| `packages/app/src/shell/app.ts` | 1840 | `symbol[z.layer]` | Eintrag aus der festen Symboltabelle (oder undefined) |
| `packages/app/src/shell/app.ts` | 1841 | `z.cells` | lokal gezählt in summarizeLayers() |
| `packages/app/src/shell/app.ts` | 1845 | `` (Zuweisung) r.cells.slice(0, 15).map((c) => `${symbol[c.layer] ?? "•"} ${escapeHtml(c.region ¦¦ "?")} · ${escapeHtml(c.label)}`, ).j `` | Callback: Template mit escapeHtml(region, label); Symbol aus fester Tabelle |
| `packages/app/src/shell/app.ts` | 1846 | `symbol[c.layer]` | Eintrag aus der festen Symboltabelle (oder undefined) |
| `packages/app/src/shell/app.ts` | 1849 | `r.hiddenCells` | lokal gezählt in buildCoverage() |
| `packages/app/src/shell/app.ts` | 2148 | `entries.map(([m, info]) => { const sp = speedOf(m); const short = m.split(":")[0]; const satsPer1k = Math.ceil(info.pric` | Callback: Template mit escapeHtml(m) und escapeHtml(short); übrige Werte siehe folgende Zeilen |
| `packages/app/src/shell/app.ts` | 2156 | `sp.cls` | fester Klassenname aus speedOf() |
| `packages/app/src/shell/app.ts` | 2156 | `sp.label` | festes Label aus speedOf() |
| `packages/app/src/shell/app.ts` | 2157 | `satsPer1k` | Math.ceil(...) – immer eine Zahl |
| `packages/app/src/shell/app.ts` | 2157 | `solPer1k` | Zahl.toFixed(6) – nur Ziffern und Punkt |
| `packages/app/src/shell/app.ts` | 2157 | `info.count` | lokal gezählt (Provider je Modell) |
| `packages/app/src/shell/app.ts` | 2214 | `(Zuweisung) markSvg(18)` | eigenes SVG mit fester Farbe |
| `packages/app/src/shell/app.ts` | 2216 | `(Zuweisung) markSvg(30)` | eigenes SVG mit fester Farbe |
| `packages/app/src/shell/app.ts` | 2345 | `(Zuweisung) alle.map((v) => { const d = new Date(v.at * 1000); const gruppe = d.toDateString() === heute ? "Heute" : "Früher"; const` | Callback: Template mit escapeHtml(v.id) und escapeHtml(v.title); übrige Werte siehe folgende Zeilen |
| `packages/app/src/shell/app.ts` | 2348 | `gruppe` | fest: Heute oder Früher |
| `packages/app/src/shell/app.ts` | 2351 | `kopf` | Template mit dem festen Gruppennamen oder leer |
| `packages/app/src/shell/app.ts` | 2351 | `aktiv` | fest: active oder leer |
| `packages/app/src/shell/app.ts` | 2353 | `v.messages.length` | Länge des lokal gespeicherten Verlaufs |
| `packages/app/src/shell/app.ts` | 2396 | `` (Zuweisung) tools.map((x) => `<div class="panel-row"> <span class="panel-check">${markSvgCheck()}</span> <span class="panel-name">${ `` | Callback: Template mit escapeHtml(x.name) und Math.floor |
| `packages/app/src/shell/app.ts` | 2604 | `` (Zuweisung) conversations .sort((a, b) => b.lastTs - a.lastTs) .map( (c) => `<div class="chat-item ${c.id === activeConversation ? " `` | Callback: Template mit escapeHtml(c.id) und escapeHtml(c.name) |
| `packages/app/src/shell/app.ts` | 2837 | `(Zuweisung) decrypted .sort((a, b) => a.created_at - b.created_at) .map((ev) => { const mine = ev.pubkey === state.keypair!.pk; let` | Callback: Templates mit escapeHtml; alt, zapBtn, body, media siehe folgende Zeilen |
| `packages/app/src/shell/app.ts` | 2868 | `alt` | festes Markup oder leer |
| `packages/app/src/shell/app.ts` | 2868 | `zapBtn` | Template mit escapeHtml(ev.pubkey) und escapeHtml(pkShort(ev.pubkey)) |
| `packages/app/src/shell/app.ts` | 2868 | `body` | body = escapeHtml(text) |
| `packages/app/src/shell/app.ts` | 2868 | `media` | renderAttachment() maskiert Name und URL und erlaubt nur sichere Schemata (shell-logic.ts) |
| `packages/app/src/shell/app.ts` | 3340 | `msgs.length` | Anzahl eigener Chat-Blasen (lokal) |
| `packages/app/src/shell/app.ts` | 3517 | `cls` | feste Klassennamen ok/err/warn |
| `packages/app/src/shell/app.ts` | 3522 | `quellen.map((q) => escapeHtml(q)).join(", ")` | jede Quelle mit escapeHtml |
| `packages/app/src/shell/app.ts` | 3778 | `whoLabel` | fest du, sonst agent plus escapeHtml(model) |
| `packages/app/src/shell/app.ts` | 3779 | `body` | renderMarkdown(escapeHtml(text)) oder escapeHtml(text) |
| `packages/app/src/shell/app.ts` | 3792 | `whoLabel` | agent plus escapeHtml(model) |
| `packages/app/src/shell/app.ts` | 3806 | `(Zuweisung) renderMarkdown(escapeHtml(text))` | Eingabe vorher maskiert; renderMarkdown() erzeugt nur feste Tags |
| `packages/app/src/shell/app.ts` | 3902 | `haken` | eigenes SVG, Konstante |
| `packages/app/src/shell/app.ts` | 3908 | `werkzeugTeil` | Template mit toolRows: escapeHtml(t.name) und Math.floor |
| `packages/app/src/shell/app.ts` | 3909 | `zeile("Modell", usage.model ?? "—")` | zeile() maskiert Schlüssel und Wert selbst |
| `packages/app/src/shell/app.ts` | 3910 | `zeile("Provider", pkShort(providerPk))` | zeile() maskiert Schlüssel und Wert selbst |
| `packages/app/src/shell/app.ts` | 3911 | `` zeile("Tokens", `${ganzeZahl(usage.promptTokens)} rein, ${ganzeZahl(usage.completionTokens)} raus`) `` | zeile() maskiert Schlüssel und Wert selbst |
| `packages/app/src/shell/app.ts` | 3912 | `` zeile("Diese Antwort", `${Math.floor(amountMsat / 1000)} sat`) `` | zeile() maskiert Schlüssel und Wert selbst |
| `packages/app/src/shell/app.ts` | 3996 | `zeilen` | Templates mit escapeHtml(l.leg), festen Klassen und Marken, Zahl.toFixed(2) |
| `packages/app/src/shell/app.ts` | 4043 | `(Zuweisung) svg` | icon(...) aus der festen Symboltabelle |
| `packages/app/src/shell/app.ts` | 4179 | `` (Zuweisung) valid .map( ({ ev, offer }) => ` <div class="stat"> <span class="k">${escapeHtml(pkShort(ev.pubkey))} · ${Number(offer.m `` | Callback: Template mit escapeHtml und Number(...) |
| `packages/app/src/shell/app.ts` | 4183 | `(Number(offer.feePpm) / 100).toFixed(1)` | Number(...).toFixed(1) – nur Ziffern und Punkt |
| `packages/app/src/shell/app.ts` | 4363 | `(Zuweisung) verdict.problems.map((p) => escapeHtml(p)).join("<br>")` | jede Zeile mit escapeHtml |
| `packages/app/src/shell/app.ts` | 4478 | `` (Zuweisung) sorted .map((ev) => { const get = (n: string) => ev.tags.find((t) => t[0] === n)?.[1] ?? "—"; return `<div class="stat"> `` | Callback: Template mit escapeHtml(get(...)), Math.floor und timeAgo() |
| `packages/app/src/shell/app.ts` | 4482 | `timeAgo(ev.created_at)` | timeAgo() rechnet: Zahl plus s/m/h/d |
| `packages/app/src/shell/app.ts` | 4496 | `` (Zuweisung) `<div class="lb-skeleton"></div>`.repeat(4) `` | festes Markup |
| `packages/app/src/shell/app.ts` | 4551 | `rows` | Templates mit escapeHtml(pkShort(pk)), lokalen Zählern und festem Tier-Namen |
| `packages/app/src/shell/app.ts` | 4637 | `` (Zuweisung) sorted.map((ev) => { const name = ev.tags.find((t) => t[0] === "d")?.[1] ?? "?"; return `<div class="stat"><span class=" `` | Callback: Template mit escapeHtml(name), escapeHtml(pkShort(...)) und escapeHtml(blob) |
| `packages/app/src/shell/app.ts` | 4934 | `new Date((Math.floor(Date.now() / 1000) + 7200) * 1000).toLocaleTimeString("de-DE")` | lokal berechnete Uhrzeit |
| `packages/app/src/shell/app.ts` | 4967 | `restMin` | Math.ceil(...) – Zahl |
| `packages/app/src/shell/app.ts` | 4989 | `res.refunded.length` | Länge eines Arrays aus dem eigenen Refund-Ergebnis |
| `packages/app/src/shell/app.ts` | 5190 | `` (Zuweisung) LANGS.map( (l) => `<button type="button" data-lang="${l.code}" class="${l.code === getLang() ? "active" : ""}">${l.code. `` | Callback: Template aus der festen Sprachliste LANGS |
| `packages/app/src/shell/app.ts` | 5191 | `l.code` | feste Sprachliste LANGS (i18n.ts) |
| `packages/app/src/shell/app.ts` | 5191 | `l.code.toUpperCase()` | feste Sprachliste LANGS (i18n.ts) |
| `packages/app/src/shell/app.ts` | 5191 | `l.label` | feste Sprachliste LANGS (i18n.ts) |
| `packages/app/src/shell/app.ts` | 5530 | `sats` | Math.floor(...) – Zahl |
| `packages/app/src/shell/app.ts` | 5716 | `p.monthlySats.toLocaleString("de-DE")` | Zahl aus projectEarnings(), formatiert |
| `packages/app/src/shell/app.ts` | 5717 | `p.yearlySats.toLocaleString("de-DE")` | Zahl aus projectEarnings(), formatiert |
| `packages/app/src/shell/app.ts` | 5769 | `u.activeReferrals` | lokal gezählt in referrerOverview() |
| `packages/app/src/shell/app.ts` | 5769 | `u.totalReferrals` | lokal gezählt in referrerOverview() |
| `packages/app/src/shell/app.ts` | 5770 | `u.level2Count` | lokal gezählt in referrerOverview() |
| `packages/app/src/shell/app.ts` | 5772 | `next.missing` | Zahl aus nextTier() |

100 Fundstellen, davon 0 unbewertet.
