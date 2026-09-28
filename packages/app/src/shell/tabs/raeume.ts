/**
 * Räume (offen: 34700/42, privat: MLS-Gruppen) – Leiste, Kanäle, Verlauf,
 * Mitglieder, Moderation und Meldungen.
 *
 * Aus kommunikation.ts verschoben (Schritt C.2a) – wörtlich, ohne
 * Logikänderung; nur `kontaktName` ist jetzt exportiert. Seit C.2b1 fragen
 * Dialoge (`shell/dialog.ts`) statt `prompt()`, `confirm()` und `alert()`.
 */
import { MELDE_GRUENDE, type Channel, type ChannelMessage, type MeldeGrund, type Space, type ThreadView } from "@freedomstack/protocol";
import { escapeHtml, pkShort } from "../../shell-logic.js";
import { ensurePool, signiere, state } from "../state.js";
import { mlsAbgleichen, mlsGesperrt } from "../mls-konto.js";
import {
  PRIVAT, type PrivaterRaum, einladungsText, entferneAusRaum, gruppeVon, istPrivat, ladeInPrivatenRaum, ladePrivatenRaum, legePrivatenKanalAn, legePrivatenRaumAn, loescheImRaum, meldeImRaum, meldungErledigt, meldungenFuer, privateRaeume, sendePrivat, setzeModeratoren, wennMeldung,
} from "../raum-mls.js";
import { $, toast } from "../ui.js";
import { bestaetige, dialog, hinweis, type Option } from "../dialog.js";
import { type MenuePunkt, oeffneMenueAn, wireMenue } from "../menue.js";
import { antwortBezug, gruppiereVerlauf, kanalKennung } from "../../raum-verlauf.js";
import { gebietsschema, t } from "../../i18n.js";
import { fehlerText, kanalVertraulichkeit } from "../../protokoll-texte.js";
import { abrufTakt } from "../versand.js";
import { conversations, setzeKommModus } from "./kommunikation.js";

// ------------------------------------------------------------- Räume

interface SpaceUiState {
  spaceId: string | null;
  channelId: string | null;
  state: unknown | null;
  messages: unknown[];
  /** Lesestand je Kanal. Bleibt lokal: Er verriete, wann jemand online war. */
  lastRead: Map<string, number>;
  /** Privater Raum (MLS-Gruppe, 2.3b) – sonst null (offener Raum, Kind 42). */
  privat: PrivaterRaum | null;
  /** Zuletzt gezeichneter Kanal (C.2b2) – der Thread zeichnet daraus. */
  verlauf: VerlaufKontext | null;
  /** Offener Thread (C.2c): oberste Nachricht und die, der geantwortet wird. Nur im Speicher. */
  thread: { root: string; ziel: string } | null;
}

const spacesUi: SpaceUiState = {
  spaceId: null, channelId: null, state: null, messages: [], lastRead: new Map(), privat: null, verlauf: null, thread: null,
};

function ladeLesestand(): void {
  try {
    const raw = JSON.parse(localStorage.getItem("freedom.lastRead") ?? "[]") as [string, number][];
    spacesUi.lastRead = new Map(raw);
  } catch { /* erster Start */ }
}

function merkeLesestand(channelId: string): void {
  spacesUi.lastRead.set(channelId, Math.floor(Date.now() / 1000));
  localStorage.setItem("freedom.lastRead", JSON.stringify([...spacesUi.lastRead]));
}

/** Beigetretene offene Räume (Kind 42) – öffentlich wie ihr Inhalt. */
export function oeffentlicheRaeume(): string[] {
  try {
    return JSON.parse(localStorage.getItem("freedom.spaces") ?? "[]") as string[];
  } catch {
    return [];
  }
}

/** Alle Räume: private (MLS, 2.3b) zuerst – ihre Liste liegt nur im Tresor. */
function meineRaeume(): string[] {
  return [...privateRaeume().map((g) => PRIVAT + g), ...oeffentlicheRaeume()];
}

/** Namen privater Räume aus ihrer Definition – nur im Speicher. */
const privatNamen = new Map<string, string>();

function raumBeitreten(id: string): void {
  const alle = new Set(oeffentlicheRaeume());
  alle.add(id);
  localStorage.setItem("freedom.spaces", JSON.stringify([...alle]));
}

/** Leiste mit den Räumen. */
export async function zeigeRaumLeiste(): Promise<void> {
  const rail = $("#space-rail");
  if (!rail) return;
  const ids = meineRaeume();
  if (ids.length === 0) {
    rail.innerHTML = "";
    return;
  }
  // Namen privater Räume kommen aus ihrer Definition (Fremddaten) – nur textContent
  rail.replaceChildren(...ids.map((id) => {
    const name = istPrivat(id) ? privatNamen.get(id) ?? t("komm.privaterRaum") : id;
    const b = document.createElement("button");
    b.className = "space-pill";
    b.dataset.space = id;
    b.setAttribute("aria-current", String(id === spacesUi.spaceId));
    b.title = name;
    b.textContent = istPrivat(id) ? `🔒${name.slice(0, 1).toUpperCase()}` : id.slice(0, 2).toUpperCase();
    b.addEventListener("click", () => void oeffneRaum(id));
    return b;
  }));
}

