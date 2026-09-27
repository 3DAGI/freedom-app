/**
 * Tab Kommunikation: Direktnachrichten (NIP-17), Communities, Räume mit
 * Kanälen und Moderation, Anhänge (inline, Blob-Netz, Blossom).
 *
 * Aus app.ts verschoben (Schritt 1.0) – wörtlich, ohne Logikänderung.
 */
import { type DateiSchluessel, type KeyState, MELDE_GRUENDE, type MeldeGrund, NostrEvent, type PrivateDm, buildEvent } from "@freedomstack/protocol";
import {
  type ChatAttachment,
  escapeHtml,
  parseDmBody,
  parseImetaTags,
  pkShort,
  imetaSchluessel,
  renderAttachment,
} from "../../shell-logic.js";
import { aktuellerKurs } from "../marktkurs.js";
import { alsGeraet, eigeneRelayListen, ensurePool, posteingangVon, signiere, solRpcUrl, solTransaktion, sprichtFuer, state, veroeffentlicheAn } from "../state.js";
import { alsNachfolge } from "../nachfolge-ui.js";
import { alsPruefauftrag } from "../pruefauftraege-ui.js";
import { LS_MANDATE, leseGemerkt, nachDiebstahl, pruefeKontakte, warnt } from "../../schluessel-status.js";
import { type DmZuordnung, GeraeteBuch, ordneDmZu } from "../../geraete-buch.js";
import { sucheAufnehmen, wireSuche } from "../suche-ui.js";
import { mlsAbgleichen, mlsBeiNeuem, mlsEinladungAnnehmen, mlsErreichbar, mlsGesperrt, mlsSendeAn, mlsVerlauf } from "../mls-konto.js";
import {
  PRIVAT, type PrivaterRaum, alsRaumMeldung, entferneAusRaum, gruppeVon, istPrivat, ladeInPrivatenRaum, ladePrivatenRaum, legePrivatenRaumAn,
  loescheImRaum, meldeImRaum, meldungErledigt, meldungenFuer, merkePrivatenRaum, privateRaeume, sendePrivat, setzeModeratoren, wennMeldung,
} from "../raum-mls.js";
import { geheim } from "../tresor.js";
import { $, toast } from "../ui.js";

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
}

const spacesUi: SpaceUiState = {
  spaceId: null, channelId: null, state: null, messages: [], lastRead: new Map(), privat: null,
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
function oeffentlicheRaeume(): string[] {
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
    const name = istPrivat(id) ? privatNamen.get(id) ?? "privater Raum" : id;
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
  if (spacesUi.spaceId !== spaceId) spacesUi.channelId = null;
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
      $("#space-name").textContent = `privater Raum nicht verfügbar${mlsGesperrt() ? ` – ${mlsGesperrt()}` : ""}`;
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
    $("#space-name").textContent = `nicht erreichbar: ${(e as Error).message}`;
    return;
  }
  void zeigeRaumLeiste();
  await zeigeKanalliste();
}

/**
 * Art des Raums sichtbar machen (2.3b): Offene Räume liest jeder mit – der
 * Hinweis steht über dem Raum. Einladen nur privat und als Moderator.
 */
function zeigeRaumArt(spaceId: string): void {
  const privat = istPrivat(spaceId);
  document.getElementById("space-oeffentlich")?.classList.toggle("hidden", privat);
  const moderator = !!spacesUi.privat && spacesUi.privat.admins.includes(spacesUi.privat.ich);
  document.getElementById("space-invite")?.classList.toggle("hidden", !privat || !moderator);
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
          // Private Räume moderieren über MLS (2.3c) – nie mit öffentlichen Sperr-Events
          const modKnopf = darfModerieren && !spacesUi.privat && m.authorPubkey !== state.keypair?.pk
            ? `<button class="thread-link mod-hide" data-id="${escapeHtml(m.id)}"
                 data-pk="${escapeHtml(m.authorPubkey)}" style="color:#9A6A6A">moderieren</button>`
            : "";
          const raumKnopf = spacesUi.privat
            ? `<button class="thread-link raum-aktion" data-id="${escapeHtml(m.id)}"
                 data-pk="${escapeHtml(m.authorPubkey)}">${escapeHtml(raumAktionText(m.authorPubkey))}</button>`
            : "";
          return `<div class="msg-group">
            <div class="msg-meta">
              <span class="msg-author">${escapeHtml(pkShort(m.authorPubkey))}</span>
              <span class="msg-time">${escapeHtml(new Date(m.createdAt * 1000).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }))}</span>
            </div>
            <div class="msg-text">${escapeHtml(m.content)}</div>${antworten}${modKnopf}${raumKnopf}</div>`;
        }).join("");
    thread.scrollTop = thread.scrollHeight;
    thread.querySelectorAll(".raum-aktion").forEach((b) => {
      b.addEventListener("click", () => void raumAktion((b as HTMLElement).dataset.id!, (b as HTMLElement).dataset.pk!));
    });
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

