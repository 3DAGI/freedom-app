// Jupyter-Notebooks als MCP-Server für den Motor (VKk2a, `docs/VIBECODEN-ENTWURF.md` VKk): Zellen lesen, anlegen,
// ändern und löschen – geschrieben wie Jupyter selbst (nbformat 4, sortierte Schlüssel, Quelltext als Zeilen), damit git
// nur die geänderte Zelle zeigt. Läuft nur als Kind von Hermes in dessen Sandbox, nur unter dem Projekt (`/arbeit`).
// Ausgeführt wird hier nichts: Code läuft nur über das Terminal von Hermes, das vorher fragt – seit VKk2b mit
// `notebook_ausfuehren.py` daneben; den Befehl nennt `notebook_read` nur, wenn ein Kernel da ist. Nur Node, keine Pakete;
// stdout ist der MCP-Kanal (eine JSON-Nachricht je Zeile), nach stderr schreibt die Brücke nie – Zellen sind Inhalt des
// Projekts.
//   node jupyter-bruecke.mjs <projekt> [--ausfuehren=<skript in der sandbox>]
import { randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { createInterface } from "node:readline";

/** Grenzen der Brücke. */
export const NB_GRENZEN = { pfadZeichen: 300, dateiBytes: 25_000_000, quelleZeichen: 100_000, zellen: 5_000, textZeichen: 20_000, zelleZeichen: 4_000, ausgabeZeichen: 2_000 };

/** MCP-Fassungen, die die Brücke spricht (dieselben wie Freedom-MCP und Kiwix). */
const FASSUNGEN = ["2024-11-05", "2025-03-26", "2025-06-18"];

/** Der Kernel neuer Notebooks – wie JupyterLab ihn einträgt. */
export const KERNEL = {
  kernelspec: { display_name: "Python 3 (ipykernel)", language: "python", name: "python3" },
  language_info: { name: "python" },
};

const PFAD_ANGABE = { type: "string", description: "Notebook path in the project, e.g. analysis.ipynb or notebooks/a.ipynb" };
const INDEX = { type: "integer", minimum: 0, description: "Cell number, starting at 0" };
const ART = { type: "string", enum: ["code", "markdown", "raw"] };

export const WERKZEUGE = [
  {
    name: "notebook_read",
    description: "Read a Jupyter notebook in the project: every cell with its number, type, source and saved outputs (text; images and other media only named). Long notebooks come in parts – continue with start.",
    inputSchema: { type: "object", properties: { path: PFAD_ANGABE, start: { ...INDEX, description: "First cell to show (default 0)" } }, required: ["path"], additionalProperties: false },
  },
  {
    name: "notebook_create",
    description: "Create a new, empty Jupyter notebook (Python 3 kernel) in the project. The folder must exist; an existing file is never replaced.",
    inputSchema: { type: "object", properties: { path: PFAD_ANGABE }, required: ["path"], additionalProperties: false },
  },
  {
    name: "cell_insert",
    description: "Insert a cell into a notebook before the given cell number (default: append at the end).",
    inputSchema: { type: "object", properties: { path: PFAD_ANGABE, index: INDEX, type: { ...ART, description: "Cell type (default code)" }, source: { type: "string" } }, required: ["path", "source"], additionalProperties: false },
  },
  {
    name: "cell_edit",
    description: "Replace the source of a cell (and optionally its type). Saved outputs of a code cell are removed – they no longer match.",
    inputSchema: { type: "object", properties: { path: PFAD_ANGABE, index: INDEX, source: { type: "string" }, type: ART }, required: ["path", "index", "source"], additionalProperties: false },
  },
  {
    name: "cell_delete",
    description: "Delete a cell from a notebook.",
    inputSchema: { type: "object", properties: { path: PFAD_ANGABE, index: INDEX }, required: ["path", "index"], additionalProperties: false },
  },
];

/**
 * Ein Pfad im Projekt: relativ oder unter der Wurzel, endet auf `.ipynb`; kein Teil leer, `.` oder `..`, keiner beginnt
 * mit einem Punkt (`.git`, `.ipynb_checkpoints`), keine Steuerzeichen, kein Rückstrich. Ergebnis: die Teile unter der
 * Wurzel, sonst null.
 */
export function notebookTeile(wurzel, p) {
  if (typeof p !== "string" || p.length === 0 || p.length > NB_GRENZEN.pfadZeichen || /[\u0000-\u001f\u007f\\]/.test(p)) return null;
  const rel = isAbsolute(p) ? (p.startsWith(`${wurzel}/`) ? p.slice(wurzel.length + 1) : null) : p;
  if (rel === null || !rel.endsWith(".ipynb")) return null;
  const teile = rel.split("/");
  return teile.every((t) => t !== "" && !t.startsWith(".")) ? teile : null;
}

/** Zeilen wie Pythons `str.splitlines(True)` – so speichert nbformat Quelltext. */
export function zeilen(text) {
  return text.match(/[^\n\r\v\f\x1c-\x1e\x85\u2028\u2029]*(?:\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029])|[^\n\r\v\f\x1c-\x1e\x85\u2028\u2029]+$/g) ?? [];
}

