/**
 * Tab Earn: Einnahmen, Vertrauensstufe, Mitwirkende, Abdeckungskarte und
 * Werben. Rangliste, Belohnungsantrag und Werbe-Stufen fielen mit 5.1.4b
 * (Gebührenmodell A+: kein Pool, keine Belohnung aus Selbstauskunft).
 *
 * Aus app.ts verschoben (Schritt 1.0) – wörtlich, ohne Logikänderung.
 */
import { KIND_PERFORMANCE, type NostrEvent, loeseNip05, parseProfileSafe } from "@freedomstack/protocol";
import { t } from "../../i18n.js";
import { abdeckungEinwilligung, abdeckungHier, ebeneName, fehlerText, zellenStufe } from "../../protokoll-texte.js";
import { pkShort } from "../../shell-logic.js";
import { einnahmeText } from "../../preis-anzeige.js";
import { aktualisiereKurs, aktuellerKurs } from "../marktkurs.js";
import { ensurePool, frageBeiAutoren, signiere, solRpcUrl, state } from "../state.js";
import { geheim } from "../tresor.js";
import { $, el, timeAgo, toast } from "../ui.js";
import { loeseWerberName, merkeWerber, werbeLink, werbeRef, werbeSolAdresse } from "../../werbung.js";
import { eigeneBasis } from "../../eigene-adresse.js";
import { knotenSchluessel } from "../verdienst-ui.js";
import { mitwirkendeListe } from "../mitwirkende.js";
import { gebietText, zeigeKarte } from "./karte.js";
import { leseStandort, rundeStandort } from "../../karte-ansicht.js";
import { bestaetige, dialog } from "../dialog.js";
import { qrKnopf } from "../qr-ui.js";

/** Mitwirkende am Projekt anzeigen. */
export async function zeigeMitwirkende(): Promise<void> {
  const box = $("#contrib-list");
  if (!box) return;
  try {
    const { KIND_GIT_CONTRIBUTION } = await import("@freedomstack/protocol");
    const pool = await ensurePool();
    const evs = await pool.query({ kinds: [KIND_GIT_CONTRIBUTION], limit: 1000 });
    const repo = (window as unknown as { FREEDOM_REPO_ID?: string }).FREEDOM_REPO_ID ?? "freedomstack";
    // Seit C.3a2 als DOM (`mitwirkende.ts`), dieselbe Liste wie im Reiter der Repo-Seite
    box.replaceChildren(...mitwirkendeListe(repo, evs, pkShort));
  } catch (e) {
    box.textContent = t("agent.nichtAbrufbar", { fehler: fehlerText(e) });
  }
}

/** Eigener Ort (C.4b, E6): nur die Südwest-Ecke der 0,5°-Zelle, nie der genaue Ort. */
const LS_STANDORT = "freedom.coverage.cell";

/** Gemerkten Ort lesen – ein genauer Wert von vor C.4b wird dabei gerundet überschrieben. */
function eigenerStandort(): [number, number] | null {
  const roh = localStorage.getItem(LS_STANDORT);
  const ort = leseStandort(roh);
  if (!ort) {
    if (roh !== null) localStorage.removeItem(LS_STANDORT);
    return null;
  }
  if (roh !== JSON.stringify(ort)) localStorage.setItem(LS_STANDORT, JSON.stringify(ort));
  return ort;
}

/** Ort vom Browser – gerundet, bevor er gespeichert oder verwendet wird. */
function holeStandort(): Promise<[number, number] | null> {
  return new Promise((fertig) => navigator.geolocation.getCurrentPosition((pos) => {
    const ort = rundeStandort(pos.coords.latitude, pos.coords.longitude);
    if (ort) localStorage.setItem(LS_STANDORT, JSON.stringify(ort));
    fertig(ort);
  }, () => fertig(null)));
}

/** „Mein Gebiet zeigen“: nur lokal, für die Antwort und die umrandete Zelle. */
export async function nutzeStandort(): Promise<void> {
  if (!(await holeStandort())) return toast(t("earn.standortFehlt"), true);
  toast(t("karte.standortGemerkt"));
  void ladeAbdeckung();
}

/** „Gebiet vergessen“. */
export function vergissStandort(): void {
  localStorage.removeItem(LS_STANDORT);
  toast(t("karte.standortVergessenOk"));
  void ladeAbdeckung();
}