/** Einen Raum laden: Definition, Rollen, Zuweisungen, Nachrichten. */
async function oeffneRaum(spaceId: string): Promise<void> {
  if (spacesUi.spaceId !== spaceId) {
    spacesUi.channelId = null;
    spacesUi.thread = null;
    // Nie Rechte oder Nachrichten des vorigen Raums zeigen, solange der neue lädt (C.2d2)
    spacesUi.state = null;
    spacesUi.privat = null;
    spacesUi.messages = [];
    document.querySelector(".comm-space-inner")?.classList.remove("mitglieder-offen");
  }
  spacesUi.spaceId = spaceId;
  zeigeRaumArt(spaceId);
  if (istPrivat(spaceId)) {
    // Privat (2.3b): Gruppe abgleichen, dann aus den inneren Events bauen
    const gruppe = gruppeVon(spaceId);
    await mlsAbgleichen([gruppe]).catch(() => undefined);
    const raum = await ladePrivatenRaum(gruppe).catch(() => null);
    if (!raum) {
      // Nie in den zuvor offenen Raum weiterschreiben
      spacesUi.privat = null;
      spacesUi.state = null;
      spacesUi.messages = [];
      $("#space-name").textContent = `${t("komm.raumNichtVerfuegbar")}${mlsGesperrt() ? ` – ${mlsGesperrt()}` : ""}`;
      return;
    }
    spacesUi.privat = raum;
    spacesUi.state = raum.zustand;
    spacesUi.messages = raum.nachrichten;
    if (raum.zustand.space) privatNamen.set(spaceId, raum.zustand.space.name);
    zeigeRaumArt(spaceId);
    void zeigeRaumLeiste();
    await zeigeKanalliste();
    // Offenen Kanal neu zeichnen (nach dem Senden, beim Abgleich alle 30 s)
    if (spacesUi.channelId) await oeffneKanal(spacesUi.channelId);
    return;
  }
  spacesUi.privat = null;
  const { buildSpaceState, KIND_SPACE, KIND_SPACE_ROLES, KIND_ROLE_GRANT, KIND_CHANNEL_MESSAGE } =
    await import("@freedomstack/protocol");
  try {
    const pool = await ensurePool();
    const [struktur, nachrichten] = await Promise.all([
      pool.query({ kinds: [KIND_SPACE, KIND_SPACE_ROLES, KIND_ROLE_GRANT], "#space": [spaceId], limit: 500 }),
      pool.query({ kinds: [KIND_CHANNEL_MESSAGE], "#space": [spaceId], limit: 1000 }),
    ]);
    spacesUi.state = buildSpaceState(spaceId, struktur);
    spacesUi.messages = nachrichten;
  } catch (e) {
    $("#space-name").textContent = t("komm.nichtErreichbar", { grund: fehlerText(e) });
    return;
  }
  zeigeRaumArt(spaceId);
  void zeigeRaumLeiste();
  await zeigeKanalliste();
}

/**
 * Art des Raums sichtbar machen (2.3b): Offene Räume liest jeder mit – der
 * Hinweis steht über dem Raum. Einladen nur privat und als Moderator.
 * Seit C.2d2 auch die übrigen Menüpunkte nach Rechten: Moderatoren ernennen
 * und Kanäle anlegen privat die Moderatoren, offen nur der Gründer.
 */
function zeigeRaumArt(spaceId: string): void {
  const privat = istPrivat(spaceId);
  document.getElementById("space-oeffentlich")?.classList.toggle("hidden", privat);
  const moderator = !!spacesUi.privat && spacesUi.privat.admins.includes(spacesUi.privat.ich);
  const gruender = !privat && !!state.keypair && (spacesUi.state as { ownerPubkey?: string } | null)?.ownerPubkey === state.keypair.pk;
  const verwalten = privat ? moderator : gruender;
  document.getElementById("space-invite")?.classList.toggle("hidden", !privat || !moderator);
  document.getElementById("space-mods")?.classList.toggle("hidden", !verwalten);
  document.getElementById("space-kanal-neu")?.classList.toggle("hidden", !verwalten);
  document.querySelector("#space-menue .menue-trenner")?.classList.toggle("hidden", !verwalten);
}

/** Kanal anlegen (C.2d2): Name und wer schreiben darf; offen als neue Definition des Gründers, privat in die Gruppe. */
async function legeKanalAn(): Promise<void> {
  const st = spacesUi.state as { space?: Space } | null;
  const raum = spacesUi.privat;
  if (!st?.space || !state.keypair || !spacesUi.spaceId) return;
  const w = await dialog({
    titel: t("raum.kanalAnlegen"), ok: t("raum.anlegen"),
    felder: [
      { art: "text", name: "name", label: t("raum.kanalName"), pflicht: true },
      { art: "mehrfach", name: "schreiben", label: t("raum.kanalSchreiben"), optionen: [{ wert: "mod", text: t("raum.nurModsSchreiben") }] },
    ],
  });
  const name = String(w?.name ?? "").trim();
  if (!w || !name) return;
  const space = st.space;
  const kanal: Channel = {
    id: kanalKennung(name, space.channels.map((c) => c.id)), name,
    privacy: raum ? "verschluesselt" : "offen",
    writeRoles: (w.schreiben as string[]).includes("mod") ? ["mod"] : [], position: space.channels.length,
  };
  let ok = false;
  if (raum) ok = await legePrivatenKanalAn(raum, kanal).catch(() => false);
  else if (space.ownerPubkey === state.keypair.pk) {
    try {
      const { buildSpace } = await import("@freedomstack/protocol");
      await (await ensurePool()).publish(await signiere(buildSpace({
        spaceId: space.spaceId, name: space.name, description: space.description, ownerPubkey: space.ownerPubkey,
        channels: [...space.channels, kanal],
      })));
      ok = true;
    } catch (e) {
      toast(fehlerText(e), true);
      return;
    }
  }
  toast(t(ok ? "raum.kanalAngelegt" : "komm.nichtGeaendert", { name }), !ok);
  if (!ok) return;
  await oeffneRaum(spacesUi.spaceId);
  await oeffneKanal(kanal.id);
}

/** Kanäle mit Ungelesenem. */
async function zeigeKanalliste(): Promise<void> {
  const box = $("#channel-list");
  const st = spacesUi.state as { space?: { name: string; channels: { id: string; name: string; privacy: string }[] } } | null;
  if (!box || !st?.space) {
    if (box) box.innerHTML = `<span class="muted mono-sm">${escapeHtml(t("komm.raumNichtGefunden"))}</span>`;
    return;
  }
  $("#space-name").textContent = st.space.name;

  const { parseChannelMessage, unreadBadges } = await import("@freedomstack/protocol");
  const geparst = spacesUi.messages.map((e) => {
    try { return parseChannelMessage(e as never); } catch { return null; }
  }).filter((m): m is NonNullable<typeof m> => m !== null);

  const badges = new Map(
    unreadBadges(state.keypair?.pk ?? "", geparst, { lastRead: spacesUi.lastRead })
      .map((b) => [b.channelId, b]),
  );

  box.innerHTML = st.space.channels.map((c) => {
    const b = badges.get(c.id);
    // Erwaehnungen als Zahl, sonstiges Ungelesenes nur als Punkt: Eine Zahl
    // neben jedem Kanal ist Laerm.
    const marke = b?.mentions
      ? `<span class="mention">${b.mentions}</span>`
      : b?.unread ? `<span class="dot"></span>` : "";
    const schloss = c.privacy === "verschluesselt" ? "&#128274;" : "#";
    return `<button class="channel-item" data-ch="${escapeHtml(c.id)}"
      aria-current="${c.id === spacesUi.channelId}">
      <span class="hash">${schloss}</span><span>${escapeHtml(c.name)}</span>${marke}</button>`;
  }).join("");

  box.querySelectorAll(".channel-item").forEach((b) => {
    b.addEventListener("click", () => void oeffneKanal((b as HTMLElement).dataset.ch!));
  });

  if (!spacesUi.channelId && st.space.channels.length > 0) {
    await oeffneKanal(st.space.channels[0].id);
  }
}

