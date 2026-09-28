/**
 * Tab Agent, Unter-Reiter Modelle und Repos: Modelle im Netz ankündigen und
 * vorhalten, Repositories über das Speichernetz.
 *
 * Aus app.ts verschoben (Schritt 1.0) – wörtlich, ohne Logikänderung.
 */
import { NostrEvent, type ModelEntry, type ModellKatalog } from "@freedomstack/protocol";
import { t } from "../../i18n.js";
import { fehlerText } from "../../protokoll-texte.js";
import { LS_KATALOGE, katalogKennung, katalogRang, leseAbos, leseKatalogEingabe, mitAbo, ohneAbo } from "../../modell-kataloge.js";
import { ausMsat } from "../../preis-anzeige.js";
import { escapeHtml, pkShort } from "../../shell-logic.js";
import { aktualisiereKurs, aktuellerKurs } from "../marktkurs.js";
import { alleAngebote, alsGeraet, ensurePool, signiere, state } from "../state.js";
import { $, toast } from "../ui.js";

/**
 * Verfügbarkeit eines Modells in der Sprache der Oberfläche (8.16e) – aus den
 * Zahlen, wie `buildRegistry()` sie bewertet; dessen `note` ist Deutsch.
 */
export function modellNotiz(m: Pick<ModelEntry, "seeders" | "missingFiles">): string {
  if (m.missingFiles.length > 0) return m.seeders === 0 ? t("agent.notizWeg") : t("agent.notizFehlen", { n: m.missingFiles.length, seeder: m.seeders });
  if (m.seeders >= 5) return t("agent.notizGut", { n: m.seeders });
  return m.seeders >= 2 ? t("agent.notizKnapp", { n: m.seeders }) : t("agent.notizEiner");
}

/** Modelle im Netz anzeigen. */
export async function zeigeModelle(): Promise<void> {
  const box = $("#models-list");
  if (!box) return;
  try {
    const { buildRegistry, KIND_MODEL_MANIFEST, KIND_MODEL_SEED, modelsAtRisk } = await import("@freedomstack/protocol");
    const pool = await ensurePool();
    const evs = await pool.query({ kinds: [KIND_MODEL_MANIFEST, KIND_MODEL_SEED], limit: 1000 });
    const r = buildRegistry(evs);
    box.innerHTML = r.models.length === 0
      ? `<span class="muted">${escapeHtml(t("agent.keineModelle"))}</span>`
      : r.models.slice(0, 20).map((m) => {
          const cls = m.availability === "gut" ? "ok" : m.availability === "knapp" ? "warn" : "err";
          return `<div class="usage-row"><span>${escapeHtml(m.manifest.name)}` +
            `${m.manifest.quant ? ` · ${escapeHtml(m.manifest.quant)}` : ""}</span>` +
            `<span class="${cls}">${escapeHtml(modellNotiz(m))}</span></div>`;
        }).join("");
    // Gefaehrdete zuerst nennen (8.8) – die Liste oben ist nach Seedern sortiert und schneidet sie sonst ab.
    const gefaehrdet = modelsAtRisk(r.models);
    if (gefaehrdet.length > 0) {
      const z = document.createElement("div");
      z.className = "warn";
      z.textContent = t("agent.gefaehrdet", {
        namen: gefaehrdet.slice(0, 5).map((m) => m.manifest.name).join(", "),
        mehr: gefaehrdet.length > 5 ? t("agent.undWeitere", { n: gefaehrdet.length - 5 }) : "",
      });
      box.prepend(z);
    }
  } catch (e) {
    box.textContent = t("agent.nichtAbrufbar", { fehler: fehlerText(e) });
  }
}

/**
 * Ein Modell ankuendigen.
 *
 * Ohne diesen Weg bleibt der Katalog fuer immer leer — das Protokoll konnte
 * Manifeste lesen, aber niemand konnte eines erzeugen.
 */
