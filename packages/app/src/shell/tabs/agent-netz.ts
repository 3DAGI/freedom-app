/**
 * Tab Agent, Unter-Reiter Modelle und Repos: Modelle im Netz ankündigen und
 * vorhalten, Repositories über das Speichernetz.
 *
 * Aus app.ts verschoben (Schritt 1.0) – wörtlich, ohne Logikänderung.
 */
import { NostrEvent } from "@freedomstack/protocol";
import { t } from "../../i18n.js";
import { escapeHtml, pkShort } from "../../shell-logic.js";
import { ensurePool, state } from "../state.js";
import { $, toast } from "../ui.js";

/** Modelle im Netz anzeigen. */
export async function zeigeModelle(): Promise<void> {
  const box = $("#models-list");
  if (!box) return;
  try {
    const { buildRegistry, KIND_MODEL_MANIFEST, KIND_MODEL_SEED } = await import("@freedomstack/protocol");
    const pool = await ensurePool();
    const evs = await pool.query({ kinds: [KIND_MODEL_MANIFEST, KIND_MODEL_SEED], limit: 1000 });
    const r = buildRegistry(evs);
    box.innerHTML = r.models.length === 0
      ? `<span class="muted">Noch keine Modelle angekündigt.</span>`
      : r.models.slice(0, 20).map((m) => {
          const cls = m.availability === "gut" ? "ok" : m.availability === "knapp" ? "warn" : "err";
          return `<div class="usage-row"><span>${escapeHtml(m.manifest.name)}` +
            `${m.manifest.quant ? ` · ${escapeHtml(m.manifest.quant)}` : ""}</span>` +
            `<span class="${cls}">${escapeHtml(m.note)}</span></div>`;
        }).join("");
  } catch (e) {
    box.textContent = `Nicht abrufbar: ${(e as Error).message}`;
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
  const id = prompt("Modell-Kennung (z. B. qwen3.5:9b-q4):");
  if (!id?.trim()) return;
  const dateien = prompt(
    "Dateien, je Zeile: name sha256 groesse\n" +
    "Die Pruefsummen sind der ganze Sinn — ohne sie kann niemand pruefen, " +
    "ob die geladene Datei die angekuendigte ist.",
  );
  if (!dateien?.trim()) return;

  const files = dateien.split("\n").map((z) => {
    const [name, sha256, size] = z.trim().split(/\s+/);
    return { name, sha256: (sha256 ?? "").toLowerCase(), sizeBytes: Number(size) };
  }).filter((f) => f.name && /^[0-9a-f]{64}$/.test(f.sha256) && f.sizeBytes > 0);

  if (files.length === 0) {
    toast("Keine Zeile war brauchbar — Format: name sha256 groesse", true);
    return;
  }

  try {
    const { buildModelManifest, signEvent: se } = await import("@freedomstack/protocol");
    await (await ensurePool()).publish(se(buildModelManifest({
      modelId: id.trim(), name: id.trim(), files, publisherPubkey: state.keypair.pk,
    } as never), state.keypair.sk));
    toast(`${files.length} Datei(en) angekündigt`);
    void zeigeModelle();
  } catch (e) {
    toast((e as Error).message, true);
  }
}

/** Melden, dass man ein Modell vorhaelt. */
export async function haltevorModell(): Promise<void> {
  if (!state.keypair) return;
  const id = prompt("Welches Modell hältst du vor?");
  if (!id?.trim()) return;
  const dateien = prompt("Welche Dateien? (kommagetrennt, leer = alle)") ?? "";

  try {
    const { buildModelSeed, signEvent: se, buildRegistry, KIND_MODEL_MANIFEST } =
      await import("@freedomstack/protocol");
    const pool = await ensurePool();

    // Teilbestaende sind ausdruecklich erlaubt: Wer nur die Haelfte hat,
    // traegt trotzdem bei.
    let liste = dateien.split(",").map((x) => x.trim()).filter(Boolean);
    if (liste.length === 0) {
      const evs = await pool.query({ kinds: [KIND_MODEL_MANIFEST], limit: 500 });
      const m = buildRegistry(evs).models.find((x) => x.manifest.modelId === id.trim());
      if (!m) {
        toast("Für dieses Modell gibt es kein Manifest — erst ankündigen", true);
        return;
      }
      liste = m.manifest.files.map((f) => f.name);
    }

    await pool.publish(se(buildModelSeed(
      id.trim(), state.keypair.pk, liste,
      localStorage.getItem("freedom.region") ?? undefined), state.keypair.sk));
    toast(`${liste.length} Datei(en) gemeldet`);
    void zeigeModelle();
  } catch (e) {
    toast((e as Error).message, true);
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
            <span><button class="ghost copy-btn git-clone-btn" data-blob="${escapeHtml(ev.tags.find((t) => t[0] === "blob")?.[1] ?? "")}" data-name="${escapeHtml(name)}" style="width:auto;padding:4px 8px">⇩ bundle</button></span></div>`;
        }).join("")
      : "<span>noch keine repos — publiziere das erste bundle!</span>";
    list.querySelectorAll(".git-clone-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const el = btn as HTMLButtonElement;
        el.disabled = true;
        try {
          const { downloadBlob } = await import("../../blob-client.js");
          const pool = await ensurePool();
          const res = await downloadBlob(el.dataset.blob!, pool as never);
          if (!res) { toast("bundle nicht rekonstruierbar", true); return; }
          const url = URL.createObjectURL(new Blob([res.bytes as unknown as BlobPart], { type: "application/octet-stream" }));
          const a = document.createElement("a");
          a.href = url; a.download = `${el.dataset.name}.bundle`;
          a.click();
          URL.revokeObjectURL(url);
          toast(`bundle geladen — git clone ${el.dataset.name}.bundle`);
        } catch (e) {
          toast(`fehler: ${(e as Error).message}`, true);
        }
        el.disabled = false;
      });
    });
  } catch {
    list.innerHTML = "<span>relay offline</span>";
  }
}

export function setGitStatus(text: string): void {
  const el = $("#git-repo-list");
  if (el) el.textContent = text;
}
