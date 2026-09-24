/**
 * Tab Earn: Einnahmen, Vertrauensstufe, Rangliste, Belohnungen, Mitwirkende,
 * Abdeckungskarte und Werben.
 *
 * Aus app.ts verschoben (Schritt 1.0) – wörtlich, ohne Logikänderung.
 */
import { KIND_PERFORMANCE } from "@freedomstack/protocol";
import { icon } from "../../icons.js";
import { discoverProviders } from "../../matchmaking.js";
import { escapeHtml, pkShort } from "../../shell-logic.js";
import { ensurePool, signiere, state } from "../state.js";
import { $, timeAgo, toast } from "../ui.js";

/** Mitwirkende am Projekt anzeigen. */
export async function zeigeMitwirkende(): Promise<void> {
  const box = $("#contrib-list");
  if (!box) return;
  try {
    const { buildRepoOverview, busFactor, KIND_GIT_CONTRIBUTION } = await import("@freedomstack/protocol");
    const pool = await ensurePool();
    const evs = await pool.query({ kinds: [KIND_GIT_CONTRIBUTION], limit: 1000 });
    const repo = (window as unknown as { FREEDOM_REPO_ID?: string }).FREEDOM_REPO_ID ?? "freedomstack";
    const o = buildRepoOverview(repo, evs);
    const bf = busFactor(o.contributors);

    box.innerHTML = o.contributors.length === 0
      ? `<span class="muted">${escapeHtml(o.healthNote)}</span>`
      : `<div class="mono-sm">${escapeHtml(o.healthNote)}</div>` +
        `<div class="mono-sm muted" style="margin-bottom:6px">${escapeHtml(bf.note)}</div>` +
        o.contributors.slice(0, 15).map((c) =>
          `<div class="usage-row"><span>${escapeHtml(pkShort(c.pubkey))}</span>` +
          `<span>${c.activeDays} aktive Tage · ${c.contributions} Beiträge</span></div>`,
        ).join("");
  } catch (e) {
    box.textContent = `Nicht abrufbar: ${(e as Error).message}`;
  }
}

/** Abdeckung anzeigen. */
export async function ladeAbdeckung(): Promise<void> {
  const liste = $("#coverage-list");
  const hier = $("#coverage-here");
  try {
    const { buildCoverage, coverageAt, KIND_COVERAGE } = await import("@freedomstack/protocol");
    const pool = await ensurePool();
    const evs = await pool.query({ kinds: [KIND_COVERAGE], limit: 2000 });
    const r = buildCoverage(evs);

    if (liste) {
      const { summarizeLayers, LAYER_LABEL } = await import("@freedomstack/protocol");
      const zusammen = summarizeLayers(r.cells, r.hiddenCells);
      const symbol: Record<string, string> = { online: "🌐", lora: "📡", bluetooth: "🔵" };

      liste.innerHTML =
        // Kopfzeile je Ebene: Was gibt es ueberhaupt, bevor es um Orte geht.
        zusammen.map((z) =>
          `<div class="usage-row"><span>${symbol[z.layer]} ${escapeHtml(z.label)}</span>` +
          `<span class="${z.cells > 0 ? "ok" : "muted"}">${z.cells} Gebiet(e)</span></div>`,
        ).join("") +
        (r.cells.length === 0
          ? `<div class="muted" style="margin-top:8px">Noch keine Eintraege. Eintragen ist freiwillig — es kann trotzdem Abdeckung geben.</div>`
          : `<div style="margin-top:8px">` + r.cells.slice(0, 15).map((c) =>
              `${symbol[c.layer] ?? "•"} ${escapeHtml(c.region || "?")} · ${escapeHtml(c.label)}`,
            ).join("<br>") + `</div>`) +
        (r.hiddenCells > 0
          ? `<div class="muted" style="margin-top:6px">${r.hiddenCells} Gebiet(e) nicht angezeigt: zu wenige Knoten, um niemanden zu verorten.</div>`
          : "");
    }

    // Standort nur auf ausdruecklichen Wunsch — nicht beim Oeffnen des Tabs.
    if (hier) {
      const gemerkt = localStorage.getItem("freedom.coverage.cell");
      hier.textContent = gemerkt
        ? coverageAt(...(JSON.parse(gemerkt) as [number, number]), r.cells).message
        : "Fuer die Anzeige, ob es hier Abdeckung gibt, wird dein Standort gebraucht — nur lokal, nichts wird gesendet.";
    }
  } catch (e) {
    if (liste) liste.textContent = `Abdeckung nicht abrufbar: ${(e as Error).message}`;
  }
}