/** Kanal anzeigen: Threads, Schreibrecht, Vertraulichkeit. */
async function oeffneKanal(channelId: string): Promise<void> {
  if (spacesUi.channelId !== channelId) spacesUi.thread = null;
  spacesUi.channelId = channelId;
  // Mobil (bis 900 px) ist der Kanal eine eigene Ebene – vor C.2b2 blieb er dort unsichtbar
  document.querySelector(".comm-space-inner")?.classList.add("showing-channel");
  const st = spacesUi.state as never;
  const { buildThreads, canWriteTo, can } = await import("@freedomstack/protocol");
  const darfModerieren = state.keypair ? can(state.keypair.pk, "moderieren", st) : false;
  const space = (spacesUi.state as { space?: { channels: never[] } })?.space;
  if (!space) return;

  const kanal = (space.channels as { id: string; name: string; privacy: string }[])
    .find((c) => c.id === channelId);
  if (!kanal) return;

  $("#channel-name").textContent = `#${kanal.name}`;
  const pInfo = $("#channel-privacy");
  if (pInfo) {
    pInfo.textContent = t(kanal.privacy === "verschluesselt" ? "komm.kanalVerschluesselt" : "komm.kanalOffen");
    pInfo.className = kanal.privacy === "verschluesselt" ? "mono-sm ok" : "mono-sm muted";
    pInfo.title = kanalVertraulichkeit(kanal);
  }

  const { topLevel, threads } = buildThreads(spacesUi.messages as never[], kanal as never, st);
  const darf = state.keypair ? canWriteTo(state.keypair.pk, kanal as never, st) : false;
  const alle = new Map([...topLevel, ...[...threads.values()].flatMap((f) => f.replies)].map((m) => [m.id, m]));
  spacesUi.verlauf = { threads, alle, darfModerieren, darfSchreiben: darf, imThread: false };
  const thread = $("#channel-thread");
  if (thread) {
    // Seit C.2b2 gruppiert, mit Namen statt Schlüsseln – nur DOM und textContent
    thread.replaceChildren(...(topLevel.length === 0
      ? [el("div", t("komm.nochNichts"), "muted mono-sm")]
      : verlaufGruppen(topLevel, spacesUi.verlauf)));
    thread.scrollTop = thread.scrollHeight;
  }
  zeigeThread();

  // Schreibrecht: Wer nicht darf, bekommt den Grund statt eines toten Feldes.
  $("#channel-composer").classList.toggle("hidden", !darf);
  const ro = $("#channel-readonly");
  if (ro) {
    ro.classList.toggle("hidden", darf);
    ro.textContent = darf ? "" : t("komm.nurRollen");
  }

  merkeLesestand(channelId);
  void zeigeMitglieder();
  void zeigeKanalliste();
}

/** Meldegründe (8.5) im Dialog – gesendet wird die Kennung, angezeigt der Text. */
const GRUND_TEXT: Record<MeldeGrund, string> = {
  spam: "raum.grundSpam", illegal: "raum.grundIllegal", nudity: "raum.grundNacktheit", profanity: "raum.grundBeleidigung",
  impersonation: "raum.grundIdentitaet", malware: "raum.grundSchadsoftware", other: "raum.grundAnderes",
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, klasse?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (klasse) e.className = klasse;
  return e;
}

function knopf(text: string, klasse: string, tun: () => void): HTMLButtonElement {
  const b = el("button", text);
  b.className = `ghost mini ${klasse}`;
  b.type = "button";
  b.addEventListener("click", tun);
  return b;
}

/** Was der Verlauf eines Kanals zum Zeichnen braucht (C.2b2, seit C.2c auch der Thread). */
interface VerlaufKontext {
  threads: Map<string, ThreadView>;
  /** Jede sichtbare Nachricht des Kanals nach Id – für den Bezug einer Antwort. */
  alle: Map<string, ChannelMessage>;
  darfModerieren: boolean;
  darfSchreiben: boolean;
  imThread: boolean;
}

const nameVon = (pk: string): string => (pk === state.keypair?.pk ? t("raum.ich") : kontaktName(pk));

/** Eine Nachricht: im Thread ihr Bezug, im Kanal „n Antworten“, dazu die Aktionen. */
function nachrichtZeile(m: ChannelMessage, k: VerlaufKontext): HTMLElement {
  const { darfModerieren } = k;
  const z = el("div", undefined, "msg-zeile");
  z.tabIndex = -1; // antippen zeigt die Aktionen (mobil), Tab springt direkt zu ihnen
  // Im Thread (C.2c): auf welche Antwort sich diese bezieht – nur als Text
  const bezug = k.imThread && m.replyTo && m.replyTo !== m.threadRoot ? k.alle.get(m.replyTo) : undefined;
  if (bezug) z.append(el("div", t("raum.zitat", { name: nameVon(bezug.authorPubkey), text: bezug.content.slice(0, 80) }), "msg-bezug"));
  z.append(el("div", m.content, "msg-text"));
  const faden = k.imThread ? undefined : k.threads.get(m.id);
  if (faden) {
    // B8: „n Antworten“ öffnet den Thread (bis C.2c ohne Handler)
    const b = el("button", `${t(faden.replies.length === 1 ? "komm.eineAntwort" : "komm.antworten", { n: faden.replies.length })} · ${t("komm.beteiligte", { n: faden.participants.length })}`, "thread-link");
    b.type = "button";
    b.dataset.root = m.id;
    b.addEventListener("click", () => oeffneThread(m.id));
    z.append(b);
  }
  // Was ich mit der Nachricht tun kann – beim Zeigen und mit dem Fokus, mobil nach Antippen
  const aktionen: HTMLElement[] = [];
  if (k.darfSchreiben) aktionen.push(knopf(t("raum.antworten"), "antworten", () => oeffneThread(m.threadRoot ?? m.id, m.id)));
  // Private Räume moderieren über MLS (2.3c) – nie mit öffentlichen Sperr-Events
  const modKnopf = darfModerieren && !spacesUi.privat && m.authorPubkey !== state.keypair?.pk;
  if (modKnopf) aktionen.push(knopf(t("komm.moderieren"), "mod-hide", () => void moderiere("hide", m.id, m.authorPubkey)));
  if (spacesUi.privat) aktionen.push(knopf(raumAktionText(m.authorPubkey), "raum-aktion", () => void raumAktion(m.id, m.authorPubkey)));
  if (aktionen.length) {
    const leiste = el("div", undefined, "msg-aktionen");
    leiste.setAttribute("role", "toolbar");
    leiste.setAttribute("aria-label", t("raum.aktionenAria"));
    leiste.append(...aktionen);
    z.append(leiste);
  }
  return z;
}

