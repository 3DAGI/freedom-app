/**
 * Tab Settings: Sicherheitsstand, Nachfolge, Gebühren, Weitergeben und
 * Echtheitsprüfung, Relays. Sicherung, Schlüsselwechsel und Geräte stehen seit
 * C-5c in sicherung.ts, der Mesh-Tab in mesh.ts.
 *
 * Aus app.ts verschoben (Schritt 1.0) – wörtlich, ohne Logikänderung.
 */
import { zahle } from "@freedomstack/protocol";
import { gebietsschema, t } from "../../i18n.js";
import { fliesstext, schluesselAusEingabe } from "../../shell-logic.js";
import { zeigeVertraute } from "../nachfolge-ui.js";
import { alsGeraet, ensurePool, mitRohemSchluessel, nimmInPool, signiere, state, veroeffentlicheWeit } from "../state.js";
import { ladeEigeneRelays, pruefeRelayEingabe, setzeEigeneRelays } from "../../relay-satz.js";
import {
  faelligeVerlaengerungen, kaufeRelayZugang, leseRelayPreise, merkeZugang, pruefeBeimRelay, schieneZumVerlaengern, zuErinnern, zugaenge,
  type RelayPreise, type Schiene,
} from "../../relay-kauf.js";
import { satsText, solText } from "../../preis-anzeige.js";
import { echtheitText, fehlerText, fixierungText, nachfolgeStand, nachfolgeWarnung, weitergabeText } from "../../protokoll-texte.js";
import { geheim, tresorEingerichtet, wireTresorKarte } from "../tresor.js";
import { $, el, toast } from "../ui.js";
import { bestaetige, dialog, hinweis, type Option, type Werte } from "../dialog.js";
import { TRUSTED_SIGNERS, ladeManifestEvents, manifesteAus } from "../../release-signierer.js";
import { INSTALL_FEHLER_TEXT, huellenStand, huellenStandZeilen, ladeOberflaeche, uebergibHuelle } from "../oberflaeche-huelle.js";
import { conversations } from "./kommunikation.js";
import { zeigeGeraete, zeigeSicherung } from "./sicherung.js";

// ------------------------------------------------- Nachfolge & Modelle

/** Als Geraet (8.6c) nicht: Nachfolge, Schluesselwechsel und Vollmachten gehoeren der Hauptidentitaet. */
export function nurHauptidentitaet(was: string): boolean {
  if (!alsGeraet()) return true;
  toast(t("set.nurHaupt", { was }), true);
  return false;
}

/** Stand der Nachfolge anzeigen. */
export async function zeigeNachfolge(): Promise<void> {
  const box = $("#succession-status");
  if (!box || !state.keypair) return;
  // Fuer wen ich selbst Vertrauter bin (8.11b)
  void zeigeVertraute();
  try {
    const { parseSuccessionPlan, evaluateSuccession, KIND_SUCCESSION_PLAN, KIND_HEARTBEAT, KIND_RECOVERY_CLAIM } =
      await import("@freedomstack/protocol");
    const pool = await ensurePool();
    const evs = await pool.query({
      kinds: [KIND_SUCCESSION_PLAN, KIND_HEARTBEAT, KIND_RECOVERY_CLAIM],
      authors: undefined,
      "#p": [state.keypair.pk],
      limit: 200,
    });
    const eigene = await pool.query({
      kinds: [KIND_SUCCESSION_PLAN, KIND_HEARTBEAT],
      authors: [state.keypair.pk],
      limit: 200,
    });
    const planEv = eigene.find((e) => e.kind === KIND_SUCCESSION_PLAN);
    if (!planEv) {
      box.replaceChildren(el("span", t("set.nfNicht"), "muted"));
      return;
    }
    const plan = parseSuccessionPlan(planEv);
    const st = evaluateSuccession(plan, [...evs, ...eigene]);
    const cls = st.status === "aktiv" ? "ok" : st.status === "freigegeben" ? "err" : "warn";
    box.replaceChildren(
      el("span", nachfolgeStand(st, plan), cls), document.createElement("br"),
      el("span", t("set.nfPlan", { schwelle: plan.threshold, von: plan.guardians.length, frist: plan.inactivityDays, warte: plan.graceDays }), "muted"));
  } catch (e) {
    box.textContent = t("agent.nichtAbrufbar", { fehler: fehlerText(e) });
  }
}

