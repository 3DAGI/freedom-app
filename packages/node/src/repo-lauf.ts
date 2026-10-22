/**
 * Ablauf für Repo-Aufträge (Schritt 11.5c1, `docs/REPO-AGENTEN-ENTWURF.md` W3a A): nachgebaut nach
 * mini-swe-agent (Fassung 1.x) – eine lineare Unterhaltung, je Antwort genau ein Befehl als
 * ```bash-Block im Text (geht auch mit lokalen Modellen ohne Tool-Calling), jeder Befehl in einer
 * neuen Shell in der Sandbox (`fuehreAus()`), die Ausgabe gekürzt zurück. Fertig ist der Auftrag,
 * wenn die erste Zeile der Ausgabe `COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT` ist und der Befehl mit 0
 * endet; höchstens drei Formfehler hintereinander.
 *
 * Anders als dort: Grenzen nach Schritten, Zeit und Tokens (Obergrenze des Preises, W5) statt nach
 * Dollar; das Modell gibt keinen Diff aus – den Patch baut der Knoten aus dem Arbeitsordner
 * (`leseArbeitsordner()`, `schreibePatch()`, V5). Ist eine Grenze erreicht, gibt es keinen Patch.
 * Nichts davon geht ins Log oder auf die Platte außer dem Arbeitsordner im tmpfs, und der ist nach
 * dem Auftrag weg (P4).
 *
 * Die Anweisungen an das Modell sind die von mini-swe-agent, angepasst an die Sandbox (kein Netz,
 * kein git, `/arbeit`) und an den Abschluss mit Betreff. Sie bleiben englisch wie im Original –
 * daran wurden die Modelle gemessen (SWE-bench „Bash only“).
 *
 * Pakete (11.5c3, W6a „So“, nur offene Räume): Vor dem Ablauf holt der Knoten, was `package-lock.json` und
 * `requirements.txt` des Bundles mit Prüfsumme nennen (`holeAusSperre()`), in einen eigenen Zwischenspeicher im tmpfs;
 * die Sandbox sieht ihn nur lesbar als `/pakete`, npm und pip sind darauf eingestellt. Ein neues Paket fragt das Modell
 * mit der Zeile `paket_holen <npm|pypi> <name> <version>` an – die führt der Knoten aus (`paketHolen()`), nie die
 * Sandbox. Scheitert das Holen, läuft der Auftrag ohne Pakete; das Modell und die Antwort erfahren es.
 *
 * Teile davon nach mini-swe-agent (https://github.com/SWE-agent/mini-swe-agent):
 *
 *   MIT License
 *
 *   Copyright (c) 2025 Kilian A. Lieret and Carlos E. Jimenez
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy
 *   of this software and associated documentation files (the "Software"), to deal
 *   in the Software without restriction, including without limitation the rights
 *   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *   copies of the Software, and to permit persons to whom the Software is
 *   furnished to do so, subject to the following conditions:
 *
 *   The above copyright notice and this permission notice shall be included in all
 *   copies or substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 *   SOFTWARE.
 */
import { machine } from "node:os";
import { type Arbeitskopie, type GelesenesBundle, type PatchAngaben, type PatchErgebnis, arbeitskopie, schreibePatch } from "@freedomstack/protocol";
import { leseArbeitsordner, neuerArbeitsordner, schreibeArbeitskopie } from "./arbeitskopie.js";
import {
  type PaketFall, type PaketOptionen, type PaketPlattform, type PaketRegistry, PaketAbgelehnt, PaketKonto, holeAusSperre, paketHolen,
} from "./pakete.js";
import { SANDBOX_GRENZEN, type SandboxErgebnis, fuehreAus } from "./sandbox.js";

/** Grenzen je Auftrag (Vorgabe aus dem Entwurf; der Betreiber kann sie senken). */
export const REPO_LAUF_GRENZEN = {
  /** Antworten des Modells – auch solche mit Formfehler (wie `step_limit`). */
  schritte: 50,
  zeitMs: 30 * 60_000,
  /** Formfehler hintereinander. */
  formfehler: 3,
} as const;

export type RepoLaufGrenzen = { [K in keyof typeof REPO_LAUF_GRENZEN]: number } & { tokens: number; befehlMs: number };

export const ENDE_MARKE = "COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT";

export interface RepoNachricht { role: "system" | "user" | "assistant"; content: string }

/** Eine Antwort des Modells; `abgeschnitten`, wenn sie an der Grenze der Tokens endete (`finish_reason: length`). */
export interface RepoModellAntwort { text: string; tokens: number; abgeschnitten?: boolean }

