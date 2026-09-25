/**
 * Reine Darstellungs- und Formatierlogik aus `shell/app.ts`.
 *
 * WARUM AUSGELAGERT
 * `shell/app.ts` hat rund 2.700 Zeilen und 97 Funktionen, die fast alle direkt
 * am DOM hängen. Für die meisten davon wäre ein Test nur mit einem
 * vollständigen Browser-Aufbau möglich, und ein Test, der im Wesentlichen ein
 * DOM nachbaut, prüft am Ende das DOM und nicht die Logik.
 *
 * Die Funktionen hier sind die, bei denen ein Fehler tatsächlich weh tut: sie
 * verarbeiten Text aus FREMDEN Relay-Events und bauen daraus HTML. Genau an
 * dieser Stelle steckte schon einmal ein XSS-Loch (interpoliertes `onclick` in
 * den LP-Angeboten). Ohne DOM-Abhängigkeit sind sie direkt prüfbar — und die
 * Prüfungen sind schärfer als alles, was ein DOM-Test leisten würde.
 */

import { type DateiSchluessel, istDateiSchluessel } from "@freedomstack/protocol";

export interface ChatAttachment {
  name: string;
  mime: string;
  size: number;
  url: string;
  /** Schritt 2.4: Die Datei unter `url` ist verschluesselt; der Schluessel reist nur hier. */
  enc?: DateiSchluessel;
}

/** Schluessel-Felder eines Anhangs fuer ein imeta-Tag (Namen wie NIP-17 Kind 15). */
export function imetaSchluessel(a: ChatAttachment): string[] {
  return a.enc
    ? ["encryption-algorithm aes-gcm", `decryption-key ${a.enc.key}`, `decryption-nonce ${a.enc.nonce}`, `ox ${a.enc.ox}`]
    : [];
}

/**
 * Escaping für alles, was aus fremder Quelle in HTML landet.
 *
 * Numerische Entities statt benannter: `&#60;` funktioniert in jedem Kontext,
 * während `&lt;` in einem Attributwert ohne Anführungszeichen nicht ausreicht.
 * Anführungszeichen sind bewusst dabei — ohne sie wäre jedes Attribut, das
 * fremden Text enthält, ausbrechbar.
 */
export function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Pubkey gekürzt, ohne die Mitte zu verlieren. */
export function pkShort(pk: string): string {
  if (pk.length <= 12) return pk;
  return pk.slice(0, 8) + "…" + pk.slice(-4);
}

/**
 * Erlaubte Schemata für Anhänge aus fremden Nachrichten.
 *
 * `data:image/…` ist dabei, weil kleine Bilder inline übertragen werden.
 * `data:text/html` wäre ein direkter Skript-Einstieg und ist es deshalb nicht —
 * ebensowenig `javascript:`, `vbscript:` oder `blob:`.
 */
const SAFE_URL = /^(https:|http:|data:image\/|data:video\/|data:audio\/)/i;

export function isSafeAttachmentUrl(url: string): boolean {
  // Führende Steuerzeichen und Leerraum entfernen: "java\nscript:alert(1)"
  // wird von manchen Parsern noch als javascript: gelesen.
  const clean = url.replace(/[\u0000-\u0020]/g, "");
  return SAFE_URL.test(clean);
}

/** Einen Anhang als HTML darstellen. `freedom-blob:` lädt on demand nach. */
export function renderAttachment(a: ChatAttachment): string {
  const name = escapeHtml(a.name || "datei");

  // Verschluesselt (2.4): nur als Knopf – laden, entschluesseln, speichern.
  // Schluessel und Typ kommen aus fremder Nachricht: erst pruefen, dann maskieren.
  if (a.enc !== undefined) {
    if (!istDateiSchluessel(a.enc)) return `<div class="mono-sm">[Anhang mit ungültigem Schlüssel: ${name}]</div>`;
    const ziel = a.url.startsWith("freedom-blob:")
      ? `data-blob="${escapeHtml(a.url.slice("freedom-blob:".length))}"`
      : a.url.startsWith("https://") && isSafeAttachmentUrl(a.url) ? `data-url="${escapeHtml(a.url)}"` : "";
    if (!ziel) return `<div class="mono-sm">[Anhang mit nicht unterstuetztem Link: ${name}]</div>`;
    return `<button class="ghost copy-btn chat-blob-btn" ${ziel} data-key="${a.enc.key}" data-nonce="${a.enc.nonce}" `
      + `data-ox="${a.enc.ox}" data-mime="${escapeHtml(a.mime || "application/octet-stream")}" data-name="${name}">🔒 ${name}</button>`;
  }

  if (a.url.startsWith("freedom-blob:")) {
    const blobId = a.url.slice("freedom-blob:".length);
    return `<button class="ghost copy-btn chat-blob-btn" data-blob="${escapeHtml(blobId)}" data-name="${name}">📥 ${name}</button>`;
  }

  if (!isSafeAttachmentUrl(a.url)) {
    return `<div class="mono-sm">[Anhang mit nicht unterstuetztem Link: ${name}]</div>`;
  }

  const url = escapeHtml(a.url);
  const mime = (a.mime || "").toLowerCase();
  if (mime.startsWith("image/")) return `<img src="${url}" class="chat-media" loading="lazy" alt="${name}" />`;
  if (mime.startsWith("video/")) return `<video src="${url}" class="chat-media" controls preload="metadata"></video>`;
  if (mime.startsWith("audio/")) return `<audio src="${url}" controls preload="metadata"></audio>`;
  return `<a class="mono-sm" href="${url}" target="_blank" rel="noopener noreferrer">📎 ${name}</a>`;
}

