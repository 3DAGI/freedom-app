/**
 * Tab Kommunikation: Direktnachrichten (NIP-17), Communities, Räume mit
 * Kanälen und Moderation, Anhänge (inline, Blob-Netz, Blossom).
 *
 * Aus app.ts verschoben (Schritt 1.0) – wörtlich, ohne Logikänderung.
 */
import { NostrEvent, OutboxPool, WebSocketRelay, buildEvent, signEvent } from "@freedomstack/protocol";
import {
  type ChatAttachment,
  escapeHtml,
  parseDmBody,
  parseImetaTags,
  pkShort,
  renderAttachment,
} from "../../shell-logic.js";
import { RELAYS, ensurePool, state } from "../state.js";
import { $, toast } from "../ui.js";

// ------------------------------------------------------------- Räume

interface SpaceUiState {
  spaceId: string | null;
  channelId: string | null;
  state: unknown | null;
  messages: unknown[];
  /** Lesestand je Kanal. Bleibt lokal: Er verriete, wann jemand online war. */
  lastRead: Map<string, number>;
}

const spacesUi: SpaceUiState = {
  spaceId: null, channelId: null, state: null, messages: [], lastRead: new Map(),
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

/** Beigetretene Räume. */
function meineRaeume(): string[] {
  try {
    return JSON.parse(localStorage.getItem("freedom.spaces") ?? "[]") as string[];
  } catch {
    return [];
  }
}

function raumBeitreten(id: string): void {
  const alle = new Set(meineRaeume());
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
  rail.innerHTML = ids.map((id) => {
    const kurz = id.slice(0, 2).toUpperCase();
    return `<button class="space-pill" data-space="${escapeHtml(id)}"
      aria-current="${id === spacesUi.spaceId}" title="${escapeHtml(id)}">${escapeHtml(kurz)}</button>`;
  }).join("");
  rail.querySelectorAll(".space-pill").forEach((b) => {
    b.addEventListener("click", () => void oeffneRaum((b as HTMLElement).dataset.space!));
  });
}

/** Einen Raum laden: Definition, Rollen, Zuweisungen, Nachrichten. */
async function oeffneRaum(spaceId: string): Promise<void> {
  spacesUi.spaceId = spaceId;
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
    $("#space-name").textContent = `nicht erreichbar: ${(e as Error).message}`;
    return;
  }
  void zeigeRaumLeiste();
  await zeigeKanalliste();
}

