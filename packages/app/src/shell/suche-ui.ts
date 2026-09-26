/**
 * Lokale Suche in der Kommunikation (Schritt 8.13): Suchfeld ueber der
 * Unterhaltungsliste; aufgenommen wird, was die App ohnehin entschluesselt und
 * zeigt. Der Index liegt verschluesselt in IndexedDB („freedom-suche“), der
 * Schluessel im Tresor – ohne Tresor nur im Speicher bis zum Neuladen.
 * Treffer werden per DOM und textContent gezeigt (Fremdtext).
 */
import { LokaleSuche, type SuchDoc, neuerSuchSchluessel, suchSchluessel } from "../suche.js";
import { IndexedDbSpeicher } from "../vault.js";
import { geheim, tresorEingerichtet } from "./tresor.js";

export const LS_SUCH_SCHLUESSEL = "freedom.suche.schluessel";

let suche: Promise<LokaleSuche> | null = null;

async function starte(): Promise<LokaleSuche> {
  if (tresorEingerichtet()) {
    try {
      let hex = geheim.getItem(LS_SUCH_SCHLUESSEL);
      if (!hex) {
        hex = neuerSuchSchluessel();
        await geheim.setItem(LS_SUCH_SCHLUESSEL, hex);
      }
      const s = new LokaleSuche(new IndexedDbSpeicher("freedom-suche", "index"), await suchSchluessel(hex));
      await s.laden(() => new Promise((r) => setTimeout(r, 0))).catch(() => 0);
      return s;
    } catch { /* Tresor gesperrt: nur im Speicher */ }
  }
  return new LokaleSuche(null, null);
}

export function lokaleSuche(): Promise<LokaleSuche> {
  suche ??= starte();
  return suche;
}

/** Eine gezeigte Nachricht aufnehmen (einmal je Kennung). */
export function sucheAufnehmen(doc: SuchDoc): void {
  void lokaleSuche().then((s) => s.aufnehmen(doc)).catch(() => undefined);
}

/** Index vergessen – im Speicher und auf dem Geraet (auch fuer die Notfall-Loeschung). */
export async function sucheVergessen(): Promise<void> {
  await (await lokaleSuche()).vergessen();
}

/**
 * Suchfeld verdrahten: tippen → Treffer statt Liste; ein Treffer oeffnet die
 * Unterhaltung. `name` liefert den Anzeigenamen einer Unterhaltung.
 */
export function wireSuche(oeffne: (scope: string) => void, name: (scope: string) => string): void {
  const feld = document.getElementById("chat-suche") as HTMLInputElement | null;
  const treffer = document.getElementById("chat-suche-treffer");
  const liste = document.getElementById("chat-list");
  if (!feld || !treffer || !liste) return;
  let warte: ReturnType<typeof setTimeout> | null = null;
  const zeige = async (): Promise<void> => {
    const q = feld.value.trim();
    treffer.classList.toggle("hidden", !q);
    liste.classList.toggle("hidden", !!q);
    if (!q) return;
    const hits = (await lokaleSuche()).suche(q, { limit: 50 });
    if (hits.length === 0) {
      treffer.replaceChildren(Object.assign(document.createElement("div"), { className: "mono-sm muted", textContent: "Nichts gefunden – gesucht wird nur in Nachrichten, die hier schon geöffnet wurden." }));
      return;
    }
    treffer.replaceChildren(...hits.map((h) => {
      const e = document.createElement("div");
      e.className = "chat-item";
      const kopf = document.createElement("div");
      kopf.className = "label";
      kopf.textContent = `${h.doc.scope ? name(h.doc.scope) : "?"} · ${new Date(h.doc.createdAt * 1000).toLocaleDateString("de-DE")}`;
      const text = document.createElement("div");
      text.className = "mono-sm muted";
      text.textContent = h.snippet;
      e.append(kopf, text);
      e.addEventListener("click", () => {
        if (!h.doc.scope) return;
        feld.value = "";
        void zeige();
        oeffne(h.doc.scope);
      });
      return e;
    }));
  };
  feld.addEventListener("input", () => {
    if (warte) clearTimeout(warte);
    warte = setTimeout(() => void zeige(), 120);
  });
}
