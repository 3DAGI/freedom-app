#!/usr/bin/env python3
"""
Smoke-Test fuer die gebaute App (dist/freedom.html).

Prueft im Headless-Chromium:
  - die App startet (window.freedomApp existiert), keine Skriptfehler
  - eine Content-Security-Policy ist gesetzt
  - ein eingeschleuster Inline-Handler (onerror=...) wird NICHT ausgefuehrt
  - Fremddaten landen als Text, nicht als HTML: ein gespeicherter Verlauf mit
    HTML im Modellnamen des Providers (Schritt 0.B) wird wiederhergestellt
  - Tresor (Schritt 1.2): Merkphrase bestaetigen, Tresor einrichten, danach
    Speicher-Scan – Schluessel, Wallet-Verbindung, Preimages, Unterhaltungen
    und Verlaeufe stehen weder in localStorage noch im Klartext in IndexedDB;
    neu laden, falsche und richtige Passphrase, Chat und Verlauf sind wieder da;
    „Passphrase vergessen“ ueber die 12 Woerter – die Identitaet bleibt dieselbe
  - Tresor-Pflicht: eine neue Wallet-Verbindung ohne Tresor wird nicht gespeichert
  - Automatische Sperre (gesteuerte Uhr): nach 16 Minuten ohne Eingabe gesperrt,
    nach 14 noch nicht; nicht waehrend eines laufenden Auftrags; 0 = nie
  - Notfall-Loeschung (Schritt 8.14): mit Tresor, Geheimnissen, Sitzung,
    Blob-Speicher, Suchindex und einer kuenftigen Datenbank; der rechtliche
    Hinweis steht vorher, geloescht wird erst nach „LÖSCHEN“; danach sind weder
    Schluessel noch Daten in localStorage, sessionStorage oder IndexedDB, und
    die App startet leer mit neuer Identitaet
  - Sprache (Schritt 8.16): Deutsch fuer einen deutschen Browser, sonst Englisch;
    eine gespeicherte Wahl gilt, eine nicht mehr angebotene (fr) nicht
  - MLS-Engine (Schritt 2.2b-b): eingebettet, beim Start nicht geladen (kein
    WebAssembly uebersetzt); der Selbsttest in den Settings laedt sie unter der
    echten CSP ('wasm-unsafe-eval') ohne Netz und besteht; kein 'unsafe-eval'
  - Rahmen (Schritt C.1a): Desktop – Leiste links, die Seite neben ihr auch mit
    sichtbarer Onboarding-Leiste (vorher Breite 0), Adresse nur mit Seitennamen,
    Zurück; Mobil – unten Agent, Chat, Waehrung, Mehr; Verlauf und Modelle des
    Agenten erreichbar; unter „Mehr“ Repos, Verdienen, Netz, Profil, Settings,
    Sprache und der Relay-Stand „im Pool“; seit C.1b Repos und Netz als Seiten
    mit ihren Inhalten (Repositories, Mitwirkende, Abdeckung, Mesh)
  - Dialoge (Schritt C.2b1): per Tastatur, Fokus bleibt drin, Esc, Fokus zurück
  - Raum (Schritt C.2b2): ein Probe-Raum über eine Relay-Attrappe (signiert von
    scripts/raum-probe.mts) – beitreten per Dialog, der Raum steht gleich da,
    Verlauf nach Absender und Tag gruppiert, HTML in Nachrichten bleibt Text,
    Aktionen erst beim Fokus (mobil nach Antippen), mobil „‹“ zur Kanalliste;
    das Raum-Menü per Tastatur bis zum Dialog und zurück; seit C.2c der Thread:
    „2 Antworten“ öffnet ihn, eine Antwort auf eine Antwort geht mit root und
    reply hinaus, Esc schließt ihn

Verbindungsfehler zu Relays werden ignoriert (hängen vom Netz ab).

Aufruf:  python3 agent/werkzeuge/smoke_test.py packages/app/dist
Voraussetzung: pip install playwright && python3 -m playwright install chromium
Exit-Code 0 = bestanden, 1 = durchgefallen.
"""
import datetime, functools, http.server, json, re, socket, subprocess, sys, threading

# Verlauf mit HTML im Modellnamen und in meta – beides kam frueher roh ins HTML.
PROBE_VERLAUF = [{"id": "probe", "title": "Probe", "at": 1790000000, "messages": [
    {"role": "user", "text": "frage", "meta": ""},
    {"role": "ai", "text": "antwort", "meta": "<b id='probe-meta'>m</b>",
     "model": "<img id='probe-modell' src='x'>"}]}]
from pathlib import Path


def freier_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


# Geheimnisse, die vor dem Einrichten im Klartext liegen (Altbestand) – nach dem
# Einrichten darf keines davon mehr lesbar im Speicher stehen.
PROBE_GEHEIM = {
    "freedom.nwc.uri": "nostr+walletconnect://" + "ab" * 32 + "?relay=wss%3A%2F%2Fr.example&secret=" + "cd" * 32,
    "freedom.swap." + "01" * 32: json.dumps({"hashlockHex": "01" * 32, "preimageHex": "ef" * 32,
                                            "solAddress": "ProbeSol", "amountSats": 1, "createdAt": 1}),
    "freedom.htlc.probe": json.dumps({"preimageHex": "7a" * 32, "hashlockHex": "02" * 32}),
    "freedom.chats": json.dumps([{"id": "03" * 32, "type": "dm", "name": "ProbeChat", "lastTs": 0}]),
    "freedom.agentHistory": json.dumps([{"id": "p2", "title": "ProbeVerlauf", "at": 1790000000, "messages": []}]),
    "freedom.swapHistory": json.dumps([{"address": "ProbeAdresse", "uses": 1, "firstUsed": 1, "lastUsed": 1}]),
}
PROBE_MUSTER = ["cd" * 32, "ef" * 32, "7a" * 32, "ProbeChat", "ProbeVerlauf", "ProbeAdresse"]


