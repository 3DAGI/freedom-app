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
    Sprache und der Relay-Stand (seit C-16 „verbunden“); seit C.1b Repos und Netz als Seiten
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
from urllib.parse import parse_qs, urlparse


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

    # Auf den Zustand warten statt fester Pausen (C-18): auf dem Runner reichten 500 ms einmal nicht (C-13, #251)
    def bis(bedingung: str, arg=None) -> None:
        try:
            s.wait_for_function(bedingung, arg=arg, timeout=15000)
        except Exception:
            pass  # die Prüfung unten meldet es
    bis("(i) => document.getElementById('ident').textContent === i", ident)
    erg["entsperrt_gleiche_identitaet"] = ev("() => document.getElementById('ident').textContent") == ident
    ev("() => document.querySelector('.app-nav button[data-tab=\"comm\"]').click()")
    daten = ("() => document.getElementById('chat-list').textContent.includes('ProbeChat')"
             " && document.getElementById('agent-history').textContent.includes('ProbeVerlauf')")
    bis(daten)
    erg["daten_aus_tresor"] = ev(daten)

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
    # Weck-Worker (B-12d1): angemeldet wie später der Haken aus B-12d2 – die Löschung meldet ihn ab
    erg["worker_vorher"] = ev("async () => { await navigator.serviceWorker.register('freedom-sw.js?sprache=de');"
                              " return (await navigator.serviceWorker.getRegistrations()).length; }") == 1

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
      const worker = (await navigator.serviceWorker.getRegistrations()).length;
      return { ls, ss, dbs, tresorBlob, worker, ident: document.getElementById('ident').textContent };
    }""")
    muster = [nsec, "ProbeSitzung"] + PROBE_MUSTER
    erg["nichts_uebrig"] = (not any(m in scan["ls"] for m in muster)
                            and not any(k + "=" in scan["ls"] for k in PROBE_GEHEIM)
                            and "freedom.vault=1" not in scan["ls"] and scan["ss"] == ""
                            and set(scan["dbs"]) <= {"freedom-vault"} and scan["tresorBlob"] is None
                            and scan["worker"] == 0)
    erg["leer_neu_gestartet"] = scan["ident"] != ident and not ev("() => !!document.getElementById('tr-pass')")
    if not erg["nichts_uebrig"]:
        erg["fehler"].append(f"Rest: dbs={scan['dbs']} ss={scan['ss']!r} worker={scan['worker']}")
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


def mls_start_pruefen(browser, url: str) -> dict:
    """MLS-Engine mit privatem Raum (C-11): Tresor eingerichtet, ein privater Raum gemerkt – beim Start
    wird trotzdem kein WebAssembly übersetzt, auch nicht beim Öffnen der Kommunikation; erst der private
    Raum (angetippt) bzw. die Seite Repos (Repos privater Räume) lädt die Engine."""
    erg = {"fehler": []}
    basis = url.rsplit("/", 1)[0]
    relay = ProbeRelay()
    ctx = browser.new_context(locale="de-DE", viewport={"width": 1280, "height": 800})
    ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith(basis) else r.abort())
    ctx.route_web_socket(re.compile(r"^wss?://"), relay.verbinde)
    ctx.add_init_script(
        "window.__wasm = 0; for (const k of ['instantiate', 'compile', 'instantiateStreaming', 'compileStreaming']) {"
        " const o = WebAssembly[k]; if (o) WebAssembly[k] = function (...a) { window.__wasm++; return o.apply(this, a); }; }"
        " const M = WebAssembly.Module; WebAssembly.Module = function (...a) { window.__wasm++; return new M(...a); };")
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
    # Ein privater Raum (Gruppen-Kennung) – wandert mit dem Einrichten des Tresors hinein
    ev("() => localStorage.setItem('freedom.raeume.privat', JSON.stringify(['ab'.repeat(16)]))")
    ev("() => { location.hash = '#/settings'; }")
    ev("() => document.querySelector('.sec-action[data-step=\"4\"]').click()")
    ev("() => { document.getElementById('tr-neu1').value = 'smoke tresor mls'; document.getElementById('tr-neu2').value = 'smoke tresor mls';"
       " document.getElementById('tr-ok').click(); }")
    s.wait_for_function("() => !document.getElementById('tr-ok')", timeout=30000)
    erg["im_tresor"] = ev("() => localStorage.getItem('freedom.raeume.privat') === null && localStorage.getItem('freedom.vault') === '1'")

    def neu_starten(seite: str) -> list:
        """Neu laden, entsperren, warten; dann die Seite öffnen (Kommunikation: danach den privaten Raum
        antippen) – Übersetzungen vorher, nach dem Öffnen und am Ende."""
        ev("() => { location.hash = '#/agent'; }")
        s.reload(wait_until="load")
        s.wait_for_function("() => !!document.getElementById('tr-pass')", timeout=30000)
        ev("() => { document.getElementById('tr-pass').value = 'smoke tresor mls'; document.getElementById('tr-ok').click(); }")
        s.wait_for_function("() => !document.getElementById('tr-pass')", timeout=30000)
        s.wait_for_timeout(4000)  # Start, Abgleich, Repos – was beim Start lädt, hätte jetzt geladen
        vorher = ev("() => window.__wasm")
        ev("(t) => { location.hash = t === 'comm' ? '#/chat' : '#/repos'; }", seite)
        s.wait_for_timeout(3000)
        geoeffnet = ev("() => window.__wasm")
        if seite == "comm":
            ev("() => document.querySelector('#space-rail .space-pill')?.click()")
        try:
            s.wait_for_function("() => window.__wasm > 0", timeout=30000)
        except Exception:
            pass
        return [vorher, geoeffnet, ev("() => window.__wasm")]

    erg["kommunikation"] = neu_starten("comm")
    erg["repos"] = neu_starten("repos")
    ctx.close()
    if erg["im_tresor"] is not True:
        erg["fehler"].append("privater Raum nicht im Tresor")
    # Kommunikation: offen noch ohne Engine, erst der private Raum lädt sie; Repos: die Seite lädt sie
    k, r = erg["kommunikation"], erg["repos"]
    if k[0] != 0 or k[1] != 0 or k[2] < 1:
        erg["fehler"].append(f"Kommunikation: Übersetzungen beim Start {k[0]}, offen {k[1]}, Raum angetippt {k[2]}")
    if r[0] != 0 or r[2] < 1:
        erg["fehler"].append(f"Repos: Übersetzungen beim Start {r[0]}, Seite offen {r[2]}")
    erg["bestanden"] = not erg["fehler"]
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
            if not re.fullmatch(r"\d+ von \d+ Relays verbunden", titel):  # seit C-16 verbunden statt im Pool
                erg["fehler"].append(f"desktop: Relay-Stand {titel!r}")
            # C.1b: die verschobenen Inhalte stehen auf ihren neuen Seiten
            inhalte = {}
            # seit C.3a eine Liste mit Suche statt zwei Listen
            for tab, sels in [("repos", ["#repos-karten", "#repos-suche", "#contrib-list"]),
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
            # C.6b: das rechte Feld (Arbeitsbereich, Werkzeuge, Kosten) als eigene Ebene
            klick("#agent-seite-zurueck")
            klick("#agent-zu-details")
            details = [sichtbar("#agent-workspace") and sichtbar("#agent-cost"), not sichtbar(".agent-main"), ev("() => location.hash")]
            klick("#agent-panel-zurueck")
            details.append(sichtbar(".agent-main") and not sichtbar(".agent-panel"))
            erg["mobil"]["agent"] = [verlauf, wieder, modelle, details]
            if verlauf != [True, True, "#/agent/verlauf"] or not wieder or not modelle or details != [True, True, "#/agent/details", True]:
                erg["fehler"].append(f"mobil: Agent {erg['mobil']['agent']}")
            klick('.app-nav button[data-tab="mehr"]')
            mehr = ev("""() => [[...document.querySelectorAll('#page-mehr [data-geh]')].map(b => b.dataset.geh),
              document.getElementById('mehr-relays').textContent]""")
            sprache = sichtbar("#lang-btn-mehr")
            klick('#page-mehr [data-geh="settings"]')
            settings = ev("""() => [document.getElementById('page-settings').classList.contains('active'),
              document.querySelector('.app-nav button[data-tab="mehr"]').classList.contains('active')]""")
            erg["mobil"]["mehr"] = [mehr, sprache, settings]
            if mehr[0] != ["repos", "earn", "netz", "profile", "settings"] or not re.fullmatch(r"\d+ von \d+ Relays verbunden", mehr[1]) or not sprache or settings != [True, True]:
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


# Stand des offenen Dialogs (seit C-1a): Titel, Text, Beschriftungen, Werte, Häkchen, Meldung – null ohne Dialog
DIALOG_STAND = """() => { const d = document.querySelector('[role=dialog][aria-modal=true]');
  return d ? { titel: document.getElementById(d.getAttribute('aria-labelledby'))?.textContent,
    text: d.querySelector('.dlg-text')?.textContent ?? null,
    felder: [...d.querySelectorAll('.dlg-label')].map(l => l.textContent),
    werte: [...d.querySelectorAll('input:not([type=checkbox]):not([type=radio]), textarea')].map(i => i.value),
    haken: [...d.querySelectorAll('input[type=checkbox]')].map(i => i.checked),
    meldung: d.querySelector('[role=alert]')?.textContent || null } : null; }"""


class DialogSeite:
    """Frische App ohne Einrichtung hinter der Relay-Attrappe (seit C-1a, für C-1): zählt Browser-Dialoge
    (`prompt`/`confirm`/`alert` – es darf keinen geben) und bedient die Dialoge aus `shell/dialog.ts`."""

    def __init__(self, browser, url: str, relay: "ProbeRelay", erg: dict, init: str | None = None,
                 viewport: dict | None = None, mobil: bool = False) -> None:
        basis = url.rsplit("/", 1)[0]
        self.browser_dialoge: list[str] = []
        self.ctx = browser.new_context(locale="de-DE", viewport=viewport or {"width": 1280, "height": 800},
                                       is_mobile=mobil, has_touch=mobil)
        if init:
            self.ctx.add_init_script(init)
        self.ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith(basis) else r.abort())
        self.ctx.route_web_socket(re.compile(r"^wss?://"), relay.verbinde)
        s = self.s = self.ctx.new_page()
        s.on("pageerror", lambda e: erg["fehler"].append(str(e)[:300]))
        s.on("dialog", lambda d: (self.browser_dialoge.append(d.type), d.dismiss()))
        self.ev = s.evaluate
        s.goto(url, wait_until="load")
        s.wait_for_selector("#bk-done", timeout=30000)
        w = self.ev("() => [...document.querySelectorAll('.mnemonic-list li')].map(l => l.textContent)")
        self.ev("(w) => document.querySelectorAll('#bk-challenge input').forEach(i => i.value = w[+i.dataset.pos])", w)
        self.ev("() => document.getElementById('bk-done').click()")
        s.wait_for_timeout(1500)
        self.ev("() => document.getElementById('ein-abbrechen')?.click()")

    def stand(self) -> dict | None:
        return self.ev(DIALOG_STAND)

    def warte_dialog(self, titel: str) -> dict:
        self.s.wait_for_function("(t) => { const d = document.querySelector('[role=dialog][aria-modal=true]');"
                                 " return d && document.getElementById(d.getAttribute('aria-labelledby'))?.textContent === t; }",
                                 arg=titel, timeout=10000)
        return self.stand()

    def warte_zu(self) -> None:
        self.s.wait_for_function("() => !document.querySelector('[role=dialog][aria-modal=true]')", timeout=10000)

    def tippe(self, text: str) -> dict | None:
        """Ins erste Feld schreiben und Enter – die Prüfung im Dialog meldet sich sofort."""
        self.ev("(v) => { const i = document.querySelector('[role=dialog] input'); i.value = v; i.focus(); }", text)
        self.s.keyboard.press("Enter")
        self.s.wait_for_timeout(200)
        return self.stand()


def waehrung_pruefen(browser, url: str) -> dict:
    """Währung (C-1a): Tausch über Dialoge statt prompt()/confirm() – Betrag und Adresse prüft der Dialog,
    abgebrochen geht nichts hinaus. Senden (12.7a): Ziel, Betrag, Bestätigung, ohne Wallet ehrlich gescheitert. Empfangen (12.7b): ohne Wallet ein Hinweis. Verlauf (12.7c): leer, Lightning ohne NWC. LP-Angebote aus `scripts/lp-probe.mts` über die Relay-Attrappe."""
    erg = {"fehler": []}
    wurzel = Path(__file__).resolve().parent.parent
    aus = subprocess.run(["npx", "tsx", "scripts/lp-probe.mts"], cwd=wurzel, capture_output=True, text=True, timeout=180, check=True)
    relay = ProbeRelay()
    relay.events = json.loads(aus.stdout)["events"]
    seite = DialogSeite(browser, url, relay, erg)
    s, ev, stand, warte_dialog, tippe = seite.s, seite.ev, DIALOG_STAND, seite.warte_dialog, seite.tippe
    browser_dialoge = seite.browser_dialoge
    ev("() => { location.hash = '#/waehrung'; }")
    s.wait_for_function("() => document.querySelectorAll('#lp-offers button').length === 3", timeout=30000)
    knoepfe = ev("() => [...document.querySelectorAll('#lp-offers .stat')].map(z => [z.querySelector('.k').textContent.split(' · ')[1],"
                 " z.querySelector('button').textContent, z.querySelector('button').disabled])")
    erg["angebote"] = knoepfe
    if sorted(knoepfe) != sorted([["sats → SOL", "tauschen", False], ["sats → SOL", "veraltet", True], ["SOL → sats", "tauschen", False]]):
        erg["fehler"].append(f"Angebote {knoepfe}")

    ev("() => [...document.querySelectorAll('#lp-offers .stat')].find(z => z.textContent.includes('sats → SOL') && !z.querySelector('button').disabled).querySelector('button').click()")
    betrag = warte_dialog("sats gegen SOL tauschen")
    exp = tippe("1e3")  # Number() läse 1000 – der Dialog nimmt nur Ziffern
    tippe("10000")
    # 10 000 sats sind hier 0,01 SOL, ein runder Betrag: erst die Warnung, dann die Adresse
    bevor = warte_dialog("Bevor du tauschst")
    ev("() => [...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent === 'Trotzdem weiter').click()")
    s.wait_for_function("() => document.querySelector('[role=dialog] .dlg-label')?.textContent === 'Deine Solana-Empfangsadresse'", timeout=10000)
    adresse = ev(stand)
    falsch = tippe("keine-adresse")
    s.keyboard.press("Escape")
    s.wait_for_timeout(500)
    zu = ev(stand)
    erg["hin"] = {"betrag": betrag, "exp": exp, "bevor": bevor, "adresse": adresse, "falsch": falsch, "zu": zu}
    if not (betrag["felder"] == ["Betrag in sats"] and exp["meldung"] == "Ungültiger Betrag"):
        erg["fehler"].append(f"Betrag {betrag} {exp}")
    if "Empfohlen:" not in (bevor["text"] or ""):
        erg["fehler"].append(f"Warnung {bevor}")
    if not (adresse["titel"] == "sats gegen SOL tauschen" and adresse["werte"] == [""] and falsch["meldung"] == "Keine gültige Solana-Adresse"):
        erg["fehler"].append(f"Adresse {adresse} {falsch}")
    if zu is not None:
        erg["fehler"].append(f"Esc schließt nicht {zu}")
    # Abgebrochen: keine Anfrage, nichts gemerkt
    erg["gesendet"] = [e["kind"] for e in relay.gesendet if e["kind"] in (1059, 25001, 25002)]
    erg["verlauf"] = ev("() => Object.keys(localStorage).filter(k => k.includes('swapHistory'))")
    if erg["gesendet"] or erg["verlauf"]:
        erg["fehler"].append(f"abgebrochen, aber gesendet/gemerkt: {erg['gesendet']} {erg['verlauf']}")
    # Ohne Internet zahlen (C-1d): Adresse und Betrag prüft der Dialog, Esc bricht ab
    ev("() => document.getElementById('solo-zahlen').click()")
    off = warte_dialog("Ohne Internet zahlen")
    ev("() => { const f = document.querySelectorAll('[role=dialog] input'); f[0].value = 'keine-adresse'; f[1].value = '0,5'; }")
    off_adresse = tippe("keine-adresse")
    ev("() => { const f = document.querySelectorAll('[role=dialog] input'); f[0].value = '11111111111111111111111111111111'; f[1].value = '1e3'; f[1].focus(); }")
    s.keyboard.press("Enter")
    s.wait_for_timeout(200)
    off_betrag = ev(stand)
    s.keyboard.press("Escape")
    seite.warte_zu()
    # Eingebaute Wallet entfernen (C-1d): Gefahr – der Fokus steht zuerst auf Abbrechen
    ev("() => document.getElementById('solw-entfernen').click()")
    entf = warte_dialog("Eingebaute Wallet")
    entf["fokus"] = ev("() => document.activeElement?.textContent")
    s.keyboard.press("Escape")
    seite.warte_zu()
    erg["offline"] = {"dialog": off, "adresse": off_adresse, "betrag": off_betrag, "entfernen": entf}
    if not (off["felder"] == ["An welche Solana-Adresse?", "Wie viel SOL?"] and off_adresse["meldung"] == "Keine gültige Solana-Adresse"
            and off_betrag["meldung"] == "Ungültiger Betrag" and entf["fokus"] == "Abbrechen"):
        erg["fehler"].append(f"offline/entfernen {erg['offline']}")
    # SOL → sats ohne Solana-Wallet: kein Dialog, nur der Hinweis
    ev("() => [...document.querySelectorAll('#lp-offers .stat')].find(z => z.textContent.includes('SOL → sats')).querySelector('button').click()")
    s.wait_for_function("() => document.getElementById('swap-status')?.textContent.startsWith('Erst eine Solana-Wallet')", timeout=10000)
    if ev(stand) is not None:
        erg["fehler"].append("SOL → sats ohne Wallet öffnet einen Dialog")
    # Senden (12.7a): Ziel und Betrag prüft der Dialog, dann die Bestätigung mit ganzem Ziel; ohne Wallet sagt die
    # Schiene es (keine stille Umleitung), nichts geht hinaus
    def zwei(an: str, betrag: str) -> dict | None:
        ev("([a, b]) => { const f = document.querySelectorAll('[role=dialog] input'); f[0].value = a; f[1].value = b; f[1].focus(); }", [an, betrag])
        s.keyboard.press("Enter")
        s.wait_for_timeout(200)
        return ev(stand)
    bolt11 = ("lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27"
              "cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp")
    sol = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtVb"
    ev("() => document.getElementById('wallet-senden').click()")
    sd = {"dialog": warte_dialog("Senden")}
    sd["unbekannt"] = (tippe("hallo") or {}).get("meldung")
    sd["ohne_betrag"] = (zwei("ada@wallet.example", "") or {}).get("meldung")
    sd["widerspruch"] = ((zwei(bolt11, "100") or {}).get("meldung") or "")[:15]
    sd["sol_falsch"] = (zwei(sol, "1e3") or {}).get("meldung")
    zwei(sol, "0,05")
    sd["frage"] = warte_dialog("Senden")["text"]
    ev("() => document.querySelector('[role=dialog] .dlg-knoepfe button:last-child').click()")
    s.wait_for_function("() => (document.querySelector('[role=dialog] .dlg-text')?.textContent ?? '').startsWith('Nicht gesendet')", timeout=10000)
    sd["ergebnis"] = ev(stand)["text"]
    s.keyboard.press("Escape")
    seite.warte_zu()
    erg["senden"] = sd
    if not (sd["dialog"]["felder"] == ["An", "Betrag – sats für Lightning, SOL für Solana; leer, wenn die Rechnung ihn nennt"]
            and (sd["unbekannt"] or "").startswith("Unbekanntes Ziel") and sd["ohne_betrag"] == "Betrag in ganzen sats eintragen"
            and sd["widerspruch"] == "Das Ziel nennt " and sd["sol_falsch"] == "Betrag in SOL eintragen (z. B. 0,05)"
            and sol in (sd["frage"] or "") and "0,05 SOL" in (sd["frage"] or "")
            and "Keine Solana-Wallet verbunden" in (sd["ergebnis"] or "")):
        erg["fehler"].append(f"Senden {sd}")
    if [e["kind"] for e in relay.gesendet if e["kind"] not in (10002, 10050)]:
        erg["fehler"].append("Senden ohne Wallet hat etwas veröffentlicht")
    # Empfangen (12.7b): Lightning braucht einen Betrag und die eigene Wallet (NWC), SOL eine Solana-Wallet –
    # ohne beides ein Hinweis statt einer erfundenen Rechnung oder Adresse
    def empf(art: str, betrag: str) -> dict | None:
        ev("() => document.getElementById('wallet-empfangen').click()")
        warte_dialog("Empfangen")
        ev("([a, b]) => { document.querySelector(`[role=dialog] input[type=radio][value=${a}]`).click();"
           " const f = document.querySelector('[role=dialog] input[type=text]'); f.value = b; f.focus(); }", [art, betrag])
        s.keyboard.press("Enter")
        s.wait_for_timeout(300)
        return ev(stand)
    ed = {"ohne_betrag": (empf("lightning", "") or {}).get("meldung")}
    s.keyboard.press("Escape")
    seite.warte_zu()
    ed["ln"] = ((empf("lightning", "21") or {}).get("text") or "")[:40]
    s.keyboard.press("Escape")
    seite.warte_zu()
    ed["sol"] = ((empf("solana", "") or {}).get("text") or "")[:40]
    s.keyboard.press("Escape")
    seite.warte_zu()
    erg["empfangen"] = ed
    if ed != {"ohne_betrag": "Für eine Rechnung den Betrag in ganzen sats eintragen",
              "ln": "Lightning empfangen braucht eine verbund", "sol": "SOL empfangen braucht eine Solana-Wallet"}:
        erg["fehler"].append(f"Empfangen {ed}")
    # Verlauf (12.7c): leer ohne Zahlungen (nur aus dem Tresor, ohne Netz); die Lightning-Wallet nur auf Klick
    vl = {"leer": ev("() => document.getElementById('verlauf-liste').textContent")}
    ev("() => document.getElementById('verlauf-ln').click()")
    s.wait_for_function("() => document.getElementById('verlauf-ln-liste').textContent !== '…' && document.getElementById('verlauf-ln-liste').textContent !== ''", timeout=10000)
    vl["ln"] = ev("() => document.getElementById('verlauf-ln-liste').textContent")
    erg["verlauf_wallet"] = vl
    if vl != {"leer": "Noch keine Zahlungen. Ist der Tresor gesperrt, erst entsperren.", "ln": "Keine Lightning-Wallet verbunden (NWC)."}:
        erg["fehler"].append(f"Verlauf {vl}")
    # Umzug (C-8): Gebühren und Standard-Schiene unter Währung › Zahlen, Modell vorhalten unter Verdienen › Hosten
    ev("() => document.querySelector('[data-subtab-group=wallet] [data-subtab=pay]').click()")
    s.wait_for_function("() => document.getElementById('anteile-stand')?.textContent === 'Nichts gesammelt.'", timeout=10000)
    umzug = {"reiter": ev("() => [...document.querySelectorAll('[data-subtab-group=wallet] [data-subtab]')].map(b => b.textContent)"),
             "zahlen": ev("() => ['standard-schiene', 'anteile-zahlen'].map(id => !!document.getElementById(id).offsetParent)"),
             "settings": ev("() => [...document.querySelectorAll('[data-subtab-group=settings] [data-subtab]')].map(b => b.dataset.subtab)")}
    # Anzeigeeinheit (12.1): neben der Standard-Schiene; nur sats/SOL wird gemerkt, „automatisch“ entfernt die Wahl
    def einheit(wert: str):
        ev("(v) => { const e = document.getElementById('anzeige-einheit'); e.value = v; e.dispatchEvent(new Event('change')); }", wert)
        return ev("() => localStorage.getItem('freedom.anzeigeEinheit')")
    umzug["einheit"] = [ev("() => document.getElementById('anzeige-einheit').value"), einheit("sol"), einheit("sats"), einheit("")]
    ev("() => { location.hash = '#/verdienen'; }")
    s.wait_for_function("() => !!document.querySelector('[data-subtab-group=earn] [data-subtab=host]')?.offsetParent", timeout=10000)
    ev("() => document.querySelector('[data-subtab-group=earn] [data-subtab=host]').click()")
    umzug["hosten"] = ev("() => ['models-seed', 'models-publish'].map(id => document.getElementById(id).offsetParent?.closest('.subpane')?.dataset.subpane)")
    # Eigener Knoten (C-24): der Befehl aus providerBefehl() in Earn › Hosten, kopierbar
    ev("() => document.getElementById('knoten-befehl-kopieren').click()")
    s.wait_for_function("() => (document.getElementById('toast')?.textContent ?? '') === 'Befehl kopiert'", timeout=5000)
    umzug["knoten"] = ev("() => { const e = document.getElementById('knoten-befehl'); return [e.value, e.offsetParent?.closest('.subpane')?.dataset.subpane, e.readOnly]; }")
    ev("() => document.getElementById('models-seed').click()")
    umzug["vorhalten"] = warte_dialog("Modell vorhalten")
    s.keyboard.press("Escape")
    seite.warte_zu()
    erg["umzug"] = umzug
    if not (umzug["reiter"] == ["Übersicht", "Tauschen", "Hinterlegen", "Zahlen"] and umzug["zahlen"] == [True, True]
            and "fees" not in umzug["settings"] and umzug["hosten"] == ["earn:host", "earn:host"]
            and umzug["knoten"] == ["bash <(curl -fsSL https://3dagi.github.io/freedom-app/install.sh)", "earn:host", True] and umzug["einheit"] == ["", "sol", "sats", None]
            and umzug["vorhalten"]["felder"] == ["Welches Modell hältst du vor?", "Welche Dateien? (kommagetrennt, leer = alle)"]):
        erg["fehler"].append(f"Umzug {umzug}")
    erg["browser_dialoge"] = browser_dialoge
    if browser_dialoge:
        erg["fehler"].append(f"Browser-Dialoge: {browser_dialoge}")
    seite.ctx.close()
    erg["bestanden"] = not erg["fehler"]
    return erg


def kontakt_pruefen(browser, url: str) -> dict:
    """Kommunikation (C-1b): neue Unterhaltung und eigener Name über Dialoge statt prompt()/confirm() –
    der Schlüssel wird im Dialog geprüft, ein Name geht nur mit Häkchen hinaus (Kind 38062)."""
    erg = {"fehler": []}
    relay = ProbeRelay()
    seite = DialogSeite(browser, url, relay, erg)
    ev = seite.ev
    ev("() => { location.hash = '#/chat'; }")
    seite.s.wait_for_selector("#chat-new-dm", timeout=30000)
    ev("() => document.getElementById('chat-new-dm').click()")
    neu = seite.warte_dialog("Neue Nachricht")
    npub = seite.tippe("npub1falsch")
    kurz = seite.tippe("abc")
    pk = "ab" * 32
    seite.tippe("nostr:" + "AB" * 32)  # Großbuchstaben und „nostr:“ davor (QR-Codes anderer Apps) gehen
    seite.warte_zu()
    seite.s.wait_for_function("(pk) => !!document.querySelector(`#chat-list [data-cid='${pk}']`)", arg=pk, timeout=10000)
    erg["neu"] = {"dialog": neu, "npub": npub, "kurz": kurz}
    if not (neu["felder"] == ["Schlüssel des Kontakts (npub oder hex)"] and npub["meldung"] == "Das ist kein gültiger npub."
            and kurz["meldung"] == "Bitte einen npub oder einen 64-stelligen Hex-Schlüssel eingeben."):
        erg["fehler"].append(f"neue Unterhaltung {erg['neu']}")
    rechts = "(pk) => document.querySelector(`#chat-list [data-cid='${pk}']`).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))"
    label = "(pk) => document.querySelector(`#chat-list [data-cid='${pk}'] .label`)?.textContent"

    def namen() -> list[dict]:
        # Der Pool sendet an jedes Relay – die Attrappe sieht dasselbe Event je Verbindung einmal
        return list({e["id"]: e for e in relay.gesendet if e.get("kind") == 38062}.values())

    ev(rechts, pk)
    name = seite.warte_dialog("Eigener Name")
    seite.tippe("Ada")
    seite.warte_zu()
    seite.s.wait_for_function(f"(pk) => ({label})(pk) === 'Ada'", arg=pk, timeout=10000)
    seite.s.wait_for_timeout(1000)
    ohne_haken = len(namen())
    ev(rechts, pk)
    zweit = seite.warte_dialog("Eigener Name")
    ev("() => { document.querySelector('[role=dialog] input[type=checkbox]').click(); }")
    seite.tippe("Ada Lovelace")
    seite.warte_zu()
    for _ in range(50):
        if namen():
            break
        seite.s.wait_for_timeout(200)
    erg["name"] = {"dialog": name, "zweit": zweit, "ohne_haken": ohne_haken, "mit_haken": len(namen()),
                   "label": ev(label, pk)}
    if not (name["felder"][0].startswith("Eigener Name für ") and name["felder"][1:] == ["Sichtbarkeit"]
            and name["haken"] == [False] and name["werte"] == [""] and zweit["werte"] == ["Ada"]):
        erg["fehler"].append(f"Namensdialog {name} {zweit}")
    if ohne_haken != 0:
        erg["fehler"].append(f"ohne Häkchen veröffentlicht: {ohne_haken}")
    gesendet = namen()
    if len(gesendet) != 1 or "Ada Lovelace" not in json.dumps(gesendet[0]):
        erg["fehler"].append(f"mit Häkchen: {gesendet}")
    if erg["name"]["label"] != "Ada Lovelace":
        erg["fehler"].append(f"Name in der Liste: {erg['name']['label']}")
    erg["browser_dialoge"] = seite.browser_dialoge
    if seite.browser_dialoge:
        erg["fehler"].append(f"Browser-Dialoge: {seite.browser_dialoge}")
    seite.ctx.close()
    erg["bestanden"] = not erg["fehler"]
    return erg


# Mikrofon-Attrappe (seit C-7): ein Ton aus dem Oszillator statt eines Geräts. Sie zählt, wie oft die App das
# Mikrofon anfragt, und merkt sich jede Spur – gestoppt heißt `readyState === "ended"`.
MIKROFON_ATTRAPPE = """
(() => {
  const st = window.__mikro = { fragen: 0, spuren: [] };
  if (!navigator.mediaDevices) return;
  navigator.mediaDevices.getUserMedia = async (c) => {
    st.fragen++;
    if (!c || !c.audio || c.video) throw new DOMException('nur Ton', 'NotAllowedError');
    const ctx = new AudioContext();
    await ctx.resume();
    const osz = ctx.createOscillator();
    const ziel = ctx.createMediaStreamDestination();
    osz.connect(ziel);
    osz.start();
    for (const s of ziel.stream.getTracks()) st.spuren.push(s);
    return ziel.stream;
  };
  // Keine Verzögerung beim Senden (6.4) – sonst wartet der Test bis zu 30 s auf die Umschläge
  localStorage.setItem('freedom.versand.verzoegerung', '0');
})();
"""


COMPOSER_MESSEN = """() => {
  const c = document.querySelector('#page-comm .comm-dm .chat-composer') ?? document.querySelector('#page-comm .chat-composer'); const rc = c.getBoundingClientRect();
  const masse = (sel) => { const e = document.querySelector(sel); const b = e.getBoundingClientRect();
    return { links: Math.round(b.left), rechts: Math.round(b.right), breite: Math.round(b.width), hoehe: Math.round(b.height),
      sichtbar: !e.hidden && b.width > 0 && b.height > 0 }; };
  const teile = [...c.children].filter(e => !e.hidden && e.getBoundingClientRect().width > 0);
  const draussen = teile.filter(e => { const b = e.getBoundingClientRect();
    return b.left < rc.left - 1 || b.right > rc.right + 1 || b.right > innerWidth + 1 || b.bottom > innerHeight + 1; })
    .map(e => e.id || e.tagName.toLowerCase());
  const klein = teile.filter(e => { const b = e.getBoundingClientRect(); return b.width < 39.5 || b.height < 39.5; })
    .map(e => (e.id || e.tagName.toLowerCase()) + ' ' + Math.round(e.getBoundingClientRect().width) + '×' + Math.round(e.getBoundingClientRect().height));
  const m = document.querySelector('main');
  return { laufleiste: document.documentElement.scrollWidth - innerWidth, main: m.scrollWidth - m.clientWidth,
    feld: masse('#chat-input'), ablauf: masse('#chat-ablauf'), senden: masse('#chat-send'), draussen, klein };
}"""


def composer_pruefen(browser, url: str) -> dict:
    """Eingabe einer offenen Unterhaltung (C-28, Nutzertest C-1/C-13): Die Ablauf-Auswahl erbte `width: 100%`
    und ließ sich nicht schrumpfen – das Textfeld wurde 22 px schmal, `main` lief über, am Handy lag „Senden“
    außerhalb. Gemessen mit offener Direktnachricht (dann ist die Auswahl da) auf Desktop, Handy hoch und quer:
    keine Laufleiste, nichts außerhalb, das Feld breit genug, am Handy jede Fläche mindestens 40 px."""
    erg = {"fehler": []}
    pk = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"  # ein gültiger Punkt (x von G) – geht nur an die Attrappe
    for lage, vp, mobil, mindestens in [("desktop", {"width": 1280, "height": 800}, False, 300),
                                        ("hoch", {"width": 390, "height": 844}, True, 200),
                                        ("quer", {"width": 844, "height": 390}, True, 200)]:
        seite = DialogSeite(browser, url, ProbeRelay(), erg, viewport=vp, mobil=mobil)
        s, ev = seite.s, seite.ev
        ev("() => { location.hash = '#/chat'; }")
        s.wait_for_selector("#chat-new-dm", timeout=30000)
        ev("() => document.getElementById('chat-new-dm').click()")
        seite.warte_dialog("Neue Nachricht")
        seite.tippe(pk)
        seite.warte_zu()
        s.wait_for_function("(pk) => !!document.querySelector(`#chat-list .chat-item.active[data-cid='${pk}']`)", arg=pk, timeout=10000)
        s.wait_for_timeout(300)
        m = ev(COMPOSER_MESSEN)
        erg[lage] = m
        if m["laufleiste"] > 0 or m["main"] > 0 or m["draussen"] or not m["ablauf"]["sichtbar"] or not m["senden"]["sichtbar"] \
                or m["feld"]["breite"] < mindestens or (mobil and m["klein"]):
            erg["fehler"].append(f"{lage}: {m}")
        if seite.browser_dialoge:
            erg["fehler"].append(f"{lage}: Browser-Dialoge {seite.browser_dialoge}")
        seite.ctx.close()
    erg["bestanden"] = not erg["fehler"]
    return erg


def anhang_senden_pruefen(browser, url: str) -> dict:
    """Senden während eines Uploads (C-29, Nutzertest C-7): Vorher ging der Text ohne Anhang hinaus, und der
    Anhang hing an der nächsten Nachricht. Jetzt wartet Senden – Knopf gesperrt, Feld nur lesbar, ein Hinweis –
    und schickt dann Text und Anhang zusammen in einer Nachricht."""
    erg = {"fehler": []}
    relay = ProbeRelay()
    seite = DialogSeite(browser, url, relay, erg, init="localStorage.setItem('freedom.versand.verzoegerung', '0');")
    s, ev = seite.s, seite.ev
    ev("() => { location.hash = '#/chat'; }")
    s.wait_for_selector("#chat-new-dm", timeout=30000)
    ev("() => document.getElementById('chat-new-dm').click()")
    seite.warte_dialog("Neue Nachricht")
    pk = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"  # ein gültiger Punkt (x von G) – geht nur an die Attrappe
    seite.tippe(pk)
    seite.warte_zu()
    s.wait_for_function("(pk) => !!document.querySelector(`#chat-list .chat-item.active[data-cid='${pk}']`)", arg=pk, timeout=10000)
    s.fill("#chat-input", "mit Anhang")
    # 40 KB – über der Grenze für inline, also ein Upload ins Blob-Netz (hier an die Attrappe)
    s.set_input_files("#chat-file-input", files=[{"name": "gross.bin", "mimeType": "application/octet-stream",
                                                  "buffer": bytes(range(256)) * 160}])
    erg["beim_senden"] = ev("""() => { document.getElementById('chat-send').click();
      const k = document.getElementById('chat-send'), f = document.getElementById('chat-input');
      return { gesperrt: k.disabled, busy: k.getAttribute('aria-busy'), nurLesen: f.readOnly,
        hinweis: document.getElementById('chat-attach-list').textContent }; }""")
    s.wait_for_function("() => !!document.querySelector('#chat-thread .chat-blob-btn')", timeout=30000)
    erg["danach"] = ev("""() => { const k = document.getElementById('chat-send'), f = document.getElementById('chat-input');
      const blasen = [...document.querySelectorAll('#chat-thread .bubble')];
      const mit = blasen.filter(b => b.textContent.includes('mit Anhang'));
      return { gesperrt: k.disabled, nurLesen: f.readOnly, feld: f.value, liste: document.getElementById('chat-attach-list').textContent,
        nachrichten: mit.length, anhangInDerselben: mit.some(b => !!b.querySelector('.chat-blob-btn')) }; }""")
    b, d = erg["beim_senden"], erg["danach"]
    if not (b["gesperrt"] and b["busy"] == "true" and b["nurLesen"] and "sobald der Anhang" in b["hinweis"]):
        erg["fehler"].append(f"beim Senden: {b}")
    if d["gesperrt"] or d["nurLesen"] or d["feld"] or d["liste"] or d["nachrichten"] != 1 or not d["anhangInDerselben"]:
        erg["fehler"].append(f"danach: {d}")
    if seite.browser_dialoge:
        erg["fehler"].append(f"Browser-Dialoge {seite.browser_dialoge}")
    seite.ctx.close()
    erg["bestanden"] = not erg["fehler"]
    return erg


def sprachnachricht_pruefen(browser, url: str) -> dict:
    """Sprachnachrichten (C-7): Mikrofon erst auf Klick, nach dem Beenden und Verwerfen aus; die Aufnahme ist ein
    Anhang, reist klein in der verschlüsselten Nachricht und spielt im eigenen Verlauf."""
    erg = {"fehler": []}
    relay = ProbeRelay()
    seite = DialogSeite(browser, url, relay, erg, init=MIKROFON_ATTRAPPE)
    s, ev = seite.s, seite.ev
    mikro = "() => [window.__mikro.fragen, window.__mikro.spuren.length, window.__mikro.spuren.every(t => t.readyState === 'ended')]"
    ev("() => { location.hash = '#/chat'; }")
    s.wait_for_selector("#chat-new-dm", timeout=30000)
    ev("() => document.getElementById('chat-new-dm').click()")
    seite.warte_dialog("Neue Nachricht")
    pk = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"  # ein gültiger Punkt (x von G) – geht nur an die Attrappe
    seite.tippe(pk)
    seite.warte_zu()
    s.wait_for_function("(pk) => !!document.querySelector(`#chat-list .chat-item.active[data-cid='${pk}']`)", arg=pk, timeout=10000)
    erg["vorher"] = ev(mikro)
    knopf = "#chat-voice-btn"
    erg["knopf"] = ev(f"() => [document.querySelector('{knopf}').getAttribute('aria-label'), document.querySelector('{knopf}').getAttribute('aria-pressed'),"
                      " document.getElementById('chat-voice-status').hidden]")
    # Aufnehmen – ein echter Klick, damit der Browser das Abspielen erlaubt
    s.click(knopf)
    s.wait_for_function(f"() => document.querySelector('{knopf}').getAttribute('aria-pressed') === 'true'", timeout=10000)
    s.wait_for_function("() => /0:01 von 2:00/.test(document.getElementById('chat-voice-status').textContent)", timeout=10000)
    erg["laeuft"] = ev(f"() => [document.querySelector('{knopf}').getAttribute('aria-label'), document.getElementById('chat-voice-status').textContent]") + [ev(mikro)]
    s.click(knopf)
    s.wait_for_function("() => /sprachnachricht\\.webm/.test(document.getElementById('chat-attach-list').textContent)", timeout=15000)
    erg["beendet"] = {"mikro": ev(mikro), "liste": ev("() => document.getElementById('chat-attach-list').textContent"),
                      "knopf": ev(f"() => [document.querySelector('{knopf}').getAttribute('aria-pressed'), document.getElementById('chat-voice-status').hidden]")}
    # Eine zweite Aufnahme verwerfen: Mikrofon aus, nichts kommt dazu
    s.click(knopf)
    s.wait_for_function(f"() => document.querySelector('{knopf}').getAttribute('aria-pressed') === 'true'", timeout=10000)
    s.click("#chat-voice-status button")
    s.wait_for_function(f"() => document.querySelector('{knopf}').getAttribute('aria-pressed') === 'false'", timeout=10000)
    erg["verworfen"] = {"mikro": ev(mikro), "liste": ev("() => document.getElementById('chat-attach-list').textContent")}
    # Senden: im eigenen Verlauf ein Abspieler mit data:audio, hinaus nur Umschläge (1059)
    s.click("#chat-send")
    s.wait_for_function("() => (document.querySelector('#chat-thread audio')?.src ?? '').startsWith('data:audio/webm')", timeout=15000)
    erg["verlauf"] = ev("() => [document.querySelectorAll('#chat-thread audio').length, document.querySelector('#chat-thread audio').controls]")

    def umschlaege() -> list[dict]:
        return list({e["id"]: e for e in relay.gesendet if e.get("kind") == 1059}.values())
    for _ in range(100):
        if len(umschlaege()) >= 2:
            break
        s.wait_for_timeout(200)
    gesendet = umschlaege()
    # Nur lange Folgen suchen – kurze stehen im Base64 des Chiffrats gelegentlich zufällig (Fallstrick seit B-13a)
    erg["gesendet"] = {"umschlaege": len(gesendet), "klartext": any("audio/webm" in json.dumps(e) or "sprachnachricht.webm" in json.dumps(e) for e in relay.gesendet)}
    if erg["vorher"] != [0, 0, True]:
        erg["fehler"].append(f"Mikrofon vor dem Klick: {erg['vorher']}")
    if erg["knopf"] != ["Sprachnachricht aufnehmen", "false", True]:
        erg["fehler"].append(f"Knopf {erg['knopf']}")
    if not (erg["laeuft"][0] == "Aufnahme beenden" and erg["laeuft"][1].startswith("● Aufnahme 0:01 von 2:00") and erg["laeuft"][2][:2] == [1, 1]
            and erg["laeuft"][2][2] is False):
        erg["fehler"].append(f"Aufnahme {erg['laeuft']}")
    if not (erg["beendet"]["mikro"] == [1, 1, True] and erg["beendet"]["knopf"] == ["false", True]):
        erg["fehler"].append(f"beendet {erg['beendet']}")
    if not (erg["verworfen"]["mikro"] == [2, 2, True] and erg["verworfen"]["liste"] == erg["beendet"]["liste"]):
        erg["fehler"].append(f"verworfen {erg['verworfen']}")
    if erg["verlauf"] != [1, True] or erg["gesendet"]["umschlaege"] < 2 or erg["gesendet"]["klartext"]:
        erg["fehler"].append(f"gesendet {erg['verlauf']} {erg['gesendet']}")
    erg["browser_dialoge"] = seite.browser_dialoge
    if seite.browser_dialoge:
        erg["fehler"].append(f"Browser-Dialoge: {seite.browser_dialoge}")
    seite.ctx.close()
    erg["bestanden"] = not erg["fehler"]
    return erg


# Anrufe (seit B-13d3): zählt Fragen nach dem Mikrofon und neue Verbindungen – ohne Annehmen darf es keine geben
ANRUF_ZAEHLER = """
(() => {
  const st = window.__anruf = { medien: 0, verbindungen: 0 };
  if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { st.medien++; throw new DOMException('nein', 'NotAllowedError'); };
  const Echt = window.RTCPeerConnection;
  if (Echt) window.RTCPeerConnection = function (...a) { st.verbindungen++; return new Echt(...a); };
})();
"""


def anruf_pruefen(browser, url: str) -> dict:
    """Anrufe (B-13d3): Knöpfe im Kopf der Unterhaltung; ohne eigenen Knoten geht kein Anruf hinaus (kein Mikrofon,
    keine Verbindung, kein Umschlag). Ein Angebot eines Kontakts (`scripts/anruf-probe.mts`, mit Zugang zum
    Vermittler des Anrufers – T3 B) klingelt mit Sicherheitscode und dem Hinweis, wer die IP sieht; Ablehnen schickt
    nur ein versiegeltes „Ende“ zurück – ohne Mikrofon und ohne Verbindung. Seit B-13e (T4 A) kommt das Angebot
    über das Abo für Anrufe – es klingelt sofort, ohne den Abgleich des Posteingangs."""
    erg = {"fehler": []}
    wurzel = Path(__file__).resolve().parent.parent
    relay = ProbeRelay()
    seite = DialogSeite(browser, url, relay, erg, init=ANRUF_ZAEHLER)
    s, ev = seite.s, seite.ev
    ev("() => { location.hash = '#/chat'; }")
    for _ in range(80):
        if relay.ich:
            break
        s.wait_for_timeout(250)
    if not relay.ich:
        seite.ctx.close()
        return {"bestanden": False, "fehler": ["keine Abfrage der eigenen Relay-Listen – eigener Schlüssel unbekannt"]}
    aus = subprocess.run(["npx", "tsx", "scripts/anruf-probe.mts", relay.ich], cwd=wurzel, capture_output=True, text=True, timeout=180, check=True)
    probe = json.loads(aus.stdout)
    anrufer = probe["anrufer"]

    def an_anrufer() -> list[dict]:
        return list({e["id"]: e for e in relay.gesendet if e.get("kind") == 1059 and ["p", anrufer] in [t[:2] for t in e.get("tags", [])]}.values())
    # Der Anrufer wird Kontakt: eine Unterhaltung über „Neue Nachricht“
    s.wait_for_selector("#chat-new-dm", timeout=30000)
    ev("() => document.getElementById('chat-new-dm').click()")
    seite.warte_dialog("Neue Nachricht")
    seite.tippe(anrufer)
    seite.warte_zu()
    s.wait_for_function("(pk) => !!document.querySelector(`#chat-list .chat-item.active[data-cid='${pk}']`)", arg=anrufer, timeout=10000)
    erg["knoepfe"] = ev("() => ['chat-anruf', 'chat-video'].map(id => { const b = document.getElementById(id);"
                        " return [b.getAttribute('aria-label'), b.title.split(' – ')[0], !!b.querySelector('svg')]; })")
    # Anrufen ohne eigenen Knoten: nur der Hinweis – kein Mikrofon, keine Verbindung, nichts hinaus
    s.click("#chat-anruf")
    s.wait_for_function("() => /eigenen Knoten mit Vermittler/.test(document.getElementById('toast')?.textContent ?? '')", timeout=10000)
    erg["ohne_knoten"] = ev("() => [window.__anruf.medien, window.__anruf.verbindungen, !!document.querySelector('.anruf-leiste')]") + [len(an_anrufer())]
    # B-13e: Eine eben erzeugte Identität gibt es erst nach dem Start – nach dem Neuladen steht das Abo gleich.
    # Das Angebot liegt auf keinem Relay: Es kommt nur über das Abo, nicht über den Abgleich des Posteingangs.
    s.reload(wait_until="load")
    ev("() => { location.hash = '#/chat'; }")

    def anruf_abos() -> int:
        return sum(1 for _, fs in relay.abos.values() for f in fs
                   if f.get("kinds") == [1059] and f.get("#p") == [relay.ich] and "since" in f and "limit" not in f)
    for _ in range(80):
        if anruf_abos():
            break
        s.wait_for_timeout(250)
    erg["abo"] = anruf_abos()
    beginn = datetime.datetime.now()
    erg["zugestellt"] = relay.zustellen(probe["events"][0])
    s.wait_for_function("() => document.querySelectorAll('.anruf-leiste .anruf-knoepfe button').length === 2", timeout=15000)
    erg["klingelt_nach_s"] = round((datetime.datetime.now() - beginn).total_seconds(), 1)
    erg["klingelt"] = ev("""() => { const l = document.querySelector('.anruf-leiste');
      return { rolle: [l.getAttribute('role'), l.getAttribute('aria-label'), l.getAttribute('aria-live')],
        titel: l.querySelector('.anruf-titel').textContent, code: l.querySelector('div.mono-sm')?.textContent ?? '',
        hinweis: l.querySelector('p.warn')?.textContent ?? '', medien: l.querySelectorAll('audio, video').length,
        knoepfe: [...l.querySelectorAll('.anruf-knoepfe button')].map(b => [b.textContent, b.disabled]),
        zaehler: [window.__anruf.medien, window.__anruf.verbindungen] }; }""")
    vorher = len(an_anrufer())
    s.click(".anruf-leiste .anruf-knoepfe button:nth-child(2)")
    for _ in range(100):
        if len(an_anrufer()) > vorher:
            break
        s.wait_for_timeout(200)
    neu = an_anrufer()[vorher:]
    geoeffnet = [json.loads(subprocess.run(["npx", "tsx", "scripts/anruf-probe.mts", "oeffne", probe["sk"]], cwd=wurzel, input=json.dumps(w),
                                           capture_output=True, text=True, timeout=180, check=True).stdout) for w in neu]
    s.wait_for_function("() => document.querySelector('.anruf-leiste .anruf-titel')?.textContent === 'Abgelehnt'", timeout=10000)
    erg["abgelehnt"] = {"nachrichten": [g and g["nachricht"] for g in geoeffnet],
                        "zaehler": ev("() => [window.__anruf.medien, window.__anruf.verbindungen]"),
                        "knoepfe": ev("() => [...document.querySelectorAll('.anruf-leiste button')].map(b => b.textContent)")}
    ev("() => document.querySelector('.anruf-leiste button').click()")
    s.wait_for_function("() => !document.querySelector('.anruf-leiste')", timeout=5000)
    if erg["knoepfe"] != [["Anrufen", "Anrufen", True], ["Videoanruf", "Videoanruf", True]]:
        erg["fehler"].append(f"Knöpfe {erg['knoepfe']}")
    if erg["ohne_knoten"] != [0, 0, False, 0]:
        erg["fehler"].append(f"ohne Knoten {erg['ohne_knoten']}")
    if erg["abo"] < 1 or erg["zugestellt"] < 1:
        erg["fehler"].append(f"Abo für Anrufe: {erg['abo']} offen, {erg['zugestellt']} zugestellt")
    k = erg["klingelt"]
    if not (k["rolle"] == ["region", "Anruf", "polite"] and k["titel"].endswith(" ruft an") and k["code"].startswith("Sicherheitscode: ")
            and k["code"].endswith("nicht geprüft") and "Knoten der anrufenden Person – er sieht deine IP-Adresse" in k["hinweis"]
            and k["knoepfe"] == [["Annehmen", False], ["Ablehnen", False]] and k["medien"] == 0 and k["zaehler"] == [0, 0]):
        erg["fehler"].append(f"klingelt {k}")
    if erg["abgelehnt"] != {"nachrichten": [{"anruf": probe["kennung"], "typ": "ende", "grund": "abgelehnt"}], "zaehler": [0, 0], "knoepfe": ["Schließen"]}:
        erg["fehler"].append(f"abgelehnt {erg['abgelehnt']}")
    erg["browser_dialoge"] = seite.browser_dialoge
    if seite.browser_dialoge:
        erg["fehler"].append(f"Browser-Dialoge: {seite.browser_dialoge}")
    seite.ctx.close()
    erg["bestanden"] = not erg["fehler"]
    return erg


def tresor_an(seite: "DialogSeite", passphrase: str) -> None:
    """Tresor einrichten (Settings › Sicherheit, Schritt 5) – MLS gibt es nur mit Tresor (2.2b-e1)."""
    ev = seite.ev
    ev("() => { location.hash = '#/settings'; }")
    seite.s.wait_for_selector('.sec-action[data-step="4"]', state="attached", timeout=15000)
    ev("() => document.querySelector('.sec-action[data-step=\"4\"]').click()")
    seite.s.wait_for_selector("#tr-neu1", timeout=10000)
    ev("(p) => { document.getElementById('tr-neu1').value = p; document.getElementById('tr-neu2').value = p;"
       " document.getElementById('tr-ok').click(); }", passphrase)
    seite.s.wait_for_function("() => !document.getElementById('tr-ok')", timeout=30000)


def entsperre_neu(seite: "DialogSeite", passphrase: str) -> None:
    """Neu laden und den Tresor entsperren – wie ein neuer Start der App: der Posteingang wird sofort abgeglichen."""
    seite.s.reload(wait_until="load")
    seite.s.wait_for_function("() => !!document.getElementById('tr-pass')", timeout=30000)
    seite.ev("(p) => { document.getElementById('tr-pass').value = p; document.getElementById('tr-ok').click(); }", passphrase)
    seite.s.wait_for_function("() => !document.getElementById('tr-pass')", timeout=30000)


def dialog_ok(seite: "DialogSeite", text: str) -> None:
    """Den Knopf mit diesem Text im offenen Dialog drücken (Wahlfelder schicken mit Enter nicht ab)."""
    seite.ev("(t) => [...document.querySelectorAll('[role=dialog][aria-modal=true] button')].find(b => b.textContent === t).click()", text)


def privatraum_moderation(ada: "DialogSeite", bo: "DialogSeite", relay: "ProbeRelay", pk_bo: str, pille: str, gruss: str, antwort: str, erg: dict) -> None:
    """C-12b: Bo meldet Adas Nachricht – versiegelt nur an die Moderatorin, nie in die Gruppe; Ada sieht die Meldung nach
    dem nächsten Start. Ada löscht Bos Antwort für alle (4891 in der Gruppe), bei Bo ist sie danach weg."""
    zeile = "(t) => [...document.querySelectorAll('#channel-thread .msg-zeile')].find(z => z.querySelector('.msg-text')?.textContent === t)"
    vorher = len([e for e in relay.events if e.get("kind") == 1059])
    bo.ev(f"(t) => ({zeile})(t).querySelector('button.raum-aktion').click()", gruss)
    melden = bo.warte_dialog("Nachricht melden")
    dialog_ok(bo, "melden")
    bo.warte_zu()
    umschlaege = []
    for _ in range(150):
        umschlaege = [e for e in relay.events if e.get("kind") == 1059][vorher:]
        if umschlaege:
            break
        bo.s.wait_for_timeout(200)
    an = sorted({t[1] for e in umschlaege for t in e.get("tags", []) if t[0] == "p"})
    # Ada startet neu: der Posteingang bringt die Meldung (nur im Speicher), der Raum zeigt sie
    entsperre_neu(ada, "ada tresor 1")
    ada.ev("() => { location.hash = '#/chat'; }")
    ada.s.wait_for_function(f"() => !!document.querySelector(\"{pille}\")", timeout=30000)
    ada.ev(f"() => document.querySelector(\"{pille}\").click()")
    try:
        ada.s.wait_for_function("() => !document.getElementById('raum-meldungen')?.classList.contains('hidden')", timeout=60000)
        gesehen = ada.ev("() => document.getElementById('raum-meldungen').textContent")
    except Exception:
        gesehen = None
    # Die Moderatorin sieht, wer was über wen meldet (gekürzte Schlüssel), und die Maßnahmen
    soll = f"Meldung von {pk_bo[:8]}…{pk_bo[-4:]} über {relay.ich[:8]}…{relay.ich[-4:]} · Spam"
    erg["meldung"] = {"dialog": melden["titel"] if melden else None, "an": an, "gesehen": bool(gesehen and gesehen.startswith(soll))}
    if not (erg["meldung"]["dialog"] == "Nachricht melden" and an == [relay.ich] and erg["meldung"]["gesehen"]):
        erg["fehler"].append(f"Meldung {erg['meldung']} {gesehen}")
    # Ada löscht Bos Antwort für alle
    ada.s.wait_for_function("() => !!document.querySelector('#channel-thread .thread-link')", timeout=30000)
    ada.ev("() => document.querySelector('#channel-thread .thread-link').click()")
    ada.s.wait_for_function("(t) => document.getElementById('thread-verlauf')?.textContent.includes(t)", arg=antwort, timeout=10000)
    ada.ev("(t) => [...document.querySelectorAll('#thread-verlauf .msg-zeile')].find(z => z.querySelector('.msg-text')?.textContent === t)"
           ".querySelector('button.raum-aktion').click()", antwort)
    mod = ada.warte_dialog("Nachricht moderieren")
    dialog_ok(ada, "moderieren")
    ada.warte_zu()
    ada.s.wait_for_function("() => !document.querySelector('#channel-thread .thread-link')", timeout=30000)
    bo.ev(f"() => document.querySelector(\"{pille}\").click()")
    try:
        bo.s.wait_for_function("() => !document.querySelector('#channel-thread .thread-link')", timeout=60000)
        weg = True
    except Exception:
        weg = False
    erg["moderation"] = {"dialog": mod["titel"] if mod else None, "bei_bo_weg": weg,
                         "bo_liest_noch": bo.ev("(t) => document.getElementById('channel-thread').textContent.includes(t)", gruss)}
    if erg["moderation"] != {"dialog": "Nachricht moderieren", "bei_bo_weg": True, "bo_liest_noch": True}:
        erg["fehler"].append(f"Moderation {erg['moderation']}")


def privatraum_repo(ada: "DialogSeite", bo: "DialogSeite", relay: "ProbeRelay", pille: str, repo_id: str, betreff: str, erg: dict) -> None:
    """C-12b: Ada legt im privaten Raum ein Repo an (nur in der Gruppe), Bo sieht es dort und schickt einen Patch,
    Ada sieht den Patch – alles als innere Events, auf dem Relay nur Chiffrat."""
    ada.s.wait_for_function("() => document.getElementById('space-repo-neu')?.classList.contains('hidden') === false", timeout=30000)
    ada.ev("() => document.getElementById('space-repo-neu').click()")
    ada.warte_dialog("Repo ankündigen")
    ada.tippe(repo_id)
    # Die Rückfrage trägt denselben Titel – auf ihren Text warten
    ada.s.wait_for_function("() => /im privaten Raum anlegen\\?/.test(document.querySelector('[role=dialog] .dlg-text')?.textContent ?? '')", timeout=10000)
    frage = ada.stand()
    dialog_ok(ada, "Repo ankündigen")
    ada.warte_zu()
    liste = "() => [...document.querySelectorAll('#raum-repos .raum-repo')].map(b => b.textContent)"
    try:
        ada.s.wait_for_function(f"() => ({liste})().includes('{repo_id}')", timeout=30000)
    except Exception:
        pass
    bo.ev(f"() => document.querySelector(\"{pille}\").click()")
    try:
        bo.s.wait_for_function(f"() => ({liste})().includes('{repo_id}')", timeout=60000)
    except Exception:
        pass
    erg["repo"] = {"frage": (frage or {}).get("text"), "ada": ada.ev(liste), "bo": bo.ev(liste)}
    if not (erg["repo"]["ada"] == [repo_id] and erg["repo"]["bo"] == [repo_id]):
        erg["fehler"].append(f"Repo im privaten Raum {erg['repo']}")
        return
    # Bo schickt einen Patch an das Repo des Raums
    patch = (f"From {'c' * 40} Mon Sep 17 00:00:00 2001\nFrom: Bo <bo@example.org>\nSubject: [PATCH] {betreff}\n\n"
             "Erste Zeile.\n---\ndiff --git a/LIESMICH b/LIESMICH\nnew file mode 100644\n--- /dev/null\n+++ b/LIESMICH\n"
             "@@ -0,0 +1 @@\n+# Raum\n-- \n2.43.0\n")
    bo.ev(f"() => [...document.querySelectorAll('#raum-repos .raum-repo')].find(b => b.textContent === '{repo_id}').click()")
    bo.s.wait_for_selector("#repo-seite [data-reiter=patches]", timeout=30000)
    bo.ev("() => document.querySelector('#repo-seite [data-reiter=patches]').click()")
    bo.s.wait_for_selector("#repo-seite .repo-patch-datei", state="attached", timeout=10000)
    bo.s.set_input_files("#repo-seite .repo-patch-datei", files=[{"name": "0001.patch", "mimeType": "text/plain", "buffer": patch.encode()}])
    bo.s.wait_for_selector("#repo-seite .patch-senden", timeout=10000)
    bo.ev("() => document.querySelector('#repo-seite .patch-senden').click()")
    try:
        bo.s.wait_for_function("(b) => [...document.querySelectorAll('#repo-seite .repo-patch-betreff')].some(x => x.textContent.includes(b))", arg=betreff, timeout=30000)
        bo_sieht = True
    except Exception:
        bo_sieht = False
    # Ada öffnet das Repo aus dem Raum und sieht den Patch
    ada.ev("() => { location.hash = '#/chat'; }")
    ada.ev(f"() => document.querySelector(\"{pille}\").click()")
    ada.s.wait_for_function(f"() => ({liste})().includes('{repo_id}')", timeout=30000)
    ada.ev(f"() => [...document.querySelectorAll('#raum-repos .raum-repo')].find(b => b.textContent === '{repo_id}').click()")
    ada.s.wait_for_selector("#repo-seite [data-reiter=patches]", timeout=30000)
    ada.ev("() => document.querySelector('#repo-seite [data-reiter=patches]').click()")
    try:
        ada.s.wait_for_function("(b) => [...document.querySelectorAll('#repo-seite .repo-patch-betreff')].some(x => x.textContent.includes(b))", arg=betreff, timeout=60000)
        ada_sieht = True
    except Exception:
        ada_sieht = False
    erg["patch"] = {"bo": bo_sieht, "ada": ada_sieht, "offen_1617": any(e.get("kind") == 1617 for e in relay.events)}
    if erg["patch"] != {"bo": True, "ada": True, "offen_1617": False}:
        erg["fehler"].append(f"Patch im privaten Raum {erg['patch']}")


def privatraum_pruefen(browser, url: str) -> dict:
    """Privater Raum (C-12) mit echter MLS-Engine: zwei Browser hinter derselben Relay-Attrappe. Ada legt den Raum an
    und lädt Bo ein (KeyPackage, Einladung versiegelt an seinen Posteingang), Bo nimmt beim nächsten Start an,
    Nachricht und Antwort im Thread gehen in beide Richtungen; dazu Meldung, Moderation, Repo und Patch – auf dem
    Relay steht nichts davon im Klartext."""
    erg = {"fehler": []}
    ra, rb = ProbeRelay(), ProbeRelay()
    rb.events = ra.events  # ein Relay für beide, jeder Browser mit eigener Verbindung (der eigene Schlüssel je Attrappe)
    ada = DialogSeite(browser, url, ra, erg)
    bo = DialogSeite(browser, url, rb, erg)
    for seite, pw in ((ada, "ada tresor 1"), (bo, "bo tresor 1")):
        tresor_an(seite, pw)
        # Die Liste der Unterhaltungen gleicht den Posteingang ab – dabei fragt die App ihre eigenen Relay-Listen
        seite.ev("() => { location.hash = '#/chat'; }")
    for _ in range(150):
        if ra.ich and rb.ich:
            break
        ada.s.wait_for_timeout(100)
    pk_ada, pk_bo = ra.ich, rb.ich
    erg["schluessel"] = bool(pk_ada and pk_bo and pk_ada != pk_bo)
    if not erg["schluessel"]:
        erg["fehler"].append("eigene Schlüssel nicht erkannt")
        return erg

    def warte_relay(bedingung, sekunden: int = 60) -> bool:
        for _ in range(sekunden * 5):
            if any(bedingung(e) for e in list(ra.events)):
                return True
            ada.s.wait_for_timeout(200)
        return False

    # Bo öffnet eine Unterhaltung mit Ada – dabei veröffentlicht er sein KeyPackage (Marmot, adressierbar: 30443, 2.2b-c1)
    bo.ev("() => { location.hash = '#/chat'; }")
    bo.s.wait_for_selector("#chat-new-dm", timeout=30000)
    bo.ev("() => document.getElementById('chat-new-dm').click()")
    bo.warte_dialog("Neue Nachricht")
    bo.tippe(pk_ada)
    bo.warte_zu()
    erg["keypackage"] = warte_relay(lambda e: e.get("kind") == 30443 and e.get("pubkey") == pk_bo)

    # Ada legt den Raum an und lädt Bo mit seinem Schlüssel ein
    ada.ev("() => { location.hash = '#/chat'; }")
    ada.s.wait_for_selector("#space-create", state="attached", timeout=30000)
    ada.ev("() => document.getElementById('space-create').click()")
    ada.warte_dialog("Raum anlegen (privat)")
    ada.tippe("Probe privat")
    ada.warte_zu()
    ada.s.wait_for_function("() => document.getElementById('space-name')?.textContent === 'Probe privat'", timeout=60000)
    pille = "#space-rail .space-pill[data-space^='mls:']"
    erg["angelegt"] = ada.ev(f"() => [document.querySelectorAll(\"{pille}\").length, document.querySelector(\"{pille}\")?.getAttribute('aria-label')]")
    ada.ev("() => document.getElementById('space-invite').click()")
    ada.warte_dialog("In den Raum einladen")
    ada.tippe(pk_bo)
    ada.warte_zu()
    erg["einladung"] = warte_relay(lambda e: e.get("kind") == 1059 and ["p", pk_bo] in [t[:2] for t in e.get("tags", [])])

    # Bo startet neu: der Posteingang bringt die Einladung, der Raum steht in seiner Leiste
    entsperre_neu(bo, "bo tresor 1")
    bo.ev("() => { location.hash = '#/chat'; }")
    try:
        bo.s.wait_for_function(f"() => !!document.querySelector(\"{pille}\")", timeout=60000)
    except Exception:
        pass
    # Den Namen kennt Bo erst aus der Definition in der Gruppe – bis er den Raum öffnet, heißt er „privater Raum“
    erg["angenommen"] = bo.ev(f"() => document.querySelector(\"{pille}\")?.getAttribute('aria-label') ?? null")

    # Ada schreibt im Kanal, Bo liest und antwortet im Thread, Ada sieht die Antwort
    gruss, antwort = "Hallo Bo – nur wir lesen mit.", "Antwort von Bo im Thread."
    ada.ev("(t) => { const i = document.getElementById('space-msg'); i.value = t; i.focus(); }", gruss)
    ada.s.keyboard.press("Enter")
    ada.s.wait_for_function("(t) => document.getElementById('channel-thread')?.textContent.includes(t)", arg=gruss, timeout=30000)
    if erg["angenommen"]:
        bo.ev(f"() => document.querySelector(\"{pille}\").click()")
        try:
            bo.s.wait_for_function("(t) => document.getElementById('channel-thread')?.textContent.includes(t)", arg=gruss, timeout=60000)
            erg["bo_liest"] = True
            erg["bo_name"] = bo.ev(f"() => [document.getElementById('space-name').textContent, document.querySelector(\"{pille}\").getAttribute('aria-label')]")
        except Exception:
            erg["bo_liest"] = False
        if erg["bo_liest"]:
            bo.ev("(t) => [...document.querySelectorAll('#channel-thread .msg-zeile')].find(z => z.textContent.includes(t))"
                  ".querySelector('button.antworten').click()", gruss)
            bo.s.wait_for_function("() => document.activeElement?.id === 'thread-msg'", timeout=10000)
            bo.s.keyboard.type(antwort)
            bo.s.keyboard.press("Enter")
            bo.s.wait_for_function("(t) => document.getElementById('thread-verlauf')?.textContent.includes(t)", arg=antwort, timeout=30000)
            ada.ev(f"() => document.querySelector(\"{pille}\").click()")
            try:
                ada.s.wait_for_function("() => !!document.querySelector('#channel-thread .thread-link')", timeout=60000)
                ada.ev("() => document.querySelector('#channel-thread .thread-link').click()")
                ada.s.wait_for_function("(t) => document.getElementById('thread-verlauf')?.textContent.includes(t)", arg=antwort, timeout=10000)
                erg["ada_liest"] = True
            except Exception:
                erg["ada_liest"] = False
    # C-12b: Meldung, Moderation, Repo und Patch – nur, wenn der Austausch oben stand
    repo_id, betreff = "geheimrepo", "Liesmich im Raum"
    if erg.get("ada_liest") is True:
        privatraum_moderation(ada, bo, ra, pk_bo, pille, gruss, antwort, erg)
        privatraum_repo(ada, bo, ra, pille, repo_id, betreff, erg)
    # Auf dem Relay nur Chiffrat: weder Name noch Text des Raums im Klartext
    roh = json.dumps(ra.events, ensure_ascii=False)
    erg["klartext"] = [x for x in ("Probe privat", gruss, antwort, repo_id, betreff) if x in roh]
    erg["kinds"] = sorted({e.get("kind") for e in ra.events})
    if not erg["keypackage"]:
        erg["fehler"].append("Bo hat kein KeyPackage veröffentlicht")
    if erg["angelegt"] != [1, "Privater Raum Probe privat"]:
        erg["fehler"].append(f"angelegt {erg['angelegt']}")
    if not erg["einladung"]:
        erg["fehler"].append("keine Einladung an Bo")
    if erg["angenommen"] != "Privater Raum privater Raum" or erg.get("bo_name") != ["Probe privat", "Privater Raum Probe privat"]:
        erg["fehler"].append(f"Bo hat die Einladung nicht angenommen: {erg['angenommen']} {erg.get('bo_name')}")
    if erg.get("bo_liest") is not True or erg.get("ada_liest") is not True:
        erg["fehler"].append(f"Nachricht/Thread: Bo liest {erg.get('bo_liest')}, Ada liest {erg.get('ada_liest')}")
    if erg["klartext"]:
        erg["fehler"].append(f"Klartext auf dem Relay: {erg['klartext']}")
    erg["browser_dialoge"] = ada.browser_dialoge + bo.browser_dialoge
    if erg["browser_dialoge"]:
        erg["fehler"].append(f"Browser-Dialoge: {erg['browser_dialoge']}")
    ada.ctx.close()
    bo.ctx.close()
    erg["bestanden"] = not erg["fehler"]
    return erg


def einstellungen_pruefen(browser, url: str) -> dict:
    """Settings (C-1c): Widerruf, Nachfolge und „für jemanden melden“ über Dialoge statt prompt()/confirm() –
    Fehler melden sich im Dialog, der private Ersatzschlüssel steht verdeckt, abgebrochen geht nichts hinaus.
    Dazu im Profil die SOL-Adresse (12.6): öffentlich nur mit Häkchen nach der Warnung."""
    erg = {"fehler": []}
    relay = ProbeRelay()
    seite = DialogSeite(browser, url, relay, erg)
    ev = seite.ev
    ev("() => { location.hash = '#/settings'; }")
    seite.s.wait_for_selector("#rotation-revoke", state="attached", timeout=30000)

    def feld(nr: int, wert: str) -> None:
        ev("([n, v]) => { const f = document.querySelectorAll('[role=dialog] input:not([type=checkbox]), [role=dialog] textarea')[n]; f.value = v; }", [nr, wert])

    def bestaetigen() -> dict | None:
        ev("() => document.querySelector('[role=dialog] .dlg-knoepfe button:last-child').click()")
        seite.s.wait_for_timeout(200)
        return seite.stand()

    # Widerruf: ein Dialog mit Anleitung; der Ersatzschlüssel verdeckt; Gefahr → Fokus zuerst auf Abbrechen
    ev("() => document.getElementById('rotation-revoke').click()")
    wr = seite.warte_dialog("Schlüssel widerrufen")
    wr["typen"] = ev("() => [...document.querySelectorAll('[role=dialog] input')].map(i => i.type)")
    wr["fokus"] = ev("() => document.activeElement?.textContent")
    feld(1, "abc")
    wr_falsch = bestaetigen()
    seite.s.keyboard.press("Escape")
    seite.warte_zu()
    # Nachfolge: unter drei Vertrauten meldet sich der Dialog
    ev("() => document.getElementById('succ-setup').click()")
    nf = seite.warte_dialog("Nachfolge einrichten")
    feld(0, "ab" * 32 + ", " + "cd" * 32)
    nf_zwei = bestaetigen()
    seite.s.keyboard.press("Escape")
    seite.warte_zu()
    # Für jemanden melden: nur ein gültiger Schlüssel
    ev("() => document.getElementById('succ-claim').click()")
    md = seite.warte_dialog("für jemanden melden")  # erster Buchstabe groß nur per CSS
    feld(0, "npub1falsch")
    feld(1, "Seit Wochen still")
    md_falsch = bestaetigen()
    seite.s.keyboard.press("Escape")
    seite.warte_zu()
    # Bunker (C-1e): erst bestätigen, dann wechselt die Identität – Esc lässt alles, wie es ist
    ev("() => document.getElementById('bunker-verbinden').click()")
    bu = seite.warte_dialog("Anmelden per Bunker (NIP-46)")
    seite.s.keyboard.press("Escape")
    seite.warte_zu()
    # Abzeichen (C-1e): Name, Empfänger und Zweck in einem Dialog; ohne gültigen Empfänger meldet er sich
    ev("() => { location.hash = '#/profil'; }")
    ev("() => document.getElementById('badge-create').click()")
    ab = seite.warte_dialog("Abzeichen vergeben")
    feld(0, "Helfer")
    feld(1, "npub1falsch")
    ab_falsch = bestaetigen()
    seite.s.keyboard.press("Escape")
    seite.warte_zu()
    # SOL-Adresse im Profil (12.6): ohne Häkchen bleibt sie auf dem Gerät; einschalten erst nach der Warnung,
    # abgebrochen bleibt aus; ohne eingebaute Wallet keine frische Adresse – gespeichert (veröffentlicht) wird hier nichts
    sol = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtVb"
    ev("(a) => { const f = document.getElementById('pf-sol'); f.value = a; f.dispatchEvent(new Event('input')); }", sol)
    offen = lambda: ev("() => document.getElementById('pf-disclosure').textContent")
    ps = {"privat": "Deine SOL-Adresse bleibt auf dem Gerät" in offen()}
    ev("() => document.getElementById('pf-sol-oeffentlich').click()")
    ps["warnung"] = (seite.warte_dialog("SOL-Adresse öffentlich zeigen?")["text"] or "")[:40]
    seite.s.keyboard.press("Escape")
    seite.warte_zu()
    seite.s.wait_for_timeout(100)
    ps["abgebrochen"] = [ev("() => document.getElementById('pf-sol-oeffentlich').checked"), ev("() => localStorage.getItem('freedom.profil.solOeffentlich')")]
    ev("() => document.getElementById('pf-sol-oeffentlich').click()")
    seite.warte_dialog("SOL-Adresse öffentlich zeigen?")
    bestaetigen()
    seite.warte_zu()
    seite.s.wait_for_function("(a) => document.getElementById('profile-preview').textContent.includes(a)", arg=sol, timeout=10000)
    ps["an"] = [ev("() => document.getElementById('pf-sol-oeffentlich').checked"), ev("() => localStorage.getItem('freedom.profil.solOeffentlich')"),
                "Deine Solana-Adresse ist öffentlich" in offen()]
    ev("() => document.getElementById('pf-sol-frisch').click()")
    seite.s.wait_for_function("() => document.getElementById('toast').textContent.startsWith('Keine frische Adresse')", timeout=10000)
    ps["frisch_ohne_wallet"] = ev("() => document.getElementById('pf-sol').value") == sol
    ev("() => document.getElementById('pf-sol-oeffentlich').click()")
    ps["aus"] = [ev("() => localStorage.getItem('freedom.profil.solOeffentlich')"), sol in ev("() => document.getElementById('profile-preview').textContent")]
    erg["profil_sol"] = ps
    if ps != {"privat": True, "warnung": "Wer dein Profil sieht, kennt dann diese ", "abgebrochen": [False, None],
              "an": [True, "1", True], "frisch_ohne_wallet": True, "aus": ["0", False]}:
        erg["fehler"].append(f"Profil SOL {ps}")
    erg["bunker"], erg["abzeichen"] = bu, {"dialog": ab, "falsch": ab_falsch}
    if not (bu["text"] or "").startswith("Die App wechselt auf die Identität im Bunker"):
        erg["fehler"].append(f"Bunker {bu}")
    if not (ab["felder"] == ["Name des Abzeichens", "An Schlüssel (npub oder hex), durch Komma oder je Zeile", "Wofür? (erscheint bei jedem Träger)"]
            and ab_falsch["meldung"] == "Kein gültiger Pubkey dabei"):
        erg["fehler"].append(f"Abzeichen {erg['abzeichen']}")
    erg["widerruf"], erg["nachfolge"], erg["melden"] = (
        {"dialog": wr, "falsch": wr_falsch}, {"dialog": nf, "zwei": nf_zwei}, {"dialog": md, "falsch": md_falsch})
    if not (wr["text"] and wr["text"].startswith("So widerrufst du") and wr["typen"] == ["text", "password", "date"]
            and wr["fokus"] == "Abbrechen" and wr_falsch["meldung"] == "Der Ersatzschlüssel muss 64 Zeichen hex sein"):
        erg["fehler"].append(f"Widerruf {erg['widerruf']}")
    if not (nf["text"] == "Mindestens 3 Personen, die sich NICHT kennen und FreedomStack nutzen."
            and nf_zwei["meldung"] == "Mindestens drei Vertraute – bei weniger ist eine Absprache zu leicht"):
        erg["fehler"].append(f"Nachfolge {erg['nachfolge']}")
    if not (md["felder"] == ["Für wen meldest du? (npub oder hex)", "Warum? (wird veröffentlicht)"]
            and md_falsch["meldung"] == "Kein gültiger öffentlicher Schlüssel"):
        erg["fehler"].append(f"Melden {erg['melden']}")
    # Mein Knoten (B-8c, Settings → Geräte): ein falscher Code meldet sich im Dialog, ein gültiger wird verdeckt eingegeben
    # und gemerkt, entkoppeln nach Rückfrage – dabei geht nichts hinaus (Prüfung „gesendet“ unten)
    ev("() => document.getElementById('knoten-koppeln').click()")
    kd = seite.warte_dialog("Mein Knoten koppeln")
    kd_typen = ev("() => [...document.querySelectorAll('[role=dialog] input')].map(i => i.type)")
    feld(0, "freedom-kopplung:1:kaputt")
    kd_falsch = bestaetigen()
    code = "freedom-kopplung:1:" + "ab" * 32 + ":" + "cd" * 32
    feld(0, code)
    bestaetigen()
    seite.warte_zu()
    knoten = {"typen": kd_typen, "falsch": kd_falsch["meldung"] if kd_falsch else None,
              "status": ev("() => document.getElementById('knoten-status')?.textContent"),
              "gemerkt": ev("() => localStorage.getItem('freedom.knoten.kopplung')") == code,
              "entkoppeln": ev("() => !document.getElementById('knoten-entkoppeln').hidden"),
              # Halten (B-9b2): gekoppelt sichtbar, Standard an, der Haken merkt sich „aus“
              "halten": ev("() => [!document.getElementById('knoten-halten-zeile').hidden, document.getElementById('knoten-halten').checked]"),
              # Alles über meinen Knoten (B-9c2): gekoppelt sichtbar, Standard aus, „an“ wird gemerkt
              "nur": ev("() => [!document.getElementById('knoten-nur-zeile').hidden, document.getElementById('knoten-nur').checked]"),
              # Status (B-11b): Knopf nur gekoppelt, gefragt wird erst beim Klick – die Anzeige ist leer
              "status": ev("() => [!document.getElementById('knoten-status-holen').hidden, document.getElementById('knoten-status-anzeige').textContent]"),
              # Relay übernehmen (B-9c3): nur gekoppelt sichtbar
              "relay_knopf": ev("() => !document.getElementById('knoten-relay-uebernehmen').hidden")}
    # Ohne bekanntes Relay des Knotens (die Attrappe kennt keine Liste von ihm): Meldung, keine Rückfrage, nichts veröffentlicht
    listen_vorher = sum(1 for e in relay.gesendet if e.get("kind") in (10002, 10050))
    ev("() => document.getElementById('knoten-relay-uebernehmen').click()")
    seite.s.wait_for_function("() => document.getElementById('knoten-status-anzeige').textContent.includes('nennt kein Relay')", timeout=20000)
    knoten["relay_ohne"] = [ev("() => document.getElementById('knoten-status-anzeige').textContent"),
                            ev("() => !!document.querySelector('[role=dialog][aria-modal=true]')"),
                            sum(1 for e in relay.gesendet if e.get("kind") in (10002, 10050)) == listen_vorher]
    ev("() => document.getElementById('knoten-halten').click()")
    knoten["halten_aus"] = ev("() => localStorage.getItem('freedom.knoten.halten')")
    ev("() => document.getElementById('knoten-nur').click()")
    knoten["nur_an"] = ev("() => localStorage.getItem('freedom.knoten.nurUeber')")
    # Wecken (B-12d2): sichtbar, ohne Abo aus; mit „nur über meinen Knoten“ und ohne bekanntes Relay scheitert es
    # sofort – Haken wieder aus, kein Worker angemeldet, nichts gesendet (Prüfung „gesendet“ unten)
    knoten["wecken_vorher"] = ev("() => [!document.getElementById('knoten-wecken-zeile').hidden, document.getElementById('knoten-wecken').checked]")
    ev("() => document.getElementById('knoten-wecken').click()")
    seite.s.wait_for_function("() => document.getElementById('knoten-status-anzeige').textContent.includes('nennt kein Relay')"
                              " && !document.getElementById('knoten-wecken').disabled", timeout=20000)
    knoten["wecken_ohne"] = [ev("() => document.getElementById('knoten-wecken').checked"),
                             ev("async () => (await navigator.serviceWorker.getRegistrations()).length")]
    ev("() => document.getElementById('knoten-entkoppeln').click()")
    seite.warte_dialog("entkoppeln")
    bestaetigen()
    seite.warte_zu()
    knoten["danach"] = [ev("() => document.getElementById('knoten-status')?.textContent"), ev("() => localStorage.getItem('freedom.knoten.kopplung')"),
                        ev("() => document.getElementById('knoten-halten-zeile').hidden"), ev("() => document.getElementById('knoten-nur-zeile').hidden"),
                        ev("() => document.getElementById('knoten-status-holen').hidden"), ev("() => document.getElementById('knoten-relay-uebernehmen').hidden"),
                        ev("() => document.getElementById('knoten-wecken-zeile').hidden")]
    erg["knoten"] = knoten
    if knoten != {"typen": ["password"], "falsch": "Kein Kopplungscode – er beginnt mit freedom-kopplung:1:", "status": "Gekoppelt mit abababab…abab",
                  "gemerkt": True, "entkoppeln": True, "halten": [True, True], "nur": [True, False], "status": [True, ""], "halten_aus": "0", "nur_an": "1",
                  "relay_knopf": True, "relay_ohne": ["Mein Knoten nennt kein Relay – nichts übernommen", False, True],
                  "wecken_vorher": [True, False], "wecken_ohne": [False, 0],
                  "danach": ["Nicht gekoppelt", None, True, True, True, True, True]}:
        erg["fehler"].append(f"Mein Knoten {knoten}")
    # Abgebrochen: nichts veröffentlicht – kein Widerruf, kein Plan, keine Meldung
    erg["gesendet"] = sorted({e["kind"] for e in relay.gesendet if e.get("kind") not in (10002, 10050)})
    if erg["gesendet"]:
        erg["fehler"].append(f"abgebrochen, aber gesendet: {erg['gesendet']}")
    erg["browser_dialoge"] = seite.browser_dialoge
    if seite.browser_dialoge:
        erg["fehler"].append(f"Browser-Dialoge: {seite.browser_dialoge}")
    seite.ctx.close()
    erg["bestanden"] = not erg["fehler"]
    return erg


def einnahmen_pruefen(browser, url: str) -> dict:
    """Earn (C-2): Einnahmen in der Einheit ihrer Kette – Lightning in sats, Solana in SOL; ohne Kurs kein
    erfundener SOL-Betrag. Leistungs-Events eines Probe-Knotens aus `scripts/einnahmen-probe.mts`."""
    erg = {"fehler": []}
    wurzel = Path(__file__).resolve().parent.parent
    aus = subprocess.run(["npx", "tsx", "scripts/einnahmen-probe.mts"], cwd=wurzel, capture_output=True, text=True, timeout=180, check=True)
    probe = json.loads(aus.stdout)
    relay = ProbeRelay()
    relay.events = probe["events"]
    seite = DialogSeite(browser, url, relay, erg)
    seite.ev("(k) => { localStorage.setItem('freedom.earn.knoten', k); location.hash = '#/verdienen'; }", probe["knoten"])
    seite.s.wait_for_function("() => document.querySelectorAll('#earn-events .stat').length === 2", timeout=30000)
    zeilen = seite.ev("() => [...document.querySelectorAll('#earn-events .stat span:last-child')].map(s => s.textContent.split(' · ')[0])")
    erg["zeilen"] = zeilen
    erg["untertitel"] = seite.ev("() => document.querySelector('[data-i18n=\"earn.untertitel\"]')?.textContent")
    if zeilen != ["SOL, Wert 1.500 sats (kein Kurs)", "21 sats"]:
        erg["fehler"].append(f"Einnahmen {zeilen}")
    if erg["untertitel"] != "Rechenzeit, Speicher und Relays gegen Sats oder SOL.":
        erg["fehler"].append(f"Untertitel {erg['untertitel']}")
    seite.ctx.close()
    erg["bestanden"] = not erg["fehler"]
    return erg


def fremdtext_pruefen(browser, url: str) -> dict:
    """innerHTML abgebaut (C-6a): Fremdtext mit HTML – Einnahme, Modell-Manifest, Abzeichen, eigener
    Profilentwurf – erscheint nur als Text; kein Element daraus, kein Skript läuft. Events aus
    `scripts/fremdtext-probe.mts`, signiert erst, wenn die Attrappe den eigenen Schlüssel kennt.
    Seit C-6b auch Settings (Geräte, Nachfolge, ohne Internet) und das Sprachmenü als DOM, seit C-6c
    eine versiegelte Direktnachricht eines Fremden: Name in der Liste, Text und Anhänge im Verlauf."""
    erg = {"fehler": []}
    wurzel = Path(__file__).resolve().parent.parent
    relay = ProbeRelay()
    seite = DialogSeite(browser, url, relay, erg)
    ev = seite.ev
    ev("() => { location.hash = '#/chat'; }")
    for _ in range(80):
        if relay.ich:
            break
        seite.s.wait_for_timeout(250)
    if not relay.ich:
        seite.ctx.close()
        return {"bestanden": False, "fehler": ["keine Abfrage der eigenen Relay-Listen – eigener Schlüssel unbekannt"]}
    aus = subprocess.run(["npx", "tsx", "scripts/fremdtext-probe.mts", relay.ich], cwd=wurzel,
                         capture_output=True, text=True, timeout=180, check=True)
    probe = json.loads(aus.stdout)
    relay.events = probe["events"]
    html = lambda wo: probe["html"].replace("WO", wo)  # noqa: E731
    # Einnahmen: work_type aus dem Event des Knotens
    ev("([k, p]) => { localStorage.setItem('freedom.earn.knoten', k); localStorage.setItem('freedom.profile', JSON.stringify(p));"
       " location.hash = '#/verdienen'; }", [probe["knoten"], {"name": html("profil"), "about": html("about")}])
    seite.s.wait_for_function("() => document.querySelectorAll('#earn-events .stat').length === 1", timeout=30000)
    erg["einnahme"] = ev("() => document.querySelector('#earn-events .stat .k').textContent")
    # Modelle: Name und Quantisierung aus dem Manifest
    ev("() => document.getElementById('models-refresh').click()")
    seite.s.wait_for_function("() => document.querySelector('#models-list .usage-row')", timeout=30000)
    erg["modell"] = ev("() => document.querySelector('#models-list .usage-row span').textContent")
    # Profil: Vorschau aus dem Entwurf, Abzeichen aus der Verleihung an den eigenen Schlüssel
    ev("() => { location.hash = '#/profil'; }")
    seite.s.wait_for_function("() => document.querySelector('#badge-list .badge-row') && document.querySelector('#profile-preview h3')", timeout=30000)
    erg["profil"] = ev("() => [document.querySelector('#profile-preview h3').textContent, document.querySelector('#profile-preview p').textContent]")
    erg["abzeichen"] = ev("() => [...document.querySelectorAll('#badge-list .badge-row span span:first-child')].map(s => s.textContent)")
    # C-6b: Settings und Sprachmenü – als DOM gebaut, Text und Verhalten wie vorher. Die Nachfolge liest
    # der Start, in einer eben angelegten Identität erst nach dem Neuladen
    ev("(p) => localStorage.setItem('freedom.petnames', JSON.stringify([[p[0], p[1]]]))", [probe["absender"], html("kontakt")])
    # C-10: eine Community aus einer älteren Version – gemerkt wie bisher (ohne Tresor in localStorage)
    ev("(n) => localStorage.setItem('freedom.chats', JSON.stringify([{ id: 'comm-probe', type: 'community', name: n, lastTs: 0 }]))", html("community"))
    seite.s.reload(wait_until="load")
    # C-6c: die Direktnachricht – erst nach dem Neuladen, der Posteingang wird höchstens je Minute abgeglichen
    ev("() => { location.hash = '#/chat'; }")
    zeile = f"#chat-list .chat-item[data-cid='{probe['absender']}']"
    seite.s.wait_for_function(f"() => document.querySelector(\"{zeile} .label\")?.textContent.includes('kontakt')", timeout=30000)
    erg["chat_name"] = ev(f"() => document.querySelector(\"{zeile} .label\").textContent")
    ev(f"() => document.querySelector(\"{zeile}\").click()")
    seite.s.wait_for_function("() => document.querySelector('#chat-thread .bubble .txt')", timeout=30000)
    erg["chat"] = ev("""() => { const txt = document.querySelector('#chat-thread .bubble .txt');
      const knopf = txt.querySelector('.chat-blob-btn');
      return { text: txt.firstChild.textContent, bild: txt.querySelector('img.chat-media')?.alt ?? null,
               knopf: knopf && [knopf.textContent, knopf.dataset.mime, knopf.getAttribute('onclick')],
               zap: !!document.querySelector('#chat-thread .zap-msg-btn'),
               elemente: document.querySelectorAll('#chat-list b, #chat-list img, #chat-thread b, #chat-thread img:not(.chat-media)').length }; }""")
    if html("kontakt") not in erg["chat_name"]:
        erg["fehler"].append(f"Name in der Liste {erg['chat_name']}")
    # C-16: die Relay-Attrappe nimmt jede Verbindung an – nach dem Abgleich ist mindestens eine offen
    seite.s.wait_for_function("() => /^[1-9]\\d* von \\d+ Relays verbunden$/.test(document.querySelector('.nav-status').title)", timeout=15000)
    erg["relays"] = ev("() => [document.querySelector('.nav-status').title, document.getElementById('nav-status-text').textContent,"
                       " document.getElementById('nav-status-dot').classList.contains('on')]")
    if erg["chat"] != {"text": html("text"), "bild": html("bild"), "knopf": [f"🔒 {html('datei')}", "x\" onclick=\"window.__fremd='mime'", None],
                       "zap": True, "elemente": 0}:
        erg["fehler"].append(f"Verlauf {erg['chat']}")
    if not re.fullmatch(r"\d+/\d+", erg["relays"][1]) or erg["relays"][2] is not True:
        erg["fehler"].append(f"Relay-Stand {erg['relays']}")
    # C-10: die Community steht in der Raum-Leiste, nicht unter den Direktnachrichten, und öffnet ihren Verlauf
    pille = "#space-rail .space-pill[data-community='comm-probe']"
    seite.s.wait_for_selector(pille, state="attached", timeout=10000)
    vorher = ev(f"""() => [document.querySelector("{pille}").title, document.querySelector("{pille}").textContent,
      !!document.querySelector("#chat-list [data-cid='comm-probe']")]""")
    ev(f"""() => document.querySelector("{pille}").click()""")
    seite.s.wait_for_timeout(300)
    nachher = ev(f"""() => [document.querySelector("{pille}").getAttribute('aria-current'),
      document.querySelector('#chat-thread .empty-state')?.textContent ?? '']""")
    erg["community"] = [vorher, nachher]
    if vorher != [f"Community (offen): {html('community')}", "🏠<", False] or nachher[0] != "true" \
            or not nachher[1].startswith(html("community") + "Community (offen) –"):
        erg["fehler"].append(f"Community {erg['community']}")
    # C-6d: die Modellwahl des Agenten – der Name aus einem fremden Angebot als Text, auch im Knopf nach der Wahl
    ev("() => { location.hash = '#/agent'; }")
    karte = "(m) => [...document.querySelectorAll('#model-popover .model-card')].find(k => k.dataset.model === m)"
    seite.s.wait_for_function(f"(m) => !!({karte})(m)", arg=html("ki"), timeout=30000)
    ev("() => document.getElementById('ai-model-btn').click()")
    vorher = ev(f"(m) => {{ const k = ({karte})(m); return [k.querySelector('.mc-head b').textContent, k.querySelectorAll('img').length,"
                " !!k.querySelector('.mc-sub svg')]; }", html("ki"))
    ev(f"(m) => ({karte})(m).click()", html("ki"))
    erg["modellwahl"] = vorher + [ev("() => [document.getElementById('ai-model-btn').textContent.trim(),"
                                     " document.querySelectorAll('#ai-model-btn img, #model-popover img').length, !!document.querySelector('#ai-model-btn svg')]")]
    if erg["modellwahl"] != [html("ki"), 0, True, [html("ki"), 0, True]]:
        erg["fehler"].append(f"Modellwahl {erg['modellwahl']}")
    ev("() => { location.hash = '#/settings'; }")
    seite.s.wait_for_function("() => document.querySelector('#device-list span') && document.querySelector('#succession-status span')", timeout=30000)
    erg["settings"] = ev("() => [document.querySelector('#device-list span').textContent.split('.')[0],"
                         " document.querySelector('#succession-status span').textContent.split('.')[0]]")
    erg["offline"] = ev("() => [...document.querySelectorAll('#offline-caps .usage-row > span:first-child')].map(s => s.textContent.slice(0, 1))")
    ev("() => document.getElementById('lang-btn').click()")  # das Menü füllt sich beim Öffnen
    erg["sprachen"] = ev("() => [...document.querySelectorAll('#lang-menu button[data-lang]')].map(b => [b.textContent, b.type, b.className])")
    ev("() => document.querySelector('#lang-menu button[data-lang=en]').click()")
    erg["sprache_en"] = ev("() => [document.documentElement.lang, [...document.querySelectorAll('.lang-menu button.active')].map(b => b.dataset.lang)]")
    if erg["settings"] != ["Nur dieses Gerät", "Nicht eingerichtet"]:
        erg["fehler"].append(f"Settings {erg['settings']}")
    if not erg["offline"] or set(erg["offline"]) - {"✓", "✕"}:
        erg["fehler"].append(f"ohne Internet {erg['offline']}")
    if erg["sprachen"] != [["DE · Deutsch", "button", "active"], ["EN · English", "button", ""]] or erg["sprache_en"] != ["en", ["en", "en", "en"]]:
        erg["fehler"].append(f"Sprachmenü {erg['sprachen']} {erg['sprache_en']}")
    erg["elemente"] = ev("() => document.querySelectorAll('#earn-events img, #earn-events b, #models-list img, #models-list b,"
                         " #profile-preview b, #profile-preview img, #badge-list img, #badge-list b').length")
    erg["skript"] = ev("() => window.__fremd ?? null")
    if erg["einnahme"] != f"{html('arbeit')} · 7 Einheiten":
        erg["fehler"].append(f"Einnahme {erg['einnahme']}")
    if erg["modell"] != f"{html('modell')} · {html('quant')}":
        erg["fehler"].append(f"Modell {erg['modell']}")
    if erg["profil"] != [html("profil"), html("about")]:
        erg["fehler"].append(f"Profil {erg['profil']}")
    if html("abzeichen") not in erg["abzeichen"]:
        erg["fehler"].append(f"Abzeichen {erg['abzeichen']}")
    if erg["elemente"] != 0 or erg["skript"] is not None:
        erg["fehler"].append(f"HTML aus Fremdtext: {erg['elemente']} Elemente, Skript {erg['skript']}")
    seite.ctx.close()
    erg["bestanden"] = not erg["fehler"]
    return erg


# Barrierefreiheit (seit C-4): je Ansicht, was ein Vorleser oder die Tastatur nicht erreicht
ZUGANG_PRUEFUNG = r"""() => {
  const sichtbar = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !e.closest('[hidden],[inert],[aria-hidden=true]'); };
  const wer = (e) => (e.id ? '#' + e.id : e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.split(' ')[0] : ''));
  const name = (e) => {
    const a = e.getAttribute('aria-label'); if (a && a.trim()) return a.trim();
    const lb = e.getAttribute('aria-labelledby');
    if (lb) { const t = lb.split(' ').map((i) => document.getElementById(i)?.textContent ?? '').join(' ').trim(); if (t) return t; }
    if (e.id) { const l = document.querySelector(`label[for="${CSS.escape(e.id)}"]`); if (l && l.textContent.trim()) return l.textContent.trim(); }
    const umg = e.closest('label'); if (umg && umg.textContent.trim()) return umg.textContent.trim();
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.tagName)) return e.getAttribute('title') || '';
    return (e.textContent || '').trim() || e.getAttribute('title') || '';
  };
  const ohneName = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=link], [tabindex]:not([tabindex="-1"])')]
    .filter(sichtbar).filter((e) => !name(e)).map(wer);
  const ueberNull = [...document.querySelectorAll('[tabindex]')].filter((e) => Number(e.getAttribute('tabindex')) > 0).map(wer);
  const interaktiv = 'button, a[href], input, select, textarea, label, summary, [role=button], [role=link], [role=tab], [role=option], [role=menuitem], [tabindex]';
  const nurMaus = [...document.querySelectorAll('body *')].filter((e) => sichtbar(e) && getComputedStyle(e).cursor === 'pointer' && !e.closest(interaktiv)
    && !(e.parentElement && getComputedStyle(e.parentElement).cursor === 'pointer')).map(wer);
  // Kontrast nach WCAG AA: Schrift über der Fläche, auf der sie wirklich steht, samt Deckkraft der Vorfahren
  const rgb = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null; const p = m[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const drin = (a, b) => a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
  const flaeche = (e) => { const r = e.getBoundingClientRect();
    for (let x = e; x; x = x.parentElement) { const c = rgb(getComputedStyle(x).backgroundColor); if (c && c.a > 0.5 && drin(r, x.getBoundingClientRect())) return c; }
    return rgb(getComputedStyle(document.body).backgroundColor) ?? { r: 0, g: 0, b: 0, a: 1 }; };
  const deckkraft = (e) => { let o = 1; for (let x = e; x; x = x.parentElement) o *= Number(getComputedStyle(x).opacity); return o; };
  const kontrast = [];
  for (const e of document.querySelectorAll('body *')) {
    if (!sichtbar(e) || e.closest(':disabled') || ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const s = getComputedStyle(e); const f = rgb(s.color); if (!f) continue;
    const b = flaeche(e); const o = f.a * deckkraft(e);
    const g = { r: f.r * o + b.r * (1 - o), g: f.g * o + b.g * (1 - o), b: f.b * o + b.b * (1 - o) };
    const L1 = lum(g), L2 = lum(b); const k = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const gross = parseFloat(s.fontSize) >= 24 || (parseFloat(s.fontSize) >= 18.66 && Number(s.fontWeight) >= 700);
    if (k < (gross ? 3 : 4.5)) kontrast.push(`${wer(e)} „${e.textContent.trim().slice(0, 24)}“ ${k.toFixed(2)}:1`);
  }
  return { ohneName, ueberNull, nurMaus, kontrast };
}"""
# Erst messen, wenn Einblendungen fertig sind (`fs-in`, 0,18 s): Die Kontrastprüfung rechnet die Deckkraft mit,
# mitten in der Einblendung stünde Schrift mit 38 % Deckkraft da (2,92:1). Endlose Animationen (Pulsieren) zählen nicht.
ANIMATIONEN_FERTIG = ("() => document.getAnimations().every((a) => a.playState !== 'running'"
                      " || a.effect?.getComputedTiming().iterations === Infinity)")
ZUGANG_SEITEN = ["#/agent", "#/chat", "#/repos", "#/waehrung", "#/verdienen", "#/netz", "#/profil", "#/settings", "#/mehr"]


def zugang_pruefen(browser, url: str) -> dict:
    """Barrierefreiheit (C-4): auf jeder Seite und in jedem Unterreiter, Desktop und Handy – jedes Bedienelement
    hat einen Namen für Vorleser, nichts ist nur mit der Maus erreichbar, keine Tab-Reihenfolge von Hand
    (tabindex > 0), Schrift mit Kontrast nach WCAG AA (4,5:1, groß 3:1)."""
    erg = {"fehler": []}
    for groesse, vp in [("desktop", {"width": 1280, "height": 800}), ("mobil", {"width": 390, "height": 844})]:
        seite = DialogSeite(browser, url, ProbeRelay(), erg)
        if groesse == "mobil":
            seite.s.set_viewport_size(vp)
        funde: dict = {}
        for adr in ZUGANG_SEITEN:
            seite.ev("(a) => { location.hash = a; }", adr)
            seite.s.wait_for_timeout(600)
            seite.s.wait_for_function(ANIMATIONEN_FERTIG, timeout=10_000)
            ansichten = [(adr, None)]
            if groesse == "desktop":
                ansichten += [(adr, x) for x in seite.ev("() => [...document.querySelectorAll('[data-subtab-group] [data-subtab]')]"
                                                          ".filter((b) => b.offsetParent).map((b) => [b.closest('[data-subtab-group]').dataset.subtabGroup, b.dataset.subtab])")]
            for a, reiter in ansichten:
                if reiter:
                    seite.ev("([g, r]) => document.querySelector(`[data-subtab-group='${g}'] [data-subtab='${r}']`).click()", reiter)
                    seite.s.wait_for_timeout(300)
                    seite.s.wait_for_function(ANIMATIONEN_FERTIG, timeout=10_000)
                for art, liste in seite.ev(ZUGANG_PRUEFUNG).items():
                    for x in liste:
                        funde.setdefault(art, {}).setdefault(x, f"{a}{':' + reiter[1] if reiter else ''}")
        erg[groesse] = {art: [f"{x} ({wo})" for x, wo in v.items()] for art, v in funde.items()}
        for art, v in erg[groesse].items():
            if v:
                erg["fehler"].append(f"{groesse} {art}: {v[:6]}")
        seite.ctx.close()
    erg["bestanden"] = not erg["fehler"]
    return erg


# Echtes Git-Bundle (v2, mit Deltas) für den Reiter „Code“ (seit C.3c1) – dasselbe wie im Test von git-bundle.ts
PROBE_BUNDLE = (Path(__file__).resolve().parent.parent / "packages/app/test/fixtures/probe-v2.bundle").read_bytes()
# Seit C-20b: README mit Tabelle und Verweisen (src/liste.txt, docs/ANLEITUNG.md, einer hinaus)
# Seit C-20f: Karten der Repo-Liste nach dem zurückgedrehten Blick auf „werkzeug“ – [Name, Marke „neu“, Einzelheiten].
# Neu sind nur Beiträge anderer: das Issue von Bo, der Patch und der Kommentar von Ada; „meins“ und „raumrepo“ (nur Desktop)
# haben nichts von anderen.
_WERKZEUG_NEU = ["werkzeug", "3 neu", "Seit deinem letzten Blick: Issues 1, Patches 1, Kommentare 1"]
NEUIGKEITEN_KARTEN = {"desktop": [["raumrepo", None, None], ["meins", None, None], _WERKZEUG_NEU],
                      "mobil": [["meins", None, None], _WERKZEUG_NEU]}
PROBE_MD_BUNDLE = (Path(__file__).resolve().parent.parent / "packages/app/test/fixtures/probe-md.bundle").read_bytes()


def post_live_pruefen(browser, url: str) -> dict:
    """Post sofort (A-15a, Befund C-12): Solange die App offen ist, hält sie nach dem ersten Abgleich ein Abo an
    den eigenen Schlüssel – ohne `since` (Chat-Umschläge sind zurückdatiert), nur Neues (`limit: 1`). Eine
    Nachricht eines Kontakts (`scripts/dm-probe.mts`) kommt darüber und steht sofort in der offenen Unterhaltung –
    der Abgleich des Posteingangs liefe frühestens nach einer Minute wieder."""
    erg = {"fehler": []}
    wurzel = Path(__file__).resolve().parent.parent
    relay = ProbeRelay()
    seite = DialogSeite(browser, url, relay, erg)
    s, ev = seite.s, seite.ev
    ev("() => { location.hash = '#/chat'; }")
    for _ in range(80):
        if relay.ich:
            break
        s.wait_for_timeout(250)
    if not relay.ich:
        seite.ctx.close()
        return {"bestanden": False, "fehler": ["keine Abfrage der eigenen Relay-Listen – eigener Schlüssel unbekannt"]}
    text = "Hallo, sofort da (A-15a)"
    aus = subprocess.run(["npx", "tsx", "scripts/dm-probe.mts", relay.ich, text], cwd=wurzel, capture_output=True, text=True, timeout=180, check=True)
    probe = json.loads(aus.stdout)
    # Der Absender wird Kontakt: eine Unterhaltung über „Neue Nachricht“, sie bleibt offen
    s.wait_for_selector("#chat-new-dm", timeout=30000)
    ev("() => document.getElementById('chat-new-dm').click()")
    seite.warte_dialog("Neue Nachricht")
    seite.tippe(probe["absender"])
    seite.warte_zu()
    s.wait_for_function("(pk) => !!document.querySelector(`#chat-list .chat-item.active[data-cid='${pk}']`)", arg=probe["absender"], timeout=10000)

    def post_abos() -> list[dict]:
        return [f for _, fs in relay.abos.values() for f in fs
                if f.get("kinds") == [1059] and f.get("#p") == [relay.ich] and f.get("limit") == 1 and "since" not in f]
    for _ in range(120):
        if post_abos():
            break
        s.wait_for_timeout(250)
    erg["abo"] = len(post_abos())
    # Wie ein Relay: gespeichert (für das Nachladen der Unterhaltung) und an die offenen Abos
    relay.events.append(probe["events"][0])
    beginn = datetime.datetime.now()
    erg["zugestellt"] = relay.zustellen(probe["events"][0])
    try:
        s.wait_for_function("(t) => [...document.querySelectorAll('#chat-thread .bubble')].some(b => b.textContent.includes(t))", arg=text, timeout=15000)
        erg["sichtbar_nach_s"] = round((datetime.datetime.now() - beginn).total_seconds(), 1)
    except Exception:
        erg["sichtbar_nach_s"] = None
    if erg["abo"] < 1 or erg["zugestellt"] < 1:
        erg["fehler"].append(f"Abo für Post: {erg['abo']} offen, {erg['zugestellt']} zugestellt")
    if erg["sichtbar_nach_s"] is None:
        erg["fehler"].append("Nachricht nicht sofort in der offenen Unterhaltung (15 s)")
    erg["browser_dialoge"] = seite.browser_dialoge
    if seite.browser_dialoge:
        erg["fehler"].append(f"Browser-Dialoge: {seite.browser_dialoge}")
    seite.ctx.close()
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
        self.abos: dict[tuple, tuple] = {}  # offene REQs je Verbindung (seit B-13e) – für zustellen()

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
                self.abos[(id(ws), m[1])] = (ws, [x for x in m[2:] if isinstance(x, dict)])
                for f in (x for x in m[2:] if isinstance(x, dict)):
                    if 10002 in f.get("kinds", []) and len(f.get("authors", [])) == 1 and not self.ich:
                        self.ich = f["authors"][0]
                    for ev in self.events:
                        if self.passt(ev, f):
                            ws.send(json.dumps(["EVENT", m[1], ev]))
                ws.send(json.dumps(["EOSE", m[1]]))
            elif m[0] == "EVENT" and isinstance(m[1], dict):
                self.gesendet.append(m[1])
                self.events.append(m[1])  # wie ein Relay: später abfragbar (seit C.2d2)
                ws.send(json.dumps(["OK", m[1].get("id", ""), True, ""]))
            elif m[0] == "CLOSE":
                self.abos.pop((id(ws), m[1]), None)
        ws.on_message(nachricht)

    def zustellen(self, ev: dict) -> int:
        """Wie ein Relay mit offenen Abos (seit B-13e): ein neues Event an jede passende offene REQ – zurück die Zahl."""
        n = 0
        for (_, sub), (ws, filter_) in list(self.abos.items()):
            if any(self.passt(ev, f) for f in filter_):
                ws.send(json.dumps(["EVENT", sub, ev]))
                n += 1
        return n


def qr_pruefen(browser, url: str) -> dict:
    """QR (11.1b): Gerätecode nur auf Klick, mit Warnung, nach 60 s weg; Scannen beim
    Import mit Kamera-Attrappe (Kamera erst auf Klick, danach aus); ohne Erkennung
    der Hinweis zum Einfügen; Werbelink als QR."""
    erg = {"fehler": []}
    basis = url.rsplit("/", 1)[0]

    def seite(relay: ProbeRelay, skript: str):
        ctx = browser.new_context(locale="de-DE", viewport={"width": 1280, "height": 800})
        ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith(basis) else r.abort())
        ctx.route_web_socket(re.compile(r"^wss?://"), relay.verbinde)
        ctx.add_init_script(skript)
        s = ctx.new_page()
        s.on("pageerror", lambda e: erg["fehler"].append(str(e)[:300]))
        s.clock.install()
        s.goto(url, wait_until="load")
        s.wait_for_selector("#bk-done", timeout=30000)
        w = s.evaluate("() => [...document.querySelectorAll('.mnemonic-list li')].map(l => l.textContent)")
        s.evaluate("(w) => document.querySelectorAll('#bk-challenge input').forEach(i => i.value = w[+i.dataset.pos])", w)
        s.evaluate("() => document.getElementById('bk-done').click()")
        s.wait_for_timeout(1500)
        s.evaluate("() => document.getElementById('ein-abbrechen')?.click()")
        return ctx, s

    # Kamera zählen; ohne BarcodeDetector (so wie im Linux-Chromium) oder mit Attrappe
    kamera = """window.__kamera = 0; window.__spuren = [];
      if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { window.__kamera++;
        const c = document.createElement('canvas'); c.width = 64; c.height = 64; c.getContext('2d').fillRect(0, 0, 8, 8);
        const st = c.captureStream(5); window.__spuren = st.getTracks(); return st; };"""
    ohne_erkennung = kamera + "try { delete window.BarcodeDetector; } catch (e) {} window.BarcodeDetector = undefined;"
    mit_erkennung = kamera + """window.__erkannt = 0; window.BarcodeDetector = class {
        constructor(o) { window.__formate = o.formats; }
        static async getSupportedFormats() { return ['qr_code']; }
        async detect() { window.__erkannt++; return window.__erkannt >= 3 && window.__scanWert ? [{ rawValue: window.__scanWert }] : []; } };"""
    dlg = """() => { const d = document.querySelector('[role=dialog][aria-modal=true]'); if (!d) return null;
      const f = d.querySelector('input[readonly], textarea'); const scan = d.querySelector('.qr-scannen');
      return { titel: document.getElementById(d.getAttribute('aria-labelledby'))?.textContent, wert: f?.value ?? null,
        bilder: d.querySelectorAll('.qr-bild').length, pfad: d.querySelector('.qr-bild path')?.getAttribute('d')?.slice(0, 12) ?? null,
        hinweise: [...d.querySelectorAll('.qr-hinweis')].map(h => h.textContent).filter(Boolean),
        scan: scan ? !scan.hidden : null, videos: d.querySelectorAll('.qr-video').length }; }"""
    ok = "() => [...document.querySelectorAll('[role=dialog] .dlg-knoepfe button')].pop().click()"

    # Hauptgerät: Gerät hinzufügen → Gerätecode mit QR auf Klick, verschwindet nach 60 s
    relay_a = ProbeRelay()
    ctx, s = seite(relay_a, ohne_erkennung)
    ev = s.evaluate
    ev("() => document.querySelector('.app-nav button[data-tab=\"settings\"]').click()")
    ev("() => document.getElementById('device-add').click()")
    s.wait_for_timeout(300)
    s.keyboard.type("Handy")
    s.keyboard.press("Enter")
    s.wait_for_timeout(300)
    warnung = ev(dlg)
    ev(ok)
    try:
        s.wait_for_function("() => document.querySelector('[role=dialog] .qr-zeigen')", timeout=15000)
    except Exception:
        pass
    code_dlg = ev(dlg) or {}
    code = code_dlg.get("wert") or ""
    ev("() => document.querySelector('[role=dialog] .qr-zeigen').click()")
    gezeigt = ev(dlg) or {}
    jetzt_ms = ev("() => Date.now()")
    s.clock.pause_at(datetime.datetime.fromtimestamp((jetzt_ms + 1000) / 1000, tz=datetime.timezone.utc))
    s.clock.fast_forward("00:58")
    s.wait_for_timeout(200)
    nach58 = (ev(dlg) or {}).get("bilder")
    s.clock.fast_forward("00:03")
    s.wait_for_timeout(200)
    nach61 = ev(dlg) or {}
    sk = code.rsplit(":", 1)[-1] if code.count(":") == 2 else "?"
    gespeichert = ev("(sk) => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(v => String(v).includes(sk))", sk)
    ev(ok)
    s.wait_for_timeout(200)
    grants = {e["id"]: e["pubkey"] for e in relay_a.gesendet if e.get("kind") == 38070}  # an jedes Relay, dasselbe Event
    person_a = next(iter(grants.values()), None)  # die Vollmacht signiert das Hauptgerät
    # Import ohne Erkennung: ehrlicher Hinweis, kein Scan-Knopf
    ev("() => document.getElementById('nb-import').click()")
    s.wait_for_timeout(300)
    ohne = ev(dlg) or {}
    s.keyboard.press("Escape")
    # Werbelink als QR: nicht geheim, bleibt stehen
    ev("() => document.querySelector('.app-nav button[data-tab=\"earn\"]').click()")
    s.wait_for_timeout(500)
    ev("() => document.querySelector('#referral-qr .qr-zeigen')?.click()")
    werbung = ev("""() => ({ bilder: document.querySelectorAll('#referral-qr .qr-bild').length,
      label: document.querySelector('#referral-qr .qr-bild')?.getAttribute('aria-label') ?? null })""")
    kamera_a = ev("() => window.__kamera")
    erg["hauptgeraet"] = {"warnung": warnung, "code": {k: v for k, v in code_dlg.items() if k != "wert"}, "gezeigt": gezeigt,
                          "nach58": nach58, "nach61": nach61, "gespeichert": gespeichert, "vollmachten": len(grants),
                          "ohne_erkennung": ohne, "werbung": werbung, "kamera": kamera_a}
    ctx.close()
    if not (warnung and warnung["titel"] == "Gerät hinzufügen"):
        erg["fehler"].append(f"Warnung vor der Vollmacht {warnung}")
    if not (re.fullmatch(r"freedom-geraet:[0-9a-f]{64}:[0-9a-f]{64}", code) and code.split(":")[1] == person_a):
        erg["fehler"].append(f"Gerätecode {code[:40]}…")
    if not (code_dlg.get("titel") == "Gerätecode für Handy" and code_dlg.get("bilder") == 0
            and any(h.startswith("Nur dem eigenen neuen Gerät zeigen") for h in code_dlg.get("hinweise", []))):
        erg["fehler"].append(f"vor dem Klick: kein Bild, Warnung da {code_dlg.get('bilder')} {code_dlg.get('hinweise')}")
    if not (gezeigt.get("bilder") == 1 and (gezeigt.get("pfad") or "").startswith("M4 4h7v1h-7z")
            and any(h.startswith("Verschwindet nach 60 Sekunden") for h in gezeigt.get("hinweise", []))):
        erg["fehler"].append(f"QR nach dem Klick {gezeigt}")
    if nach58 != 1 or nach61.get("bilder") != 0:
        erg["fehler"].append(f"verschwindet nach 60 s: nach 58 s {nach58}, nach 61 s {nach61.get('bilder')}")
    if gespeichert is not False or len(grants) != 1:
        erg["fehler"].append(f"gespeichert {gespeichert}, Vollmachten {len(grants)}")
    if not (ohne.get("titel") == "Identität importieren" and ohne.get("scan") is False
            and "Dieser Browser kann QR-Codes nicht mit der Kamera lesen – bitte den Code einfügen." in ohne.get("hinweise", [])):
        erg["fehler"].append(f"ohne Erkennung {ohne}")
    if werbung != {"bilder": 1, "label": "Werbelink als QR-Code"} or kamera_a != 0:
        erg["fehler"].append(f"Werbelink {werbung}, Kamera {kamera_a}")

    # Neues Gerät: Import mit Scannen – Kamera erst auf Klick, nach dem Code wieder aus
    relay_b = ProbeRelay()
    ctx, s = seite(relay_b, mit_erkennung)
    ev = s.evaluate
    ev("(c) => { window.__scanWert = c; }", code)
    ev("() => document.getElementById('nb-import').click()")
    s.wait_for_timeout(300)
    vor_klick = {"dialog": ev(dlg), "kamera": ev("() => window.__kamera")}
    ev("() => document.querySelector('[role=dialog] .qr-scannen').click()")
    try:
        s.wait_for_function("() => document.querySelector('[role=dialog] textarea')?.value.startsWith('freedom-geraet:')", timeout=10000)
    except Exception:
        pass
    gelesen = ev(dlg) or {}
    spuren = ev("() => ({ kamera: window.__kamera, aus: window.__spuren.length > 0 && window.__spuren.every(t => t.readyState === 'ended'), formate: window.__formate })")
    ev(ok)
    try:
        s.wait_for_function("() => localStorage.getItem('freedom.geraet.person')", timeout=10000)
    except Exception:
        pass
    person = ev("() => localStorage.getItem('freedom.geraet.person')")
    erg["neues_geraet"] = {"vor_klick": vor_klick, "gelesen": {k: v for k, v in gelesen.items() if k != "wert"}, "spuren": spuren,
                           "person_passt": person == person_a}
    ctx.close()
    if not (vor_klick["dialog"] and vor_klick["dialog"]["scan"] is True and vor_klick["kamera"] == 0):
        erg["fehler"].append(f"vor dem Klick {vor_klick}")
    if not (gelesen.get("wert") == code and gelesen.get("videos") == 0 and "Code gelesen – prüfen und bestätigen." in gelesen.get("hinweise", [])):
        erg["fehler"].append(f"gescannt {gelesen.get('videos')} {gelesen.get('hinweise')}")
    if spuren != {"kamera": 1, "aus": True, "formate": ["qr_code"]}:
        erg["fehler"].append(f"Kamera {spuren}")
    if not person or person != person_a:
        erg["fehler"].append("nach dem Import nicht als Gerät der Person angemeldet")
    erg["bestanden"] = not erg["fehler"]
    return erg


def werben_pruefen(browser, url: str) -> dict:
    """Werbelink mit eigener Domain (11.2a): nur https, der Link trägt die Adresse,
    „Prüfen“ fragt erst auf Klick ab und sagt ehrlich, was dort liegt. Kurzer Name
    (11.2b): übernommen nur zum eigenen Schlüssel; der Geworbene fragt genau einmal."""
    erg = {"fehler": []}
    namen = {"ich": None, "werber": "cd" * 32}
    nostr_json = []
    basis = url.rsplit("/", 1)[0]
    dist = Path(__file__).resolve().parent.parent / "packages" / "app" / "dist" / "freedom.html"
    relay = ProbeRelay()
    ctx = browser.new_context(locale="de-DE", viewport={"width": 1280, "height": 800})
    ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith(basis) else r.abort())
    ctx.route_web_socket(re.compile(r"^wss?://"), relay.verbinde)
    kopie = []

    def kopie_test(route):
        cors = {"Access-Control-Allow-Origin": "*"}
        if "/.well-known/nostr.json?name=" in route.request.url:
            name = route.request.url.rsplit("=", 1)[1]
            nostr_json.append(name)
            pk = {"alice": namen["ich"], "fremd": "11" * 32, "bob": namen["werber"]}.get(name)
            route.fulfill(json={"names": {name: pk} if pk else {}}, headers=cors)
            return
        kopie.append(route.request.url)
        if route.request.url.endswith("/freedom.html"):
            route.fulfill(path=str(dist), headers=cors, content_type="text/html")
        elif route.request.url.endswith("/freedom-spiegel.json"):
            route.fulfill(json={"version": 1, "zahlziel": {"lud16": "hosting@kopie.example"}}, headers=cors)
        else:
            route.fulfill(status=404, headers=cors)
    ctx.route("https://kopie.test/**", kopie_test)  # später registriert → zuerst gefragt
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
    ev("() => document.querySelector('.app-nav button[data-tab=\"earn\"]').click()")
    s.wait_for_timeout(500)
    setze = """(a) => { document.getElementById('werben-adresse').value = a; document.getElementById('werben-adresse-setzen').click();
      return { status: document.getElementById('werben-adresse-status').textContent, link: document.getElementById('referral-link').value }; }"""
    http = ev(setze, "http://kopie.test/freedom.html")
    eigen = ev(setze, "https://kopie.test/freedom.html")
    vor_klick = len(kopie)
    ev("() => document.getElementById('werben-adresse-pruefen').click()")
    try:
        s.wait_for_function("() => document.getElementById('werben-adresse-status').textContent.startsWith('Dort:')", timeout=20000)
    except Exception:
        pass
    geprueft = ev("() => [...document.getElementById('werben-adresse-status').children].map(z => z.textContent)")
    ev(setze, "https://tot.test/")
    ev("() => document.getElementById('werben-adresse-pruefen').click()")
    try:
        s.wait_for_function("() => document.getElementById('werben-adresse-status').children.length === 2", timeout=20000)
    except Exception:
        pass
    tot = ev("() => [...document.getElementById('werben-adresse-status').children].map(z => z.textContent)")
    zurueck = ev(setze, "")
    gemerkt = ev("() => localStorage.getItem('freedom.werben.adresse')")
    # 11.2b: kurzer Name – der eigene Schlüssel steht noch im Link
    namen["ich"] = parse_qs(urlparse(zurueck["link"]).query).get("ref", [None])[0]
    name_setzen = """async (n) => { document.getElementById('werben-name').value = n; document.getElementById('werben-name-setzen').click();
      const st = document.getElementById('werben-name-status');
      for (let i = 0; i < 100 && (st.textContent === '' || st.textContent.startsWith('Frage')); i++) await new Promise(r => setTimeout(r, 100));
      return { status: st.textContent, link: document.getElementById('referral-link').value }; }"""
    fremd = ev(name_setzen, "fremd@kopie.test")
    alice = ev(name_setzen, "Alice@kopie.test")
    auf_domain = ev(setze, "https://kopie.test/freedom.html")
    ev(setze, "")
    ohne_name = ev(name_setzen, "")
    ctx.close()
    erg.update({"name_fremd": fremd["status"], "name_link": alice["link"][len(basis):], "name_domain": auf_domain["link"],
                "name_zurueck": ohne_name["link"][len(basis):len(basis) + 20]})
    if not namen["ich"] or len(namen["ich"]) != 64:
        erg["fehler"].append(f"eigener Schlüssel nicht im Link: {zurueck['link'][:60]}")
    if fremd["status"] != "Die Domain nennt unter diesem Namen einen anderen Schlüssel – nicht übernommen." or "fremd" in fremd["link"]:
        erg["fehler"].append(f"fremder Name übernommen? {fremd}")
    if not (alice["status"] == "Übernommen – der Werbelink trägt jetzt den Namen." and alice["link"].endswith("?ref=alice%40kopie.test")):
        erg["fehler"].append(f"Name im Link {alice}")
    if auf_domain["link"] != "https://kopie.test/freedom.html?ref=alice":
        erg["fehler"].append(f"auf der Domain des Namens nur der Teil vor dem @: {auf_domain['link']}")
    if f"?ref={namen['ich']}" not in ohne_name["link"]:
        erg["fehler"].append(f"leer → wieder der Schlüssel: {ohne_name['link'][:80]}")
    # Geworbener: Link mit Namen, die App fragt die Domain genau einmal
    relay2 = ProbeRelay()
    ctx = browser.new_context(locale="de-DE", viewport={"width": 1280, "height": 800})
    ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith(basis) else r.abort())
    ctx.route_web_socket(re.compile(r"^wss?://"), relay2.verbinde)
    ctx.route("https://kopie.test/**", kopie_test)
    s = ctx.new_page()
    s.on("pageerror", lambda e: erg["fehler"].append(str(e)[:300]))
    vorher = len(nostr_json)
    s.goto(url + "?ref=bob%40kopie.test", wait_until="load")
    try:
        s.wait_for_function(f"() => localStorage.getItem('freedom.referrer') === '{namen['werber']}'", timeout=20000)
    except Exception:
        pass
    werber = s.evaluate("() => [localStorage.getItem('freedom.referrer'), localStorage.getItem('freedom.referrer.name')]")
    s.reload(wait_until="load")
    s.wait_for_timeout(1500)
    fragen = nostr_json[vorher:]
    ctx.close()
    erg.update({"geworben": werber, "fragen": fragen})
    if werber != [namen["werber"], None]:
        erg["fehler"].append(f"Werber aus dem Namen nicht gemerkt: {werber}")
    if fragen != ["bob"]:
        erg["fehler"].append(f"Domain nicht genau einmal gefragt: {fragen}")
    erg.update({"http": http["status"], "link": eigen["link"][:60], "vor_klick": vor_klick, "geprueft": geprueft, "tot": tot,
                "zurueck": zurueck["link"][:40], "gemerkt": gemerkt})
    if http["status"] != "Nur https: Über http könnte unterwegs jeder die App austauschen." or http["link"].startswith("http://kopie.test"):
        erg["fehler"].append(f"http abgewiesen? {http}")
    if not (eigen["link"].startswith("https://kopie.test/freedom.html?ref=") and eigen["status"].startswith("Übernommen")):
        erg["fehler"].append(f"eigene Adresse im Link {eigen}")
    if vor_klick != 0:
        erg["fehler"].append(f"Abfrage vor dem Klick: {vor_klick}")
    if geprueft != ["Dort: Kein Manifest eines bekannten Signierers gefunden. Die Datei lässt sich nicht prüfen — das heißt nicht, dass sie falsch ist, nur dass niemand für sie bürgt.",
                    "Hosting-Anteil laut freedom-spiegel.json an: hosting@kopie.example"]:
        erg["fehler"].append(f"Prüfen {geprueft}")
    if tot != ["Nicht geprüft: Die Adresse antwortet nicht oder erlaubt keine Abfrage aus dem Browser (CORS).",
               "Keine gültige freedom-spiegel.json dort – der Hosting-Anteil bleibt beim Provider."]:
        erg["fehler"].append(f"tote Adresse {tot}")
    if not zurueck["link"].startswith(basis) or gemerkt is not None:
        erg["fehler"].append(f"zurück zur eigenen Herkunft {zurueck['link'][:40]} {gemerkt}")
    erg["bestanden"] = not erg["fehler"]
    return erg


def unsicher_pruefen(browser, url: str) -> dict:
    """B-10b: Über http im Heimnetz (App vom eigenen Knoten, B-10a) ist die Seite kein
    sicherer Kontext – kein crypto.subtle. Nachgestellt wie im Browser unter
    http://<rechner>:<port>/ gesehen; der Tresor sagt es, statt zu scheitern, und legt nichts an."""
    erg = {"fehler": []}
    ctx = browser.new_context(locale="de-DE")
    basis = url.rsplit("/", 1)[0]
    ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith(basis) else r.abort())
    ctx.add_init_script("Object.defineProperty(window, 'isSecureContext', { value: false });"
                        "Object.defineProperty(crypto, 'subtle', { value: undefined });")
    s = ctx.new_page()
    s.on("pageerror", lambda e: erg["fehler"].append(str(e)[:300]))
    ev = s.evaluate
    s.goto(url, wait_until="load")
    s.wait_for_function("() => typeof window.freedomApp === 'object'", timeout=30000)
    erg["nachgestellt"] = ev("() => window.isSecureContext === false && crypto.subtle === undefined")
    ev("() => document.querySelector('.modal-backdrop')?.remove()")
    ev("() => document.querySelector('.app-nav button[data-tab=\"settings\"]').click()")
    ev("() => document.querySelector('.sec-action[data-step=\"4\"]').click()")
    s.wait_for_function("() => [...document.querySelectorAll('[role=dialog]')]"
                        ".some(d => d.textContent.includes('ohne sichere Verbindung'))", timeout=30000)
    erg["sagt_es"] = ev("() => !document.getElementById('tr-neu1')")
    s.keyboard.press("Escape")
    s.wait_for_timeout(500)
    # Die Datenbank legt schon die Frage „gibt es einen Tresor?“ an – zählt nur, ob ein Tresor darin liegt
    erg["kein_tresor"] = ev("""async () => localStorage.getItem('freedom.vault') === null
      && await new Promise((r) => { const q = indexedDB.open('freedom-vault');
        q.onsuccess = () => { const db = q.result;
          if (!db.objectStoreNames.contains('tresor')) return r(true);
          const g = db.transaction('tresor').objectStore('tresor').get('blob');
          g.onsuccess = () => r(g.result === undefined); g.onerror = () => r(false); };
        q.onerror = () => r(false); })""")
    ctx.close()
    erg["bestanden"] = (not erg["fehler"] and erg["nachgestellt"] is True and erg["sagt_es"] is True
                        and erg["kein_tresor"] is True)
    return erg