const alsText = (t) => (Array.isArray(t) ? t.join("") : typeof t === "string" ? t : "");

function sortiert(w) {
  if (Array.isArray(w)) return w.map(sortiert);
  if (w === null || typeof w !== "object") return w;
  return Object.fromEntries(Object.keys(w).sort().map((k) => [k, sortiert(w[k])]));
}

/** Das Notebook als Datei – wie nbformat: Schlüssel sortiert, eingerückt mit einem Leerzeichen, Zeilenende am Schluss. */
export function alsJson(nb) {
  return `${JSON.stringify(sortiert(nb), null, 1)}\n`;
}

export function neuesNotebook() {
  return { cells: [], metadata: structuredClone(KERNEL), nbformat: 4, nbformat_minor: 5 };
}

/** Eine neue Zelle wie `nbformat.v4.new_*_cell` – die Kennung nur ab nbformat 4.5. */
export function neueZelle(art, quelle, id) {
  const z = { cell_type: art, ...(id ? { id } : {}), metadata: {}, source: zeilen(quelle) };
  return art === "code" ? { ...z, execution_count: null, outputs: [] } : z;
}

/** Nur nbformat 4 mit einer Liste von Zellen. */
export function istNotebook(nb) {
  return typeof nb === "object" && nb !== null && !Array.isArray(nb) && nb.nbformat === 4 && Number.isSafeInteger(nb.nbformat_minor)
    && Array.isArray(nb.cells) && nb.cells.length <= NB_GRENZEN.zellen
    && nb.cells.every((z) => typeof z === "object" && z !== null && typeof z.cell_type === "string");
}

const ohneFarben = (t) => t.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
const gekuerzt = (t, n) => (t.length > n ? `${t.slice(0, n)}\n[… ${t.length - n} more characters]` : t);

/** Gespeicherte Ausgaben einer Code-Zelle als Text – Bilder und andere Medien nur mit ihrem Typ. */
export function ausgabenText(ausgaben) {
  const teile = [];
  for (const a of Array.isArray(ausgaben) ? ausgaben : []) {
    if (a?.output_type === "stream") teile.push(`${a.name === "stderr" ? "stderr: " : ""}${alsText(a.text)}`);
    else if (a?.output_type === "execute_result" || a?.output_type === "display_data") {
      const daten = typeof a.data === "object" && a.data !== null ? a.data : {};
      const andere = Object.keys(daten).filter((m) => m !== "text/plain").sort();
      teile.push([alsText(daten["text/plain"]), ...andere.map((m) => `[${m}]`)].filter(Boolean).join("\n"));
    } else if (a?.output_type === "error") {
      const kopf = `${a.ename}: ${a.evalue}`;
      const spur = (Array.isArray(a.traceback) ? a.traceback : []).map((z) => ohneFarben(String(z))).filter((z) => z !== kopf);
      teile.push([kopf, ...spur].join("\n"));
    }
  }
  return ohneFarben(teile.join("\n").trim());
}

