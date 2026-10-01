/**
 * Tab Kommunikation: Direktnachrichten (NIP-17), Communities, Anhänge (inline,
 * Blob-Netz, Blossom). Die Räume mit Kanälen und Moderation stehen seit
 * Schritt C.2a in raeume.ts.
 *
 * Aus app.ts verschoben (Schritt 1.0) – wörtlich, ohne Logikänderung.
 */
import { type DateiSchluessel, type KeyState, NostrEvent, type PrivateDm, buildEvent } from "@freedomstack/protocol";
import {
  type ChatAttachment,
  anhangAnsicht,
  parseDmBody,
  parseImetaTags,
  pkShort,
  imetaSchluessel,
  schluesselAusEingabe,
} from "../../shell-logic.js";
import { aktuellerKurs } from "../marktkurs.js";
import { alsGeraet, eigeneRelayListen, ensurePool, frageBeiAutoren, posteingangVon, signiere, solRpcUrl, solTransaktion, sprichtFuer, state, veroeffentlicheAn } from "../state.js";
import { alsNachfolge } from "../nachfolge-ui.js";
import { alsPruefauftrag } from "../pruefauftraege-ui.js";
import { LS_MANDATE, leseGemerkt, nachDiebstahl, pruefeKontakte, warnt } from "../../schluessel-status.js";
import { type DmZuordnung, GeraeteBuch, ordneDmZu } from "../../geraete-buch.js";
import { sucheAufnehmen, wireSuche } from "../suche-ui.js";
import { mlsAbgleichen, mlsBeiNeuem, mlsEinladungAnnehmen, mlsErreichbar, mlsGesperrt, mlsSendeAn, mlsVerlauf } from "../mls-konto.js";
import { alsRaumMeldung, merkePrivatenRaum } from "../raum-mls.js";
import { alsRufZusammenfassung } from "../ruf.js";
import { geheim } from "../tresor.js";
import { dialog, hinweis } from "../dialog.js";
import { $, el, toast } from "../ui.js";
import { pruefStand } from "../kontakt-pruefen-ui.js";
import { t } from "../../i18n.js";
import { versendeVerzoegert } from "../versand.js";
import { kontaktName, zeigeRaumLeiste } from "./raeume.js";
import { fehlerText, schluesselText } from "../../protokoll-texte.js";
import { leseAnforderung, type Anforderung } from "../../zahlungs-anforderung.js";

/** Zahlungsanforderungen der gezeigten Nachrichten (A-5): Id → Anforderung und Absender. */
const anforderungen = new Map<string, { anf: Anforderung; von: string }>();

/** Anhang: kleine Dateien inline als data-url, grosse ueber das Blob-Netz. */
// Darstellungslogik liegt in shell-logic.ts — dort ohne DOM und deshalb
// tatsaechlich testbar (29 Tests, Schwerpunkt feindliche Relay-Eingaben).
let chatAttachments: ChatAttachment[] = [];
/** Blossom-Server fuer grosse Dateien (BUD-01/02, Nostr-Standard fuer Blobs).
 *  Selbst hostbar — jede Community kann eigenen Storage betreiben. */
const BLOSSOM_SERVERS = [
  "https://blossom.primal.net",
  "https://nostr.build",
];

async function uploadToBlossom(file: File): Promise<string> {
  for (const server of BLOSSOM_SERVERS) {
    try {
      const res = await fetch(`${server}/upload`, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.url || data.sha256) return data.url ?? `${server}/${data.sha256}`;
    } catch { /* naechster server */ }
  }
  throw new Error(t("komm.keinBlossom"));
}

/**
 * Groesste Datei, die inline als data-URL in der Nachricht reist. Eine DM ist
 * nach NIP-44 hoechstens 65.535 Byte lang; Base64 macht ein Drittel mehr. Bis
 * 2.4 lag die Grenze bei 80 KB – DMs mit Anhaengen ab etwa 48 KB scheiterten.
 */
const INLINE_MAX_BYTES = 32_000;

export async function handleChatFiles(files: FileList | null): Promise<void> {
  if (!files || files.length === 0) return;
  const listEl = $("#chat-attach-list");
  for (const file of Array.from(files)) {
    try {
      let url: string;
      let enc: DateiSchluessel | undefined;
      if (file.size <= INLINE_MAX_BYTES) {
        // klein: inline als data-url – in DMs mit der Nachricht verschluesselt
        url = await new Promise<string>((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result as string);
          r.onerror = rej;
          r.readAsDataURL(file);
        });
      } else {
        // gross (2.4): nur verschluesselt hinaus – Blob-Netz, Blossom als Ausweg.
        // Schluessel, Name und Typ reisen nur in der Nachricht.
        setAttachStatus(listEl, t("komm.verschluessele", { name: file.name }));
        try {
          const { uploadAnhang } = await import("../../blob-client.js");
          const pool = await ensurePool();
          const res = await uploadAnhang(file, pool as never, state.signer!);
          url = `freedom-blob:${res.blobId}`;
          enc = res.schluessel;
        } catch {
          setAttachStatus(listEl, t("komm.blossomAusweg", { name: file.name }));
          const { verschluesseleDatei } = await import("@freedomstack/protocol");
          const { chiffrat, schluessel } = verschluesseleDatei(new Uint8Array(await file.arrayBuffer()));
          url = await uploadToBlossom(new File([chiffrat as BlobPart], "", { type: "application/octet-stream" }));
          enc = schluessel;
        }
      }
      chatAttachments.push({ name: file.name, mime: file.type || "application/octet-stream", size: file.size, url, ...(enc ? { enc } : {}) });
      setAttachStatus(listEl, chatAttachments.map((a) => `${a.name} (${Math.round(a.size / 1024)}kb)`).join(", "));
    } catch (e) {
      toast(`${file.name}: ${fehlerText(e)}`, true);
    }
  }
}

function setAttachStatus(el: HTMLElement | null, text: string): void {
  if (el) el.textContent = text;
}


/** Anhang als Element (C-6c): aus `anhangAnsicht()`, nur Eigenschaften, `dataset` und Text. */
function anhangElement(a: ChatAttachment): HTMLElement {
  const v = anhangAnsicht(a);
  switch (v.art) {
    case "hinweis": return el("div", v.text, "mono-sm");
    case "knopf": {
      const b = el("button", v.text, "ghost copy-btn chat-blob-btn");
      Object.assign(b.dataset, v.daten);
      return b;
    }
    case "bild": {
      const img = el("img", undefined, "chat-media");
      img.src = v.url;
      img.loading = "lazy";
      img.alt = v.name;
      return img;
    }
    case "video":
    case "audio": {
      const m = el(v.art, undefined, v.art === "video" ? "chat-media" : undefined);
      m.src = v.url;
      m.controls = true;
      m.preload = "metadata";
      return m;
    }
    case "link": {
      const l = el("a", v.text, "mono-sm");
      l.href = v.url;
      l.target = "_blank";
      l.relList.add("noopener", "noreferrer");
      return l;
    }
  }
}