def einrichtung_pruefen(browser, url: str) -> dict:
    """Einrichtung beim ersten Start (8.1b), seit C-6e als DOM: Sicherungsdialog, dann jede Seite einmal –
    Knöpfe, nie vorausgewählte Häkchen, die Wahl landet wie in den Settings. Dazu das Logo als SVG-Element,
    das Favicon aus demselben Zeichen und die Felder des Tresor-Dialogs mit Namen für Vorleser."""
    erg = {"fehler": []}
    basis = url.rsplit("/", 1)[0]
    relay = ProbeRelay()
    ctx = browser.new_context(locale="de-DE", viewport={"width": 1280, "height": 800})
    ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith(basis) else r.abort())
    ctx.route_web_socket(re.compile(r"^wss?://"), relay.verbinde)
    # Ein Werber aus dem Werbelink – nur dann zeigt „privat“ das Häkchen dafür
    werber = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
    ctx.add_init_script(f"if (!localStorage.getItem('freedom.referrer')) localStorage.setItem('freedom.referrer', '{werber}');")
    s = ctx.new_page()
    s.on("pageerror", lambda e: erg["fehler"].append(str(e)[:300]))
    ev = s.evaluate
    s.goto(url, wait_until="load")
    s.wait_for_selector("#bk-done", timeout=30000)
    erg["logo"] = ev("""() => { const k = document.querySelector('#head-mark svg'), n = document.querySelector('#nav-mark svg');
        const f = decodeURIComponent(document.querySelector('link[rel=icon]')?.href ?? '');
        return [k?.namespaceURI ?? null, k?.childElementCount ?? 0, k?.getAttribute('width') ?? null, n?.getAttribute('width') ?? null,
                f.startsWith('data:image/svg+xml,<svg') && f.includes('xmlns="http://www.w3.org/2000/svg"') && f.includes('#7BC80A')]; }""")
    erg["sicherung"] = ev("() => [document.querySelectorAll('.modal .mnemonic-list li').length, document.querySelectorAll('#bk-challenge input').length,"
                          " ['bk-copy', 'bk-file', 'bk-done', 'bk-later'].map((i) => document.getElementById(i)?.textContent ?? null)]")
    w = ev("() => [...document.querySelectorAll('.mnemonic-list li')].map(l => l.textContent)")
    ev("(w) => document.querySelectorAll('#bk-challenge input').forEach(i => i.value = w[+i.dataset.pos])", w)
    ev("() => document.getElementById('bk-done').click()")
    lies = """() => { const k = document.querySelector('#einrichtung .onboarding-card');
        return k ? [k.dataset.seite, k.querySelector('h2')?.textContent ?? null, [...k.querySelectorAll('button')].map((b) => b.id),
          [...k.querySelectorAll('input[type=checkbox]')].map((i) => [i.id, i.checked]),
          [...k.querySelectorAll('#ein-netz option')].map((o) => o.value), k.querySelector('p')?.childNodes.length ?? 0,
          k.lastElementChild.textContent] : null; }"""
    seiten = []
    s.wait_for_selector("#einrichtung .onboarding-card[data-seite=schutz]", timeout=15000)
    seiten.append(ev(lies))
    # Der Tresor-Dialog aus der Einrichtung: abbrechen führt zur nächsten Seite
    ev("() => document.getElementById('ein-tresor').click()")
    s.wait_for_selector("#tr-neu1", timeout=10000)
    erg["tresor_felder"] = ev("() => ['tr-neu1', 'tr-neu2'].map((i) => [document.getElementById(i).type, document.getElementById(i).getAttribute('aria-label')])")
    ev("() => document.getElementById('tr-abbruch').click()")
    for seite, knopf in [("zahlen", "ein-solana"), ("privat", "ein-weiter"), ("los", "ein-nutzen")]:
        s.wait_for_selector(f"#einrichtung .onboarding-card[data-seite={seite}]", timeout=10000)
        seiten.append(ev(lies))
        if seite == "privat":
            erg["werber"] = ev("() => document.getElementById('ein-werber').parentElement.textContent")
        ev(f"() => document.getElementById('{knopf}').click()")
    s.wait_for_function("() => !document.getElementById('einrichtung')", timeout=10000)
    erg["seiten"] = seiten
    erg["danach"] = ev("() => [localStorage.getItem('freedom.standardSchiene'), localStorage.getItem('freedom.intent'),"
                       " localStorage.getItem('freedom.referrer.zustimmung'), location.hash]")
    ctx.close()
    fuss = lambda nr: f"Schritt {nr} von 5 · Einrichtung überspringen"  # noqa: E731
    if erg["logo"] != ["http://www.w3.org/2000/svg", 3, "18", "30", True]:
        erg["fehler"].append(f"Logo {erg['logo']}")
    if erg["sicherung"] != [12, 3, ["kopieren", "als Datei sichern", "bestätigen", "später bestätigen"]]:
        erg["fehler"].append(f"Sicherung {erg['sicherung']}")
    if erg["tresor_felder"] != [["password", "Passphrase (mind. 8 Zeichen)"], ["password", "noch einmal"]]:
        erg["fehler"].append(f"Tresor-Felder {erg['tresor_felder']}")
    erwartet = [
        ["schutz", "Schutz", ["ein-tresor", "ein-weiter", "ein-abbrechen"], [], [], 1, fuss(2)],
        ["zahlen", "Womit zahlst du?", ["ein-lightning", "ein-solana", "ein-abbrechen"], [], [], 1, fuss(3)],
        ["privat", "Privat von Anfang an", ["ein-weiter", "ein-abbrechen"], [["ein-kontakte", False], ["ein-werber", False]],
         ["klar", "tor", "mixnet"], 7, fuss(4)],
        ["los", "Womit fängst du an?", ["ein-nutzen", "ein-kommunizieren", "ein-verdienen", "ein-abbrechen"], [], [], 1, fuss(5)],
    ]
    if seiten != erwartet:
        erg["fehler"].append(f"Seiten {seiten}")
    if "79be667e" not in erg.get("werber", "") or "öffentlich als meinen Werber nennen" not in erg.get("werber", ""):
        erg["fehler"].append(f"Werber {erg.get('werber')}")
    if erg["danach"] != ["solana", "nutzen", "0", "#/agent"]:
        erg["fehler"].append(f"danach {erg['danach']}")
    erg["bestanden"] = not erg["fehler"]
    return erg