export type RepoLaufEnde = "fertig" | "schritte" | "zeit" | "tokens" | "formfehler" | "modell" | "sandbox";

export interface RepoLaufErgebnis {
  ende: RepoLaufEnde;
  schritte: number;
  tokens: number;
  /** Nur bei `fertig`: was das Modell nach der Marke ausgab – erste Zeile Betreff, der Rest Beschreibung. */
  abschluss?: { betreff: string; beschreibung: string };
}

export interface RepoLaufOpts {
  aufgabe: string;
  modell: (nachrichten: readonly RepoNachricht[]) => Promise<RepoModellAntwort>;
  /** Einen Befehl ausführen – im Knoten nur über `fuehreAus()` mit dem Arbeitsordner. */
  fuehre: (befehl: readonly string[], zeitMs: number) => Promise<SandboxErgebnis>;
  /**
   * Pakete (11.5c3, nur offene Räume): `/pakete` ist eingebunden, `hole` führt `paket_holen` im Knoten aus; `fehlt`, wenn
   * die Pakete der Sperrdatei nicht zu holen waren. Ohne diese Angabe gibt es kein `paket_holen` – die Zeile ginge als
   * gewöhnlicher Befehl in die Sandbox.
   */
  pakete?: { hole: (registry: PaketRegistry, name: string, version: string) => Promise<Array<{ url: string; pruefsumme: string }>>; fehlt?: PaketFall };
  grenzen?: Partial<RepoLaufGrenzen>;
  jetzt?: () => number;
}

const SYSTEM = `You are a helpful assistant that can interact with a computer.

Your response must contain exactly ONE bash code block with ONE command (or commands connected with && or ||).
Include a THOUGHT section before your command where you explain your reasoning process.
Format your response as shown in <format_example>.

<format_example>
THOUGHT: Your reasoning and analysis here

\`\`\`bash
your_command_here
\`\`\`
</format_example>

Failure to follow these rules will cause your response to be rejected.`;

/** Ort des Zwischenspeichers in der Sandbox – und wie npm und pip ihn ohne Netz nutzen (Logs von npm nach `/tmp`). */
export const PAKETE_IN_SANDBOX = "/pakete";
const PAKET_UMGEBUNG = `npm_config_cache=${PAKETE_IN_SANDBOX}/npm npm_config_offline=true npm_config_ignore_scripts=true `
  + "npm_config_logs_dir=/tmp/npm-logs npm_config_audit=false npm_config_fund=false npm_config_update_notifier=false "
  + `PIP_NO_INDEX=1 PIP_FIND_LINKS=${PAKETE_IN_SANDBOX}/pypi PIP_DISABLE_PIP_VERSION_CHECK=1`;

const paketText = (fehlt: PaketFall | undefined): string => `
## Packages

${fehlt
    ? `The packages listed in package-lock.json and requirements.txt could not all be downloaded (${fehlt}); do not rely on them.`
    : "The packages listed in package-lock.json and requirements.txt (with --hash) were downloaded before you started."}
They are in ${PAKETE_IN_SANDBOX} (read-only), and npm and pip are configured to use them without network:
\`npm ci\` and \`pip install --target <dir> --require-hashes -r requirements.txt\` work offline. Install scripts do not run.
To add a new package, issue \`paket_holen npm <name> <exact-version>\` or \`paket_holen pypi <name> <exact-version>\`
as the only command. It prints the download URL and checksum of each file. Add them yourself to package-lock.json
(\`resolved\`, \`integrity\`) and package.json, or to requirements.txt (\`name==version --hash=sha256:...\`), then install as above.
Dependencies of a new package are not fetched with it - request them one by one.
`;