/** Blob-Buttons aktivieren: Chunks aus dem Netz holen und als Download geben. */
function wireBlobButtons(root: HTMLElement): void {
  root.querySelectorAll(".chat-blob-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const el = btn as HTMLElement;
      const oldText = el.textContent ?? "";
      el.textContent = t("komm.lade");
      try {
        const { downloadBlob, oeffneAnhang } = await import("../../blob-client.js");
        const pool = await ensurePool();
        const d = el.dataset;
        let datei: { bytes: Uint8Array; mime: string; name: string };
        if (d.key) {
          // Verschluesselt (2.4): Chiffrat holen, mit dem Schluessel aus der Nachricht oeffnen.
          let chiffrat: Uint8Array;
          if (d.blob) {
            const res = await downloadBlob(d.blob, pool as never);
            if (!res) throw new Error(t("komm.zuWenigStuecke"));
            chiffrat = res.bytes;
          } else {
            const r = await fetch(d.url!);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            chiffrat = new Uint8Array(await r.arrayBuffer());
          }
          const schluessel = { alg: "aes-gcm" as const, key: d.key, nonce: d.nonce ?? "", ox: d.ox ?? "" };
          datei = { bytes: await oeffneAnhang(chiffrat, schluessel), mime: d.mime || "application/octet-stream", name: d.name || "datei" };
        } else {
          const res = await downloadBlob(d.blob!, pool as never);
          if (!res) throw new Error(t("komm.zuWenigStuecke"));
          datei = { bytes: res.bytes, mime: res.mime, name: res.name || d.name || "datei" };
        }
        const url = URL.createObjectURL(new Blob([datei.bytes as BlobPart], { type: datei.mime }));
        const a = document.createElement("a");
        a.href = url;
        a.download = datei.name;
        a.click();
        URL.revokeObjectURL(url);
        el.textContent = oldText;
      } catch (e) {
        toast(t("komm.anhangFehler", { fehler: fehlerText(e) }), true);
        el.textContent = oldText;
      }
    });
  });
  root.querySelectorAll<HTMLElement>(".anf-zahlen-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const z = anforderungen.get(btn.dataset.id ?? "");
      if (!z) return;
      const { bezahleAnforderung } = await import("../anforderung-ui.js");
      await bezahleAnforderung(z.anf, z.von, pkShort(z.von));
    });
  });
  root.querySelectorAll(".zap-msg-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const el = btn as HTMLElement;
      const { openZapDialog } = await import("../../chat-zap.js");
      openZapDialog(el.dataset.pk!, el.dataset.name!);
    });
  });
}

/** Kommunikation: zwischen Direktnachrichten und einem Raum umschalten. */
export function setzeKommModus(modus: "dm" | "space"): void {
  const layout = document.querySelector<HTMLElement>(".comm-layout");
  if (layout) layout.dataset.commMode = modus;
  document.getElementById("comm-dm-btn")?.setAttribute("aria-current", String(modus === "dm"));
  layout?.classList.remove("thread-open");
  if (modus === "dm") {
    document.querySelectorAll("#space-rail .space-pill").forEach((p) => p.setAttribute("aria-current", "false"));
    loadChatList();
    // Der Raum steht nicht mehr vor Augen – sein Ungelesenes als Punkt in der Leiste (C-13a)
    void zeigeRaumLeiste();
  }
}

export function wireKommunikation(): void {
  document.getElementById("comm-dm-btn")?.addEventListener("click", () => setzeKommModus("dm"));
  // MLS (2.2b-d1): nach der Wartezeit zugestellte Nachrichten zeigen
  mlsBeiNeuem((gruppe) => {
    const c = conversations.find((x) => x.mls === gruppe);
    if (c && activeConversation === c.id) void loadChatMessages(c.id);
  });
  // Die Leistenknoepfe loesen die vorhandenen Aktionen aus — keine zweite Logik.
  // Mobil: eine Ebene zur Zeit, wie Discord — Liste, oder nach dem Antippen der Chat.
  const layout = document.querySelector<HTMLElement>(".comm-layout");
  document.getElementById("chat-list")?.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".chat-item")) layout?.classList.add("thread-open");
  });
  document.getElementById("chat-back")?.addEventListener("click", () =>
    layout?.classList.remove("thread-open"));
  // Lokale Suche (8.13): ein Treffer oeffnet seine Unterhaltung
  wireSuche((cid) => {
    openConversation(cid);
    layout?.classList.add("thread-open");
  }, (cid) => conversations.find((c) => c.id === cid)?.name ?? pkShort(cid));
  document.getElementById("rail-create")?.addEventListener("click", () =>
    document.getElementById("space-create")?.click());
  document.getElementById("rail-join")?.addEventListener("click", () =>
    document.getElementById("space-join")?.click());
  // Ein Raum aus der Leiste: in den Raum-Modus wechseln. Die Leiste wird neu
  // gezeichnet, deshalb am Container horchen statt an jedem Knopf.
  document.getElementById("space-rail")?.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".space-pill")) setzeKommModus("space");
  });
}

// ------------------------------------------------------------- Chat-Tab (v0.2)
// KEIN oeffentlicher Feed (illegaler Content waere unlosbar + sichtbar fuer alle).
// Stattdessen: 1:1-DMs (verschluesselt, NIP-04-artig) + Communities (opt-in Gruppen,
// Discord-Stil). Beides adressierbar, kein globaler oeffentlicher Stream.

interface ChatConversation {
  id: string;             // dm: pubkey des Partners; community: community-id
  type: "dm" | "community";
  name: string;
  lastTs: number;
  /** Ablauf nach NIP-40 fuer neue Nachrichten (Schritt 2.5), nur DMs; fehlt = aus. */
  ablaufSecs?: number;
  /** MLS-Gruppe dieser 1:1-Unterhaltung (2.2b-d1), wenn der Kontakt eingeladen hat. */
  mls?: string;
}

export let conversations: ChatConversation[] = [];
export let activeConversation: string | null = null;

function loadConversations(): void {
  try {
    conversations = JSON.parse(geheim.getItem("freedom.chats") ?? "[]");
  } catch { conversations = []; }
}

function saveConversations(): void {
  void geheim.setItem("freedom.chats", JSON.stringify(conversations))
    .catch((e) => toast(t("komm.nichtGespeichert", { grund: fehlerText(e) }), true));
  void sichereKontakte().catch(() => { /* offline – beim naechsten Speichern */ });
}

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