def weckworker_pruefen(browser, url: str) -> dict:
    """B-12c (W3 A): freedom-sw.js lässt sich unter der CSP der App anmelden (worker-src 'self').
    Ein Push – hier mit Daten, die nie erscheinen dürfen – ergibt genau eine Meldung mit festem
    Text in der Sprache aus der Adresse, ohne Inhalt und Absender. Danach wieder abgemeldet.
    Die App selbst meldet ihn beim Start nicht an (das tut erst der Haken aus B-12d)."""
    erg = {"fehler": []}
    ursprung = url.rsplit("/", 1)[0]
    # Meldungen zeigt nur das volle Chromium (die Headless-Shell verweigert sie immer)
    voll = browser.browser_type.launch(channel="chromium")
    ctx = voll.new_context(locale="de-DE")
    ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith(ursprung) else r.abort())
    ctx.grant_permissions(["notifications"], origin=ursprung)
    s = ctx.new_page()
    s.on("pageerror", lambda e: erg["fehler"].append(str(e)[:300]))
    s.goto(url, wait_until="load")
    s.wait_for_function("() => typeof window.freedomApp === 'object'", timeout=30000)
    erg["ohne_worker"] = s.evaluate("async () => (await navigator.serviceWorker.getRegistrations()).length")
    cdp = ctx.new_cdp_session(s)
    regs: list = []
    cdp.on("ServiceWorker.workerRegistrationUpdated", lambda p: regs.extend(p.get("registrations", [])))
    cdp.send("ServiceWorker.enable")
    scope = s.evaluate("async () => (await navigator.serviceWorker.register('freedom-sw.js?sprache=de')).scope")
    s.evaluate("async () => { await navigator.serviceWorker.ready; return true; }")
    for _ in range(100):
        if any(r.get("scopeURL") == scope and not r.get("isDeleted") for r in regs):
            break
        s.wait_for_timeout(100)
    reg_id = next((r["registrationId"] for r in regs if r.get("scopeURL") == scope and not r.get("isDeleted")), None)
    erg["angemeldet"] = scope == ursprung + "/" and reg_id is not None
    meldungen = "async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => [n.title, n.body, n.tag])"
    # Chromium verliert einen Push per CDP, der direkt nach der Aktivierung kommt (gemessen in C-20h1: 3 von 40 ohne,
    # 0 von 40 mit einer Sekunde Abstand; ein zweiter Push zeigte die Meldung jedes Mal). Also bis zu fünfmal zustellen,
    # je mit Frist, bis eine Meldung da ist – dasselbe Tag ersetzt sie, es bleibt eine. wait_for_function wartet nicht
    # auf ein Promise – also selbst fragen.
    erg["zustellungen"] = 0
    for _ in range(5 if reg_id is not None else 0):
        cdp.send("ServiceWorker.deliverPushMessage", {"origin": ursprung, "registrationId": reg_id, "data": "GEHEIMER-INHALT"})
        erg["zustellungen"] += 1
        for _ in range(20):
            if s.evaluate(meldungen):
                break
            s.wait_for_timeout(200)
        if s.evaluate(meldungen):
            break
    erg["meldungen"] = s.evaluate(meldungen)
    erg["abgemeldet"] = s.evaluate("async () => { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();"
                                   " return (await navigator.serviceWorker.getRegistrations()).length === 0; }")
    ctx.close()
    voll.close()
    if erg["ohne_worker"] != 0:
        erg["fehler"].append(f"die App meldet schon beim Start einen Worker an ({erg['ohne_worker']})")
    if not erg["angemeldet"]:
        erg["fehler"].append(f"nicht angemeldet: {scope}")
    if erg["meldungen"] != [["Neue Nachricht", "Öffne FreedomStack, um sie zu lesen – Inhalt und Absender kennt nur die App.", "freedom-weck"]]:
        erg["fehler"].append(f"Meldung {erg['meldungen']}")
    if not erg["abgemeldet"]:
        erg["fehler"].append("nicht abgemeldet")
    erg["bestanden"] = not erg["fehler"]
    return erg


