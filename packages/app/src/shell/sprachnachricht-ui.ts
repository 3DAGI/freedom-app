/**
 * Sprachnachrichten im Chat (Schritt C-7): Knopf mit Mikrofon neben dem
 * Anhängen. Erst der Klick fragt das Mikrofon an; beenden, verwerfen, die
 * Grenze, eine Seite im Hintergrund – danach ist es aus. Die Aufnahme wird ein
 * Anhang über `handleChatFiles()`: klein in der verschlüsselten Nachricht,
 * sonst verschlüsselt über `uploadAnhang()` (2.4). Gesendet wird wie jede
 * Nachricht mit „Senden“ – vorher lässt sie sich noch verwerfen.
 */
import { SPRACH_GRENZEN, SprachAufnahme, type SprachErgebnis, type SprachUmgebung, dauerText, sprachDateiname } from "../sprachnachricht.js";
import { t } from "../i18n.js";
import { fehlerText } from "../protokoll-texte.js";
import { el, toast } from "./ui.js";
import { handleChatFiles } from "./tabs/kommunikation.js";

/** Der Browser: Mikrofon nur hier, nur aus `starte()` – nie beim Laden. */
function browserUmgebung(): SprachUmgebung {
  return {
    mikrofon: () => navigator.mediaDevices.getUserMedia({ audio: true }),
    recorder: (strom, mime) => new MediaRecorder(strom, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: SPRACH_GRENZEN.bitsProSekunde }),
    kann: (mime) => MediaRecorder.isTypeSupported(mime),
    spaeter: (fn, ms) => {
      const h = setTimeout(fn, ms);
      return () => clearTimeout(h);
    },
    jetzt: () => Date.now(),
  };
}

let aufnahme: SprachAufnahme | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;

export function wireSprachnachricht(): void {
  const knopf = document.getElementById("chat-voice-btn") as HTMLButtonElement | null;
  const stand = document.getElementById("chat-voice-status");
  if (!knopf || !stand) return;
  // Ohne Mikrofon-Schnittstelle (alte Browser, unsichere Herkunft) gibt es den Knopf nicht
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    knopf.hidden = true;
    return;
  }
  knopf.onclick = () => void umschalten(knopf, stand);
  // Im Hintergrund nimmt die App nicht weiter auf: beenden, die Aufnahme bleibt als Anhang
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && aufnahme?.stand === "nimmt-auf") void beende(knopf, stand);
  });
  window.addEventListener("pagehide", () => void aufnahme?.brichAb());
}

async function umschalten(knopf: HTMLButtonElement, stand: HTMLElement): Promise<void> {
  if (aufnahme?.stand === "nimmt-auf") return beende(knopf, stand);
  if (aufnahme && aufnahme.stand !== "bereit") return;
  // Endet sie von selbst (Grenze, Mikrofon weg), wird sie trotzdem Anhang
  aufnahme = new SprachAufnahme(browserUmgebung(), (e) => {
    zuruecksetzen(knopf, stand);
    void uebernimm(e);
  });
  stand.hidden = false;
  stand.replaceChildren(t("komm.sprachFrage"));
  try {
    await aufnahme.starte();
  } catch (e) {
    zuruecksetzen(knopf, stand);
    toast(t("komm.sprachKeinMikrofon", { fehler: fehlerText(e) }), true);
    return;
  }
  if (aufnahme.stand !== "nimmt-auf") {
    zuruecksetzen(knopf, stand);
    return;
  }
  knopf.setAttribute("aria-pressed", "true");
  knopf.classList.add("nimmt-auf");
  knopf.title = t("komm.sprachBeenden");
  knopf.setAttribute("aria-label", t("komm.sprachBeenden"));
  const zeit = el("span", undefined, "voice-zeit");
  const verwerfen = el("button", t("komm.sprachVerwerfen"), "ghost");
  verwerfen.classList.add("mini");
  verwerfen.type = "button";
  verwerfen.onclick = () => void verwirf(knopf, stand);
  const zeige = () => {
    zeit.textContent = t("komm.sprachLaeuft", { zeit: dauerText(aufnahme?.sekunden ?? 0), grenze: dauerText(SPRACH_GRENZEN.sekunden) });
  };
  zeige();
  stand.replaceChildren(zeit, " ", verwerfen);
  ticker = setInterval(zeige, 500);
}

async function beende(knopf: HTMLButtonElement, stand: HTMLElement): Promise<void> {
  const a = aufnahme;
  if (!a) return;
  const e = await a.beende();
  zuruecksetzen(knopf, stand);
  await uebernimm(e);
}

async function verwirf(knopf: HTMLButtonElement, stand: HTMLElement): Promise<void> {
  await aufnahme?.brichAb();
  zuruecksetzen(knopf, stand);
  toast(t("komm.sprachVerworfen"));
}

function zuruecksetzen(knopf: HTMLButtonElement, stand: HTMLElement): void {
  if (ticker) clearInterval(ticker);
  ticker = null;
  knopf.setAttribute("aria-pressed", "false");
  knopf.classList.remove("nimmt-auf");
  knopf.title = t("komm.sprachAufnehmen");
  knopf.setAttribute("aria-label", t("komm.sprachAufnehmen"));
  stand.replaceChildren();
  stand.hidden = true;
}

/** Die Aufnahme als Anhang – derselbe Weg wie eine gewählte Datei. */
async function uebernimm(e: SprachErgebnis | null): Promise<void> {
  if (!e) {
    toast(t("komm.sprachLeer"), true);
    return;
  }
  await handleChatFiles([new File([e.datei], sprachDateiname(e.mime), { type: e.mime })]);
}