export async function kuendigeModellAn(): Promise<void> {
  if (!state.keypair) return;
  const id = prompt(t("agent.modellKennungFrage"));
  if (!id?.trim()) return;
  const dateien = prompt(t("agent.dateienFrage"));
  if (!dateien?.trim()) return;

  const files = dateien.split("\n").map((z) => {
    const [name, sha256, size] = z.trim().split(/\s+/);
    return { name, sha256: (sha256 ?? "").toLowerCase(), sizeBytes: Number(size) };
  }).filter((f) => f.name && /^[0-9a-f]{64}$/.test(f.sha256) && f.sizeBytes > 0);

  if (files.length === 0) {
    toast(t("agent.keineZeileBrauchbar"), true);
    return;
  }

  try {
    const { buildModelManifest } = await import("@freedomstack/protocol");
    await (await ensurePool()).publish(await signiere(buildModelManifest({
      modelId: id.trim(), name: id.trim(), files, publisherPubkey: state.keypair.pk,
    } as never)));
    toast(t("agent.dateienAngekuendigt", { n: files.length }));
    void zeigeModelle();
  } catch (e) {
    toast(fehlerText(e), true);
  }
}

/** Melden, dass man ein Modell vorhaelt. */
export async function haltevorModell(): Promise<void> {
  if (!state.keypair) return;
  const id = prompt(t("agent.welchesModell"));
  if (!id?.trim()) return;
  const dateien = prompt(t("agent.welcheDateien")) ?? "";

  try {
    const { buildModelSeed, buildRegistry, KIND_MODEL_MANIFEST } =
      await import("@freedomstack/protocol");
    const pool = await ensurePool();

    // Teilbestaende sind ausdruecklich erlaubt: Wer nur die Haelfte hat,
    // traegt trotzdem bei.
    let liste = dateien.split(",").map((x) => x.trim()).filter(Boolean);
    if (liste.length === 0) {
      const evs = await pool.query({ kinds: [KIND_MODEL_MANIFEST], limit: 500 });
      const m = buildRegistry(evs).models.find((x) => x.manifest.modelId === id.trim());
      if (!m) {
        toast(t("agent.keinManifest"), true);
        return;
      }
      liste = m.manifest.files.map((f) => f.name);
    }

    await pool.publish(await signiere(buildModelSeed(
      id.trim(), state.keypair.pk, liste,
      localStorage.getItem("freedom.region") ?? undefined)));
    toast(t("agent.dateienGemeldet", { n: liste.length }));
    void zeigeModelle();
  } catch (e) {
    toast(fehlerText(e), true);
  }
}

// ------------------------------------------------- Modellkataloge (5.7 mit 8.8)

/** Die zuletzt geladenen abonnierten Kataloge – fuer die Reihenfolge im Modell-Dropdown. */
let abonnierteKataloge: ModellKatalog[] = [];

/** In wie vielen abonnierten Katalogen steht ein Modell? Leer, solange keine geladen sind. */
export function katalogRangJetzt(): Map<string, number> {
  return katalogRang(abonnierteKataloge);
}

function neu<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

function knopf(text: string, aktion: () => void): HTMLButtonElement {
  const b = neu("button", text, "ghost");
  b.style.cssText = "width:auto;padding:2px 8px;margin-left:6px";
  b.addEventListener("click", aktion);
  return b;
}

function speichereAbos(abos: string[]): void {
  localStorage.setItem(LS_KATALOGE, JSON.stringify(abos));
}

/**
 * Kataloge anzeigen: abonnierte, ihr Vergleich mit den Angeboten der Provider
 * (Anzahl, guenstigster Preis in sats und SOL) und gefundene zum Abonnieren.
 * Alle Texte ueber `textContent` – Kataloge sind Fremddaten.
 */
