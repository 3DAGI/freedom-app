/**
 * Nachfolge als Vertrauter (Schritt 8.11b): Settings → Sicherheit →
 * „Nachfolge & Wiederherstellung“ zeigt, fuer wen ich einen Anteil halte,
 * den Stand des Plans und was ich tun kann – melden, Anteile anfordern,
 * meinen Anteil uebergeben, zusammensetzen. Alles versiegelt (8.11a).
 *
 * Die Liste wird mit DOM-Aufrufen und textContent gebaut: Namen und Gruende
 * kommen von Fremden.
 */
import {
  type AnteilAnfrage, KIND_HEARTBEAT, KIND_RECOVERY_CLAIM, KIND_SUCCESSION_PLAN, type NostrEvent, type SuccessionPlan,
  baueAnteilAnfrage, baueAnteilUebergabe, buildRecoveryClaim, parseSuccessionPlan, setzeNachfolgeZusammen,
} from "@freedomstack/protocol";
import { pkShort } from "../shell-logic.js";
import { type NachfolgeStand, type VertrautenZeile, leseStand, neuestePlaene, nimmUmschlag, schreibeStand, vertrautenZeilen } from "../nachfolge.js";
import { ensurePool, signiere, state } from "./state.js";
import { geheim, tresorEingerichtet } from "./tresor.js";
import { toast } from "./ui.js";

/** Ohne Tresor nur im Speicher – ein Anteil gehoert nie im Klartext in localStorage. */
let imSpeicher: NachfolgeStand | undefined;
const speicher = () => (tresorEingerichtet() ? geheim : null);

function stand(): NachfolgeStand {
  const st = leseStand(speicher(), imSpeicher);
  if (!speicher()) imSpeicher = st;
  return st;
}

async function merke(st: NachfolgeStand): Promise<void> {
  if (speicher()) await schreibeStand(speicher(), st);
  else imSpeicher = st;
}

async function plaeneVon(besitzer: string[]): Promise<Map<string, SuccessionPlan>> {
  if (besitzer.length === 0) return new Map();
  const evs = await (await ensurePool()).query({ kinds: [KIND_SUCCESSION_PLAN], authors: besitzer, limit: 50 });
  return neuestePlaene(evs, parseSuccessionPlan);
}

/** Lesen, aendern, schreiben nacheinander – sonst verliert ein paralleler Abgleich Eintraege. */
let kette: Promise<unknown> = Promise.resolve();
function nacheinander<T>(f: () => Promise<T>): Promise<T> {
  const r = kette.then(f, f);
  kette = r.catch(() => undefined);
  return r;
}

/** Posteingang: gehoert ein Umschlag zur Nachfolge, einordnen (aus tabs/kommunikation.ts). */
export async function alsNachfolge(w: NostrEvent): Promise<null> {
  const signer = state.signer;
  if (!signer) return null;
  const neu = await nacheinander(async () => {
    const n = await nimmUmschlag({
      wrap: w, signer, stand: stand(),
      plaene: async () => [...(await plaeneVon(Object.keys(stand().angefragt))).values()],
    }).catch(() => null);
    if (n) await merke(n).catch(() => undefined);
    return n;
  });
  if (neu) void zeigeVertraute();
  return null;
}

async function sende(wrap: NostrEvent, an: string): Promise<void> {
  const { veroeffentlicheDm } = await import("./tabs/kommunikation.js");
  await veroeffentlicheDm(wrap, an);
}

function el(tag: string, text?: string, klasse?: string): HTMLElement {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (klasse) e.className = klasse;
  return e;
}

function knopf(text: string, fn: () => void, aus = false): HTMLButtonElement {
  const b = el("button", text, "ghost") as HTMLButtonElement;
  b.style.cssText = "width:auto;padding:3px 8px;margin:4px 4px 0 0";
  b.disabled = aus;
  b.addEventListener("click", fn);
  return b;
}

/** Die Liste „Du bist Vertrauter fuer …“ neu zeichnen. */
export async function zeigeVertraute(): Promise<void> {
  const box = document.getElementById("vertraute-liste");
  if (!box || !state.keypair) return;
  const st = stand();
  const besitzer = Object.keys(st.anteile);
  if (besitzer.length === 0) {
    box.replaceChildren();
    return;
  }
  try {
    const pool = await ensurePool();
    const [plaene, events] = await Promise.all([
      plaeneVon(besitzer),
      pool.query({ kinds: [KIND_HEARTBEAT, KIND_RECOVERY_CLAIM], authors: undefined, "#p": besitzer, limit: 500 })
        .then(async (claims) => [...claims, ...(await pool.query({ kinds: [KIND_HEARTBEAT], authors: besitzer, limit: 200 }))]),
    ]);
    const zeilen = vertrautenZeilen(st, plaene, events, state.keypair.pk);
    box.replaceChildren(el("div", "Du bist Vertrauter für:", "label"), ...zeilen.map(zeile));
    if (!tresorEingerichtet()) {
      box.append(el("div", "Ohne Tresor bleibt dein Anteil nur auf den Relays – richte den Tresor ein, damit er auf diesem Gerät bleibt.", "mono-sm warn"));
    }
  } catch {
    box.textContent = "Relays nicht erreichbar";
  }
}