/** Kanäle mit Ungelesenem. */
async function zeigeKanalliste(): Promise<void> {
  const box = $("#channel-list");
  const st = spacesUi.state as { space?: { name: string; channels: { id: string; name: string; privacy: string }[] } } | null;
  if (!box || !st?.space) {
    if (box) box.innerHTML = `<span class="muted mono-sm">Raum nicht gefunden.</span>`;
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
  spacesUi.channelId = channelId;
  const st = spacesUi.state as never;
  const { buildThreads, canWriteTo, privacyInfo, can } = await import("@freedomstack/protocol");
  const darfModerieren = state.keypair ? can(state.keypair.pk, "moderieren", st) : false;
  const space = (spacesUi.state as { space?: { channels: never[] } })?.space;
  if (!space) return;

  const kanal = (space.channels as { id: string; name: string; privacy: string }[])
    .find((c) => c.id === channelId);
  if (!kanal) return;

  $("#channel-name").textContent = `#${kanal.name}`;
  const pInfo = $("#channel-privacy");
  if (pInfo) {
    pInfo.textContent = kanal.privacy === "verschluesselt" ? "verschlüsselt" : "offen — jeder kann mitlesen";
    pInfo.className = kanal.privacy === "verschluesselt" ? "mono-sm ok" : "mono-sm muted";
    pInfo.title = privacyInfo(kanal as never);
  }

  const { topLevel, threads } = buildThreads(spacesUi.messages as never[], kanal as never, st);
  const thread = $("#channel-thread");
  if (thread) {
    thread.innerHTML = topLevel.length === 0
      ? `<div class="muted mono-sm">Noch nichts hier. Fang an.</div>`
      : topLevel.map((m) => {
          const t = threads.get(m.id);
          const antworten = t
            ? `<button class="thread-link" data-root="${escapeHtml(m.id)}">
                 ${t.replies.length} Antwort${t.replies.length === 1 ? "" : "en"} ·
                 ${t.participants.length} Beteiligte</button>`
            : "";
          const modKnopf = darfModerieren && m.authorPubkey !== state.keypair?.pk
            ? `<button class="thread-link mod-hide" data-id="${escapeHtml(m.id)}"
                 data-pk="${escapeHtml(m.authorPubkey)}" style="color:#9A6A6A">moderieren</button>`
            : "";
          return `<div class="msg-group">
            <div class="msg-meta">
              <span class="msg-author">${escapeHtml(pkShort(m.authorPubkey))}</span>
              <span class="msg-time">${escapeHtml(new Date(m.createdAt * 1000).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }))}</span>
            </div>
            <div class="msg-text">${escapeHtml(m.content)}</div>${antworten}${modKnopf}</div>`;
        }).join("");
    thread.scrollTop = thread.scrollHeight;
    thread.querySelectorAll(".mod-hide").forEach((b) => {
      b.addEventListener("click", () => {
        const el = b as HTMLElement;
        const was = confirm("Nachricht ausblenden? Abbrechen = Absender sperren.");
        void moderiere(was ? "hide" : "ban", was ? el.dataset.id! : el.dataset.pk!);
      });
    });
  }

  // Schreibrecht: Wer nicht darf, bekommt den Grund statt eines toten Feldes.
  const darf = state.keypair ? canWriteTo(state.keypair.pk, kanal as never, st) : false;
  $("#channel-composer").classList.toggle("hidden", !darf);
  const ro = $("#channel-readonly");
  if (ro) {
    ro.classList.toggle("hidden", darf);
    ro.textContent = darf ? "" :
      "Hier dürfen nur bestimmte Rollen schreiben. Lesen kannst du alles.";
  }

  merkeLesestand(channelId);
  void zeigeMitglieder();
  void zeigeKanalliste();
}

/** Mitglieder mit ihren Rollen. */
async function zeigeMitglieder(): Promise<void> {
  const box = $("#member-list");
  const st = spacesUi.state as {
    grants?: Map<string, string[]>; roles?: Map<string, { name: string; color?: string }>;
    ownerPubkey?: string;
  } | null;
  if (!box || !st?.grants) return;

  const zeilen: string[] = [];
  if (st.ownerPubkey) {
    zeilen.push(`<div class="member-row"><span>${escapeHtml(pkShort(st.ownerPubkey))}</span>
      <span class="msg-role" style="color:var(--acc,#C9A227)">Gründer</span></div>`);
  }
  for (const [pk, rollen] of st.grants) {
    if (pk === st.ownerPubkey) continue;
    const namen = rollen.map((r) => st.roles?.get(r)?.name).filter(Boolean);
    zeilen.push(`<div class="member-row"><span>${escapeHtml(pkShort(pk))}</span>
      ${namen.map((n) => `<span class="msg-role">${escapeHtml(n!)}</span>`).join("")}</div>`);
  }
  box.innerHTML = zeilen.length ? zeilen.join("") : `<span class="muted">niemand eingetragen</span>`;
}

/** Nachricht senden. */
async function sendeRaumNachricht(): Promise<void> {
  const input = $("#space-msg") as HTMLInputElement | null;
  if (!input?.value.trim() || !state.keypair || !spacesUi.spaceId || !spacesUi.channelId) return;
  const text = input.value.trim();
  input.value = "";
  try {
    const { buildChannelMessage, signEvent: se } = await import("@freedomstack/protocol");
    const ev = se(buildChannelMessage({
      authorPubkey: state.keypair.pk, spaceId: spacesUi.spaceId,
      channelId: spacesUi.channelId, content: text, mentions: [],
    } as never), state.keypair.sk);
    await (await ensurePool()).publish(ev);
    spacesUi.messages.push(ev);
    await oeffneKanal(spacesUi.channelId);
  } catch (e) {
    toast((e as Error).message, true);
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
async function legeRaumAn(): Promise<void> {
  if (!state.keypair) return;
  const name = prompt("Name des Raums:");
  if (!name?.trim()) return;

  const { buildSpace, buildRoles, signEvent: se } = await import("@freedomstack/protocol");
  const spaceId = `${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const pool = await ensurePool();
    // Zwei Kanaele als Grundausstattung: einer fuer alle, einer nur fuer
    // Moderatoren. Ein Raum mit einem einzigen Kanal laedt niemanden ein,
    // Struktur zu bauen.
    await pool.publish(se(buildSpace({
      spaceId, name: name.trim(), ownerPubkey: state.keypair.pk,
      channels: [
        { id: "allgemein", name: "allgemein", privacy: "offen", writeRoles: [], position: 0 },
        { id: "ankuendigungen", name: "ankündigungen", privacy: "offen", writeRoles: ["mod"], position: 1 },
      ],
    } as never), state.keypair.sk));

    await pool.publish(se(buildRoles(spaceId, state.keypair.pk, [
      { id: "mod", name: "Moderator", rank: 50,
        permissions: ["lesen", "schreiben", "threads", "moderieren", "rollen_vergeben"] },
      { id: "mitglied", name: "Mitglied", rank: 10,
        permissions: ["lesen", "schreiben", "threads"] },
    ] as never), state.keypair.sk));

    raumBeitreten(spaceId);
    await oeffneRaum(spaceId);
    // Die Kennung ist der einzige Weg, wie jemand hereinkommt.
    prompt("Raum angelegt. Diese Kennung weitergeben:", spaceId);
  } catch (e) {
    toast((e as Error).message, true);
  }
}

/**
 * Moderieren: ausblenden, sperren, Rolle vergeben.
 *
 * Die Moderationsschicht war gebaut und getestet — aber es gab keinen Weg,
 * eine Massnahme zu ERZEUGEN. Ein Moderationssystem, in dem niemand
 * moderieren kann, ist keins.
 */
async function moderiere(aktion: "hide" | "ban" | "grant", ziel: string): Promise<void> {
  if (!state.keypair || !spacesUi.spaceId) return;
  const st = spacesUi.state as never;
  const { can, buildHide, buildBan, buildRoleGrant, signEvent: se } =
    await import("@freedomstack/protocol");

  const darf = aktion === "grant"
    ? can(state.keypair.pk, "rollen_vergeben", st)
    : can(state.keypair.pk, "moderieren", st);
  if (!darf) {
    toast("Dafür fehlt dir das Recht in diesem Raum", true);
    return;
  }

  try {
    const pool = await ensurePool();
    if (aktion === "grant") {
      const rolle = prompt("Welche Rolle? (mod / mitglied)", "mitglied");
      if (!rolle) return;
      await pool.publish(se(buildRoleGrant(
        spacesUi.spaceId, state.keypair.pk, ziel, [rolle.trim()]), state.keypair.sk));
      toast("Rolle vergeben");
    } else {
      // Ohne Begruendung wirkt Moderation willkuerlich — und wird es meist auch.
      const grund = prompt("Begründung (wird veröffentlicht):");
      if (!grund?.trim()) {
        toast("Ohne Begründung nicht — sie gehört zur Maßnahme", true);
        return;
      }
      const ev = aktion === "hide"
        ? buildHide(spacesUi.spaceId, state.keypair.pk, ziel, grund.trim())
        : buildBan(spacesUi.spaceId, state.keypair.pk, ziel, grund.trim());
      await pool.publish(se(ev, state.keypair.sk));
      toast(aktion === "hide" ? "Nachricht ausgeblendet" : "Absender gesperrt");
    }
    await oeffneRaum(spacesUi.spaceId);
  } catch (e) {
    toast((e as Error).message, true);
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
  const st = spacesUi.state as { ownerPubkey?: string } | null;
  if (st?.ownerPubkey !== state.keypair.pk) {
    toast("Nur der Gründer kann Moderatoren benennen", true);
    return;
  }

  const eingabe = prompt("Pubkeys der Moderatoren, kommagetrennt:");
  if (eingabe === null) return;
  const mods = eingabe.split(",").map((x) => x.trim()).filter((x) => /^[0-9a-f]{64}$/.test(x));

  const regeln = prompt(
    "Regeln dieses Raums (erscheinen bei jedem Mitglied):\n" +
    "Ohne Regeln wirkt Moderation willkürlich.",
  );

  try {
    const { buildModeratorList, signEvent: se } = await import("@freedomstack/protocol");
    await (await ensurePool()).publish(se(buildModeratorList(
      spacesUi.spaceId, state.keypair.pk, mods, regeln ?? undefined), state.keypair.sk));
    toast(`${mods.length} Moderator(en) benannt`);
    await oeffneRaum(spacesUi.spaceId);
  } catch (e) {
    toast((e as Error).message, true);
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
  const join = $("#space-join");
  if (join) join.onclick = () => {
    const id = prompt("Raum-Kennung:");
    if (!id?.trim()) return;
    raumBeitreten(id.trim());
    void oeffneRaum(id.trim());
  };
  const mods = $("#space-mods");
  if (mods) mods.onclick = () => void ernenneModeratoren();
  const info = $("#space-info");
  if (info) info.onclick = async () => {
    const st = spacesUi.state as { space?: { channels: never[] } } | null;
    const kanal = (st?.space?.channels as { id: string }[] | undefined)
      ?.find((c) => c.id === spacesUi.channelId);
    if (!kanal) return;
    const { privacyInfo } = await import("@freedomstack/protocol");
    alert(privacyInfo(kanal as never));
  };

  const raeume = meineRaeume();
  if (raeume.length > 0) await oeffneRaum(raeume[0]);
  else void zeigeRaumLeiste();
}

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
  throw new Error("kein blossom-server erreichbar — datei zu gross fuer inline");
}

export async function handleChatFiles(files: FileList | null): Promise<void> {
  if (!files || files.length === 0) return;
  const listEl = $("#chat-attach-list");
  for (const file of Array.from(files)) {
    try {
      let url: string;
      if (file.size <= 80_000) {
        // klein: inline als data-url (funktioniert offline, kein server)
        url = await new Promise<string>((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result as string);
          r.onerror = rej;
          r.readAsDataURL(file);
        });
      } else {
        // gross: blob-netz (chunked + erasure, torrent-artig). blossom nur fallback.
        setAttachStatus(listEl, `${file.name}: chunking…`);
        try {
          const { uploadBlob } = await import("../../blob-client.js");
          const pool = await ensurePool();
          const res = await uploadBlob(file, pool as never, state.keypair!, signEvent as never);
          url = `freedom-blob:${res.blobId}`;
        } catch {
          setAttachStatus(listEl, `${file.name}: blossom-fallback…`);
          url = await uploadToBlossom(file);
        }
      }
      chatAttachments.push({ name: file.name, mime: file.type || "application/octet-stream", size: file.size, url });
      setAttachStatus(listEl, chatAttachments.map((a) => `${a.name} (${Math.round(a.size / 1024)}kb)`).join(", "));
    } catch (e) {
      toast(`${file.name}: ${(e as Error).message}`, true);
    }
  }
}

function setAttachStatus(el: HTMLElement | null, text: string): void {
  if (el) el.textContent = text;
}


/** Blob-Buttons aktivieren: Chunks aus dem Netz holen und als Download geben. */
function wireBlobButtons(root: HTMLElement): void {
  root.querySelectorAll(".chat-blob-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const el = btn as HTMLElement;
      const oldText = el.textContent ?? "";
      el.textContent = "lade…";
      try {
        const { downloadBlob } = await import("../../blob-client.js");
        const pool = await ensurePool();
        const res = await downloadBlob(el.dataset.blob!, pool as never);
        if (!res) throw new Error("nicht genug shards im netz gefunden");
        const url = URL.createObjectURL(new Blob([res.bytes as BlobPart], { type: res.mime }));
        const a = document.createElement("a");
        a.href = url;
        a.download = res.name || el.dataset.name || "datei";
        a.click();
        URL.revokeObjectURL(url);
        el.textContent = oldText;
      } catch (e) {
        toast(`blob: ${(e as Error).message}`, true);
        el.textContent = oldText;
      }
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
function setzeKommModus(modus: "dm" | "space"): void {
  const layout = document.querySelector<HTMLElement>(".comm-layout");
  if (layout) layout.dataset.commMode = modus;
  document.getElementById("comm-dm-btn")?.setAttribute("aria-current", String(modus === "dm"));
  layout?.classList.remove("thread-open");
  if (modus === "dm") {
    document.querySelectorAll("#space-rail .space-pill").forEach((p) => p.setAttribute("aria-current", "false"));
    loadChatList();
  }
}

export function wireKommunikation(): void {
  document.getElementById("comm-dm-btn")?.addEventListener("click", () => setzeKommModus("dm"));
  // Die Leistenknoepfe loesen die vorhandenen Aktionen aus — keine zweite Logik.
  // Mobil: eine Ebene zur Zeit, wie Discord — Liste, oder nach dem Antippen der Chat.
  const layout = document.querySelector<HTMLElement>(".comm-layout");
  document.getElementById("chat-list")?.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".chat-item")) layout?.classList.add("thread-open");
  });
  document.getElementById("chat-back")?.addEventListener("click", () =>
    layout?.classList.remove("thread-open"));
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
}

export let conversations: ChatConversation[] = [];
export let activeConversation: string | null = null;

function loadConversations(): void {
  try {
    conversations = JSON.parse(localStorage.getItem("freedom.chats") ?? "[]");
  } catch { conversations = []; }
}

function saveConversations(): void {
  localStorage.setItem("freedom.chats", JSON.stringify(conversations));
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
        const { buildPetname, signEvent: se } = await import("@freedomstack/protocol");
        await (await ensurePool()).publish(se(buildPetname({
          byPubkey: state.keypair!.pk, forPubkey: pubkey, name: name.trim(),
        }), state.keypair!.sk));
      } catch { /* lokal gilt der Name trotzdem */ }
    })();
  }
}

export function loadChatList(): void {
  void syncDmInbox();
  loadConversations();
  const list = $("#chat-list");
  if (conversations.length === 0) {
    list.innerHTML = `<div class="mono-sm" style="padding:10px;color:var(--text-muted)">Noch keine Unterhaltungen. Mit + beginnst du eine.</div>`;
    return;
  }
  list.innerHTML = conversations
    .sort((a, b) => b.lastTs - a.lastTs)
    .map(
      (c) => `<div class="chat-item ${c.id === activeConversation ? "active" : ""}" data-cid="${escapeHtml(c.id)}">
        <span class="av">${c.type === "community" ? "🏠" : escapeHtml(c.name.slice(0, 1).toUpperCase())}</span>
        <span class="label">${escapeHtml(c.name)}</span>
      </div>`,
    )
    .join("");
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
      const name = prompt(`Eigener Name für ${pkShort(cid)}:`, c.name);
      if (name === null) return;
      const teilen = name.trim()
        ? confirm(
            `„${name.trim()}" auch veröffentlichen?\n\n` +
            `Dann sehen andere diesen Namen als Hinweis — und erfahren, dass du ` +
            `diese Person kennst. Abbrechen: gilt nur für dich.`)
        : false;
      setzePetname(cid, name, teilen);
      c.name = name.trim() || pkShort(cid);
      saveConversations();
      loadChatList();
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
  thread.innerHTML = `<div class="empty-state">${c ? escapeHtml(c.name) : ""}<br/>` +
    (c?.type === "dm" ? "1:1 — Ende-zu-Ende verschlüsselt (NIP-17). Relays sehen nicht, wer schreibt – nur, dass du Post bekommst." : "community — opt-in gruppe.") +
    `</div>`;
  loadChatMessages(cid);
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
type DmAnzeige = NostrEvent & { legacy?: boolean };

/** Bereits geoeffnete Umschlaege (ID des Umschlags -> Ergebnis), damit nichts doppelt entschluesselt wird. */
const dmCache = new Map<string, { partner: string; ev: DmAnzeige } | null>();

async function oeffneUmschlag(w: NostrEvent): Promise<{ partner: string; ev: DmAnzeige } | null> {
  const bekannt = dmCache.get(w.id);
  if (bekannt !== undefined) return bekannt;
  if (!state.keypair) return null;
  const { openPrivateDm } = await import("@freedomstack/protocol");
  const r = await openPrivateDm(w, state.keypair.sk, state.keypair.pk);
  const e = r.ok
    ? {
        partner: r.dm.partner,
        ev: { id: r.dm.id, pubkey: r.dm.from, created_at: r.dm.createdAt, kind: 14, tags: [], content: r.dm.content, sig: "" },
      }
    : null;
  dmCache.set(w.id, e);
  return e;
}

/**
 * Alle Nachrichten einer 1:1-Unterhaltung: NIP-17-Umschlaege an mich (auch
 * meine eigenen Kopien) plus aeltere Kind-4-Nachrichten, die weiter lesbar
 * bleiben, aber nie mehr gesendet werden.
 */
async function ladeDmNachrichten(partner: string): Promise<DmAnzeige[]> {
  if (!state.keypair) return [];
  const me = state.keypair;
  const pool = await ensurePool();
  const { decryptDM } = await import("@freedomstack/protocol");
  const [umschlaege, alt] = await Promise.all([
    pool.query({ kinds: [1059], "#p": [me.pk], limit: 500 }),
    pool.query({ kinds: [4], authors: [me.pk, partner], limit: 50 }),
  ]);
  const ergebnis = new Map<string, DmAnzeige>();
  for (const w of umschlaege) {
    const e = await oeffneUmschlag(w);
    if (e && e.partner === partner) ergebnis.set(e.ev.id, e.ev);
  }
  for (const ev of alt) {
    // Nur Nachrichten zwischen genau uns beiden – nicht die des Partners an Dritte.
    const pTag = ev.tags.find((t) => t[0] === "p")?.[1];
    const betrifft = (ev.pubkey === me.pk && pTag === partner) || (ev.pubkey === partner && pTag === me.pk);
    if (!betrifft || ergebnis.has(ev.id)) continue;
    let text: string;
    try {
      text = await decryptDM(ev.content, me.sk, ev.pubkey === me.pk ? partner : ev.pubkey);
    } catch {
      text = "[entschluesselung fehlgeschlagen]";
    }
    ergebnis.set(ev.id, { ...ev, content: text, legacy: true });
  }
  return [...ergebnis.values()];
}

/**
 * Umschlag an den Posteingang des Empfaengers (Kind 10050) und an die
 * eigenen Relays. Ohne veroeffentlichte Liste bleiben die gemeinsamen Relays.
 */
async function veroeffentlicheDm(wrap: NostrEvent, empfaenger: string): Promise<void> {
  const pool = await ensurePool();
  const { parseDmRelayList, KIND_DM_RELAYS } = await import("@freedomstack/protocol");
  let ziele: string[] = [];
  try {
    const listen = await pool.query({ kinds: [KIND_DM_RELAYS], authors: [empfaenger], limit: 5 });
    ziele = parseDmRelayList(listen.sort((a, b) => b.created_at - a.created_at)[0]);
  } catch {
    /* ohne Liste: gemeinsame Relays */
  }
  await pool.publish(wrap);
  const zusaetzlich = ziele.filter((u) => !RELAYS.includes(u)).slice(0, 3);
  if (zusaetzlich.length === 0) return;
  const extra = new OutboxPool(zusaetzlich.map((u) => new WebSocketRelay(u, { timeoutMs: 8000 })), { minAcks: 1 });
  try {
    await extra.publish(wrap);
  } catch {
    /* Posteingang nicht erreichbar – die gemeinsamen Relays haben den Umschlag */
  } finally {
    (extra as unknown as { close?: () => void }).close?.();
  }
}

let letzterDmAbgleich = 0;

/**
 * Posteingang abgleichen: Neue Absender erscheinen als „Anfrage“ in der Liste,
 * und die eigenen Posteingangs-Relays werden einmal als Kind 10050
 * veroeffentlicht. Hoechstens einmal pro Minute.
 */
async function syncDmInbox(): Promise<void> {
  if (!state.keypair || Date.now() - letzterDmAbgleich < 60_000) return;
  letzterDmAbgleich = Date.now();
  try {
    const me = state.keypair;
    const pool = await ensurePool();
    const { KIND_DM_RELAYS, buildDmRelayList } = await import("@freedomstack/protocol");
    const eigene = await pool.query({ kinds: [KIND_DM_RELAYS], authors: [me.pk], limit: 1 });
    if (eigene.length === 0) {
      await pool.publish(signEvent(buildDmRelayList(me.pk, RELAYS), me.sk)).catch(() => { /* offline */ });
    }
    const umschlaege = await pool.query({ kinds: [1059], "#p": [me.pk], limit: 200 });
    let neu = 0;
    for (const w of umschlaege) {
      const e = await oeffneUmschlag(w);
      if (!e || e.partner === me.pk) continue;
      const vorhanden = conversations.find((x) => x.id === e.partner);
      if (!vorhanden) {
        conversations.push({ id: e.partner, type: "dm", name: "Anfrage · " + pkShort(e.partner), lastTs: e.ev.created_at });
        neu++;
      } else if (e.ev.created_at > (vorhanden.lastTs ?? 0)) {
        vorhanden.lastTs = e.ev.created_at;
      }
    }
    if (neu > 0) {
      saveConversations();
      loadChatList();
    }
  } catch {
    /* offline */
  }
}

export async function loadChatMessages(cid: string): Promise<void> {
  // DMs: kind 4 (NIP-44, p-tag = partner). Communities: kind 42 (channel) mit h-tag.
  const c = conversations.find((x) => x.id === cid);
  if (!c || !state.keypair) return;
  try {
    const pool = await ensurePool();
    let events: NostrEvent[] = [];
    if (c.type === "dm") {
      events = await ladeDmNachrichten(c.id);
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
        if (r.hidden) versteckt.set(r.event.id, { reason: r.reason ?? "ausgeblendet" });
      }
    }

    thread.innerHTML = decrypted
      .sort((a, b) => a.created_at - b.created_at)
      .map((ev) => {
        const mine = ev.pubkey === state.keypair!.pk;
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
        const media = atts.map((a) => renderAttachment(a)).join("");
        const body = escapeHtml(text);
        // Zap-Button neben jeder Nachricht (nur fuer DMs, nicht eigene)
        const v = versteckt.get(ev.id);
        if (v) {
          // Platzhalter statt spurlosem Entfernen: Eine Luecke, die man sieht,
          // ist Moderation. Eine, die man nicht sieht, ist Manipulation.
          return `<div class="bubble hidden-msg"><div class="txt mono-sm">` +
            `[ausgeblendet: ${escapeHtml(v.reason)}] ` +
            `<button class="ghost show-anyway" data-id="${escapeHtml(ev.id)}" ` +
            `style="width:auto;padding:2px 6px;font-size:10px">trotzdem zeigen</button></div></div>`;
        }
        const zapBtn = !mine && c.type === "dm" ? `<button class="zap-msg-btn" data-pk="${escapeHtml(ev.pubkey)}" data-name="${escapeHtml(pkShort(ev.pubkey))}" title="zap senden">⚡</button>` : "";
        const alt = (ev as DmAnzeige).legacy
          ? ` <span class="mono-sm" title="ältere Verschlüsselung (Kind 4): Relays sehen Absender und Empfänger">· alt</span>`
          : "";
        return `<div class="bubble ${mine ? "user" : "ai"}"><div class="who">${mine ? "du" : escapeHtml(pkShort(ev.pubkey))}${alt}${zapBtn}</div><div class="txt">${body}${media}</div></div>`;
      })
      .join("");
    thread.scrollTop = thread.scrollHeight;
    wireBlobButtons(thread);
    thread.querySelectorAll(".show-anyway").forEach((b) => {
      b.addEventListener("click", () => {
        const id = (b as HTMLElement).dataset.id!;
        const ev = decrypted.find((x) => x.id === id);
        if (ev) alert(ev.content);
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
    const imeta: string[][] = chatAttachments.map((a) => [
      "imeta", `url ${a.url}`, `m ${a.mime}`, `name ${a.name}`,
    ]);
    if (c.type === "dm") {
      // NIP-17: Inhalt (Kind 14) im Siegel (Kind 13) im Umschlag (Kind 1059).
      // Relays sehen weder Inhalt noch Absender. Dazu eine Kopie an sich selbst.
      const { buildPrivateDm } = await import("@freedomstack/protocol");
      const payload = chatAttachments.length > 0
        ? JSON.stringify({ text, attachments: chatAttachments })
        : text;
      const dm = await buildPrivateDm({
        senderSk: state.keypair.sk,
        senderPk: state.keypair.pk,
        recipientPk: c.id,
        content: payload,
      });
      await veroeffentlicheDm(dm.toRecipient, c.id);
      await pool.publish(dm.toSelf);
    } else {
      // Community: kind 42 mit h-tag (channel-id)
      const ev = signEvent(buildEvent(state.keypair.pk, 42, [["h", c.id], ...imeta], text), state.keypair.sk);
      await pool.publish(ev);
    }
    input.value = "";
    chatAttachments = [];
    setAttachStatus($("#chat-attach-list"), "");
    c.lastTs = Math.floor(Date.now() / 1000);
    saveConversations();
    loadChatMessages(activeConversation);
  } catch (e) {
    toast(`Fehler: ${(e as Error).message}`, true);
  }
}

export async function newDm(): Promise<void> {
  const eingabe = prompt("Schlüssel des Kontakts (npub oder hex):");
  if (!eingabe) return;
  let id = eingabe.trim();
  if (id.startsWith("npub1")) {
    try {
      const { decodeNpub } = await import("../../identity.js");
      id = decodeNpub(id);
    } catch {
      toast("Das ist kein gültiger npub.", true);
      return;
    }
  }
  id = id.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(id)) {
    toast("Bitte einen npub oder einen 64-stelligen Hex-Schlüssel eingeben.", true);
    return;
  }
  if (!conversations.find((c) => c.id === id)) {
    conversations.push({ id, type: "dm", name: id.slice(0, 12) + "…", lastTs: 0 });
    saveConversations();
  }
  loadChatList();
  openConversation(id);
}

export function newCommunity(): void {
  const name = prompt("name der community:");
  if (!name) return;
  const id = "comm-" + Math.random().toString(36).slice(2, 10);
  conversations.push({ id, type: "community", name: name.trim(), lastTs: 0 });
  saveConversations();
  loadChatList();
  openConversation(id);
}
