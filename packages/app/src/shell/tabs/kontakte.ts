/**
 * Kontakte: private Kontaktliste (2.5b), Namen (Petnames) und der Stand der
 * Schlüssel meiner Kontakte (Schlüsselwechsel, 8.6a).
 *
 * Aus tabs/kommunikation.ts verschoben (C-5b) – wörtlich, ohne Logikänderung.
 */
import { type KeyState } from "@freedomstack/protocol";
import { pkShort } from "../../shell-logic.js";
import { ensurePool, frageBeiAutoren, signiere, state } from "../state.js";
import { LS_MANDATE, leseGemerkt, pruefeKontakte, warnt } from "../../schluessel-status.js";
import { geheim } from "../tresor.js";
import { hinweis } from "../dialog.js";
import { $, el, toast } from "../ui.js";
import { t } from "../../i18n.js";
import { schluesselText } from "../../protokoll-texte.js";
import { activeConversation, conversations, loadChatList, loadChatMessages, openConversation, saveConversations } from "./kommunikation.js";

// ------------------------------------------ private Kontaktliste (2.5b)

/** Einstellung „Kontakte verschlüsselt abgleichen“ – Standard aus. */
export const LS_KONTAKTE_SICHERN = "freedom.kontakteSichern";
export function kontakteSichernAn(): boolean {
  return localStorage.getItem(LS_KONTAKTE_SICHERN) === "1";
}

/**
 * Stand der Liste auf den Relays (zuletzt geladen oder gesichert). null = in
 * dieser Sitzung noch nicht geladen – dann wird nicht gesichert, sonst
 * ueberschriebe dieses Geraet die Kontakte der anderen.
 */
let gesicherterStand: string | null = null;

/**
 * Private Kontaktliste (NIP-51) veroeffentlichen, wenn eingeschaltet und die
 * Kontakte sich geaendert haben – nicht bei jeder Nachricht, sonst verriete
 * die Liste, wann jemand schreibt. `leeren` beim Ausschalten: eine leere
 * Liste ersetzt die alte auf den Relays.
 */
export async function sichereKontakte(leeren = false): Promise<void> {
  if (!state.signer || (!leeren && (!kontakteSichernAn() || gesicherterStand === null))) return;
  const kontakte = leeren ? [] : conversations
    .filter((c) => c.type === "dm")
    .map((c) => ({ pk: c.id, name: c.name }))
    .sort((a, b) => a.pk.localeCompare(b.pk));
  const stand = JSON.stringify(kontakte);
  if (stand === gesicherterStand) return;
  const { buildPrivateKontaktliste } = await import("@freedomstack/protocol");
  const ev = await signiere(await buildPrivateKontaktliste(kontakte, state.signer));
  await (await ensurePool()).publish(ev);
  gesicherterStand = stand;
}

/**
 * Abgleich einschalten (2.5b): erst die Liste der anderen Geraete holen und
 * zusammenfuehren, dann gemeinsam sichern. Scheitert das Laden, bleibt der
 * Abgleich aus – sonst ueberschriebe eine leere oder halbe Liste die alte.
 */
export async function kontakteEinschalten(): Promise<number> {
  localStorage.setItem(LS_KONTAKTE_SICHERN, "1");
  try {
    const neu = await ladeKontakte();
    if (neu > 0) {
      saveConversations();
      loadChatList();
    }
    await sichereKontakte();
    return neu;
  } catch (e) {
    localStorage.removeItem(LS_KONTAKTE_SICHERN);
    throw e;
  }
}

/** Eigene Liste laden (2.5b) und unbekannte Kontakte ergaenzen. Gibt die Zahl der neuen zurueck. */
export async function ladeKontakte(): Promise<number> {
  if (!kontakteSichernAn() || !state.signer || !state.keypair) return 0;
  const { KIND_KONTAKTLISTE, D_KONTAKTE, oeffnePrivateKontaktliste } = await import("@freedomstack/protocol");
  const pool = await ensurePool();
  const listen = await pool.query({ kinds: [KIND_KONTAKTLISTE], authors: [state.keypair.pk], "#d": [D_KONTAKTE], limit: 5 });
  const neueste = listen.sort((a, b) => b.created_at - a.created_at)[0];
  if (!neueste) {
    gesicherterStand = "[]";
    return 0;
  }
  const entfernt = await oeffnePrivateKontaktliste(neueste, state.signer);
  // Stand der Relays merken: Nur wenn die lokale Liste davon abweicht, wird neu gesichert.
  gesicherterStand = JSON.stringify([...entfernt].sort((a, b) => a.pk.localeCompare(b.pk)));
  let neu = 0;
  for (const k of entfernt) {
    if (conversations.some((c) => c.id === k.pk)) continue;
    conversations.push({ id: k.pk, type: "dm", name: k.name || pkShort(k.pk), lastTs: 0 });
    neu++;
  }
  return neu;
}