function zeile(z: VertrautenZeile): HTMLElement {
  const block = el("div", undefined, "usage-row");
  block.style.cssText = "display:block;margin-top:8px";
  block.append(el("div", `${pkShort(z.besitzer)} · Teil ${z.anteil.index} von ${z.anteil.anzahl}, Schwelle ${z.anteil.schwelle}`));
  if (!z.plan) block.append(el("div", "Plan nicht gefunden.", "mono-sm muted"));
  else if (!z.passt) block.append(el("div", "Dein Anteil gehört zu einem älteren Plan – der Besitzer hat neu eingerichtet.", "mono-sm muted"));
  else if (z.status) block.append(el("div", z.status.message, `mono-sm ${z.status.status === "aktiv" ? "ok" : "warn"}`));
  const knoepfe = el("div");
  if (z.passt && !z.gemeldet) knoepfe.append(knopf("melden", () => void melde(z.besitzer)));
  if (z.gemeldet) knoepfe.append(el("span", "gemeldet · ", "mono-sm muted"));
  if (z.kannAnfordern) knoepfe.append(knopf("Anteile anfordern", () => void fordereAn(z)));
  if (z.kannAnfordern) knoepfe.append(el("span", `${z.beisammen} von ${z.plan!.threshold} beisammen `, "mono-sm"));
  if (z.kannZusammensetzen) knoepfe.append(knopf("zusammensetzen", () => void setzeZusammen(z)));
  block.append(knoepfe);
  for (const { anfrage, darf } of z.anfragen) {
    const r = el("div", `${pkShort(anfrage.von)} bittet um deinen Anteil. `, "mono-sm");
    if (darf.ok) r.append(knopf("übergeben", () => void uebergib(z, anfrage)));
    else r.append(el("span", darf.grund, "muted"));
    block.append(r);
  }
  return block;
}

/** Oeffentlich melden: „Ich halte den Ausloeser fuer erfuellt.“ */
async function melde(besitzer: string): Promise<void> {
  if (!state.keypair) return;
  const grund = prompt(`Meldung für ${pkShort(besitzer)}: Warum? (wird veröffentlicht)`);
  if (!grund?.trim()) return;
  try {
    await (await ensurePool()).publish(await signiere(buildRecoveryClaim(state.keypair.pk, besitzer, grund.trim())));
    toast("Gemeldet — ein Lebenszeichen der Person bricht den Vorgang ab");
    void zeigeVertraute();
  } catch (e) {
    toast((e as Error).message, true);
  }
}

/** Als Sammler die anderen Vertrauten versiegelt um ihre Anteile bitten. */
async function fordereAn(z: VertrautenZeile): Promise<void> {
  if (!state.signer || !z.plan) return;
  const andere = z.plan.guardians.filter((g) => g !== state.signer!.publicKey());
  try {
    for (const an of andere) {
      const { wrap } = await baueAnteilAnfrage({ von: state.signer, an, besitzer: z.besitzer, teilung: z.anteil.teilung });
      await sende(wrap, an);
    }
    const st = stand();
    st.angefragt[z.besitzer] = Math.floor(Date.now() / 1000);
    await merke(st);
    toast(`${andere.length} Vertraute versiegelt angefragt – ihre Apps übergeben erst nach Freigabe`);
  } catch (e) {
    toast((e as Error).message, true);
  }
}

/** Meinen Anteil an den Anfragenden uebergeben – nach Rueckfrage. */
async function uebergib(z: VertrautenZeile, anfrage: AnteilAnfrage): Promise<void> {
  if (!state.signer) return;
  if (!confirm(`Deinen Anteil für ${pkShort(z.besitzer)} an ${pkShort(anfrage.von)} übergeben?\n\nDer Plan ist freigegeben. Mit genug Anteilen kann ${pkShort(anfrage.von)} den Schlüssel zusammensetzen.`)) return;
  try {
    await sende(await baueAnteilUebergabe({ von: state.signer, anfrage, anteil: z.anteil }), anfrage.von);
    const st = stand();
    st.anfragen = st.anfragen.filter((q) => q.anfrageId !== anfrage.anfrageId);
    await merke(st);
    toast("Anteil versiegelt übergeben");
    void zeigeVertraute();
  } catch (e) {
    toast((e as Error).message, true);
  }
}

/** Anteile zusammensetzen und den Schluessel als Datei geben. */
function setzeZusammen(z: VertrautenZeile): void {
  if (!z.plan) return;
  const st = stand();
  let schluessel: Uint8Array | null = null;
  try {
    schluessel = setzeNachfolgeZusammen([z.anteil, ...(st.erhalten[z.besitzer] ?? [])], z.plan);
    const hex = Array.from(schluessel, (b) => b.toString(16).padStart(2, "0")).join("");
    const text = `Wiederhergestellter Schlüssel von ${z.besitzer}\n\nPrivater Schlüssel (hex):\n${hex}\n\n` +
      "Wer diese Datei hat, IST diese Person im Netz. Sicher aufbewahren und nach dem Import löschen.\n" +
      "Import: die App in einem eigenen Browserprofil öffnen → „Identität importieren“ → den Hex-Schlüssel einfügen.\n";
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `freedom-nachfolge-${z.besitzer.slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Zusammengesetzt und geprüft – der Schlüssel liegt in der Datei");
  } catch (e) {
    toast((e as Error).message, true);
  } finally {
    schluessel?.fill(0);
  }
}