/** Sich selbst eintragen — mit Aufklaerung vorher. */
export async function trageAbdeckungEin(): Promise<void> {
  if (!state.keypair) return;
  const { coverageConsentText, toCell, buildCoverageAnnouncement } =
    await import("@freedomstack/protocol");

  const art = prompt("Was trägst du ein? (funk / bluetooth)", "funk");
  if (!art) return;
  const layer = art.trim().toLowerCase().startsWith("b") ? "bluetooth" : "lora";
  if (!confirm(coverageConsentText(layer))) return;

  navigator.geolocation.getCurrentPosition(async (pos) => {
    try {
      // Runden passiert LOKAL. Die genauen Koordinaten verlassen das Geraet nie.
      // Runden passiert LOKAL, und die Zellgroesse haengt an der Ebene:
      // Bluetooth reicht nur Meter, also wird GROEBER gerundet, nicht feiner.
      const { LAYER_CELL_DEGREES } = await import("@freedomstack/protocol");
      const cell = toCell(pos.coords.latitude, pos.coords.longitude, LAYER_CELL_DEGREES[layer]);
      localStorage.setItem("freedom.coverage.cell", JSON.stringify([pos.coords.latitude, pos.coords.longitude]));
      const pool = await ensurePool();
      await pool.publish(await signiere(buildCoverageAnnouncement({
        pubkey: state.keypair!.pk, layer, cell, region: "",
      })));
      toast("Eingetragen — jederzeit widerrufbar");
      void ladeAbdeckung();
    } catch (e) {
      toast((e as Error).message, true);
    }
  }, () => toast("Standort nicht verfuegbar", true));
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
    if (jobsEl) jobsEl.textContent = `${jobs} jobs`;
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
  box.innerHTML = "<div class='mono-sm'>lade…</div>";
  try {
    const pool = await ensurePool();
    const events = await pool.query({
      kinds: [KIND_PERFORMANCE],
      authors: [state.keypair.pk],
      limit: 20,
    });
    const sorted = events.sort((a, b) => b.created_at - a.created_at);
    box.innerHTML = sorted.length
      ? sorted
          .map((ev) => {
            const get = (n: string) => ev.tags.find((t) => t[0] === n)?.[1] ?? "—";
            return `<div class="stat"><span class="k">${escapeHtml(get("work_type"))} · ${escapeHtml(get("units"))} units</span>
              <span>${Math.floor(Number(get("volume_msat")) / 1000)} sats · ${timeAgo(ev.created_at)}</span></div>`;
          })
          .join("")
      : "<div class='mono-sm'>Noch keine Einnahmen. Sie erscheinen, sobald dein Provider-Knoten Jobs erledigt.</div>";
  } catch (e) {
    box.innerHTML = `<div class='mono-sm err'>${escapeHtml((e as Error).message)}</div>`;
  }
}