async function loeseNamenAuf(pubkeys: string[]): Promise<Map<string, string>> {
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
function setzePetname(pubkey: string, name: string, teilen = false): void {
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

export function loadChatList(): void {
  void syncDmInbox();
  loadConversations();
  const list = $("#chat-list");
  // Nur Direktnachrichten – Communities stehen seit C-10 in der Raum-Leiste
  const dms = conversations.filter((c) => c.type === "dm");
  if (dms.length === 0) {
    const leer = el("div", t("komm.keineUnterhaltungen"), "mono-sm");
    leer.style.cssText = "padding:10px;color:var(--text-muted)";
    list.replaceChildren(leer);
    return;
  }
  // Namen kommen aus Profilen und Petnames – nur als Text (C-6c)
  list.replaceChildren(...dms
    .sort((a, b) => b.lastTs - a.lastTs)
    .map((c) => {
      const zeile = el("div", undefined, c.id === activeConversation ? "chat-item active" : "chat-item");
      zeile.dataset.cid = c.id;
      zeile.append(el("span", c.type === "community" ? "🏠" : c.name.slice(0, 1).toUpperCase(), "av"), el("span", c.name, "label"));
      return zeile;
    }));
  markiereSchluessel(list);
  list.querySelectorAll(".chat-item").forEach((el) => {
    el.addEventListener("click", () => openConversation((el as HTMLElement).dataset.cid!));
    // Rechtsklick vergibt einen eigenen Namen. Er gilt nur lokal und kann
    // niemandem genommen werden — das ist die einzige Namensform, die ohne
    // Namensbehoerde eindeutig ist.
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const cid = (el as HTMLElement).dataset.cid!;
      const c = conversations.find((x) => x.id === cid);
      if (!c || c.type !== "dm") return;
      void benenneKontakt(c);
    });
  });

  // Namen im Hintergrund aufloesen und nachtragen — die Liste soll nicht
  // auf das Netz warten.
  void loeseNamenAuf(conversations.filter((c) => c.type === "dm").map((c) => c.id))
    .then((namen: Map<string, string>) => {
      for (const [pk, anzeige] of namen) {
        const el = list.querySelector(`[data-cid="${CSS.escape(pk)}"] .label`);
        if (el) el.textContent = anzeige;
      }
    });
}

function openConversation(cid: string): void {
  activeConversation = cid;
  loadChatList();
  const c = conversations.find((x) => x.id === cid);
  const thread = $("#chat-thread");
  const leer = el("div", undefined, "empty-state");
  leer.append(c ? c.name : "", document.createElement("br"), c?.type === "dm" ? dmHinweis(c) : t("komm.community"));
  if (c?.type === "dm") leer.append(document.createElement("br"), el("span", pruefStand(c.id), "pruef-stand"));
  thread.replaceChildren(leer);
  zeigeAblauf(c);
  loadChatMessages(cid);
  // Erst hier wird MLS gebraucht (2.2b-d1): eigenes KeyPackage, wenn keins da oder faellig
  if (c?.type === "dm") void mlsErreichbar().catch(() => undefined);
}

/** Wie diese 1:1-Unterhaltung verschluesselt ist (2.2b-d2) – feste Texte. */
/**
 * Eigener Name für einen Kontakt – ein Dialog statt prompt() und confirm()
 * (C-1b). Veröffentlicht wird nur mit Häkchen; ohne gilt er nur hier.
 */
async function benenneKontakt(c: ChatConversation): Promise<void> {
  const w = await dialog({
    titel: t("komm.nameTitel"),
    felder: [
      // Vorbelegt nur ein echter Name, nicht der gekürzte Schlüssel aus newDm()
      { art: "text", name: "name", label: t("komm.eigenerName", { pk: pkShort(c.id) }), wert: [c.id.slice(0, 12) + "…", pkShort(c.id)].includes(c.name) ? "" : c.name },
      { art: "mehrfach", name: "teilen", label: t("komm.nameSichtbar"), optionen: [
        { wert: "ja", text: t("komm.nameVeroeffentlichen"), hinweis: t("komm.nameVeroeffentlichenHinweis") },
      ] },
    ],
    ok: t("komm.nameSpeichern"),
  });
  if (!w) return;
  const name = String(w.name);
  const teilen = !!name.trim() && Array.isArray(w.teilen) && w.teilen.includes("ja");
  setzePetname(c.id, name, teilen);
  c.name = name.trim() || pkShort(c.id);
  saveConversations();
  loadChatList();
}

function dmHinweis(c: ChatConversation): string {
  const nip17 = t("komm.nip17");
  if (c.ablaufSecs) return `${nip17} ${t("komm.mitAblauf")}`;
  const gesperrt = mlsGesperrt();
  if (gesperrt) return `${nip17} ${t("komm.mlsNicht", { grund: gesperrt })}${c.mls ? ` ${t("komm.mlsNichtLesen")}` : ""}`;
  return c.mls ? t("komm.mlsAn") : `${nip17} ${t("komm.mlsKoennen")}`;
}

/** Ablauf-Auswahl (2.5): nur bei DMs, zeigt den Wert der Unterhaltung. */
function zeigeAblauf(c: ChatConversation | undefined): void {
  const sel = document.getElementById("chat-ablauf") as HTMLSelectElement | null;
  if (!sel) return;
  sel.hidden = c?.type !== "dm";
  sel.value = String(c?.ablaufSecs ?? "");
}

/** Ablauf fuer neue Nachrichten dieser Unterhaltung setzen (2.5). */
export function setzeAblauf(wert: string): void {
  const c = conversations.find((x) => x.id === activeConversation);
  if (!c || c.type !== "dm") return;
  const secs = Number(wert);
  if (Number.isSafeInteger(secs) && secs > 0) c.ablaufSecs = secs;
  else delete c.ablaufSecs;
  saveConversations();
  toast(t(c.ablaufSecs ? "komm.ablaufAn" : "komm.ablaufAusToast"));
}

/**
 * Moderationsstand einer Community laden.
 *
 * Ohne Netz gibt es keine Moderation — dann wird alles gezeigt statt gar
 * nichts. Ein Client, der bei Verbindungsproblemen stumm bleibt, sieht fuer
 * den Nutzer aus wie eine leere Community.
 */
async function ladeModeration(communityId: string): Promise<unknown | null> {
  try {
    const { buildModerationState, KIND_COMMUNITY_MODERATORS, KIND_MODERATION_HIDE, KIND_MODERATION_BAN } =
      await import("@freedomstack/protocol");
    const pool = await ensurePool();
    const evs = await pool.query({
      kinds: [KIND_COMMUNITY_MODERATORS, KIND_MODERATION_HIDE, KIND_MODERATION_BAN],
      "#h": [communityId],
      limit: 500,
    });
    return evs.length > 0 ? buildModerationState(communityId, evs) : null;
  } catch {
    return null;
  }
}