/** Private Räume (2.3c): was ich mit einer Nachricht tun kann. */
function raumAktionText(autor: string): string {
  const raum = spacesUi.privat;
  if (!raum) return "";
  return autor === raum.ich ? "löschen" : raum.admins.includes(raum.ich) ? "moderieren" : "melden";
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
    if (!confirm("Eigene Nachricht löschen? Wer sie schon gelesen hat, hatte sie.")) return;
    ok = await loescheImRaum(raum, id);
  } else if (raum.admins.includes(raum.ich)) {
    const wahl = prompt("Moderieren: 1 = Nachricht für alle löschen, 2 = Absender aus dem Raum entfernen (neuer Schlüssel, keine Sperrliste)", "1");
    if (wahl?.trim() === "1") ok = await loescheImRaum(raum, id);
    else if (wahl?.trim() === "2") ok = await entferneAusRaum(raum, autor);
    else return;
  } else {
    const grund = prompt(`Melden – nur die Moderatoren erfahren es, versiegelt. Grund (${MELDE_GRUENDE.join(", ")}):`, "spam")?.trim();
    if (!grund) return;
    if (!(MELDE_GRUENDE as readonly string[]).includes(grund)) {
      toast("Unbekannter Grund", true);
      return;
    }
    const notiz = prompt("Kurze Notiz (optional, nur für die Moderatoren):") ?? "";
    const n = await meldeImRaum(raum, id, autor, grund as MeldeGrund, notiz).catch(() => 0);
    toast(n > 0 ? `Gemeldet – versiegelt an ${n} Moderator(en)` : "Nicht gemeldet – kein Moderator erreichbar", n === 0);
    return;
  }
  toast(ok ? "Erledigt" : "Nicht geändert – kein Relay der Gruppe nahm an", !ok);
  await oeffneRaum(spacesUi.spaceId!);
}

/** Meldungen zum offenen Raum – nur Moderatoren sehen sie, nur aus dem Speicher (8.5). */
function zeigeMeldungen(): void {
  const box = document.getElementById("raum-meldungen");
  if (!box) return;
  const raum = spacesUi.privat;
  const liste = raum ? meldungenFuer(raum) : [];
  box.classList.toggle("hidden", liste.length === 0);
  box.replaceChildren(...liste.map(([wrapId, m]) => {
    const z = document.createElement("div");
    z.className = "member-row";
    z.style.display = "block";
    const text = document.createElement("div");
    text.textContent = `Meldung von ${kontaktName(m.von)} über ${kontaktName(m.autor)} · ${m.grund}${m.notiz ? ` – ${m.notiz}` : ""}`;
    z.append(text);
    const aktionen: [string, () => Promise<boolean>][] = [
      ["löschen", () => loescheImRaum(raum!, m.ziel)], ["entfernen", () => entferneAusRaum(raum!, m.autor)], ["erledigt", async () => true],
    ];
    for (const [label, tun] of aktionen) {
      const b = document.createElement("button");
      b.className = "ghost mini";
      b.textContent = label;
      b.addEventListener("click", async () => {
        if (!(await tun().catch(() => false))) return toast("Nicht geändert – kein Relay der Gruppe nahm an", true);
        await meldungErledigt(wrapId);
        await oeffneRaum(spacesUi.spaceId!);
      });
      z.append(b);
    }
    return z;
  }));
}