/**
 * Meldungen fremder Provider, die KEIN Fehler unseres Ablaufs sind.
 *
 * Ein Provider, dessen eigene Wallet-Anbindung klemmt, schreibt das in sein
 * Ergebnis. Das als Fehler des Kunden anzuzeigen, hat Nutzer verunsichert,
 * obwohl ihr Job sauber lief — wir zahlen per Session und Beleg, nicht über
 * die Wallet des Providers.
 */
export function isForeignPaymentNoise(msg: string): boolean {
  return /payment error|nwc timed out|keysend.*(fail|timeout)|invoice.*timeout/i.test(msg);
}

/** Beträge lesbar machen, ohne bei kleinen Werten zu lügen. */
export function fmtSats(msat: number): string {
  if (!Number.isFinite(msat) || msat < 0) return "—";
  if (msat === 0) return "0 sats";
  // Unter 1 sat nicht auf 0 runden — sonst sieht bezahlte Arbeit gratis aus.
  if (msat < 1000) return `${msat} msat`;
  const sats = msat / 1000;
  if (sats < 1000) return `${sats.toFixed(sats < 10 ? 1 : 0)} sats`;
  return `${Math.round(sats).toLocaleString("de-DE")} sats`;
}

/** Lamports als SOL, mit genug Nachkommastellen für kleine Beträge. */
export function fmtSol(lamports: number): string {
  if (!Number.isFinite(lamports) || lamports < 0) return "—";
  const sol = lamports / 1e9;
  if (sol === 0) return "0 SOL";
  if (sol < 0.0001) return `${lamports.toLocaleString("de-DE")} lamports`;
  return `${sol.toFixed(4)} SOL`;
}

export interface BudgetView {
  text: string;
  /** 0..1 für den Fortschrittsbalken. */
  ratio: number;
  /** Warnstufe für die Einfärbung. */
  level: "ok" | "warn" | "err";
}

/**
 * Budgetanzeige einer Session.
 *
 * Die Warnschwellen sind bewusst früh: wer erst bei 95 % merkt, dass das
 * Budget knapp wird, bekommt mitten in einer Antwort einen Abbruch.
 */
export function budgetView(paidMsat: number, budgetMsat: number): BudgetView {
  if (!Number.isFinite(budgetMsat) || budgetMsat <= 0) {
    return { text: "keine Session — die erste Anfrage startet eine", ratio: 0, level: "ok" };
  }
  const used = Math.max(0, Math.min(paidMsat, budgetMsat));
  const ratio = used / budgetMsat;
  const rest = budgetMsat - used;

  let level: BudgetView["level"] = "ok";
  if (ratio >= 0.9) level = "err";
  else if (ratio >= 0.7) level = "warn";

  const text =
    ratio >= 1
      ? `Budget aufgebraucht (${fmtSats(budgetMsat)}) — Session erneuern`
      : `${fmtSats(rest)} von ${fmtSats(budgetMsat)} übrig`;
  return { text, ratio, level };
}

/** Relative Zeitangabe. */
export function ago(unixSeconds: number, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const s = nowSeconds - unixSeconds;
  if (s < 0) return "gerade eben";
  if (s < 60) return "gerade eben";
  if (s < 3600) return `vor ${Math.floor(s / 60)} min`;
  if (s < 86400) return `vor ${Math.floor(s / 3600)} h`;
  if (s < 30 * 86400) return `vor ${Math.floor(s / 86400)} d`;
  return new Date(unixSeconds * 1000).toLocaleDateString("de-DE");
}

/**
 * Zerlegt eine DM in Text und Anhänge.
 *
 * DM-Anhänge stecken im verschlüsselten Body, nicht in Klartext-Tags — sonst
 * stünde bei jeder privaten Nachricht öffentlich im Relay, welche Datei mit
 * welchem Namen übertragen wurde. Alte Nachrichten sind reiner Text und müssen
 * weiter funktionieren.
 */
export function parseDmBody(content: string): { text: string; attachments: ChatAttachment[] } {
  try {
    const parsed = JSON.parse(content) as { text?: string; attachments?: unknown };
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.attachments)) {
      const attachments = (parsed.attachments as ChatAttachment[]).filter(
        (a) => a && typeof a.url === "string" && a.url.length > 0,
      );
      return { text: typeof parsed.text === "string" ? parsed.text : "", attachments };
    }
  } catch { /* normale Textnachricht */ }
  return { text: content, attachments: [] };
}

/** Liest Anhänge aus den `imeta`-Tags eines Community-Beitrags (NIP-92). */
export function parseImetaTags(tags: string[][]): ChatAttachment[] {
  return tags
    .filter((t) => t[0] === "imeta")
    .map((t) => {
      const get = (p: string): string =>
        t.find((x) => typeof x === "string" && x.startsWith(p + " "))?.slice(p.length + 1) ?? "";
      const a: ChatAttachment = { url: get("url"), mime: get("m"), name: get("name"), size: 0 };
      if (get("encryption-algorithm") === "aes-gcm") {
        a.enc = { alg: "aes-gcm", key: get("decryption-key"), nonce: get("decryption-nonce"), ox: get("ox") };
      }
      return a;
    })
    .filter((a) => a.url.length > 0);
}