/** Nachrichten nach Absender und Tag gruppiert (C.2b2), mit Namen statt Schlüsseln. */
function verlaufGruppen(liste: readonly ChannelMessage[], k: VerlaufKontext): HTMLElement[] {
  const zeit = (s: number) => new Date(s * 1000).toLocaleTimeString(gebietsschema(), { hour: "2-digit", minute: "2-digit" });
  const tag = (s: number) => new Date(s * 1000).toLocaleDateString(gebietsschema(), { weekday: "long", day: "numeric", month: "long" });
  return gruppiereVerlauf(liste).flatMap((g) => {
    const kopf = el("div", undefined, "msg-meta");
    const name = el("span", nameVon(g.autor), "msg-author");
    name.title = g.autor;
    kopf.append(name, el("span", zeit(g.nachrichten[0]!.createdAt), "msg-time"));
    const gruppe = el("div", undefined, "msg-group");
    gruppe.append(kopf, ...g.nachrichten.map((m) => nachrichtZeile(m, k)));
    return g.neuerTag ? [el("div", tag(g.nachrichten[0]!.createdAt), "msg-tag"), gruppe] : [gruppe];
  });
}

/** Thread öffnen (C.2c): `ziel` ist die Nachricht, der geantwortet wird – die oberste oder eine Antwort. */
function oeffneThread(root: string, ziel = root): void {
  spacesUi.thread = { root, ziel };
  zeigeThread();
  document.getElementById("thread-msg")?.focus();
}

function schliesseThread(): void {
  const root = spacesUi.thread?.root;
  spacesUi.thread = null;
  zeigeThread();
  const zurueck = root ? [...document.querySelectorAll<HTMLElement>("#channel-thread .thread-link")].find((b) => b.dataset.root === root) : undefined;
  (zurueck ?? document.getElementById("space-msg"))?.focus();
}

/** Thread-Spalte (Desktop) bzw. eigene Ebene (schmal): oberste Nachricht, Antworten, Eingabe mit „Antwort an …“. */
function zeigeThread(): void {
  const k = spacesUi.verlauf;
  const faden = spacesUi.thread;
  const root = faden && k ? k.alle.get(faden.root) : undefined;
  const offen = !!(k && faden && root && !root.threadRoot);
  if (!offen) spacesUi.thread = null;
  document.querySelector(".comm-space-inner")?.classList.toggle("thread-offen", offen);
  if (offen) document.querySelector(".comm-space-inner")?.classList.remove("mitglieder-offen");
  const box = document.getElementById("thread-verlauf");
  if (!offen || !box) return;
  const kt = { ...k, imThread: true };
  const antworten = k.threads.get(root.id)?.replies ?? [];
  const teile = verlaufGruppen(antworten, kt);
  // Am selben Tag wie die oberste Nachricht kein zweites Datum
  const tagVon = (s: number) => new Date(s * 1000).toDateString();
  if (antworten[0] && tagVon(antworten[0].createdAt) === tagVon(root.createdAt)) teile.shift();
  box.replaceChildren(
    ...verlaufGruppen([root], kt),
    el("div", t(antworten.length === 1 ? "komm.eineAntwort" : "komm.antworten", { n: antworten.length }), "msg-tag"),
    ...teile,
  );
  box.scrollTop = box.scrollHeight;
  const ziel = k.alle.get(faden.ziel);
  const antwortAuf = ziel && ziel.id !== root.id ? ziel : undefined;
  document.getElementById("thread-antwort-an")?.classList.toggle("hidden", !antwortAuf);
  const text = document.getElementById("thread-antwort-text");
  if (text) text.textContent = antwortAuf ? t("raum.antwortAn", { name: nameVon(antwortAuf.authorPubkey) }) : "";
  document.getElementById("thread-composer")?.classList.toggle("hidden", !k.darfSchreiben);
}

/** Private Räume (2.3c): was ich mit einer Nachricht tun kann. */
function raumAktionText(autor: string): string {
  const raum = spacesUi.privat;
  if (!raum) return "";
  return t(autor === raum.ich ? "komm.loeschen" : raum.admins.includes(raum.ich) ? "komm.moderieren" : "komm.melden");
}

/**
 * Private Räume (2.3c, 8.5): eigene Nachricht löschen, als Moderator löschen
 * oder den Absender entfernen (MLS-Commit, neuer Schlüssel), sonst melden –
 * versiegelt nur an die Moderatoren. Nie ein öffentliches Event.
 */
async function raumAktion(id: string, autor: string): Promise<void> {
  const raum = spacesUi.privat;
  if (!raum) return;
  let ok: boolean;
  if (autor === raum.ich) {
    if (!await bestaetige({ titel: t("raum.loeschenTitel"), text: t("komm.eigeneLoeschen"), ok: t("komm.loeschen"), gefahr: true })) return;
    ok = await loescheImRaum(raum, id);
  } else if (raum.admins.includes(raum.ich)) {
    const w = await dialog({
      titel: t("raum.moderierenTitel"), ok: t("komm.moderieren"), gefahr: true,
      felder: [{ art: "wahl", name: "was", label: t("raum.massnahme"), pflicht: true, wert: "loeschen", optionen: [
        { wert: "loeschen", text: t("raum.fuerAlleLoeschen") },
        { wert: "entfernen", text: t("raum.ausRaumEntfernen"), hinweis: t("raum.entfernenHinweis") },
      ] }],
    });
    if (w?.was === "loeschen") ok = await loescheImRaum(raum, id);
    else if (w?.was === "entfernen") ok = await entferneAusRaum(raum, autor);
    else return;
  } else {
    const w = await dialog({
      titel: t("raum.meldenTitel"), text: t("raum.meldenText"), ok: t("komm.melden"),
      felder: [
        { art: "wahl", name: "grund", label: t("raum.grund"), pflicht: true, wert: "spam", optionen: MELDE_GRUENDE.map((g) => ({ wert: g, text: t(GRUND_TEXT[g]) })) },
        { art: "textarea", name: "notiz", label: t("komm.meldenNotiz") },
      ],
    });
    const grund = String(w?.grund ?? "");
    if (!(MELDE_GRUENDE as readonly string[]).includes(grund)) return;
    const notiz = String(w?.notiz ?? "");
    const n = await meldeImRaum(raum, id, autor, grund as MeldeGrund, notiz).catch(() => 0);
    toast(n > 0 ? t("komm.gemeldet", { n }) : t("komm.nichtGemeldet"), n === 0);
    return;
  }
  toast(t(ok ? "komm.erledigt" : "komm.nichtGeaendert"), !ok);
  await oeffneRaum(spacesUi.spaceId!);
}