/** Abdeckung anzeigen. */
export async function ladeAbdeckung(): Promise<void> {
  const liste = $("#coverage-list");
  const hier = $("#coverage-here");
  // Ohne gemerkten Standort hängt der Hinweis nicht an den Relays – gleich setzen (auch nach einem Sprachwechsel)
  if (hier && !localStorage.getItem("freedom.coverage.cell")) hier.textContent = t("earn.standortGebraucht");
  try {
    const { buildCoverage, coverageAt, KIND_COVERAGE } = await import("@freedomstack/protocol");
    const pool = await ensurePool();
    const evs = await pool.query({ kinds: [KIND_COVERAGE], limit: 2000 });
    const r = buildCoverage(evs);
    const standort = eigenerStandort();
    zeigeKarte(r.cells, r.hiddenCells, standort);
    $("#coverage-vergessen")?.classList.toggle("hidden", !standort);

    if (liste) {
      const { summarizeLayers } = await import("@freedomstack/protocol");
      const zusammen = summarizeLayers(r.cells, r.hiddenCells);
      const symbol: Record<string, string> = { online: "🌐", lora: "📡", bluetooth: "🔵" };

      // Seit C.4a als DOM, alle Gebiete, ohne Namen mit ihrer Mitte (B12) – wie die Karte
      const div = (text: string, klasse: string) => {
        const d = document.createElement("div");
        d.className = klasse;
        d.textContent = text;
        return d;
      };
      // Kopfzeile je Ebene: Was gibt es ueberhaupt, bevor es um Orte geht.
      const kopf = zusammen.map((z) => {
        const zeile = div("", "usage-row");
        const name = document.createElement("span");
        name.textContent = `${symbol[z.layer] ?? "•"} ${ebeneName(z.layer)}`;
        const zahl = document.createElement("span");
        zahl.className = z.cells > 0 ? "ok" : "muted"; // kein UI-Text
        zahl.textContent = t("earn.gebiete", { n: z.cells });
        zeile.append(name, zahl);
        return zeile;
      });
      const orte = r.cells.length === 0
        ? [div(t("earn.keineEintraege"), "muted abdeckung-orte")]
        : r.cells.map((c) => div(`${symbol[c.layer] ?? "•"} ${gebietText(c)} · ${zellenStufe(c.nodes)}`, "abdeckung-ort"));
      const verborgen = r.hiddenCells > 0 ? [div(t("earn.verborgen", { n: r.hiddenCells }), "muted abdeckung-orte")] : [];
      liste.replaceChildren(...kopf, ...orte, ...verborgen);
    }

    // Standort nur auf ausdruecklichen Wunsch — nicht beim Oeffnen des Tabs.
    if (hier) hier.textContent = standort ? abdeckungHier(coverageAt(...standort, r.cells)) : t("earn.standortGebraucht");
  } catch (e) {
    if (liste) liste.textContent = t("earn.abdeckungFehler", { fehler: fehlerText(e) });
  }
}

/** Sich selbst eintragen — mit Aufklaerung vorher. */
export async function trageAbdeckungEin(): Promise<void> {
  if (!state.keypair) return;
  const { toCell, baueCoverageEintrag, toHex } =
    await import("@freedomstack/protocol");

  // Seit C.4b Dialoge statt prompt()/confirm(): erst die Ebene, dann die Einwilligung
  const w = await dialog({
    titel: t("earn.wasEintragen"), ok: t("karte.eintragenOk"),
    felder: [{ art: "wahl", name: "ebene", label: t("karte.ebene"), pflicht: true, wert: "lora",
      optionen: (["lora", "bluetooth"] as const).map((e) => ({ wert: e, text: ebeneName(e) })) }],
  });
  const layer = w?.ebene === "bluetooth" ? "bluetooth" : w?.ebene === "lora" ? "lora" : null;
  if (!layer) return;
  if (!(await bestaetige({ titel: t("karte.einwilligungTitel"), text: abdeckungEinwilligung(layer), ok: t("karte.eintragenOk") }))) return;

  // Runden passiert LOKAL, und die Zellgroesse haengt an der Ebene:
  // Bluetooth reicht nur Meter, also wird GROEBER gerundet, nicht feiner.
  // Die genauen Koordinaten verlassen das Geraet nie – seit C.4b werden sie
  // schon vor dem Speichern auf 0,5° gerundet (Vielfaches jeder Zellgroesse).
  const ort = await holeStandort();
  if (!ort) return toast(t("earn.standortFehlt"), true);
  try {
    const { LAYER_CELL_DEGREES } = await import("@freedomstack/protocol");
    const cell = toCell(ort[0], ort[1], LAYER_CELL_DEGREES[layer]);
    // Seit 5.10 mit einem Wegwerfschluessel je Eintrag, nicht mit der Identitaet;
    // ein frueherer Eintrag wird zuerst widerrufen. Den Schluessel braucht nur
    // der Widerruf – er liegt nur im Tresor.
    await widerrufeAbdeckung(false);
    const { event, wegwerfSk } = baueCoverageEintrag({ layer, cell, region: "" });
    await (await ensurePool()).publish(event);
    await geheim.setItem(LS_ABDECKUNG_EINTRAG, JSON.stringify({ id: event.id, sk: toHex(wegwerfSk) }));
    wegwerfSk.fill(0);
    toast(t("earn.eingetragen"));
    void ladeAbdeckung();
  } catch (e) {
    toast(fehlerText(e), true);
  }
}