# Meshtastic über USB (seit 7.5d): ein Gerät mit Hauptkanal, aber ohne Kanal „freedom“ – antwortet auf `want_config`
# mit Nachrichten aus der Referenz (meshtastic 2.7.11) und legt den Kanal nur an, wenn genau `set_channel` aus der
# Referenz kommt. Zählt alles, was ankommt.
MESHTASTIC_ATTRAPPE = """
((ref) => {
  const hex = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));
  const alsHex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  const st = window.__mt = { geoeffnet: 0, fragen: 0, admin: 0, fremd: 0, kanal: false };
  let ctrl, puffer = [];
  const sende = (m) => ctrl.enqueue(Uint8Array.from([0x94, 0xc3, m.length >> 8, m.length & 0xff, ...m]));
  const nimm = (m) => {
    if (m[0] === 0x18) {
      let id = 0, f = 1;
      for (let i = 1; i < m.length; i++) { id += (m[i] & 0x7f) * f; f *= 128; if (m[i] < 0x80) break; }
      st.fragen++;
      const fertig = [0x38]; for (let n = id; ; n = Math.floor(n / 128)) { if (n < 0x80) { fertig.push(n); break; } fertig.push((n % 128) | 0x80); }
      for (const a of [ref.ich, ref.lora, ref.primaer, ...(st.kanal ? [ref.kanal] : [])]) sende(hex(a));
      sende(Uint8Array.from(fertig));
    } else if (alsHex(m) === ref.anlegen) { st.admin++; st.kanal = true; }
    else st.fremd++;
  };
  const port = {
    async open() { st.geoeffnet++; },
    async close() {},
    readable: new ReadableStream({ start(c) { ctrl = c; } }),
    writable: new WritableStream({ write(chunk) {
      puffer.push(...chunk);
      for (;;) {
        const i = puffer.findIndex((b, j) => b === 0x94 && puffer[j + 1] === 0xc3);
        if (i < 0 || puffer.length < i + 4) break;
        const n = (puffer[i + 2] << 8) | puffer[i + 3];
        if (puffer.length < i + 4 + n) break;
        nimm(Uint8Array.from(puffer.slice(i + 4, i + 4 + n)));
        puffer = puffer.slice(i + 4 + n);
      }
    } }),
  };
  Object.defineProperty(navigator, 'serial', { value: { requestPort: async () => port, getPorts: async () => [] } });
})(__REF__);
"""


def meshtastic_pruefen(browser, url: str) -> dict:
    """Meshtastic über USB (7.5b–d): erkannt, Hinweis auf den fehlenden Kanal samt öffentlichem Schlüssel, „Kanal anlegen“
    erst nach der Rückfrage (Abbrechen schickt nichts), danach ist der Hinweis weg."""
    erg = {"fehler": []}
    wurzel = Path(__file__).resolve().parent.parent
    r = json.loads((wurzel / "packages/protocol/test/fixtures/meshtastic-referenz.json").read_text())
    vom = {f["fall"]: f["hex"] for f in r["vomGeraet"]}
    anlegen = next(f["hex"] for f in r["zumGeraet"] if f["fall"] == "kanal-anlegen" and f["index"] == 1)
    ref = {"ich": vom["ich"], "lora": vom["lora"], "primaer": vom["kanal-primaer"], "kanal": vom["kanal"], "anlegen": anlegen}
    seite = DialogSeite(browser, url, ProbeRelay(), erg, init=MESHTASTIC_ATTRAPPE.replace("__REF__", json.dumps(ref)))
    s, ev = seite.s, seite.ev
    mt = "() => ({ ...window.__mt })"
    ev("() => { location.hash = '#/netz'; }")
    s.wait_for_selector('[data-subtab-group="netz"] [data-subtab="mesh"]', timeout=15000)
    ev("() => document.querySelector('[data-subtab-group=\"netz\"] [data-subtab=\"mesh\"]').click()")
    s.wait_for_selector("#mesh-connect", state="visible", timeout=10000)
    erg["vorher"] = ev(mt)
    s.click("#mesh-connect")
    s.wait_for_function("() => document.getElementById('mesh-hinweis').textContent.length > 0", timeout=20000)
    kanal_sichtbar = "() => !document.getElementById('mesh-kanal').classList.contains('hidden')"
    psk = __import__("base64").b64encode(bytes.fromhex(r["kanal"]["psk"])).decode()
    erg["verbunden"] = {"status": ev("() => document.getElementById('mesh-status').textContent"),
                        "hinweis": ev("() => document.getElementById('mesh-hinweis').textContent"),
                        "knopf": ev(kanal_sichtbar), "mt": ev(mt)}
    # Abbrechen: nichts geht an das Gerät
    s.click("#mesh-kanal")
    erg["frage"] = seite.warte_dialog("Kanal „freedom“ auf dem Gerät anlegen?")
    s.keyboard.press("Escape")
    seite.warte_zu()
    s.wait_for_timeout(300)
    erg["abgebrochen"] = ev(mt)
    # Anlegen: genau `set_channel` aus der Referenz, danach neu gefragt – Hinweis und Knopf weg
    s.click("#mesh-kanal")
    seite.warte_dialog("Kanal „freedom“ auf dem Gerät anlegen?")
    dialog_ok(seite, "Kanal „freedom“ anlegen")
    s.wait_for_function(f"() => document.getElementById('mesh-hinweis').textContent === '' && !({kanal_sichtbar})()", timeout=20000)
    erg["angelegt"] = ev(mt)
    v = erg["verbunden"]
    if erg["vorher"] != {"geoeffnet": 0, "fragen": 0, "admin": 0, "fremd": 0, "kanal": False}:
        erg["fehler"].append(f"vor dem Klick: {erg['vorher']}")
    if not ("Meshtastic-Gerät (USB)" in v["status"] or v["status"] in ("bereit", "")):
        erg["fehler"].append(f"Status {v['status']!r}")
    if not ("fehlt der Kanal „freedom“" in v["hinweis"] and psk in v["hinweis"] and v["knopf"] is True
            and v["mt"]["geoeffnet"] == 1 and v["mt"]["fragen"] >= 1 and v["mt"]["admin"] == 0 and v["mt"]["fremd"] == 0):
        erg["fehler"].append(f"verbunden {v}")
    if not (erg["frage"] and "öffentlich" in json.dumps(erg["frage"], ensure_ascii=False)):
        erg["fehler"].append(f"Rückfrage {erg['frage']}")
    if erg["abgebrochen"]["admin"] != 0 or erg["abgebrochen"]["fremd"] != 0:
        erg["fehler"].append(f"abgebrochen {erg['abgebrochen']}")
    a = erg["angelegt"]
    if not (a["admin"] == 1 and a["kanal"] is True and a["fremd"] == 0 and a["fragen"] > v["mt"]["fragen"]):
        erg["fehler"].append(f"angelegt {a}")
    erg["browser_dialoge"] = seite.browser_dialoge
    if seite.browser_dialoge:
        erg["fehler"].append(f"Browser-Dialoge: {seite.browser_dialoge}")
    seite.ctx.close()
    erg["bestanden"] = not erg["fehler"]
    return erg


