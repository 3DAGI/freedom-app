/**
 * Chat-Liste (C-52b, Oberflächen-Review 15.10.2026): Filter Alle · Direkt · Räume · Ungelesen, Räume und Communities
 * unter den Direktnachrichten, „Neu“ am Handy. Die Zeilen der Direktnachrichten baut weiter `loadChatList()` in
 * kommunikation.ts; hier stehen Filter, Räume und der leere Zustand. Räume kommen aus derselben Quelle wie die Leiste
 * (`raeumeFuerListe()`), Namen sind Fremddaten und stehen nur als Text da.
 */
import { t } from "../../i18n.js";
import { istUngelesen } from "../../ungelesen.js";
import { oeffneMenueAn } from "../menue.js";
import { avatar, el, leererZustand } from "../ui.js";
import { type ChatConversation, conversations, oeffneCommunity, setzeKommModus } from "./kommunikation.js";
import { type RaumEintrag, kontaktName, raeumeFuerListe, waehleRaum, zeigeRaumLeiste } from "./raeume.js";

/** Filter der Chat-Liste – nur für diese Sitzung. */
type ChatFilter = "alle" | "direkt" | "raeume" | "ungelesen";
let chatFilter: ChatFilter = "alle";

/** Steht diese Direktnachricht unter dem gewählten Filter? */
export function zeigtDm(c: ChatConversation): boolean {
  return chatFilter === "alle" || chatFilter === "direkt" || (chatFilter === "ungelesen" && istUngelesen(c));
}

/** Einmal aus `wireKommunikation()`: Filter und „Neu“ am Handy (schwebend, statt der Leiste). */
export function wireChatListe(neuZeichnen: () => void): void {
  document.querySelectorAll<HTMLButtonElement>("#chat-filter [data-filter]").forEach((b) => b.addEventListener("click", () => {
    chatFilter = b.dataset.filter as ChatFilter;
    document.querySelectorAll<HTMLButtonElement>("#chat-filter [data-filter]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    neuZeichnen();
  }));
  // Unterhaltung, Raum anlegen, Raum beitreten – die bestehenden Knöpfe, keine zweite Logik
  const neu = document.getElementById("chat-neu");
  neu?.addEventListener("click", () => oeffneMenueAn(neu, [
    { text: t("komm.neueUnterhaltung"), tun: () => document.getElementById("chat-new-dm")?.click() },
    { text: t("komm.raumAnlegen"), tun: () => document.getElementById("rail-create")?.click() },
    { text: t("komm.raumBeitreten"), tun: () => document.getElementById("rail-join")?.click() },
  ], t("chatNeu.aria")));
}

/**
 * Räume und Communities in der Chat-Liste (C-52b) – dieselben Einträge wie in der Leiste (`raeumeFuerListe()`), Namen nur
 * als Text. Am Handy ersetzt die Liste so die Leiste. Ist nach dem Filter nichts da, der passende leere Zustand.
 */
export function zeigeRaeumeInListe(): void {
  const list = document.getElementById("chat-list");
  const box = document.getElementById("chat-raeume");
  if (!list || !box) return;
  const mitRaeumen = chatFilter !== "direkt";
  const communities = mitRaeumen && chatFilter !== "ungelesen" ? conversations.filter((c) => c.type === "community") : [];
  const raeume = mitRaeumen ? raeumeFuerListe().filter((r) => chatFilter !== "ungelesen" || r.ungelesen) : [];
  const zeilen = [...communities.map(communityZeile), ...raeume.map(raumZeile)];
  const mitDms = !!list.querySelector(".chat-item[data-cid]");
  box.replaceChildren(...(zeilen.length > 0 && mitDms ? [el("div", t("chatFilter.raeumeTitel"), "chat-abschnitt")] : []), ...zeilen);
  list.querySelector(":scope > .leer-zustand")?.remove();
  if (mitDms || zeilen.length > 0) return;
  // Mit dem nächsten Schritt statt nur eines Satzes (C-45)
  list.prepend(chatFilter === "raeume"
    ? leererZustand("chat", t("chatFilter.keinRaum"), { text: t("komm.raumAnlegen"), beiKlick: () => document.getElementById("rail-create")?.click() })
    : chatFilter === "ungelesen" ? leererZustand("chat", t("chatFilter.allesGelesen"))
      : leererZustand("chat", t("komm.keineUnterhaltungen"), {
        text: t("komm.neueUnterhaltung"), beiKlick: () => document.getElementById("chat-new-dm")?.click(),
      }));
}

/** Zeile eines Raums (C-52b): Zeichen, Name, Art oder Einladung, „neu“ – öffnet ihn wie die Leiste. */
function raumZeile(r: RaumEintrag): HTMLElement {
  const zeile = el("div", undefined, "chat-item raum-item");
  zeile.dataset.raum = r.id;
  const oben = el("div", undefined, "chat-zeile-oben");
  oben.append(el("span", r.name, "label"));
  const unten = el("div", undefined, "chat-zeile-unten");
  unten.append(el("span", r.von ? t("chatZeile.einladung", { name: kontaktName(r.von) })
    : `${r.privat ? "🔒" : "🌐"} ${t(r.privat ? "chatZeile.raumPrivat" : "chatZeile.raumOffen")}`, "chat-vorschau"));
  if (r.ungelesen) {
    zeile.classList.add("ungelesen");
    unten.append(el("span", t("komm.ungelesen"), "chat-ungelesen"));
  }
  const mitte = el("div", undefined, "chat-zeile-mitte");
  mitte.append(oben, unten);
  // Farbe aus dem Schlüssel der Gruppe bzw. des Gründers (C-44)
  zeile.append(avatar(r.id.replace(/^mls:/, "").replace(/^34700:/, ""), (Array.from(r.name)[0] ?? "?").toUpperCase()), mitte);
  zeile.addEventListener("click", () => {
    waehleRaum(r.id);
    setzeKommModus("space");
  });
  return zeile;
}

/** Zeile einer Community aus der Zeit vor C-10 – öffnet ihren Verlauf wie die Leiste. */
function communityZeile(c: ChatConversation): HTMLElement {
  const zeile = el("div", undefined, "chat-item raum-item");
  zeile.dataset.community = c.id;
  const oben = el("div", undefined, "chat-zeile-oben");
  oben.append(el("span", c.name, "label"));
  const unten = el("div", undefined, "chat-zeile-unten");
  unten.append(el("span", `🏠 ${t("chatZeile.community")}`, "chat-vorschau"));
  const mitte = el("div", undefined, "chat-zeile-mitte");
  mitte.append(oben, unten);
  zeile.append(avatar("", (Array.from(c.name)[0] ?? "?").toUpperCase()), mitte);
  zeile.addEventListener("click", () => {
    oeffneCommunity(c.id);
    void zeigeRaumLeiste();
  });
  return zeile;
}
