// Kiwix als MCP-Server (B-31b, MC1 A, `docs/PROVIDER.md` „Werkzeuge über MCP“): Wikipedia & Co. ohne Internet.
// Läuft nur in der Sandbox des Knotens (`starteMcpServer()`: ohne Netz, Wurzel nur lesbar, Grenzen) – startet dort
// `kiwix-serve` auf 127.0.0.1 (nur in der Sandbox erreichbar) und beantwortet MCP über stdio, eine JSON-Nachricht je
// Zeile. Nur Node, keine Pakete. Was gesucht und gelesen wird, ist Inhalt einer KI-Anfrage: nichts davon ins Log –
// die Brücke schreibt nie nach stderr, `kiwix-serve` bekommt keine Ausgabe.
//   node kiwix-bruecke.mjs <kiwix-serve> <datei.zim>…
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createInterface } from "node:readline";

/** Grenzen der Brücke. */
export const KIWIX_GRENZEN = { frageZeichen: 200, treffer: 10, textZeichen: 20_000, antwortBytes: 4_000_000, startMs: 20_000, umleitungen: 3 };

/** MCP-Fassungen, die die Brücke spricht (dieselben wie Freedom-MCP, `freedom-mcp.ts`). */
const FASSUNGEN = ["2024-11-05", "2025-03-26", "2025-06-18"];

export const WERKZEUGE = [
  {
    name: "search",
    description: "Full-text search in the offline encyclopedias on this node (Kiwix, e.g. Wikipedia) – no internet. Returns titles, short excerpts and the path to read each one.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Search words" } }, required: ["query"], additionalProperties: false },
  },
  {
    name: "read",
    description: "Read an article from the offline encyclopedias on this node as plain text. Use a path from search (book/entry).",
    inputSchema: { type: "object", properties: { path: { type: "string", description: "Path from search, e.g. wikipedia_de/A/Berlin" } }, required: ["path"], additionalProperties: false },
  },
];

const PFAD = /^[A-Za-z0-9_.-]{1,100}\/[^?#\\\u0000-\u001f]{1,400}$/;

/** Ein Pfad aus der Suche: `<buch>/<eintrag>`, ohne `..`, ohne Abfrage – nie eine andere Adresse von `kiwix-serve`. */
export function istArtikelPfad(p) {
  return typeof p === "string" && PFAD.test(p) && !p.split("/").some((t) => t === "" || t === "." || t === "..");
}

const BENANNT = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

/** HTML-Entitäten (benannte Grundform und Zahlen); Unbekanntes bleibt stehen. */
export function entitaeten(s) {
  return s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, (m, e) => {
    if (e[0] !== "#") return BENANNT[e.toLowerCase()] ?? m;
    const n = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : m;
  });
}

/** Eine Seite als Text: ohne Skripte, Stile und Kommentare, Absätze als Leerzeilen. */
export function alsText(html) {
  return entitaeten(html
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|table|ul|ol|dl|dd|dt|section|blockquote|pre|figure)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, ""))
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ ?\n[ \n]*/g, "\n\n")
    .trim();
}

/** Treffer aus der Suche von `kiwix-serve` (`format=xml`, OpenSearch): Titel, Auszug, Pfad zum Lesen. */
export function leseTreffer(xml) {
  const aus = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const teil = (n) => alsText(m[1].match(new RegExp(`<${n}>([\\s\\S]*?)</${n}>`))?.[1] ?? "");
    const link = teil("link");
    if (!link.startsWith("/content/")) continue;
    let pfad;
    try {
      pfad = decodeURIComponent(link.slice("/content/".length));
    } catch {
      continue;
    }
    if (!istArtikelPfad(pfad)) continue;
    aus.push({ titel: teil("title").slice(0, 200), auszug: teil("description").replace(/\s+/g, " ").slice(0, 400), pfad });
    if (aus.length >= KIWIX_GRENZEN.treffer) break;
  }
  return aus;
}

/** Ein freier Port auf 127.0.0.1 – in der Sandbox gibt es nur diese Schnittstelle. */
function freierPort() {
  return new Promise((fertig, fehler) => {
    const s = createServer();
    s.once("error", fehler);
    s.listen(0, "127.0.0.1", () => {
      const port = s.address().port;
      s.close(() => fertig(port));
    });
  });
}