/**
 * Namen aufloesen — mit Herkunft und Verwechslungswarnung.
 *
 * Ein blosser Name ist gefaehrlich: "Max" kann jeder sein. Deshalb traegt die
 * Anzeige die Herkunft mit, und vor einer Verwechslung mit jemandem, den der
 * Nutzer bereits kennt, wird gewarnt — bevor eine Zahlung passiert.
 */
let namenCache: { at: number; events: unknown[] } | null = null;

export async function loeseNamenAuf(pubkeys: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const { resolveName, displayWithSource, checkImpersonation, KIND_PETNAME } =
      await import("@freedomstack/protocol");

    const eigene = new Map<string, string>(
      JSON.parse(localStorage.getItem("freedom.petnames") ?? "[]") as [string, string][],
    );

    const jetzt = Date.now();
    if (!namenCache || jetzt - namenCache.at > 120_000) {
      const pool = await ensurePool();
      namenCache = { at: jetzt, events: await pool.query({ kinds: [KIND_PETNAME], limit: 1000 }) };
    }

    // Nur Namen von eigenen Kontakten zaehlen — sonst koennte jeder eine
    // Namenslawine erzeugen und damit jemanden umbenennen.
    const vertraut = new Set(conversations.filter((c) => c.type === "dm").map((c) => c.id));

    for (const pk of pubkeys) {
      const r = resolveName(pk, namenCache.events as never[], { ownPetnames: eigene, trusted: vertraut });
      const warnung = checkImpersonation(r, eigene);
      out.set(pk, displayWithSource(r) + (warnung ? " \u26A0" : ""));
    }
  } catch { /* ohne Netz bleibt der gekuerzte Schluessel */ }
  return out;
}

/** Einen eigenen Namen vergeben. Gilt nur lokal und ist unentziehbar. */
export function setzePetname(pubkey: string, name: string, teilen = false): void {
  const eigene = new Map<string, string>(
    JSON.parse(localStorage.getItem("freedom.petnames") ?? "[]") as [string, string][],
  );
  if (name.trim()) eigene.set(pubkey, name.trim());
  else eigene.delete(pubkey);
  localStorage.setItem("freedom.petnames", JSON.stringify([...eigene]));
  namenCache = null;

  // Teilen ist ausdruecklich freiwillig: Ein veroeffentlichter Name verraet,
  // dass ich diese Person kenne — und wie ich sie nenne. Ohne Teilen nuetzt
  // die Namensschicht aber nur mir selbst.
  if (teilen && name.trim() && state.keypair) {
    void (async () => {
      try {
        const { buildPetname } = await import("@freedomstack/protocol");
        await (await ensurePool()).publish(await signiere(buildPetname({
          byPubkey: state.keypair!.pk, forPubkey: pubkey, name: name.trim(),
        })));
      } catch { /* lokal gilt der Name trotzdem */ }
    })();
  }
}

// ------------------------------------------------ Schluesselwechsel (8.6a)

/** Stand der Schluessel meiner Kontakte (gueltig, abgeloest, widerrufen, streitig). */
export let schluesselStand = new Map<string, KeyState>();