/** Eigener Abdeckungs-Eintrag (5.10): ID und Wegwerfschluessel – nur im Tresor. */
export const LS_ABDECKUNG_EINTRAG = "freedom.coverage.eintrag";

/** Den eigenen Eintrag widerrufen (NIP-09, vom Wegwerfschluessel) und den Schluessel vergessen. */
export async function widerrufeAbdeckung(melden = true): Promise<void> {
  let e: { id?: unknown; sk?: unknown } | null = null;
  try {
    e = JSON.parse(geheim.getItem(LS_ABDECKUNG_EINTRAG) ?? "null") as { id?: unknown; sk?: unknown } | null;
  } catch { /* kaputt: nur vergessen */ }
  if (e && typeof e.id === "string" && typeof e.sk === "string" && /^[0-9a-f]{64}$/.test(e.sk)) {
    const { baueCoverageWiderruf, fromHex } = await import("@freedomstack/protocol");
    const sk = fromHex(e.sk);
    await (await ensurePool()).publish(baueCoverageWiderruf(e.id, sk)).catch(() => undefined);
    sk.fill(0);
  } else if (melden) {
    toast(t("earn.keinEintrag"));
    return;
  }
  await geheim.removeItem(LS_ABDECKUNG_EINTRAG);
  if (melden) {
    toast(t("earn.widerrufen"));
    void ladeAbdeckung();
  }
}

/** Trust-Level (XP) des eigenen providers — wie ein spiel-level. */
export async function loadTrust(): Promise<void> {
  if (!state.keypair) return;
  try {
    const pool = await ensurePool();
    const perf = await pool.query({ kinds: [KIND_PERFORMANCE], authors: [state.keypair.pk], limit: 1000 });
    const jobs = perf.length;
    // trust = jobs * 2 (einfach; das protokoll hat eine komplexere formel)
    const xp = jobs * 2;
    const tier = xp >= 50 ? "pro" : xp >= 10 ? "classic" : "free";
    const next = xp >= 50 ? 100 : xp >= 10 ? 50 : 10;
    const pct = Math.min(100, Math.round((xp / next) * 100));
    const fill = document.getElementById("trust-fill");
    if (fill) fill.style.width = `${Math.max(pct, 2)}%`; // min 2% damit Track sichtbar
    const xpEl = document.getElementById("trust-xp");
    if (xpEl) xpEl.textContent = `${xp} XP`;
    const jobsEl = document.getElementById("trust-jobs");
    if (jobsEl) jobsEl.textContent = t("profil.jobs", { n: jobs });
    const tierEl = document.getElementById("trust-tier");
    if (tierEl) tierEl.textContent = tier;
    // Tier-Marker positionieren (10 XP / 50 XP Schwellen relativ zum nächsten Ziel)
    const bar = document.getElementById("trust-bar-track");
    if (bar) {
      const m10 = bar.querySelector<HTMLElement>(".trust-marker.m10");
      const m50 = bar.querySelector<HTMLElement>(".trust-marker.m50");
      // Marker stehen im HTML statisch (10/50 XP); hier nur Aktiv-Status:
      m10?.classList.toggle("reached", xp >= 10);
      m50?.classList.toggle("reached", xp >= 50);
    }
  } catch { /* offline */ }
}

// ------------------------------------------------------------- Verdienen-Tab