const auftragText = (aufgabe: string, pakete?: RepoLaufOpts["pakete"]): string => `Please solve this issue: ${aufgabe}

You can execute bash commands and edit files to implement the necessary changes.
The repository is checked out in the current directory (/arbeit). There is no network and no git:
the changes are taken from the files when you finish.
${pakete ? paketText(pakete.fehlt) : ""}
## Recommended Workflow

This workflow should be done step-by-step so that you can iterate on your changes and any possible problems.

1. Analyze the codebase by finding and reading relevant files
2. Create a script to reproduce the issue
3. Edit the source code to resolve the issue
4. Verify your fix works by running your script again
5. Test edge cases to ensure your fix is robust
6. Remove scripts you only needed for testing
7. Submit your changes and finish your work by issuing the following command, with a one-line summary of the change
   and, if useful, a short description: \`printf '%s\\n' ${ENDE_MARKE} 'Summary in one line' 'Description'\`.
   Do not combine it with any other command. <important>After this command, you cannot continue working on this task.</important>

## Important Rules

1. Every response must contain exactly one action
2. The action must be enclosed in triple backticks
3. Directory or environment variable changes are not persistent. Every action is executed in a new subshell.
   However, you can prefix any action with \`MY_ENV_VAR=MY_VALUE cd /path/to/working/dir && ...\` or write/load environment variables from files

<system_information>
Linux ${machine()}
</system_information>

## Formatting your response

Here is an example of a correct response:

<example_response>
THOUGHT: I need to understand the structure of the repository first. Let me check what files are in the current directory to get a better understanding of the codebase.

\`\`\`bash
ls -la
\`\`\`
</example_response>

## Useful command examples

### Create a new file:

\`\`\`bash
cat <<'EOF' > newfile.py
import numpy as np
hello = "world"
print(hello)
EOF
\`\`\`

### Edit files with sed:

\`\`\`bash
# Replace all occurrences
sed -i 's/old_string/new_string/g' filename.py

# Replace only first occurrence
sed -i 's/old_string/new_string/' filename.py

# Replace first occurrence on line 1
sed -i '1s/old_string/new_string/' filename.py

# Replace all occurrences in lines 1-10
sed -i '1,10s/old_string/new_string/g' filename.py
\`\`\`

### View file content:

\`\`\`bash
# View specific lines with numbers
nl -ba filename.py | sed -n '10,20p'
\`\`\`

### Any other command you want to run

\`\`\`bash
anything
\`\`\``;

const formfehlerText = (n: number, abgeschnitten: boolean): string => abgeschnitten
  ? "Your previous response reached the output token limit before you produced a complete action, so it was cut off. Respond more concisely and provide exactly one action in the required format. If you need to think more, do so briefly."
  : `Please always provide EXACTLY ONE action in triple backticks, found ${n} actions.
If you want to end the task, please issue the following command: \`printf '%s\\n' ${ENDE_MARKE} 'Summary in one line'\`
without any other command.
Else, please format your response exactly as follows:

<response_example>
THOUGHT: Here are some thoughts about why you want to perform the action.

\`\`\`bash
<action>
\`\`\`
</response_example>

Note: In rare cases, if you need to reference a similar format in your command, you might have
to proceed in two steps, first writing TRIPLEBACKTICKSBASH, then replacing them with \`\`\`bash.`;

const WARNUNG = `<warning>
The output of your last command was too long.
Please try a different command that produces less output.
If you're looking at a file you can try use head, tail or sed to view a smaller number of lines selectively.
If you're using grep or find and it produced too much output, you can use a more selective search pattern.
If you really need to see something from the full command's output, you can redirect output to a file and then search in that file.
</warning>`;

/** Die Befehle einer Antwort: jeder ```bash-Block (wie mini-swe-agent 1.x, `re.DOTALL`). */
function aktionen(text: string): string[] {
  return [...text.matchAll(/```bash\s*\n([\s\S]*?)\n```/g)].map((m) => m[1].trim());
}

function beobachtung(befehl: string, e: SandboxErgebnis): string {
  if (e.zeitUm) {
    return `The last command <command>${befehl}</command> timed out and has been killed.\nThe output of the command was:\n<output>\n${e.ausgabe}\n</output>\nPlease try another command and make sure to avoid those requiring interactive input.`;
  }
  return `<returncode>${e.code ?? -1}</returncode>\n${e.gekuerzt ? `${WARNUNG}\n` : ""}<output>\n${e.ausgabe}</output>`;
}

/** `paket_holen` im Knoten: je Datei Adresse und Prüfsumme – oder nur die Kennung, warum nicht (nie Text der Registry). */
async function paketBeobachtung(p: NonNullable<RepoLaufOpts["pakete"]>, registry: PaketRegistry, name: string, version: string): Promise<SandboxErgebnis> {
  try {
    const dateien = await p.hole(registry, name, version);
    return { code: 0, ausgabe: dateien.map((d) => `${d.url} ${d.pruefsumme}\n`).join(""), gekuerzt: false, zeitUm: false };
  } catch (e) {
    return { code: 1, ausgabe: `paket_holen: ${e instanceof PaketAbgelehnt ? e.fall : "paket-netz"}\n`, gekuerzt: false, zeitUm: false };
  }
}

/** Fertig erst, wenn die Marke die erste Zeile der Ausgabe ist und der Befehl mit 0 endete. */
function abschlussAus(e: SandboxErgebnis): RepoLaufErgebnis["abschluss"] | null {
  if (e.code !== 0) return null;
  const zeilen = e.ausgabe.trimStart().split("\n");
  if (zeilen[0].trim() !== ENDE_MARKE) return null;
  return { betreff: (zeilen[1] ?? "").trim(), beschreibung: zeilen.slice(2).join("\n").trim() };
}