/** Nachfolge einrichten — mit Aufklaerung ueber die Grenze. */
export async function richteNachfolgeEin(): Promise<void> {
  if (!state.keypair || !nurHauptidentitaet(t("set.wasNachfolge"))) return;
  const {
    splitSecret, secretHashOf, buildSuccessionPlan, baueAnteilUmschlag, neueTeilung,
  } = await import("@freedomstack/protocol");
  const { decodeNpub } = await import("../../identity.js");

  // Dialog statt prompt()/confirm() (C-1c): Kontakte als Häkchen, weitere Schlüssel als Text; unter drei meldet sich der Dialog
  const ich = state.keypair.pk;
  const kontakte = conversations.filter((c) => c.type === "dm" && /^[0-9a-f]{64}$/.test(c.id) && c.id !== ich);
  const vertraute = (w: Werte): string[] => [...new Set([
    ...(Array.isArray(w.kontakte) ? w.kontakte : []),
    ...String(w.schluessel ?? "").split(/[\s,]+/).map((x) => schluesselAusEingabe(x, decodeNpub)),
  ].filter((x) => /^[0-9a-f]{64}$/.test(x) && x !== ich))];
  const w = await dialog({
    titel: t("set.nachfolgeDialog"),
    text: t("set.vertrauteText"),
    felder: [
      ...(kontakte.length ? [{ art: "mehrfach" as const, name: "kontakte", label: t("set.vertrauteKontakte"), optionen: kontakte.map((c): Option => ({ wert: c.id, text: c.name })) }] : []),
      { art: "textarea", name: "schluessel", label: t(kontakte.length ? "set.weitereSchluessel" : "set.vertrauteSchluessel"), mono: true },
    ],
    pruefe: (w) => (vertraute(w).length >= 3 ? null : t("set.mindestensDrei")),
    ok: t("set.weiter"),
  });
  const guardians = w ? vertraute(w) : [];
  if (guardians.length < 3) return;
  const threshold = Math.max(2, Math.ceil(guardians.length / 2));

  if (!(await bestaetige({ titel: t("set.nachfolgeDialog"), text: fliesstext(nachfolgeWarnung({ guardians: guardians.length, threshold, graceDays: 30 })), ok: t("set.nachfolgeEinrichten") }))) return;

  try {
    // Die Teile entstehen LOKAL; jeder geht versiegelt (NIP-59) an genau
    // seinen Vertrauten (8.11). Bis 8.11 gab es eine Datei mit allen Teilen –
    // wer sie hatte, hatte alles.
    const { teile, hash } = mitRohemSchluessel(t("set.fuerNachfolge"), (sk) => ({
      teile: splitSecret(sk, guardians.length, threshold), hash: secretHashOf(sk),
    }));
    const teilung = neueTeilung();
    const { veroeffentlicheDm } = await import("./posteingang.js");
    try {
      for (const [i, t] of teile.entries()) {
        const wrap = await baueAnteilUmschlag({
          von: state.signer!, an: guardians[i]!, anteil: t, schwelle: threshold, anzahl: guardians.length, secretHash: hash, teilung,
        });
        await veroeffentlicheDm(wrap, guardians[i]!);
      }
    } finally {
      for (const t of teile) t.data.fill(0);
    }
    const pool = await ensurePool();
    await pool.publish(await signiere(buildSuccessionPlan({
      ownerPubkey: state.keypair.pk,
      guardians,
      threshold,
      inactivityDays: 180,
      graceDays: 30,
      secretHash: hash,
    })));

    localStorage.setItem("freedom.successionSet", "1");
    void aktualisiereSicherheitsStand();
    toast(t("set.nfEingerichtet", { n: guardians.length }));
    void zeigeSicherung();
    void zeigeGeraete();
    void zeigeNachfolge();
  } catch (e) {
    toast(fehlerText(e), true);
  }
}