def sprache_pruefen(browser, url: str) -> dict:
    """Sprache aus Browser oder gespeicherter Wahl; Rahmen in beiden Sprachen (8.16)."""
    erg = {"fehler": []}
    basis = url.rsplit("/", 1)[0]
    for locale, gespeichert, soll_lang, soll_nav, soll_titel, soll_zurueck, soll_aufgabe, soll_deposit, soll_sicherheit, soll_phrase in [
        ("de-DE", None, "de", "Kommunikation", "Guthaben", "‹ Zurück", "Neue Aufgabe", "hinterlegen", "Sicherheit", "Deine Wiederherstellungs-Phrase"),
        ("en-US", None, "en", "Chat", "Balance", "‹ Back", "New task", "deposit", "Security", "Your recovery phrase"),
        ("en-US", "fr", "en", "Chat", "Balance", "‹ Back", "New task", "deposit", "Security", "Your recovery phrase"),
        ("en-US", "de", "de", "Kommunikation", "Guthaben", "‹ Zurück", "Neue Aufgabe", "hinterlegen", "Sicherheit", "Deine Wiederherstellungs-Phrase"),
    ]:
        ctx = browser.new_context(locale=locale)
        ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith(basis) else r.abort())
        s = ctx.new_page()
        s.on("pageerror", lambda e: erg["fehler"].append(str(e)[:300]))
        if gespeichert:
            s.add_init_script(f"localStorage.setItem('freedom.lang', {json.dumps(gespeichert)});")
        s.goto(url, wait_until="load")
        s.wait_for_function("() => typeof window.freedomApp === 'object'", timeout=30000)
        # Frisches Profil: neue Identität, zuerst der Sicherungsdialog (8.16g1)
        s.wait_for_selector("#bk-done", timeout=30000)
        ist = s.evaluate("() => [document.documentElement.lang,"
                         " document.querySelector('[data-tab=\"comm\"] [data-i18n]').textContent,"
                         " document.getElementById('balance').title, document.getElementById('chat-back').textContent,"
                         " document.querySelector('#agent-new [data-i18n]').textContent,"
                         " document.getElementById('dep-start').textContent,"
                         " document.querySelector('[data-subpane=\"settings:security\"] .settings-h').textContent,"
                         " document.querySelector('.modal h3').textContent]")
        erg[f"{locale}/{gespeichert}"] = ist
        if ist != [soll_lang, soll_nav, soll_titel, soll_zurueck, soll_aufgabe, soll_deposit, soll_sicherheit, soll_phrase]:
            erg["fehler"].append(f"{locale}/{gespeichert}: {ist}")
        ctx.close()
    erg["bestanden"] = not erg["fehler"]
    return erg


def tresor_pruefen(browser, url: str) -> dict:
    """Tresor-Ablauf in einem frischen Profil, ohne Netz nach aussen."""
    erg = {"fehler": []}
    ctx = browser.new_context(locale="de-DE")
    basis = url.rsplit("/", 1)[0]
    ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith(basis) else r.abort())
    s = ctx.new_page()
    s.on("pageerror", lambda e: erg["fehler"].append(str(e)[:300]))
    ev = s.evaluate

    def warte(bedingung: str) -> None:
        s.wait_for_function(bedingung, timeout=30000)

    def felder(werte: dict, knopf: str) -> None:
        ev("([w, k]) => { for (const [id, v] of Object.entries(w)) document.getElementById(id).value = v;"
           " document.getElementById(k).click(); }", [werte, knopf])

    s.goto(url, wait_until="load")
    s.wait_for_timeout(2500)
    woerter = ev("() => [...document.querySelectorAll('.mnemonic-list li')].map(l => l.textContent)")
    ev("(w) => document.querySelectorAll('#bk-challenge input').forEach(i => i.value = w[+i.dataset.pos])", woerter)
    ev("() => document.getElementById('bk-done').click()")
    nsec = ev("() => localStorage.getItem('freedom.nsec')") or ""
    ident = ev("() => document.getElementById('ident').textContent")
    erg["start"] = len(woerter) == 12 and len(nsec) == 64
    # Altbestand anlegen und neu laden, damit die App ihn wie gewohnt liest
    ev("(w) => { for (const [k, v] of Object.entries(w)) localStorage.setItem(k, v); }", PROBE_GEHEIM)
    s.reload(wait_until="load")
    s.wait_for_timeout(2000)

    ev("() => document.querySelector('.app-nav button[data-tab=\"settings\"]').click()")
    ev("() => document.querySelector('.sec-action[data-step=\"4\"]').click()")
    felder({"tr-neu1": "smoke tresor 1", "tr-neu2": "smoke tresor 1"}, "tr-ok")
    warte("() => !document.getElementById('tr-ok')")
    scan = ev("""async (nsec) => {
      const ls = Object.keys(localStorage).map(k => k + '=' + localStorage.getItem(k)).join('\\n');
      const blob = await new Promise((r) => { const q = indexedDB.open('freedom-vault');
        q.onsuccess = () => { const g = q.result.transaction('tresor').objectStore('tresor').get('blob');
          g.onsuccess = () => r(g.result); }; q.onerror = () => r(null); });
      return { ls, blob: typeof blob === 'string' ? blob : null, merker: localStorage.getItem('freedom.vault') };
    }""")
    muster = [nsec] + PROBE_MUSTER
    erg["speicher_scan"] = (scan["blob"] is not None and scan["merker"] == "1"
                            and not any(m in scan["ls"] or m in scan["blob"] for m in muster)
                            and not any(k + "=" in scan["ls"] for k in PROBE_GEHEIM))

    s.reload(wait_until="load")
    warte("() => !!document.getElementById('tr-pass')")
    erg["gesperrt_ohne_identitaet"] = ev("() => document.getElementById('ident').textContent") != ident
    felder({"tr-pass": "falsche passphrase"}, "tr-ok")
    warte("() => document.getElementById('tr-meldung').textContent.includes('falsch')")
    felder({"tr-pass": "smoke tresor 1"}, "tr-ok")
    warte("() => !document.getElementById('tr-pass')")
    s.wait_for_timeout(1000)
    erg["entsperrt_gleiche_identitaet"] = ev("() => document.getElementById('ident').textContent") == ident
    ev("() => document.querySelector('.app-nav button[data-tab=\"comm\"]').click()")
    s.wait_for_timeout(500)
    erg["daten_aus_tresor"] = ev("() => document.getElementById('chat-list').textContent.includes('ProbeChat')"
                                 " && document.getElementById('agent-history').textContent.includes('ProbeVerlauf')")

    s.reload(wait_until="load")
    warte("() => !!document.getElementById('tr-vergessen')")
    ev("() => document.getElementById('tr-vergessen').click()")
    felder({"tr-phrase": " ".join(woerter), "tr-neu1": "smoke tresor 2", "tr-neu2": "smoke tresor 2"}, "tr-ok")
    warte("() => !document.getElementById('tr-phrase')")
    s.wait_for_timeout(1000)
    erg["vergessen_gleiche_identitaet"] = ev("() => document.getElementById('ident').textContent") == ident
    ctx.close()

    # Tresor-Pflicht: frisches Profil ohne Tresor, neue Wallet-Verbindung
    ctx = browser.new_context(locale="de-DE")
    ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith(basis) else r.abort())
    s = ctx.new_page()
    s.on("pageerror", lambda e: erg["fehler"].append(str(e)[:300]))
    ev = s.evaluate
    s.goto(url, wait_until="load")
    s.wait_for_timeout(2500)
    ev("() => document.querySelector('.modal-backdrop')?.remove()")
    ev("() => document.querySelector('.app-nav button[data-tab=\"wallet\"]').click()")
    ev("(u) => { document.getElementById('nwc-uri').value = u; document.getElementById('nwc-connect').click(); }",
       PROBE_GEHEIM["freedom.nwc.uri"])
    warte("() => !!document.getElementById('tr-abbruch')")
    grund = ev("() => document.getElementById('tr-grund').textContent")
    ev("() => document.getElementById('tr-abbruch').click()")
    warte("() => document.getElementById('nwc-status').textContent.includes('Nicht verbunden')")
    erg["pflicht_vor_nwc"] = ("Wallet-Verbindung" in grund
                              and ev("() => localStorage.getItem('freedom.nwc.uri')") is None)
    ctx.close()
    erg["bestanden"] = (not erg["fehler"] and all(v is True for k, v in erg.items()
                                                   if k not in ("fehler", "bestanden")))
    return erg