ANTWORT_MD = "**fett** <img src=x onerror=alert(1)>\n\n```ts\nconst a = \"<b>\"; // x\n```"


def gratis_auto_pruefen(browser, url: str) -> dict:
    """Tarif „Automatisch“ (A-14b2): Vorgabe im Agenten. Ohne Gratis-Anbieter und ohne Wallet geht
    nichts hinaus, kein Dialog fragt nach Geld – nur ein Hinweis, die Frage bleibt im Feld."""
    erg = {"fehler": []}
    basis = url.rsplit("/", 1)[0]
    relay = ProbeRelay()
    ctx = browser.new_context(locale="de-DE", viewport={"width": 1280, "height": 800})
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
    ev("() => document.querySelector('.app-nav button[data-tab=\"ai\"]').click()")
    s.wait_for_timeout(500)
    erg["vorgabe"] = ev("() => document.getElementById('ai-tier').value")
    vorher = len(relay.gesendet)
    frage = "Automatisch ohne Wallet 8150"
    ev("(f) => { document.getElementById('ai-prompt').value = f; document.getElementById('ai-send').click(); }", frage)
    try:
        s.wait_for_function("() => (document.getElementById('toast')?.textContent ?? '').startsWith('Gerade bietet kein erreichbarer Provider gratis an')", timeout=20000)
        erg["hinweis"] = True
    except Exception:
        erg["hinweis"] = False
    erg["danach"] = ev("() => ({ feld: document.getElementById('ai-prompt').value, laeuft: document.getElementById('ai-send').dataset.running ?? '',"
                       " dialog: !!document.querySelector('.modal.dlg-box, .dlg-box'),"
                       " fragen: [...document.querySelectorAll('#ai-thread .bubble.user')].filter(b => b.textContent.includes('8150')).length })")
    neu = relay.gesendet[vorher:]
    erg["relay"] = [e.get("kind") for e in neu if e.get("kind") == 1059 or 5000 <= int(e.get("kind", 0)) < 7000 or "8150" in json.dumps(e)]
    ctx.close()
    if erg["vorgabe"] != "auto":
        erg["fehler"].append(f"Vorgabe {erg['vorgabe']}")
    if not erg["hinweis"]:
        erg["fehler"].append("kein Hinweis")
    if erg["danach"] != {"feld": frage, "laeuft": "", "dialog": False, "fragen": 0}:
        erg["fehler"].append(f"danach {erg['danach']}")
    if erg["relay"]:
        erg["fehler"].append(f"hinaus {erg['relay']}")
    erg["bestanden"] = not erg["fehler"]
    return erg


def lokal_pruefen(browser, url: str) -> dict:
    """KI auf diesem Gerät (B-1): „Dieses Gerät“ steht in der Modellwahl, gesucht wird
    erst auf Klick, die Frage geht nur an localhost – kein Auftrag, kein Umschlag ans Relay."""
    erg = {"fehler": []}
    basis = url.rsplit("/", 1)[0]
    relay = ProbeRelay()
    ctx = browser.new_context(locale="de-DE", viewport={"width": 1280, "height": 800})
    ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith(basis) else r.abort())
    ctx.route_web_socket(re.compile(r"^wss?://"), relay.verbinde)
    lokal = []

    def modell_dienst(route):
        req = route.request
        lokal.append({"methode": req.method, "url": req.url, "inhalt": req.post_data or ""})
        cors = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS"}
        if req.method == "OPTIONS":
            route.fulfill(status=204, headers=cors)
        elif req.url.endswith("/v1/models"):
            route.fulfill(json={"data": [{"id": "probe-modell:1b"}]}, headers=cors)
        elif req.url.endswith("/v1/chat/completions"):
            # C-6d2: auf Wunsch eine Antwort mit Markdown, HTML darin und einem Code-Block
            inhalt = ANTWORT_MD if "Markdown bitte" in (req.post_data or "") else "Antwort vom Gerät"
            route.fulfill(json={"model": "probe-modell:1b", "choices": [{"message": {"content": inhalt}}],
                                "usage": {"prompt_tokens": 7, "completion_tokens": 3}}, headers=cors)
        else:
            route.fulfill(status=404, headers=cors)
    ctx.route("http://localhost:11434/**", modell_dienst)  # später registriert → zuerst gefragt
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
    ev("() => document.querySelector('.app-nav button[data-tab=\"ai\"]').click()")
    s.wait_for_timeout(500)
    ev("() => document.getElementById('ai-model-btn').click()")
    s.wait_for_selector("#model-popover .lokal-suchen", timeout=20000)
    vor_klick = len(lokal)
    ev("() => document.querySelector('#model-popover .lokal-suchen').click()")
    karte = '#model-popover .model-card[data-model="lokal:probe-modell:1b"]'
    s.wait_for_selector(karte, timeout=10000)
    ev(f"() => document.querySelector('{karte}').click()")
    wahl = ev("() => ({ wert: document.getElementById('ai-model').value, knopf: document.getElementById('ai-model-btn').textContent.trim(),"
              " aktiv: localStorage.getItem('freedom.lokal.aktiv') })")
    vorher = len(relay.gesendet)
    frage = "Geheime Frage an das Gerät 4711"
    ev("(f) => { document.getElementById('ai-prompt').value = f; document.getElementById('ai-send').click(); }", frage)
    try:
        s.wait_for_function("() => [...document.querySelectorAll('#ai-thread .bubble.ai')].some(b => b.textContent.includes('Antwort vom Gerät'))", timeout=15000)
    except Exception:
        pass
    antwort = ev("() => { const b = [...document.querySelectorAll('#ai-thread .bubble.ai')].pop();"
                 " return b ? { text: b.querySelector('.body')?.textContent ?? '', meta: b.querySelector('.cost')?.textContent ?? '' } : null; }")
    s.wait_for_timeout(1000)
    neu = relay.gesendet[vorher:]
    anfragen = [a for a in lokal if a["methode"] == "POST"]
    # C-6d2: Antworten als DOM – HTML aus der Antwort bleibt Text, der Code-Block ist gefärbt
    # und kopiert den Code selbst
    ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=basis)
    ev("() => { document.getElementById('ai-prompt').value = 'Markdown bitte'; document.getElementById('ai-send').click(); }")
    try:
        s.wait_for_function("() => document.querySelector('#ai-thread .bubble.ai .codeblock .cb-copy')", timeout=15000)
        ev("() => document.querySelector('#ai-thread .bubble.ai .codeblock .cb-copy').click()")
        s.wait_for_function("() => document.querySelector('#ai-thread .bubble.ai .cb-copy').textContent.includes('kopiert')", timeout=5000)
    except Exception:
        pass
    erg["antwort_md"] = ev("""async () => { const b = [...document.querySelectorAll('#ai-thread .bubble.ai')].pop();
        const k = b?.querySelector('.codeblock');
        return [b?.querySelectorAll('img, script, [onerror]').length ?? -1, b?.querySelector('.body p')?.textContent ?? '',
          b?.querySelector('.body strong')?.textContent ?? '', k?.querySelector('.cb-head span')?.textContent ?? '',
          [...(k?.querySelectorAll('code span') ?? [])].map((x) => `${x.className}:${x.textContent}`),
          k?.querySelector('.cb-copy')?.textContent ?? '', await navigator.clipboard.readText().catch(() => '')]; }""")
    if erg["antwort_md"] != [0, "fett <img src=x onerror=alert(1)>", "fett", "ts",
                             ["tok-kw:const", 'tok-str:"<b>"', "tok-com:// x"], "✓ kopiert", 'const a = "<b>"; // x']:
        erg["fehler"].append(f"Antwort mit Markdown {erg['antwort_md']}")
    # D2: privat – mit der Wahl „Netz“ geht nichts hinaus (kein Umschlag, keine Frage an localhost), die Frage bleibt
    # im Feld; mit „Dieses Gerät“ antwortet das Gerät wie bisher
    ev("() => document.getElementById('ai-privat').click()")
    modell_vorher = ev("() => document.getElementById('ai-model').value")
    ev("() => { document.getElementById('ai-model').value = ''; }")
    vorher_p, lokal_p = len(relay.gesendet), len(lokal)
    ev("() => { document.getElementById('ai-prompt').value = 'Privat ins Netz 2342'; document.getElementById('ai-send').click(); }")
    try:
        s.wait_for_function("() => (document.getElementById('toast')?.textContent ?? '').startsWith('Diese Unterhaltung ist privat')", timeout=5000)
        hinweis = True
    except Exception:
        hinweis = False
    erg["privat"] = ev("() => ({ feld: document.getElementById('ai-prompt').value, laeuft: document.getElementById('ai-send').dataset.running ?? '',"
                       " fragen: [...document.querySelectorAll('#ai-thread .bubble.user')].filter(b => b.textContent.includes('Privat ins Netz')).length })")
    erg["privat"]["hinweis"] = hinweis
    neu_p = relay.gesendet[vorher_p:]
    # Nur, was eine KI-Frage wäre (Umschlag, Auftrag) oder ihren Text trägt – andere Abgleiche dürfen laufen
    erg["privat"]["relay"] = [e.get("kind") for e in neu_p if e.get("kind") == 1059 or 5000 <= int(e.get("kind", 0)) < 7000
                              or "Privat ins Netz" in json.dumps(e)]
    ev("(m) => { document.getElementById('ai-model').value = m; document.getElementById('ai-prompt').value = 'Privat ans Gerät'; document.getElementById('ai-send').click(); }", modell_vorher)
    try:
        s.wait_for_function("() => [...document.querySelectorAll('#ai-thread .bubble.user')].some(b => b.textContent.includes('Privat ans Gerät'))", timeout=10000)
        s.wait_for_function("() => document.getElementById('ai-send').dataset.running !== '1'", timeout=15000)
    except Exception:
        pass
    erg["privat"]["geraet"] = len([a for a in lokal[lokal_p:] if a["methode"] == "POST" and "Privat ans Gerät" in a["inhalt"]])
    ev("() => document.getElementById('ai-privat').click()")
    if erg["privat"] != {"feld": "Privat ins Netz 2342", "laeuft": "", "fragen": 0, "hinweis": True, "relay": [], "geraet": 1}:
        erg["fehler"].append(f"Privat {erg['privat']}")
    # Mein Knoten (B-9a): gekoppelt steht die Gruppe zwischen Netz und Gerät; die Frage geht nur als Umschlag an den
    # Knoten (kein Klartext, kein anderer Provider), ohne Antwort wartet die App – „Stopp“ bricht ab
    knoten_pk = "ab" * 32
    ev("() => document.getElementById('knoten-koppeln').click()")
    s.wait_for_selector("[role=dialog] input", timeout=10000)
    ev("(c) => { document.querySelector('[role=dialog] input').value = c; }", "freedom-kopplung:1:" + knoten_pk + ":" + "cd" * 32)
    ev("() => document.querySelector('[role=dialog] .dlg-knoepfe button:last-child').click()")
    s.wait_for_function("() => !document.querySelector('[role=dialog][aria-modal=true]')", timeout=10000)
    ev("() => document.getElementById('ai-model-btn').click()")
    karte_k = '#model-popover .knoten-bereich .model-card[data-model="knoten:"]'
    s.wait_for_selector(karte_k, timeout=20000)
    gruppen = ev("() => [...document.querySelectorAll('#model-popover .mc-gruppe')].map(g => g.textContent)")
    ev(f"() => document.querySelector('{karte_k}').click()")
    knopf_k = ev("() => document.getElementById('ai-model-btn').textContent.trim()")
    vorher_k = len(relay.gesendet)
    frage_k = "Frage an meinen Knoten 0815"
    ev("(f) => { document.getElementById('ai-prompt').value = f; document.getElementById('ai-send').click(); }", frage_k)
    for _ in range(150):
        if any(e.get("kind") == 1059 for e in relay.gesendet[vorher_k:]):
            break
        s.wait_for_timeout(100)
    s.wait_for_timeout(500)
    ev("() => document.getElementById('ai-send').click()")  # Stopp
    try:
        s.wait_for_function("() => [...document.querySelectorAll('#ai-thread .bubble.ai')].some(b => b.textContent.includes('[abgebrochen]'))", timeout=15000)
        abgebrochen = True
    except Exception:
        abgebrochen = False
    neu_k = list({e["id"]: e for e in relay.gesendet[vorher_k:]}.values())
    umschlaege = [e for e in neu_k if e.get("kind") == 1059]
    erg["knoten"] = {"gruppen": gruppen, "knopf": knopf_k, "abgebrochen": abgebrochen,
                     "arten": sorted({e.get("kind") for e in neu_k}),
                     "an": sorted({t[1] for e in umschlaege for t in e["tags"] if t[0] == "p"})}
    if gruppen != ["Netz", "Mein Knoten", "Dieses Gerät"] or knopf_k != "Modell des Knotens · mein Knoten" or not abgebrochen \
            or len(umschlaege) != 1 or erg["knoten"]["an"] != [knoten_pk] \
            or any(5000 <= int(e.get("kind", 0)) < 7000 for e in neu_k) or any(frage_k in json.dumps(e) for e in neu_k):
        erg["fehler"].append(f"Mein Knoten {erg['knoten']}")
    ctx.close()
    erg.update({"vor_klick": vor_klick, "wahl": wahl, "antwort": antwort, "lokal": [f"{a['methode']} {a['url']}" for a in lokal],
                "relay_danach": [e.get("kind") for e in neu]})
    if vor_klick != 0:
        erg["fehler"].append(f"Abfrage vor dem Klick: {vor_klick}")
    if wahl != {"wert": "lokal:probe-modell:1b", "knopf": "probe-modell:1b · dieses Gerät", "aktiv": "1"}:
        erg["fehler"].append(f"Wahl {wahl}")
    if not antwort or antwort["text"].strip() != "Antwort vom Gerät" or antwort["meta"] != "dieses Gerät · 10 Tokens · gratis":
        erg["fehler"].append(f"Antwort {antwort}")
    if len(anfragen) != 1 or not anfragen[0]["url"].endswith("/v1/chat/completions") or frage not in anfragen[0]["inhalt"]:
        erg["fehler"].append(f"Frage an localhost {anfragen}")
    if any(e.get("kind") == 1059 or 5000 <= int(e.get("kind", 0)) < 7000 for e in neu) or any(frage in json.dumps(e) for e in neu):
        erg["fehler"].append(f"ans Relay nach der Frage: {erg['relay_danach']}")
    erg["bestanden"] = not erg["fehler"]
    return erg


def raum_probe_daten(ich: str) -> dict:
    """Probe-Raum: `events` (der eigene Schlüssel wird Moderator) und seit B-7 `uebernahme` (Definition eines Fremden)."""
    wurzel = Path(__file__).resolve().parent.parent
    aus = subprocess.run(["npx", "tsx", "scripts/raum-probe.mts", ich], cwd=wurzel, capture_output=True,
                         text=True, timeout=180, check=True)
    return json.loads(aus.stdout)