/** Stand der Sicherheit: Punktzahl neben dem Settings-Eintrag, solange etwas fehlt. */
export async function aktualisiereSicherheitsStand(): Promise<void> {
  const badge = document.getElementById("settings-security-badge");
  if (!badge || !state.keypair) return;
  const { backupStatus } = await import("../../identity.js");
  const schritte = [
    backupStatus().confirmed,
    !!localStorage.getItem("freedom.backupAt"),
    localStorage.getItem("freedom.rotationPrepared") === "1",
    localStorage.getItem("freedom.successionSet") === "1",
    tresorEingerichtet(),
  ];
  const erledigt = schritte.filter(Boolean).length;
  badge.textContent = erledigt < schritte.length ? `${erledigt}/${schritte.length}` : "";
  badge.classList.toggle("warn", erledigt < schritte.length);

  // Schrittliste oben in Sicherheit
  schritte.forEach((ok, i) => {
    const el = document.querySelector<HTMLElement>(`[data-sec-step="${i}"]`);
    if (!el) return;
    el.classList.toggle("done", ok);
    const btn = el.querySelector<HTMLElement>(".sec-action");
    if (btn) btn.hidden = ok;
  });
  document.querySelectorAll<HTMLElement>(".sec-progress span").forEach((s, i) => {
    s.classList.toggle("on", i < erledigt);
  });
  wireTresorKarte();
}

/**
 * Die App exportiert sich selbst.
 *
 * Damit wird jede Installation zu einer Bezugsquelle. Faellt die Domain aus —
 * beschlagnahmt, gekuendigt, DNS manipuliert —, kann jeder Nutzer die App
 * weitergeben, und der Empfaenger kann ihre Echtheit gegen das signierte
 * Manifest auf den Relays pruefen. Ein Bezugsweg, der an einem Domainnamen
 * haengt, war der zweite Punkt, an dem das System doch abschaltbar war.
 */