def sperre_pruefen(browser, url: str) -> dict:
    """Automatische Sperre mit gesteuerter Uhr – ohne 15 Minuten zu warten."""
    erg = {"fehler": []}
    ctx = browser.new_context(locale="de-DE")
    basis = url.rsplit("/", 1)[0]
    ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith(basis) else r.abort())
    s = ctx.new_page()
    s.on("pageerror", lambda e: erg["fehler"].append(str(e)[:300]))
    ev = s.evaluate
    s.clock.install()

    def warte(bedingung: str) -> None:
        try:
            s.wait_for_function(bedingung, timeout=30000)
        except Exception as e:
            raise RuntimeError(f"wartet vergeblich auf {bedingung}") from e

    def entsperre() -> None:
        ev("() => { document.getElementById('tr-pass').value = 'smoke sperre 1';"
           " document.getElementById('tr-ok').click(); }")
        warte("() => !document.getElementById('tr-pass')")
        s.wait_for_timeout(1000)

    offen = "() => !document.getElementById('tr-pass')"

    def laufe(dauer: str) -> None:
        s.clock.fast_forward(dauer)
        s.wait_for_timeout(300)

    s.goto(url, wait_until="load")
    s.wait_for_timeout(2500)
    ev("() => document.querySelector('.modal-backdrop')?.remove()")
    ev("() => document.querySelector('.app-nav button[data-tab=\"settings\"]').click()")
    ev("() => document.querySelector('.sec-action[data-step=\"4\"]').click()")
    ev("() => { document.getElementById('tr-neu1').value = 'smoke sperre 1';"
       " document.getElementById('tr-neu2').value = 'smoke sperre 1'; document.getElementById('tr-ok').click(); }")
    warte("() => !document.getElementById('tr-ok')")
    # Uhr anhalten: Laeuft sie natuerlich weiter, kann Playwright einen
    # fast_forward wieder verlieren (gemessen: Date.now() stand danach wieder
    # beim Ausgangswert). Angehalten bewegt sie sich nur durch die Spruenge hier.
    # pause_at: eine Zahl liest die Python-API als Sekunden – deshalb datetime.
    jetzt_ms = ev("() => Date.now()")
    s.clock.pause_at(datetime.datetime.fromtimestamp((jetzt_ms + 1000) / 1000, tz=datetime.timezone.utc))
    laufe("14:00")
    erg["nach_14_min_offen"] = ev(offen)
    laufe("02:00")
    warte("() => !!document.getElementById('tr-pass')")
    erg["nach_16_min_gesperrt"] = True
    entsperre()
    ev("() => { document.getElementById('ai-send').dataset.running = '1'; }")
    laufe("40:00")
    erg["auftrag_laeuft_offen"] = ev(offen)
    ev("() => { document.getElementById('ai-send').dataset.running = ''; }")
    ev("() => document.querySelector('.app-nav button[data-tab=\"settings\"]').click()")
    ev("() => { const f = document.getElementById('tresor-sperre'); f.value = '0';"
       " f.dispatchEvent(new Event('change')); }")
    laufe("03:00:00")
    erg["null_heisst_nie"] = ev(offen)
    ctx.close()
    erg["bestanden"] = (not erg["fehler"] and all(v is True for k, v in erg.items()
                                                   if k not in ("fehler", "bestanden")))
    return erg


