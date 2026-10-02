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
import { gebietsschema, t } from "./i18n.js";
import { istAudioTyp } from "./sprachnachricht.js";

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

/**
 * Wie ein Anhang erscheint – als Beschreibung, nicht als HTML (seit C-6c). Die
 * Oberfläche baut daraus Elemente nur mit `textContent`, `dataset` und
 * Eigenschaften; Name, Typ und Adresse bleiben Daten. Geprüft wird hier:
 * Schlüssel, Schema, Art. `freedom-blob:` lädt auf Knopfdruck nach.
 */
export type AnhangAnsicht =
  | { art: "hinweis"; text: string }
  | { art: "knopf"; text: string; daten: Record<string, string> }
  | { art: "bild" | "video" | "audio"; url: string; name: string }
  | { art: "link"; url: string; text: string };

export function anhangAnsicht(a: ChatAttachment): AnhangAnsicht {
  const name = a.name || t("ein.datei");

  // Verschluesselt (2.4): nur als Knopf – laden, entschluesseln, speichern.
  // Schluessel und Typ kommen aus fremder Nachricht: erst pruefen.
  if (a.enc !== undefined) {
    if (!istDateiSchluessel(a.enc)) return { art: "hinweis", text: `[${t("ein.anhangSchluessel", { name })}]` };
    const ziel: Record<string, string> | null = a.url.startsWith("freedom-blob:")
      ? { blob: a.url.slice("freedom-blob:".length) }
      : a.url.startsWith("https://") && isSafeAttachmentUrl(a.url) ? { url: a.url } : null;
    if (!ziel) return { art: "hinweis", text: `[${t("ein.anhangLink", { name })}]` };
    // Ein Ton (Sprachnachricht, C-7) spielt nach dem Laden an Ort und Stelle
    return {
      art: "knopf", text: istAudioTyp(a.mime || "") ? t("ein.anhangAbspielen", { name }) : `🔒 ${name}`,
      daten: { ...ziel, key: a.enc.key, nonce: a.enc.nonce, ox: a.enc.ox, mime: a.mime || "application/octet-stream", name },
    };
  }

  if (a.url.startsWith("freedom-blob:")) {
    return { art: "knopf", text: `📥 ${name}`, daten: { blob: a.url.slice("freedom-blob:".length), name } };
  }

  if (!isSafeAttachmentUrl(a.url)) return { art: "hinweis", text: `[${t("ein.anhangLink", { name })}]` };

  const mime = (a.mime || "").toLowerCase();
  if (mime.startsWith("image/")) return { art: "bild", url: a.url, name };
  if (mime.startsWith("video/")) return { art: "video", url: a.url, name };
  if (mime.startsWith("audio/")) return { art: "audio", url: a.url, name };
  return { art: "link", url: a.url, text: `📎 ${name}` };
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
  return `${Math.round(sats).toLocaleString(gebietsschema())} sats`;
}

/**
 * Ganze sats über 0 aus einem Eingabefeld (C-1a), sonst 0: nur Ziffern –
 * kein Komma, kein Exponent, keine Leerstelle mitten drin. `Number("1e3")`
 * oder `Number("0x10")` wären sonst still ein anderer Betrag als getippt.
 */
export function ganzeSats(v: unknown): number {
  const s = typeof v === "string" ? v.trim() : "";
  if (!/^\d{1,15}$/.test(s)) return 0;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

/**
 * Öffentlicher Schlüssel aus einem Eingabefeld (C-1): npub – auch mit
 * „nostr:“ davor, wie ihn QR-Codes anderer Apps tragen – oder 64 Zeichen Hex,
 * gleich in welcher Schreibung; sonst "". `decodeNpub` kommt vom Aufrufer
 * (`identity.ts`), damit dieser Baustein ohne Kryptografie auskommt.
 */
export function schluesselAusEingabe(roh: unknown, decodeNpub: (npub: string) => string): string {
  let x = typeof roh === "string" ? roh.trim().replace(/^nostr:/i, "") : "";
  if (/^npub1/i.test(x)) {
    try {
      x = decodeNpub(x.toLowerCase());
    } catch {
      return "";
    }
  }
  x = x.toLowerCase();
  return /^[0-9a-f]{64}$/.test(x) ? x : "";
}

/**
 * Hart umbrochene Zeilen zu Fließtext (C-1c): Sätze des Protokolls sind für
 * `alert()` mit festen Zeilen gesetzt und bleiben dort wortgleich; im Dialog
 * bricht der Browser selbst um. Absätze, Aufzählungen (·, -, •) und
 * nummerierte Punkte bleiben eigene Zeilen.
 */
export function fliesstext(s: string): string {
  return s.replace(/([^\n])\n(?!\n|[ \t]*(?:\d+\.|·|-|•)\s)[ \t]*/g, "$1 ");
}

/** Lamports als SOL, mit genug Nachkommastellen für kleine Beträge. */
export function fmtSol(lamports: number): string {
  if (!Number.isFinite(lamports) || lamports < 0) return "—";
  const sol = lamports / 1e9;
  if (sol === 0) return "0 SOL";
  if (sol < 0.0001) return `${lamports.toLocaleString(gebietsschema())} lamports`;
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
    return { text: t("ein.keineSession"), ratio: 0, level: "ok" };
  }
  const used = Math.max(0, Math.min(paidMsat, budgetMsat));
  const ratio = used / budgetMsat;
  const rest = budgetMsat - used;

  let level: BudgetView["level"] = "ok";
  if (ratio >= 0.9) level = "err";
  else if (ratio >= 0.7) level = "warn";

  const text =
    ratio >= 1
      ? t("ein.budgetAufgebraucht", { budget: fmtSats(budgetMsat) })
      : t("ein.budgetUebrig", { rest: fmtSats(rest), budget: fmtSats(budgetMsat) });
  return { text, ratio, level };
}

/** Relative Zeitangabe. */
export function ago(unixSeconds: number, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const s = nowSeconds - unixSeconds;
  if (s < 60) return t("ein.geradeEben");
  if (s < 3600) return t("ein.vorMin", { n: Math.floor(s / 60) });
  if (s < 86400) return t("ein.vorStd", { n: Math.floor(s / 3600) });
  if (s < 30 * 86400) return t("ein.vorTagen", { n: Math.floor(s / 86400) });
  return new Date(unixSeconds * 1000).toLocaleDateString(gebietsschema());
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