export async function exportiereApp(): Promise<void> {
  const status = $("#selfexport-status");
  try {
    if (status) status.textContent = t("set.leseDatei");
    // Die App holt sich selbst — im Einzeldatei-Build ist das genau die Datei,
    // die der Nutzer weitergeben soll.
    const res = await fetch(location.href, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const { hashText } = await import("@freedomstack/protocol");
    const hash = hashText(html);
    const version = (window as unknown as { FREEDOM_VERSION?: string }).FREEDOM_VERSION ?? "dev";

    const lade = (inhalt: BlobPart, name: string, typ: string): void => {
      const url = URL.createObjectURL(new Blob([inhalt], { type: typ }));
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    };

    lade(html, "freedom.html", "text/html");
    // Die Prueflanleitung wandert mit: Wer weitergibt, soll sie nicht selbst
    // formulieren muessen.
    lade(weitergabeText(hash, version), "freedom-pruefen.txt", "text/plain");

    if (status) {
      status.replaceChildren(t("set.exportiertPruefsumme"), document.createElement("br"), el("span", hash, "mono-sm"),
        document.createElement("br"), t("set.exportiertText"));
      status.className = "mono-sm ok";
    }
    toast(t("set.appExportiert"));
  } catch (e) {
    if (status) {
      status.textContent = t("set.exportFehler", { fehler: fehlerText(e) });
      status.className = "mono-sm warn";
    }
  }
}

/** Fixierte Version (5.2) – kein Geheimnis: nur Version und Pruefsumme. */
const LS_RELEASE_FIX = "freedom.release.fix";

function ladeFixierung(): import("@freedomstack/protocol").Fixierung | null {
  try {
    const f = JSON.parse(localStorage.getItem(LS_RELEASE_FIX) ?? "null") as { version?: unknown; sha256?: unknown } | null;
    return f && typeof f.version === "string" && typeof f.sha256 === "string" && /^[0-9a-f]{64}$/.test(f.sha256)
      ? { version: f.version, sha256: f.sha256 } : null;
  } catch {
    return null;
  }
}

/** Eigene Datei hashen und gegen die Manifeste im Netz pruefen (k von n). */
async function echtheit() {
  const { hashText, verifyArtifact, suchUpdate, allSources, pruefeFixierung } = await import("@freedomstack/protocol");
  // In der Desktop-Hülle nennt sie die Prüfsumme der ausgelieferten Datei (6.1a3c) – dort lässt die CSP
  // kein fetch aufs eigene Schema zu (freedom://, Linux); sonst die eigene Datei lesen wie bisher
  const stand = await huellenStand();
  const hash = stand ? stand.sha256 : hashText(await (await fetch(location.href, { cache: "no-store" })).text());
  const events = await ladeManifestEvents(await ensurePool());
  const manifeste = manifesteAus(events);
  const r = verifyArtifact(hash, "freedom.html", manifeste, TRUSTED_SIGNERS);
  // Neuere Version nur, wenn k Signierer sie bestätigen und sie neuer ist als die laufende (6.1a2);
  // in der Desktop-Hülle kennt sie deren Zeitpunkt (6.1a3c) – 0 heißt unbekannt (Bau ohne FREEDOM_RELEASED_AT)
  const seit = stand && stand.releasedAt > 0 ? { releasedAt: stand.releasedAt } : {};
  const update = suchUpdate(events, TRUSTED_SIGNERS, { sha256: hash, ...seit });
  return {
    hash, r, stand,
    neueste: "angebot" in update ? update.angebot : null,
    quellen: allSources(manifeste, TRUSTED_SIGNERS),
    fixierung: pruefeFixierung(ladeFixierung(), hash, r),
  };
}

/** Prueft die eigene Datei gegen die signierten Manifeste im Netz. */
export async function pruefeEigeneEchtheit(): Promise<void> {
  const box = $("#selfcheck-status");
  if (!box) return;
  try {
    const { hash, r, neueste, quellen, fixierung, stand } = await echtheit();
    const cls = r.status === "echt" ? "ok" : r.status === "abweichend" ? "err" : "warn";

    box.replaceChildren(el("span", echtheitText(r, "freedom.html"), cls));
    if (neueste) box.append(document.createElement("br"), t("set.neuereVersion", { version: neueste.version }));
    // In der Desktop-Hülle (6.1a3c): welche Fassung läuft, und die neuere installieren
    if (stand) for (const zeile of huellenStandZeilen(stand)) box.append(document.createElement("br"), el("span", zeile, "muted"));
    if (stand && neueste) {
      const installieren = el("button", t("set.huelleInstallieren", { version: neueste.version }), "ghost");
      installieren.style.cssText = "width:auto;padding:4px 8px;margin-top:4px";
      installieren.addEventListener("click", () => {
        installieren.disabled = true;
        void installiereNeue(neueste, box).finally(() => { installieren.disabled = false; });
      });
      box.append(document.createElement("br"), installieren);
    }
    if (quellen.length > 0) box.append(document.createElement("br"), el("span", t("set.bezugsquellen", { quellen: quellen.join(", ") }), "muted"));
    // Fixieren (5.2): Danach laeuft keine andere Version ohne Rueckfrage.
    const fix = ladeFixierung();
    const zeile = document.createElement("div");
    if (fixierung.status !== "passt") zeile.textContent = fixierungText(fixierung.status, fix?.version ?? "", r.version);
    else if (fix) zeile.textContent = t("set.fixiert", { version: fix.version });
    box.appendChild(zeile);
    const knopf = (text: string, tun: () => void) => {
      const b = document.createElement("button");
      b.className = "ghost";
      b.style.cssText = "width:auto;padding:4px 8px;margin-top:4px";
      b.textContent = text;
      b.addEventListener("click", () => { tun(); void pruefeEigeneEchtheit(); });
      box.appendChild(b);
    };
    if (r.status === "echt" && r.version && fix?.sha256 !== hash) {
      const version = r.version;
      knopf(t("set.fixieren", { version }), () => localStorage.setItem(LS_RELEASE_FIX, JSON.stringify({ version, sha256: hash })));
    }
    if (fix) knopf(t("set.fixierungAufheben"), () => localStorage.removeItem(LS_RELEASE_FIX));
  } catch (e) {
    box.textContent = t("set.echtheitFehler", { fehler: fehlerText(e) });
    box.className = "mono-sm warn";
  }
}

/**
 * Neue Oberfläche in der Desktop-Hülle (6.1a3c): laden und prüfen, fragen, dann
 * übergeben – die Hülle prüft die Belege selbst noch einmal und legt erst dann ab.
 */
async function installiereNeue(angebot: import("@freedomstack/protocol").UpdateAngebot, box: HTMLElement): Promise<void> {
  const zeile = el("div", t("set.huelleLaedt", { version: angebot.version }), "muted");
  box.appendChild(zeile);
  const daten = await ladeOberflaeche(angebot);
  if (!daten) {
    zeile.textContent = t(INSTALL_FEHLER_TEXT.laden);
    return;
  }
  const mb = (angebot.sizeBytes / (1024 * 1024)).toLocaleString(gebietsschema(), { maximumFractionDigits: 1 });
  const datum = new Date(angebot.releasedAt * 1000).toLocaleDateString(gebietsschema());
  if (!(await bestaetige({ titel: t("set.huelleFrageTitel", { version: angebot.version }), text: t("set.huelleFrageText", { mb, signierer: angebot.belege.length, datum }), ok: t("set.huelleOk") }))) {
    zeile.remove();
    return;
  }
  const r = await uebergibHuelle(angebot, daten);
  if (!r.ok) {
    zeile.textContent = t(INSTALL_FEHLER_TEXT[r.fehler]);
    return;
  }
  await hinweis(t("set.huelleFertigTitel"), t("set.huelleFertigText", { version: angebot.version }));
  location.reload();
}

/**
 * Beim Start (5.2): Ist eine Version fixiert und laeuft eine andere, fragt die
 * App nach – bestaetigte neue Version uebernehmen, sonst deutliche Warnung.
 * Ohne Fixierung passiert nichts.
 */
export async function pruefeFixierungBeimStart(): Promise<void> {
  if (!ladeFixierung()) return;
  try {
    const { hash, r, fixierung } = await echtheit();
    const fixVersion = ladeFixierung()?.version ?? "";
    if (fixierung.status === "andere-echt" && r.version && await bestaetige({ titel: t("set.neueVersionTitel"), text: fixierungText(fixierung.status, fixVersion, r.version), ok: t("set.uebernehmen") })) {
      localStorage.setItem(LS_RELEASE_FIX, JSON.stringify({ version: r.version, sha256: hash }));
      toast(t("set.versionFixiert", { version: r.version }));
    } else if (fixierung.status !== "passt") {
      toast(fixierungText(fixierung.status, fixVersion, r.version), true);
    }
  } catch { /* ohne Netz oder als lokale Datei nicht pruefbar – beim naechsten Start erneut */ }
}

/**
 * Gebühren (A+, 5.1.3; seit C-8 unter Währung › Zahlen): was die App an
 * Anteilen gesammelt hat – gezahlt ab
 * 100 sats je Empfänger. Zahlungen mit unklarem Ausgang klärt der Nutzer hier;
 * von selbst zahlt die App sie nie ein zweites Mal.
 */
export async function wireGebuehrenKarte(): Promise<void> {
  const box = document.getElementById("anteile-stand");
  const knopf = document.getElementById("anteile-zahlen") as HTMLButtonElement | null;
  if (!box || !knopf) return;
  const { kasse, pruefBudget, zahleAnteile } = await import("../ki-zahlung.js");
  const sat = (msat: number) => `${(msat / 1000).toLocaleString(gebietsschema(), { maximumFractionDigits: 3 })} sats`;
  const zeige = (): void => {
    box.replaceChildren();
    const zeile = (text: string): HTMLElement => {
      const d = document.createElement("div");
      d.textContent = text;
      box.append(d);
      return d;
    };
    if (tresorEingerichtet() && geheim.keys().length === 0) { zeile(t("set.tresorGesperrt")); return; }
    const { offen, unklar } = kasse.stand();
    if (offen.length === 0 && unklar.length === 0) zeile(t("set.nichtsGesammelt"));
    // Prüfbudget (P5b): bleibt beim Kunden, bezahlt seine Prüfrunden
    const budget = pruefBudget.stand();
    if (budget > 0) zeile(t("set.pruefbudget", { betrag: sat(budget) }));
    for (const o of offen) zeile(t("set.gesammelt", { ziel: o.ziel, betrag: sat(o.msat) }));
    for (const u of unklar) {
      const d = zeile(t("set.ausgangUnklar", { ziel: u.ziel, betrag: sat(u.msat) }));
      for (const [schluessel, gezahlt] of [["set.kamAn", true], ["set.kamNichtAn", false]] as const) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "ghost";
        b.style.cssText = "width:auto;padding:2px 8px;margin-left:4px";
        b.textContent = t(schluessel);
        b.onclick = () => void kasse.klaere(u.rechnung, gezahlt).then(zeige, (e: Error) => toast(e.message, true));
        d.append(b);
      }
    }
  };
  zeige();
  knopf.onclick = async () => {
    knopf.disabled = true;
    try {
      const r = await zahleAnteile();
      toast(r.gezahltMsat > 0 ? t("set.anteileGezahlt", { betrag: sat(r.gezahltMsat) }) : t("set.nichtsFaellig"));
    } catch (e) {
      toast(fehlerText(e), true);
    } finally {
      knopf.disabled = false;
      zeige();
    }
  };
}