export async function loadEarnings(): Promise<void> {
  if (!state.keypair) return;
  const box = $("#earn-events");
  box.replaceChildren(el("div", t("earn.lade"), "mono-sm"));
  try {
    const pool = await ensurePool();
    // Der eigene Knoten (4.5b): gemerkter Schlüssel, sonst die eigene Identität
    const events = await pool.query({
      kinds: [KIND_PERFORMANCE],
      authors: [knotenSchluessel() ?? state.keypair.pk],
      limit: 20,
    });
    const sorted = events.sort((a, b) => b.created_at - a.created_at);
    const kette = (ev: NostrEvent) => ev.tags.find((x) => x[0] === "chain")?.[1];
    // SOL-Einnahmen in SOL (C-2) – den Kurs nur holen, wenn es welche gibt
    const kurs = sorted.some((ev) => kette(ev) === "solana") ? (aktuellerKurs() ?? await aktualisiereKurs().catch(() => undefined)) : undefined;
    // Zeilen nur als Text (C-6) – die Tags kommen vom Relay
    box.replaceChildren(...(sorted.length
      ? sorted.map((ev) => {
          const get = (n: string) => ev.tags.find((t) => t[0] === n)?.[1] ?? "—";
          const zeile = el("div", undefined, "stat");
          zeile.append(
            el("span", `${get("work_type")} · ${t("earn.einheiten", { n: get("units") })}`, "k"),
            el("span", `${einnahmeText(get("volume_msat"), kette(ev), kurs)} · ${timeAgo(ev.created_at)}`),
          );
          return zeile;
        })
      : [el("div", t("earn.keineEinnahmen"), "mono-sm")]));
  } catch (e) {
    box.replaceChildren(el("div", fehlerText(e), "mono-sm err"));
  }
}

/** Referral: link mit eigener pubkey generieren + copy. */
export function setupReferral(): void {
  const link = $("#referral-link") as HTMLInputElement | null;
  const copyBtn = $("#referral-copy");
  if (!link || !copyBtn) return;
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(link.value);
      toast(t("earn.linkKopiert"));
    } catch {
      link.select();
      document.execCommand("copy");
      toast(t("earn.linkKopiert"));
    }
  });
}

/**
 * Referral-URL mit der AKTUELLEN identity füllen. Muss NACH dem Identity-Laden
 * laufen (sonst ?ref= leer) und bei jedem Earn-Tab-Öffnen erneut — der pubkey
 * kann sich ändern (import).
 */
export function updateReferralLink(sol?: string): void {
  const link = $("#referral-link") as HTMLInputElement | null;
  const stats = $("#referral-stats");
  if (!link || !state.keypair) return;
  const pub = state.keypair.pk;
  // SOL-Adresse (12.2): die gemerkte sofort, eine frische erst nach dem Laden der Kette
  if (sol === undefined) void ergaenzeWerbeSol(pub);
  // Origin-basiert (funktioniert auf jeder Domain — nicht nur localhost); mit
  // der Lightning-Adresse aus dem Profil, damit der Anteil ankommt (5.1.3b)
  let lud16: string | undefined;
  try { lud16 = (JSON.parse(localStorage.getItem("freedom.profile") ?? "{}") as { lud16?: string }).lud16; } catch { /* kein Profil */ }
  // Eigene Adresse der App, falls gesetzt (11.2a) – sonst die, unter der sie läuft
  const basis = eigeneBasis(localStorage) ?? window.location.origin + window.location.pathname;
  // Mit dem geprüften kurzen Namen statt des Schlüssels, falls gesetzt (11.2b)
  link.value = werbeLink(basis, werbeRef(localStorage, pub, basis), lud16, sol);
  // Als QR-Code zum Zeigen oder Ausdrucken (11.1b) – nichts Geheimes darin
  $("#referral-qr")?.replaceChildren(qrKnopf(link.value, { beschriftung: t("earn.werbelinkQr") }));
  if (stats) {
    const q = new URL(link.value).searchParams;
    const schluessel = q.has("ln") && q.has("sol") ? "earn.codeMitBeiden" : q.has("ln") ? "earn.codeMitAdresse" : q.has("sol") ? "earn.codeMitSol" : "earn.codeOhneAdresse";
    stats.textContent = t(schluessel, { code: pkShort(pub) });
  }
  void zeigeNennungen();
}

/**
 * Eigene SOL-Adresse für den Werbelink (12.2, E1 A): je Kette eine frische aus
 * der eingebauten Wallet, danach dieselbe – nie die Hauptadresse, nie eine
 * fremde Wallet. Ohne eingebaute Wallet bleibt der Link ohne `sol=`.
 */
async function ergaenzeWerbeSol(pub: string): Promise<void> {
  try {
    const [{ frischeEmpfangsadresse }, { ketteAusRpc }] = await Promise.all([import("../eingebaute-wallet.js"), import("../../wallet-standard.js")]);
    const sol = await werbeSolAdresse(geheim, ketteAusRpc(await solRpcUrl()), frischeEmpfangsadresse);
    if (sol && state.keypair?.pk === pub) updateReferralLink(sol);
  } catch { /* ohne SOL-Adresse */ }
}