/**
 * Der Ablauf selbst: Modell fragen, genau einen Befehl ausführen, Ausgabe zurück – bis zur Marke oder einer Grenze.
 * Die Unterhaltung bleibt im Speicher und endet mit dem Aufruf.
 */
export async function repoLauf(o: RepoLaufOpts): Promise<RepoLaufErgebnis> {
  const g: RepoLaufGrenzen = { ...REPO_LAUF_GRENZEN, tokens: Infinity, befehlMs: SANDBOX_GRENZEN.befehlMs, ...o.grenzen };
  const jetzt = o.jetzt ?? Date.now;
  const start = jetzt();
  const nachrichten: RepoNachricht[] = [{ role: "system", content: SYSTEM }, { role: "user", content: auftragText(o.aufgabe, o.pakete) }];
  let schritte = 0, tokens = 0, formfehler = 0;
  const ende = (e: RepoLaufEnde, abschluss?: RepoLaufErgebnis["abschluss"]): RepoLaufErgebnis => ({ ende: e, schritte, tokens, ...(abschluss ? { abschluss } : {}) });
  const rest = () => g.zeitMs - (jetzt() - start);
  for (;;) {
    if (schritte >= g.schritte) return ende("schritte");
    if (tokens >= g.tokens) return ende("tokens");
    if (rest() <= 0) return ende("zeit");
    schritte++;
    let antwort: RepoModellAntwort;
    try {
      antwort = await o.modell(nachrichten);
    } catch {
      return ende("modell");
    }
    tokens += Number.isFinite(antwort.tokens) && antwort.tokens > 0 ? antwort.tokens : 0;
    nachrichten.push({ role: "assistant", content: antwort.text });
    const befehle = aktionen(antwort.text);
    if (befehle.length !== 1) {
      if (++formfehler >= g.formfehler) return ende("formfehler");
      nachrichten.push({ role: "user", content: formfehlerText(befehle.length, antwort.abgeschnitten === true) });
      continue;
    }
    formfehler = 0;
    // Der Befehl läuft höchstens so lange, wie dem Auftrag nach der Antwort bleibt
    const bleibt = rest();
    if (bleibt <= 0) return ende("zeit");
    const befehl = befehle[0];
    // Ein neues Paket holt der Knoten, nie die Sandbox – nur mit `pakete`
    const holen = o.pakete && /^paket_holen[ \t]+(npm|pypi)[ \t]+(\S+)[ \t]+(\S+)$/.exec(befehl);
    if (holen && o.pakete) {
      nachrichten.push({ role: "user", content: beobachtung(befehl, await paketBeobachtung(o.pakete, holen[1] as PaketRegistry, holen[2], holen[3])) });
      continue;
    }
    let e: SandboxErgebnis;
    try {
      // Die Umgebung wie bei mini-swe-agent: nichts wartet auf eine Taste
      e = await o.fuehre(["bash", "-c", `export PAGER=cat MANPAGER=cat LESS=-R PIP_PROGRESS_BAR=off TQDM_DISABLE=1${o.pakete ? ` ${PAKET_UMGEBUNG}` : ""}\n${befehl}`], Math.min(g.befehlMs, bleibt));
    } catch {
      return ende("sandbox");
    }
    const abschluss = abschlussAus(e);
    if (abschluss) return ende("fertig", abschluss);
    nachrichten.push({ role: "user", content: beobachtung(befehl, e) });
  }
}

/** `pakete`: warum die Pakete der Sperrdatei fehlen (11.5c3) – der Auftrag lief ohne sie. */
export type RepoAuftragErgebnis = Omit<RepoLaufErgebnis, "abschluss"> & { patch?: PatchErgebnis; pakete?: PaketFall };

/**
 * Die Plattform der Sandbox für Räder (11.5c3): Prozessor des Knotens und die Fassung von `python3`, wie sie IN der Sandbox
 * läuft (`cp312`) – ohne sie nimmt `passendeDateien()` nur reine Räder oder das Quellarchiv, und das baut ohne Netz nicht.
 */
