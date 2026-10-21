/**
 * Repo-Aufträge an den Agenten auf dem Knoten, private Räume (11.5c2b, `docs/REPO-AGENTEN-ENTWURF.md` P1–P4, W7 A).
 *
 * Beweist – echte MDK-Engine, Gründer wie in der App, Provider wie im Knoten, Sandbox wie im Betrieb:
 *  - Der ganze Weg: Repo und Bundle-Verweis samt Schlüssel nur als innere Events der Gruppe → bezahlter Auftrag mit
 *    Verweis auf die Erwähnung mit Repo-Tag → Ablauf in der Sandbox → Patch als inneres Event, den `git am` annimmt →
 *    Antwort in der Gruppe nennt ihn; auf dem Relay nichts vom Repo (`regelRaumRepoPrivat`), nichts im Log, der
 *    Arbeitsordner ist weg
 *  - Abgelehnt mit Kennung, bevor gerechnet wird: Modell nicht auf diesem Rechner (P2), aus, fremdes Repo, fremdes Issue, Bundle-Verweis
 *    nur offen (zählt privat nicht), ohne Antwort in der Gruppe
 *  - verdrahtet: `modellLokal` nur aus der Adresse des Antriebs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  KIND_PATCH, LocalSigner, MemoryRelay, OutboxPool, auftragsVerweisTags, buildBlob, buildGitRepoRef, buildJobRequest, buildPrivateJobRequest,
  generateKeypair, getTag, lesePatch, openPrivateJobResponse, raumDefinition, raumNachricht, raumRepoAnkuendigung, raumRepoBundle, raumRepoIssue,
  regelKeinKlartext, regelRaumRepoPrivat, repoAdresse, repoAuftragTags, signEvent, signiereId, verschluesseleDatei, type GitRepoRef,
  type InneresEvent, type InneresSenden,
} from "@freedomstack/protocol";
import { KIND_KEY_PACKAGE, Mls } from "@freedomstack/mls";
import { DvmProvider } from "../src/dvm-provider.js";
import type { ChatAntwort, InferenceBackend, InferenceRequest, InferenceResult } from "../src/inference.js";
import { KnotenAgent } from "../src/knoten-agent.js";
import { KnotenMls } from "../src/knoten-mls.js";
import { ENDE_MARKE } from "../src/repo-lauf.js";
import { pruefeSandbox } from "../src/sandbox.js";

const quelle = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const kp = generateKeypair(), hochlader = generateKeypair(), fremd = generateKeypair();
const gitUmgebung = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_COMMITTER_NAME: "Agent", GIT_COMMITTER_EMAIL: "agent@freedom.invalid" };
const git = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...args], { cwd: dir, env: gitUmgebung }).toString();
const bash = (befehl: string) => `THOUGHT: weiter.\n\n\`\`\`bash\n${befehl}\n\`\`\``;
/** Steht nur im Code der Gruppe – nie auf einem Relay, nie im Log. */
const GEHEIM = "geheimeZahl";

/** Modell nach Drehbuch hinter `gespraech()`; `complete()` darf für Repo-Aufträge nie laufen. */
class DrehbuchBackend implements InferenceBackend {
  gesehen = 0;
  constructor(private readonly antworten: string[]) {}
  name(): string { return "drehbuch"; }
  async available(): Promise<boolean> { return true; }
  async complete(_req: InferenceRequest): Promise<InferenceResult> { throw new Error("complete() bei einem Repo-Auftrag"); }
  async gespraech(): Promise<ChatAntwort> {
    const text = this.antworten[this.gesehen++];
    if (text === undefined) throw new Error("Drehbuch zu Ende");
    return { text, model: "qwen3.8:27b", promptTokens: 100, completionTokens: 40, abgeschnitten: false };
  }
}

/** Ein Repo als Bundle, verschlüsselt im Blob-Netz unter einem Wegwerfschlüssel – der Verweis samt Schlüssel nur für die Gruppe. */
async function bundleImNetz(pool: OutboxPool): Promise<{ repo: string; ref: GitRepoRef }> {
  const repo = mkdtempSync(join(tmpdir(), "repo-privat-"));
  git(repo, "init", "-q");
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src/a.ts"), `export const ${GEHEIM} = 1;\n`);
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "erster");
  git(repo, "bundle", "create", "-q", "r.bundle", "HEAD", "main");
  const { chiffrat, schluessel } = verschluesseleDatei(new Uint8Array(readFileSync(join(repo, "r.bundle"))));
  const blob = await buildBlob({ name: "", mime: "", bytes: chiffrat }, hochlader.pk, { verschluesselt: true });
  for (const ev of [blob.manifestEvent, ...blob.chunkEvents]) await pool.publish(signEvent(ev, hochlader.sk));
  return { repo, ref: { name: "app", blobId: blob.manifest.blobId, headSha: "1".repeat(40), branch: "main", message: "m", version: 1, schluessel } };
}