/** Meldungen zum offenen Raum – nur Moderatoren sehen sie, nur aus dem Speicher (8.5). */
function zeigeMeldungen(): void {
  const box = document.getElementById("raum-meldungen");
  if (!box) return;
  const raum = spacesUi.privat;
  const liste = raum ? meldungenFuer(raum) : [];
  box.classList.toggle("hidden", liste.length === 0);
  // B3: Bis 1100 px fehlt die Spalte – der Knopf „Mitglieder“ im Kanal nennt offene Meldungen
  const knopf = document.getElementById("kanal-mitglieder");
  if (knopf) {
    knopf.textContent = liste.length ? t("raum.mitgliederMeldungen", { n: liste.length }) : t("komm.mitglieder");
    knopf.classList.toggle("hat-meldungen", liste.length > 0);
  }
  box.replaceChildren(...liste.map(([wrapId, m]) => {
    const z = document.createElement("div");
    z.className = "member-row";
    z.style.display = "block";
    const text = document.createElement("div");
    const grund = (MELDE_GRUENDE as readonly string[]).includes(m.grund) ? t(GRUND_TEXT[m.grund as MeldeGrund]) : m.grund;
    text.textContent = `${t("komm.meldungVon", { von: kontaktName(m.von), autor: kontaktName(m.autor), grund })}${m.notiz ? ` – ${m.notiz}` : ""}`;
    z.append(text);
    const aktionen: [string, () => Promise<boolean>][] = [
      [t("komm.loeschen"), () => loescheImRaum(raum!, m.ziel)], [t("komm.entfernen"), () => entferneAusRaum(raum!, m.autor)], [t("komm.erledigtKnopf"), async () => true],
    ];
    for (const [label, tun] of aktionen) {
      const b = document.createElement("button");
      b.className = "ghost mini";
      b.textContent = label;
      b.addEventListener("click", async () => {
        if (!(await tun().catch(() => false))) return toast(t("komm.nichtGeaendert"), true);
        await meldungErledigt(wrapId);
        await oeffneRaum(spacesUi.spaceId!);
      });
      z.append(b);
    }
    return z;
  }));
}

/**
 * Mitglieder mit ihren Rollen – seit C.2d1 nur DOM und `textContent`, mit
 * einem Menü je Mitglied für das, was ich darf.
 */
async function zeigeMitglieder(): Promise<void> {
  const box = $("#member-list");
  if (!box) return;
  const privat = spacesUi.privat;
  const zeilen: { pk: string; rollen: string[]; gruender?: boolean }[] = [];
  if (privat) {
    // Privat (2.3b): Mitglieder der Gruppe; Moderatoren sind ihre Admins und haben jede Rolle – dort nur „Moderator“
    const rollen = privat.zustand.roles;
    for (const pk of privat.mitglieder) {
      const eigene = privat.admins.includes(pk) ? [t("komm.moderatorRolle")]
        : (privat.zustand.grants.get(pk) ?? []).filter((r) => !r.startsWith("__") && r !== "mitglied").map((r) => rollen.get(r)?.name ?? r);
      zeilen.push({ pk, rollen: eigene });
    }
  } else {
    const st = spacesUi.state as {
      grants?: Map<string, string[]>; roles?: Map<string, { name: string; color?: string }>;
      ownerPubkey?: string;
    } | null;
    if (!st?.grants) return;
    if (st.ownerPubkey) zeilen.push({ pk: st.ownerPubkey, rollen: [t("komm.gruender")], gruender: true });
    for (const [pk, rollen] of st.grants) {
      if (pk === st.ownerPubkey) continue;
      zeilen.push({ pk, rollen: rollen.map((r) => st.roles?.get(r)?.name).filter((n): n is string => !!n) });
    }
  }
  const { can } = await import("@freedomstack/protocol");
  box.replaceChildren(...(zeilen.length === 0 ? [el("span", t("komm.niemand"), "muted")] : zeilen.map((m) => {
    const z = el("div", undefined, "member-row");
    const name = el("span", nameVon(m.pk), "mitglied-name");
    name.title = m.pk;
    z.append(name, ...m.rollen.map((r) => el("span", r, m.gruender ? "msg-role rolle-gruender" : "msg-role")));
    const punkte = mitgliedAktionen(m.pk, !!m.gruender, can);
    if (punkte.length) {
      const b = el("button", "⋯", "ghost icon-btn mitglied-knopf");
      b.type = "button";
      b.setAttribute("aria-label", t("raum.mitgliedMenue", { name: nameVon(m.pk) }));
      b.setAttribute("aria-haspopup", "menu");
      b.addEventListener("click", () => oeffneMenueAn(b, punkte, t("raum.mitgliedMenue", { name: nameVon(m.pk) })));
      z.append(b);
    }
    return z;
  })));
  zeigeMeldungen();
}

