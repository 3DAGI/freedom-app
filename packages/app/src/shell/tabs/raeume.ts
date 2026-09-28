/**
 * Räume (offen: 34700/42, privat: MLS-Gruppen) – Leiste, Kanäle, Verlauf,
 * Mitglieder, Moderation und Meldungen.
 *
 * Aus kommunikation.ts verschoben (Schritt C.2a) – wörtlich, ohne
 * Logikänderung; nur `kontaktName` ist jetzt exportiert.
 */
import { MELDE_GRUENDE, type MeldeGrund } from "@freedomstack/protocol";
import { escapeHtml, pkShort } from "../../shell-logic.js";
import { ensurePool, signiere, state } from "../state.js";
import { mlsAbgleichen, mlsGesperrt } from "../mls-konto.js";
import {
  PRIVAT, type PrivaterRaum, einladungsText, entferneAusRaum, gruppeVon, istPrivat, ladeInPrivatenRaum, ladePrivatenRaum, legePrivatenRaumAn, loescheImRaum, meldeImRaum, meldungErledigt, meldungenFuer, privateRaeume, sendePrivat, setzeModeratoren, wennMeldung,
} from "../raum-mls.js";
import { $, toast } from "../ui.js";
import { gebietsschema, t } from "../../i18n.js";
import { fehlerText } from "../../protokoll-texte.js";
import { abrufTakt } from "../versand.js";
import { conversations } from "./kommunikation.js";

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
    pInfo.textContent = t(kanal.privacy === "verschluesselt" ? "komm.kanalVerschluesselt" : "komm.kanalOffen");
    pInfo.className = kanal.privacy === "verschluesselt" ? "mono-sm ok" : "mono-sm muted";
    pInfo.title = privacyInfo(kanal as never);
  }

  const { topLevel, threads } = buildThreads(spacesUi.messages as never[], kanal as never, st);
  const thread = $("#channel-thread");
  if (thread) {
    thread.innerHTML = topLevel.length === 0
      ? `<div class="muted mono-sm">${escapeHtml(t("komm.nochNichts"))}</div>`
      : topLevel.map((m) => {
          const faden = threads.get(m.id);
          const antworten = faden
            ? `<button class="thread-link" data-root="${escapeHtml(m.id)}">
                 ${escapeHtml(t(faden.replies.length === 1 ? "komm.eineAntwort" : "komm.antworten", { n: faden.replies.length }))} ·
                 ${escapeHtml(t("komm.beteiligte", { n: faden.participants.length }))}</button>`
            : "";
          // Private Räume moderieren über MLS (2.3c) – nie mit öffentlichen Sperr-Events
          const modKnopf = darfModerieren && !spacesUi.privat && m.authorPubkey !== state.keypair?.pk
            ? `<button class="thread-link mod-hide" data-id="${escapeHtml(m.id)}"
                 data-pk="${escapeHtml(m.authorPubkey)}" style="color:#9A6A6A">${escapeHtml(t("komm.moderieren"))}</button>`
            : "";
          const raumKnopf = spacesUi.privat
            ? `<button class="thread-link raum-aktion" data-id="${escapeHtml(m.id)}"
                 data-pk="${escapeHtml(m.authorPubkey)}">${escapeHtml(raumAktionText(m.authorPubkey))}</button>`
            : "";
          return `<div class="msg-group">
            <div class="msg-meta">
              <span class="msg-author">${escapeHtml(pkShort(m.authorPubkey))}</span>
              <span class="msg-time">${escapeHtml(new Date(m.createdAt * 1000).toLocaleTimeString(gebietsschema(), { hour: "2-digit", minute: "2-digit" }))}</span>
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
        const was = confirm(t("komm.ausblendenOderSperren"));
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
    ro.textContent = darf ? "" : t("komm.nurRollen");
  }

  merkeLesestand(channelId);
  void zeigeMitglieder();
  void zeigeKanalliste();
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
    if (!confirm(t("komm.eigeneLoeschen"))) return;
    ok = await loescheImRaum(raum, id);
  } else if (raum.admins.includes(raum.ich)) {
    const wahl = prompt(t("komm.moderierenWahl"), "1");
    if (wahl?.trim() === "1") ok = await loescheImRaum(raum, id);
    else if (wahl?.trim() === "2") ok = await entferneAusRaum(raum, autor);
    else return;
  } else {
    const grund = prompt(t("komm.meldenGrund", { gruende: MELDE_GRUENDE.join(", ") }), "spam")?.trim();
    if (!grund) return;
    if (!(MELDE_GRUENDE as readonly string[]).includes(grund)) {
      toast(t("komm.unbekannterGrund"), true);
      return;
    }
    const notiz = prompt(t("komm.meldenNotiz")) ?? "";
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
  box.replaceChildren(...liste.map(([wrapId, m]) => {
    const z = document.createElement("div");
    z.className = "member-row";
    z.style.display = "block";
    const text = document.createElement("div");
    text.textContent = `${t("komm.meldungVon", { von: kontaktName(m.von), autor: kontaktName(m.autor), grund: m.grund })}${m.notiz ? ` – ${m.notiz}` : ""}`;
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
      const text = `${pkShort(pk)}${privat.admins.includes(pk) ? ` · ${t("komm.moderatorRolle")}` : ""}${eigene.length ? ` · ${eigene.join(", ")}` : ""}`;
      z.textContent = pk === privat.ich ? `${text} (${t("komm.du")})` : text;
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
      <span class="msg-role" style="color:var(--acc,#C9A227)">${escapeHtml(t("komm.gruender"))}</span></div>`);
  }
  for (const [pk, rollen] of st.grants) {
    if (pk === st.ownerPubkey) continue;
    const namen = rollen.map((r) => st.roles?.get(r)?.name).filter(Boolean);
    zeilen.push(`<div class="member-row"><span>${escapeHtml(pkShort(pk))}</span>
      ${namen.map((n) => `<span class="msg-role">${escapeHtml(n!)}</span>`).join("")}</div>`);
  }
  box.innerHTML = zeilen.length ? zeilen.join("") : `<span class="muted">${escapeHtml(t("komm.niemand"))}</span>`;
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
      toast(t("komm.nichtGesendet"), true);
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
  if (oeffentlich && !confirm(t("komm.oeffentlichWarnung"))) return;
  const name = prompt(t(oeffentlich ? "komm.nameOeffentlich" : "komm.namePrivat"));
  if (!name?.trim()) return;
  if (!oeffentlich) {
    try {
      const gruppe = await legePrivatenRaumAn(name.trim());
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
        permissions: ["lesen", "schreiben", "threads", "moderieren", "rollen_vergeben"] },
      { id: "mitglied", name: "Mitglied", rank: 10, // kein UI-Text
        permissions: ["lesen", "schreiben", "threads"] },
    ] as never)));

    raumBeitreten(spaceId);
    await oeffneRaum(spaceId);
    // Die Kennung ist der einzige Weg, wie jemand hereinkommt.
    prompt(t("komm.raumAngelegt"), spaceId);
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
  const liste = kontakte.map((c, i) => `${i + 1}: ${c.name}`).join("\n");
  const eingabe = prompt(kontakte.length ? t("komm.einladenListe", { liste }) : t("komm.einladenSchluessel"));
  if (!eingabe?.trim()) return;
  const n = Number(eingabe.trim());
  const pk = Number.isInteger(n) && n >= 1 && n <= kontakte.length ? kontakte[n - 1]!.id : eingabe.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pk)) {
    toast(t("komm.keinSchluessel"), true);
    return;
  }
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
async function moderiere(aktion: "hide" | "ban" | "grant", ziel: string): Promise<void> {
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
      const rolle = prompt(t("komm.welcheRolle"), "mitglied");
      if (!rolle) return;
      await pool.publish(await signiere(buildRoleGrant(
        spacesUi.spaceId, state.keypair.pk, ziel, [rolle.trim()])));
      toast(t("komm.rolleVergeben"));
    } else {
      // Ohne Begruendung wirkt Moderation willkuerlich — und wird es meist auch.
      const grund = prompt(t("komm.begruendung"));
      if (!grund?.trim()) {
        toast(t("komm.ohneBegruendung"), true);
        return;
      }
      const ev = aktion === "hide"
        ? buildHide(spacesUi.spaceId, state.keypair.pk, ziel, grund.trim())
        : buildBan(spacesUi.spaceId, state.keypair.pk, ziel, grund.trim());
      await pool.publish(await signiere(ev));
      toast(t(aktion === "hide" ? "komm.ausgeblendet" : "komm.gesperrt"));
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
    const liste = andere.map((m, i) => `${i + 1}: ${kontaktName(m)}${raum.admins.includes(m) ? ` ${t("komm.moderatorMarke")}` : ""}`).join("\n");
    const vorher = andere.map((m, i) => (raum.admins.includes(m) ? String(i + 1) : "")).filter(Boolean).join(",");
    const eingabe = prompt(t("komm.werModerator", { liste }), vorher);
    if (eingabe === null) return;
    const mods = eingabe.split(",").map((x) => andere[Number(x.trim()) - 1]).filter((x): x is string => !!x);
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

  const eingabe = prompt(t("komm.modPubkeys"));
  if (eingabe === null) return;
  const mods = eingabe.split(",").map((x) => x.trim()).filter((x) => /^[0-9a-f]{64}$/.test(x));

  const regeln = prompt(t("komm.regeln"));

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
  if (join) join.onclick = () => {
    const id = prompt(t("komm.raumKennung"));
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
