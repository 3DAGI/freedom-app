/**
 * Findet unübersetzten Text in index.html (8.16): Textknoten ohne ein
 * Vorfahren-Element mit `data-i18n` und Attribute (title, placeholder,
 * aria-label, alt) ohne ihr `data-i18n-*`. Je Bereich gezählt – ein Bereich
 * ist die Seite eines Tabs (`id="page-…"`), alles andere der Rahmen.
 * Eigennamen und Einheiten zählen nicht.
 */
const LEER = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const ATTRIBUTE: Record<string, string> = { title: "data-i18n-title", placeholder: "data-i18n-ph", "aria-label": "data-i18n-aria", alt: "data-i18n-aria" };
const EIGENNAMEN = new Set([
  "freedom", "sats", "sat", "sol", "lightning", "solana", "nostr", "bitcoin", "nwc", "lnurl", "ipfs", "tor", "mls",
  "blossom", "arweave", "codeberg", "radicle", "npub", "nsec", "pubkey",
]);

export interface Rohtext { bereich: string; text: string }

const woerter = (s: string) => s.match(/[A-Za-zÄÖÜäöüß]{2,}/g) ?? [];
const zaehlt = (s: string) => woerter(s).some((w) => !EIGENNAMEN.has(w.toLowerCase()));

function attribute(roh: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const a of roh.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) m.set(a[1].toLowerCase(), a[2] ?? a[3] ?? a[4] ?? "");
  return m;
}

export function rohtexte(html: string): Rohtext[] {
  const sauber = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, "");
  const stapel: { tag: string; uebersetzt: boolean; bereich: string }[] = [];
  const funde: Rohtext[] = [];
  for (const m of sauber.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/g)) {
    const oben = stapel[stapel.length - 1];
    const bereich = oben?.bereich ?? "rahmen";
    if (m[4] !== undefined) {
      const text = m[4].replace(/\s+/g, " ").trim();
      if (text && zaehlt(text) && !stapel.some((e) => e.uebersetzt)) funde.push({ bereich, text });
      continue;
    }
    const tag = m[2].toLowerCase();
    if (m[1]) {
      const i = stapel.map((e) => e.tag).lastIndexOf(tag);
      if (i >= 0) stapel.length = i;
      continue;
    }
    const a = attribute(m[3]);
    const eigener = a.get("id")?.startsWith("page-") ? a.get("id")! : bereich;
    for (const [name, schluessel] of Object.entries(ATTRIBUTE)) {
      const wert = a.get(name);
      if (wert && zaehlt(wert) && !a.has(schluessel)) funde.push({ bereich: eigener, text: `${name}="${wert}"` });
    }
    if (!LEER.has(tag) && !m[3].trim().endsWith("/")) stapel.push({ tag, uebersetzt: a.has("data-i18n"), bereich: eigener });
  }
  return funde;
}

/**
 * Rohtext im Code (8.16b): String-Literale, die wie sichtbarer Text aussehen –
 * zwei Wörter, ein Umlaut oder ein großgeschriebenes Wort; in Vorlagen zählt
 * der Text zwischen den Tags und title/placeholder/aria-label/alt. Nicht:
 * Selektoren, Speicher-Schlüssel, Imports, Konsolen-Ausgaben, Klassennamen,
 * Tastennamen – und Zeilen mit dem Vermerk `// kein UI-Text` (Daten, die so
 * gesendet oder gespeichert werden).
 */