def loeschen_pruefen(browser, url: str) -> dict:
    """Notfall-Loeschung (8.14): alles Lokale weg, nachgeprueft, die App startet leer."""
    erg = {"fehler": []}
    ctx = browser.new_context(locale="de-DE")
    basis = url.rsplit("/", 1)[0]
    ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith(basis) else r.abort())
    s = ctx.new_page()
    s.on("pageerror", lambda e: erg["fehler"].append(str(e)[:300]))
    s.on("dialog", lambda d: d.accept())
    ev = s.evaluate

    def warte(bedingung: str) -> None:
        s.wait_for_function(bedingung, timeout=30000)

    def felder(werte: dict, knopf: str) -> None:
        ev("([w, k]) => { for (const [id, v] of Object.entries(w)) document.getElementById(id).value = v;"
           " document.getElementById(k).click(); }", [werte, knopf])

    s.goto(url, wait_until="load")
    s.wait_for_timeout(2500)
    woerter = ev("() => [...document.querySelectorAll('.mnemonic-list li')].map(l => l.textContent)")
    ev("(w) => document.querySelectorAll('#bk-challenge input').forEach(i => i.value = w[+i.dataset.pos])", woerter)
    ev("() => document.getElementById('bk-done').click()")
    nsec = ev("() => localStorage.getItem('freedom.nsec')") or ""
    ident = ev("() => document.getElementById('ident').textContent")
    # Bestand: Geheimnisse, Sitzung, Blob-Speicher, Suchindex und eine kuenftige Datenbank
    ev("""async (w) => {
      for (const [k, v] of Object.entries(w)) localStorage.setItem(k, v);
      sessionStorage.setItem('freedom.probe', 'ProbeSitzung');
      const lege = (db, st, v) => new Promise((r) => { const q = indexedDB.open(db, 1);
        q.onupgradeneeded = () => q.result.createObjectStore(st);
        q.onsuccess = () => { const t = q.result.transaction(st, 'readwrite'); t.objectStore(st).put(v, 'probe');
          t.oncomplete = () => { q.result.close(); r(); }; }; });
      await lege('freedom-blobs', 'chunks', 'ProbeChunk');
      await lege('freedom-suche', 'index', 'ProbeSuche');
      await lege('freedom-kuenftig', 'x', 'ProbeKuenftig');
    }""", PROBE_GEHEIM)
    s.reload(wait_until="load")
    s.wait_for_timeout(2000)
    ev("() => document.querySelector('.app-nav button[data-tab=\"settings\"]').click()")
    ev("() => document.querySelector('.sec-action[data-step=\"4\"]').click()")
    felder({"tr-neu1": "smoke tresor 3", "tr-neu2": "smoke tresor 3"}, "tr-ok")
    warte("() => !document.getElementById('tr-ok')")
    s.reload(wait_until="load")
    warte("() => !!document.getElementById('tr-pass')")
    felder({"tr-pass": "smoke tresor 3"}, "tr-ok")
    warte("() => !document.getElementById('tr-pass')")
    s.wait_for_timeout(1000)
    erg["vorher_da"] = ev("async () => (await indexedDB.databases()).map(d => d.name).sort().join(',')") == \
        "freedom-blobs,freedom-kuenftig,freedom-suche,freedom-vault"

    ev("() => document.querySelector('.app-nav button[data-tab=\"settings\"]').click()")
    ev("() => document.getElementById('notfall-loeschen').click()")
    warte("() => !!document.getElementById('notfall-los')")
    erg["hinweis_vorher"] = ev("() => { const t = document.querySelector('.modal').textContent;"
                               " return t.includes('RECHTLICHER HINWEIS') && t.includes('Beweismitteln strafbar')"
                               " && document.getElementById('notfall-los').disabled; }")
    ev("() => { const e = document.getElementById('notfall-bestaetigung'); e.value = 'löschen';"
       " e.dispatchEvent(new Event('input')); document.getElementById('notfall-los').click(); }")
    warte("() => (document.getElementById('toast')?.textContent || '').includes('nachgeprüft')")
    scan = ev("""async () => {
      const ls = Object.keys(localStorage).map(k => k + '=' + localStorage.getItem(k)).join('\\n');
      const ss = Object.keys(sessionStorage).join(',');
      const dbs = (await indexedDB.databases()).map(d => d.name).sort();
      let tresorBlob = null;
      if (dbs.includes('freedom-vault')) tresorBlob = await new Promise((r) => { const q = indexedDB.open('freedom-vault');
        q.onsuccess = () => { const db = q.result; if (![...db.objectStoreNames].includes('tresor')) { db.close(); return r(null); }
          const g = db.transaction('tresor').objectStore('tresor').get('blob');
          g.onsuccess = () => { db.close(); r(g.result ?? null); }; }; q.onerror = () => r(null); });
      return { ls, ss, dbs, tresorBlob, ident: document.getElementById('ident').textContent };
    }""")
    muster = [nsec, "ProbeSitzung"] + PROBE_MUSTER
    erg["nichts_uebrig"] = (not any(m in scan["ls"] for m in muster)
                            and not any(k + "=" in scan["ls"] for k in PROBE_GEHEIM)
                            and "freedom.vault=1" not in scan["ls"] and scan["ss"] == ""
                            and set(scan["dbs"]) <= {"freedom-vault"} and scan["tresorBlob"] is None)
    erg["leer_neu_gestartet"] = scan["ident"] != ident and not ev("() => !!document.getElementById('tr-pass')")
    if not erg["nichts_uebrig"]:
        erg["fehler"].append(f"Rest: dbs={scan['dbs']} ss={scan['ss']!r}")
    ctx.close()
    erg["bestanden"] = (not erg["fehler"] and all(v is True for k, v in erg.items()
                                                   if k not in ("fehler", "bestanden")))
    return erg


def mls_pruefen(browser, url: str) -> dict:
    """MLS-Engine: erst bei Bedarf geladen, dann Selbsttest unter der echten CSP."""
    erg = {"fehler": [], "csp": []}
    ctx = browser.new_context(locale="de-DE")
    basis = url.rsplit("/", 1)[0]
    ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith(basis) else r.abort())
    s = ctx.new_page()
    s.on("pageerror", lambda e: erg["fehler"].append(str(e)[:300]))
    # Jedes Uebersetzen von WebAssembly zaehlen – vor dem Selbsttest darf keines passieren.
    s.add_init_script(
        "window.__wasm = 0; for (const k of ['instantiate', 'compile', 'instantiateStreaming', 'compileStreaming']) {"
        " const o = WebAssembly[k]; if (o) WebAssembly[k] = function (...a) { window.__wasm++; return o.apply(this, a); }; }"
        " const M = WebAssembly.Module; WebAssembly.Module = function (...a) { window.__wasm++; return new M(...a); };"
        " document.addEventListener('securitypolicyviolation', e => {"
        " (window.__csp = window.__csp || []).push(e.violatedDirective); });")
    s.goto(url, wait_until="load")
    s.wait_for_timeout(2500)
    csp = s.evaluate("document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]').content")
    script_src = next((d.strip() for d in csp.split(";") if d.strip().startswith("script-src")), "")
    erg["script_src_ok"] = "'wasm-unsafe-eval'" in script_src and "'unsafe-eval'" not in script_src
    erg["vorher_geladen"] = s.evaluate("window.__wasm")
    s.evaluate("() => document.getElementById('mls-selbsttest').click()")
    s.wait_for_function("() => /bestanden|gescheitert/.test(document.getElementById('mls-ergebnis').textContent)",
                        timeout=60000)
    erg["ergebnis"] = s.evaluate("document.getElementById('mls-ergebnis').textContent")
    erg["nachher_geladen"] = s.evaluate("window.__wasm")
    erg["csp"] = s.evaluate("window.__csp || []")
    ctx.close()
    erg["bestanden"] = (erg["script_src_ok"] and erg["vorher_geladen"] == 0 and erg["nachher_geladen"] >= 1
                        and erg["ergebnis"].startswith("bestanden") and not erg["fehler"] and not erg["csp"])
    return erg


SICHTBAR = """(sel) => { const e = document.querySelector(sel); if (!e) return false;
  const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
  return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth; }"""