/** Was ich mit einem Mitglied tun darf – privat als Moderator, offen nach meinen Rechten im Raum. */
function mitgliedAktionen(pk: string, gruender: boolean, can: (pk: string, recht: "moderieren" | "rollen_vergeben", st: never) => boolean): MenuePunkt[] {
  const ich = state.keypair?.pk;
  if (!ich || pk === ich) return [];
  const raum = spacesUi.privat;
  if (raum) {
    if (!raum.admins.includes(raum.ich)) return [];
    const istMod = raum.admins.includes(pk);
    const andere = raum.admins.filter((a) => a !== raum.ich && a !== pk);
    return [
      { text: t(istMod ? "raum.keinModeratorMehr" : "raum.zumModerator"), tun: () => void aendereMitglied(() => setzeModeratoren(raum, istMod ? andere : [...andere, pk])) },
      { text: t("raum.ausRaumEntfernen"), gefahr: true, tun: () => void (async () => {
        if (await bestaetige({ titel: t("raum.ausRaumEntfernen"), text: t("raum.entfernenText", { name: nameVon(pk) }), ok: t("komm.entfernen"), gefahr: true })) {
          await aendereMitglied(() => entferneAusRaum(raum, pk));
        }
      })() },
    ];
  }
  if (gruender) return [];
  const st = spacesUi.state as never;
  const punkte: MenuePunkt[] = [];
  if (can(ich, "rollen_vergeben", st)) punkte.push({ text: t("raum.rolleTitel"), tun: () => void moderiere("grant", pk) });
  if (can(ich, "moderieren", st)) punkte.push({ text: t("raum.sperren"), gefahr: true, tun: () => void moderiere("ban", pk, pk) });
  return punkte;
}

/** Mitglieder als eigene Ebene, solange die Spalte fehlt (bis 1100 px, C.2d1) – mit den Meldungen (B3). */
function zeigeMitgliederEbene(an: boolean): void {
  const inner = document.querySelector(".comm-space-inner");
  if (an && spacesUi.thread) {
    spacesUi.thread = null;
    zeigeThread();
  }
  inner?.classList.toggle("mitglieder-offen", an);
  document.getElementById(an ? "mitglieder-zu" : "kanal-mitglieder")?.focus();
}

async function aendereMitglied(tun: () => Promise<boolean>): Promise<void> {
  const ok = await tun().catch(() => false);
  toast(t(ok ? "komm.erledigt" : "komm.nichtGeaendert"), !ok);
  if (ok && spacesUi.spaceId) await oeffneRaum(spacesUi.spaceId);
}

/** Nachricht senden. */
async function sendeRaumNachricht(imThread = false): Promise<void> {
  const input = $(imThread ? "#thread-msg" : "#space-msg") as HTMLInputElement | null;
  if (!input?.value.trim() || !state.keypair || !spacesUi.spaceId || !spacesUi.channelId) return;
  // Im Thread (C.2c): Verweis auf die oberste Nachricht und, wo gewählt, auf die Antwort
  const ziel = imThread && spacesUi.thread ? spacesUi.verlauf?.alle.get(spacesUi.thread.ziel) : undefined;
  if (imThread && !ziel) return;
  const bezug = ziel ? antwortBezug(ziel, state.keypair.pk) : undefined;
  if (spacesUi.thread) spacesUi.thread.ziel = spacesUi.thread.root;
  const text = input.value.trim();
  input.value = "";
  if (spacesUi.privat) {
    // Privat (2.3b): verschlüsselt in die Gruppe – Relays sehen nur Kind 445
    if (await sendePrivat(spacesUi.privat.gruppe, spacesUi.channelId, text, bezug).catch(() => false)) await oeffneRaum(spacesUi.spaceId);
    else {
      toast(t("komm.nichtGesendet"), true);
      input.value = text;
    }
    return;
  }
  try {
    const { buildChannelMessage } = await import("@freedomstack/protocol");
    const ev = await signiere(buildChannelMessage({
      authorPubkey: state.keypair.pk, spaceId: spacesUi.spaceId,
      channelId: spacesUi.channelId, content: text, mentions: bezug?.erwaehnt ?? [],
      threadRoot: bezug?.threadRoot, replyTo: bezug?.replyTo,
    } as never));
    await (await ensurePool()).publish(ev);
    spacesUi.messages.push(ev);
    await oeffneKanal(spacesUi.channelId);
  } catch (e) {
    toast(fehlerText(e), true);
    input.value = text;
  }
}

/**
 * Einen Raum anlegen.
 *
 * Bis hierhin konnte man Raeumen nur BEITRETEN — es gab keinen Weg, einen zu
 * erzeugen. Damit war die gesamte Raum-Funktion unbenutzbar: Protokoll und
 * Oberflaeche waren da, aber niemand konnte den ersten Schritt tun.
 */