/** Holt eine Adresse von `kiwix-serve` – nur von dort, Umleitungen nur auf denselben Ursprung, Antwort begrenzt. */
async function hole(basis, pfad) {
  let url = new URL(pfad, basis);
  for (let i = 0; i <= KIWIX_GRENZEN.umleitungen; i++) {
    if (url.origin !== basis) return null;
    const r = await fetch(url, { redirect: "manual" });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
      url = new URL(r.headers.get("location"), url);
      continue;
    }
    if (!r.ok) return null;
    const bytes = await r.arrayBuffer();
    return bytes.byteLength <= KIWIX_GRENZEN.antwortBytes ? new TextDecoder().decode(bytes) : null;
  }
  return null;
}

async function bereit(basis, kind) {
  const bis = Date.now() + KIWIX_GRENZEN.startMs;
  while (Date.now() < bis && kind.exitCode === null) {
    try {
      if ((await fetch(new URL("/catalog/v2/entries", basis))).ok) return true;
    } catch {
      /* noch nicht da */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/** Ein Aufruf des Modells – Fehler nur als feste Texte. */
export async function rufe(basis, name, args) {
  if (name === "search") {
    const q = typeof args?.query === "string" ? args.query.trim() : "";
    if (!q || q.length > KIWIX_GRENZEN.frageZeichen) return { text: `query: 1 to ${KIWIX_GRENZEN.frageZeichen} characters`, fehler: true };
    const xml = await hole(basis, `/search?pattern=${encodeURIComponent(q)}&format=xml&pageLength=${KIWIX_GRENZEN.treffer}`);
    if (xml === null) return { text: "search failed", fehler: true };
    const treffer = leseTreffer(xml);
    if (treffer.length === 0) return { text: "no results", fehler: false };
    return { text: treffer.map((t, i) => `${i + 1}. ${t.titel} – ${t.auszug}\n   path: ${t.pfad}`).join("\n"), fehler: false };
  }
  if (name === "read") {
    if (!istArtikelPfad(args?.path)) return { text: "path: use a path from search (book/entry)", fehler: true };
    const html = await hole(basis, `/content/${args.path.split("/").map(encodeURIComponent).join("/")}`);
    if (html === null) return { text: "not found", fehler: true };
    const text = alsText(html);
    return { text: text.length > KIWIX_GRENZEN.textZeichen ? `${text.slice(0, KIWIX_GRENZEN.textZeichen)}\n[shortened]` : text, fehler: false };
  }
  return { text: "unknown tool", fehler: true };
}

async function lauf() {
  const [kiwixServe, ...zims] = process.argv.slice(2);
  if (!kiwixServe || zims.length === 0) process.exit(2);
  const port = await freierPort();
  const basis = `http://127.0.0.1:${port}`;
  // nur auf 127.0.0.1, keine Verweise nach außen, endet mit der Brücke
  const kind = spawn(kiwixServe, [`--address=127.0.0.1`, `--port=${port}`, "--blockexternal", `--attachToProcess=${process.pid}`, ...zims], { stdio: "ignore" });
  kind.on("error", () => { /* fehlt das Programm, beantwortet initialize mit Fehler */ });
  const start = bereit(basis, kind);
  const sende = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
  const zeilen = createInterface({ input: process.stdin, crlfDelay: Infinity });
  zeilen.on("close", () => {
    kind.kill();
    process.exit(0);
  });
  for await (const zeile of zeilen) {
    let m;
    try {
      m = JSON.parse(zeile);
    } catch {
      continue;
    }
    if (m?.id === undefined || typeof m.method !== "string") continue; // Benachrichtigungen und Antworten
    const antwort = (result) => sende({ jsonrpc: "2.0", id: m.id, result });
    const fehler = (code, message) => sende({ jsonrpc: "2.0", id: m.id, error: { code, message } });
    if (m.method === "initialize") {
      if (!(await start)) fehler(-32000, "kiwix-serve not ready");
      else antwort({ protocolVersion: FASSUNGEN.includes(m.params?.protocolVersion) ? m.params.protocolVersion : FASSUNGEN.at(-1), capabilities: { tools: {} }, serverInfo: { name: "freedom-kiwix", version: "1" } });
    } else if (m.method === "ping") antwort({});
    else if (m.method === "tools/list") antwort({ tools: WERKZEUGE });
    else if (m.method === "tools/call") {
      const r = await rufe(basis, m.params?.name, m.params?.arguments).catch(() => ({ text: "kiwix not reachable", fehler: true }));
      antwort({ content: [{ type: "text", text: r.text }], isError: r.fehler });
    } else fehler(-32601, "Method not found");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) void lauf();