/** Mitglieder mit ihren Rollen. */
async function zeigeMitglieder(): Promise<void> {
  const box = $("#member-list");
  const privat = spacesUi.privat;
  if (box && privat) {
    // Privat (2.3b): Mitglieder der Gruppe; Moderatoren sind ihre Admins
    const rollen = privat.zustand.roles;
    box.replaceChildren(...privat.mitglieder.map((pk) => {
      const z = document.createElement("div");
      z.className = "member-row";
      // Moderatoren haben jede Rolle – dort nur „Moderator“ zeigen
      const eigene = privat.admins.includes(pk) ? [] : (privat.zustand.grants.get(pk) ?? []).filter((r) => !r.startsWith("__") && r !== "mitglied").map((r) => rollen.get(r)?.name ?? r);
      const text = `${pkShort(pk)}${privat.admins.includes(pk) ? " · Moderator" : ""}${eigene.length ? ` · ${eigene.join(", ")}` : ""}`;
      z.textContent = pk === privat.ich ? `${text} (du)` : text;
      return z;
    }));
    zeigeMeldungen();
    return;
  }
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
  if (spacesUi.privat) {
    // Privat (2.3b): verschlüsselt in die Gruppe – Relays sehen nur Kind 445
    if (await sendePrivat(spacesUi.privat.gruppe, spacesUi.channelId, text).catch(() => false)) await oeffneRaum(spacesUi.spaceId);
    else {
      toast("Nicht gesendet – kein Relay der Gruppe nahm an", true);
      input.value = text;
    }
    return;
  }
  try {
    const { buildChannelMessage } = await import("@freedomstack/protocol");
    const ev = await signiere(buildChannelMessage({
      authorPubkey: state.keypair.pk, spaceId: spacesUi.spaceId,
      channelId: spacesUi.channelId, content: text, mentions: [],
    } as never));
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
async function legeRaumAn(oeffentlich = false): Promise<void> {
  if (!state.keypair) return;
  // Neue Räume sind privat (2.3b); öffentlich nur ausdrücklich und mit Hinweis
  if (oeffentlich && !confirm(OEFFENTLICH_WARNUNG)) return;
  const name = prompt(oeffentlich ? "Name des öffentlichen Raums:" : "Name des privaten Raums:");
  if (!name?.trim()) return;
  if (!oeffentlich) {
    try {
      const gruppe = await legePrivatenRaumAn(name.trim());
      await oeffneRaum(PRIVAT + gruppe);
      toast("Privater Raum angelegt – Mitglieder über „einladen“ hinzufügen");
    } catch (e) {
      toast((e as Error).message, true);
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
        { id: "ankuendigungen", name: "ankündigungen", privacy: "offen", writeRoles: ["mod"], position: 1 },
      ],
    } as never)));

    await pool.publish(await signiere(buildRoles(spaceId, state.keypair.pk, [
      { id: "mod", name: "Moderator", rank: 50,
        permissions: ["lesen", "schreiben", "threads", "moderieren", "rollen_vergeben"] },
      { id: "mitglied", name: "Mitglied", rank: 10,
        permissions: ["lesen", "schreiben", "threads"] },
    ] as never)));

    raumBeitreten(spaceId);
    await oeffneRaum(spaceId);
    // Die Kennung ist der einzige Weg, wie jemand hereinkommt.
    prompt("Raum angelegt. Diese Kennung weitergeben:", spaceId);
  } catch (e) {
    toast((e as Error).message, true);
  }
}

const OEFFENTLICH_WARNUNG =
  "Öffentlicher Raum: Jeder kann mitlesen, auch ohne diese App – die Nachrichten liegen unverschlüsselt auf den Relays, " +
  "mit deinem Schlüssel als Absender. Private Räume sind Ende-zu-Ende-verschlüsselt.\n\nTrotzdem öffentlich anlegen?";

/** Name eines Kontakts, sonst der gekürzte Schlüssel. */
const kontaktName = (pk: string) => conversations.find((c) => c.type === "dm" && c.id === pk)?.name ?? pkShort(pk);

