/**
 * Tab Kommunikation: Direktnachrichten (NIP-17), Communities. Die Räume mit
 * Kanälen und Moderation stehen seit Schritt C.2a in raeume.ts; Anhänge,
 * Kontakte und Posteingang seit C-5b in chat-anhaenge.ts, kontakte.ts und
 * posteingang.ts.
 *
 * Aus app.ts verschoben (Schritt 1.0) – wörtlich, ohne Logikänderung.
 */
import { NostrEvent, buildEvent } from "@freedomstack/protocol";
import { type ChatAttachment, parseDmBody, parseImetaTags, pkShort, imetaSchluessel, schluesselAusEingabe } from "../../shell-logic.js";
import { alsGeraet, ensurePool, signiere, sprichtFuer, state } from "../state.js";
import { nachDiebstahl } from "../../schluessel-status.js";
import { sucheAufnehmen, wireSuche } from "../suche-ui.js";
import { mlsBeiNeuem, mlsErreichbar, mlsGesperrt, mlsSendeAn } from "../mls-konto.js";
import { geheim } from "../tresor.js";
import { dialog, hinweis } from "../dialog.js";
import { $, el, toast } from "../ui.js";
import { pruefStand } from "../kontakt-pruefen-ui.js";
import { t } from "../../i18n.js";
import { versendeVerzoegert } from "../versand.js";
import { zeigeRaumLeiste } from "./raeume.js";
import { fehlerText } from "../../protokoll-texte.js";
import { leseAnforderung } from "../../zahlungs-anforderung.js";
import { anforderungen, anhangElement, anhangWarte, chatAttachments, leereAnhaenge, setAttachStatus, wireBlobButtons, zeigeAnhangListe } from "./chat-anhaenge.js";
import { loeseNamenAuf, markiereSchluessel, schluesselHinweis, schluesselStand, setzePetname, sichereKontakte } from "./kontakte.js";
import { type DmAnzeige, entschluesselungFehlgeschlagen, geraeteBuch, ladeDmNachrichten, syncDmInbox, veroeffentlicheDm } from "./posteingang.js";

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

export function saveConversations(): void {
  void geheim.setItem("freedom.chats", JSON.stringify(conversations))
    .catch((e) => toast(t("komm.nichtGespeichert", { grund: fehlerText(e) }), true));
  void sichereKontakte().catch(() => { /* offline – beim naechsten Speichern */ });
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

export function openConversation(cid: string): void {
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

/** Ein Senden wartet gerade auf Anhänge (C-29) – ein zweites Senden bis dahin nicht. */
let wartetAufAnhang = false;

export async function sendChatMessage(): Promise<void> {
  if (wartetAufAnhang) return;
  const input = $("#chat-input") as HTMLTextAreaElement;
  // Läuft noch ein Upload, wartet Senden auf ihn (C-29, Nutzertest C-7) – vorher ging der Text
  // ohne Anhang hinaus, und der Anhang hing an der nächsten Nachricht
  if (anhangWarte.anzahl > 0) {
    const ziel = activeConversation;
    const knopf = $("#chat-send") as HTMLButtonElement | null;
    wartetAufAnhang = true;
    input.readOnly = true;
    if (knopf) { knopf.disabled = true; knopf.setAttribute("aria-busy", "true"); }
    setAttachStatus($("#chat-attach-list"), t("komm.anhangWartet"));
    let gut = false;
    try {
      gut = await anhangWarte.alleFertig();
    } finally {
      wartetAufAnhang = false;
      input.readOnly = false;
      if (knopf) { knopf.disabled = false; knopf.removeAttribute("aria-busy"); }
    }
    // Geht nichts hinaus, steht unter dem Feld wieder, was vorgemerkt ist – nicht mehr „wird gesendet“
    if (!gut) { zeigeAnhangListe(); toast(t("komm.anhangFehlt"), true); return; }
    if (activeConversation !== ziel) { zeigeAnhangListe(); toast(t("komm.anhangGewechselt"), true); return; }
  }
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
    leereAnhaenge();
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