def rahmen_pruefen(browser, url: str) -> dict:
    """Rahmen (C.1a): jede Seite erreichbar, Desktop und Mobil, ab dem ersten Start."""
    erg = {"fehler": []}
    basis = url.rsplit("/", 1)[0]
    for groesse, vp in [("desktop", {"width": 1280, "height": 800}), ("mobil", {"width": 390, "height": 844})]:
        ctx = browser.new_context(locale="de-DE", viewport=vp, is_mobile=groesse == "mobil", has_touch=groesse == "mobil")
        ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith(basis) else r.abort())
        s = ctx.new_page()
        s.on("pageerror", lambda e: erg["fehler"].append(str(e)[:300]))
        ev = s.evaluate
        sichtbar = lambda sel: ev(SICHTBAR, sel)
        klick = lambda sel: (ev("(sel) => document.querySelector(sel).click()", sel), s.wait_for_timeout(300))
        s.goto(url, wait_until="load")
        s.wait_for_selector("#bk-done", timeout=30000)
        w = ev("() => [...document.querySelectorAll('.mnemonic-list li')].map(l => l.textContent)")
        ev("(w) => document.querySelectorAll('#bk-challenge input').forEach(i => i.value = w[+i.dataset.pos])", w)
        ev("() => document.getElementById('bk-done').click()")
        s.wait_for_timeout(1500)
        ev("() => document.getElementById('ein-abbrechen')?.click()")
        s.wait_for_timeout(500)
        tabs = ev("() => [...document.querySelectorAll('.app-nav button[data-tab]')].map(b => b.dataset.tab)")
        sichtbare = [t for t in tabs if sichtbar(f'.app-nav button[data-tab="{t}"]')]
        if groesse == "desktop":
            m = ev("""() => { const r = (s) => document.querySelector(s).getBoundingClientRect();
              const b = r('#onboarding-bar'); return { main: r('main'), nav: r('#app > nav'), leiste: b.height > 0 ? b : null }; }""")
            erg["desktop"] = {"main_breite": m["main"]["width"], "nav_x": m["nav"]["x"], "leiste_sichtbar": m["leiste"] is not None}
            if m["leiste"] is None or m["main"]["width"] < 800 or m["nav"]["x"] != 0 or m["main"]["x"] < m["nav"]["width"] \
                    or m["leiste"]["bottom"] > m["main"]["y"] + 1:
                erg["fehler"].append(f"desktop: Leiste links, Seite daneben, Onboarding darüber – {m}")
            if sichtbare != ["ai", "comm", "repos", "wallet", "earn", "netz", "profile", "settings"]:
                erg["fehler"].append(f"desktop: Leiste {sichtbare}")
            klick('.app-nav button[data-tab="comm"]')
            klick('.app-nav button[data-tab="wallet"]')
            adresse = ev("() => location.hash")
            ev("() => history.back()")
            s.wait_for_timeout(400)
            zurueck = ev("() => [location.hash, document.getElementById('page-comm').classList.contains('active')]")
            erg["desktop"]["adresse"] = [adresse, zurueck]
            if adresse != "#/waehrung" or zurueck != ["#/chat", True]:
                erg["fehler"].append(f"desktop: Adresse/Zurück {adresse} {zurueck}")
            titel = ev("() => document.querySelector('.nav-status').title")
            if "im Pool" not in titel:
                erg["fehler"].append(f"desktop: Relay-Stand {titel!r}")
            # C.1b: die verschobenen Inhalte stehen auf ihren neuen Seiten
            inhalte = {}
            for tab, sels in [("repos", ["#git-repo-list", "#nip34-liste", "#contrib-list"]),
                              ("netz", ["#coverage-refresh"]), ("earn", ["#trust-bar-track"])]:
                klick(f'.app-nav button[data-tab="{tab}"]')
                inhalte[tab] = all(sichtbar(x) for x in sels)
            klick('.app-nav button[data-tab="netz"]')
            klick('[data-subtab-group="netz"] [data-subtab="mesh"]')
            inhalte["mesh"] = sichtbar("#mesh-queue") and sichtbar("#mesh-connect")
            # 7.4c3: KI über Funk – Gateway wählen hier, „über Funk“ im Agenten erst mit Gateway
            inhalte["funk"] = sichtbar("#funk-gateway-suchen") and "Kein Gateway gemerkt." in ev(
                "() => document.getElementById('funk-gateway-stand').textContent") \
                and ev("() => document.getElementById('ai-funk-wahl').style.display") == "none"
            erg["desktop"]["inhalte"] = inhalte
            if not all(inhalte.values()):
                erg["fehler"].append(f"desktop: Inhalte {inhalte}")
        else:
            erg["mobil"] = {"leiste": sichtbare}
            if sichtbare != ["ai", "comm", "wallet", "mehr"] or not sichtbar('[data-tab="comm"] .nav-kurz'):
                erg["fehler"].append(f"mobil: untere Leiste {sichtbare}")
            klick("#agent-zu-verlauf")
            verlauf = [sichtbar("#agent-history"), not sichtbar(".agent-main"), ev("() => location.hash")]
            klick("#agent-seite-zurueck")
            wieder = sichtbar(".agent-main") and not sichtbar(".agent-side")
            klick("#agent-zu-modelle")
            modelle = sichtbar("#models-list")
            erg["mobil"]["agent"] = [verlauf, wieder, modelle]
            if verlauf != [True, True, "#/agent/verlauf"] or not wieder or not modelle:
                erg["fehler"].append(f"mobil: Agent {erg['mobil']['agent']}")
            klick('.app-nav button[data-tab="mehr"]')
            mehr = ev("""() => [[...document.querySelectorAll('#page-mehr [data-geh]')].map(b => b.dataset.geh),
              document.getElementById('mehr-relays').textContent]""")
            sprache = sichtbar("#lang-btn-mehr")
            klick('#page-mehr [data-geh="settings"]')
            settings = ev("""() => [document.getElementById('page-settings').classList.contains('active'),
              document.querySelector('.app-nav button[data-tab="mehr"]').classList.contains('active')]""")
            erg["mobil"]["mehr"] = [mehr, sprache, settings]
            if mehr[0] != ["repos", "earn", "netz", "profile", "settings"] or "im Pool" not in mehr[1] or not sprache or settings != [True, True]:
                erg["fehler"].append(f"mobil: Mehr {erg['mobil']['mehr']}")
        ctx.close()
    erg["bestanden"] = not erg["fehler"]
    return erg