async function legeRaumAn(oeffentlich = false): Promise<void> {
  if (!state.keypair) return;
  // Neue Räume sind privat (2.3b); öffentlich nur ausdrücklich und mit Hinweis
  const w = await dialog({
    titel: t(oeffentlich ? "komm.anlegenOeffentlich" : "komm.anlegenPrivat"),
    text: t(oeffentlich ? "komm.oeffentlichWarnung" : "komm.privatTitel"),
    felder: [{ art: "text", name: "name", label: t(oeffentlich ? "komm.nameOeffentlich" : "komm.namePrivat"), pflicht: true }],
    ok: t(oeffentlich ? "raum.oeffentlichAnlegen" : "raum.anlegen"),
  });
  const name = String(w?.name ?? "");
  if (!name.trim()) return;
  if (!oeffentlich) {
    try {
      const gruppe = await legePrivatenRaumAn(name.trim());
      setzeKommModus("space");
      await oeffneRaum(PRIVAT + gruppe);
      toast(t("komm.privatAngelegt"));
    } catch (e) {
      toast(fehlerText(e), true);
    }
    return;
  }

  const { buildSpace, buildRoles } = await import("@freedomstack/protocol");
  const spaceId = `${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const pool = await ensurePool();
    // Zwei Kanaele als Grundausstattung: einer fuer alle, einer nur fuer
    // Moderatoren. Ein Raum mit einem einzigen Kanal laedt niemanden ein,
    // Struktur zu bauen.
    await pool.publish(await signiere(buildSpace({
      spaceId, name: name.trim(), ownerPubkey: state.keypair.pk,
      channels: [
        { id: "allgemein", name: "allgemein", privacy: "offen", writeRoles: [], position: 0 },
        { id: "ankuendigungen", name: "ankündigungen", privacy: "offen", writeRoles: ["mod"], position: 1 }, // kein UI-Text
      ],
    } as never)));

    await pool.publish(await signiere(buildRoles(spaceId, state.keypair.pk, [
      { id: "mod", name: "Moderator", rank: 50, // kein UI-Text
        permissions: ["lesen", "schreiben", "threads", "moderieren", "rollen_vergeben", "repos_pflegen"] },
      { id: "mitglied", name: "Mitglied", rank: 10, // kein UI-Text
        permissions: ["lesen", "schreiben", "threads"] },
    ] as never)));

    raumBeitreten(spaceId);
    setzeKommModus("space");
    await oeffneRaum(spaceId);
    // Die Kennung ist der einzige Weg, wie jemand hereinkommt.
    await dialog({
      titel: t("raum.angelegtTitel"), text: t("komm.raumAngelegt"), ok: t("dlg.schliessen"), abbrechen: false,
      felder: [{ art: "nurlesen", name: "kennung", label: t("komm.raumKennung"), wert: spaceId }],
    });
  } catch (e) {
    toast(fehlerText(e), true);
  }
}

/** Name eines Kontakts, sonst der gekürzte Schlüssel. */
export const kontaktName = (pk: string) => conversations.find((c) => c.type === "dm" && c.id === pk)?.name ?? pkShort(pk);

/** In einen privaten Raum einladen (2.3b): Kontakt wählen, KeyPackage suchen, Einladung versiegelt an seinen Posteingang. */
async function ladeEin(): Promise<void> {
  const raum = spacesUi.privat;
  if (!raum) return;
  const kontakte = conversations.filter((c) => c.type === "dm" && /^[0-9a-f]{64}$/.test(c.id) && !raum.mitglieder.includes(c.id));
  // Ein eingetippter Schlüssel geht der Wahl vor
  const wen = (w: Record<string, unknown>) => String(w.schluessel ?? "").trim().toLowerCase() || String(w.kontakt ?? "");
  const w = await dialog({
    titel: t("raum.einladenTitel"), ok: t("komm.einladen"),
    felder: [
      ...(kontakte.length ? [{ art: "wahl" as const, name: "kontakt", label: t("raum.kontakt"), optionen: kontakte.map((c): Option => ({ wert: c.id, text: c.name })) }] : []),
      { art: "text", name: "schluessel", label: t(kontakte.length ? "raum.oderSchluessel" : "komm.einladenSchluessel"), mono: true },
    ],
    pruefe: (w) => (/^[0-9a-f]{64}$/.test(wen(w)) ? null : t("komm.keinSchluessel")),
  });
  if (!w) return;
  const pk = wen(w);
  toast(t("komm.ladeEin"));
  const r = await ladeInPrivatenRaum(raum, pk).catch((e) => fehlerText(e));
  toast(r === "eingeladen" ? t("komm.eingeladen", { name: kontaktName(pk) }) : t("komm.nichtEingeladen", { grund: einladungsText(r) }), r !== "eingeladen");
  await oeffneRaum(spacesUi.spaceId!);
}

/**
 * Moderieren: ausblenden, sperren, Rolle vergeben.
 *
 * Die Moderationsschicht war gebaut und getestet — aber es gab keinen Weg,
 * eine Massnahme zu ERZEUGEN. Ein Moderationssystem, in dem niemand
 * moderieren kann, ist keins.
 */
async function moderiere(aktion: "hide" | "ban" | "grant", ziel: string, autor?: string): Promise<void> {
  if (!state.keypair || !spacesUi.spaceId) return;
  const st = spacesUi.state as never;
  const { can, buildHide, buildBan, buildRoleGrant } =
    await import("@freedomstack/protocol");

  const darf = aktion === "grant"
    ? can(state.keypair.pk, "rollen_vergeben", st)
    : can(state.keypair.pk, "moderieren", st);
  if (!darf) {
    toast(t("komm.keinRecht"), true);
    return;
  }

  try {
    const pool = await ensurePool();
    if (aktion === "grant") {
      const w = await dialog({ titel: t("raum.rolleTitel"), felder: [{ art: "text", name: "rolle", label: t("komm.welcheRolle"), wert: "mitglied", pflicht: true }] });
      const rolle = String(w?.rolle ?? "").trim();
      if (!rolle) return;
      await pool.publish(await signiere(buildRoleGrant(
        spacesUi.spaceId, state.keypair.pk, ziel, [rolle])));
      toast(t("komm.rolleVergeben"));
    } else {
      // Ohne Begruendung wirkt Moderation willkuerlich — und wird es meist auch.
      // Ausblenden oder den Absender (`autor`) sperren: eine Wahl im selben Dialog
      const w = await dialog({
        titel: t("raum.moderierenTitel"), ok: t("komm.moderieren"), gefahr: true,
        felder: [
          // An einer Nachricht: ausblenden oder sperren; aus der Mitgliederliste (C.2d1) nur sperren
          { art: "wahl", name: "was", label: t("raum.massnahme"), pflicht: true, wert: aktion, optionen: [
            ...(aktion === "hide" ? [{ wert: "hide", text: t("raum.ausblenden") }] : []),
            ...(autor ? [{ wert: "ban", text: t("raum.sperren") }] : []),
          ] },
          { art: "textarea", name: "grund", label: t("komm.begruendung"), pflicht: true, fehler: t("komm.ohneBegruendung") },
        ],
      });
      const grund = String(w?.grund ?? "").trim();
      if (!w || !grund) return;
      const sperren = w.was === "ban" && !!autor;
      const ev = !sperren
        ? buildHide(spacesUi.spaceId, state.keypair.pk, ziel, grund)
        : buildBan(spacesUi.spaceId, state.keypair.pk, autor, grund);
      await pool.publish(await signiere(ev));
      toast(t(sperren ? "komm.gesperrt" : "komm.ausgeblendet"));
    }
    await oeffneRaum(spacesUi.spaceId);
  } catch (e) {
    toast(fehlerText(e), true);
  }
}

/**
 * Moderatoren ernennen.
 *
 * Die Moderationsschicht war vollstaendig gebaut, aber es gab keinen Weg,
 * ueberhaupt jemanden zum Moderator zu MACHEN — nur der Gruender konnte
 * handeln, und auch das nur ueber die Rollenvergabe im Raum.
 */
async function ernenneModeratoren(): Promise<void> {
  if (!state.keypair || !spacesUi.spaceId) return;
  const raum = spacesUi.privat;
  if (raum) {
    // Privat (2.3b): Moderatoren sind die Admins der Gruppe – gesetzt per MLS-Commit, nie als Event
    if (!raum.admins.includes(raum.ich)) {
      toast(t("komm.nurModsErnennen"), true);
      return;
    }
    const andere = raum.mitglieder.filter((m) => m !== raum.ich);
    if (!andere.length) {
      toast(t("raum.alleinImRaum"));
      return;
    }
    const w = await dialog({
      titel: t("komm.moderatoren"),
      felder: [{ art: "mehrfach", name: "mods", label: t("raum.werModerator"), werte: raum.admins, optionen: andere.map((m) => ({ wert: m, text: kontaktName(m) })) }],
    });
    if (!w) return;
    const mods = andere.filter((m) => (w.mods as string[]).includes(m));
    if (await setzeModeratoren(raum, mods)) {
      toast(t("komm.modsNebenDir", { n: mods.length }));
      await oeffneRaum(spacesUi.spaceId);
    } else toast(t("komm.nichtGeaendert"), true);
    return;
  }
  const st = spacesUi.state as { ownerPubkey?: string } | null;
  if (st?.ownerPubkey !== state.keypair.pk) {
    toast(t("komm.nurGruender"), true);
    return;
  }

  const schluessel = (w: Record<string, unknown>) => String(w.mods ?? "").split(/[\s,]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const w = await dialog({
    titel: t("komm.moderatoren"),
    felder: [
      { art: "textarea", name: "mods", label: t("komm.modPubkeys"), mono: true },
      { art: "textarea", name: "regeln", label: t("komm.regeln") },
    ],
    pruefe: (w) => (schluessel(w).every((x) => /^[0-9a-f]{64}$/.test(x)) ? null : t("komm.keinSchluessel")),
  });
  if (!w) return;
  const mods = schluessel(w);
  const regeln = String(w.regeln ?? "").trim() || null;

  try {
    const { buildModeratorList } = await import("@freedomstack/protocol");
    await (await ensurePool()).publish(await signiere(buildModeratorList(
      spacesUi.spaceId, state.keypair.pk, mods, regeln ?? undefined)));
    toast(t("komm.modsBenannt", { n: mods.length }));
    await oeffneRaum(spacesUi.spaceId);
  } catch (e) {
    toast(fehlerText(e), true);
  }
}

export async function wireSpacesTab(): Promise<void> {
  ladeLesestand();
  const send = $("#space-send");
  if (send) send.onclick = () => void sendeRaumNachricht();
  const input = $("#space-msg") as HTMLInputElement | null;
  if (input) input.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") void sendeRaumNachricht();
  });
  const create = $("#space-create");
  if (create) create.onclick = () => void legeRaumAn();
  const oeffentlich = $("#space-create-public");
  if (oeffentlich) oeffentlich.onclick = () => void legeRaumAn(true);
  const einladen = $("#space-invite");
  if (einladen) einladen.onclick = () => void ladeEin();
  // Meldungen (8.5) kommen über den Posteingang – für Moderatoren gleich zeigen
  wennMeldung(() => zeigeMeldungen());
  // Private Räume (2.3b): solange einer offen und sichtbar ist, im Abruftakt abgleichen (6.4: etwa 30 s, mit Zufall)
  abrufTakt.melde("raum", () => {
    if (spacesUi.privat && spacesUi.spaceId && !document.hidden && document.getElementById("channel-thread")?.offsetParent) void oeffneRaum(spacesUi.spaceId);
  });
  const join = $("#space-join");
  if (join) join.onclick = async () => {
    const w = await dialog({ titel: t("komm.raumBeitreten"), ok: t("komm.raumBeitreten"), felder: [{ art: "text", name: "id", label: t("komm.raumKennung"), pflicht: true, mono: true }] });
    const id = String(w?.id ?? "").trim();
    if (!id) return;
    raumBeitreten(id);
    // Seit C.2b2 gleich in den Raum – vorher blieb der Chat bei den Direktnachrichten
    setzeKommModus("space");
    void oeffneRaum(id);
  };
  // Mobil (C.2b2): Kanal als eigene Ebene, „‹“ führt zurück zur Kanalliste
  document.getElementById("channel-zurueck")?.addEventListener("click", () => {
    document.querySelector(".comm-space-inner")?.classList.remove("showing-channel");
    document.querySelector<HTMLElement>(`#channel-list .channel-item[aria-current="true"]`)?.focus();
  });
  // Raum-Menü ▾ (C.2b2): Einladen, Moderatoren, Beitreten, Anlegen
  const menueKnopf = document.getElementById("space-menue-knopf");
  const menue = document.getElementById("space-menue");
  if (menueKnopf && menue) wireMenue(menueKnopf, menue);
  // Thread (C.2c): senden, „Antwort an …“ aufheben, schließen (auch mit Esc)
  document.getElementById("thread-send")?.addEventListener("click", () => void sendeRaumNachricht(true));
  document.getElementById("thread-msg")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void sendeRaumNachricht(true);
  });
  document.getElementById("thread-antwort-weg")?.addEventListener("click", () => {
    if (spacesUi.thread) oeffneThread(spacesUi.thread.root);
  });
  document.getElementById("thread-zu")?.addEventListener("click", schliesseThread);
  // Mitglieder als Ebene (C.2d1): öffnen im Kopf des Kanals, schließen mit „×“ oder Esc
  document.getElementById("kanal-mitglieder")?.addEventListener("click", () => zeigeMitgliederEbene(true));
  document.getElementById("mitglieder-zu")?.addEventListener("click", () => zeigeMitgliederEbene(false));
  document.querySelector(".comm-space-inner .member-col")?.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Escape" && document.querySelector(".comm-space-inner.mitglieder-offen")) zeigeMitgliederEbene(false);
  });
  document.getElementById("thread-spalte")?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") schliesseThread();
  });
  const mods = $("#space-mods");
  if (mods) mods.onclick = () => void ernenneModeratoren();
  document.getElementById("space-kanal-neu")?.addEventListener("click", () => void legeKanalAn());
  const info = $("#space-info");
  if (info) info.onclick = async () => {
    const st = spacesUi.state as { space?: { channels: never[] } } | null;
    const kanal = (st?.space?.channels as { id: string; privacy: string }[] | undefined)
      ?.find((c) => c.id === spacesUi.channelId);
    if (!kanal) return;
    // In der Sprache der Oberfläche, auf Deutsch wortgleich mit privacyInfo() (B17)
    await hinweis(t("komm.rauminfo"), kanalVertraulichkeit(kanal));
  };

  const raeume = meineRaeume();
  if (raeume.length > 0) await oeffneRaum(raeume[0]);
  else void zeigeRaumLeiste();
}
