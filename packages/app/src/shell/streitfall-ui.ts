/**
 * Streitfall in der Oberflaeche (Schritt 5.6b): Pruefer aus dem eigenen Netz,
 * Zustellung an ihn, und die eigenen Reklamationen bis zum Urteil.
 *
 * Das Urteil kommt versiegelt an den Sitzungsschluessel der Reklamation. Die
 * App merkt sich ihn dafuer im Tresor und fragt die Relays nach Umschlaegen an
 * genau diese Schluessel – nie an die Identitaet.
 */
import { LocalSigner, fromHex, type Dispute, type NostrEvent } from "@freedomstack/protocol";
import { t } from "../i18n.js";
import {
  LS_REKLAMATIONEN, type EigeneReklamation, type Pruefer, leseReklamationen, mitReklamation, prueferAusNetz, reklamationText,
} from "../streitfall.js";
import { ensurePool, sprichtFuer, state } from "./state.js";
import { conversations, veroeffentlicheDm } from "./tabs/kommunikation.js";
import { geheim } from "./tresor.js";
import { $, toast } from "./ui.js";
import { abrufTakt } from "./versand.js";

const jetzt = () => Math.floor(Date.now() / 1000);

/** Pruefer aus Kontakten und eigenen Providern – ohne Beteiligte und ohne einen selbst. */
export function netzPruefer(beschuldigt: string): Pruefer[] {
  let eigene: unknown = [];
  try {
    eigene = JSON.parse(localStorage.getItem("freedom.allowlist") ?? "[]");
  } catch { /* keine */ }
  const ich = [state.keypair?.pk, sprichtFuer()].filter((x): x is string => !!x);
  return prueferAusNetz(conversations, Array.isArray(eigene) ? eigene.filter((x): x is string => typeof x === "string") : [], [beschuldigt, ...ich]);
}

/** Umschlag an den Pruefer: Kontakten an ihren Posteingang (NIP-17), eigenen Providern ueber den Pool. */
export async function stelleZu(wrap: NostrEvent, pruefer: Pruefer): Promise<void> {
  if (pruefer.art === "kontakt") await veroeffentlicheDm(wrap, pruefer.pk);
  else await (await ensurePool()).publish(wrap);
}

function reklamationen(): EigeneReklamation[] {
  return leseReklamationen(geheim.getItem(LS_REKLAMATIONEN), jetzt());
}

/** Reklamation mit Sitzungsschluessel merken – nur im Tresor. */
export async function merkeReklamation(r: EigeneReklamation): Promise<void> {
  await geheim.setItem(LS_REKLAMATIONEN, JSON.stringify(mitReklamation(reklamationen(), r)));
  zeigeReklamationen();
}

/** Karte „Deine Reklamationen“ (textContent) – verborgen, solange es keine gibt. */
export function zeigeReklamationen(): void {
  const box = document.querySelector<HTMLElement>("#reklamationen");
  const liste = document.querySelector<HTMLElement>("#reklamationen-liste");
  if (!box || !liste) return;
  const alle = reklamationen();
  box.classList.toggle("hidden", alle.length === 0);
  liste.replaceChildren(...alle.slice().reverse().map((r) => {
    const z = document.createElement("div");
    z.className = r.urteil ? "usage-row" : "usage-row muted";
    z.textContent = t("agent.reklamationZeile", { auftrag: r.jobId.slice(0, 8), sats: Math.floor(r.betragMsat / 1000), text: reklamationText(r) });
    return z;
  }));
}

let laeuft = false;

/**
 * Urteile zu eigenen Reklamationen holen. Es zaehlt nur ein Urteil des
 * genannten Pruefers zu diesem Auftrag (`resolveDispute`); was ankommt, bleibt
 * gemerkt, bis die Reklamation nach 30 Tagen verfaellt.
 */
export async function pruefeUrteile(): Promise<void> {
  const offen = reklamationen().filter((r) => !r.urteil);
  if (offen.length === 0 || laeuft) return;
  laeuft = true;
  try {
    const { KIND_GIFT_WRAP, openPrivateUrteil, resolveDispute } = await import("@freedomstack/protocol");
    const signer = new Map(offen.map((r) => {
      const s = new LocalSigner(fromHex(r.sitzungSk));
      return [s.publicKey(), { s, r }] as const;
    }));
    const seit = Math.min(...offen.map((r) => r.at)) - 60;
    const wraps = await (await ensurePool()).query({ kinds: [KIND_GIFT_WRAP], "#p": [...signer.keys()], since: seit, limit: 200 });
    let neu = 0;
    for (const w of wraps) {
      const ziel = signer.get(w.tags.find((t) => t[0] === "p")?.[1] ?? "");
      if (!ziel || ziel.r.urteil) continue;
      const o = await openPrivateUrteil(w, ziel.s);
      if (!o.ok || o.prueferPk !== ziel.r.pruefer) continue;
      const dispute: Dispute = {
        jobId: ziel.r.jobId, customerPubkey: ziel.s.publicKey(), providerPubkey: ziel.r.providerPk, reason: ziel.r.grund,
        amountMsat: ziel.r.betragMsat, note: "", pruefer: [ziel.r.pruefer], createdAt: ziel.r.at,
      };
      const v = resolveDispute(dispute, true, [{ ...o.urteil, sig: "" }]);
      if (v.resolution === "unentschieden" && o.urteil.tags.find((t) => t[0] === "result")?.[1] !== "unentschieden") continue;
      ziel.r.urteil = { ergebnis: v.resolution, erstattungMsat: v.refundMsat, notiz: o.urteil.content.slice(0, 500), at: o.urteil.created_at };
      neu++;
    }
    if (neu > 0) {
      const alle = reklamationen().map((r) => offen.find((o) => o.jobId === r.jobId && o.urteil) ?? r);
      await geheim.setItem(LS_REKLAMATIONEN, JSON.stringify(alle));
      toast(neu === 1 ? t("agent.einUrteilDa") : t("agent.urteileDa", { n: neu }));
      zeigeReklamationen();
    }
  } catch {
    /* Relays nicht erreichbar: beim naechsten Mal */
  } finally {
    laeuft = false;
  }
}

/** Beim Start: anzeigen, Urteile holen und alle zwei Minuten nachsehen, solange welche offen sind. */
export function starteStreitfall(): void {
  zeigeReklamationen();
  void pruefeUrteile();
  abrufTakt.melde("urteile", pruefeUrteile, 4); // etwa alle zwei Minuten, im Abruftakt (6.4)
  $("#reklamationen-pruefen")?.addEventListener("click", () => void pruefeUrteile());
}