def dialog_pruefen(browser, url: str) -> dict:
    """Dialoge (C.2b1): per Tastatur bedienbar, Fokus bleibt drin, Esc bricht ab, Fokus kehrt zurück."""
    erg = {"fehler": []}
    basis = url.rsplit("/", 1)[0]
    for groesse, vp in [("desktop", {"width": 1280, "height": 800}), ("mobil", {"width": 390, "height": 844})]:
        ctx = browser.new_context(locale="de-DE", viewport=vp, is_mobile=groesse == "mobil", has_touch=groesse == "mobil")
        ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith(basis) else r.abort())
        s = ctx.new_page()
        s.on("pageerror", lambda e: erg["fehler"].append(str(e)[:300]))
        ev = s.evaluate
        s.goto(url, wait_until="load")
        s.wait_for_selector("#bk-done", timeout=30000)
        w = ev("() => [...document.querySelectorAll('.mnemonic-list li')].map(l => l.textContent)")
        ev("(w) => document.querySelectorAll('#bk-challenge input').forEach(i => i.value = w[+i.dataset.pos])", w)
        ev("() => document.getElementById('bk-done').click()")
        s.wait_for_timeout(1500)
        ev("() => document.getElementById('ein-abbrechen')?.click()")
        ev("() => { location.hash = '#/chat'; }")
        s.wait_for_timeout(500)
        stand = """() => { const d = document.querySelector('[role=dialog][aria-modal=true]');
          const a = document.activeElement; return { offen: !!d, titel: d ? document.getElementById(d.getAttribute('aria-labelledby'))?.textContent : null,
            fokus_drin: !!(d && d.contains(a)), fokus: a?.id || a?.tagName, inert: document.getElementById('app').inert,
            meldung: d?.querySelector('[role=alert]')?.textContent ?? null }; }"""
        ev("() => document.getElementById('rail-join').focus()")
        s.keyboard.press("Enter")
        s.wait_for_timeout(300)
        auf = ev(stand)
        s.keyboard.press("Enter")  # leer bestätigen: Pflichtfeld meldet sich, Dialog bleibt
        s.wait_for_timeout(200)
        leer = ev(stand)
        for _ in range(5):
            s.keyboard.press("Tab")
        tab = ev(stand)
        s.keyboard.press("Escape")
        s.wait_for_timeout(200)
        zu = ev(stand)
        erg[groesse] = {"auf": auf, "leer": leer, "tab": tab["fokus_drin"], "zu": zu}
        if not (auf["offen"] and auf["titel"] == "Raum beitreten" and auf["fokus_drin"] and auf["inert"]):
            erg["fehler"].append(f"{groesse}: öffnen {auf}")
        if not (leer["offen"] and leer["meldung"] == "Bitte ausfüllen" and leer["fokus_drin"]):
            erg["fehler"].append(f"{groesse}: Pflichtfeld {leer}")
        if not tab["fokus_drin"]:
            erg["fehler"].append(f"{groesse}: Tab verlässt den Dialog {tab}")
        if zu["offen"] or zu["inert"] or zu["fokus"] != "rail-join":
            erg["fehler"].append(f"{groesse}: Esc {zu}")
        ctx.close()
    erg["bestanden"] = not erg["fehler"]
    return erg


class ProbeRelay:
    """Relay-Attrappe (seit C.2b2): jede REQ bekommt die passenden Probe-Events und
    EOSE, jedes EVENT ein OK. Den eigenen Schlüssel liest sie aus der Abfrage der
    eigenen Relay-Listen beim Start (Kind 10002 mit einem Autor) – die App zeigt
    ihn nirgends als Ganzes."""

    def __init__(self) -> None:
        self.ich: str | None = None
        self.events: list[dict] = []
        self.gesendet: list[dict] = []  # was die App veröffentlicht (seit C.2c)

    @staticmethod
    def passt(ev: dict, f: dict) -> bool:
        if "kinds" in f and ev["kind"] not in f["kinds"]:
            return False
        if "authors" in f and ev["pubkey"] not in f["authors"]:
            return False
        if "ids" in f and ev["id"] not in f["ids"]:
            return False
        for k, werte in f.items():
            if k.startswith("#") and not any(t[0] == k[1:] and t[1] in werte for t in ev["tags"] if len(t) > 1):
                return False
        return True

    def verbinde(self, ws) -> None:
        def nachricht(roh) -> None:
            try:
                m = json.loads(roh)
            except (TypeError, ValueError):
                return
            if not isinstance(m, list) or len(m) < 2:
                return
            if m[0] == "REQ":
                for f in (x for x in m[2:] if isinstance(x, dict)):
                    if 10002 in f.get("kinds", []) and len(f.get("authors", [])) == 1 and not self.ich:
                        self.ich = f["authors"][0]
                    for ev in self.events:
                        if self.passt(ev, f):
                            ws.send(json.dumps(["EVENT", m[1], ev]))
                ws.send(json.dumps(["EOSE", m[1]]))
            elif m[0] == "EVENT" and isinstance(m[1], dict):
                self.gesendet.append(m[1])
                ws.send(json.dumps(["OK", m[1].get("id", ""), True, ""]))
        ws.on_message(nachricht)


def raum_probe(ich: str) -> list[dict]:
    """Events des Probe-Raums; der eigene Schlüssel wird Moderator."""
    wurzel = Path(__file__).resolve().parent.parent
    aus = subprocess.run(["npx", "tsx", "scripts/raum-probe.mts", ich], cwd=wurzel, capture_output=True,
                         text=True, timeout=180, check=True)
    return json.loads(aus.stdout)["events"]


