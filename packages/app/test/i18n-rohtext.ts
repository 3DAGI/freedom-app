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