/**
 * Wie viele Geworbene dich öffentlich nennen (5.1.4b) – nur eine Zahl, keine
 * Stufen: Geld gibt es nicht für Nennungen, sondern 0,5 % ihrer KI-Zahlungen.
 * Je Geworbenem zählt die früheste Nennung, deshalb auch seine übrigen holen.
 */
async function zeigeNennungen(): Promise<void> {
  const box = $("#referral-tier");
  if (!box || !state.keypair) return;
  const ich = state.keypair.pk;
  try {
    const { KIND_REFERRAL_CLAIM, zaehleNennungen } = await import("@freedomstack/protocol");
    const pool = await ensurePool();
    const anMich = await pool.query({ kinds: [KIND_REFERRAL_CLAIM], "#p": [ich], limit: 500 });
    const autoren = [...new Set(anMich.map((ev) => ev.pubkey))];
    const alle = autoren.length > 0 ? await pool.query({ kinds: [KIND_REFERRAL_CLAIM], authors: autoren, limit: 1000 }) : [];
    const n = zaehleNennungen([...anMich, ...alle], ich);
    box.textContent = n === 0 ? t("earn.keineNennung") : t("earn.nennungen", { n });
  } catch {
    // Ohne Netz keine erfundene Zahl anzeigen.
    box.textContent = t("earn.spaeterGezaehlt");
  }
}

/**
 * Werber aus dem Link lesen (?ref=pubkey&ln=lud16) und merken – nie
 * ueberschreiben, damit ein spaeter geoeffneter fremder Link den
 * urspruenglichen Werber nicht still verdraengt (werbung.ts).
 */
export function captureReferral(): void {
  merkeWerber(window.location.search, localStorage, window.location.hostname);
  void loeseWerberNameJetzt();
}

/**
 * Ein Name statt Schlüssel im Werbelink (11.2b): einmal bei der Domain
 * nachfragen (sie sieht dabei die IP – Datenschutzbericht „werbe-name“); die
 * Lightning-Adresse, wenn der Link keine trägt, aus dem signierten Profil.
 */
async function loeseWerberNameJetzt(): Promise<void> {
  const ausgang = await loeseWerberName(localStorage, (k) => loeseNip05(k), async (pk) => {
    const profile = await frageBeiAutoren({ kinds: [0], authors: [pk], limit: 5 });
    const neuestes = profile.filter((ev) => ev.pubkey === pk).sort((a, b) => b.created_at - a.created_at)[0];
    return neuestes ? parseProfileSafe(neuestes).lud16 : undefined;
  });
  if (ausgang === "gemerkt") void publishReferralClaim();
  else if (ausgang !== "kein" && ausgang !== "schon-werber") console.warn(`[referral] Name im Werbelink nicht aufgelöst: ${ausgang}`);
}

/**
 * Werbebeziehung EINMAL im Netz veroeffentlichen.
 *
 * Vorher lag der Werber nur in localStorage und war fuer das Netz unsichtbar —
 * die Stufen zeigten deshalb immer "Starter", und eine Auszahlung waere nur
 * auf Zuruf moeglich gewesen. Der Claim wird vom GEWORBENEN signiert: nur so
 * kann niemand fremde Pubkeys als eigene Geworbene eintragen.
 */
export async function publishReferralClaim(): Promise<void> {
  if (!state.keypair) return;
  if (localStorage.getItem("freedom.referrer.published") === "1") return;
  const referrer = localStorage.getItem("freedom.referrer");
  if (!referrer || referrer === state.keypair.pk) return;
  // Nur mit Zustimmung (8.1b): Die Beziehung ist oeffentlich – bis dahin ging sie ungefragt raus.
  const { darfWerberNennen } = await import("../../einrichtung.js");
  if (!darfWerberNennen(localStorage)) return;

  try {
    const { buildReferralClaim } = await import("@freedomstack/protocol");
    const pool = await ensurePool();
    await pool.publish(await signiere(buildReferralClaim(state.keypair.pk, referrer)));
    localStorage.setItem("freedom.referrer.published", "1");
  } catch (e) {
    // Kein Abbruch: Der Claim wird beim naechsten Start erneut versucht.
    console.warn(`[referral] Claim noch nicht veroeffentlicht: ${fehlerText(e)}`);
  }
}