/** Eine DM zur Anzeige: entschluesselt; legacy = altes Kind-4-Format. */
type DmAnzeige = NostrEvent & {
  legacy?: boolean; /** Ablauf nach NIP-40 (2.5) – auch fuer den Suchindex (8.13). */ ablauf?: number;
  /** Gesendet, aber die Kopien warten noch (6.4) – nur auf diesem Geraet, bis die eigene Kopie zurueck ist. */ wartet?: boolean;
  /** Geschrieben von einem Geraet (8.6b): Hinweis mit Geraetenamen (Fremddaten). */ geraet?: { text: string; warnung: boolean };
  /** Ueber MLS empfangen (2.2b-d1) – aus dem Verlauf auf diesem Geraet. */ mls?: boolean;
};

/** Vollmachten der Geraete – eigene und die der Kontakte (8.6b). */
// Vollmachten einer Person auch an ihren Schreib-Relays (5.4b); „wer hat dieses Gerät“ (#p) im Pool
export const geraeteBuch = new GeraeteBuch(async (f) =>
  Array.isArray(f.authors) ? frageBeiAutoren(f as { authors: string[] }) : (await ensurePool()).query(f as never));

/** Bereits geoeffnete Umschlaege (ID des Umschlags -> Ergebnis), damit nichts doppelt entschluesselt wird. */
const dmCache = new Map<string, { partner: string; ev: DmAnzeige; dm: PrivateDm } | null>();

async function oeffneUmschlag(w: NostrEvent): Promise<{ partner: string; ev: DmAnzeige; dm: PrivateDm } | null> {
  const bekannt = dmCache.get(w.id);
  if (bekannt !== undefined) return bekannt;
  if (!state.signer) return null;
  const { openPrivateDm } = await import("@freedomstack/protocol");
  const selbst = state.signer.publicKey();
  const ich = sprichtFuer() ?? selbst;
  // Ueber den Signer (Schritt 1.3): Umschlag und Siegel entschluesselt er selbst.
  // Seit 8.6b auch Kopien, die eigene Geraete geschrieben haben; als Geraet (8.6c) fuer die Person.
  const r = await openPrivateDm(w, state.signer, undefined, { auchFuer: [ich, ...(await geraeteBuch.alle(ich).catch(() => []))] });
  const z = r.ok
    ? await ordneDmZu(r.dm, ich, geraeteBuch, (pk) => conversations.some((c) => c.type === "dm" && c.id === pk), selbst)
      .catch((): DmZuordnung => ({ partner: r.dm.partner, autor: r.dm.from, vonMir: r.dm.from === ich }))
    : null;
  const e = r.ok && z
    ? {
        partner: z.partner,
        ev: {
          // Eigene Geraete zeigen als „du“, gueltige Geraete eines Kontakts unter dessen Schluessel
          id: r.dm.id, pubkey: z.autor, created_at: r.dm.createdAt, kind: 14, tags: [], content: r.dm.content, sig: "",
          ...(r.dm.expiresAt !== undefined ? { ablauf: r.dm.expiresAt } : {}),
          ...(z.hinweis ? { geraet: { text: z.hinweis, warnung: !!z.warnung } } : {}),
        },
        // Mit Ablauf (2.5): ladeDmNachrichten() blendet danach aus.
        dm: r.dm,
      }
    // Keine DM: vielleicht ein SOL-Trinkgeld-Beleg (4.7b), eine Adress-Anfrage (4.9d), Nachfolge (8.11b), ein Pruefauftrag (5.6c),
    // eine Raum-Meldung (8.5), die Zusammenfassung eines Kontakts ueber Provider (5.5c) oder eine Rechnungs-Anfrage (6.3b).
    : (await alsTrinkgeld(w)) ?? (await alsAdressAnfrage(w)) ?? (await alsNachfolge(w)) ?? (await alsPruefauftrag(w)) ?? (await alsRaumMeldung(w)) ?? (await alsRufZusammenfassung(w)) ?? (await alsRechnungsAnfrage(w));
  dmCache.set(w.id, e);
  return e;
}

/**
 * SOL-Trinkgeld-Beleg im Umschlag (Schritt 4.7b): erscheint in der
 * Unterhaltung, zuerst „wird geprueft …“; die Pruefung gegen die Kette laeuft
 * im Hintergrund und zeichnet die offene Unterhaltung danach neu.
 */
async function alsTrinkgeld(w: NostrEvent): Promise<{ partner: string; ev: DmAnzeige; dm: PrivateDm } | null> {
  const { oeffnePrivatesSolTrinkgeld } = await import("@freedomstack/protocol");
  const t = await oeffnePrivatesSolTrinkgeld(w, state.signer!);
  if (!t) return null;
  const { pruefeTrinkgeld, trinkgeldText } = await import("../../trinkgeld-beleg.js");
  const partner = t.absender === state.signer!.publicKey() ? t.empfaenger : t.absender;
  // Beide Kopien (Empfaenger und eigene) tragen dieselbe Signatur: eine Zeile.
  const ev: DmAnzeige = { id: `sol-trinkgeld:${t.signatur}`, pubkey: t.absender, created_at: t.zeit, kind: 9736, tags: [], content: trinkgeldText(t, undefined, aktuellerKurs()), sig: "" };
  void (async () => {
    const { ketteAusRpc } = await import("../../wallet-standard.js");
    const p = await pruefeTrinkgeld(t, ketteAusRpc(await solRpcUrl()), solTransaktion);
    ev.content = trinkgeldText(t, p, aktuellerKurs());
    if (activeConversation === partner) void loadChatMessages(partner);
  })();
  return { partner, ev, dm: { id: ev.id, from: t.absender, partner, createdAt: t.zeit, content: ev.content } };
}

/**
 * Adress-Anfrage fuer ein SOL-Trinkgeld (4.9d): beantworten, wenn sie von einem
 * bekannten Kontakt kommt – mit dessen eigener Adresse aus der eingebauten
 * Wallet. In der Unterhaltung erscheint nichts.
 */
async function alsAdressAnfrage(w: NostrEvent): Promise<null> {
  const [{ beantworteAdressAnfrage }, { frischeEmpfangsadresse }, { ketteAusRpc }] = await Promise.all([
    import("../../trinkgeld-adresse.js"), import("../eingebaute-wallet.js"), import("../../wallet-standard.js"),
  ]);
  await beantworteAdressAnfrage({
    wrap: w, signer: state.signer!, speicher: geheim,
    istKontakt: (pk) => conversations.some((c) => c.type === "dm" && c.id === pk),
    frischeAdresse: frischeEmpfangsadresse,
    kette: ketteAusRpc(await solRpcUrl()),
    sende: veroeffentlicheDm,
  }).catch(() => false);
  return null;
}