export async function zeigeKataloge(): Promise<void> {
  const aboBox = $("#kataloge-abos");
  const vergleichBox = $("#kataloge-vergleich");
  const gefundenBox = $("#kataloge-gefunden");
  if (!aboBox || !vergleichBox || !gefundenBox) return;
  try {
    const { KIND_MODELL_KATALOG, modellAngebote, neuesteKataloge, vergleicheKataloge } = await import("@freedomstack/protocol");
    const pool = await ensurePool();
    // Alle holen und selbst auswaehlen: Ein Filter nach Kurator verriete den Relays die Abos.
    const [evs, angebote] = await Promise.all([
      pool.query({ kinds: [KIND_MODELL_KATALOG], limit: 500 }),
      alleAngebote().catch(() => []),
      aktualisiereKurs().catch(() => undefined),
    ]);
    const alle = neuesteKataloge(evs);
    const abos = leseAbos(localStorage.getItem(LS_KATALOGE));
    abonnierteKataloge = abos.map((a) => alle.get(a)).filter((k): k is ModellKatalog => k !== undefined);

    aboBox.replaceChildren();
    if (abos.length === 0) aboBox.append(neu("div", t("agent.keinAbo"), "muted"));
    for (const a of abos) {
      const k = alle.get(a);
      const zeile = neu("div", k ? t("agent.katalogZeile", { titel: k.titel, kurator: pkShort(k.kurator), n: k.modelle.length }) : t("agent.katalogFehlt", { kennung: a.slice(6, 18) }), "usage-row");
      zeile.append(knopf(t("agent.abbestellen"), () => {
        speichereAbos(ohneAbo(leseAbos(localStorage.getItem(LS_KATALOGE)), a));
        void zeigeKataloge();
      }));
      aboBox.append(zeile);
    }

    vergleichBox.replaceChildren();
    if (abonnierteKataloge.length > 0) {
      const v = vergleicheKataloge(abonnierteKataloge, modellAngebote(angebote));
      const kurz = abonnierteKataloge.map((k) => k.titel);
      if (abonnierteKataloge.length >= 2) {
        vergleichBox.append(neu("div", [t("agent.gemeinsam", { n: v.gemeinsam.length }), ...kurz.map((titel, i) => t("agent.nurIn", { titel, n: v.nurIn[i]!.length }))].join(" · ")));
      }
      const tabelle = neu("table");
      tabelle.style.cssText = "width:100%;border-collapse:collapse;margin:6px 0";
      const kopf = neu("tr");
      for (const s of [t("agent.modell"), ...kurz, t("agent.provider"), t("agent.abTausend")]) kopf.append(neu("th", s));
      tabelle.append(kopf);
      const kurs = aktuellerKurs();
      for (const z of v.zeilen.slice(0, 100)) {
        const tr = neu("tr");
        tr.append(neu("td", z.modell));
        z.in.forEach((drin, i) => {
          const td = neu("td", drin ? "✓" : "–", drin ? "ok" : "muted");
          if (z.notizen[i]) td.title = z.notizen[i]!;
          tr.append(td);
        });
        tr.append(neu("td", String(z.provider), z.provider > 0 ? "" : "err"));
        tr.append(neu("td", z.preisMsat !== undefined ? ausMsat(z.preisMsat, kurs) : t("agent.keinAngebot")));
        tabelle.append(tr);
      }
      vergleichBox.append(tabelle);
    }

    gefundenBox.replaceChildren();
    const andere = [...alle.values()].filter((k) => !abos.includes(k.adresse)).sort((x, y) => y.createdAt - x.createdAt).slice(0, 20);
    gefundenBox.append(neu("div", andere.length === 0 ? t("agent.keineKataloge") : t("agent.gefundeneKataloge"), "muted"));
    for (const k of andere) {
      const beispiele = k.modelle.slice(0, 3).map((m) => m.modell).join(", ");
      const zeile = neu("div", t("agent.katalogZeile", { titel: k.titel, kurator: pkShort(k.kurator), n: k.modelle.length }) + (beispiele ? ` (${beispiele}${k.modelle.length > 3 ? ", …" : ""})` : ""), "usage-row");
      if (k.beschreibung) zeile.title = k.beschreibung;
      zeile.append(knopf(t("agent.abonnieren"), () => {
        try {
          speichereAbos(mitAbo(leseAbos(localStorage.getItem(LS_KATALOGE)), k.adresse));
          void zeigeKataloge();
        } catch (e) {
          toast(fehlerText(e), true);
        }
      }));
      gefundenBox.append(zeile);
    }
  } catch (e) {
    gefundenBox.textContent = t("agent.nichtAbrufbar", { fehler: fehlerText(e) });
  }
}