def raum_pruefen(browser, url: str) -> dict:
    """Raum (C.2b2): Verlauf gruppiert mit Namen, Fremdes als Text, Aktionen beim Fokus, Raum-Menü."""
    erg = {"fehler": []}
    basis = url.rsplit("/", 1)[0]
    for groesse, vp in [("desktop", {"width": 1280, "height": 800}), ("mobil", {"width": 390, "height": 844})]:
        mobil = groesse == "mobil"
        relay = ProbeRelay()
        ctx = browser.new_context(locale="de-DE", viewport=vp, is_mobile=mobil, has_touch=mobil)
        ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith(basis) else r.abort())
        ctx.route_web_socket(re.compile(r"^wss?://"), relay.verbinde)
        s = ctx.new_page()
        s.on("pageerror", lambda e: erg["fehler"].append(str(e)[:300]))
        ev = s.evaluate
        s.goto(url, wait_until="load")
        s.wait_for_selector("#bk-done", timeout=30000)
        w = ev("() => [...document.querySelectorAll('.mnemonic-list li')].map(l => l.textContent)")
        ev("(w) => document.querySelectorAll('#bk-challenge input').forEach(i => i.value = w[+i.dataset.pos])", w)
        ev("() => document.getElementById('bk-done').click()")
        s.wait_for_timeout(1500)
        ev("() => document.getElementById('ein-abbrechen')?.click()")
        ev("() => { location.hash = '#/chat'; }")
        for _ in range(80):
            if relay.ich:
                break
            s.wait_for_timeout(250)
        if not relay.ich:
            erg["fehler"].append(f"{groesse}: keine Abfrage der eigenen Relay-Listen – eigener Schlüssel unbekannt")
            ctx.close()
            continue
        relay.events = raum_probe(relay.ich)
        ev("() => document.getElementById('rail-join').click()")
        s.wait_for_timeout(300)
        s.keyboard.type("probe-raum")
        s.keyboard.press("Enter")
        try:
            s.wait_for_function("() => document.querySelectorAll('#channel-thread .msg-group').length >= 3", timeout=15000)
        except Exception:
            pass
        verlauf = ev("""() => { const th = document.getElementById('channel-thread');
          const gruppen = [...th.querySelectorAll('.msg-group')];
          return { gruppen: gruppen.map(g => g.querySelectorAll('.msg-zeile').length),
            autoren: gruppen.map(g => g.querySelector('.msg-author').textContent),
            tage: th.querySelectorAll('.msg-tag').length, bilder: th.querySelectorAll('img').length,
            xss: window.__raumXss === 1, alsText: th.textContent.includes('<img src=x'),
            aktionen: th.querySelectorAll('.msg-aktionen .mod-hide').length,
            sichtbar: th.getBoundingClientRect().height > 0,
            schreiben: !document.getElementById('channel-composer').classList.contains('hidden') }; }""")
        deckkraft = "() => getComputedStyle(document.querySelectorAll('.msg-aktionen')[2]).opacity"
        vorher = ev(deckkraft)
        if mobil:  # antippen
            s.locator("#channel-thread .msg-zeile").nth(2).tap()
        else:  # Tastatur: der Knopf selbst nimmt den Fokus
            ev("() => document.querySelectorAll('.msg-aktionen .mod-hide')[2].focus()")
        s.wait_for_timeout(100)
        nachher = ev(deckkraft)
        verlauf["deckkraft"] = [vorher, nachher]
        erg[groesse] = {"verlauf": verlauf}
        erwartet = {"gruppen": [2, 2, 1], "tage": 2, "bilder": 0, "xss": False, "alsText": True, "aktionen": 5, "schreiben": True}
        abweichung = {k: verlauf.get(k) for k, v in erwartet.items() if verlauf.get(k) != v}
        # Namen: ohne Kontakte der gekürzte Schlüssel – nie „Du“ für andere, nie leer
        if abweichung or not all(a and a != "Du" for a in verlauf["autoren"]):
            erg["fehler"].append(f"{groesse}: Verlauf {abweichung or verlauf['autoren']}")
        # Aktionen: erst beim Zeigen oder mit dem Fokus, mobil nach Antippen der Nachricht
        if [vorher, nachher] != ["0", "1"]:
            erg["fehler"].append(f"{groesse}: Aktionen sichtbar {vorher} → {nachher}")
        # Nach dem Beitreten steht der Raum da – auch mobil, dort als eigene Ebene mit „‹“ zur Kanalliste
        if not verlauf["sichtbar"]:
            erg["fehler"].append(f"{groesse}: Verlauf nach dem Beitreten nicht sichtbar")
        # Thread (C.2c): „2 Antworten“ öffnet ihn; eine Antwort auf die Antwort geht mit root und reply hinaus
        faden = """() => { const sp = document.getElementById('thread-spalte'); const r = (e) => e.getBoundingClientRect();
          return { offen: r(sp).width > 0, zeilen: sp.querySelectorAll('.msg-zeile').length, bezug: sp.querySelectorAll('.msg-bezug').length,
            kanal: r(document.querySelector('.channel-main')).width > 0, antwortAn: !document.getElementById('thread-antwort-an').classList.contains('hidden'),
            fokus: document.activeElement?.id || document.activeElement?.className || null }; }"""
        ev("() => document.querySelector('#channel-thread .thread-link').click()")
        s.wait_for_timeout(200)
        auf = ev(faden)
        ev("() => { const b = [...document.querySelectorAll('#thread-verlauf .antworten')]; b[b.length - 1].click(); }")
        s.wait_for_timeout(100)
        antwort_an = ev(faden)["antwortAn"]
        s.keyboard.type("Antwort aus dem Test")
        s.keyboard.press("Enter")
        s.wait_for_timeout(800)
        danach = ev(faden)
        wurzel = next(e for e in relay.events if e["content"] == "Willkommen im Probe-Raum.")["id"]
        ich_auch = next(e for e in relay.events if e["content"] == "Ich auch.")["id"]
        gesendet = [e for e in relay.gesendet if e.get("kind") == 42 and e.get("content") == "Antwort aus dem Test"]
        verweise = [(t[1], t[3]) for t in (gesendet[0]["tags"] if gesendet else []) if t[0] == "e" and len(t) > 3]
        s.keyboard.press("Escape")
        s.wait_for_timeout(200)
        zu = ev(faden)
        # Der Pool schickt dasselbe Event an jedes Relay – gezählt wird die Id
        einmal = len({e["id"] for e in gesendet})
        erg[groesse]["thread"] = {"auf": auf, "antwortAn": antwort_an, "danach": danach, "gesendet": einmal, "zu": zu}
        if not (auf["offen"] and auf["zeilen"] == 3 and auf["bezug"] == 1 and auf["kanal"] != mobil and auf["fokus"] == "thread-msg"):
            erg["fehler"].append(f"{groesse}: Thread öffnen {auf}")
        if not antwort_an or einmal != 1 or verweise != [(wurzel, "root"), (ich_auch, "reply")]:
            erg["fehler"].append(f"{groesse}: Antwort im Thread {antwort_an} {len(gesendet)} {verweise}")
        if danach["zeilen"] != 4 or danach["antwortAn"]:
            erg["fehler"].append(f"{groesse}: nach dem Senden {danach}")
        if zu["offen"] or zu["fokus"] != "thread-link" or not zu["kanal"]:
            erg["fehler"].append(f"{groesse}: Thread schließen {zu}")
        if mobil:
            ev("() => document.getElementById('channel-zurueck').click()")
            s.wait_for_timeout(200)
            ebenen = ev("""() => [document.getElementById('channel-thread').getBoundingClientRect().height > 0,
              document.getElementById('space-menue-knopf').getBoundingClientRect().height > 0,
              document.activeElement?.classList.contains('channel-item') ?? false]""")
            erg[groesse]["zurueck"] = ebenen
            if ebenen != [False, True, True]:
                erg["fehler"].append(f"mobil: „‹“ zur Kanalliste {ebenen}")
        else:
            stand = """() => { const m = document.getElementById('space-menue'); const d = document.querySelector('[role=dialog]');
              return { offen: !m.classList.contains('hidden'), expanded: document.getElementById('space-menue-knopf').getAttribute('aria-expanded'),
                fokus: document.activeElement?.id || null, dialog: d ? d.querySelector('h3').textContent : null }; }"""
            ev("() => document.getElementById('space-menue-knopf').focus()")
            schritte = {}
            for taste in ["ArrowDown", "End", "ArrowDown", "Escape", "Enter", "ArrowDown", "Enter", "Escape"]:
                s.keyboard.press(taste)
                s.wait_for_timeout(150)
                schritte.setdefault(taste, []).append(ev(stand))
            erg["desktop"]["menue"] = schritte
            soll = {
                "ArrowDown": [{"offen": True, "expanded": "true", "fokus": "space-mods", "dialog": None},
                              {"offen": True, "expanded": "true", "fokus": "space-mods", "dialog": None},
                              {"offen": True, "expanded": "true", "fokus": "space-join", "dialog": None}],
                "End": [{"offen": True, "expanded": "true", "fokus": "space-create-public", "dialog": None}],
                "Escape": [{"offen": False, "expanded": "false", "fokus": "space-menue-knopf", "dialog": None},
                           {"offen": False, "expanded": "false", "fokus": "space-menue-knopf", "dialog": None}],
                "Enter": [{"offen": True, "expanded": "true", "fokus": "space-mods", "dialog": None},
                          {"offen": False, "expanded": "false", "fokus": None, "dialog": "Raum beitreten"}],
            }
            # Im Dialog steht der Fokus auf dem Eingabefeld – dessen Id ist nicht fest
            schritte["Enter"][1]["fokus"] = None
            if schritte != soll:
                erg["fehler"].append(f"desktop: Raum-Menü {schritte}")
        ctx.close()
    erg["bestanden"] = not erg["fehler"]
    return erg