/** Bremse fuer Rechnungs-Anfragen (6.3b) – nur im Speicher. */
let rechnungsBremse: import("../../ln-rechnung-anfrage.js").RechnungsBremse | undefined;

/**
 * Rechnungs-Anfrage (6.3b): Ein Kontakt will zahlen, und die eigene
 * Lightning-Adresse steht nicht im Profil – beantworten mit einer Rechnung der
 * eigenen Wallet (NWC), versiegelt. In der Unterhaltung erscheint nichts.
 */
async function alsRechnungsAnfrage(w: NostrEvent): Promise<null> {
  const [{ RechnungsBremse, beantworteRechnungsAnfrage }, { eigeneRechnung }] = await Promise.all([
    import("../../ln-rechnung-anfrage.js"), import("../zahlschienen.js"),
  ]);
  rechnungsBremse ??= new RechnungsBremse();
  await beantworteRechnungsAnfrage({
    wrap: w, signer: state.signer!, bremse: rechnungsBremse,
    istKontakt: (pk) => conversations.some((c) => c.type === "dm" && c.id === pk),
    stelleAus: eigeneRechnung,
    sende: veroeffentlicheDm,
  }).catch(() => false);
  return null;
}

/** Umschlaege, die schon auf eine MLS-Einladung geprueft wurden (je Sitzung einmal). */
const mlsGeprueft = new Set<string>();

/**
 * MLS-Einladung (2.2b-d1) in einem Umschlag, der keine DM ist. Eine
 * 1:1-Gruppe gehoert dann zur Unterhaltung mit dem Partner – der Person,
 * der mit ihren Geraeten alle anderen Mitglieder gehoeren (2.2b-e2; eine
 * neuere ersetzt die alte); von Fremden wird sie – wie eine NIP-17-Nachricht
 * von ihnen – zur „Anfrage“ (seit d2, sonst ginge ihre erste Nachricht
 * verloren). In der Unterhaltung selbst erscheint nichts.
 */
async function alsMlsEinladung(w: NostrEvent): Promise<null> {
  if (mlsGesperrt() || mlsGeprueft.has(w.id)) return null;
  mlsGeprueft.add(w.id);
  const { oeffneEinladung } = await import("../../mls-nostr.js");
  const e = await oeffneEinladung(w, state.signer!).catch(() => null);
  if (!e || e.von === state.keypair?.pk) return null;
  const r = await mlsEinladungAnnehmen(e).catch(() => null);
  if (!r) return null;
  if (!r.partner) {
    // Eine Gruppe zu mehreren: ein privater Raum (2.3b)
    await merkePrivatenRaum(r.gruppe);
    void zeigeRaumLeiste();
    toast(t("komm.einladungRaum", { name: kontaktName(e.von) }));
    return null;
  }
  let c = conversations.find((x) => x.type === "dm" && x.id === r.partner);
  if (!c) {
    c = { id: r.partner, type: "dm", name: t("komm.anfrage", { pk: pkShort(r.partner) }), lastTs: Math.floor(Date.now() / 1000) };
    conversations.push(c);
  }
  c.mls = r.gruppe;
  saveConversations();
  loadChatList();
  return null;
}

/**
 * Alle Nachrichten einer 1:1-Unterhaltung: NIP-17-Umschlaege an mich (auch
 * meine eigenen Kopien) plus aeltere Kind-4-Nachrichten, die weiter lesbar
 * bleiben, aber nie mehr gesendet werden.
 */
const entschluesselungFehlgeschlagen = () => t("komm.entschluesselungFehlgeschlagen");

async function ladeDmNachrichten(partner: string): Promise<DmAnzeige[]> {
  if (!state.keypair) return [];
  const me = state.keypair;
  const pool = await ensurePool();
  const [umschlaege, alt] = await Promise.all([
    pool.query({ kinds: [1059], "#p": [me.pk], limit: 500 }),
    pool.query({ kinds: [4], authors: [me.pk, partner], limit: 50 }),
  ]);
  const ergebnis = new Map<string, DmAnzeige>();
  const { dmAbgelaufen } = await import("@freedomstack/protocol");
  for (const w of umschlaege) {
    const e = await oeffneUmschlag(w);
    // Abgelaufene Nachrichten (NIP-40) zeigt die App nicht mehr – auch wenn ein Relay sie noch hat.
    if (e && e.partner === partner && !dmAbgelaufen(e.dm)) ergebnis.set(e.ev.id, e.ev);
  }
  // MLS (2.2b-d1): aus dem Verlauf auf diesem Geraet – nur von uns beiden. Seit
  // 2.2b-e2 auch von Geraeten: zugeordnet wie NIP-17-Kopien (Vollmacht, Entzug)
  const gruppe = conversations.find((c) => c.type === "dm" && c.id === partner)?.mls;
  const ich = sprichtFuer() ?? me.pk;
  const istKontakt = (pk: string) => conversations.some((c) => c.type === "dm" && c.id === pk);
  for (const n of gruppe ? await mlsVerlauf(gruppe).catch(() => []) : []) {
    const dm = { id: n.id, from: n.von, partner, createdAt: n.zeit, content: n.text };
    const z = await ordneDmZu(dm, ich, geraeteBuch, istKontakt, me.pk).catch(() => null);
    if (!z || z.partner !== partner) continue;
    ergebnis.set(`mls:${n.id}`, {
      id: `mls:${n.id}`, pubkey: z.autor, created_at: n.zeit, kind: 445, tags: [], content: n.text, sig: "", mls: true,
      ...(z.hinweis ? { geraet: { text: z.hinweis, warnung: !!z.warnung } } : {}),
    });
  }
  for (const ev of alt) {
    // Nur Nachrichten zwischen genau uns beiden – nicht die des Partners an Dritte.
    const pTag = ev.tags.find((t) => t[0] === "p")?.[1];
    const betrifft = (ev.pubkey === me.pk && pTag === partner) || (ev.pubkey === partner && pTag === me.pk);
    if (!betrifft || ergebnis.has(ev.id)) continue;
    let text: string;
    try {
      text = await state.signer!.nip44Decrypt(ev.pubkey === me.pk ? partner : ev.pubkey, ev.content);
    } catch {
      text = entschluesselungFehlgeschlagen();
    }
    ergebnis.set(ev.id, { ...ev, content: text, legacy: true });
  }
  return [...ergebnis.values()];
}