/** Mandate und Widerrufe der Kontakte laden, erste Mandate merken, Ansicht auffrischen. */
export async function aktualisiereSchluessel(): Promise<void> {
  const kontakte = conversations.filter((c) => c.type === "dm").map((c) => c.id).filter((id) => /^[0-9a-f]{64}$/.test(id));
  if (kontakte.length === 0) return;
  const pool = await ensurePool();
  const { KIND_ROTATION_MANDATE, KIND_KEY_REVOCATION } = await import("@freedomstack/protocol");
  const [mandate, widerrufe] = await Promise.all([
    // Mandate schreiben die Kontakte selbst – auch an ihren Schreib-Relays lesen (5.4b)
    frageBeiAutoren({ kinds: [KIND_ROTATION_MANDATE], authors: kontakte, limit: 200 }),
    pool.query({ kinds: [KIND_KEY_REVOCATION], "#p": kontakte, limit: 200 }),
  ]);
  const gemerkt = leseGemerkt(geheim.getItem(LS_MANDATE));
  // Zeitanker (B-17b3b): nur bei Streit um einen Nachfolger die Beweise gegen Bitcoin prüfen
  const { ankerFuerStreit } = await import("../zeitanker-takt.js");
  const anker = await ankerFuerStreit(pool, mandate, gemerkt).catch(() => new Map<string, number>());
  const r = pruefeKontakte(kontakte, [...mandate, ...widerrufe], gemerkt, undefined, anker);
  if (r.geaendert) await geheim.setItem(LS_MANDATE, JSON.stringify(r.gemerkt)).catch(() => undefined);
  const vorher = JSON.stringify([...schluesselStand].map(([k, v]) => [k, v.status, v.currentPubkey]));
  schluesselStand = r.stand;
  if (JSON.stringify([...schluesselStand].map(([k, v]) => [k, v.status, v.currentPubkey])) === vorher) return;
  loadChatList();
  if (activeConversation && schluesselStand.has(activeConversation)) void loadChatMessages(activeConversation);
}

/** ⚠ vor Kontakten, deren Schluessel nicht mehr (unstreitig) gilt – per textContent. */
export function markiereSchluessel(list: HTMLElement): void {
  for (const [pk, st] of schluesselStand) {
    if (!warnt(st)) continue;
    const el = list.querySelector<HTMLElement>(`[data-cid="${CSS.escape(pk)}"]`);
    const lbl = el?.querySelector<HTMLElement>(".label");
    if (!el || !lbl || el.querySelector(".schluessel-warnung")) continue;
    el.title = schluesselText(st);
    // Eigenes Element: die Namensaufloesung ueberschreibt spaeter den Text des Labels
    const w = document.createElement("span");
    w.className = "schluessel-warnung warn";
    w.textContent = "⚠";
    lbl.before(w);
  }
}

/** Hinweis ueber dem Verlauf: Stand des Schluessels, auf Wunsch zum Nachfolger wechseln. */
export function schluesselHinweis(thread: HTMLElement, partner: string): void {
  const st = schluesselStand.get(partner);
  if (!warnt(st)) return;
  const box = document.createElement("div");
  box.className = "bubble ai schluessel-hinweis";
  const text = document.createElement("div");
  text.className = "txt mono-sm warn";
  text.textContent = `⚠ ${schluesselText(st!)}`;
  box.append(text);
  if ((st!.status === "widerrufen" || st!.status === "abgeloest") && st!.currentPubkey !== partner) {
    const b = document.createElement("button");
    b.className = "ghost";
    b.id = "schluessel-wechsel";
    b.style.cssText = "width:auto;padding:3px 8px;margin-top:6px";
    b.textContent = t("komm.neuerSchluessel", { pk: pkShort(st!.currentPubkey) });
    b.addEventListener("click", () => wechsleZuNeuemSchluessel(partner, st!.currentPubkey));
    box.append(b);
  }
  thread.prepend(box);
}

/** Markierung einer abgelösten Unterhaltung – steht im gespeicherten Namen, daher in beiden Sprachen erkannt. */
const ALT_MARKE = /^\((alter Schlüssel|old key)\) /;

/** Die Unterhaltung mit dem Nachfolger weiterfuehren; die alte bleibt markiert stehen. */
function wechsleZuNeuemSchluessel(alt: string, neu: string): void {
  if (!/^[0-9a-f]{64}$/.test(neu)) return;
  const c = conversations.find((x) => x.id === alt);
  if (!conversations.some((x) => x.id === neu)) {
    conversations.push({ id: neu, type: "dm", name: c?.name.replace(ALT_MARKE, "") ?? pkShort(neu), lastTs: Math.floor(Date.now() / 1000), ...(c?.ablaufSecs ? { ablaufSecs: c.ablaufSecs } : {}) });
  }
  if (c && !ALT_MARKE.test(c.name)) c.name = t("komm.alterSchluessel", { name: c.name });
  saveConversations();
  toast(t("komm.weiterNeuerSchluessel", { pk: pkShort(neu) }));
  openConversation(neu);
}