/** Privater Raum: Gründer (Admin) und der Agent auf dem Knoten; der Provider mit dem Agenten. */
async function aufbau(o: { antworten?: string[]; basis?: string; modellLokal?: boolean; einstellungRepo?: boolean } = {}) {
  const relay = new MemoryRelay(`wss://repo-privat-${Math.random().toString(36).slice(2)}.test`);
  const pool = new OutboxPool([relay], { minAcks: 1 });
  const ag = generateKeypair();
  const agent = new KnotenAgent({
    schluessel: ag, einstellung: { name: "Lektor", persona: "Du bist Lektor.", ...(o.einstellungRepo === false ? {} : { repo: true }) }, knoten: kp.pk, pool,
    repo: { basis: o.basis }, modellLokal: o.modellLokal ?? true,
  });
  const mls = KnotenMls.starte({
    schluessel: ag, einladen: "alle", karte: agent.kartenDaten(), ordner: mkdtempSync(join(tmpdir(), "repo-privat-mls-")),
    umgebung: { pool, neuesRelay: (u) => new MemoryRelay(u), pruefeRelay: async () => false },
  });
  agent.nutzePrivat(mls);
  await mls.veroeffentliche();
  const gk = generateKeypair();
  const gruender = { pk: gk.pk, sk: gk.sk, mls: new Mls(new LocalSigner(gk.sk), (id) => signiereId(id, gk.sk)) };
  const kpEv = (await pool.query({ kinds: [KIND_KEY_PACKAGE], authors: [ag.pk] }))[0]!;
  const g = await gruender.mls.gruppeAnlegen("Werkstatt", [kpEv], [relay.url]);
  for (const e of g.einladungen) await pool.publish(e);
  await mls.abgleich();
  const gruppe = g.gruppe;
  const sende = async (s: InneresSenden): Promise<string> => {
    const r = await gruender.mls.sendenEvent(gruppe, s.art, s.tags, s.text);
    for (const ev of r.events) await pool.publish(ev);
    if (r.ausstehend) await gruender.mls.bestaetigt(r.ausstehend);
    return r.inneres!;
  };
  await sende(raumDefinition(gruppe, { name: "Werkstatt", kanaele: [{ id: "allgemein", name: "allgemein", privacy: "verschluesselt", writeRoles: [], position: 0 }] }));
  await sende(raumRepoAnkuendigung(gruppe, { id: "app", name: "App", klon: [] }));
  const erwaehne = (tags: string[][]) => {
    const s = raumNachricht({ kanal: "allgemein", text: `@Lektor bitte ${GEHEIM} auf 2 setzen`, erwaehnt: [ag.pk] });
    return sende({ ...s, tags: [...s.tags, ...tags] });
  };
  const backend = new DrehbuchBackend(o.antworten ?? []);
  const provider = new DvmProvider({
    keypair: kp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "s", privatePowBits: 8,
    providerSince: 1, modelle: () => ["qwen3.8:27b"], agent,
  }, pool, backend);
  /** Was beim Gründer in der Gruppe ankommt. */
  const liest = async (): Promise<InneresEvent[]> => {
    const l: InneresEvent[] = [];
    for (const ev of (await pool.query({ kinds: [445] })).sort((a, b) => a.created_at - b.created_at)) {
      const r = await gruender.mls.empfangen(ev).catch(() => null);
      for (const n of r?.nachrichten ?? []) l.push({ id: n.inneres, von: n.von, art: n.art, tags: n.tags, text: n.text, zeit: n.zeit });
    }
    return l;
  };
  return { relay, pool, ag, agent, mls, gruender, gruppe, sende, erwaehne, backend, provider, liest, repoAdresse: repoAdresse(gk.pk, "app") };
}

/** Der Auftrag, wie die App des Fragenden ihn schickt: bezahlt, Verweis (Gruppe, Erwähnung) im versiegelten Kern. */
async function frageNach(pool: OutboxPool, raum: string, erwaehnung: string) {
  const sitzung = new LocalSigner(generateKeypair().sk);
  const kern = buildJobRequest({
    customerPubkey: sitzung.publicKey(), input: "@Lektor", bidMsat: 5000, providerPubkey: kp.pk, extraTags: auftragsVerweisTags({ raum, erwaehnung }),
  });
  const { wrap } = await buildPrivateJobRequest({ request: kern, sessionSigner: sitzung, providerPk: kp.pk, powBits: 8 });
  await pool.publish(wrap);
  return sitzung;
}
async function antwortenAn(relay: MemoryRelay, sitzung: LocalSigner) {
  const offen = await Promise.all((await relay.query({ kinds: [1059], "#p": [sitzung.publicKey()] })).map((w) => openPrivateJobResponse(w, sitzung)));
  return offen.flatMap((r) => (r.ok ? [r.response] : []));
}