/** In einen privaten Raum einladen (2.3b): Kontakt wählen, KeyPackage suchen, Einladung versiegelt an seinen Posteingang. */
async function ladeEin(): Promise<void> {
  const raum = spacesUi.privat;
  if (!raum) return;
  const kontakte = conversations.filter((c) => c.type === "dm" && /^[0-9a-f]{64}$/.test(c.id) && !raum.mitglieder.includes(c.id));
  const liste = kontakte.map((c, i) => `${i + 1}: ${c.name}`).join("\n");
  const eingabe = prompt(kontakte.length ? `Wen einladen? Nummer eines Kontakts oder ein Schlüssel (hex):\n${liste}` : "Wen einladen? Schlüssel (hex):");
  if (!eingabe?.trim()) return;
  const n = Number(eingabe.trim());
  const pk = Number.isInteger(n) && n >= 1 && n <= kontakte.length ? kontakte[n - 1]!.id : eingabe.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pk)) {
    toast("Kein gültiger Schlüssel", true);
    return;
  }
  toast("Lade ein …");
  const r = await ladeInPrivatenRaum(raum, pk).catch((e) => (e as Error).message);
  toast(r === "eingeladen" ? `${kontaktName(pk)} eingeladen – versiegelt an den Posteingang` : `Nicht eingeladen: ${r}`, r !== "eingeladen");
  await oeffneRaum(spacesUi.spaceId!);
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
  const { can, buildHide, buildBan, buildRoleGrant } =
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
      await pool.publish(await signiere(buildRoleGrant(
        spacesUi.spaceId, state.keypair.pk, ziel, [rolle.trim()])));
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
      await pool.publish(await signiere(ev));
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
  const raum = spacesUi.privat;
  if (raum) {
    // Privat (2.3b): Moderatoren sind die Admins der Gruppe – gesetzt per MLS-Commit, nie als Event
    if (!raum.admins.includes(raum.ich)) {
      toast("Nur Moderatoren ernennen Moderatoren", true);
      return;
    }
    const andere = raum.mitglieder.filter((m) => m !== raum.ich);
    const liste = andere.map((m, i) => `${i + 1}: ${kontaktName(m)}${raum.admins.includes(m) ? " (Moderator)" : ""}`).join("\n");
    const vorher = andere.map((m, i) => (raum.admins.includes(m) ? String(i + 1) : "")).filter(Boolean).join(",");
    const eingabe = prompt(`Wer soll Moderator sein? Nummern, kommagetrennt – du bleibst es:\n${liste}`, vorher);
    if (eingabe === null) return;
    const mods = eingabe.split(",").map((x) => andere[Number(x.trim()) - 1]).filter((x): x is string => !!x);
    if (await setzeModeratoren(raum, mods)) {
      toast(`${mods.length} Moderator(en) neben dir`);
      await oeffneRaum(spacesUi.spaceId);
    } else toast("Nicht geändert – kein Relay der Gruppe nahm an", true);
    return;
  }
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
    const { buildModeratorList } = await import("@freedomstack/protocol");
    await (await ensurePool()).publish(await signiere(buildModeratorList(
      spacesUi.spaceId, state.keypair.pk, mods, regeln ?? undefined)));
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
  const oeffentlich = $("#space-create-public");
  if (oeffentlich) oeffentlich.onclick = () => void legeRaumAn(true);
  const einladen = $("#space-invite");
  if (einladen) einladen.onclick = () => void ladeEin();
  // Meldungen (8.5) kommen über den Posteingang – für Moderatoren gleich zeigen
  wennMeldung(() => zeigeMeldungen());
  // Private Räume (2.3b): solange einer offen und sichtbar ist, alle 30 s abgleichen
  setInterval(() => {
    if (spacesUi.privat && spacesUi.spaceId && !document.hidden && document.getElementById("channel-thread")?.offsetParent) void oeffneRaum(spacesUi.spaceId);
  }, 30_000);
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
        setAttachStatus(listEl, `${file.name}: verschlüssele…`);
        try {
          const { uploadAnhang } = await import("../../blob-client.js");
          const pool = await ensurePool();
          const res = await uploadAnhang(file, pool as never, state.signer!);
          url = `freedom-blob:${res.blobId}`;
          enc = res.schluessel;
        } catch {
          setAttachStatus(listEl, `${file.name}: blossom-fallback…`);
          const { verschluesseleDatei } = await import("@freedomstack/protocol");
          const { chiffrat, schluessel } = verschluesseleDatei(new Uint8Array(await file.arrayBuffer()));
          url = await uploadToBlossom(new File([chiffrat as BlobPart], "", { type: "application/octet-stream" }));
          enc = schluessel;
        }
      }
      chatAttachments.push({ name: file.name, mime: file.type || "application/octet-stream", size: file.size, url, ...(enc ? { enc } : {}) });
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
        const { downloadBlob, oeffneAnhang } = await import("../../blob-client.js");
        const pool = await ensurePool();
        const d = el.dataset;
        let datei: { bytes: Uint8Array; mime: string; name: string };
        if (d.key) {
          // Verschluesselt (2.4): Chiffrat holen, mit dem Schluessel aus der Nachricht oeffnen.
          let chiffrat: Uint8Array;
          if (d.blob) {
            const res = await downloadBlob(d.blob, pool as never);
            if (!res) throw new Error("nicht genug shards im netz gefunden");
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
          if (!res) throw new Error("nicht genug shards im netz gefunden");
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
    .catch((e) => toast(`Unterhaltungen nicht gespeichert: ${(e as Error).message}`, true));
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
    (c?.type === "dm" ? escapeHtml(dmHinweis(c)) : "community — opt-in gruppe.") +
    `</div>`;
  zeigeAblauf(c);
  loadChatMessages(cid);
  // Erst hier wird MLS gebraucht (2.2b-d1): eigenes KeyPackage, wenn keins da oder faellig
  if (c?.type === "dm") void mlsErreichbar().catch(() => undefined);
}

/** Wie diese 1:1-Unterhaltung verschluesselt ist (2.2b-d2) – feste Texte. */
function dmHinweis(c: ChatConversation): string {
  const nip17 = "1:1 — Ende-zu-Ende verschlüsselt (NIP-17). Relays sehen nicht, wer schreibt – nur, dass du Post bekommst.";
  if (c.ablaufSecs) return `${nip17} Mit Ablauf bleibt es bei NIP-17.`;
  const gesperrt = mlsGesperrt();
  if (gesperrt) {
    return `${nip17} MLS geht hier nicht: ${gesperrt}.` + (c.mls
      ? " Was dein Kontakt über eure MLS-Gruppe schickt, liest die App erst, wenn MLS hier wieder geht – solange die Relays es halten."
      : "");
  }
  return c.mls
    ? "1:1 — über MLS (Marmot): mit Vorwärtsgeheimnis. Relays sehen nur eine zufällige Gruppen-Id und für jede Nachricht einen neuen Schlüssel. Eure Geräte sind eigene Mitglieder; fehlt einem das KeyPackage, geht die Nachricht per NIP-17, damit jedes Gerät sie bekommt."
    : `${nip17} Können der Kontakt und eure Geräte MLS, geht deine nächste Nachricht darüber.`;
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
  toast(c.ablaufSecs
    ? "Neue Nachrichten laufen ab. Löschen ist eine Bitte an die Relays – wer sie schon hat, behält sie."
    : "Neue Nachrichten laufen nicht mehr ab.");
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
  /** Geschrieben von einem Geraet (8.6b): Hinweis mit Geraetenamen (Fremddaten). */ geraet?: { text: string; warnung: boolean };
  /** Ueber MLS empfangen (2.2b-d1) – aus dem Verlauf auf diesem Geraet. */ mls?: boolean;
};

/** Vollmachten der Geraete – eigene und die der Kontakte (8.6b). */
export const geraeteBuch = new GeraeteBuch(async (f) => (await ensurePool()).query(f as never));

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
    // Keine DM: vielleicht ein SOL-Trinkgeld-Beleg (4.7b), eine Adress-Anfrage (4.9d), Nachfolge (8.11b) oder ein Pruefauftrag (5.6c).
    : (await alsTrinkgeld(w)) ?? (await alsAdressAnfrage(w)) ?? (await alsNachfolge(w)) ?? (await alsPruefauftrag(w)) ?? (await alsRaumMeldung(w));
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
    toast(`Einladung in einen privaten Raum von ${kontaktName(e.von)} – in der Raumleiste`);
    return null;
  }
  let c = conversations.find((x) => x.type === "dm" && x.id === r.partner);
  if (!c) {
    c = { id: r.partner, type: "dm", name: "Anfrage · " + pkShort(r.partner), lastTs: Math.floor(Date.now() / 1000) };
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
const ENTSCHLUESSELUNG_FEHLGESCHLAGEN = "[entschluesselung fehlgeschlagen]";

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
      text = ENTSCHLUESSELUNG_FEHLGESCHLAGEN;
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
        conversations.push({ id: e.partner, type: "dm", name: "Anfrage · " + pkShort(e.partner), lastTs: e.ev.created_at });
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
    pool.query({ kinds: [KIND_ROTATION_MANDATE], authors: kontakte, limit: 200 }),
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
    el.title = st.message;
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
  text.textContent = `⚠ ${st!.message}`;
  box.append(text);
  if ((st!.status === "widerrufen" || st!.status === "abgeloest") && st!.currentPubkey !== partner) {
    const b = document.createElement("button");
    b.className = "ghost";
    b.id = "schluessel-wechsel";
    b.style.cssText = "width:auto;padding:3px 8px;margin-top:6px";
    b.textContent = `zum neuen Schlüssel wechseln (${pkShort(st!.currentPubkey)})`;
    b.addEventListener("click", () => wechsleZuNeuemSchluessel(partner, st!.currentPubkey));
    box.append(b);
  }
  thread.prepend(box);
}

