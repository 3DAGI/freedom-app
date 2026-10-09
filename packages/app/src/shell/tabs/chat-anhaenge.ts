/**
 * Anhänge im Chat: inline als data-url, groß über das Blob-Netz oder Blossom,
 * dazu Zahlungsanforderungen (A-5) und die Knöpfe an Anhängen.
 *
 * Aus tabs/kommunikation.ts verschoben (C-5b) – wörtlich, ohne Logikänderung.
 */
import { type DateiSchluessel } from "@freedomstack/protocol";
import { type ChatAttachment, anhangAnsicht, pkShort } from "../../shell-logic.js";
import { ensurePool, state } from "../state.js";
import { hinweis } from "../dialog.js";
import { $, el, toast } from "../ui.js";
import { t } from "../../i18n.js";
import { fehlerText } from "../../protokoll-texte.js";
import { type Anforderung } from "../../zahlungs-anforderung.js";
import { halteBeiMeinemKnoten } from "../knoten-halten-ui.js";
import { istAudioTyp } from "../../sprachnachricht.js";
import { AnhangWarte } from "../../anhang-warte.js";

/** Zahlungsanforderungen der gezeigten Nachrichten (A-5): Id → Anforderung und Absender. */
export const anforderungen = new Map<string, { anf: Anforderung; von: string }>();

/** Anhang: kleine Dateien inline als data-url, grosse ueber das Blob-Netz. */
// Darstellungslogik liegt in shell-logic.ts — dort ohne DOM und deshalb
// tatsaechlich testbar (29 Tests, Schwerpunkt feindliche Relay-Eingaben).
export let chatAttachments: ChatAttachment[] = [];
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

/** Laufende Uploads (C-29): Senden wartet auf sie, statt den Text ohne Anhang zu schicken. */
export const anhangWarte = new AnhangWarte();

export async function handleChatFiles(files: FileList | File[] | null): Promise<void> {
  if (!files || files.length === 0) return;
  const lauf = ladeAnhaenge(Array.from(files));
  anhangWarte.merke(lauf);
  await lauf;
}

/** Lädt die Dateien nacheinander – `true`, wenn jede ankam (Fehler meldet ein Toast). */
async function ladeAnhaenge(dateien: File[]): Promise<boolean> {
  const listEl = $("#chat-attach-list");
  let gut = true;
  for (const file of dateien) {
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
          void halteBeiMeinemKnoten(res); // B-9b2: gekoppelt und mit Haken hält der eigene Knoten das Chiffrat
        } catch {
          setAttachStatus(listEl, t("komm.blossomAusweg", { name: file.name }));
          const { verschluesseleDatei } = await import("@freedomstack/protocol");
          const { chiffrat, schluessel } = verschluesseleDatei(new Uint8Array(await file.arrayBuffer()));
          url = await uploadToBlossom(new File([chiffrat as BlobPart], "", { type: "application/octet-stream" }));
          enc = schluessel;
        }
      }
      chatAttachments.push({ name: file.name, mime: file.type || "application/octet-stream", size: file.size, url, ...(enc ? { enc } : {}) });
      zeigeAnhangListe();
    } catch (e) {
      toast(`${file.name}: ${fehlerText(e)}`, true);
      gut = false;
    }
  }
  return gut;
}

export function setAttachStatus(el: HTMLElement | null, text: string): void {
  if (el) el.textContent = text;
}

/** Die vorgemerkten Anhänge unter dem Feld (seit C-29 auch nach dem Warten, wenn nichts hinausging). */
export function zeigeAnhangListe(): void {
  setAttachStatus($("#chat-attach-list"), chatAttachments.map((a) => `${a.name} (${Math.round(a.size / 1024)}kb)`).join(", "));
}


/** Anhang als Element (C-6c): aus `anhangAnsicht()`, nur Eigenschaften, `dataset` und Text. */
export function anhangElement(a: ChatAttachment): HTMLElement {
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
export function wireBlobButtons(root: HTMLElement): void {
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
        // Ein Ton (Sprachnachricht, C-7) spielt an Ort und Stelle – der Typ kommt aus fremder Nachricht, erst prüfen
        if (istAudioTyp(datei.mime)) {
          const ton = document.createElement("audio");
          ton.controls = true;
          ton.src = url;
          el.replaceWith(ton);
          ton.play().catch(() => { /* ohne Erlaubnis zum Abspielen: der Knopf im Abspieler */ });
          return;
        }
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

/** Nach dem Senden: keine Anhänge mehr vorgemerkt (seit C-5b eigene Funktion – nur dieses Modul weist neu zu). */
export function leereAnhaenge(): void {
  chatAttachments = [];
}