const sandbox = await pruefeSandbox();
const ohne = !sandbox.ok && `Sandbox geht hier nicht (${sandbox.ok ? "" : sandbox.fall})`;

test("11.5c2b mit bubblewrap: Repo-Auftrag im privaten Raum – Patch und Antwort nur in der Gruppe, nichts offen", { skip: ohne }, async () => {
  const basis = mkdtempSync(join(tmpdir(), "repo-privat-basis-"));
  const w = await aufbau({
    basis,
    antworten: [bash("cat src/a.ts"), bash("sed -i 's/= 1/= 2/' src/a.ts"), bash(`printf '%s\\n' ${ENDE_MARKE} '${GEHEIM} ist jetzt 2'`)],
  });
  const { repo, ref } = await bundleImNetz(w.pool);
  await w.sende(raumRepoBundle(w.gruppe, ref));
  const frage = await w.erwaehne(repoAuftragTags({ repo: w.repoAdresse }));
  const log: string[] = [];
  const alt = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...x: unknown[]) => void log.push(x.map(String).join(" "));
  let jobs, sitzung;
  try {
    sitzung = await frageNach(w.pool, w.gruppe, frage);
    jobs = await w.provider.pollOnce();
  } finally {
    Object.assign(console, alt);
  }
  const absage = (await antwortenAn(w.relay, sitzung)).find((e) => e.kind === 7000 && getTag(e, "status") === "error");
  assert.equal(jobs.length, 1, String(absage && getTag(absage, "fall")));
  assert.equal(jobs[0]!.amountMsat, 120, "drei Antworten zu 40 Tokens – wie im offenen Raum");

  // In der Gruppe: der Patch vom Agenten an das Repo des Raums, git am nimmt ihn an
  const innen = await w.liest();
  const [patch, ...mehr] = innen.filter((e) => e.von === w.ag.pk && e.art === KIND_PATCH);
  assert.ok(patch && mehr.length === 0, "genau ein Patch, vom Agenten, als inneres Event");
  assert.equal(patch.tags.find((t) => t[0] === "space")?.[1], w.gruppe);
  assert.ok(patch.tags.some((t) => t[0] === "a" && t[1] === w.repoAdresse));
  const p = lesePatch({ id: patch.id, pubkey: patch.von, created_at: patch.zeit, kind: patch.art, tags: patch.tags, content: patch.text, sig: "" });
  const klon = mkdtempSync(join(tmpdir(), "repo-privat-klon-"));
  git(klon, "clone", "-q", join(repo, "r.bundle"), ".");
  writeFileSync(join(klon, "p.patch"), patch.text);
  execFileSync("git", ["am", "-q", "--committer-date-is-author-date", "p.patch"], {
    cwd: klon, env: { ...gitUmgebung, GIT_COMMITTER_NAME: "Lektor", GIT_COMMITTER_EMAIL: `${w.ag.pk.slice(0, 16)}@agent.freedom.invalid` },
  });
  assert.equal(git(klon, "rev-parse", "HEAD").trim(), p.commit);
  assert.equal(readFileSync(join(klon, "src/a.ts"), "utf8"), `export const ${GEHEIM} = 2;\n`);

  // Die Antwort in der Gruppe nennt den Patch (Id des inneren Events); dieselbe versiegelt an den Fragenden
  const antwort = innen.find((e) => e.von === w.ag.pk && e.art === 9);
  assert.ok(antwort);
  assert.equal(antwort.text, `Patch eingereicht: ${GEHEIM} ist jetzt 2`);
  assert.deepEqual(antwort.tags, [
    ["h", "allgemein"], ["e", frage, "", "reply"], ["p", w.gruender.pk, "", "mention"], ["e", patch.id, "", "mention"], ["fall", "repo.patch"],
  ]);
  assert.equal((await antwortenAn(w.relay, sitzung)).find((e) => e.kind === 6050)?.content, antwort.text);

  // Auf dem Relay: nichts vom Repo, kein Schlüssel, kein Code, kein Betreff (P4)
  const gesehen = await w.relay.query({});
  assert.deepEqual(await w.relay.query({ kinds: [KIND_PATCH, 42, 30617, 38042] }), []);
  assert.deepEqual(regelRaumRepoPrivat(gesehen, { repoIds: ["app"], schluessel: [ref.schluessel!.key], innere: [patch.id, antwort.id] }), []);
  assert.deepEqual(regelKeinKlartext(gesehen, [GEHEIM, "Patch eingereicht", "Werkstatt"]), []);
  assert.deepEqual(readdirSync(basis), [], "Arbeitsordner gelöscht");
  for (const z of log) assert.ok(!new RegExp(`${GEHEIM}|Patch eingereicht|export const`).test(z), `kein Klartext im Log: ${z}`);
  w.mls.stoppe();
});

