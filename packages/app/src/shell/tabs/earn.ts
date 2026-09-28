/**
 * Tab Earn: Einnahmen, Vertrauensstufe, Mitwirkende, Abdeckungskarte und
 * Werben. Rangliste, Belohnungsantrag und Werbe-Stufen fielen mit 5.1.4b
 * (Gebührenmodell A+: kein Pool, keine Belohnung aus Selbstauskunft).
 *
 * Aus app.ts verschoben (Schritt 1.0) – wörtlich, ohne Logikänderung.
 */
import { KIND_PERFORMANCE } from "@freedomstack/protocol";
import { t } from "../../i18n.js";
import { abdeckungEinwilligung, abdeckungHier, ebeneName, fehlerText, zellenStufe } from "../../protokoll-texte.js";
import { escapeHtml, pkShort } from "../../shell-logic.js";
import { ensurePool, signiere, state } from "../state.js";
import { geheim } from "../tresor.js";
import { $, timeAgo, toast } from "../ui.js";
import { merkeWerber, werbeLink } from "../../werbung.js";
import { knotenSchluessel } from "../verdienst-ui.js";
import { mitwirkendeListe } from "../mitwirkende.js";
import { gebietText, zeigeKarte } from "./karte.js";
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
    zeigeKarte(r.cells, r.hiddenCells);

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
    if (hier) {
      const gemerkt = localStorage.getItem("freedom.coverage.cell");
      hier.textContent = gemerkt
        ? abdeckungHier(coverageAt(...(JSON.parse(gemerkt) as [number, number]), r.cells))
        : t("earn.standortGebraucht");
    }
  } catch (e) {
    if (liste) liste.textContent = t("earn.abdeckungFehler", { fehler: fehlerText(e) });
  }
}

/** Sich selbst eintragen — mit Aufklaerung vorher. */
export async function trageAbdeckungEin(): Promise<void> {
  if (!state.keypair) return;
  const { toCell, baueCoverageEintrag, toHex } =
    await import("@freedomstack/protocol");

  const art = prompt(t("earn.wasEintragen"), t("earn.funk"));
  if (!art) return;
  const layer = art.trim().toLowerCase().startsWith("b") ? "bluetooth" : "lora";
  if (!confirm(abdeckungEinwilligung(layer))) return;

  navigator.geolocation.getCurrentPosition(async (pos) => {
    try {
      // Runden passiert LOKAL, und die Zellgroesse haengt an der Ebene:
      // Bluetooth reicht nur Meter, also wird GROEBER gerundet, nicht feiner.
      // Die genauen Koordinaten verlassen das Geraet nie.
      const { LAYER_CELL_DEGREES } = await import("@freedomstack/protocol");
      const cell = toCell(pos.coords.latitude, pos.coords.longitude, LAYER_CELL_DEGREES[layer]);
      localStorage.setItem("freedom.coverage.cell", JSON.stringify([pos.coords.latitude, pos.coords.longitude]));
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
  }, () => toast(t("earn.standortFehlt"), true));
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
  box.innerHTML = `<div class='mono-sm'>${escapeHtml(t("earn.lade"))}</div>`;
  try {
    const pool = await ensurePool();
    // Der eigene Knoten (4.5b): gemerkter Schlüssel, sonst die eigene Identität
    const events = await pool.query({
      kinds: [KIND_PERFORMANCE],
      authors: [knotenSchluessel() ?? state.keypair.pk],
      limit: 20,
    });
    const sorted = events.sort((a, b) => b.created_at - a.created_at);
    box.innerHTML = sorted.length
      ? sorted
          .map((ev) => {
            const get = (n: string) => ev.tags.find((t) => t[0] === n)?.[1] ?? "—";
            return `<div class="stat"><span class="k">${escapeHtml(get("work_type"))} · ${escapeHtml(t("earn.einheiten", { n: get("units") }))}</span>
              <span>${Math.floor(Number(get("volume_msat")) / 1000)} sats · ${timeAgo(ev.created_at)}</span></div>`;
          })
          .join("")
      : `<div class='mono-sm'>${escapeHtml(t("earn.keineEinnahmen"))}</div>`;
  } catch (e) {
    box.innerHTML = `<div class='mono-sm err'>${escapeHtml(fehlerText(e))}</div>`;
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
export function updateReferralLink(): void {
  const link = $("#referral-link") as HTMLInputElement | null;
  const stats = $("#referral-stats");
  if (!link || !state.keypair) return;
  const pub = state.keypair.pk;
  // Origin-basiert (funktioniert auf jeder Domain — nicht nur localhost); mit
  // der Lightning-Adresse aus dem Profil, damit der Anteil ankommt (5.1.3b)
  let lud16: string | undefined;
  try { lud16 = (JSON.parse(localStorage.getItem("freedom.profile") ?? "{}") as { lud16?: string }).lud16; } catch { /* kein Profil */ }
  link.value = werbeLink(window.location.origin + window.location.pathname, pub, lud16);
  // Als QR-Code zum Zeigen oder Ausdrucken (11.1b) – nichts Geheimes darin
  $("#referral-qr")?.replaceChildren(qrKnopf(link.value, { beschriftung: t("earn.werbelinkQr") }));
  if (stats) {
    stats.textContent = t(new URL(link.value).searchParams.has("ln") ? "earn.codeMitAdresse" : "earn.codeOhneAdresse", { code: pkShort(pub) });
  }
  void zeigeNennungen();
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
  merkeWerber(window.location.search, localStorage);
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