/** Das Notebook zum Lesen – ab `start`, bis die Grenze erreicht ist. */
export function notebookText(nb, start = 0) {
  const n = nb.cells.length;
  const kopf = `${n} cells, nbformat 4.${nb.nbformat_minor}, kernel ${nb.metadata?.kernelspec?.name ?? "–"}`;
  const teile = [kopf];
  let laenge = kopf.length;
  let i = start;
  for (; i < n; i++) {
    const z = nb.cells[i];
    const lauf = z.cell_type === "code" ? (Number.isSafeInteger(z.execution_count) ? `, run ${z.execution_count}` : ", not run") : "";
    const ausgabe = z.cell_type === "code" ? ausgabenText(z.outputs) : "";
    const teil = [`[${i}] ${z.cell_type}${lauf}`, gekuerzt(alsText(z.source), NB_GRENZEN.zelleZeichen),
      ...(ausgabe ? ["→ output:", gekuerzt(ausgabe, NB_GRENZEN.ausgabeZeichen)] : [])].join("\n");
    if (i > start && laenge + teil.length > NB_GRENZEN.textZeichen) break;
    teile.push(teil);
    laenge += teil.length;
  }
  if (i < n) teile.push(`[cells ${start}–${i - 1} of ${n} shown – continue with start=${i}]`);
  return teile.join("\n\n");
}

class NbFehler extends Error {}

/** Den Ort prüfen: jeder Ordner davor echt (kein Verweis), die Datei selbst eine echte Datei – oder noch nicht da. */
function ort(wurzel, teile, neu) {
  let p = wurzel;
  for (const [i, t] of teile.entries()) {
    p = join(p, t);
    let st;
    try {
      st = lstatSync(p);
    } catch {
      if (neu && i === teile.length - 1) return p;
      throw new NbFehler(i === teile.length - 1 ? "no such notebook" : "no such folder");
    }
    if (i < teile.length - 1) {
      if (!st.isDirectory()) throw new NbFehler("no such folder");
    } else if (neu || !st.isFile()) throw new NbFehler(neu ? "file exists" : "not a notebook file");
  }
  return p;
}