/**
 * Umschlag nur an den Posteingang des Empfaengers (Kind 10050, NIP-17) –
 * seit 5.4 nicht mehr zusaetzlich an alle eigenen Relays: Jedes weitere Relay
 * saehe nur, wann dieser Schluessel Post bekommt. Ohne Liste oder wenn kein
 * Posteingang annimmt: an die eigenen Relays.
 */
export async function veroeffentlicheDm(wrap: NostrEvent, empfaenger: string): Promise<void> {
  const ziele = await posteingangVon(empfaenger);
  const pool = await ensurePool();
  if (ziele.length > 0 && (await veroeffentlicheAn(wrap, ziele)) > 0) return;
  await pool.publish(wrap);
}

let letzterDmAbgleich = 0;

/**
 * Posteingang abgleichen: Neue Absender erscheinen als „Anfrage“ in der Liste,
 * und die eigenen Posteingangs-Relays werden einmal als Kind 10050
 * veroeffentlicht. Hoechstens einmal pro Minute.
 */
/** Posteingang abgleichen – auch regelmaessig im Hintergrund (4.9d: Adress-Anfragen beantworten). */
export function posteingangAbgleichen(): Promise<void> {
  return syncDmInbox();
}

async function syncDmInbox(): Promise<void> {
  if (!state.keypair || Date.now() - letzterDmAbgleich < 60_000) return;
  letzterDmAbgleich = Date.now();
  try {
    const me = state.keypair;
    const pool = await ensurePool();
    // Eigener Relay-Satz (5.4a): NIP-65-Liste und Posteingang einmal je Sitzung abgleichen
    await eigeneRelayListen().catch(() => { /* offline – beim naechsten Abgleich wieder */ });
    // Kontakte von anderen Geraeten (2.5b, nur wenn eingeschaltet)
    let neu = await ladeKontakte().catch(() => 0);
    const umschlaege = await pool.query({ kinds: [1059], "#p": [me.pk], limit: 200 });
    for (const w of umschlaege) {
      const e = await oeffneUmschlag(w);
      // Keine DM: vielleicht eine MLS-Einladung eines Kontakts (2.2b-d1)
      if (!e) await alsMlsEinladung(w);
      if (!e || e.partner === me.pk || e.partner === state.person) continue;
      const vorhanden = conversations.find((x) => x.id === e.partner);
      if (!vorhanden) {
        conversations.push({ id: e.partner, type: "dm", name: t("komm.anfrage", { pk: pkShort(e.partner) }), lastTs: e.ev.created_at });
        neu++;
      } else if (e.ev.created_at > (vorhanden.lastTs ?? 0)) {
        vorhanden.lastTs = e.ev.created_at;
      }
    }
    // MLS-Gruppen (2.2b-d1): nur wenn es welche gibt – sonst bleibt die Engine ungeladen
    const mitMls = conversations.filter((c) => c.type === "dm" && c.mls);
    if (mitMls.length > 0 && !mlsGesperrt()) {
      const zahlen = await mlsAbgleichen(mitMls.map((c) => c.mls!)).catch(() => new Map<string, number>());
      for (const c of mitMls) if ((zahlen.get(c.mls!) ?? 0) > 0) {
        c.lastTs = Math.max(c.lastTs ?? 0, Math.floor(Date.now() / 1000));
        neu++;
        if (activeConversation === c.id) void loadChatMessages(c.id);
      }
    }
    if (neu > 0) {
      saveConversations();
      loadChatList();
    }
    await aktualisiereSchluessel();
  } catch {
    /* offline */
  }
}

// ------------------------------------------------ Schluesselwechsel (8.6a)

/** Stand der Schluessel meiner Kontakte (gueltig, abgeloest, widerrufen, streitig). */
let schluesselStand = new Map<string, KeyState>();

/** Mandate und Widerrufe der Kontakte laden, erste Mandate merken, Ansicht auffrischen. */
async function aktualisiereSchluessel(): Promise<void> {
  const kontakte = conversations.filter((c) => c.type === "dm").map((c) => c.id).filter((id) => /^[0-9a-f]{64}$/.test(id));
  if (kontakte.length === 0) return;
  const pool = await ensurePool();
  const { KIND_ROTATION_MANDATE, KIND_KEY_REVOCATION } = await import("@freedomstack/protocol");
  const [mandate, widerrufe] = await Promise.all([
    // Mandate schreiben die Kontakte selbst – auch an ihren Schreib-Relays lesen (5.4b)
    frageBeiAutoren({ kinds: [KIND_ROTATION_MANDATE], authors: kontakte, limit: 200 }),
    pool.query({ kinds: [KIND_KEY_REVOCATION], "#p": kontakte, limit: 200 }),
  ]);
  const r = pruefeKontakte(kontakte, [...mandate, ...widerrufe], leseGemerkt(geheim.getItem(LS_MANDATE)));
  if (r.geaendert) await geheim.setItem(LS_MANDATE, JSON.stringify(r.gemerkt)).catch(() => undefined);
  const vorher = JSON.stringify([...schluesselStand].map(([k, v]) => [k, v.status, v.currentPubkey]));
  schluesselStand = r.stand;
  if (JSON.stringify([...schluesselStand].map(([k, v]) => [k, v.status, v.currentPubkey])) === vorher) return;
  loadChatList();
  if (activeConversation && schluesselStand.has(activeConversation)) void loadChatMessages(activeConversation);
}