/** Einen eigenen Katalog veroeffentlichen – gleicher Titel ersetzt den alten. */
export async function veroeffentlicheKatalog(): Promise<void> {
  if (!state.keypair) return;
  if (alsGeraet()) {
    toast(t("agent.nurHauptKatalog"), true);
    return;
  }
  const titel = prompt(t("agent.katalogTitelFrage"));
  if (!titel?.trim()) return;
  const eingabe = prompt(t("agent.katalogModelleFrage"));
  if (!eingabe?.trim()) return;
  try {
    const { baueModellKatalog } = await import("@freedomstack/protocol");
    const modelle = leseKatalogEingabe(eingabe);
    const ev = await signiere(baueModellKatalog({ kurator: state.keypair.pk, d: katalogKennung(titel), titel, modelle }));
    await (await ensurePool()).publish(ev);
    toast(t("agent.katalogVeroeffentlicht", { titel: titel.trim(), n: modelle.length }));
    void zeigeKataloge();
  } catch (e) {
    toast(fehlerText(e), true);
  }
}

/** Freedom Git: repo-referenzen (38042) laden + klon-buttons. */
export async function loadGitRepos(): Promise<void> {
  const list = $("#git-repo-list");
  if (!list) return;
  try {
    const pool = await ensurePool();
    const { KIND_GIT_REPO_REF } = await import("@freedomstack/protocol");
    const events = await pool.query({ kinds: [KIND_GIT_REPO_REF], limit: 50 });
    // pro (owner,name) nur die neueste version
    const latest = new Map<string, NostrEvent>();
    for (const ev of events) {
      const name = ev.tags.find((t) => t[0] === "d")?.[1] ?? "";
      const key = `${ev.pubkey}/${name}`;
      const cur = latest.get(key);
      if (!cur || ev.created_at > cur.created_at) latest.set(key, ev);
    }
    const sorted = [...latest.values()].sort((a, b) => b.created_at - a.created_at);
    list.innerHTML = sorted.length
      ? sorted.map((ev) => {
          const name = ev.tags.find((t) => t[0] === "d")?.[1] ?? "?";
          return `<div class="stat"><span class="k">📦 ${escapeHtml(name)} <span class="mono-sm">${escapeHtml(pkShort(ev.pubkey))}</span></span>
            <span><button class="ghost copy-btn git-clone-btn" data-ref="${escapeHtml(ev.id)}" data-blob="${escapeHtml(ev.tags.find((t) => t[0] === "blob")?.[1] ?? "")}" data-name="${escapeHtml(name)}" style="width:auto;padding:4px 8px">⇩ bundle</button></span></div>`;
        }).join("")
      : `<span>${escapeHtml(t("agent.keineRepos"))}</span>`;
    list.querySelectorAll(".git-clone-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const el = btn as HTMLButtonElement;
        el.disabled = true;
        try {
          const { downloadBlob, oeffneAnhang } = await import("../../blob-client.js");
          const { parseGitRepoRef } = await import("@freedomstack/protocol");
          const pool = await ensurePool();
          const res = await downloadBlob(el.dataset.blob!, pool as never);
          if (!res) { toast(t("agent.bundleKaputt"), true); return; }
          // Seit 8.9b verschluesselt, der Schluessel steht oeffentlich in der Referenz; aeltere Bundles sind Klartext
          const refEv = sorted.find((x) => x.id === el.dataset.ref);
          const schluessel = refEv ? (() => { try { return parseGitRepoRef(refEv).schluessel; } catch { return undefined; } })() : undefined;
          const bytes = schluessel ? await oeffneAnhang(res.bytes, schluessel) : res.bytes;
          const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: "application/octet-stream" }));
          const a = document.createElement("a");
          a.href = url; a.download = `${el.dataset.name}.bundle`;
          a.click();
          URL.revokeObjectURL(url);
          toast(t("agent.bundleGeladen", { datei: `${el.dataset.name}.bundle` }));
        } catch (e) {
          toast(t("agent.fehlerText", { fehler: fehlerText(e) }), true);
        }
        el.disabled = false;
      });
    });
  } catch {
    list.innerHTML = `<span>${escapeHtml(t("agent.relayOffline"))}</span>`;
  }
}

export function setGitStatus(text: string): void {
  const el = $("#git-repo-list");
  if (el) el.textContent = text;
}