export async function sandboxPlattform(o: { bwrap?: string; basis?: string } = {}): Promise<PaketPlattform> {
  const { ordner, weg } = neuerArbeitsordner(o.basis);
  try {
    const e = await fuehreAus(["python3", "-c", "import sys; print('cp%d%d' % sys.version_info[:2])"], { arbeit: ordner, bwrap: o.bwrap }, 10_000);
    const python = e.code === 0 ? e.ausgabe.trim() : "";
    return { cpu: process.arch, ...(/^cp3\d{1,2}$/.test(python) ? { python } : {}) };
  } catch {
    return { cpu: process.arch };
  } finally {
    weg();
  }
}

/** Die Sperrdateien an der Wurzel des Repos – aus der Arbeitskopie im Speicher, nie vom Ordner (dort könnte ein Verweis liegen). */
function sperreAus(kopie: Arbeitskopie): { npm?: string; pip?: string } {
  const text = (pfad: string) => {
    const d = kopie.dateien.find((x) => x.pfad === pfad && x.art !== "verweis");
    return d ? new TextDecoder("utf-8", { fatal: false }).decode(d.daten) : undefined;
  };
  const npm = text("package-lock.json"), pip = text("requirements.txt");
  return { ...(npm !== undefined ? { npm } : {}), ...(pip !== undefined ? { pip } : {}) };
}

/**
 * Einen Repo-Auftrag bearbeiten: Arbeitskopie am Kopf des Bundles (`arbeitskopie()` – wirft, wenn das Bundle sie nicht
 * hergibt) in einen neuen Arbeitsordner, der Ablauf darin in der Sandbox, danach der Patch aus dem Ordner. Den Ordner
 * löscht `weg()` immer, auch wenn etwas scheitert. Ohne `fertig` gibt es keinen Patch. Betreff vom Modell, sonst `betreff`.
 * Mit `paketHolen` (nur offene Räume, 11.5c3) zuerst die Pakete der Sperrdateien in einen zweiten Ordner im tmpfs, den die
 * Sandbox nur lesbar sieht; auch er ist danach weg.
 */
export async function bearbeiteRepo(o: Omit<RepoLaufOpts, "fuehre" | "pakete"> & {
  bundle: GelesenesBundle;
  angaben: Omit<PatchAngaben, "betreff" | "beschreibung"> & { betreff: string };
  bwrap?: string;
  basis?: string;
  paketHolen?: PaketOptionen;
}): Promise<RepoAuftragErgebnis> {
  const kopie = arbeitskopie(o.bundle);
  const { ordner, weg } = neuerArbeitsordner(o.basis);
  let zwischen: ReturnType<typeof neuerArbeitsordner> | undefined;
  try {
    schreibeArbeitskopie(ordner, kopie);
    let pakete: RepoLaufOpts["pakete"];
    if (o.paketHolen) {
      const opt = o.paketHolen, z = (zwischen = neuerArbeitsordner(o.basis)).ordner;
      const konto = new PaketKonto((opt.jetzt ?? Date.now)());
      let fehlt: PaketFall | undefined;
      try {
        await holeAusSperre(sperreAus(kopie), z, konto, opt);
      } catch (e) {
        fehlt = e instanceof PaketAbgelehnt ? e.fall : "paket-netz";
      }
      pakete = { hole: (registry, name, version) => paketHolen(registry, name, version, z, konto, opt), ...(fehlt ? { fehlt } : {}) };
    }
    const nurLesbar = zwischen ? [{ quelle: zwischen.ordner, ziel: PAKETE_IN_SANDBOX }] : undefined;
    const { abschluss, ...ablauf } = await repoLauf({
      ...o, ...(pakete ? { pakete } : {}), fuehre: (befehl, zeitMs) => fuehreAus(befehl, { arbeit: ordner, bwrap: o.bwrap, ...(nurLesbar ? { nurLesbar } : {}) }, zeitMs),
    });
    const lauf: RepoAuftragErgebnis = { ...ablauf, ...(pakete?.fehlt ? { pakete: pakete.fehlt } : {}) };
    if (lauf.ende !== "fertig" || !abschluss) return lauf;
    const gelesen = leseArbeitsordner(ordner, kopie);
    if ("fall" in gelesen) return { ...lauf, patch: { ok: false, fall: gelesen.fall } };
    const mit = (betreff: string) => schreibePatch(kopie, gelesen.dateien, { ...o.angaben, betreff, beschreibung: abschluss.beschreibung });
    let patch = await mit(abschluss.betreff || o.angaben.betreff);
    // Ein Betreff, von dem für git nichts bleibt (etwa nur „[…]“), fällt auf die Vorgabe zurück
    if (!patch.ok && patch.fall === "patch.angaben" && abschluss.betreff) patch = await mit(o.angaben.betreff);
    return { ...lauf, patch };
  } finally {
    weg();
    zwischen?.weg();
  }
}