def main() -> int:
    dist = Path(sys.argv[1] if len(sys.argv) > 1 else "packages/app/dist").resolve()
    datei = dist / "freedom.html"
    if not datei.exists():
        print(f"FEHLT: {datei} – vorher bauen (node build.mjs)")
        return 1
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright fehlt: pip install playwright && python3 -m playwright install chromium")
        return 1

    port = freier_port()
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(dist))
    handler.log_message = lambda *a, **k: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    erg = {"pageerrors": [], "csp_verletzungen": []}
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            seite = browser.new_page(locale="de-DE")  # die Pruefungen lesen deutsche Texte (8.16)
            seite.on("pageerror", lambda e: erg["pageerrors"].append(str(e)[:300]))
            seite.add_init_script(
                "document.addEventListener('securitypolicyviolation', e => {"
                " (window.__csp = window.__csp || []).push(e.violatedDirective); });"
                f"localStorage.setItem('freedom.agentHistory', {json.dumps(json.dumps(PROBE_VERLAUF))});"
            )
            seite.goto(f"http://127.0.0.1:{port}/freedom.html", wait_until="load")
            seite.wait_for_timeout(4000)
            erg["booted"] = seite.evaluate("typeof window.freedomApp")
            erg["csp_gesetzt"] = seite.evaluate(
                "!!document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]')")
            seite.evaluate("""() => { const d = document.createElement('div');
                d.innerHTML = '<img src=x onerror="window.__xss=1">';
                document.body.appendChild(d); }""")
            seite.wait_for_timeout(800)
            erg["xss_ausgefuehrt"] = seite.evaluate("window.__xss === 1")
            # Verlauf oeffnen: addAiMessage() bekommt Modellname und meta aus dem Speicher.
            seite.evaluate("() => document.querySelector('.history-item[data-hid=\"probe\"]')?.click()")
            seite.wait_for_timeout(300)
            erg["fremd_als_text"] = seite.evaluate(
                "!document.getElementById('probe-modell') && !document.getElementById('probe-meta')"
                " && [...document.querySelectorAll('#ai-thread .who')].some(e => e.textContent.includes('<img'))")
            erg["csp_verletzungen"] = seite.evaluate("window.__csp || []")
            try:
                erg["tresor"] = tresor_pruefen(browser, f"http://127.0.0.1:{port}/freedom.html")
            except Exception as e:  # Zeitueberschreitung = durchgefallen, nicht abgestuerzt
                erg["tresor"] = {"bestanden": False, "fehler": [f"{type(e).__name__}: {str(e)[:200]}"]}
            try:
                erg["sperre"] = sperre_pruefen(browser, f"http://127.0.0.1:{port}/freedom.html")
            except Exception as e:
                erg["sperre"] = {"bestanden": False, "fehler": [f"{type(e).__name__}: {str(e)[:200]}"]}
            try:
                erg["notfall"] = loeschen_pruefen(browser, f"http://127.0.0.1:{port}/freedom.html")
            except Exception as e:
                erg["notfall"] = {"bestanden": False, "fehler": [f"{type(e).__name__}: {str(e)[:200]}"]}
            try:
                erg["sprache"] = sprache_pruefen(browser, f"http://127.0.0.1:{port}/freedom.html")
            except Exception as e:
                erg["sprache"] = {"bestanden": False, "fehler": [f"{type(e).__name__}: {str(e)[:200]}"]}
            try:
                erg["mls"] = mls_pruefen(browser, f"http://127.0.0.1:{port}/freedom.html")
            except Exception as e:
                erg["mls"] = {"bestanden": False, "fehler": [f"{type(e).__name__}: {str(e)[:200]}"]}
            try:
                erg["rahmen"] = rahmen_pruefen(browser, f"http://127.0.0.1:{port}/freedom.html")
            except Exception as e:
                erg["rahmen"] = {"bestanden": False, "fehler": [f"{type(e).__name__}: {str(e)[:200]}"]}
            try:
                erg["dialog"] = dialog_pruefen(browser, f"http://127.0.0.1:{port}/freedom.html")
            except Exception as e:
                erg["dialog"] = {"bestanden": False, "fehler": [f"{type(e).__name__}: {str(e)[:200]}"]}
            try:
                erg["raum"] = raum_pruefen(browser, f"http://127.0.0.1:{port}/freedom.html")
            except Exception as e:
                erg["raum"] = {"bestanden": False, "fehler": [f"{type(e).__name__}: {str(e)[:200]}"]}
            browser.close()
    finally:
        srv.shutdown()

    ok = (erg.get("booted") == "object" and not erg["pageerrors"]
          and erg.get("csp_gesetzt") and erg.get("xss_ausgefuehrt") is False
          and erg.get("fremd_als_text") is True
          and erg.get("tresor", {}).get("bestanden") is True
          and erg.get("sperre", {}).get("bestanden") is True
          and erg.get("notfall", {}).get("bestanden") is True
          and erg.get("sprache", {}).get("bestanden") is True
          and erg.get("mls", {}).get("bestanden") is True
          and erg.get("rahmen", {}).get("bestanden") is True
          and erg.get("dialog", {}).get("bestanden") is True
          and erg.get("raum", {}).get("bestanden") is True)
    erg["bestanden"] = bool(ok)
    print(json.dumps(erg, indent=1, ensure_ascii=False))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