/** ⚠ vor Kontakten, deren Schluessel nicht mehr (unstreitig) gilt – per textContent. */
function markiereSchluessel(list: HTMLElement): void {
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
function schluesselHinweis(thread: HTMLElement, partner: string): void {
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

/** Gesendete Direktnachrichten, deren Kopien noch warten oder noch nicht zurueck sind (6.4) – nur im Speicher. */
const unterwegs = new Map<string, DmAnzeige[]>();

export async function loadChatMessages(cid: string): Promise<void> {
  // DMs: kind 4 (NIP-44, p-tag = partner). Communities: kind 42 (channel) mit h-tag.
  const c = conversations.find((x) => x.id === cid);
  if (!c || !state.keypair) return;
  try {
    const pool = await ensurePool();
    let events: NostrEvent[] = [];
    if (c.type === "dm") {
      events = await ladeDmNachrichten(c.id);
      // Unterwegs (6.4): sofort sichtbar, bis die eigene Kopie vom Relay zurueck ist
      const da = new Set(events.map((e) => e.id));
      const offen = (unterwegs.get(c.id) ?? []).filter((e) => !da.has(e.id));
      unterwegs.set(c.id, offen);
      events = [...events, ...offen];
    } else {
      events = await pool.query({ kinds: [42], "#h": [c.id], limit: 50 });
    }
    const thread = $("#chat-thread");
    if (events.length === 0) return; // empty-state bleibt
    // DMs kommen bereits entschluesselt aus ladeDmNachrichten(); Communities
    // sind Klartext.
    const decrypted = events;
    // Moderation anwenden — nur fuer Communities, nur wenn der Nutzer sie
    // eingeschaltet laesst. Abschaltbar zu sein ist der Unterschied zwischen
    // einer Hausordnung und einer Zensur.
    const modState = c.type === "community" ? await ladeModeration(c.id) : null;
    const modAn = localStorage.getItem(`freedom.mod.${c.id}`) !== "off";
    const versteckt = new Map<string, { reason: string }>();
    if (modState && modAn) {
      const { applyModeration } = await import("@freedomstack/protocol");
      for (const r of applyModeration(decrypted as never[], modState as never, { enabled: true })) {
        if (r.hidden) versteckt.set(r.event.id, { reason: r.reason ?? t("pg.ohneGrund") });
      }
    }

    // Jede Blase als DOM (C-6c): Text, Namen und Gerätenamen sind Fremddaten
    thread.replaceChildren(...decrypted
      .sort((a, b) => a.created_at - b.created_at)
      .map((ev) => {
        const mine = [state.keypair!.pk, state.person].includes(ev.pubkey);
        // ev.content ist an dieser Stelle bereits entschluesselt (siehe oben).
        let text = ev.content;
        let atts: ChatAttachment[] = [];
        if (c.type === "dm") {
          // DM-Anhaenge stecken im verschluesselten Body (kein Klartext-Tag).
          const parsed = parseDmBody(ev.content);
          text = parsed.text;
          atts = parsed.attachments;
        } else {
          atts = parseImetaTags(ev.tags);
        }
        const media = atts.map((a) => anhangElement(a));
        // Zap-Button neben jeder Nachricht (nur fuer DMs, nicht eigene)
        const v = versteckt.get(ev.id);
        // Lokale Suche (8.13): was hier gezeigt wird, in den Index (mit Tresor verschluesselt gespeichert)
        const ablauf = (ev as DmAnzeige).ablauf;
        if (!v && text !== entschluesselungFehlgeschlagen()) {
          sucheAufnehmen({ id: ev.id, text, scope: c.id, author: ev.pubkey, createdAt: ev.created_at, ...(ablauf !== undefined ? { ablauf } : {}) });
        }
        if (v) {
          // Platzhalter statt spurlosem Entfernen: Eine Luecke, die man sieht,
          // ist Moderation. Eine, die man nicht sieht, ist Manipulation.
          const zeigen = el("button", t("komm.trotzdemZeigen"), "ghost show-anyway");
          zeigen.dataset.id = ev.id;
          zeigen.style.cssText = "width:auto;padding:2px 6px;font-size:10px";
          const marke = el("div", `${t("komm.ausgeblendetMarke", { grund: v.reason })} `, "txt mono-sm");
          marke.append(zeigen);
          const blase = el("div", undefined, "bubble hidden-msg");
          blase.append(marke);
          return blase;
        }
        // Zahlungsanforderung (A-5): nur in Direktnachrichten anderer, nur zahlbare
        const anf = !mine && c.type === "dm" ? leseAnforderung(text) : null;
        if (anf) anforderungen.set(ev.id, { anf, von: ev.pubkey });
        const wer = el("div", mine ? t("komm.du") : pkShort(ev.pubkey), "who");
        const marke = (text: string, titel: string, klasse: string): HTMLElement => {
          const m = el("span", text, klasse);
          m.title = titel;
          return m;
        };
        const dm = ev as DmAnzeige;
        if (dm.legacy) wer.append(" ", marke(t("komm.alt"), t("komm.altTitel"), "mono-sm"));
        else if (dm.mls) wer.append(" ", marke("· MLS", t("komm.mlsTitel"), "mono-sm"));
        else if (dm.wartet) wer.append(" ", marke(t("komm.wartet"), t("komm.wartetTitel"), "mono-sm"));
        // Nach dem Diebstahl (8.6a): nicht glauben, dass es von dieser Person ist
        if (c.type === "dm" && nachDiebstahl(ev, schluesselStand.get(c.id))) {
          wer.append(" ", marke(t("komm.diebstahl"), t("komm.diebstahlTitel"), "mono-sm warn"));
        }
        // Von einem Geraet geschrieben (8.6b) – der Name steht in der Vollmacht (Fremddaten)
        const g = dm.geraet;
        if (g) wer.append(" ", el("span", `· ${g.text}`, g.warnung ? "mono-sm geraet-hinweis warn" : "mono-sm geraet-hinweis"));
        if (!mine && c.type === "dm") {
          const zap = el("button", "⚡", "zap-msg-btn");
          zap.dataset.pk = ev.pubkey;
          zap.dataset.name = pkShort(ev.pubkey);
          zap.title = t("komm.zapSenden");
          wer.append(zap);
        }
        const inhalt = el("div", text, "txt");
        inhalt.append(...media);
        if (anf) {
          const zahlen = el("button", t("anf.bezahlen"), "ghost anf-zahlen-btn");
          zahlen.dataset.id = ev.id;
          inhalt.append(zahlen);
        }
        const blase = el("div", undefined, "bubble");
        blase.classList.add(mine ? "user" : "ai");
        blase.append(wer, inhalt);
        return blase;
      }));
    if (c.type === "dm") schluesselHinweis(thread, c.id);
    thread.scrollTop = thread.scrollHeight;
    wireBlobButtons(thread);
    thread.querySelectorAll(".show-anyway").forEach((b) => {
      b.addEventListener("click", () => {
        const id = (b as HTMLElement).dataset.id!;
        const ev = decrypted.find((x) => x.id === id);
        if (ev) void hinweis(t("komm.ausgeblendetTitel"), ev.content);
      });
    });
  } catch { /* offline */ }
}

export async function sendChatMessage(): Promise<void> {
  const input = $("#chat-input") as HTMLTextAreaElement;
  const text = input.value.trim();
  // Ein reiner Anhang ohne Text ist eine gueltige Nachricht.
  if ((!text && chatAttachments.length === 0) || !state.keypair || !activeConversation) return;
  const c = conversations.find((x) => x.id === activeConversation);
  if (!c) return;
  try {
    const pool = await ensurePool();
    // NIP-92 imeta-Tags fuer Community-Posts. Bei DMs duerfen die Anhaenge
    // NICHT in Klartext-Tags landen — dort wandern sie mit in den
    // verschluesselten Body, sonst waere die Metadatenspur oeffentlich.
    // Raeume sind bis 2.3 offen: Der Datei-Schluessel steht dort so offen wie der Text.
    const imeta: string[][] = chatAttachments.map((a) => [
      "imeta", `url ${a.url}`, `m ${a.mime}`, `name ${a.name}`, ...imetaSchluessel(a),
    ]);
    if (c.type === "dm" && (await sendeUeberMls(c, chatAttachments.length > 0 ? JSON.stringify({ text, attachments: chatAttachments }) : text))) {
      // Ueber MLS gesendet (2.2b-d2)
    } else if (c.type === "dm") {
      // NIP-17: Inhalt (Kind 14) im Siegel (Kind 13) im Umschlag (Kind 1059).
      // Relays sehen weder Inhalt noch Absender. Dazu eine Kopie an sich selbst.
      const { buildPrivateDm } = await import("@freedomstack/protocol");
      const payload = chatAttachments.length > 0
        ? JSON.stringify({ text, attachments: chatAttachments })
        : text;
      if (!state.signer) return;
      // Je eine Kopie an die Geraete des Kontakts und an die eigenen (8.6b) – ohne Netz nur die beiden.
      // Als Geraet (8.6c) spricht die App fuer die Person: Kopie auch an sie, nur mit gueltiger Vollmacht.
      const ich = sprichtFuer() ?? state.keypair.pk;
      const [ihre, meine] = await Promise.all([c.id, ich].map((pk) => geraeteBuch.kopienFuer(pk).catch(() => [] as string[])));
      if (alsGeraet() && !meine!.includes(state.keypair.pk)) {
        toast(t("komm.keineVollmacht"), true);
        return;
      }
      const dm = await buildPrivateDm({
        signer: state.signer,
        recipientPk: c.id,
        content: payload,
        // Ablauf nach NIP-40 (2.5), falls fuer diese Unterhaltung gesetzt
        ...(c.ablaufSecs ? { ablaufSecs: c.ablaufSecs } : {}),
        weitereEmpfaenger: [...ihre!, ...meine!, ich],
      });
      // Jede Kopie mit eigener Zufallsverzoegerung (6.4) – sonst verbindet der Zeitpunkt, was die Wegwerf-Schluessel trennen.
      // Im eigenen Verlauf steht die Nachricht sofort, „wird gesendet“, bis beide Kopien hinaus sind.
      const eintrag: DmAnzeige = {
        id: dm.rumorId, pubkey: ich, created_at: Math.floor(Date.now() / 1000), kind: 14, tags: [], content: payload, sig: "", wartet: true,
      };
      unterwegs.set(c.id, [...(unterwegs.get(c.id) ?? []), eintrag]);
      let ausstehend = 2;
      const fertig = () => {
        if (--ausstehend > 0) return;
        eintrag.wartet = false;
        if (activeConversation === c.id) void loadChatMessages(c.id);
      };
      versendeVerzoegert(() => veroeffentlicheDm(dm.toRecipient, c.id).then(fertig));
      versendeVerzoegert(() => veroeffentlicheDm(dm.toSelf, ich).then(fertig));
      // Geraete lesen am Posteingang ihrer Person
      for (const k of dm.weitere) versendeVerzoegert(() => veroeffentlicheDm(k.wrap, k.an === ich || meine!.includes(k.an) ? ich : c.id));
    } else {
      // Community: kind 42 mit h-tag (channel-id)
      const ev = await signiere(buildEvent(state.keypair.pk, 42, [["h", c.id], ...imeta], text));
      await pool.publish(ev);
    }
    input.value = "";
    chatAttachments = [];
    setAttachStatus($("#chat-attach-list"), "");
    c.lastTs = Math.floor(Date.now() / 1000);
    saveConversations();
    loadChatMessages(activeConversation);
  } catch (e) {
    toast(t("komm.fehler", { grund: fehlerText(e) }), true);
  }
}

/**
 * 1:1 ueber MLS (2.2b-d2), wenn der Kontakt es kann (KeyPackage). Mit Ablauf
 * (2.5) bleibt es bei NIP-17 – den traegt MLS hier nicht; ebenso mit Bunker
 * und ohne Tresor (2.2b-e1). Geraete beider Seiten sind seit 2.2b-e2 eigene
 * Mitglieder; laesst sich die Gruppe nicht auf alle bringen, geht die Nachricht
 * per NIP-17 an jedes Geraet. false: der Chat sendet per NIP-17.
 */
async function sendeUeberMls(c: ChatConversation, inhalt: string): Promise<boolean> {
  if (c.ablaufSecs || mlsGesperrt()) return false;
  const r = await mlsSendeAn(c.id, c.mls, inhalt).catch(() => null);
  if (r?.gruppe) c.mls = r.gruppe;
  return !!r?.gesendet;
}

export async function newDm(): Promise<void> {
  const { decodeNpub } = await import("../../identity.js");
  // npub (auch mit „nostr:“ davor, wie ihn QR-Codes anderer Apps tragen) oder 64 Zeichen Hex, sonst ""
  const schluessel = (roh: unknown): string => schluesselAusEingabe(roh, decodeNpub);
  // Dialog statt prompt() (C-1b): ein Tippfehler meldet sich im Dialog, Scannen auf Klick
  const w = await dialog({
    titel: t("komm.neueNachricht"),
    felder: [{ art: "text", name: "schluessel", label: t("komm.kontaktSchluessel"), pflicht: true, mono: true, scannen: true }],
    pruefe: (w) => (schluessel(w.schluessel) ? null : t(/^(nostr:)?npub1/i.test(String(w.schluessel).trim()) ? "komm.keinNpub" : "komm.npubOderHex")),
    ok: t("komm.unterhaltungBeginnen"),
  });
  const id = w ? schluessel(w.schluessel) : "";
  if (!id) return;
  oeffneDirektnachricht(id);
}

/** Eine Unterhaltung mit diesem Schlüssel öffnen – neu, wenn es noch keine gibt (auch aus dem Mitglieder-Menü, C-13b). */
export function oeffneDirektnachricht(id: string): void {
  if (!conversations.find((c) => c.id === id)) {
    conversations.push({ id, type: "dm", name: id.slice(0, 12) + "…", lastTs: 0 });
    saveConversations();
  }
  setzeKommModus("dm");
  loadChatList();
  openConversation(id);
  document.querySelector(".comm-layout")?.classList.add("thread-open");
}

/**
 * Eine bestehende Community öffnen (C-10, Entscheidung E3 b): Neue gibt es
 * nicht mehr – Gruppen sind offene oder private Räume. Bestehende stehen als
 * „Community (offen)“ in der Raum-Leiste, nicht unter den Direktnachrichten;
 * ihr Verlauf erscheint wie eine Unterhaltung.
 */
export function oeffneCommunity(id: string): void {
  setzeKommModus("dm");
  openConversation(id);
  document.querySelector(".comm-layout")?.classList.add("thread-open");
}