test("11.5c2b: abgelehnt mit Kennung, bevor gerechnet wird – Modell nicht hier, aus, fremdes Repo, Verweis nur offen", async () => {
  const faelle: Array<[string, Parameters<typeof aufbau>[0], (w: Awaited<ReturnType<typeof aufbau>>) => Promise<string>]> = [
    // P2: der Code der Gruppe geht nie an einen anderen Rechner
    ["agent-repo-modell", { modellLokal: false }, async (w) => {
      await w.sende(raumRepoBundle(w.gruppe, (await bundleImNetz(w.pool)).ref));
      return w.erwaehne(repoAuftragTags({ repo: w.repoAdresse }));
    }],
    ["agent-repo-aus", { einstellungRepo: false }, async (w) => {
      await w.sende(raumRepoBundle(w.gruppe, (await bundleImNetz(w.pool)).ref));
      return w.erwaehne(repoAuftragTags({ repo: w.repoAdresse }));
    }],
    ["agent-repo-fremd", {}, async (w) => {
      await w.sende(raumRepoBundle(w.gruppe, (await bundleImNetz(w.pool)).ref));
      return w.erwaehne(repoAuftragTags({ repo: repoAdresse(fremd.pk, "app") }));
    }],
    // Das Issue steht in der Gruppe, gehört aber zu einem anderen Repo
    ["agent-repo-issue", {}, async (w) => {
      await w.sende(raumRepoBundle(w.gruppe, (await bundleImNetz(w.pool)).ref));
      const issue = await w.sende(raumRepoIssue(w.gruppe, { repo: { eigentuemer: fremd.pk, id: "app" }, betreff: "x", text: "y" }));
      return w.erwaehne(repoAuftragTags({ repo: w.repoAdresse, issue }));
    }],
    // Ein offener Verweis des Gründers zählt im privaten Raum nicht – nur, was in der Gruppe steht
    ["agent-repo-bundle", {}, async (w) => {
      const { ref } = await bundleImNetz(w.pool);
      await w.pool.publish(signEvent(buildGitRepoRef(ref, w.gruender.pk), w.gruender.sk));
      return w.erwaehne(repoAuftragTags({ repo: w.repoAdresse }));
    }],
  ];
  for (const [fall, o, bau] of faelle) {
    const w = await aufbau(o);
    const frage = await bau(w);
    const sitzung = await frageNach(w.pool, w.gruppe, frage);
    const alt = console.error;
    console.error = () => {};
    try {
      assert.equal((await w.provider.pollOnce()).length, 0, fall);
    } finally {
      console.error = alt;
    }
    const absage = (await antwortenAn(w.relay, sitzung)).find((e) => e.kind === 7000 && getTag(e, "status") === "error");
    assert.equal(absage && getTag(absage, "fall"), fall, fall);
    assert.equal(w.backend.gesehen, 0, `${fall}: nichts gerechnet`);
    assert.ok(!(await w.liest()).some((e) => e.von === w.ag.pk && (e.art === 9 || e.art === KIND_PATCH)), `${fall}: keine Antwort in der Gruppe`);
    w.mls.stoppe();
  }
});

test("11.5c2b: verdrahtet – Modell auf diesem Rechner nur aus der Adresse des Antriebs, Repo vor der Arbeit geprüft", () => {
  const main = quelle("../src/main.ts");
  assert.match(main, /modellLokal: !!lokaleKiAdresse\(antrieb\.url\),/);
  const agent = quelle("../src/knoten-agent.ts");
  assert.match(agent, /const repo = this\.privatesRepo\(ev, v\.raum, r\.ereignisse, r\.raum\.zustand, istAgent\);\n\s+this\.inArbeit\.add\(ev\.id\);/);
  assert.match(agent, /if \(!this\.p\.modellLokal\) throw new AgentAbgelehnt\("agent-repo-modell"\);/);
  assert.match(agent, /raumRepoPatch\(a\.gruppe, \{ repo, text \}\)/, "Patch privat nur als inneres Event");
});