/**
 * Relay-Zugang kaufen (8.4c): Preis aus NIP-11, Angebot geprüft, bezahlt über
 * die Zahlschienen, bestätigt vom Relay. Bleibt die Bestätigung aus, ist das
 * Angebot gemerkt – „Zahlung erneut prüfen“. Als Gerät nicht: der Posteingang
 * gehört der Person.
 */
export function wireRelayZugang(): void {
  const $e = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
  const feld = $e<HTMLInputElement>("relay-zugang-url");
  const [preisK, satsK, solK, pruefK, verlK] = ["relay-zugang-preis", "relay-zugang-sats", "relay-zugang-sol", "relay-zugang-pruefen", "relay-zugang-verlaengern"]
    .map((id) => $e<HTMLButtonElement>(id));
  const status = $e("relay-zugang-status");
  if (!feld || !preisK || !satsK || !solK || !pruefK || !verlK || !status) return;
  if (alsGeraet()) {
    preisK.disabled = true;
    status.textContent = t("set.geraetKauftNicht");
    return;
  }
  feld.value = ladeEigeneRelays(localStorage)[0] ?? "";
  let preise: RelayPreise | null = null;
  const relay = () => feld.value.trim();
  const datum = (bis: number) => new Date(bis * 1000).toLocaleDateString(gebietsschema());
  /** Bald ablaufend (E11 B): Hinweis und „Verlängern“ – gezahlt wird erst nach Klick und Rückfrage. */
  const faellig = () => faelligeVerlaengerungen(zugaenge(localStorage), Math.floor(Date.now() / 1000)).find((f) => f.relay === relay());
  const zeigeStand = (mitText = true) => {
    const z = zugaenge(localStorage)[relay()];
    const f = faellig();
    pruefK.classList.toggle("hidden", !z?.offen);
    verlK.classList.toggle("hidden", !f);
    if (mitText && f) status.textContent = t(f.bis * 1000 > Date.now() ? "set.laeuftAb" : "set.abgelaufen", { relay: f.relay, datum: datum(f.bis) });
    else if (mitText && z?.bis) status.textContent = t("set.zugangBis", { datum: datum(z.bis) });
  };
  feld.oninput = () => { preise = null; satsK.classList.add("hidden"); solK.classList.add("hidden"); status.textContent = ""; zeigeStand(); };
  preisK.onclick = async () => {
    status.textContent = t("set.frageRelay");
    try {
      preise = await leseRelayPreise(relay());
    } catch {
      preise = null;
    }
    satsK.classList.toggle("hidden", !preise?.msat);
    solK.classList.toggle("hidden", !preise?.lamports);
    status.textContent = !preise
      ? t("set.keinVerkauf")
      : t("set.preisZeile", { tage: preise.tage, preis: [preise.msat ? satsText(preise.msat) : "", preise.lamports ? solText(preise.lamports) : ""].filter(Boolean).join(t("set.oder")) }) +
        (preise.beschraenkt ? t("set.nurZahlende") : "") + (preise.umschlaegeGeschuetzt ? t("set.nurAngemeldete") : "");
    zeigeStand(false);
  };
  const kaufe = async (schiene: Schiene) => {
    if (!preise || !state.keypair) return;
    const url = relay();
    const hinweis = t(schiene === "solana" ? "set.hinweisSol" : "set.hinweisSats");
    if (!(await bestaetige({ titel: t("set.zugangTitel"), text: t("set.kaufFrage", { url, tage: preise.tage, hinweis }), ok: t("set.kaufen") }))) return;
    satsK.disabled = solK.disabled = true;
    status.textContent = t("set.holeUndZahle");
    try {
      const { zahlschienen } = await import("../zahlschienen.js");
      const r = await kaufeRelayZugang({
        relay: url, schiene, pubkey: state.keypair.pk, preise,
        zahle: (a) => zahle(zahlschienen(), a),
        merke: (z) => merkeZugang(localStorage, url, z),
      });
      status.textContent = r ? t("set.bezahltBis", { datum: new Date(r.bis * 1000).toLocaleDateString(gebietsschema()) }) : t("set.bezahltOffen");
    } catch (e) {
      status.textContent = t("set.nichtGekauft", { fehler: fehlerText(e) });
    } finally {
      satsK.disabled = solK.disabled = false;
      zeigeStand(false);
    }
  };
  satsK.onclick = () => void kaufe("lightning");
  solK.onclick = () => void kaufe("solana");
  verlK.onclick = async () => {
    const f = faellig();
    if (!f) return;
    status.textContent = t("set.frageRelay");
    try {
      preise = await leseRelayPreise(f.relay);
    } catch {
      preise = null;
    }
    const schiene = preise ? schieneZumVerlaengern(f, preise) : null;
    if (!schiene) { status.textContent = t("set.keinVerkauf"); return; }
    await kaufe(schiene);
  };
  pruefK.onclick = async () => {
    const offen = zugaenge(localStorage)[relay()]?.offen;
    if (!offen) return;
    status.textContent = t("set.frageRelay");
    try {
      const r = await pruefeBeimRelay(offen, { versuche: 1 });
      if (r) merkeZugang(localStorage, relay(), { bis: r.bis });
      status.textContent = r ? "" : t("set.nochNichtBestaetigt");
    } catch (e) {
      status.textContent = t("set.nichtGeprueft", { fehler: fehlerText(e) });
    }
    zeigeStand();
  };
  // Erinnerung beim Start (E11 B): einmal am Tag, nur aus dem Gemerkten – kein Netz
  const erinnern = zuErinnern(localStorage, Math.floor(Date.now() / 1000));
  if (erinnern.length > 0) {
    feld.value = erinnern[0].relay;
    toast(t("set.erinnerung"));
  }
  zeigeStand();
}