/** Provider-Leaderboard: alle Performance-Events im Netz, gruppiert nach Provider. */
export async function loadLeaderboard(): Promise<void> {
  const box = $("#provider-leaderboard");
  if (!box) return;
  // Skeleton-Zeilen während des Ladens
  box.innerHTML = `<div class="lb-skeleton"></div>`.repeat(4);
  // Timeout: Relay hängt → Error-State mit Retry statt endlos „lade…"
  const timeout = new Promise<null>((res) => setTimeout(() => res(null), 12_000));
  try {
    const pool = await ensurePool();
    const work = (async () => {
      const events = await pool.query({ kinds: [KIND_PERFORMANCE], limit: 500 });
      // Gruppieren: provider -> { jobs, sats }
      const stats = new Map<string, { jobs: number; msat: number }>();
      for (const ev of events) {
        const get = (n: string) => ev.tags.find((t) => t[0] === n)?.[1] ?? "0";
        const cur = stats.get(ev.pubkey) ?? { jobs: 0, msat: 0 };
        cur.jobs += 1;
        cur.msat += Number(get("volume_msat"));
        stats.set(ev.pubkey, cur);
      }
      return [...stats.entries()].sort((a, b) => b[1].jobs - a[1].jobs).slice(0, 20);
    })();
    const ranked = await Promise.race([work, timeout]);
    if (!ranked) {
      box.innerHTML = `<div class="mono-sm err">relay-timeout — leaderboard nicht erreichbar</div>
        <button class="ghost lb-retry" style="width:auto;margin-top:6px">↻ erneut versuchen</button>`;
      box.querySelector(".lb-retry")?.addEventListener("click", () => loadLeaderboard());
      return;
    }
    // dienste-uebersicht: modelle + tools der provider aus deren caps
    const capsByPk = new Map<string, { models: string[]; tools: string[] }>();
    try {
      const providers = await discoverProviders(pool);
      for (const p of providers) {
        capsByPk.set(p.caps.pubkey, { models: p.caps.models ?? [], tools: (p.caps.tools ?? []).map((t: { name?: string } | string) => typeof t === "string" ? t : t.name ?? "") });
      }
    } catch { /* caps optional */ }
    if (ranked.length === 0) {
      box.innerHTML = `<div class="lb-empty">
          <div class="lb-empty-icon">${icon("monitor", 28)}</div>
          <div class="lb-empty-title">noch keine provider aktiv</div>
          <div class="mono-sm">starte einen freedomstack-node — er erscheint hier automatisch</div>
        </div>`;
      return;
    }
    // Tabelle: Rang | Provider | Jobs | Verdient | Tier
    const rows = ranked.map(([pk, s], i) => {
      const xp = s.jobs * 2;
      const tier = xp >= 50 ? "pro" : xp >= 10 ? "classic" : "free";
      return `<tr>
        <td class="lb-rank">${i + 1}</td>
        <td class="lb-pk">${escapeHtml(pkShort(pk))}</td>
        <td>${s.jobs}</td>
        <td>${Math.floor(s.msat / 1000)}</td>
        <td><span class="tier-badge tier-${tier}">${tier}</span></td>
      </tr>`;
    }).join("");
    box.innerHTML = `<table class="lb-table">
        <thead><tr><th>#</th><th>provider</th><th>jobs</th><th>sats</th><th>tier</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (e) {
    box.innerHTML = `<div class='mono-sm err'>${escapeHtml((e as Error).message)}</div>
      <button class="ghost lb-retry" style="width:auto;margin-top:6px">↻ erneut versuchen</button>`;
    box.querySelector(".lb-retry")?.addEventListener("click", () => loadLeaderboard());
  }
}

/** Reward-Claim: eigene Season-Summen aus Performance-Events, Claim (38013) publizieren. */
export async function submitRewardClaim(): Promise<void> {
  if (!state.keypair) return;
  const chainSel = $("#claim-chain") as HTMLSelectElement;
  const addrInput = $("#claim-address") as HTMLInputElement;
  const btn = $("#claim-submit") as HTMLButtonElement;
  try {
    btn.disabled = true;
    const pool = await ensurePool();
    const events = await pool.query({ kinds: [KIND_PERFORMANCE], authors: [state.keypair.pk], limit: 1000 });
    const seasonId = "season-" + new Date().getFullYear();
    // nur events der aktuellen season zaehlen (heuristic: letzte 90 tage)
    const cutoff = Math.floor(Date.now() / 1000) - 90 * 24 * 3600;
    const mine = events.filter((ev) => ev.created_at >= cutoff);
    const volumeMsat = mine.reduce((sum, ev) => {
      const v = ev.tags.find((t) => t[0] === "volume_msat")?.[1] ?? "0";
      return sum + Number(v);
    }, 0);
    if (mine.length === 0) {
      toast("keine performance-events — erst jobs arbeiten", true);
      return;
    }
    const payoutAddress = addrInput.value.trim() || undefined;
    const { buildRewardClaim } = await import("@freedomstack/protocol");
    const claim = buildRewardClaim(
      {
        seasonId,
        jobCount: mine.length,
        volumeMsat,
        chain: chainSel.value as "lightning" | "solana",
        payoutAddress: payoutAddress ?? "",
      },
      state.keypair.pk,
    );
    await pool.publish(await signiere(claim));
    toast(`claim eingereicht: ${mine.length} jobs · ${Math.floor(volumeMsat / 1000)} sats`);
  } catch (e) {
    toast(`claim-fehler: ${(e as Error).message}`, true);
  } finally {
    btn.disabled = false;
  }
}

/** Claim-Zusammenfassung im Earn-Tab aktualisieren. */
export async function refreshClaimSummary(): Promise<void> {
  const el = $("#claim-summary");
  if (!el || !state.keypair) return;
  try {
    const pool = await ensurePool();
    const events = await pool.query({ kinds: [KIND_PERFORMANCE], authors: [state.keypair.pk], limit: 1000 });
    const cutoff = Math.floor(Date.now() / 1000) - 90 * 24 * 3600;
    const mine = events.filter((ev) => ev.created_at >= cutoff);
    const volumeMsat = mine.reduce((s, ev) => s + Number(ev.tags.find((t) => t[0] === "volume_msat")?.[1] ?? "0"), 0);
    el.textContent = `Letzte 90 Tage: ${mine.length} Jobs, ${Math.floor(volumeMsat / 1000)} Sats`;
  } catch {
    el.textContent = "—";
  }
}

/** Referral: link mit eigener pubkey generieren + copy. */
export function setupReferral(): void {
  const link = $("#referral-link") as HTMLInputElement | null;
  const copyBtn = $("#referral-copy");
  const stats = $("#referral-stats");
  if (!link || !copyBtn) return;
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(link.value);
      toast("Referral-Link kopiert");
    } catch {
      link.select();
      document.execCommand("copy");
      toast("Referral-Link kopiert");
    }
  });

  // Rechner: der Nutzer soll die Annahme selbst verstellen koennen. Eine feste
  // Beispielzahl waere eine Verkaufszahl; eine, die er anfasst, ist eine
  // Rechnung, die er nachvollzieht.
  const n = $("#ref-calc-n") as HTMLInputElement | null;
  const satsIn = $("#ref-calc-sats") as HTMLInputElement | null;
  const out = $("#ref-calc-out");
  if (n && satsIn && out) {
    const rechne = async (): Promise<void> => {
      const { projectEarnings } = await import("@freedomstack/protocol");
      const p = projectEarnings({
        activeReferrals: Math.max(0, Number(n.value) || 0),
        avgMonthlySatsPerReferral: Math.max(0, Number(satsIn.value) || 0),
      });
      out.innerHTML =
        `<strong>${p.monthlySats.toLocaleString("de-DE")} sats/Monat</strong> ` +
        `(${p.yearlySats.toLocaleString("de-DE")} sats/Jahr), Stufe ${escapeHtml(p.tier)}.<br>` +
        `<span class="muted">${escapeHtml(p.assumption)}</span>`;
    };
    n.addEventListener("input", () => void rechne());
    satsIn.addEventListener("input", () => void rechne());
    void rechne();
  }
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
  // Origin-basiert (funktioniert auf jeder Domain — nicht nur localhost):
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set("ref", pub);
  link.value = url.toString();
  if (stats) stats.textContent = `dein Code: ${pkShort(pub)}`;
  void renderReferralTier();
}

/** Eigene Stufe und der Weg zur naechsten. */
async function renderReferralTier(): Promise<void> {
  const box = $("#referral-tier");
  if (!box || !state.keypair) return;
  try {
    const {
      tierFor, nextTier, buildReferralGraph, referrerOverview,
      KIND_REFERRAL_CLAIM, KIND_PERFORMANCE,
    } = await import("@freedomstack/protocol");
    const pool = await ensurePool();
    const since = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;

    // Aus SIGNIERTEN Netz-Ereignissen gerechnet, nicht aus einer lokalen Zahl.
    // Damit kann jeder dieselbe Rechnung anstellen und das Ergebnis pruefen.
    const [claims, perfs] = await Promise.all([
      pool.query({ kinds: [KIND_REFERRAL_CLAIM], limit: 2000 }),
      pool.query({ kinds: [KIND_PERFORMANCE], since, limit: 2000 }),
    ]);
    const graph = buildReferralGraph(claims, perfs);
    const u = referrerOverview(state.keypair.pk, graph);

    const t = tierFor(u.activeReferrals);
    const next = nextTier(u.activeReferrals);
    box.innerHTML =
      `Stufe <strong>${escapeHtml(t.name)}</strong> — ${escapeHtml(t.perk)}<br>` +
      `<span class="muted">${u.activeReferrals} aktiv von ${u.totalReferrals} geworben` +
      (u.level2Count > 0 ? `, ${u.level2Count} auf Ebene 2` : "") + `.</span>` +
      (next
        ? `<br><span class="muted">Noch ${next.missing} aktive Geworbene bis ${escapeHtml(next.tier.name)}.</span>`
        : `<br><span class="muted">Hoechste Stufe erreicht.</span>`);
  } catch {
    // Ohne Netz keine erfundene Zahl anzeigen.
    box.innerHTML = `<span class="muted">Stufe wird beim naechsten Netzkontakt berechnet.</span>`;
  }
}

/** Referral aus URL lesen (?ref=pubkey) und speichern. */
export function captureReferral(): void {
  const ref = new URLSearchParams(window.location.search).get("ref");
  if (ref && /^[0-9a-f]{64}$/.test(ref)) {
    // Nicht ueberschreiben: Es zaehlt ohnehin die frueheste Angabe im Netz.
    // Lokal dasselbe Verhalten, damit ein spaeter geoeffneter fremder Link
    // den urspruenglichen Werber nicht still verdraengt.
    if (!localStorage.getItem("freedom.referrer")) {
      localStorage.setItem("freedom.referrer", ref);
    }
  }
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

  try {
    const { buildReferralClaim } = await import("@freedomstack/protocol");
    const pool = await ensurePool();
    await pool.publish(await signiere(buildReferralClaim(state.keypair.pk, referrer)));
    localStorage.setItem("freedom.referrer.published", "1");
  } catch (e) {
    // Kein Abbruch: Der Claim wird beim naechsten Start erneut versucht.
    console.warn(`[referral] Claim noch nicht veroeffentlicht: ${(e as Error).message}`);
  }
}