/** Die Unterhaltung mit dem Nachfolger weiterfuehren; die alte bleibt markiert stehen. */
function wechsleZuNeuemSchluessel(alt: string, neu: string): void {
  if (!/^[0-9a-f]{64}$/.test(neu)) return;
  const c = conversations.find((x) => x.id === alt);
  if (!conversations.some((x) => x.id === neu)) {
    conversations.push({ id: neu, type: "dm", name: c?.name.replace(/^\(alter Schlüssel\) /, "") ?? pkShort(neu), lastTs: Math.floor(Date.now() / 1000), ...(c?.ablaufSecs ? { ablaufSecs: c.ablaufSecs } : {}) });
  }
  if (c && !c.name.startsWith("(alter Schlüssel) ")) c.name = `(alter Schlüssel) ${c.name}`;
  saveConversations();
  toast(`Weiter mit dem neuen Schlüssel ${pkShort(neu)} – die alte Unterhaltung bleibt markiert`);
  openConversation(neu);
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
        const media = atts.map((a) => renderAttachment(a)).join("");
        const body = escapeHtml(text);
        // Zap-Button neben jeder Nachricht (nur fuer DMs, nicht eigene)
        const v = versteckt.get(ev.id);
        // Lokale Suche (8.13): was hier gezeigt wird, in den Index (mit Tresor verschluesselt gespeichert)
        const ablauf = (ev as DmAnzeige).ablauf;
        if (!v && text !== ENTSCHLUESSELUNG_FEHLGESCHLAGEN) {
          sucheAufnehmen({ id: ev.id, text, scope: c.id, author: ev.pubkey, createdAt: ev.created_at, ...(ablauf !== undefined ? { ablauf } : {}) });
        }
        if (v) {
          // Platzhalter statt spurlosem Entfernen: Eine Luecke, die man sieht,
          // ist Moderation. Eine, die man nicht sieht, ist Manipulation.
          return `<div class="bubble hidden-msg"><div class="txt mono-sm">` +
            `[ausgeblendet: ${escapeHtml(v.reason)}] ` +
            `<button class="ghost show-anyway" data-id="${escapeHtml(ev.id)}" ` +
            `style="width:auto;padding:2px 6px;font-size:10px">trotzdem zeigen</button></div></div>`;
        }
        const zapBtn = !mine && c.type === "dm" ? `<button class="zap-msg-btn" data-pk="${escapeHtml(ev.pubkey)}" data-name="${escapeHtml(pkShort(ev.pubkey))}" title="zap senden">⚡</button>` : "";
        // Nach dem Diebstahl (8.6a): nicht glauben, dass es von dieser Person ist
        const diebstahl = c.type === "dm" && nachDiebstahl(ev, schluesselStand.get(c.id))
          ? ` <span class="mono-sm warn" title="nach dem gemeldeten Diebstahl des Schlüssels">· ⚠ vielleicht nicht von dieser Person</span>`
          : "";
        const alt = (ev as DmAnzeige).legacy
          ? ` <span class="mono-sm" title="ältere Verschlüsselung (Kind 4): Relays sehen Absender und Empfänger">· alt</span>`
          : (ev as DmAnzeige).mls
            ? ` <span class="mono-sm" title="MLS (Marmot): Gruppenschlüssel mit Vorwärtsgeheimnis">· MLS</span>`
            : "";
        // Von einem Geraet geschrieben (8.6b) – der Name steht in der Vollmacht (Fremddaten)
        const g = (ev as DmAnzeige).geraet;
        const geraet = g ? ` <span class="mono-sm geraet-hinweis${g.warnung ? " warn" : ""}">· ${escapeHtml(g.text)}</span>` : "";
        return `<div class="bubble ${mine ? "user" : "ai"}"><div class="who">${mine ? "du" : escapeHtml(pkShort(ev.pubkey))}${alt}${diebstahl}${geraet}${zapBtn}</div><div class="txt">${body}${media}</div></div>`;
      })
      .join("");
    if (c.type === "dm") schluesselHinweis(thread, c.id);
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
        toast("Dieses Gerät hat keine gültige Vollmacht (mehr) – Settings → Geräte", true);
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
      await veroeffentlicheDm(dm.toRecipient, c.id);
      await veroeffentlicheDm(dm.toSelf, ich);
      // Geraete lesen am Posteingang ihrer Person
      for (const k of dm.weitere) await veroeffentlicheDm(k.wrap, k.an === ich || meine!.includes(k.an) ? ich : c.id);
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
    toast(`Fehler: ${(e as Error).message}`, true);
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