/**
 * Eigener Relay-Satz (5.4b2): sichtbar und änderbar. Veröffentlicht NIP-65-Liste
 * und Posteingang neu (weit), erst dann gilt er; neue Relays kommen gleich in
 * den Pool. Als Gerät nur sichtbar – der Satz gehört der Person (8.6c).
 */
export function wireRelayKarte(): void {
  const feld = document.getElementById("eigene-relays") as HTMLTextAreaElement | null;
  const knopf = document.getElementById("eigene-relays-save") as HTMLButtonElement | null;
  const status = document.getElementById("eigene-relays-status");
  if (!feld || !knopf || !status) return;
  feld.value = ladeEigeneRelays(localStorage).join("\n");
  if (alsGeraet()) {
    feld.readOnly = true;
    knopf.disabled = true;
    status.textContent = t("set.geraetSatz");
    return;
  }
  if (!feld.value) status.textContent = t("set.keinSatz");
  knopf.onclick = async () => {
    const r = pruefeRelayEingabe(feld.value);
    if ("fehler" in r) { status.textContent = r.fehler; return; }
    if (!state.keypair) { status.textContent = t("set.keineIdentitaet"); return; }
    knopf.disabled = true;
    status.textContent = t("set.veroeffentliche");
    try {
      const ok = await setzeEigeneRelays({ relays: r.relays, pk: state.keypair.pk, signiere, weit: veroeffentlicheWeit, speicher: localStorage });
      if (ok) {
        await nimmInPool(r.relays);
        feld.value = r.relays.join("\n");
        status.textContent = t("set.veroeffentlicht", { n: r.relays.length });
      } else {
        status.textContent = t("set.nichtVeroeffentlichtKeiner");
      }
    } catch (e) {
      status.textContent = t("set.nichtVeroeffentlicht", { fehler: fehlerText(e) });
    } finally {
      knopf.disabled = false;
    }
  };
}
