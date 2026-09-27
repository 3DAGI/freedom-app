/**
 * Tab Profil: Profil bearbeiten und veröffentlichen, Vorschau, Abzeichen.
 *
 * Aus app.ts verschoben (Schritt 1.0) – wörtlich, ohne Logikänderung.
 */
import { t } from "../../i18n.js";
import { abzeichenHerkunft, abzeichenQuelle, aufgabeStand, aufgabeText, aufgabeTitel, bildWarnung, profilOffenlegung } from "../../protokoll-texte.js";
import { escapeHtml, pkShort } from "../../shell-logic.js";
import { ensurePool, signiere, state } from "../state.js";
import { $, toast } from "../ui.js";

/**
 * Ein Abzeichen definieren und verleihen.
 *
 * Bewusst in einem Schritt: Eine Definition ohne Verleihung ist nutzlos, und
 * zwei getrennte Dialoge waeren zwei Gelegenheiten zum Abbrechen.
 */
export async function vergebeAbzeichen(): Promise<void> {
  if (!state.keypair) return;
  const name = prompt(t("profil.abzeichenName"));
  if (!name?.trim()) return;
  const empfaenger = prompt(t("profil.abzeichenAnWen"));
  if (!empfaenger?.trim()) return;

  const pks = empfaenger.split(",").map((x) => x.trim()).filter((x) => /^[0-9a-f]{64}$/.test(x));
  if (pks.length === 0) {
    toast(t("profil.keinPubkey"), true);
    return;
  }

  try {
    const { buildBadgeDefinition, buildBadgeAward } =
      await import("@freedomstack/protocol");
    const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24);
    const pool = await ensurePool();

    await pool.publish(await signiere(buildBadgeDefinition({
      id, name: name.trim(),
      description: prompt(t("profil.abzeichenWofuer")) ?? "",
      issuerPubkey: state.keypair.pk,
    })));
    await pool.publish(await signiere(buildBadgeAward(id, state.keypair.pk, pks)));

    // Die ehrliche Einordnung gehoert dazu, sonst ueberschaetzt der Vergeber
    // die Wirkung.
    toast(t("profil.abzeichenVergeben", { n: pks.length }));
    void zeigeAbzeichen();
  } catch (e) {
    toast((e as Error).message, true);
  }
}

// ------------------------------------------------------------- Profil

/** Vorschau aufbauen. Das Aussehen kommt aus einer festen Auswahl. */
export async function zeigeProfilVorschau(): Promise<void> {
  const box = $("#profile-preview");
  if (!box || !state.keypair) return;
  const { ACCENT_HEX, normalizeStyle } = await import("@freedomstack/protocol");

  const gespeichert = ladeProfilEntwurf();
  const stil = normalizeStyle(gespeichert.freedom_style);
  const farbe = ACCENT_HEX[stil.accent];

  const bild = gespeichert.picture;
  const avatar = bild && /^https:\/\/|^data:image\/|^freedom-blob:/.test(bild)
    ? `<img class="profile-avatar" src="${escapeHtml(bild)}" alt="" style="color:${farbe}" />`
    : `<div class="profile-avatar-fallback" style="color:${farbe}">${escapeHtml((gespeichert.name ?? "?").slice(0, 1).toUpperCase())}</div>`;

  box.innerHTML = `<div class="profile-head layout-${escapeHtml(stil.layout)}" style="color:${farbe}">
      <div class="pf-bg pattern-${escapeHtml(stil.pattern)}"></div>
      ${avatar}
      <div class="profile-text">
        <h3 style="color:#E8E8E8">${escapeHtml(gespeichert.name || pkShort(state.keypair.pk))}</h3>
        <p>${escapeHtml(gespeichert.about || t("profil.keineBeschreibung"))}</p>
        ${gespeichert.lud16 ? `<p style="color:${farbe}">⚡ ${escapeHtml(gespeichert.lud16)}</p>` : ""}
      </div>
    </div>`;
}

interface ProfilEntwurf {
  name?: string; about?: string; picture?: string; lud16?: string;
  freedom_style?: { accent: string; layout: string; pattern: string };
}

function ladeProfilEntwurf(): ProfilEntwurf {
  try {
    return JSON.parse(localStorage.getItem("freedom.profile") ?? "{}") as ProfilEntwurf;
  } catch {
    return {};
  }
}

/** Namen der Stilwerte (die Werte selbst gehen so ins Profil). */
const STIL: Record<string, string> = {
  messing: "profil.stilMessing", orange: "profil.stilOrange", tinte: "profil.stilTinte", moos: "profil.stilMoos", pflaume: "profil.stilPflaume", stahl: "profil.stilStahl",
  schlicht: "profil.stilSchlicht", karte: "profil.stilKarte", breit: "profil.stilBreit",
  keines: "profil.stilKeines", raster: "profil.stilRaster", wellen: "profil.stilWellen", verlauf: "profil.stilVerlauf",
};

/** Auswahllisten und Offenlegung neu in der Sprache der Oberfläche (gesetzt von `wireProfil`). */
let texteNeu: (() => void) | undefined;

/** Nach einem Sprachwechsel beim Öffnen des Tabs (8.16f) – Stilnamen und Offenlegung füllt der Code. */
export function zeigeProfilTexte(): void {
  texteNeu?.();
}