def raum_probe(ich: str) -> list[dict]:
    """Events des Probe-Raums; der eigene Schlüssel wird Moderator."""
    return raum_probe_daten(ich)["events"]


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
        # „Neu“ (C-13b): allgemein schon gelesen bis kurz nach den ersten Nachrichten (gestern 10:00 + 130 s, wie raum-probe.mts)
        gelesen = (int(datetime.datetime.now(datetime.timezone.utc).timestamp()) // 86400) * 86400 - 86400 + 10 * 3600 + 130
        ctx.add_init_script(f"localStorage.setItem('freedom.lastRead', JSON.stringify({{ allgemein: {gelesen} }}));")
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
        probe = raum_probe_daten(relay.ich)
        relay.events = probe["events"]
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
            neu: [th.querySelectorAll('.msg-neu').length, th.querySelector('.msg-neu')?.textContent ?? '',
              th.querySelector('.msg-neu')?.nextElementSibling?.querySelector('.msg-text')?.textContent ?? ''],
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
        # Seit B-15b: Umfragen und Termine nur im privaten Raum – im offenen Probe-Raum weder Knöpfe noch Kasten
        planung = ev("() => ['kanal-umfrage', 'kanal-termin', 'kanal-planung'].map(id => document.getElementById(id)?.classList.contains('hidden'))")
        erg[groesse]["planung_offen"] = planung
        if planung != [True, True, True]:
            erg["fehler"].append(f"{groesse}: Umfragen/Termine im offenen Raum sichtbar {planung}")
        erwartet = {"gruppen": [2, 2, 1], "tage": 2, "bilder": 0, "xss": False, "alsText": True, "aktionen": 5, "schreiben": True,
                    "neu": [1, "Neu", "Hallo! <img src=x onerror=\"window.__raumXss=1\"> bleibt Text."]}
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
        # Mitglieder (C.2d1): Namen mit Rollen, ein Menü je Mitglied nach meinen Rechten; mobil als Ebene
        if mobil:
            ev("() => document.getElementById('kanal-mitglieder').click()")
            s.wait_for_timeout(200)
        mitglieder = ev("""() => { const r = (e) => e.getBoundingClientRect(); const col = document.querySelector('.comm-space-inner .member-col');
          return { sichtbar: r(col).width > 0, kanal: r(document.querySelector('.channel-main')).width > 0,
            zeilen: [...col.querySelectorAll('#member-list .member-row')].map(z => [z.querySelector('.mitglied-name').textContent === 'Du',
              [...z.querySelectorAll('.msg-role')].map(x => x.textContent), !!z.querySelector('.mitglied-knopf')]) }; }""")
        ev("() => document.querySelectorAll('#member-list .member-row')[1].querySelector('.mitglied-knopf').click()")
        s.wait_for_timeout(150)
        menue_stand = """() => { const m = document.querySelector('.menue-schwebend');
          return { punkte: m ? [...m.querySelectorAll('[role=menuitem]')].map(b => b.textContent) : null,
            fokus: document.activeElement?.textContent ?? null }; }"""
        auf_m = ev(menue_stand)
        s.keyboard.press("ArrowDown")
        runter = ev(menue_stand)["fokus"]
        s.keyboard.press("Escape")
        s.wait_for_timeout(100)
        zu_m = ev("() => [!!document.querySelector('.menue-schwebend'), document.activeElement?.classList.contains('mitglied-knopf')]")
        erg[groesse]["mitglieder"] = {"liste": mitglieder, "menue": auf_m, "runter": runter, "zu": zu_m}
        soll_zeilen = [[False, ["Gründer"], True], [False, ["Mitglied"], True], [False, ["Mitglied"], True], [True, ["Moderator"], False]]
        if not mitglieder["sichtbar"] or mitglieder["kanal"] == mobil or mitglieder["zeilen"] != soll_zeilen:
            erg["fehler"].append(f"{groesse}: Mitglieder {mitglieder}")
        if auf_m != {"punkte": ["Direktnachricht schreiben", "Rolle vergeben", "Absender sperren"], "fokus": "Direktnachricht schreiben"} \
                or runter != "Rolle vergeben" or zu_m != [False, True]:
            erg["fehler"].append(f"{groesse}: Mitglied-Menü {auf_m} {runter} {zu_m}")
        if mobil:
            ev("() => document.getElementById('mitglieder-zu').click()")
            s.wait_for_timeout(200)
            if not ev("() => document.querySelector('.channel-main').getBoundingClientRect().width > 0"):
                erg["fehler"].append("mobil: nach „×“ ist der Kanal nicht wieder da")
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
            # Seit C.2d2 nach Rechten: im fremden Raum weder Moderatoren noch Kanal anlegen – es beginnt mit „Raum beitreten“
            soll = {
                "ArrowDown": [{"offen": True, "expanded": "true", "fokus": "space-join", "dialog": None},
                              {"offen": True, "expanded": "true", "fokus": "space-join", "dialog": None},
                              {"offen": True, "expanded": "true", "fokus": "space-create", "dialog": None}],
                "End": [{"offen": True, "expanded": "true", "fokus": "space-create-public", "dialog": None}],
                "Escape": [{"offen": False, "expanded": "false", "fokus": "space-menue-knopf", "dialog": None},
                           {"offen": False, "expanded": "false", "fokus": "space-menue-knopf", "dialog": None}],
                "Enter": [{"offen": True, "expanded": "true", "fokus": "space-join", "dialog": None},
                          {"offen": False, "expanded": "false", "fokus": None, "dialog": "Raum anlegen (privat)"}],
            }
            # Im Dialog steht der Fokus auf dem Eingabefeld – dessen Id ist nicht fest
            schritte["Enter"][1]["fokus"] = None
            if schritte != soll:
                erg["fehler"].append(f"desktop: Raum-Menü {schritte}")
            # Eigener offener Raum (C.2d2): anlegen, als Gründer einen Kanal anlegen, der nur Moderatoren schreiben lässt
            ev("() => document.getElementById('space-create-public').click()")
            s.wait_for_timeout(200)
            s.keyboard.type("Werkstatt")
            s.keyboard.press("Enter")
            try:
                s.wait_for_function("() => document.getElementById('space-name').textContent === 'Werkstatt'", timeout=10000)
            except Exception:
                pass
            s.keyboard.press("Escape")  # der Dialog mit der Kennung
            rechte = ev("""() => ['space-mods', 'space-kanal-neu'].map(id => !document.getElementById(id).classList.contains('hidden'))""")
            ev("() => document.getElementById('space-kanal-neu').click()")
            s.wait_for_timeout(200)
            s.keyboard.type("Technik & Co")
            s.keyboard.press("Tab")
            s.keyboard.press("Space")
            s.keyboard.press("Enter")
            try:
                s.wait_for_function("() => document.getElementById('channel-name').textContent === '#Technik & Co'", timeout=10000)
            except Exception:
                pass
            kanaele = ev("() => [...document.querySelectorAll('#channel-list .channel-item')].map(b => b.textContent.trim())")
            # Lesestand (C-14): als Objekt je Kanal (ohne Tresor über geheim in localStorage) – nie mehr als Liste von Paaren
            lesestand = ev("() => localStorage.getItem('freedom.lastRead')")
            stand = json.loads(lesestand or "null")
            erg["desktop"]["lesestand"] = stand
            if not isinstance(stand, dict) or not stand or not all(isinstance(v, int) and v > 0 for v in stand.values()):
                erg["fehler"].append(f"desktop: Lesestand {lesestand!r}")
            # Seit B-20b als Kanal-Event (34703) an die Adresse des Raums, nicht mehr als neue Definition
            definitionen = [e for e in relay.gesendet if e.get("kind") == 34700]
            kanal_events = list({e["id"]: e for e in relay.gesendet if e.get("kind") == 34703}.values())  # je Relay-Verbindung einmal gesendet
            neu = [t for e in kanal_events for t in e["tags"] if t[0] == "channel" and t[1] == "technik-co"]
            adresse = [t[1] for e in kanal_events for t in e["tags"] if t[0] == "a"]
            erg["desktop"]["eigener_raum"] = {"rechte": rechte, "kanaele": kanaele, "definitionen": len({e["id"] for e in definitionen}), "neu": neu, "adresse": adresse}
            if rechte != [True, True] or not any(k.endswith("Technik & Co") for k in kanaele) \
                    or neu != [["channel", "technik-co", "Technik & Co", "offen", "2", "mod", ""]] \
                    or len({e["id"] for e in definitionen}) != 1 or len(adresse) != 1 or not adresse[0].startswith("34700:"):
                erg["fehler"].append(f"desktop: eigener Raum, Kanal anlegen {erg['desktop']['eigener_raum']}")
            # Kanal ändern und entfernen (B-20c): umbenennen, dann nach Rückfrage entfernen – je ein Kanal-Event an die Adresse
            s.wait_for_timeout(1100)  # ein späteres Event braucht einen späteren Zeitstempel (Sekunden, wie bei Definitionen)
            ev("() => document.getElementById('space-kanal-aendern').click()")
            s.wait_for_selector("[role=dialog] input", timeout=10000)
            titel_aendern = ev("() => document.getElementById(document.querySelector('[role=dialog]').getAttribute('aria-labelledby'))?.textContent")
            ev("() => { const i = document.querySelector('[role=dialog] input'); i.value = 'Technik'; }")
            ev("() => document.querySelector('[role=dialog] .dlg-knoepfe button:last-child').click()")
            try:
                s.wait_for_function("() => document.getElementById('channel-name').textContent === '#Technik'", timeout=10000)
            except Exception:
                pass
            nach_umbenennen = ev("() => [...document.querySelectorAll('#channel-list .channel-item')].map(b => b.textContent.trim())")
            s.wait_for_timeout(1100)
            ev("() => document.getElementById('space-kanal-aendern').click()")
            s.wait_for_selector("[role=dialog] input", timeout=10000)
            ev("() => { const k = [...document.querySelectorAll('[role=dialog] input[type=checkbox]')].pop(); k.checked = true; }")
            ev("() => document.querySelector('[role=dialog] .dlg-knoepfe button:last-child').click()")
            s.wait_for_timeout(300)
            rueckfrage = ev("() => document.getElementById(document.querySelector('[role=dialog]')?.getAttribute('aria-labelledby') ?? '')?.textContent ?? null")
            ev("() => document.querySelector('[role=dialog] .dlg-knoepfe button:last-child')?.click()")
            try:
                s.wait_for_function("() => ![...document.querySelectorAll('#channel-list .channel-item')].some(b => b.textContent.includes('Technik'))", timeout=10000)
            except Exception:
                pass
            nach_entfernen = ev("() => [...document.querySelectorAll('#channel-list .channel-item')].map(b => b.textContent.trim())")
            kanal_events = list({e["id"]: e for e in relay.gesendet if e.get("kind") == 34703}.values())
            umbenannt = [t for e in kanal_events for t in e["tags"] if t[0] == "channel" and t[1] == "technik-co" and t[2] == "Technik"]
            entfernt = [t for e in kanal_events for t in e["tags"] if t[0] == "entfernt"]
            aendern = {"titel": titel_aendern, "umbenannt": nach_umbenennen, "rueckfrage": rueckfrage, "entfernt": nach_entfernen,
                       "events": [len(umbenannt), entfernt], "definitionen": len({e["id"] for e in relay.gesendet if e.get("kind") == 34700})}
            erg["desktop"]["kanal_aendern"] = aendern
            if titel_aendern != "Kanal „Technik & Co“ ändern" or not any(k.endswith("Technik") and "&" not in k for k in nach_umbenennen) \
                    or rueckfrage != "Kanal entfernen" or any("Technik" in k for k in nach_entfernen) \
                    or umbenannt != [["channel", "technik-co", "Technik", "offen", "2", "mod", ""]] or entfernt != [["entfernt", "technik-co"]] \
                    or aendern["definitionen"] != 1:
                erg["fehler"].append(f"desktop: Kanal ändern und entfernen {aendern}")
        # Seit B-7: gemerkt ist die Adresse mit dem Gründer – eine neuere Definition eines Fremden mit derselben Kennung
        # übernimmt den Raum nicht (vorher gewann die neueste Definition, gleich von wem)
        if not mobil:
            gemerkt = ev("() => JSON.parse(localStorage.getItem('freedom.spaces') ?? '[]').filter(e => e.endsWith(':space:probe-raum'))")
            relay.events.append(probe["uebernahme"])
            ev("() => document.querySelector('#space-rail .space-pill[data-space=\"probe-raum\"]')?.click()")
            try:
                s.wait_for_function("() => document.getElementById('space-name').textContent === 'Übernommen'", timeout=3000)
                uebernommen = True
            except Exception:
                uebernommen = False
            uebernahme = {"gemerkt": gemerkt, "uebernommen": uebernommen, "name": ev("() => document.getElementById('space-name').textContent")}
            erg["desktop"]["uebernahme"] = uebernahme
            if len(gemerkt) != 1 or not gemerkt[0].startswith("34700:") or uebernommen or uebernahme["name"] != "Probe-Raum":
                erg["fehler"].append(f"desktop: Übernahme eines offenen Raums {uebernahme}")
            # Seit B-19: Ausgeblendetes fehlt im Verlauf, eine Zeile nennt die Zahl, „anzeigen“ zeigt es wieder
            relay.events.append(probe["ausblendung"])
            ev("() => document.querySelector('#space-rail .space-pill[data-space=\"probe-raum\"]')?.click()")
            try:
                s.wait_for_function("() => !document.getElementById('kanal-moderation')?.classList.contains('hidden')", timeout=10000)
            except Exception:
                pass
            im_verlauf = "() => document.getElementById('channel-thread').textContent.includes('Guten Morgen')"
            moderation = {"zeile": ev("() => document.getElementById('kanal-moderation')?.textContent"), "verlauf": ev(im_verlauf)}
            ev("() => document.querySelector('#kanal-moderation .mod-umschalten')?.click()")
            try:
                s.wait_for_function(im_verlauf, timeout=5000)
            except Exception:
                pass
            moderation["angezeigt"] = [ev("() => document.getElementById('kanal-moderation')?.textContent"), ev(im_verlauf)]
            erg["desktop"]["moderation"] = moderation
            if moderation != {"zeile": "🛡 1 Nachricht(en) von Moderatoren ausgeblendetanzeigen", "verlauf": False,
                              "angezeigt": ["🛡 1 ausgeblendete Nachricht(en) werden gezeigtwieder ausblenden", True]}:
                erg["fehler"].append(f"desktop: Moderation im offenen Raum {moderation}")
        # Raum-Repos (11.4c): im Probe-Raum die Liste seiner Repos, ohne „Repo anlegen“ (meine Rolle hat das Recht nicht);
        # ein Klick öffnet die Repo-Seite mit dem Raum, „Zum Raum“ führt zurück, der Fokus steht auf dem Repo
        if not mobil:
            ev("() => document.querySelector('#space-rail .space-pill[data-space=\"probe-raum\"]')?.click()")
        try:
            s.wait_for_function("() => document.querySelectorAll('#raum-repos .raum-repo').length > 0", timeout=10000)
        except Exception:
            pass
        im_raum = ev("""() => ({ repos: [...document.querySelectorAll('#raum-repos .raum-repo')].map(b => [...b.children].map(c => c.textContent)),
          sichtbar: (document.getElementById('raum-repos')?.getBoundingClientRect().height ?? 0) > 0,
          anlegen: !document.getElementById('space-repo-neu')?.classList.contains('hidden') })""")
        ev("() => document.querySelector('#raum-repos .raum-repo')?.click()")
        s.wait_for_timeout(300)
        auf_seite = ev("""() => ({ hash: location.hash, seite: document.getElementById('repo-seite').getBoundingClientRect().height > 0,
          titel: document.querySelector('#repo-seite .repo-titel span:last-child')?.textContent,
          raum: document.querySelector('#repo-seite .repo-raum span')?.textContent, fokus: document.activeElement?.classList.contains('repo-zurueck') })""")
        ev("() => document.querySelector('#repo-seite .repo-zum-raum')?.click()")
        try:
            s.wait_for_function("() => location.hash === '#/chat' && document.activeElement?.classList.contains('raum-repo')", timeout=10000)
        except Exception:
            pass
        zurueck_raum = ev("""() => ({ hash: location.hash, raum: document.getElementById('space-name').textContent,
          fokus: document.activeElement?.classList.contains('raum-repo') ?? false,
          sichtbar: (document.getElementById('raum-repos')?.getBoundingClientRect().height ?? 0) > 0 })""")
        erg[groesse]["raum_repos"] = {"im_raum": im_raum, "seite": auf_seite, "zurueck": zurueck_raum}
        if im_raum != {"repos": [["werkzeug", "1"]], "sichtbar": True, "anlegen": False}:
            erg["fehler"].append(f"{groesse}: Repos im Raum {im_raum}")
        if auf_seite != {"hash": "#/repos", "seite": True, "titel": "werkzeug",
                         "raum": "Im öffentlichen Raum „Probe-Raum“ – wer dort Repos pflegt, pflegt es mit.", "fokus": True}:
            erg["fehler"].append(f"{groesse}: Repo-Seite aus dem Raum {auf_seite}")
        if zurueck_raum != {"hash": "#/chat", "raum": "Probe-Raum", "fokus": True, "sichtbar": True}:
            erg["fehler"].append(f"{groesse}: „Zum Raum“ {zurueck_raum}")
        # C-15: beigetreten – kein „Diesem Raum beitreten“; ohne Eintrag in der Leiste führt „Zum Raum“ in den Raum,
        # dort beitreten nimmt ihn wieder auf
        if not mobil:
            hier = "() => !document.getElementById('space-hier-beitreten').classList.contains('hidden')"
            schon = ev(hier)
            ev("() => localStorage.setItem('freedom.spaces', JSON.stringify(JSON.parse(localStorage.getItem('freedom.spaces') || '[]')"
               ".filter(e => !e.endsWith('probe-raum'))))")
            ev("() => document.querySelector('#raum-repos .raum-repo')?.click()")
            s.wait_for_timeout(300)
            ev("() => document.querySelector('#repo-seite .repo-zum-raum')?.click()")
            try:
                s.wait_for_function(hier, timeout=10000)
            except Exception:
                pass
            nicht_beigetreten = [ev("() => document.getElementById('space-name').textContent"), ev(hier),
                                 ev("() => !!document.querySelector('#space-rail .space-pill[data-space=\"probe-raum\"]')")]
            ev("() => document.getElementById('space-hier-beitreten').click()")
            s.wait_for_timeout(300)
            wieder = [ev(hier), ev("() => !!document.querySelector('#space-rail .space-pill[data-space=\"probe-raum\"]')"),
                      ev("() => JSON.parse(localStorage.getItem('freedom.spaces')).filter(e => e.endsWith('probe-raum')).length")]
            erg[groesse]["beitreten"] = {"schon": schon, "nicht": nicht_beigetreten, "wieder": wieder}
            if schon is not False or nicht_beigetreten != ["Probe-Raum", True, False] or wieder != [False, True, 1]:
                erg["fehler"].append(f"{groesse}: hier beitreten {erg[groesse]['beitreten']}")
            # C-13a: offen mit Weltkugel, für Vorleser „Offener Raum …“; der Kanal ankündigungen ist ungelesen –
            # vor Augen kein Punkt, zurück bei den Direktnachrichten ein Punkt; die Leiste hat einen Tab-Halt, Pfeile wandern
            pille = "#space-rail .space-pill[data-space=\"probe-raum\"]"
            vor_augen = ev(f"""() => [document.querySelector('{pille}').textContent, document.querySelector('{pille}').getAttribute('aria-label'),
              !!document.querySelector('{pille} .rail-punkt')]""")
            ev("() => document.getElementById('comm-dm-btn').click()")
            try:  # die Leiste zeichnet sich nach dem Wechsel neu – auf den Punkt warten, fehlt er, meldet es die Prüfung unten
                s.wait_for_function(f"() => !!document.querySelector('{pille} .rail-punkt')", timeout=10000)
            except Exception:
                pass
            weg = ev(f"""() => [document.querySelector('{pille}').getAttribute('aria-label'), !!document.querySelector('{pille} .rail-punkt'),
              [...document.querySelectorAll('.comm-rail button')].filter(b => b.tabIndex === 0).map(b => b.id || b.dataset.space)]""")
            ev("() => document.getElementById('comm-dm-btn').focus()")
            s.keyboard.press("ArrowDown")
            pfeil = ev("() => [document.activeElement?.dataset.space ?? document.activeElement?.id ?? '',"
                       " [...document.querySelectorAll('.comm-rail button')].filter(b => b.tabIndex === 0).length]")
            erg[groesse]["leiste"] = {"vor_augen": vor_augen, "weg": weg, "pfeil": pfeil}
            if vor_augen != ["🌐P", "Offener Raum probe-raum", False] \
                    or weg != ["Offener Raum probe-raum, ungelesen", True, ["comm-dm-btn"]] or pfeil[1] != 1 or pfeil[0] in ("", "comm-dm-btn"):
                erg["fehler"].append(f"{groesse}: Leiste {erg[groesse]['leiste']}")
            ev(f"() => document.querySelector('{pille}').click()")
            s.wait_for_function("() => document.querySelector('.comm-layout')?.dataset.commMode === 'space'", timeout=10000)
            # C-13b: aus dem Mitglieder-Menü eine Direktnachricht an den Gründer – Unterhaltung neu, offen bei den Direktnachrichten
            s.wait_for_function("() => document.querySelectorAll('#member-list .member-row .mitglied-knopf').length > 0", timeout=10000)
            gruender_pk = ev("() => document.querySelectorAll('#member-list .member-row')[0].querySelector('.mitglied-name').title")
            ev("() => document.querySelectorAll('#member-list .member-row')[0].querySelector('.mitglied-knopf').click()")
            s.wait_for_function("() => document.querySelectorAll('.menue-schwebend [role=menuitem]').length > 0", timeout=10000)
            ev("() => [...document.querySelectorAll('.menue-schwebend [role=menuitem]')].find(b => b.textContent === 'Direktnachricht schreiben')?.click()")
            try:
                s.wait_for_function("(pk) => !!document.querySelector(`#chat-list .chat-item.active[data-cid=\"${pk}\"]`)", arg=gruender_pk, timeout=10000)
            except Exception:
                pass
            dm = ev("""(pk) => [document.querySelector('.comm-layout').dataset.commMode,
              !!document.querySelector(`#chat-list .chat-item.active[data-cid="${pk}"]`), !!document.querySelector('#chat-thread .empty-state')]""", gruender_pk)
            erg[groesse]["direktnachricht"] = dm
            if dm != ["dm", True, True]:
                erg["fehler"].append(f"{groesse}: Direktnachricht aus dem Mitglieder-Menü {dm}")
            ev(f"() => document.querySelector('{pille}').click()")
            s.wait_for_function("() => document.querySelector('.comm-layout')?.dataset.commMode === 'space'", timeout=10000)
        # Repos (C.3a): eine Karte aus Ankündigung und Bundle, Suche, „Meine“, Repo-Seite, Patch annehmen per Dialog
        ev("() => { location.hash = '#/repos'; }")
        try:
            s.wait_for_function("() => document.querySelectorAll('#repos-karten .repo-karte').length > 0", timeout=10000)
        except Exception:
            pass
        karte = """() => [...document.querySelectorAll('#repos-karten .repo-karte')].map(k => [k.querySelector('.repo-name').textContent,
          !!k.querySelector('.msg-role')])"""
        liste = ev(karte)
        ev("() => { const s = document.getElementById('repos-suche'); s.value = 'gibt-es-nicht'; s.dispatchEvent(new Event('input')); }")
        leer = ev(karte)
        ev("() => { const s = document.getElementById('repos-suche'); s.value = 'WERKZEUGE'; s.dispatchEvent(new Event('input')); }")
        gesucht = ev(karte)
        ev("() => document.querySelector('#repos-filter [data-filter=meine]').click()")
        meine = ev(karte)
        ev("() => document.querySelector('#repos-karten .repo-karte').click()")
        s.wait_for_timeout(200)
        seite = ev("""() => ({ sichtbar: document.getElementById('repo-seite').getBoundingClientRect().height > 0,
          liste: document.getElementById('repos-liste-ansicht').getBoundingClientRect().height > 0,
          klon: document.querySelector('.repo-klon input')?.value, fokus: document.activeElement?.classList.contains('repo-zurueck'),
          patches: [...document.querySelectorAll('.repo-patch')].map(p => [p.querySelector('.repo-patch-betreff').textContent,
            [...p.querySelectorAll('.repo-patch-status button')].map(b => b.textContent)]) })""")
        ev("() => document.querySelector('.repo-patch-status button').click()")  # annehmen (seit C.3b1 ist der Betreff selbst ein Knopf)
        s.wait_for_timeout(200)
        s.keyboard.type("xyz")
        s.keyboard.press("Enter")
        s.wait_for_timeout(100)
        falsch = ev("() => document.querySelector('[role=dialog] [role=alert]')?.textContent ?? null")
        s.keyboard.press("Control+A")
        s.keyboard.type("c" * 40)
        # Seit C.3b2 mit Begründung: Tab ins Textfeld, Strg+Enter bestätigt
        s.keyboard.press("Tab")
        s.keyboard.type("Danke – <i>sauber</i>.")
        s.keyboard.press("Control+Enter")
        s.wait_for_timeout(800)
        patch_id = next(e["id"] for e in relay.events if e.get("kind") == 1617)
        status = [e for e in relay.gesendet if e.get("kind") == 1631]
        verweis = [t[1] for t in (status[0]["tags"] if status else []) if t[0] == "e"]
        commit = [t[1] for t in (status[0]["tags"] if status else []) if t[0] == "applied-as-commits"]
        notiz = status[0]["content"] if status else None
        ev("() => document.querySelector('.repo-zurueck').click()")
        s.wait_for_timeout(200)
        zurueck = ev("() => [document.getElementById('repos-liste-ansicht').getBoundingClientRect().height > 0, document.activeElement?.classList.contains('repo-karte')]")
        erg[groesse]["repos"] = {"liste": liste, "leer": leer, "gesucht": gesucht, "meine": meine, "seite": seite, "falsch": falsch,
                                 "status": len({e["id"] for e in status}), "verweis": verweis, "commit": commit, "notiz": notiz, "zurueck": zurueck}
        if liste != [["werkzeug", True]] or leer != [] or gesucht != liste or meine != liste:
            erg["fehler"].append(f"{groesse}: Repo-Liste {liste} {leer} {gesucht} {meine}")
        if not (seite["sichtbar"] and not seite["liste"] and seite["klon"] == "git clone https://example.org/werkzeug.git" and seite["fokus"]
                and seite["patches"] == [["Hammer schärfen", ["annehmen", "als Entwurf", "schließen"]]]):
            erg["fehler"].append(f"{groesse}: Repo-Seite {seite}")
        if not falsch or "SHA-1" not in falsch or verweis[:1] != [patch_id] or commit != ["c" * 40] or notiz != "Danke – <i>sauber</i>.":
            erg["fehler"].append(f"{groesse}: Patch annehmen {falsch} {verweis} {commit} {notiz!r}")
        if zurueck != [True, True]:
            erg["fehler"].append(f"{groesse}: zurück zur Liste {zurueck}")
        # Seit C.3a2: Reiter „Mitwirkende“ (fremdes Repo, ohne „Einstellungen“), eigenes Repo mit Einstellungen und neuer Version
        reiter = "() => [...document.querySelectorAll('#repo-seite .repo-reiter [role=tab]')].map(b => b.dataset.reiter)"
        ev("() => document.querySelector('#repos-karten .repo-karte').click()")
        s.wait_for_timeout(200)
        fremd_reiter = ev(reiter)
        ev("() => document.querySelector('#repo-seite [data-reiter=mitwirkende]').click()")
        try:
            s.wait_for_function("() => document.querySelectorAll('#repo-seite .repo-mitwirkende .usage-row').length > 0", timeout=5000)
        except Exception:
            pass
        mitwirkende = ev("() => document.querySelectorAll('#repo-seite .repo-mitwirkende .usage-row').length")
        ev("() => document.querySelector('.repo-zurueck').click()")
        # Suche von oben leeren, sonst bleibt das neue Repo verborgen
        ev("() => { const s = document.getElementById('repos-suche'); s.value = ''; s.dispatchEvent(new Event('input')); }")
        ev("() => document.getElementById('nip34-ankuendigen').click()")
        s.wait_for_timeout(200)
        s.keyboard.type("meins")
        s.keyboard.press("Enter")  # Dialog: Kennung
        s.wait_for_timeout(200)
        s.keyboard.press("Enter")  # Rückfrage: ankündigen
        try:
            s.wait_for_function("() => [...document.querySelectorAll('#repos-karten .repo-name')].some(n => n.textContent === 'meins')", timeout=5000)
        except Exception:
            pass
        ev("() => [...document.querySelectorAll('#repos-karten .repo-karte')].find(k => k.querySelector('.repo-name').textContent === 'meins')?.click()")
        s.wait_for_timeout(200)
        eigen_reiter = ev(reiter)
        ev("() => document.querySelector('#repo-seite [data-reiter=einstellungen]')?.click()")
        s.wait_for_timeout(200)
        ada = next(e["pubkey"] for e in relay.events if e.get("kind") == 1617)
        vorher = len(relay.gesendet)
        def speichern(maintainer: str) -> None:
            if not ev("() => !!document.getElementById('repo-feld-beschreibung')"):
                return  # keine Einstellungen – die Prüfungen unten melden es
            s.fill("#repo-feld-beschreibung", "Mein Repo")
            s.fill("#repo-feld-web", "https://example.org/meins\nhttp://example.org/unsicher")
            s.fill("#repo-feld-maintainer", maintainer)
            ev("() => document.querySelector('.repo-einstellungen button[type=submit]').click()")
            s.wait_for_timeout(200)
        speichern("npub1xyz")  # ungültig: Meldung im Formular, nichts gesendet, keine Rückfrage
        abgewiesen = [ev("() => document.querySelector('.repo-fehler')?.textContent ?? ''"), len(relay.gesendet) - vorher,
                      ev("() => !!document.querySelector('[role=dialog]')")]
        speichern(ada)
        s.keyboard.press("Enter")  # Rückfrage: veröffentlichen
        s.wait_for_timeout(800)
        neu = [e for e in relay.gesendet if e.get("kind") == 30617 and ["d", "meins"] in e["tags"]]
        ank = neu[-1] if neu else {"tags": []}
        tags = {t[0]: t[1:] for t in ank["tags"]}
        links = ev("() => [...document.querySelectorAll('#repo-seite .repo-web a')].map(a => [a.getAttribute('href'), a.rel])")
        noch_einstellungen = ev("() => !!document.querySelector('#repo-seite .repo-einstellungen')")
        if ev("() => !!document.querySelector('#repo-seite .repo-hochladen input[type=file]')"):
            s.set_input_files("#repo-seite .repo-hochladen input[type=file]",
                              files=[{"name": "meins.bundle", "mimeType": "application/octet-stream", "buffer": PROBE_BUNDLE}])
        try:
            s.wait_for_function("() => [...document.querySelectorAll('#repo-seite .repo-klon button')].length > 0", timeout=8000)
        except Exception:
            pass
        bundles = [e for e in relay.gesendet if e.get("kind") == 38042 and ["d", "meins"] in e["tags"]]
        bundle_tags = [t[0] for t in (bundles[-1]["tags"] if bundles else [])]
        bundle_knopf = ev("() => document.querySelectorAll('#repo-seite .repo-klon button').length")
        # Seit C.3c1: die neue Version ist ein echtes Bundle – der Reiter „Code“ liest es in der App
        ev("() => document.querySelector('#repo-seite [data-reiter=code]')?.click()")
        s.wait_for_timeout(200)
        ev("() => document.querySelector('#repo-seite .code-laden')?.click()")
        try:
            s.wait_for_function("() => !!document.querySelector('#repo-seite .code-readme') || !!document.querySelector('#repo-seite .repo-fehler')?.textContent", timeout=15000)
        except Exception:
            pass
        code = ev("""() => ({ commit: document.querySelector('#repo-seite .code-commit')?.textContent,
          dateien: [...document.querySelectorAll('#repo-seite .code-dateien li')].map(l => l.textContent),
          readme: [...document.querySelectorAll('#repo-seite .code-readme.md > *')].map(e => [e.tagName, e.textContent]),
          fehler: document.querySelector('#repo-seite .repo-fehler')?.textContent ?? '' })""")
        erg[groesse]["code"] = code
        if not (code["commit"] or "").startswith("Liste ergänzt · Probe · ") or not (code["commit"] or "").endswith("· 590c7cf") \
                or code["dateien"] != ["src/", "bild.bin", "README.md"] or code["readme"] != [["H1", "Werkzeug"], ["P", "Ein Probe-Repo für den Bundle-Leser."]] or code["fehler"]:
            erg["fehler"].append(f"{groesse}: Reiter Code {code}")
        # Seit C.3c2: Ordner öffnen, Datei als Text, binär ehrlich, zurück über den Pfad; Reiter „Commits“
        def eintrag(name: str) -> None:
            ev(f"() => [...document.querySelectorAll('#repo-seite .code-eintrag')].find(b => b.textContent === '{name}')?.click()")
            s.wait_for_timeout(150)
        pfad = "() => [...document.querySelectorAll('#repo-seite .code-pfad > :not(.muted)')].map(e => e.textContent)"
        eintrag("src/")
        navi = {"src": [ev(pfad), ev("() => [...document.querySelectorAll('#repo-seite .code-eintrag')].map(b => b.textContent)"),
                        ev("() => document.activeElement?.classList.contains('code-hier')")]}
        eintrag("liste.txt")
        navi["datei"] = [ev(pfad), ev("() => document.querySelector('#repo-seite .code-datei')?.textContent.split('\\n')[0]")]
        ev("() => document.querySelector('#repo-seite .code-pfad-knopf')?.click()")  # zurück zu „meins“
        s.wait_for_timeout(150)
        eintrag("bild.bin")
        navi["binaer"] = [ev(pfad), ev("() => !!document.querySelector('#repo-seite .code-datei')"),
                          ev("() => [...document.querySelectorAll('#repo-seite p')].some(p => p.textContent.startsWith('Binärdatei'))")]
        ev("() => document.querySelector('#repo-seite [data-reiter=commits]')?.click()")
        s.wait_for_timeout(200)
        ev("() => document.querySelector('#repo-seite .code-commits details summary')?.click()")
        navi["commits"] = ev("""() => ({ betreffe: [...document.querySelectorAll('#repo-seite .code-commit-betreff')].map(e => e.textContent),
          offen: document.querySelector('#repo-seite .code-commits details')?.open,
          nachricht: document.querySelector('#repo-seite .code-commit-nachricht')?.textContent })""")
        erg[groesse]["code_navi"] = navi
        if navi["src"] != [["meins", "src"], ["liste.txt"], True] or navi["datei"] != [["meins", "src", "liste.txt"], "Zeile 0: Hammer, Zange, Säge und Schraubenzieher liegen bereit."] \
                or navi["binaer"] != [["meins", "bild.bin"], False, True] or navi["commits"]["betreffe"] != ["Liste ergänzt", "Erster Stand"] \
                or not navi["commits"]["offen"] or "zweiten Zeile" not in (navi["commits"]["nachricht"] or ""):
            erg["fehler"].append(f"{groesse}: Code-Navigation/Commits {navi}")
        # Seit C-20b: neue Version mit Markdown – Tabelle in der README, Verweise öffnen Dateien im Reiter „Code“ (nie
        # hinaus, nie in die Adresse), Markdown-Dateien als Vorschau oder Quelltext
        ev("() => document.querySelector('#repo-seite [data-reiter=einstellungen]')?.click()")
        s.wait_for_timeout(200)
        zahl_38042 = lambda: len([e for e in relay.gesendet if e.get("kind") == 38042])
        vorher_b = zahl_38042()
        if ev("() => !!document.querySelector('#repo-seite .repo-hochladen input[type=file]')"):
            s.set_input_files("#repo-seite .repo-hochladen input[type=file]",
                              files=[{"name": "kiste.bundle", "mimeType": "application/octet-stream", "buffer": PROBE_MD_BUNDLE}])
        for _ in range(50):
            if zahl_38042() > vorher_b:
                break
            s.wait_for_timeout(200)
        s.wait_for_timeout(300)
        ev("() => document.querySelector('#repo-seite [data-reiter=code]')?.click()")
        s.wait_for_timeout(200)
        ev("() => document.querySelector('#repo-seite .code-laden')?.click()")
        try:
            s.wait_for_function("() => !!document.querySelector('#repo-seite .code-readme table') || !!document.querySelector('#repo-seite .repo-fehler')?.textContent", timeout=15000)
        except Exception:
            pass
        md_code = {"tabelle": ev("""() => { const t = document.querySelector('#repo-seite .code-readme table'); return t && [
            [...t.querySelectorAll('th')].map(e => [e.textContent, e.className]), [...t.querySelectorAll('tbody tr')].map(r => [...r.children].map(c => c.textContent))]; }"""),
                   "laufleiste": ev("() => document.documentElement.scrollWidth - innerWidth")}
        def verweis(text: str) -> None:
            ev(f"() => [...document.querySelectorAll('#repo-seite .md-verweis')].find(a => a.textContent === '{text}')?.click()")
            s.wait_for_timeout(200)
        hash_vorher = ev("() => location.hash")
        verweis("Liste")
        md_code["liste"] = [ev(pfad), ev("() => document.querySelector('#repo-seite .code-datei')?.textContent"), ev("() => location.hash") == hash_vorher]
        ev("() => document.querySelector('#repo-seite .code-pfad-knopf')?.click()")
        s.wait_for_timeout(150)
        verweis("hinaus")
        md_code["hinaus"] = [ev(pfad), ev("() => document.getElementById('toast')?.textContent")]
        # Mit der Tastatur: Enter auf dem Verweis
        ev("() => [...document.querySelectorAll('#repo-seite .md-verweis')].find(a => a.textContent === 'Anleitung')?.focus()")
        s.keyboard.press("Enter")
        s.wait_for_timeout(200)
        ansicht = "() => [...document.querySelectorAll('#repo-seite .code-ansicht button')].map(b => [b.textContent, b.getAttribute('aria-pressed')])"
        md_code["anleitung"] = [ev(pfad), ev("() => document.querySelector('#repo-seite .code-md h1')?.textContent"), ev(ansicht)]
        ev("() => document.querySelectorAll('#repo-seite .code-ansicht button')[1]?.click()")
        s.wait_for_timeout(150)
        md_code["quelltext"] = [ev("() => document.querySelector('#repo-seite .code-datei')?.textContent.split('\\n')[0]"),
                                ev("() => !!document.querySelector('#repo-seite .code-md')"), ev(ansicht)]
        ev("() => document.querySelectorAll('#repo-seite .code-ansicht button')[0]?.click()")
        s.wait_for_timeout(150)
        verweis("Übersicht")
        md_code["zurueck"] = [ev(pfad), ev("() => document.querySelector('#repo-seite .code-md h1')?.textContent")]
        erg[groesse]["markdown_code"] = md_code
        if md_code != {"tabelle": [[["Werkzeug", "md-links"], ["Anzahl", "md-rechts"], ["Ort", "md-mitte"]], [["Hammer", "2", "Liste"], ["Zange | Säge", "1", "Keller"]]],
                       "laufleiste": 0, "liste": [["meins", "src", "liste.txt"], "Hammer, Zange\n", True],
                       "hinaus": [["meins"], "Diesen Pfad gibt es im Bundle nicht."],
                       "anleitung": [["meins", "docs", "ANLEITUNG.md"], "Anleitung", [["Vorschau", "true"], ["Quelltext", "false"]]],
                       "quelltext": ["# Anleitung", False, [["Vorschau", "false"], ["Quelltext", "true"]]],
                       "zurueck": [["meins", "README.md"], "Werkzeugkiste"]}:
            erg["fehler"].append(f"{groesse}: Markdown im Reiter Code {md_code}")
        # Seit C-20c: Zweig oder Tag wählen – Code und Commits zeigen deren Stand (Tag annotiert), die Adresse bleibt
        refs = lambda: ev("""() => { const w = document.getElementById('code-ref-wahl'); return w && [[...w.options].map(o => [o.textContent, o.value, o.parentElement.label]), w.value,
          w.parentElement.querySelector('.muted')?.textContent]; }""")
        zweige = {"code": refs()}
        s.select_option("#code-ref-wahl", "zweig:entwurf")
        s.wait_for_timeout(200)
        zweige["entwurf"] = [ev(pfad), ev("() => document.querySelector('#repo-seite .code-md h1')?.textContent"),
                             ev("() => document.querySelector('#repo-seite .code-commit')?.textContent.split(' · ')[0]"),
                             ev("() => document.activeElement?.id"), ev("() => location.hash") == hash_vorher]
        ev("() => document.querySelector('#repo-seite [data-reiter=commits]')?.click()")
        s.wait_for_timeout(200)
        betreffe = "() => [...document.querySelectorAll('#repo-seite .code-commit-betreff')].map(e => e.textContent)"
        zweige["commits"] = [refs()[1] if refs() else None, ev(betreffe)]
        s.select_option("#code-ref-wahl", "tag:v1.0")
        s.wait_for_timeout(200)
        zweige["tag"] = ev(betreffe)
        erg[groesse]["zweige"] = zweige
        if zweige != {"code": [[["entwurf", "zweig:entwurf", "Zweige"], ["main", "zweig:main", "Zweige"], ["v1.0", "tag:v1.0", "Tags"]], "zweig:main", "Zweige: 2 · Tags: 1"],
                      "entwurf": [["meins", "README.md"], "Werkzeugkiste (Entwurf)", "Entwurf: neuer Titel", "code-ref-wahl", True],
                      "commits": ["zweig:entwurf", ["Entwurf: neuer Titel", "Werkzeugkiste mit Anleitung"]],
                      "tag": ["Werkzeugkiste mit Anleitung"]}:
            erg["fehler"].append(f"{groesse}: Zweige und Tags {zweige}")
        # Seit C-20d: Verlauf einer Datei (im gewählten Zweig) und Suche im Code; ein Treffer öffnet die Datei
        ev("() => document.querySelector('#repo-seite [data-reiter=code]')?.click()")
        s.wait_for_timeout(200)
        s.select_option("#code-ref-wahl", "zweig:entwurf")
        s.wait_for_timeout(200)
        ev("() => document.querySelector('#repo-seite .code-verlauf-knopf')?.click()")
        s.wait_for_timeout(200)
        verlauf = ev("""() => ({ pfad: [...document.querySelectorAll('#repo-seite .code-pfad > :not(.muted)')].map(e => e.textContent),
          offen: document.querySelector('#repo-seite .code-verlauf-knopf')?.getAttribute('aria-expanded'),
          fokus: !!document.activeElement?.classList.contains('code-verlauf-knopf'),
          zeilen: [...document.querySelectorAll('#repo-seite .code-verlauf-zeile')].map(z => [z.querySelector('.code-commit-betreff')?.textContent,
            z.querySelector('.repo-status')?.textContent]) })""")
        ev("() => document.querySelector('#repo-seite .code-pfad-knopf')?.click()")
        s.wait_for_timeout(150)
        suche: dict = {}
        if ev("() => !!document.getElementById('code-suche')"):
            s.fill("#code-suche", "hammer")
            s.press("#code-suche", "Enter")
            s.wait_for_timeout(200)
            suche = {"zahl": ev("() => document.querySelector('#repo-seite .code-suche-zahl')?.textContent"),
                     "treffer": ev("() => [...document.querySelectorAll('#repo-seite .code-treffer li')].map(l => [l.querySelector('.code-treffer-ort')?.textContent, l.querySelector('span')?.textContent])"),
                     "fokus": ev("() => document.activeElement?.id")}
            ev("() => document.querySelector('#repo-seite .code-treffer-ort')?.click()")
            s.wait_for_timeout(150)
            suche["geoeffnet"] = [ev(pfad), ev("() => document.querySelector('#repo-seite .code-datei')?.textContent"), ev("() => location.hash") == hash_vorher]
            ev("() => document.querySelector('#repo-seite .code-pfad-knopf')?.click()")
            s.wait_for_timeout(150)
            suche["bleibt"] = ev("() => document.querySelectorAll('#repo-seite .code-treffer li').length")
            s.fill("#code-suche", "x")
            s.press("#code-suche", "Enter")
            s.wait_for_timeout(150)
            suche["kurz"] = ev("() => document.querySelector('#repo-seite .code-suche')?.nextElementSibling?.textContent")
        erg[groesse]["verlauf_suche"] = {"verlauf": verlauf, "suche": suche}
        if verlauf != {"pfad": ["meins", "README.md"], "offen": "true", "fokus": True,
                       "zeilen": [["Entwurf: neuer Titel", "geändert"], ["Werkzeugkiste mit Anleitung", "neu"]]} \
                or suche != {"zahl": "Treffer: 2", "treffer": [["src/liste.txt:1", "Hammer, Zange"], ["README.md:5", "| Hammer | 2 | [Liste](src/liste.txt) |"]],
                             "fokus": "code-suche", "geoeffnet": [["meins", "src", "liste.txt"], "Hammer, Zange\n", True], "bleibt": 2,
                             "kurz": "Bitte mindestens zwei Zeichen."}:
            erg["fehler"].append(f"{groesse}: Verlauf und Suche {erg[groesse]['verlauf_suche']}")
        erg[groesse]["repo_c3a2"] = {"fremd_reiter": fremd_reiter, "mitwirkende": mitwirkende, "eigen_reiter": eigen_reiter,
                                     "abgewiesen": abgewiesen, "tags": tags, "links": links, "bleibt": noch_einstellungen,
                                     "bundle": bundle_tags, "bundle_knopf": bundle_knopf}
        if fremd_reiter != ["code", "commits", "issues", "patches", "releases", "mitwirkende"] or mitwirkende != 2:
            erg["fehler"].append(f"{groesse}: fremdes Repo, Reiter/Mitwirkende {fremd_reiter} {mitwirkende}")
        if eigen_reiter != ["code", "commits", "issues", "patches", "releases", "mitwirkende", "einstellungen"]:
            erg["fehler"].append(f"{groesse}: eigenes Repo ohne Einstellungen {eigen_reiter}")
        if "Maintainer" not in abgewiesen[0] or abgewiesen[1] != 0 or abgewiesen[2]:
            erg["fehler"].append(f"{groesse}: ungültiger Maintainer nicht abgewiesen {abgewiesen}")
        if tags.get("description") != ["Mein Repo"] or tags.get("maintainers") != [ada] or not noch_einstellungen \
                or links != [["https://example.org/meins", "noopener noreferrer"]]:
            erg["fehler"].append(f"{groesse}: Einstellungen gespeichert {tags} {links} {noch_einstellungen}")
        if "aes-gcm" not in bundle_tags or bundle_knopf < 1:
            erg["fehler"].append(f"{groesse}: neue Version hochladen {bundle_tags} {bundle_knopf}")
        # Seit C.3b1: eigener Patch erst als Vorschau (ungültige Datei abgewiesen), dann gesendet
        ev("() => document.querySelector('#repo-seite [data-reiter=patches]')?.click()")
        s.wait_for_timeout(200)
        eigener_patch = (f"From {'b' * 40} Mon Sep 17 00:00:00 2001\nFrom: Ich <ich@example.org>\nSubject: [PATCH] Liesmich\n\n"
                         "Erste Zeile.\n---\ndiff --git a/LIESMICH b/LIESMICH\nnew file mode 100644\n--- /dev/null\n+++ b/LIESMICH\n"
                         "@@ -0,0 +1,2 @@\n+# meins\n+<b>fett?</b>\n-- \n2.43.0\n")
        datei = "#repo-seite .repo-patch-datei"
        vorschau = {}
        if ev(f"() => !!document.querySelector('{datei}')"):
            s.set_input_files(datei, files=[{"name": "kaputt.patch", "mimeType": "text/plain", "buffer": b"kein Patch"}])
            s.wait_for_timeout(300)
            vorschau["kaputt"] = ev("() => !!document.querySelector('#repo-seite .patch-senden')")
            s.set_input_files(datei, files=[{"name": "0001.patch", "mimeType": "text/plain", "buffer": eigener_patch.encode()}])
            s.wait_for_timeout(300)
            vorschau["seite"] = ev("""() => ({ titel: document.querySelector('#repo-seite .patch-titel')?.textContent,
              zeilen: [...document.querySelectorAll('#repo-seite .diff-zeile')].map(z => [z.querySelector('.diff-zeichen').textContent, z.querySelector('.diff-text').textContent]),
              art: document.querySelector('#repo-seite .diff-datei-kopf .msg-role')?.textContent, fokus: document.activeElement?.classList.contains('patch-senden') })""")
            vorher = len([e for e in relay.gesendet if e.get("kind") == 1617])
            ev("() => document.querySelector('#repo-seite .patch-senden').click()")
            s.wait_for_timeout(800)
            gesendet_patch = [e for e in relay.gesendet if e.get("kind") == 1617][vorher:]
            vorschau["gesendet"] = [t[1] for t in (gesendet_patch[-1]["tags"] if gesendet_patch else []) if t[0] == "a"]
            vorschau["liste"] = ev("() => [...document.querySelectorAll('#repo-seite .repo-patch-betreff')].map(b => b.textContent)")
        # Seit C.3b2: als Entwurf (mit Begründung), dann wieder öffnen; Schließen ist rot und lässt sich abbrechen
        def aktion(text: str, notiz: str | None) -> list:
            knoepfe_js = "() => [...document.querySelectorAll('#repo-seite .repo-patch-status button')].map(b => b.textContent).join('|')"
            vorher_knoepfe = ev(knoepfe_js)
            ev(f"() => [...document.querySelectorAll('#repo-seite .repo-patch-status button')].find(b => b.textContent === '{text}')?.click()")
            s.wait_for_timeout(200)
            gefahr = ev("() => !!document.querySelector('[role=dialog] .dlg-gefahr')")
            if notiz is None:
                s.keyboard.press("Escape")
                s.wait_for_timeout(600)
            else:
                s.keyboard.type(notiz)
                s.keyboard.press("Control+Enter")
                # Gesendet wird, dann neu geladen – auf die neuen Knöpfe warten statt einer festen Pause (die CI ist langsamer)
                try:
                    s.wait_for_function(f"(vorher) => ({knoepfe_js})() !== vorher", arg=vorher_knoepfe, timeout=10000)
                except Exception:
                    pass
            knoepfe = ev("() => [...document.querySelectorAll('#repo-seite .repo-patch-status button')].map(b => b.textContent)")
            return [gefahr, knoepfe]
        vorher_status = len(relay.gesendet)
        ablauf = [aktion("als Entwurf", "Noch nicht fertig"), aktion("schließen", None)]
        s.wait_for_timeout(1100)  # Status zählen nach Sekunden – zwei Wechsel nie in derselben Sekunde
        ablauf.append(aktion("wieder öffnen", "Jetzt fertig"))
        neu_status = [[e["kind"], e["content"]] for e in relay.gesendet[vorher_status:] if e.get("kind") in (1630, 1631, 1632, 1633)]
        vorschau["status"] = {"ablauf": ablauf, "gesendet": [list(x) for x in dict.fromkeys(tuple(x) for x in neu_status)]}
        erg[groesse]["patch_vorschau"] = vorschau
        if vorschau.get("kaputt") is not False or vorschau.get("seite", {}).get("titel") != "Liesmich" \
                or vorschau["seite"]["zeilen"] != [["+", "# meins"], ["+", "<b>fett?</b>"]] or vorschau["seite"]["art"] != "neu" \
                or not vorschau["seite"]["fokus"] or len(vorschau.get("gesendet", [])) != 1 \
                or not vorschau["gesendet"][0].endswith(":meins") or vorschau.get("liste") != ["Liesmich"] \
                or vorschau["status"]["ablauf"] != [[False, ["annehmen", "wieder öffnen", "schließen"]], [True, ["annehmen", "wieder öffnen", "schließen"]],
                                                   [False, ["annehmen", "als Entwurf", "schließen"]]] \
                or vorschau["status"]["gesendet"] != [[1633, "Noch nicht fertig"], [1630, "Jetzt fertig"]]:
            erg["fehler"].append(f"{groesse}: Patch-Vorschau {vorschau}")
        # Seit C.3b1: der angenommene Patch im fremden Repo als eigene Seite mit Änderungen, als Datei ladbar
        ev("() => document.querySelector('.repo-zurueck').click()")
        ev("() => [...document.querySelectorAll('#repos-karten .repo-karte')].find(k => k.querySelector('.repo-name').textContent === 'werkzeug')?.click()")
        s.wait_for_timeout(200)
        ev("() => document.querySelector('#repo-seite [data-reiter=patches]')?.click()")
        ev("() => document.querySelector('#repo-seite .repo-filter [data-filter=angenommen]')?.click()")
        ev("() => document.querySelector('#repo-seite .repo-patch-betreff')?.click()")
        s.wait_for_timeout(200)
        seite_patch = ev("""() => ({ titel: document.querySelector('#repo-seite .patch-titel')?.textContent,
          marke: document.querySelector('#repo-seite .patch-meta .repo-status')?.textContent,
          dateien: [...document.querySelectorAll('#repo-seite .diff-dateien li')].map(l => l.textContent),
          zeilen: [...document.querySelectorAll('#repo-seite .diff-zeile')].map(z => [...z.children].map(c => c.textContent)),
          fokus: document.activeElement?.classList.contains('patch-zurueck'),
          angaben: [...document.querySelectorAll('#repo-seite .patch-status-info > *')].map(e => e.textContent),
          fett: document.querySelectorAll('#repo-seite .patch-status-info i').length })""")
        try:
            with s.expect_download(timeout=5000) as dl:
                ev("() => [...document.querySelectorAll('#repo-seite .patch-aktionen button')].at(-1).click()")
            seite_patch["datei"] = dl.value.suggested_filename
        except Exception as e:
            seite_patch["datei"] = f"kein Download: {str(e)[:80]}"
        # Seit C-17c: Kommentar unter dem Patch – NIP-22 an den Patch (K 1617), danach auf der Seite
        vorher_pk = len(relay.gesendet)
        if ev("() => !!document.querySelector('#repo-seite .kommentar-text')"):
            s.fill("#repo-seite .kommentar-text", "Sauber, danke!")
            ev("() => document.querySelector('#repo-seite .kommentar-senden')?.click()")
        try:
            s.wait_for_function("() => [...document.querySelectorAll('#repo-seite .issue-kommentar .issue-text')].some(e => e.textContent === 'Sauber, danke!')", timeout=10000)
        except Exception:
            pass
        pk_neu = list({e["id"]: e for e in relay.gesendet[vorher_pk:] if e.get("kind") == 1111}.values())
        pk_tags = {t[0]: t[1:] for t in (pk_neu[-1]["tags"] if pk_neu else [])}
        seite_patch["kommentar"] = [len(pk_neu), (pk_tags.get("E") or [None])[0] == patch_id, pk_tags.get("K"),
                                    ev("() => [...document.querySelectorAll('#repo-seite .issue-kommentar .issue-text')].map(e => e.textContent)")]
        # Seit C-20a: Kommentare als Markdown – nur DOM; Link nur https ohne Referrer, Bild nie geladen, rohes HTML bleibt Text
        # (beide Kommentare fallen in dieselbe Sekunde – die Reihenfolge entscheidet dann die Id, daher nach Inhalt suchen)
        bild_anfragen: list = []
        s.on("request", lambda r: bild_anfragen.append(r.url) if "example.org/f.png" in r.url else None)
        if ev("() => !!document.querySelector('#repo-seite .kommentar-text')"):
            s.fill("#repo-seite .kommentar-text", "**Sauber** – siehe [Anleitung](https://example.org/a) und [böse](javascript:alert(1)).\n"
                   "![Foto](https://example.org/f.png) <b>roh</b>\n\n- eins\n- `zwei`")
            ev("() => document.querySelector('#repo-seite .kommentar-senden')?.click()")
        try:
            s.wait_for_function("() => document.querySelectorAll('#repo-seite .issue-kommentar').length === 2", timeout=10000)
        except Exception:
            pass
        seite_patch["markdown"] = ev("""() => { const k = [...document.querySelectorAll('#repo-seite .issue-kommentar .md')].find(e => e.textContent.includes('Anleitung'));
          if (!k) return null;
          const a = [...k.querySelectorAll('a')].map(x => [x.getAttribute('href'), x.rel, x.target, x.textContent]);
          return { fett: k.querySelector('p strong')?.textContent, links: a, bilder: k.querySelectorAll('img').length, roh: !k.querySelector('b') && k.textContent.includes('<b>roh</b>'),
            umbruch: k.querySelectorAll('p br').length, liste: [...k.querySelectorAll('ul > li')].map(l => l.textContent), code: k.querySelector('li code')?.textContent }; }""")
        seite_patch["bild_anfragen"] = len(bild_anfragen)
        # Seit C-20g2: Review – „Zeilen kommentieren“ zeigt „+“ an den Zeilen (vorher nicht da, mobil 40 px); ein Kommentar
        # an „scharf“ trägt ["zeile", "hammer.txt", "neu", "1"] und steht unter der Zeile, nicht in der Diskussion; „Genehmigen“
        # sendet ["bewertung", "genehmigt"] und steht oben mit „Maintainer“ – der Status des Patches bleibt
        plus = "() => [...document.querySelectorAll('#repo-seite .zeile-plus')].map(b => [b.getAttribute('aria-label'), getComputedStyle(b).display, Math.round(b.getBoundingClientRect().height)])"
        review = {"vorher": [p[1] for p in ev(plus)]}
        ev("() => document.querySelector('#repo-seite .review-schalter')?.click()")
        review["schalter"] = ev("() => document.querySelector('#repo-seite .review-schalter')?.getAttribute('aria-pressed')")
        review["plus"] = ev(plus)
        vorher_r = len(relay.gesendet)
        ev("() => [...document.querySelectorAll('#repo-seite .zeile-plus')].at(-1)?.click()")
        try:
            s.wait_for_selector("[role=dialog] textarea", timeout=5000)
            s.keyboard.type("Warum *scharf*?")
            s.keyboard.press("Control+Enter")
            s.wait_for_function("() => !!document.querySelector('#repo-seite .review-faden .issue-text')", timeout=10000)
        except Exception:
            pass
        z_neu = list({e["id"]: e for e in relay.gesendet[vorher_r:] if e.get("kind") == 1111}.values())
        review["zeile"] = [len(z_neu), [t for t in (z_neu[-1]["tags"] if z_neu else []) if t[0] == "zeile"]]
        review["faden"] = ev("""() => { const f = document.querySelector('#repo-seite .review-faden');
          return f ? [f.previousElementSibling?.querySelector('.diff-text')?.textContent, f.querySelector('.issue-text em')?.textContent] : null; }""")
        review["diskussion"] = ev("() => document.querySelectorAll('#repo-seite .issue-kommentar').length")
        vorher_b = len(relay.gesendet)
        ev("() => document.querySelector('#repo-seite .review-genehmigen')?.click()")
        try:
            s.wait_for_selector("[role=dialog] textarea", timeout=5000)
            s.keyboard.press("Control+Enter")
            s.wait_for_function("() => !!document.querySelector('#repo-seite .review-bewertung')", timeout=10000)
        except Exception:
            pass
        b_neu = list({e["id"]: e for e in relay.gesendet[vorher_b:] if e.get("kind") == 1111}.values())
        review["bewertung"] = [len(b_neu), [t for t in (b_neu[-1]["tags"] if b_neu else []) if t[0] == "bewertung"],
                               ev("() => [...document.querySelectorAll('#repo-seite .review-bewertung > div:first-child > span')].map(e => e.textContent).slice(1, 3)"),
                               ev("() => document.querySelector('#repo-seite .review-kopf h4 span')?.textContent"),
                               ev("() => document.querySelector('#repo-seite .patch-meta .repo-status')?.textContent")]
        seite_patch["review"] = review
        hoehe_ok = all(p[2] >= 40 for p in review["plus"]) if groesse == "mobil" else True
        if review["vorher"] != ["none", "none"] or review["schalter"] != "true" or not hoehe_ok \
                or [p[:2] for p in review["plus"]] != [["Kommentar an hammer.txt, entfernte Zeile 1", "block"], ["Kommentar an hammer.txt, Zeile 1", "block"]] \
                or review["zeile"] != [1, [["zeile", "hammer.txt", "neu", "1"]]] or review["faden"] != ["scharf", "scharf"] or review["diskussion"] != 2 \
                or review["bewertung"] != [1, [["bewertung", "genehmigt"]], ["genehmigt ✓", "Maintainer"], "1 genehmigt · 0 Änderungen erbeten", "angenommen ✓"]:
            erg["fehler"].append(f"{groesse}: Review {review}")
        ev("() => document.querySelector('#repo-seite .patch-zurueck')?.click()")
        s.wait_for_timeout(200)
        seite_patch["zurueck"] = ev("() => [!!document.querySelector('#repo-seite .repo-patches'), document.activeElement?.dataset?.patch?.length === 64]")
        erg[groesse]["patch_seite"] = seite_patch
        if seite_patch["titel"] != "Hammer schärfen" or seite_patch["marke"] != "angenommen ✓" or seite_patch["dateien"] != ["hammer.txt+1−1"] \
                or seite_patch["zeilen"] != [["+", "1", "", "−", "stumpf"], ["+", "", "1", "+", "scharf"]] or not seite_patch["fokus"] \
                or seite_patch["datei"] != "aaaaaaa.patch" or seite_patch["zurueck"] != [True, True] \
                or len(seite_patch["angaben"]) != 3 or not seite_patch["angaben"][0].startswith("angenommen ✓ von Du") \
                or seite_patch["angaben"][1:] != ["Eingespielt als ccccccc", "Danke – <i>sauber</i>."] or seite_patch["fett"] != 0 \
                or seite_patch["kommentar"] != [1, True, ["1617"], ["Sauber, danke!"]] or seite_patch["bild_anfragen"] != 0 \
                or seite_patch["markdown"] != {"fett": "Sauber", "bilder": 0, "roh": True, "umbruch": 1, "liste": ["eins", "zwei"], "code": "zwei",
                                               "links": [["https://example.org/a", "noopener noreferrer nofollow", "_blank", "Anleitung"],
                                                         ["https://example.org/f.png", "noopener noreferrer nofollow", "_blank", "Bild: Foto (nicht geladen)"]]}:
            erg["fehler"].append(f"{groesse}: Patch-Seite {seite_patch}")
        # Seit C-17b1: Reiter „Issues“ – Liste mit dem Issue aus der Probe, die Seite mit Text und Kommentar (HTML bleibt Text),
        # zurück mit Fokus, dann „Neues Issue“ per Dialog: öffentlich, signiert, an das Repo adressiert
        ev("() => document.querySelector('#repo-seite [data-reiter=issues]')?.click()")
        s.wait_for_timeout(200)
        issue_liste = "() => [...document.querySelectorAll('#repo-seite .issue-zeile')].map(z => [z.querySelector('.issue-betreff').textContent, z.querySelector('.repo-status').textContent, [...z.querySelectorAll('.issue-label')].map(l => l.textContent)])"
        issues = {"reiter": ev("() => document.querySelector('#repo-seite [data-reiter=issues]')?.textContent"), "liste": ev(issue_liste)}
        ev("() => document.querySelector('#repo-seite .issue-betreff')?.click()")
        s.wait_for_timeout(200)
        issues["seite"] = ev("""() => ({ titel: document.querySelector('#repo-seite .issue-titel')?.textContent,
          text: document.querySelector('#repo-seite .issue-kopf ~ .issue-text')?.textContent, fett: document.querySelectorAll('#repo-seite b').length,
          kommentare: [...document.querySelectorAll('#repo-seite .issue-kommentar .issue-text')].map(e => e.textContent),
          fokus: document.activeElement?.classList.contains('issue-zurueck') })""")
        # Seit C-17b2: kommentieren (öffentlich, NIP-22 an das Issue), als erledigt schließen, wieder öffnen – ich pflege „werkzeug“ mit
        issue_id = next(e["id"] for e in relay.events if e.get("kind") == 1621 and ["subject", "Hammer klemmt"] in e["tags"])
        kommentare_auf_seite = "() => [...document.querySelectorAll('#repo-seite .issue-kommentar .issue-text')].map(e => e.textContent)"
        vorher_k = len(relay.gesendet)
        issues["kommentar_hinweis"] = ev("() => document.querySelector('#repo-seite .kommentar-feld p')?.textContent ?? ''")
        if ev("() => !!document.querySelector('#repo-seite .kommentar-text')"):
            s.fill("#repo-seite .kommentar-text", "Ich schaue es mir an.")
            ev("() => document.querySelector('#repo-seite .kommentar-senden')?.click()")
        try:
            s.wait_for_function("() => [...document.querySelectorAll('#repo-seite .issue-kommentar .issue-text')].some(e => e.textContent === 'Ich schaue es mir an.')", timeout=10000)
        except Exception:
            pass
        k_neu = list({e["id"]: e for e in relay.gesendet[vorher_k:] if e.get("kind") == 1111}.values())
        k_tags = {t[0]: t[1:] for t in (k_neu[-1]["tags"] if k_neu else [])}
        issues["kommentar"] = {"anzahl": len(k_neu), "E": (k_tags.get("E") or [None])[0], "K": k_tags.get("K"), "liste": ev(kommentare_auf_seite)}
        aktionen = "() => [...document.querySelectorAll('#repo-seite .issue-aktionen button')].map(b => b.textContent)"
        marke = "() => document.querySelector('#repo-seite .patch-meta .repo-status')?.textContent"
        issues["aktionen"] = ev(aktionen)
        vorher_s = len(relay.gesendet)
        ev("() => document.querySelector('#repo-seite .issue-aktionen button')?.click()")  # als erledigt schließen
        try:
            s.wait_for_function("() => document.querySelector('#repo-seite .patch-meta .repo-status')?.textContent === 'erledigt ✓'", timeout=10000)
        except Exception:
            pass
        issues["erledigt"] = [ev(marke), ev(aktionen)]
        s.wait_for_timeout(1100)  # der nächste Status braucht einen späteren Zeitstempel (Sekunden)
        ev("() => document.querySelector('#repo-seite .issue-aktionen button')?.click()")  # wieder öffnen
        try:
            s.wait_for_function("() => document.querySelector('#repo-seite .patch-meta .repo-status')?.textContent === 'offen'", timeout=10000)
        except Exception:
            pass
        issues["wieder"] = ev(marke)
        issues["status_events"] = [[e["kind"], next((t[1] for t in e["tags"] if t[0] == "e"), None)]
                                   for e in {e["id"]: e for e in relay.gesendet[vorher_s:] if e.get("kind") in (1630, 1631, 1632)}.values()]
        ev("() => document.querySelector('#repo-seite .issue-zurueck')?.click()")
        s.wait_for_timeout(200)
        issues["zurueck"] = ev("() => document.activeElement?.classList.contains('issue-betreff') ?? false")
        vorher_issues = len([e for e in relay.gesendet if e.get("kind") == 1621])
        ev("() => document.querySelector('#repo-seite .issue-neu')?.click()")
        s.wait_for_timeout(200)
        issues["hinweis"] = ev("() => document.querySelector('[role=dialog] .dlg-text')?.textContent ?? ''")
        s.keyboard.type("Säge stumpf")
        s.keyboard.press("Tab")
        s.keyboard.type("Bitte schärfen.")
        s.keyboard.press("Tab")
        s.keyboard.type("wartung")
        s.keyboard.press("Enter")
        try:
            s.wait_for_function("() => [...document.querySelectorAll('#repo-seite .issue-betreff')].some(b => b.textContent === 'Säge stumpf')", timeout=10000)
        except Exception:
            pass
        neue_issues = [e for e in relay.gesendet if e.get("kind") == 1621][vorher_issues:]
        issue_tags = {t[0]: t[1:] for t in (neue_issues[-1]["tags"] if neue_issues else [])}
        issues["gesendet"] = {"anzahl": len({e["id"] for e in neue_issues}), "a": issue_tags.get("a"), "subject": issue_tags.get("subject"),
                              "t": issue_tags.get("t"), "text": neue_issues[-1]["content"] if neue_issues else None}
        issues["danach"] = ev(issue_liste)
        erg[groesse]["issues"] = issues
        gruender_pk = next(e["pubkey"] for e in relay.events if e.get("kind") == 30617)
        if issues["reiter"] != "Issues (1 offen)" or issues["liste"] != [["Hammer klemmt", "offen", ["bug"]]] \
                or issues["seite"] != {"titel": "Hammer klemmt", "text": "Seit gestern <b>fest</b>.", "fett": 0, "kommentare": ["Bei mir auch."], "fokus": True} \
                or not issues["zurueck"] or not issues["hinweis"].startswith("Öffentlich und mit deinem Schlüssel signiert") \
                or issues["gesendet"] != {"anzahl": 1, "a": [f"30617:{gruender_pk}:werkzeug"], "subject": ["Säge stumpf"], "t": ["wartung"], "text": "Bitte schärfen."} \
                or [z[0] for z in issues["danach"]] != ["Säge stumpf", "Hammer klemmt"]:
            erg["fehler"].append(f"{groesse}: Issues {issues}")
        if not issues["kommentar_hinweis"].startswith("Öffentlich und mit deinem Schlüssel signiert") \
                or issues["kommentar"] != {"anzahl": 1, "E": issue_id, "K": ["1621"], "liste": ["Bei mir auch.", "Ich schaue es mir an."]} \
                or issues["aktionen"] != ["Als erledigt schließen", "Als nicht geplant schließen"] \
                or issues["erledigt"] != ["erledigt ✓", ["Wieder öffnen"]] or issues["wieder"] != "offen" \
                or issues["status_events"] != [[1631, issue_id], [1630, issue_id]]:
            erg["fehler"].append(f"{groesse}: Issue kommentieren/schließen {issues}")
        # Seit C-20e: nach Label filtern – Auswahl mit Zahlen, Label-Knopf in der Zeile; die Zahlen offen/geschlossen folgen dem Filter
        ev("() => document.querySelector('#repo-seite .issue-zurueck')?.click()")
        s.wait_for_timeout(150)
        betreffe_i = "() => [...document.querySelectorAll('#repo-seite .issue-betreff')].map(b => b.textContent)"
        lf = {"wahl": ev("() => [...(document.getElementById('issue-label-wahl')?.options ?? [])].map(o => [o.value, o.textContent])")}
        if lf["wahl"]:
            s.select_option("#issue-label-wahl", "wartung")
            s.wait_for_timeout(150)
            lf["wartung"] = [ev(betreffe_i), ev("() => [...document.querySelectorAll('#repo-seite .repo-filter button[data-filter]')].map(b => b.textContent)"),
                             ev("() => document.activeElement?.id")]
            s.select_option("#issue-label-wahl", "")
            s.wait_for_timeout(150)
            ev("() => [...document.querySelectorAll('#repo-seite .issue-label-knopf')].find(b => b.textContent === 'bug')?.click()")
            s.wait_for_timeout(150)
            lf["bug"] = [ev(betreffe_i), ev("() => document.getElementById('issue-label-wahl')?.value"), ev("() => document.activeElement?.id")]
            s.select_option("#issue-label-wahl", "")
            s.wait_for_timeout(150)
            lf["alle"] = ev(betreffe_i)
        erg[groesse]["label_filter"] = lf
        if lf != {"wahl": [["", "Alle Labels"], ["bug", "bug (1)"], ["wartung", "wartung (1)"]],
                  "wartung": [["Säge stumpf"], ["offen (1)", "geschlossen (0)"], "issue-label-wahl"],
                  "bug": [["Hammer klemmt"], "bug", "issue-label-wahl"], "alle": ["Säge stumpf", "Hammer klemmt"]}:
            erg["fehler"].append(f"{groesse}: Label-Filter {lf}")
        # Seit C-20i2: Labels bearbeiten und Zuständige an „Hammer klemmt“ (ich pflege „werkzeug“ mit) – je ein Label-Event
        # (1985) mit dem ganzen Stand, danach auf der Seite: Labels in der Kopfzeile, „Zuständig: Du“
        ev("() => [...document.querySelectorAll('#repo-seite .issue-betreff')].find(b => b.textContent === 'Hammer klemmt')?.click()")
        s.wait_for_timeout(200)
        lab = {"vorher": ev("() => document.querySelector('#repo-seite .label-zustaendig')?.textContent")}
        vorher_l = len(relay.gesendet)
        ev("() => document.querySelector('#repo-seite .labels-bearbeiten')?.click()")
        s.wait_for_timeout(200)
        lab["feld"] = ev("() => document.querySelector('[role=dialog] input')?.value ?? null")
        s.keyboard.press("End")
        s.keyboard.type(", dringend")
        s.keyboard.press("Enter")
        try:
            s.wait_for_function("() => [...document.querySelectorAll('#repo-seite .patch-meta .issue-label-knopf')].some(b => b.textContent === 'dringend')", timeout=10000)
        except Exception:
            pass
        lab["labels"] = ev("() => [...document.querySelectorAll('#repo-seite .patch-meta .issue-label-knopf')].map(b => b.textContent)")
        s.wait_for_timeout(1100)
        ev("() => document.querySelector('#repo-seite .zustaendige-waehlen')?.click()")
        s.wait_for_timeout(200)
        lab["kandidaten"] = ev("() => [...document.querySelectorAll('[role=dialog] .dlg-wahl label')].map(l => l.textContent.trim())")
        ev("() => [...document.querySelectorAll('[role=dialog] .dlg-wahl label')].find(l => l.textContent.trim() === 'Du')?.querySelector('input')?.click()")
        ev("() => [...document.querySelectorAll('[role=dialog][aria-modal=true] button')].find(b => b.textContent === 'Speichern')?.click()")
        try:
            s.wait_for_function("() => document.querySelector('#repo-seite .label-zustaendig')?.textContent === 'Zuständig:Du'", timeout=10000)
        except Exception:
            pass
        lab["zustaendig"] = ev("() => document.querySelector('#repo-seite .label-zustaendig')?.textContent")
        l_neu = list({e["id"]: e for e in relay.gesendet[vorher_l:] if e.get("kind") == 1985}.values())
        lab["events"] = [[[t for t in e["tags"] if t[0] in ("L", "l")], next((t[1] for t in e["tags"] if t[0] == "e"), None) == issue_id,
                          next((t[1] for t in e["tags"] if t[0] == "k"), None)] for e in l_neu]
        erg[groesse]["labels"] = lab
        if lab["vorher"] != "Zuständig:niemand" or lab["feld"] != "bug" or lab["labels"] != ["bug", "dringend"] \
                or lab["zustaendig"] != "Zuständig:Du" or len(lab["kandidaten"]) != 3 or "Du" not in lab["kandidaten"] \
                or lab["events"] != [[[["L", "#t"], ["l", "bug", "#t"], ["l", "dringend", "#t"]], True, "1621"],
                                     [[["L", "freedomstack.zustaendig"], ["l", relay.ich, "freedomstack.zustaendig"]], True, "1621"]]:
            erg["fehler"].append(f"{groesse}: Labels und Zuständige {lab}")
        # Seit C-20h2: Reiter „Releases“ – leer, „Neues Release“ per Dialog (ich pflege „werkzeug“ mit): öffentlich, signiert,
        # Kind 30063 an das Repo, danach als Karte mit „Neuestes“ und Notizen als Markdown; „Zurückziehen“ fragt nach und ersetzt
        # das Release mit ["zurueckgezogen"] (eine Sekunde später – je Version zählt die neueste Aussage)
        ev("() => document.querySelector('#repo-seite [data-reiter=releases]')?.click()")
        s.wait_for_timeout(150)
        rel = {"reiter": ev("() => document.querySelector('#repo-seite [data-reiter=releases]')?.textContent"),
               "leer": ev("() => document.querySelector('#repo-seite .repo-inhalt p.muted')?.textContent")}
        vorher_rel = len(relay.gesendet)
        ev("() => document.querySelector('#repo-seite .release-neu')?.click()")
        s.wait_for_timeout(200)
        rel["hinweis"] = ev("() => document.querySelector('[role=dialog] .dlg-text')?.textContent ?? ''")
        s.keyboard.type("v1.0")
        s.keyboard.press("Tab")
        s.keyboard.type("Erste Version")
        s.keyboard.press("Tab")
        s.keyboard.type("**Neu:** der Hammer")
        s.keyboard.press("Control+Enter")
        try:
            s.wait_for_function("() => document.querySelector('#repo-seite .release-titel')?.textContent === 'Erste Version'", timeout=10000)
        except Exception:
            pass
        r_neu = [e for e in relay.gesendet[vorher_rel:] if e.get("kind") == 30063]
        r_tags = {t[0]: t[1:] for t in (r_neu[-1]["tags"] if r_neu else [])}
        rel["gesendet"] = {"anzahl": len({e["id"] for e in r_neu}), "d": r_tags.get("d"), "a": r_tags.get("a"), "version": r_tags.get("version"),
                           "title": r_tags.get("title"), "inhalt": r_neu[-1]["content"] if r_neu else None}
        rel["karte"] = ev("""() => { const k = document.querySelector('#repo-seite .release-karte'); return k ? [k.querySelector('.release-titel').textContent,
          [...k.querySelectorAll('.release-meta span')].slice(0, 2).map(e => e.textContent), k.querySelector('.issue-text strong')?.textContent,
          document.querySelector('#repo-seite [data-reiter=releases]')?.textContent] : null; }""")
        s.wait_for_timeout(1100)
        ev("() => document.querySelector('#repo-seite .release-zurueckziehen')?.click()")
        s.wait_for_timeout(200)
        rel["frage"] = ev("() => document.querySelector('[role=dialog] .dlg-titel')?.textContent ?? ''")
        ev("() => [...document.querySelectorAll('[role=dialog][aria-modal=true] button')].find(b => b.textContent === 'Zurückziehen')?.click()")
        try:
            s.wait_for_function("() => !document.querySelector('#repo-seite .release-karte')", timeout=10000)
        except Exception:
            pass
        rueck = [e for e in relay.gesendet[vorher_rel:] if e.get("kind") == 30063 and ["zurueckgezogen"] in e["tags"]]
        rel["rueckzug"] = [len({e["id"] for e in rueck}), ev("() => document.querySelector('#repo-seite .repo-inhalt p.muted')?.textContent")]
        erg[groesse]["releases"] = rel
        if rel["reiter"] != "Releases (0)" or rel["leer"] != "Noch keine Releases." \
                or not rel["hinweis"].startswith("Öffentlich und mit deinem Schlüssel signiert – jeder kann das Release") \
                or rel["gesendet"] != {"anzahl": 1, "d": ["werkzeug@v1.0"], "a": [f"30617:{gruender_pk}:werkzeug"], "version": ["v1.0"],
                                       "title": ["Erste Version"], "inhalt": "**Neu:** der Hammer"} \
                or rel["karte"] != ["Erste Version", ["v1.0", "Neuestes"], "Neu:", "Releases (1)"] \
                or rel["frage"] != "Release v1.0 zurückziehen?" or rel["rueckzug"] != [1, "Noch keine Releases."]:
            erg["fehler"].append(f"{groesse}: Releases {rel}")
        # Seit C-20j2: Stern (öffentlich, erst nach Rückfrage; zurück mit Löschung nach NIP-09) und Beobachten (privat –
        # Kind 10018 ohne offene Tags, die Adresse steht nicht im Inhalt)
        knopf_st = "() => [document.querySelector('#repo-seite .repo-stern')?.textContent, document.querySelector('#repo-seite .repo-stern')?.getAttribute('aria-pressed')]"
        st = {"vorher": ev(knopf_st)}
        vorher_st = len(relay.gesendet)
        ev("() => document.querySelector('#repo-seite .repo-stern')?.click()")
        s.wait_for_timeout(200)
        st["frage"] = ev("() => document.querySelector('[role=dialog] .dlg-titel')?.textContent ?? ''")
        ev("() => [...document.querySelectorAll('[role=dialog][aria-modal=true] button')].find(b => b.textContent === 'Stern geben')?.click()")
        try:
            s.wait_for_function("() => document.querySelector('#repo-seite .repo-stern')?.getAttribute('aria-pressed') === 'true'", timeout=10000)
        except Exception:
            pass
        st["danach"] = ev(knopf_st)
        sterne_neu = list({e["id"]: e for e in relay.gesendet[vorher_st:] if e.get("kind") == 7}.values())
        st["event"] = [len(sterne_neu), sterne_neu[-1]["content"] if sterne_neu else None, [t for t in (sterne_neu[-1]["tags"] if sterne_neu else []) if t[0] == "a"]]
        ev("() => document.querySelector('#repo-seite .repo-stern')?.click()")
        try:
            s.wait_for_function("() => document.querySelector('#repo-seite .repo-stern')?.getAttribute('aria-pressed') === 'false'", timeout=10000)
        except Exception:
            pass
        st["weg"] = [ev(knopf_st), len({e["id"] for e in relay.gesendet[vorher_st:] if e.get("kind") == 5 and sterne_neu and ["e", sterne_neu[-1]["id"]] in e["tags"]})]
        ev("() => document.querySelector('#repo-seite .repo-beobachten')?.click()")
        try:
            s.wait_for_function("() => document.querySelector('#repo-seite .repo-beobachten')?.getAttribute('aria-pressed') === 'true'", timeout=10000)
        except Exception:
            pass
        listen = [e for e in relay.gesendet[vorher_st:] if e.get("kind") == 10018]
        st["beobachten"] = [len({e["id"] for e in listen}), listen[-1]["tags"] if listen else None,
                            bool(listen) and "werkzeug" not in listen[-1]["content"], ev("() => document.querySelector('#repo-seite .repo-beobachten')?.textContent")]
        erg[groesse]["sterne"] = st
        if st["vorher"] != ["☆ Stern (0)", "false"] or st["frage"] != "„werkzeug“ einen Stern geben?" or st["danach"] != ["★ Stern entfernen (1)", "true"] \
                or st["event"] != [1, "⭐", [["a", f"30617:{gruender_pk}:werkzeug"]]] or st["weg"] != [["☆ Stern (0)", "false"], 1] \
                or st["beobachten"] != [1, [], True, "Nicht mehr beobachten"]:
            erg["fehler"].append(f"{groesse}: Sterne und Beobachten {st}")
        # Seit 11.4c: im eigenen öffentlichen Raum „Repo anlegen“ aus dem Raum-Menü – mit Verweis auf genau diesen Raum,
        # danach steht es in der Liste des Raums (am Ende, damit die Prüfungen der Repo-Liste oben nichts davon sehen)
        if not mobil:
            ev("() => { location.hash = '#/chat'; }")
            s.wait_for_timeout(200)
            werkstatt = ev("() => [...document.querySelectorAll('#space-rail .space-pill')].find(p => p.dataset.space.startsWith('werkstatt-'))?.dataset.space ?? ''")
            ev("() => [...document.querySelectorAll('#space-rail .space-pill')].find(p => p.dataset.space.startsWith('werkstatt-'))?.click()")
            try:
                s.wait_for_function("() => document.getElementById('space-repo-neu')?.classList.contains('hidden') === false", timeout=10000)
            except Exception:
                pass
            ev("() => document.getElementById('space-repo-neu')?.click()")
            s.wait_for_timeout(200)
            s.keyboard.type("raumrepo")
            s.keyboard.press("Enter")  # Dialog: Kennung
            s.wait_for_timeout(200)
            frage = ev("() => document.querySelector('[role=dialog] .dlg-text')?.textContent ?? ''")
            s.keyboard.press("Enter")  # Rückfrage: ankündigen
            try:
                s.wait_for_function("() => [...document.querySelectorAll('#raum-repos .raum-repo')].some(b => b.textContent === 'raumrepo')", timeout=10000)
            except Exception:
                pass
            neu_im_raum = [e for e in relay.gesendet if e.get("kind") == 30617 and ["d", "raumrepo"] in e["tags"]]
            verweis_raum = [t[1] for t in (neu_im_raum[-1]["tags"] if neu_im_raum else []) if t[0] == "a"]
            liste_raum = ev("() => [...document.querySelectorAll('#raum-repos .raum-repo')].map(b => b.textContent)")
            erg["desktop"]["repo_im_raum"] = {"frage": frage, "verweis": verweis_raum, "liste": liste_raum}
            if not frage.startswith("Repo „raumrepo“ im öffentlichen Raum „Werkstatt“ ankündigen?") or not werkstatt \
                    or verweis_raum != [f"34700:{relay.ich}:space:{werkstatt}"] or liste_raum != ["raumrepo"]:
                erg["fehler"].append(f"desktop: Repo im Raum anlegen {erg['desktop']['repo_im_raum']} {werkstatt}")
        # Seit C-20f: Neues seit dem letzten Blick. Den Blick auf „werkzeug“ zurückdrehen (ohne Tresor liegt er wie jedes
        # Geheimnis im localStorage) und neu laden: Die Karte zählt, was andere schrieben, „Neu“ filtert, Öffnen gilt als gesehen
        werkzeug_k = f"{next(e['pubkey'] for e in relay.events if e.get('kind') == 30617)}:werkzeug"
        ev("(k) => { const g = JSON.parse(localStorage.getItem('freedom.repos.gesehen') || '{}'); g[k] = 1; localStorage.setItem('freedom.repos.gesehen', JSON.stringify(g)); }", werkzeug_k)
        s.reload(wait_until="load")
        s.wait_for_timeout(1500)
        ev("() => document.getElementById('ein-abbrechen')?.click()")
        ev("() => { location.hash = '#/repos'; }")
        try:
            s.wait_for_function("() => !!document.querySelector('#repos-karten .repo-marke-neu')", timeout=15000)
        except Exception:
            pass
        neuig = {"karten": ev("() => [...document.querySelectorAll('#repos-karten .repo-karte')].map(k => [k.querySelector('.repo-name').textContent, k.querySelector('.repo-marke-neu')?.textContent ?? null, k.querySelector('.repo-marke-neu')?.title ?? null])")}
        ev("() => document.querySelector('#repos-filter [data-filter=neu]')?.click()")
        s.wait_for_timeout(150)
        neuig["filter"] = ev("() => [...document.querySelectorAll('#repos-karten .repo-name')].map(n => n.textContent)")
        ev("() => [...document.querySelectorAll('#repos-karten .repo-karte')].find(k => k.querySelector('.repo-name').textContent === 'werkzeug')?.click()")
        s.wait_for_timeout(300)
        ev("() => document.querySelector('#repo-seite .repo-zurueck')?.click()")
        s.wait_for_timeout(200)
        neuig["danach"] = [ev("() => [...document.querySelectorAll('#repos-karten .repo-name')].map(n => n.textContent)"),
                           ev("() => document.querySelector('#repos-karten p')?.textContent"),
                           ev("(k) => JSON.parse(localStorage.getItem('freedom.repos.gesehen') || '{}')[k] > 1", werkzeug_k)]
        ev("() => document.querySelector('#repos-filter [data-filter=alle]')?.click()")
        erg[groesse]["neuigkeiten"] = neuig
        if neuig != {"karten": NEUIGKEITEN_KARTEN[groesse], "filter": ["werkzeug"],
                     "danach": [[], "Nichts Neues in Repos, an denen du beteiligt bist.", True]}:
            erg["fehler"].append(f"{groesse}: Neuigkeiten {neuig}")
        # Seit C-20j3: „werkzeug“ forken (ich bin Maintainer, nicht Eigentümer) – eigene Ankündigung mit
        # ["a", <original>, "", "fork"], kein Bundle-Verweis (das Original hat keinen Schlüssel), danach „Forks: 1“;
        # der Fork zeigt „Geforkt von … / werkzeug“ und führt zum Original zurück
        werkzeug_karte = "() => [...document.querySelectorAll('#repos-karten .repo-karte')].find(k => k.querySelector('.repo-name').textContent === 'werkzeug' && k.querySelector('.repo-eigentuemer').textContent !== 'Du')"
        ev(f"() => ({werkzeug_karte})()?.click()")
        s.wait_for_timeout(200)
        fk = {"vorher": ev("() => document.querySelector('#repo-seite .repo-fork-zahl span')?.textContent")}
        vorher_fk = len(relay.gesendet)
        ev("() => document.querySelector('#repo-seite .repo-forken')?.click()")
        s.wait_for_timeout(200)
        fk["felder"] = ev("() => [...document.querySelectorAll('[role=dialog] input')].map(i => i.value)")
        s.keyboard.press("Enter")
        try:
            s.wait_for_function("() => document.querySelector('#repo-seite .repo-fork-zahl span')?.textContent === 'Forks: 1'", timeout=10000)
        except Exception:
            pass
        fk["danach"] = ev("() => document.querySelector('#repo-seite .repo-fork-zahl span')?.textContent")
        ank = list({e["id"]: e for e in relay.gesendet[vorher_fk:] if e.get("kind") == 30617}.values())
        fk["gesendet"] = [len(ank), [t for t in (ank[-1]["tags"] if ank else []) if t[0] in ("d", "a")],
                          len({e["id"] for e in relay.gesendet[vorher_fk:] if e.get("kind") == 38042})]
        ev("() => document.querySelector('#repo-seite .repo-zurueck')?.click()")
        s.wait_for_timeout(200)
        ev("() => [...document.querySelectorAll('#repos-karten .repo-karte')].find(k => k.querySelector('.repo-name').textContent === 'werkzeug' && k.querySelector('.repo-eigentuemer').textContent === 'Du')?.click()")
        s.wait_for_timeout(200)
        fk["herkunft"] = ev("() => document.querySelector('#repo-seite .repo-fork-herkunft span')?.textContent ?? ''")
        fk["forken_bei_mir"] = ev("() => !!document.querySelector('#repo-seite .repo-forken')")
        ev("() => document.querySelector('#repo-seite .repo-zum-original')?.click()")
        s.wait_for_timeout(200)
        fk["original"] = ev("() => [document.querySelector('#repo-seite .repo-eigentuemer')?.textContent !== 'Du', document.querySelector('#repo-seite .repo-fork-zahl span')?.textContent]")
        erg[groesse]["fork"] = fk
        if fk["vorher"] != "Forks: 0" or fk["felder"] != ["werkzeug", "werkzeug"] or fk["danach"] != "Forks: 1" \
                or fk["gesendet"] != [1, [["d", "werkzeug"], ["a", f"30617:{gruender_pk}:werkzeug", "", "fork"]], 0] \
                or not (fk["herkunft"].startswith("Geforkt von ") and fk["herkunft"].endswith(" / werkzeug")) or fk["forken_bei_mir"] \
                or fk["original"] != [True, "Forks: 1"]:
            erg["fehler"].append(f"{groesse}: Fork {fk}")
        # Seit B-2b: Repo nur auf diesem Gerät – über „Wo“ angelegt (ohne Rückfrage), Bundle abgelegt, Code gelesen.
        # Dabei geht nichts hinaus: keine Ankündigung, keine Bundle-Referenz, kein Stück ins Blob-Netz.
        # Seit B-2c: danach veröffentlicht (Ankündigung und Bundle gehen hinaus, die Kopie auf dem Gerät entfällt);
        # gelöscht wird ein zweites lokales Repo
        if not mobil:
            netz = lambda: len([e for e in relay.gesendet if e.get("kind") in (30617, 38040, 38041, 38042)])
            vorher_netz = netz()
            karte_von = lambda name: f"() => [...document.querySelectorAll('#repos-karten .repo-karte')].find(k => k.querySelector('.repo-name').textContent === '{name}')"
            def lokal_anlegen(name: str) -> None:
                ev("() => document.querySelector('#repo-seite .repo-zurueck')?.click()")
                ev("() => document.getElementById('nip34-ankuendigen').click()")
                s.wait_for_timeout(200)
                s.keyboard.type(name)
                ev("() => [...document.querySelectorAll('[role=dialog] input[type=radio]')].find(e => e.value === 'lokal')?.click()")
                s.keyboard.press("Enter")  # Dialog bestätigen – lokal ohne Rückfrage
                try:
                    s.wait_for_function(f"() => !!({karte_von(name)})()", timeout=8000)
                except Exception:
                    pass
            lokal_anlegen("nurhier")
            lokal = {"marke": ev(f"() => [...(({karte_von('nurhier')})()?.querySelectorAll('.msg-role') ?? [])].map(m => m.textContent)")}
            ev(f"() => ({karte_von('nurhier')})()?.click()")
            s.wait_for_timeout(200)
            lokal["reiter"] = ev("() => [...document.querySelectorAll('#repo-seite [data-reiter]')].map(b => b.dataset.reiter)")
            lokal["zeile"] = ev("() => document.querySelector('#repo-seite .repo-lokal span')?.textContent ?? ''").startswith("🔒 Nur auf diesem Gerät")
            ev("() => document.querySelector('#repo-seite [data-reiter=einstellungen]')?.click()")
            s.wait_for_timeout(200)
            if ev("() => !!document.querySelector('#repo-seite .repo-hochladen input[type=file]')"):
                s.set_input_files("#repo-seite .repo-hochladen input[type=file]",
                                  files=[{"name": "nurhier.bundle", "mimeType": "application/octet-stream", "buffer": PROBE_MD_BUNDLE}])
            try:
                s.wait_for_function("() => document.querySelectorAll('#repo-seite .repo-klon button').length > 0", timeout=8000)
            except Exception:
                pass
            ev("() => document.querySelector('#repo-seite [data-reiter=code]')?.click()")
            s.wait_for_timeout(200)
            lokal["hinweis"] = ev("() => document.querySelector('#repo-seite .repo-inhalt p')?.textContent ?? ''")
            ev("() => document.querySelector('#repo-seite .code-laden')?.click()")
            try:
                s.wait_for_function("() => !!document.querySelector('#repo-seite .code-readme h1') || !!document.querySelector('#repo-seite .repo-fehler')?.textContent", timeout=15000)
            except Exception:
                pass
            lokal["readme"] = ev("() => document.querySelector('#repo-seite .code-readme h1')?.textContent ?? document.querySelector('#repo-seite .repo-fehler')?.textContent")
            # In der Datenbank nur Chiffrat
            lokal["chiffrat"] = ev("""async () => { const db = await new Promise((r, f) => { const q = indexedDB.open('freedom-repos'); q.onsuccess = () => r(q.result); q.onerror = () => f(q.error); });
              const werte = await new Promise((r) => { const q = db.transaction('bundles').objectStore('bundles').getAll(); q.onsuccess = () => r(q.result); });
              db.close(); return werte.map((v) => new TextDecoder().decode(v).includes('Werkzeugkiste')); }""")
            lokal["netz"] = netz() - vorher_netz
            # Veröffentlichen (B-2c): erst die Rückfrage, dann Ankündigung und Bundle; danach die öffentliche Seite mit allen Reitern
            ev("() => document.querySelector('#repo-seite .repo-lokal-veroeffentlichen')?.click()")
            s.wait_for_timeout(200)
            lokal["frage"] = ev("() => document.querySelector('[role=dialog] .dlg-text')?.textContent ?? ''").startswith("„nurhier“ veröffentlichen?")
            s.keyboard.press("Enter")  # Rückfrage: veröffentlichen
            try:
                s.wait_for_function("() => !document.querySelector('#repo-seite .repo-lokal') && !!document.querySelector('#repo-seite [data-reiter=issues]')", timeout=15000)
            except Exception:
                pass
            raus = [e for e in relay.gesendet if e.get("kind") in (30617, 38042) and ["d", "nurhier"] in e["tags"]]
            lokal["veroeffentlicht"] = [sorted({e["kind"] for e in raus}), ev("() => JSON.parse(localStorage.getItem('freedom.repos.lokal') || '[]').length"),
                                        ev("() => [...document.querySelectorAll('#repo-seite [data-reiter]')].map(b => b.dataset.reiter).includes('issues')")]
            # Löschen: ein zweites lokales Repo, nichts geht hinaus
            vorher_netz = netz()
            lokal_anlegen("weg")
            ev(f"() => ({karte_von('weg')})()?.click()")
            s.wait_for_timeout(200)
            ev("() => document.querySelector('#repo-seite .repo-lokal-loeschen')?.click()")
            s.wait_for_timeout(200)
            ev("() => document.querySelector('[role=dialog] .dlg-gefahr')?.click()")
            try:
                s.wait_for_function(f"() => !document.getElementById('repos-liste-ansicht').classList.contains('hidden') && !({karte_von('weg')})()", timeout=8000)
            except Exception:
                pass
            lokal["geloescht"] = [ev(f"() => !({karte_von('weg')})()"), ev("() => JSON.parse(localStorage.getItem('freedom.repos.lokal') || '[]').length"), netz() - vorher_netz]
            erg["desktop"]["repo_lokal"] = lokal
            if lokal != {"marke": ["nur dieses Gerät"], "reiter": ["code", "commits", "einstellungen"], "zeile": True,
                         "hinweis": "Das Bundle liegt nur auf diesem Gerät, mit Tresor verschlüsselt; die App liest es nur hier.",
                         "readme": "Werkzeugkiste", "chiffrat": [False], "netz": 0, "frage": True, "veroeffentlicht": [[30617, 38042], 0, True],
                         "geloescht": [True, 0, 0]}:
                erg["fehler"].append(f"desktop: Repo nur auf diesem Gerät {lokal}")
        ctx.close()
    erg["bestanden"] = not erg["fehler"]
    return erg


def karte_pruefen(browser, url: str) -> dict:
    """Abdeckungskarte (C.4a): eigenes SVG, nur Zellen über der Schwelle, fremde Namen als Text,
    Tastatur (Pfeile, +/−, 0, Tab, Enter), Maus (Rad, Ziehen, Klick) bzw. Antippen, Ebenen, „Karte | Liste“.
    Seit C.4b: Umrisse, eigener Ort nur gerundet (auch ein alter genauer Wert), eigene Zelle umrandet,
    „Mein Gebiet“, Eintragen über Dialoge, Vergessen. Der Browser meldet einen festen Probe-Ort."""
    erg = {"fehler": []}
    basis = url.rsplit("/", 1)[0]
    probe = raum_probe("0" * 64)  # Abdeckung hängt nicht am eigenen Schlüssel
    for groesse, vp in [("desktop", {"width": 1280, "height": 800}), ("mobil", {"width": 390, "height": 844})]:
        mobil = groesse == "mobil"
        relay = ProbeRelay()
        relay.events = list(probe)
        ctx = browser.new_context(locale="de-DE", viewport=vp, is_mobile=mobil, has_touch=mobil,
                                  geolocation={"latitude": 48.137154, "longitude": 11.576124}, permissions=["geolocation"])
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
        # Seit C.4b: ein genauer Ort wie vor C.4b gespeichert – die App rundet ihn beim ersten Lesen
        ev("() => localStorage.setItem('freedom.coverage.cell', '[48.137154,11.576124]')")
        ev("() => { location.hash = '#/netz'; }")
        try:
            s.wait_for_function("() => document.querySelectorAll('#coverage-svg .karte-zelle').length > 0", timeout=15000)
        except Exception:
            pass
        stand = """() => { const k = document.querySelector('#coverage-svg svg'); const r = (e) => e.getBoundingClientRect();
          return { zellen: [...document.querySelectorAll('#coverage-svg .karte-zelle')].map(z => z.dataset.zelle),
            viewBox: k?.getAttribute('viewBox').split(' ').map(v => Math.round(+v * 10) / 10).join(' '), fett: document.querySelectorAll('#coverage-svg b, #coverage-list b').length,
            titel: [...document.querySelectorAll('#coverage-svg .karte-zelle title')].map(t => t.textContent),
            info: document.getElementById('coverage-zelle').textContent,
            hinweis: document.getElementById('coverage-karte-hinweis').textContent,
            fokus: document.activeElement?.dataset?.zelle || document.activeElement?.tagName || null,
            breite: k ? Math.round(r(k).width) : 0, hoehe: k ? Math.round(r(k).height) : 0,
            ueberlauf: document.documentElement.scrollWidth > innerWidth,
            legende: [...document.querySelectorAll('#coverage-ebenen button')].map(b => [b.textContent, b.getAttribute('aria-pressed'), !!b.querySelector('.karte-probe')]),
            muster: [...document.querySelectorAll('#coverage-svg pattern')].map(p => p.id),
            land: document.querySelector('#coverage-svg .karte-land')?.getAttribute('d')?.length || 0,
            eigen: [...document.querySelectorAll('#coverage-svg .karte-eigen')].map(e => ['x', 'y', 'width'].map(a => e.getAttribute(a)).join(' ')),
            gespeichert: localStorage.getItem('freedom.coverage.cell'),
            hier: document.getElementById('coverage-here').textContent,
            meins: !document.getElementById('coverage-meins').classList.contains('hidden'),
            vergessen: !document.getElementById('coverage-vergessen').classList.contains('hidden') }; }"""
        erst = ev(stand)
        erg[groesse] = {"erst": erst}
        soll_zellen = ["online:50.00,8.00", "bluetooth:47.00,8.00", "lora:48.00,11.00"]
        if erst["zellen"] != soll_zellen or erst["viewBox"] != "0 0 360 180" or erst["fett"] != 0 \
                or not any("<b>fett</b> Tal" in t for t in erst["titel"]) or "1 Gebiet(e) nicht angezeigt" not in erst["hinweis"] \
                or erst["muster"] != ["muster-online", "muster-lora", "muster-bluetooth"] or erst["ueberlauf"] \
                or [l[1:] for l in erst["legende"]] != [["true", True]] * 3 or abs(erst["breite"] - 2 * erst["hoehe"]) > 2 or erst["breite"] < 300:
            erg["fehler"].append(f"{groesse}: Karte {erst}")
        # C.4b: Umrisse eingebettet, alter Wert gerundet überschrieben, eigene Zelle nur umrandet
        if not (1000 < erst["land"] <= 40 * 1024) or erst["gespeichert"] != "[48,11.5]" or erst["eigen"] != ["191.5 41.5 0.5"] \
                or not erst["meins"] or not erst["vergessen"] or "gebraucht" in erst["hier"]:
            erg["fehler"].append(f"{groesse}: eigenes Gebiet {erst}")
        # Tastatur: + zoomt, Pfeil verschiebt, 0 zurück; Tab springt zur ersten Zelle, Enter zeigt ihre Angaben
        ev("() => document.querySelector('#coverage-svg svg').focus()")
        schritte = {}
        for taste in ["+", "ArrowLeft", "-", "0"]:
            s.keyboard.press(taste)
            s.wait_for_timeout(50)
            schritte[taste] = ev(stand)["viewBox"]
        s.keyboard.press("Tab")
        s.keyboard.press("Enter")
        s.wait_for_timeout(100)
        tasten = ev(stand)
        erg[groesse]["tastatur"] = {"viewBox": schritte, "info": tasten["info"], "fokus": tasten["fokus"]}
        if schritte != {"+": "60 30 240 120", "ArrowLeft": "36 30 240 120", "-": "0 0 360 180", "0": "0 0 360 180"} \
                or tasten["info"] != "Provider im Netz: Probe-Stadt – wenige" or tasten["fokus"] != "online:50.00,8.00":
            erg["fehler"].append(f"{groesse}: Tastatur {erg[groesse]['tastatur']}")
        # Zeiger: am Desktop Rad, Ziehen und Klick; mobil zwei Finger über Europa, dann Antippen
        box = s.locator("#coverage-svg svg").bounding_box()
        zahlen = lambda v: [float(x) for x in v.split(" ")]
        if not mobil:
            s.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            s.mouse.wheel(0, -100)
            s.wait_for_timeout(100)
            gezoomt = ev(stand)["viewBox"]
            s.mouse.down()
            s.mouse.move(box["x"] + box["width"] / 2 + 100, box["y"] + box["height"] / 2, steps=5)
            s.mouse.up()
            s.wait_for_timeout(100)
            gezogen = ev(stand)["viewBox"]
            ev("() => document.getElementById('coverage-welt').click()")
            s.wait_for_timeout(100)
            try:
                s.locator('#coverage-svg [data-zelle="bluetooth:47.00,8.00"]').click(timeout=5000)
            except Exception as e:
                erg["fehler"].append(f"desktop: Klick {str(e)[:120]}")
            zeiger = {"rad": gezoomt, "gezogen": gezogen}
            g = zahlen(gezogen)
            if gezoomt != "36 18 288 144" or not (0 < g[0] < 36) or g[1:] != [18, 288, 144]:
                erg["fehler"].append(f"desktop: Rad und Ziehen {zeiger}")
        else:
            ev("""() => { const k = document.querySelector('#coverage-svg svg'); const r = k.getBoundingClientRect();
              const x = r.left + 188.5 / 360 * r.width, y = r.top + 42.5 / 180 * r.height;
              const p = (typ, id, dx) => k.dispatchEvent(new PointerEvent(typ, { pointerId: id, clientX: x + dx, clientY: y, bubbles: true, pointerType: 'touch', isPrimary: id === 1 }));
              p('pointerdown', 1, -10); p('pointerdown', 2, 10); p('pointermove', 1, -80); p('pointermove', 2, 80); p('pointerup', 1, -80); p('pointerup', 2, 80); }""")
            s.wait_for_timeout(100)
            zwei = ev(stand)["viewBox"]
            z = zahlen(zwei)
            zeiger = {"zweiFinger": zwei}
            # 20 → 90 → 160 Pixel Abstand: achtmal näher; der Punkt zwischen den Fingern (8,5° O, 47,5° N) bleibt
            # an seiner Stelle auf dem Schirm – bei 188,5 von 360 der Breite und 42,5 von 180 der Höhe
            if z[2:] != [45, 22.5] or abs(z[0] + 45 * 188.5 / 360 - 188.5) > 0.2 or abs(z[1] + 22.5 * 42.5 / 180 - 42.5) > 0.2:
                erg["fehler"].append(f"mobil: zwei Finger {zeiger}")
            try:
                s.locator('#coverage-svg [data-zelle="bluetooth:47.00,8.00"]').tap(timeout=5000)
            except Exception as e:
                erg["fehler"].append(f"mobil: Antippen {str(e)[:120]}")
        s.wait_for_timeout(100)
        zeiger["info"] = ev(stand)["info"]
        erg[groesse]["zeiger"] = zeiger
        if zeiger["info"] != "Bluetooth: <b>fett</b> Tal – wenige":
            erg["fehler"].append(f"{groesse}: Zelle wählen {zeiger}")
        # Ebenen: „Provider im Netz“ aus – die Zelle verschwindet, der Schalter meldet es
        ev("() => document.querySelector('#coverage-ebenen [data-ebene=online]').click()")
        s.wait_for_timeout(100)
        ohne = ev(stand)
        ev("() => document.querySelector('#coverage-ebenen [data-ebene=online]').click()")
        # Liste als gleichwertige Ansicht: alle Gebiete, ohne Namen mit ihrer Mitte, Fremdes als Text
        ev("() => document.querySelector('#coverage-ansicht [data-ansicht=liste]').click()")
        s.wait_for_timeout(100)
        liste = ev("""() => ({ karte: getComputedStyle(document.getElementById('coverage-karte')).display,
          zeilen: [...document.querySelectorAll('#coverage-list .abdeckung-ort')].map(z => z.textContent),
          gedrueckt: [...document.querySelectorAll('#coverage-ansicht button')].map(b => b.getAttribute('aria-pressed')) })""")
        erg[groesse]["ebenen_liste"] = {"ohne": ohne["zellen"], "legende": ohne["legende"][0][1], "liste": liste}
        if ohne["zellen"] != soll_zellen[1:] or ohne["legende"][0][1] != "false" or liste["karte"] != "none" \
                or liste["gedrueckt"] != ["false", "true"] \
                or sorted(liste["zeilen"]) != sorted(["🌐 Probe-Stadt · wenige", "🔵 <b>fett</b> Tal · wenige", "📡 um 48,25° N, 11,25° O · wenige"]):
            erg["fehler"].append(f"{groesse}: Ebenen und Liste {erg[groesse]['ebenen_liste']}")
        # C.4b: „Mein Gebiet“ zoomt dorthin; Eintragen über zwei Dialoge (Ebene, Einwilligung) sendet nur die Zelle;
        # „Gebiet vergessen“ löscht den Ort, „mein Gebiet zeigen“ holt ihn gerundet zurück
        ev("() => { document.querySelector('#coverage-ansicht [data-ansicht=karte]').click(); document.getElementById('coverage-meins').click(); }")
        s.wait_for_timeout(100)
        eigen = {"meins": ev(stand)["viewBox"]}
        ok_knopf = "() => [...document.querySelectorAll('.dlg-knoepfe button')].at(-1)?.click()"
        ev("() => document.getElementById('coverage-join').click()")
        s.wait_for_timeout(300)
        eigen["dialog1"] = ev("() => [document.querySelector('.dlg-titel')?.textContent, [...document.querySelectorAll('.dlg-option-text')].map(o => o.textContent)]")
        ev(ok_knopf)
        s.wait_for_timeout(300)
        eigen["dialog2"] = ev("() => document.querySelector('.dlg-titel')?.textContent")
        ev(ok_knopf)
        try:
            s.wait_for_function("() => document.querySelectorAll('#coverage-svg .karte-eigen').length === 1 && !document.querySelector('.dlg-box')", timeout=10000)
            s.wait_for_timeout(800)
        except Exception:
            pass
        gesendet = [e for e in relay.gesendet if e.get("kind") == 38055]
        eigen["eintrag"] = [[t for t in e["tags"] if t[0] in ("layer", "cell", "region")] for e in {e["id"]: e for e in gesendet}.values()]
        ev("() => document.getElementById('coverage-vergessen').click()")
        s.wait_for_timeout(800)
        weg = ev(stand)
        eigen["vergessen"] = [weg["gespeichert"], weg["eigen"], weg["meins"], weg["vergessen"]]
        ev("() => document.getElementById('coverage-standort').click()")
        try:
            s.wait_for_function("() => localStorage.getItem('freedom.coverage.cell') && document.querySelectorAll('#coverage-svg .karte-eigen').length === 1", timeout=10000)
        except Exception:
            pass
        zurueck = ev(stand)
        eigen["zurueck"] = [zurueck["gespeichert"], zurueck["eigen"], zurueck["meins"]]
        erg[groesse]["eigen"] = eigen
        if eigen["meins"] != "169.3 30.5 45 22.5" or eigen["dialog1"] != ["Was trägst du ein?", ["Funk (LoRa)", "Bluetooth"]] \
                or eigen["dialog2"] != "Öffentlich eintragen?" \
                or eigen["eintrag"] != [[["layer", "lora"], ["cell", "48.00,11.50"], ["region", ""]]] \
                or eigen["vergessen"] != [None, [], False, False] or eigen["zurueck"] != ["[48,11.5]", ["191.5 41.5 0.5"], True]:
            erg["fehler"].append(f"{groesse}: eigenes Gebiet und Eintragen {eigen}")
        ctx.close()
    erg["bestanden"] = not erg["fehler"]
    return erg


# Seiten für den Durchgang auf dem Handy (seit C.5a): Adresse und Unter-Reiter („gruppe:reiter“)
MOBIL_SEITEN = [
    ("#/agent", ""), ("#/agent/verlauf", ""), ("#/agent/modelle", ""), ("#/agent/details", ""), ("#/chat", ""), ("#/repos", ""),
    ("#/waehrung", ""), ("#/waehrung", "wallet:swap"), ("#/waehrung", "wallet:lp"), ("#/waehrung", "wallet:pay"), ("#/verdienen", ""),
    ("#/verdienen", "earn:host"), ("#/verdienen", "earn:refer"), ("#/netz", ""), ("#/netz", "netz:mesh"), ("#/netz", "netz:pruefung"),
    ("#/profil", ""), ("#/settings", ""), ("#/settings", "settings:network"), ("#/mehr", ""),
]
MOBIL_MESSEN = """() => {
  const sichtbar = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && r.bottom > 0 && r.top < innerHeight; };
  // Ein Häkchen im Label ist über das ganze Label zu treffen – gemessen wird dann das Label
  const ziele = [...document.querySelectorAll('#app button, #app a[href], #app [role=button]:not(rect), #app [role=tab], #app select, #app summary, #app input:not([type=hidden]), #app label:has(> input)')]
    .filter(e => sichtbar(e) && !(e.matches('input') && e.closest('label')) && !e.closest('[inert]'));
  const klein = ziele.filter(e => { const r = e.getBoundingClientRect(); return r.height < 39.5 || r.width < 39.5; })
    .map(e => (e.id ? '#' + e.id : e.tagName.toLowerCase()) + ' ' + Math.round(e.getBoundingClientRect().width) + '×' + Math.round(e.getBoundingClientRect().height));
  // Seit C.5b: Text, der aus seinem Knopf oder Reiter läuft (so überlagerten sich die Settings-Reiter,
  // als ein min-width das Mindestmaß der Flex-Elemente aufhob)
  const ueber = ziele.filter(e => e.matches('button, [role=tab]') && e.scrollWidth > e.clientWidth + 1)
    .map(e => (e.id ? '#' + e.id : e.tagName.toLowerCase()) + ' „' + e.textContent.trim().slice(0, 20) + '“');
  // Seit C.5b: linker Rand von Seitentitel und erster Karte – auf allen Seiten gleich
  const seite = document.querySelector('.tab-page.active');
  const rand = ['.page-head .page-title', '.page-body .card'].map(sel => { const e = seite?.querySelector(sel); const r = e?.getBoundingClientRect();
    return r && r.width ? Math.round(r.left) : null; });
  return { laufleiste: document.documentElement.scrollWidth - innerWidth, klein: [...new Set(klein)], ueber: [...new Set(ueber)], rand };
}"""


def mobil_pruefen(browser, url: str) -> dict:
    """Handy hochkant und quer (C.5a): keine Seite mit waagrechter Laufleiste, jede Berührfläche mindestens
    40 px, das eigene Bild in der Kopfzeile, beim Tippen weicht die untere Leiste. Seit C.5b: gleiche Ränder
    auf allen Seiten, die Hinweisleiste flach, ihr Text klappt mit „mehr“ auf."""
    erg = {"fehler": []}
    basis = url.rsplit("/", 1)[0]
    for lage, vp in [("hoch", {"width": 390, "height": 844}), ("quer", {"width": 844, "height": 390})]:
        ctx = browser.new_context(locale="de-DE", viewport=vp, is_mobile=True, has_touch=True)
        ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith(basis) else r.abort())
        ctx.route_web_socket(re.compile(r"^wss?://"), ProbeRelay().verbinde)
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
        s.wait_for_timeout(300)
        seiten, raender = {}, set()
        for adresse, reiter in MOBIL_SEITEN:
            ev("(a) => { location.hash = a; }", adresse)
            s.wait_for_timeout(300)
            if reiter:
                gruppe, sub = reiter.split(":")
                ev("([g, r]) => document.querySelector(`[data-subtab-group='${g}'] [data-subtab='${r}']`)?.click()", [gruppe, sub])
                s.wait_for_timeout(150)
            m = ev(MOBIL_MESSEN)
            raender.update(r for r in m["rand"] if r is not None)
            if m["laufleiste"] > 0 or m["klein"] or m["ueber"]:
                seiten[f"{adresse} {reiter}".strip()] = m
        erg[lage] = {"seiten": seiten, "raender": sorted(raender)}
        if seiten:
            erg["fehler"].append(f"{lage}: {seiten}")
        if len(raender) != 1:
            erg["fehler"].append(f"{lage}: verschiedene Ränder {sorted(raender)}")
        # Hinweisleiste (C.5b): eine Zeile mit Titel und Knöpfen; „mehr“ klappt den Text auf und wieder zu
        leiste_ob = """() => { const b = document.getElementById('onboarding-bar'); const m = document.getElementById('ob-mehr');
          const t = document.getElementById('ob-body') ?? b.querySelector('.ob-body');
          return { hoehe: Math.round(b.getBoundingClientRect().height), text: !!t && getComputedStyle(t).display !== 'none',
            mehr: m?.getAttribute('aria-expanded'), knopf: m?.textContent }; }"""
        zu = ev(leiste_ob)
        ev("() => document.getElementById('ob-mehr')?.click()")
        auf = ev(leiste_ob)
        ev("() => document.getElementById('ob-mehr')?.click()")
        wieder = ev(leiste_ob)
        erg[lage]["hinweisleiste"] = [zu, auf, wieder]
        if zu["hoehe"] > 56 or zu["text"] or zu["mehr"] != "false" or zu["knopf"] != "mehr" \
                or not auf["text"] or auf["mehr"] != "true" or auf["knopf"] != "weniger" or auf["hoehe"] <= zu["hoehe"] or wieder != zu:
            erg["fehler"].append(f"{lage}: Hinweisleiste {erg[lage]['hinweisleiste']}")
        # Kopfzeile: vor dem Schlüssel das eigene Bild (ohne Namen „?“), die Fläche zum Profil mindestens 40 px hoch
        kopf = ev("""() => { const i = document.getElementById('ident'); const vor = getComputedStyle(i, '::before');
          return { initial: i.dataset.initial, bild: vor.content, breite: vor.width, hoehe: Math.round(i.getBoundingClientRect().height),
            text: i.textContent.includes('…') }; }""")
        erg[lage]["kopf"] = kopf
        if lage == "hoch" and (kopf["initial"] != "?" or kopf["bild"] != '"?"' or kopf["breite"] != "28px" or kopf["hoehe"] < 40 or not kopf["text"]):
            erg["fehler"].append(f"{lage}: Kopfzeile {kopf}")
        # Tastatur: im Eingabefeld weicht die untere Leiste, danach ist sie wieder da
        ev("() => { location.hash = '#/agent'; }")
        s.wait_for_timeout(300)
        leiste = "() => getComputedStyle(document.querySelector('.app-nav')).display"
        vorher = ev(leiste)
        s.locator("#ai-prompt").focus()
        s.wait_for_timeout(50)
        beim_tippen = ev(leiste)
        ev("() => document.activeElement.blur()")
        s.wait_for_timeout(50)
        danach = ev(leiste)
        erg[lage]["tastatur"] = [vorher, beim_tippen, danach]
        if vorher == "none" or beim_tippen != "none" or danach == "none":
            erg["fehler"].append(f"{lage}: untere Leiste beim Tippen {erg[lage]['tastatur']}")
        # Senden beim Tippen (Nutzertest 08.10.): Der Tipp auf „Senden“ kommt beim Knopf an. Vorher kehrte die
        # Leiste beim Drücken zurück, alles rutschte um ihre Höhe, und der Klick ging an den Rahmen. Der Klick
        # wird hier abgefangen – gesendet wird nichts.
        s.locator("#ai-prompt").focus()
        s.wait_for_timeout(50)
        ziel = ev("""() => { window.__tipp = [];
          document.addEventListener('click', (e) => { window.__tipp.push(e.target.closest('button')?.id || e.target.id || e.target.tagName);
            e.stopImmediatePropagation(); e.preventDefault(); }, { capture: true, once: true });
          const k = document.getElementById('ai-send'); k.scrollIntoView({ block: 'nearest' });
          const r = k.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }""")
        s.touchscreen.tap(ziel[0], ziel[1])
        s.wait_for_timeout(300)
        getippt = ev("() => [window.__tipp, document.activeElement?.id ?? null]")
        erg[lage]["senden_beim_tippen"] = getippt
        if getippt[0] != ["ai-send"] or getippt[1] != "ai-prompt":
            erg["fehler"].append(f"{lage}: Senden beim Tippen trifft {getippt[0]}, Fokus danach {getippt[1]}")
        ev("() => document.activeElement.blur()")
        ctx.close()
    # C.6b: zwischen 860 und 1199 px steht die Seitenleiste des Agenten da, das rechte Feld nicht –
    # dort führt nur „Arbeitsbereich“ dorthin und zurück
    ctx = browser.new_context(locale="de-DE", viewport={"width": 1100, "height": 800})
    ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith(basis) else r.abort())
    ctx.route_web_socket(re.compile(r"^wss?://"), ProbeRelay().verbinde)
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
    ev("() => { location.hash = '#/agent'; }")
    s.wait_for_timeout(300)
    zu_sehen = """() => Object.fromEntries(['#agent-zu-verlauf', '#agent-zu-details', '.agent-side', '.agent-main', '.agent-panel'].map(k => {
      const e = document.querySelector(k); return [k, !!e && e.getBoundingClientRect().width > 0 && getComputedStyle(e).display !== 'none']; }))"""
    breit = [ev(zu_sehen)]
    ev("() => document.getElementById('agent-zu-details').click()")
    s.wait_for_timeout(200)
    breit.append(ev(zu_sehen))
    ev("() => document.getElementById('agent-panel-zurueck').click()")
    s.wait_for_timeout(200)
    breit.append(ev(zu_sehen))
    erg["1100"] = breit
    soll = [{"#agent-zu-verlauf": False, "#agent-zu-details": True, ".agent-side": True, ".agent-main": True, ".agent-panel": False},
            {"#agent-zu-verlauf": False, "#agent-zu-details": False, ".agent-side": False, ".agent-main": False, ".agent-panel": True},
            {"#agent-zu-verlauf": False, "#agent-zu-details": True, ".agent-side": True, ".agent-main": True, ".agent-panel": False}]
    if breit != soll:
        erg["fehler"].append(f"1100 px: rechtes Feld des Agenten {breit}")
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
                erg["mls_start"] = mls_start_pruefen(browser, f"http://127.0.0.1:{port}/freedom.html")
            except Exception as e:
                erg["mls_start"] = {"bestanden": False, "fehler": [f"{type(e).__name__}: {str(e)[:200]}"]}
            try:
                erg["rahmen"] = rahmen_pruefen(browser, f"http://127.0.0.1:{port}/freedom.html")
            except Exception as e:
                erg["rahmen"] = {"bestanden": False, "fehler": [f"{type(e).__name__}: {str(e)[:200]}"]}
            try:
                erg["dialog"] = dialog_pruefen(browser, f"http://127.0.0.1:{port}/freedom.html")
            except Exception as e:
                erg["dialog"] = {"bestanden": False, "fehler": [f"{type(e).__name__}: {str(e)[:200]}"]}
            try:
                erg["waehrung"] = waehrung_pruefen(browser, f"http://127.0.0.1:{port}/freedom.html")
            except Exception as e:
                erg["waehrung"] = {"bestanden": False, "fehler": [f"{type(e).__name__}: {str(e)[:200]}"]}
            try:
                erg["kontakt"] = kontakt_pruefen(browser, f"http://127.0.0.1:{port}/freedom.html")
            except Exception as e:
                erg["kontakt"] = {"bestanden": False, "fehler": [f"{type(e).__name__}: {str(e)[:200]}"]}
            try:
                erg["sprachnachricht"] = sprachnachricht_pruefen(browser, f"http://127.0.0.1:{port}/freedom.html")
            except Exception as e:
                erg["sprachnachricht"] = {"bestanden": False, "fehler": [f"{type(e).__name__}: {str(e)[:200]}"]}
            try:
                erg["composer"] = composer_pruefen(browser, f"http://127.0.0.1:{port}/freedom.html")
            except Exception as e:
                erg["composer"] = {"bestanden": False, "fehler": [f"{type(e).__name__}: {str(e)[:200]}"]}
            try:
                erg["anhang_senden"] = anhang_senden_pruefen(browser, f"http://127.0.0.1:{port}/freedom.html")
            except Exception as e:
                erg["anhang_senden"] = {"bestanden": False, "fehler": [f"{type(e).__name__}: {str(e)[:200]}"]}
            try:
                erg["anruf"] = anruf_pruefen(browser, f"http://127.0.0.1:{port}/freedom.html")
            except Exception as e:
                erg["anruf"] = {"bestanden": False, "fehler": [f"{type(e).__name__}: {str(e)[:200]}"]}
            try:
                erg["post_live"] = post_live_pruefen(browser, f"http://127.0.0.1:{port}/freedom.html")
            except Exception as e:
                erg["post_live"] = {"bestanden": False, "fehler": [f"{type(e).__name__}: {str(e)[:200]}"]}
            try:
                erg["privatraum"] = privatraum_pruefen(browser, f"http://127.0.0.1:{port}/freedom.html")
            except Exception as e:
                erg["privatraum"] = {"bestanden": False, "fehler": [f"{type(e).__name__}: {str(e)[:200]}"]}
            try:
                erg["einstellungen"] = einstellungen_pruefen(browser, f"http://127.0.0.1:{port}/freedom.html")
            except Exception as e:
                erg["einstellungen"] = {"bestanden": False, "fehler": [f"{type(e).__name__}: {str(e)[:200]}"]}
            try:
                erg["einnahmen"] = einnahmen_pruefen(browser, f"http://127.0.0.1:{port}/freedom.html")
            except Exception as e:
                erg["einnahmen"] = {"bestanden": False, "fehler": [f"{type(e).__name__}: {str(e)[:200]}"]}
            try:
                erg["fremdtext"] = fremdtext_pruefen(browser, f"http://127.0.0.1:{port}/freedom.html")
            except Exception as e:
                erg["fremdtext"] = {"bestanden": False, "fehler": [f"{type(e).__name__}: {str(e)[:200]}"]}
            try:
                erg["zugang"] = zugang_pruefen(browser, f"http://127.0.0.1:{port}/freedom.html")
            except Exception as e:
                erg["zugang"] = {"bestanden": False, "fehler": [f"{type(e).__name__}: {str(e)[:200]}"]}
            try:
                erg["raum"] = raum_pruefen(browser, f"http://127.0.0.1:{port}/freedom.html")
            except Exception as e:
                erg["raum"] = {"bestanden": False, "fehler": [f"{type(e).__name__}: {str(e)[:200]}"]}
            try:
                erg["karte"] = karte_pruefen(browser, f"http://127.0.0.1:{port}/freedom.html")
            except Exception as e:
                erg["karte"] = {"bestanden": False, "fehler": [f"{type(e).__name__}: {str(e)[:200]}"]}
            try:
                erg["qr"] = qr_pruefen(browser, f"http://127.0.0.1:{port}/freedom.html")
            except Exception as e:
                erg["qr"] = {"bestanden": False, "fehler": [f"{type(e).__name__}: {str(e)[:200]}"]}
            try:
                erg["werben"] = werben_pruefen(browser, f"http://127.0.0.1:{port}/freedom.html")
            except Exception as e:
                erg["werben"] = {"bestanden": False, "fehler": [f"{type(e).__name__}: {str(e)[:200]}"]}
            try:
                erg["unsicher"] = unsicher_pruefen(browser, f"http://127.0.0.1:{port}/freedom.html")
            except Exception as e:
                erg["unsicher"] = {"bestanden": False, "fehler": [f"{type(e).__name__}: {str(e)[:200]}"]}
            try:
                erg["weckworker"] = weckworker_pruefen(browser, f"http://127.0.0.1:{port}/freedom.html")
            except Exception as e:
                erg["weckworker"] = {"bestanden": False, "fehler": [f"{type(e).__name__}: {str(e)[:200]}"]}
            try:
                erg["gratis_auto"] = gratis_auto_pruefen(browser, f"http://127.0.0.1:{port}/freedom.html")
            except Exception as e:
                erg["gratis_auto"] = {"bestanden": False, "fehler": [f"{type(e).__name__}: {str(e)[:200]}"]}
            try:
                erg["lokal"] = lokal_pruefen(browser, f"http://127.0.0.1:{port}/freedom.html")
            except Exception as e:
                erg["lokal"] = {"bestanden": False, "fehler": [f"{type(e).__name__}: {str(e)[:200]}"]}
            try:
                erg["meshtastic"] = meshtastic_pruefen(browser, f"http://127.0.0.1:{port}/freedom.html")
            except Exception as e:
                erg["meshtastic"] = {"bestanden": False, "fehler": [f"{type(e).__name__}: {str(e)[:200]}"]}
            try:
                erg["einrichtung"] = einrichtung_pruefen(browser, f"http://127.0.0.1:{port}/freedom.html")
            except Exception as e:
                erg["einrichtung"] = {"bestanden": False, "fehler": [f"{type(e).__name__}: {str(e)[:200]}"]}
            try:
                erg["mobil"] = mobil_pruefen(browser, f"http://127.0.0.1:{port}/freedom.html")
            except Exception as e:
                erg["mobil"] = {"bestanden": False, "fehler": [f"{type(e).__name__}: {str(e)[:200]}"]}
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
          and erg.get("mls_start", {}).get("bestanden") is True
          and erg.get("rahmen", {}).get("bestanden") is True
          and erg.get("dialog", {}).get("bestanden") is True
          and erg.get("waehrung", {}).get("bestanden") is True
          and erg.get("kontakt", {}).get("bestanden") is True
          and erg.get("sprachnachricht", {}).get("bestanden") is True
          and erg.get("composer", {}).get("bestanden") is True
          and erg.get("anhang_senden", {}).get("bestanden") is True
          and erg.get("anruf", {}).get("bestanden") is True
          and erg.get("post_live", {}).get("bestanden") is True
          and erg.get("privatraum", {}).get("bestanden") is True
          and erg.get("einstellungen", {}).get("bestanden") is True
          and erg.get("einnahmen", {}).get("bestanden") is True
          and erg.get("fremdtext", {}).get("bestanden") is True
          and erg.get("zugang", {}).get("bestanden") is True
          and erg.get("raum", {}).get("bestanden") is True
          and erg.get("karte", {}).get("bestanden") is True
          and erg.get("qr", {}).get("bestanden") is True
          and erg.get("werben", {}).get("bestanden") is True
          and erg.get("unsicher", {}).get("bestanden") is True
          and erg.get("gratis_auto", {}).get("bestanden") is True
          and erg.get("lokal", {}).get("bestanden") is True
          and erg.get("meshtastic", {}).get("bestanden") is True
          and erg.get("einrichtung", {}).get("bestanden") is True
          and erg.get("weckworker", {}).get("bestanden") is True
          and erg.get("mobil", {}).get("bestanden") is True)
    erg["bestanden"] = bool(ok)
    print(json.dumps(erg, indent=1, ensure_ascii=False))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