export function rohtexteImCode(src: string): { zeile: number; text: string }[] {
  const funde: { zeile: number; text: string }[] = [];
  const zeilen = src.split("\n");
  const pruefe = (text: string, start: number, z0: number) => {
    if (istCodeText(text, src.slice(Math.max(0, start - 60), start), zeilen[z0 - 1] ?? "")) funde.push({ zeile: z0, text });
  };
  // Stapel: Code (mit Klammertiefe, in ${…} einer Vorlage) und Vorlagen (Teile bis ${)
  type Rahmen = { art: "code"; tiefe: number } | { art: "vorlage"; teile: string[]; buf: string; start: number; zeile: number };
  const stapel: Rahmen[] = [{ art: "code", tiefe: 0 }];
  let zeile = 1;
  let i = 0;
  while (i < src.length) {
    const r = stapel[stapel.length - 1];
    const c = src[i];
    if (r.art === "vorlage") {
      if (c === "\\") { r.buf += src.slice(i, i + 2); i += 2; continue; }
      if (c === "`") { r.teile.push(r.buf); stapel.pop(); pruefe(r.teile.join(" "), r.start, r.zeile); i++; continue; }
      if (src.startsWith("${", i)) { r.teile.push(r.buf); r.buf = ""; stapel.push({ art: "code", tiefe: 0 }); i += 2; continue; }
      if (c === "\n") zeile++;
      r.buf += c;
      i++;
      continue;
    }
    if (c === "\n") { zeile++; i++; continue; }
    if (src.startsWith("//", i)) { const j = src.indexOf("\n", i); i = j < 0 ? src.length : j; continue; }
    if (src.startsWith("/*", i)) { const j = src.indexOf("*/", i + 2); zeile += (src.slice(i, j).match(/\n/g) ?? []).length; i = j + 2; continue; }
    if (c === "{") { r.tiefe++; i++; continue; }
    if (c === "}") {
      if (r.tiefe === 0 && stapel.length > 1) stapel.pop(); else r.tiefe--;
      i++;
      continue;
    }
    if (c === "`") { stapel.push({ art: "vorlage", teile: [], buf: "", start: i, zeile }); i++; continue; }
    if (c === "/" && /[=(,:!&|?{};]\s*$/.test(src.slice(Math.max(0, i - 20), i))) {
      // Regex-Literal überspringen
      i++;
      let klasse = false;
      while (i < src.length && (src[i] !== "/" || klasse) && src[i] !== "\n") {
        if (src[i] === "\\") i++;
        else if (src[i] === "[") klasse = true;
        else if (src[i] === "]") klasse = false;
        i++;
      }
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const start = i;
      let buf = "";
      i++;
      while (i < src.length && src[i] !== c && src[i] !== "\n") {
        if (src[i] === "\\") { buf += src.slice(i, i + 2); i += 2; continue; }
        buf += src[i];
        i++;
      }
      i++;
      pruefe(buf, start, zeile);
      continue;
    }
    i++;
  }
  return funde;
}

const KOPFZEILEN = new Set(["Content-Type", "Authorization", "Accept", "User-Agent", "Cache-Control"]);

function istCodeText(s: string, davor: string, zeile: string): boolean {
  if (/\/\/ kein UI-Text\s*$/.test(zeile) || KOPFZEILEN.has(s)) return false;
  if (/(querySelector(All)?|getElementById|closest|matches|addEventListener|removeEventListener|classList\.\w+|setAttribute|getAttribute|getItem|setItem|removeItem|\bimport|\bfrom|console\.\w+|\$\$?|\bkey\s*===?|\bcode\s*===?)\s*\(?\s*$/.test(davor)) return false;
  if (/className|class=/.test(zeile) && /^[a-z0-9 _-]*$/.test(s)) return false;
  const attr = [...s.matchAll(/(?:title|placeholder|aria-label|alt)="([^"]*)"/g)].map((m) => m[1]).join(" ");
  const sichtbar = `${s.replace(/<[^>]*>/g, " ")} ${attr}`;
  if (/[A-Za-zÄÖÜäöüß]{2,}[ ,]+[A-Za-zÄÖÜäöüß]{2,}/.test(sichtbar)) return true;
  if (/\s/.test(sichtbar.trim()) && (sichtbar.match(/[A-ZÄÖÜ][a-zäöüß]{2,}/g) ?? []).length > 0 && (sichtbar.match(/[A-Za-zÄÖÜäöüß]{2,}/g) ?? []).length >= 2) return true;
  if (/[ÄÖÜäöüß]/.test(sichtbar)) return true;
  if (/[A-Za-zÄÖÜäöüß]{3,}\s*(…|\.\.\.)\s*$/.test(sichtbar)) return true;
  return /^\s*[A-ZÄÖÜ][a-zäöüß]{2,}(-[A-ZÄÖÜa-zäöüß]+)*[^A-Za-zÄÖÜäöüß]*$/.test(sichtbar);
}