/** Formular verdrahten. */
export async function wireProfil(): Promise<void> {
  const { ACCENTS, LAYOUTS, PATTERNS, normalizeStyle, inspectAbout, inspectPicture } =
    await import("@freedomstack/protocol");

  const fuelle = (id: string, werte: readonly string[], aktiv: string): void => {
    const el = $(id) as HTMLSelectElement | null;
    if (!el) return;
    el.innerHTML = werte.map((w) =>
      `<option value="${escapeHtml(w)}"${w === aktiv ? " selected" : ""}>${escapeHtml(STIL[w] ? t(STIL[w]!) : w)}</option>`).join("");
  };

  const fuelleStil = (stil: { accent: string; layout: string; pattern: string }): void => {
    fuelle("#pf-accent", ACCENTS, stil.accent);
    fuelle("#pf-layout", LAYOUTS, stil.layout);
    fuelle("#pf-pattern", PATTERNS, stil.pattern);
  };
  const e = ladeProfilEntwurf();
  fuelleStil(normalizeStyle(e.freedom_style));

  const felder: Record<string, string | undefined> = {
    "#pf-name": e.name, "#pf-about": e.about, "#pf-picture": e.picture, "#pf-lud16": e.lud16,
  };
  for (const [id, wert] of Object.entries(felder)) {
    const el = $(id) as HTMLInputElement | null;
    if (el) el.value = wert ?? "";
  }

  const sammeln = (): ProfilEntwurf => ({
    name: ($("#pf-name") as HTMLInputElement)?.value.trim() || undefined,
    about: inspectAbout(($("#pf-about") as HTMLTextAreaElement)?.value).clean || undefined,
    picture: ($("#pf-picture") as HTMLInputElement)?.value.trim() || undefined,
    lud16: ($("#pf-lud16") as HTMLInputElement)?.value.trim() || undefined,
    freedom_style: {
      accent: ($("#pf-accent") as HTMLSelectElement)?.value ?? "messing",
      layout: ($("#pf-layout") as HTMLSelectElement)?.value ?? "schlicht",
      pattern: ($("#pf-pattern") as HTMLSelectElement)?.value ?? "keines",
    },
  });

  /**
   * Offenlegung LIVE mitschreiben.
   *
   * Der Nutzer soll sehen, was er preisgibt, waehrend er tippt — nicht
   * nachdem er gespeichert hat.
   */
  const zeigeOffenlegung = (): void => {
    const box = $("#pf-disclosure");
    if (!box) return;
    const entwurf = sammeln();
    const zeilen = profilOffenlegung(entwurf as never);
    box.innerHTML = zeilen.map((z) => `<div>${escapeHtml(z)}</div>`).join("");
    // Warnfarbe am Befund, nicht am Text: ein fremder Server sieht die IP der Betrachter
    box.className = inspectPicture(entwurf.picture).kind === "extern" ? "mono-sm warn" : "mono-sm muted";
  };

  for (const id of ["#pf-name", "#pf-about", "#pf-picture", "#pf-lud16",
                    "#pf-accent", "#pf-layout", "#pf-pattern"]) {
    $(id)?.addEventListener("input", () => {
      localStorage.setItem("freedom.profile", JSON.stringify(sammeln()));
      zeigeOffenlegung();
      void zeigeProfilVorschau();
    });
  }
  zeigeOffenlegung();
  texteNeu = () => {
    fuelleStil(normalizeStyle(sammeln().freedom_style));
    zeigeOffenlegung();
  };

  const save = $("#pf-save");
  if (save) save.onclick = async () => {
    if (!state.keypair) return;
    try {
      const { buildProfile } = await import("@freedomstack/protocol");
      const entwurf = sammeln();
      const bild = inspectPicture(entwurf.picture);
      if (!bild.ok) {
        toast(bildWarnung(entwurf.picture) ?? t("profil.bildNichtVerwendbar"), true);
        return;
      }
      localStorage.setItem("freedom.profile", JSON.stringify(entwurf));
      await (await ensurePool()).publish(await signiere(buildProfile(state.keypair.pk, entwurf as never)));
      toast(t("profil.gespeichert"));
      void zeigeProfilVorschau();
    } catch (err) {
      toast((err as Error).message, true);
    }
  };

  void zeigeProfilVorschau();
  void zeigeAbzeichen();
}

/** Abzeichen mit ihrer Herkunft. */
export async function zeigeAbzeichen(): Promise<void> {
  const box = $("#badge-list");
  if (!box || !state.keypair) return;
  try {
    const {
      collectBadges, KIND_BADGE_DEFINITION, KIND_BADGE_AWARD,
      evaluateQuests, KIND_PERFORMANCE,
    } = await import("@freedomstack/protocol");
    const pool = await ensurePool();
    const [abz, arbeit] = await Promise.all([
      pool.query({ kinds: [KIND_BADGE_DEFINITION, KIND_BADGE_AWARD], limit: 500 }),
      pool.query({ kinds: [KIND_PERFORMANCE], authors: [state.keypair.pk], limit: 500 }),
    ]);

    // Verdiente Abzeichen kommen aus dem Aufgabensystem — nachrechenbar, ohne Geld.
    const erledigt = evaluateQuests({
      pubkey: state.keypair.pk, performances: arbeit,
    }).filter((q) => q.done).map((q) => ({
      id: q.quest.id, name: aufgabeTitel(q.quest.id), description: aufgabeText(q.quest.id), basis: aufgabeStand(q),
    }));

    const alle = collectBadges(state.keypair.pk, abz, erledigt);
    box.innerHTML = alle.length === 0
      ? `<span class="muted">${escapeHtml(t("profil.keineAbzeichen"))}</span>`
      : alle.map((b) => `<div class="badge-row">
          <span class="badge-chip ${escapeHtml(b.source)}">${escapeHtml(abzeichenQuelle(b.source))}</span>
          <span style="min-width:0">
            <span style="font-weight:600;font-size:12px">${escapeHtml(b.definition.name)}</span><br>
            <span class="muted" style="font-size:11px">${escapeHtml(abzeichenHerkunft(b))}</span>
          </span></div>`).join("");
  } catch (e) {
    box.textContent = t("agent.nichtAbrufbar", { fehler: (e as Error).message });
  }
}