function lies(datei) {
  let fd;
  try {
    fd = openSync(datei, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    throw new NbFehler("cannot open notebook");
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw new NbFehler("not a notebook file");
    if (st.size > NB_GRENZEN.dateiBytes) throw new NbFehler("notebook too large");
    let nb;
    try {
      nb = JSON.parse(readFileSync(fd, "utf8"));
    } catch {
      throw new NbFehler("not valid JSON");
    }
    if (!istNotebook(nb)) throw new NbFehler("only nbformat 4 notebooks are supported");
    return { nb, modus: st.mode & 0o777 };
  } finally {
    closeSync(fd);
  }
}

/** Schreiben über eine neue Datei daneben (`wx`: nie durch einen Verweis) und Umbenennen. */
function schreibe(datei, nb, modus = 0o644) {
  const zwischen = join(dirname(datei), `.${basename(datei)}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(zwischen, alsJson(nb), { flag: "wx", mode: modus });
    renameSync(zwischen, datei);
  } catch {
    rmSync(zwischen, { force: true });
    throw new NbFehler("cannot write notebook");
  }
}

function neueId(nb) {
  if (nb.nbformat_minor < 5) return undefined;
  const da = new Set(nb.cells.map((z) => z.id));
  for (;;) {
    const id = randomBytes(4).toString("hex");
    if (!da.has(id)) return id;
  }
}

const istIndex = (i, n) => Number.isSafeInteger(i) && i >= 0 && i < n;

/** Die Werkzeuge, wie der Motor sie sieht – mit Kernel nennt `notebook_read`, wie man im Terminal ausführt (VKk2b). */
export function werkzeuge(ausfuehren) {
  if (!ausfuehren) return WERKZEUGE;
  return WERKZEUGE.map((w) => (w.name === "notebook_read"
    ? { ...w, description: `${w.description} To run all code cells, use the terminal: ${ausfuehren} <path> – the outputs are saved in the notebook, then read them here.` }
    : w));
}

/** Ein Aufruf des Modells – Fehler nur als feste Texte. */
export function rufe(wurzel, name, args) {
  const a = typeof args === "object" && args !== null ? args : {};
  const teile = notebookTeile(wurzel, a.path);
  if (!WERKZEUGE.some((w) => w.name === name)) return { text: "unknown tool", fehler: true };
  if (!teile) return { text: "path: a .ipynb file in the project, without .. or hidden folders", fehler: true };
  const anzeige = teile.join("/");
  const mitQuelle = name === "cell_insert" || name === "cell_edit";
  if ((mitQuelle || "source" in a) && (typeof a.source !== "string" || a.source.length > NB_GRENZEN.quelleZeichen)) return { text: `source: text up to ${NB_GRENZEN.quelleZeichen} characters`, fehler: true };
  if ("type" in a && !ART.enum.includes(a.type)) return { text: "type: code, markdown or raw", fehler: true };
  try {
    if (name === "notebook_create") {
      schreibe(ort(wurzel, teile, true), neuesNotebook());
      return { text: `created ${anzeige} (empty, Python 3 kernel)`, fehler: false };
    }
    const datei = ort(wurzel, teile, false);
    const { nb, modus } = lies(datei);
    const n = nb.cells.length;
    if (name === "notebook_read") {
      const start = a.start ?? 0;
      if (!(start === 0 || istIndex(start, n))) return { text: `start: 0 to ${Math.max(n - 1, 0)}`, fehler: true };
      return { text: `${anzeige}: ${notebookText(nb, start)}`, fehler: false };
    }
    if (name === "cell_insert") {
      const index = a.index ?? n;
      if (!(Number.isSafeInteger(index) && index >= 0 && index <= n)) return { text: `index: 0 to ${n}`, fehler: true };
      if (n >= NB_GRENZEN.zellen) return { text: "notebook has too many cells", fehler: true };
      nb.cells.splice(index, 0, neueZelle(a.type ?? "code", a.source, neueId(nb)));
      schreibe(datei, nb, modus);
      return { text: `inserted cell ${index} (${a.type ?? "code"}) – ${anzeige} has ${n + 1} cells`, fehler: false };
    }
    if (!istIndex(a.index, n)) return { text: n === 0 ? "the notebook has no cells" : `index: 0 to ${n - 1}`, fehler: true };
    if (name === "cell_edit") {
      const alt = nb.cells[a.index];
      // Kennung, Metadaten und Anhänge bleiben; Ausgaben einer Code-Zelle passen nicht mehr zur Quelle
      const neu = neueZelle(a.type ?? alt.cell_type, a.source, alt.id);
      nb.cells[a.index] = { ...neu, metadata: alt.metadata ?? {}, ...(alt.attachments && neu.cell_type !== "code" ? { attachments: alt.attachments } : {}) };
      schreibe(datei, nb, modus);
      return { text: `changed cell ${a.index} (${neu.cell_type})`, fehler: false };
    }
    nb.cells.splice(a.index, 1);
    schreibe(datei, nb, modus);
    return { text: `deleted cell ${a.index} – ${anzeige} has ${n - 1} cells`, fehler: false };
  } catch (e) {
    return { text: e instanceof NbFehler ? e.message : "notebook error", fehler: true };
  }
}

async function lauf() {
  const [wurzel, ...rest] = process.argv.slice(2);
  const ausfuehren = rest.length === 1 && /^--ausfuehren=\/[^\s]+\.py$/.test(rest[0]) ? rest[0].slice("--ausfuehren=".length) : null;
  if (!wurzel || !isAbsolute(wurzel) || rest.length > (ausfuehren ? 1 : 0)) process.exit(2);
  const sende = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
  const zeilenStrom = createInterface({ input: process.stdin, crlfDelay: Infinity });
  zeilenStrom.on("close", () => process.exit(0));
  for await (const zeile of zeilenStrom) {
    let m;
    try {
      m = JSON.parse(zeile);
    } catch {
      continue;
    }
    if (m?.id === undefined || typeof m.method !== "string") continue; // Benachrichtigungen und Antworten
    const antwort = (result) => sende({ jsonrpc: "2.0", id: m.id, result });
    if (m.method === "initialize") {
      antwort({ protocolVersion: FASSUNGEN.includes(m.params?.protocolVersion) ? m.params.protocolVersion : FASSUNGEN.at(-1), capabilities: { tools: {} }, serverInfo: { name: "freedom-jupyter", version: "1" } });
    } else if (m.method === "ping") antwort({});
    else if (m.method === "tools/list") antwort({ tools: werkzeuge(ausfuehren) });
    else if (m.method === "tools/call") {
      const r = rufe(wurzel, m.params?.name, m.params?.arguments);
      antwort({ content: [{ type: "text", text: r.text }], isError: r.fehler });
    } else sende({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "Method not found" } });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) void lauf();
