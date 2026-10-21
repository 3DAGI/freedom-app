/**
 * Repo-Aufträge an den Agenten auf dem Knoten, offene Räume (11.5c2a, `docs/REPO-AGENTEN-ENTWURF.md` V3–V6, W5 A).
 *
 * Beweist:
 *  - Das Bundle kommt nur über den Verweis: Stücke vom Autor des Manifests, das Chiffrat hat die Blob-Id als Hash –
 *    ein fremdes Manifest mit derselben Id schiebt keinen anderen Code unter; fehlt etwas, gibt es keins
 *  - Der ganze Weg: bezahlter Auftrag mit Verweis auf eine Erwähnung mit Repo-Tag → Repo gehört zum Raum →
 *    Ablauf in der Sandbox → Patch vom Agenten (1617), den `git am` annimmt → Antwort im Raum nennt ihn →
 *    bezahlt nach Tokens bis zum Gebot; der Arbeitsordner ist weg, nichts im Log
 *  - Ohne Patch (Grenze erreicht) nur die Antwort mit Kennung; abgelehnt mit Kennung vor dem Rechnen: aus, fremdes
 *    Repo, kein Bundle, fremdes Issue, gratis (private Räume: `repo-auftrag-privat.test.ts`, 11.5c2b)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  AGENT_ROLLE, KIND_PATCH, LocalSigner, MemoryRelay, OutboxPool, auftragsVerweisTags, baueIssue, baueRepoAnkuendigung, buildBlob,
  buildChannelMessage, buildGitRepoRef, buildJobRequest, buildPrivateJobRequest, buildRoleGrant, buildRoles, buildSpace, generateKeypair,
  getTag, lesePatch, mitAgentRolle, openPrivateJobResponse, repoAdresse, repoAuftragTags, signEvent, verschluesseleDatei, type NostrEvent,
} from "@freedomstack/protocol";
import { DvmProvider } from "../src/dvm-provider.js";
import type { ChatAntwort, InferenceBackend, InferenceRequest, InferenceResult } from "../src/inference.js";
import { KnotenAgent, PAKETE_FEHLEN_TEXT, agentAusUmgebung } from "../src/knoten-agent.js";
import type { PaketOptionen } from "../src/pakete.js";
import { holeRepoBundle } from "../src/repo-bundle.js";
import { ENDE_MARKE } from "../src/repo-lauf.js";
import { pruefeSandbox } from "../src/sandbox.js";

const quelle = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const gruender = generateKeypair(), mensch = generateKeypair(), fremd = generateKeypair(), hochlader = generateKeypair(), kp = generateKeypair();
const T = Math.floor(Date.now() / 1000) - 600;
const ADRESSE = `34700:${gruender.pk}:space:werkstatt`;
const REPO = repoAdresse(gruender.pk, "app");
const gitUmgebung = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_COMMITTER_NAME: "Agent", GIT_COMMITTER_EMAIL: "agent@freedom.invalid" };
const git = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...args], { cwd: dir, env: gitUmgebung }).toString();
const bash = (befehl: string) => `THOUGHT: weiter.\n\n\`\`\`bash\n${befehl}\n\`\`\``;

/** Ein Repo als Bundle, verschlüsselt im Blob-Netz unter einem Wegwerfschlüssel wie in der App – der Verweis vom Eigentümer. */
async function bundleImNetz(pool: OutboxPool, von = gruender, weitere: Record<string, string> = {}) {
  const repo = mkdtempSync(join(tmpdir(), "repo-auftrag-"));
  git(repo, "init", "-q");
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src/a.ts"), "export const a = 1;\n");
  for (const [pfad, text] of Object.entries(weitere)) writeFileSync(join(repo, pfad), text);
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "erster");
  git(repo, "bundle", "create", "-q", "r.bundle", "HEAD", "main");
  const { chiffrat, schluessel } = verschluesseleDatei(new Uint8Array(readFileSync(join(repo, "r.bundle"))));
  const blob = await buildBlob({ name: "", mime: "", bytes: chiffrat }, hochlader.pk, { verschluesselt: true });
  for (const ev of [blob.manifestEvent, ...blob.chunkEvents]) await pool.publish(signEvent(ev, hochlader.sk));
  const verweis = signEvent(buildGitRepoRef({ name: "app", blobId: blob.manifest.blobId, headSha: "1".repeat(40), branch: "main", message: "m", version: 1, schluessel }, von.pk), von.sk);
  await pool.publish(verweis);
  return { repo, verweis, blob };
}

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

async function aufbau(o: {
  repo?: boolean; einstellungRepo?: boolean; antworten?: string[]; basis?: string; grenzen?: { schritte?: number }; bootstrap?: boolean; pakete?: PaketOptionen;
} = {}) {
  const relay = new MemoryRelay(`mem://repo-${Math.random()}`);
  const pool = new OutboxPool([relay], { minAcks: 1 });
  const ag = generateKeypair();
  let z = T;
  for (const ev of [
    signEvent(buildSpace({
      spaceId: "werkstatt", name: "Werkstatt", ownerPubkey: gruender.pk,
      channels: [{ id: "allgemein", name: "allgemein", privacy: "offen", writeRoles: [], position: 0 }],
    }, z++), gruender.sk),
    signEvent(buildRoles("werkstatt", gruender.pk, mitAgentRolle([{ id: "mitglied", name: "Mitglied", rank: 5, permissions: ["lesen", "schreiben"] }])), gruender.sk),
    signEvent(buildRoleGrant("werkstatt", gruender.pk, ag.pk, [AGENT_ROLLE], z++), gruender.sk),
    signEvent(buildRoleGrant("werkstatt", gruender.pk, mensch.pk, ["mitglied"], z++), gruender.sk),
    signEvent(baueRepoAnkuendigung({ id: "app", name: "App", klon: [], raum: ADRESSE }, gruender.pk), gruender.sk),
  ]) await pool.publish(ev);
  const erwaehne = async (tags: string[][], text = "@Lektor bitte a auf 2 setzen") => {
    const ev = buildChannelMessage({ authorPubkey: mensch.pk, spaceId: "werkstatt", channelId: "allgemein", content: text, mentions: [ag.pk] }, z++);
    ev.tags.push(...tags);
    const s = signEvent(ev, mensch.sk);
    await pool.publish(s);
    return s;
  };
  const agent = new KnotenAgent({
    schluessel: ag, einstellung: { name: "Lektor", persona: "Du bist Lektor.", ...(o.einstellungRepo === false ? {} : { repo: true }) }, knoten: kp.pk, pool,
    ...(o.repo === false ? {} : { repo: { basis: o.basis, grenzen: o.grenzen, ...(o.pakete ? { pakete: o.pakete } : {}) } }),
  });
  const backend = new DrehbuchBackend(o.antworten ?? []);
  const provider = new DvmProvider({
    keypair: kp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "s", privatePowBits: 8,
    providerSince: o.bootstrap ? Math.floor(Date.now() / 1000) - 3600 : 1, modelle: () => ["qwen3.8:27b"], agent,
  }, pool, backend);
  return { relay, pool, ag, agent, backend, provider, erwaehne };
}

async function frageNach(pool: OutboxPool, erwaehnung: string) {
  const sitzung = new LocalSigner(generateKeypair().sk);
  const kern = buildJobRequest({
    customerPubkey: sitzung.publicKey(), input: "@Lektor", bidMsat: 5000, providerPubkey: kp.pk, extraTags: auftragsVerweisTags({ raum: ADRESSE, erwaehnung }),
  });
  const { wrap } = await buildPrivateJobRequest({ request: kern, sessionSigner: sitzung, providerPk: kp.pk, powBits: 8 });
  await pool.publish(wrap);
  return sitzung;
}
async function antwortenAn(relay: MemoryRelay, sitzung: LocalSigner) {
  const offen = await Promise.all((await relay.query({ kinds: [1059], "#p": [sitzung.publicKey()] })).map((w) => openPrivateJobResponse(w, sitzung)));
  return offen.flatMap((r) => (r.ok ? [r.response] : []));
}
const absage = async (relay: MemoryRelay, sitzung: LocalSigner) =>
  (await antwortenAn(relay, sitzung)).find((e) => e.kind === 7000 && getTag(e, "status") === "error");

test("11.5c2a: Bundle nur über den Verweis – Hash des Chiffrats ist die Blob-Id, Stücke nur vom Autor des Manifests", async () => {
  const relay = new MemoryRelay("mem://bundle");
  const pool = new OutboxPool([relay], { minAcks: 1 });
  const { verweis, blob } = await bundleImNetz(pool);
  const r = await holeRepoBundle(pool, verweis);
  assert.ok(r.ok);
  assert.ok(r.bundle.refs.some((ref) => ref.name === "refs/heads/main"));
  // Ein Fremder legt ein Manifest mit derselben Blob-Id und eigenen Stücken daneben: es zählt nicht
  const { chiffrat } = verschluesseleDatei(new TextEncoder().encode("anderer Code"));
  const falsch = await buildBlob({ name: "", mime: "", bytes: chiffrat }, fremd.pk, { verschluesselt: true });
  const unterschoben = JSON.parse(falsch.manifestEvent.content) as Record<string, unknown>;
  unterschoben.blobId = blob.manifest.blobId;
  const relay2 = new MemoryRelay("mem://bundle-falsch");
  const pool2 = new OutboxPool([relay2], { minAcks: 1 });
  await pool2.publish(signEvent({ ...falsch.manifestEvent, tags: [["blob", blob.manifest.blobId]], content: JSON.stringify(unterschoben) }, fremd.sk));
  for (const ev of falsch.chunkEvents) await pool2.publish(signEvent({ ...ev, tags: ev.tags.map((t) => (t[0] === "blob" ? ["blob", blob.manifest.blobId] : t)) }, fremd.sk));
  await pool2.publish(verweis);
  assert.deepEqual(await holeRepoBundle(pool2, verweis), { ok: false, fall: "agent-repo-bundle" }, "nur das fremde Manifest: kein Bundle");
  // Stücke eines anderen Autors zum echten Manifest zählen nicht, auch wenn ein Relay sie trotz `authors` liefert
  const alle = [signEvent(blob.manifestEvent, hochlader.sk), ...blob.chunkEvents.map((ev) => signEvent({ ...ev, pubkey: fremd.pk }, fremd.sk))];
  const luegt = { query: async (f: { kinds?: number[] }) => alle.filter((ev) => !f.kinds || f.kinds.includes(ev.kind)) };
  assert.deepEqual(await holeRepoBundle(luegt, verweis), { ok: false, fall: "agent-repo-bundle" });
  // Ohne Schlüssel im Verweis gibt es nichts
  const ohne = signEvent(buildGitRepoRef({ name: "app", blobId: blob.manifest.blobId, headSha: "1".repeat(40), branch: "main", message: "m", version: 2 }, gruender.pk), gruender.sk);
  assert.deepEqual(await holeRepoBundle(pool, ohne), { ok: false, fall: "agent-repo-bundle" });
});

test("11.5c2a: Einstellung AGENT_REPO – aus, an, ungültig heißt kein Start", () => {
  const basis = { KNOTEN_AGENT: "1", AGENT_NAME: "Lektor" };
  assert.equal(agentAusUmgebung(basis)!.einstellung!.repo, undefined);
  assert.equal(agentAusUmgebung({ ...basis, AGENT_REPO: "0" })!.einstellung!.repo, undefined);
  assert.equal(agentAusUmgebung({ ...basis, AGENT_REPO: "1" })!.einstellung!.repo, true);
  assert.match(agentAusUmgebung({ ...basis, AGENT_REPO: "ja" })!.grund!, /AGENT_REPO/);
});

const sandbox = await pruefeSandbox();
const ohne = !sandbox.ok && `Sandbox geht hier nicht (${sandbox.ok ? "" : sandbox.fall})`;

test("11.5c2a mit bubblewrap: Repo-Auftrag Ende zu Ende – Patch vom Agenten, Antwort nennt ihn, bezahlt bis zum Gebot", { skip: ohne }, async () => {
  const basis = mkdtempSync(join(tmpdir(), "repo-auftrag-basis-"));
  const a = await aufbau({
    basis,
    antworten: [bash("cat src/a.ts"), bash("sed -i 's/= 1/= 2/' src/a.ts"), bash(`printf '%s\\n' ${ENDE_MARKE} 'a ist jetzt 2'`)],
  });
  const { repo } = await bundleImNetz(a.pool);
  const frage = await a.erwaehne(repoAuftragTags({ repo: REPO }));
  const log: string[] = [];
  const alt = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...x: unknown[]) => void log.push(x.map(String).join(" "));
  let jobs, sitzung;
  try {
    sitzung = await frageNach(a.pool, frage.id);
    jobs = await a.provider.pollOnce();
  } finally {
    Object.assign(console, alt);
  }
  assert.equal(jobs.length, 1, JSON.stringify(await absage(a.relay, sitzung)));
  assert.equal(jobs[0]!.amountMsat, 120, "drei Antworten zu 40 Tokens, 1000 msat je 1000 – höchstens das Gebot");
  const [patch, ...mehr] = await a.relay.query({ kinds: [KIND_PATCH], authors: [a.ag.pk] });
  assert.ok(patch && mehr.length === 0, "genau ein Patch, vom Agenten");
  const p = lesePatch(patch);
  assert.equal(getTag(patch, "a"), REPO);
  // git am nimmt ihn an, mit demselben Commit
  const klon = mkdtempSync(join(tmpdir(), "repo-auftrag-klon-"));
  git(klon, "clone", "-q", join(repo, "r.bundle"), ".");
  writeFileSync(join(klon, "p.patch"), patch.content);
  // Committer wie der Autor (der Agent) – git am nimmt ihn aus der Umgebung
  execFileSync("git", ["am", "-q", "--committer-date-is-author-date", "p.patch"], {
    cwd: klon, env: { ...gitUmgebung, GIT_COMMITTER_NAME: "Lektor", GIT_COMMITTER_EMAIL: `${a.ag.pk.slice(0, 16)}@agent.freedom.invalid` },
  });
  assert.equal(git(klon, "rev-parse", "HEAD").trim(), p.commit);
  assert.equal(readFileSync(join(klon, "src/a.ts"), "utf8"), "export const a = 2;\n");
  // Die Antwort im Raum nennt den Patch; dieselbe Antwort versiegelt an den Fragenden
  const [antwort] = await a.relay.query({ kinds: [42], authors: [a.ag.pk] });
  assert.ok(antwort);
  assert.equal(antwort.content, "Patch eingereicht: a ist jetzt 2");
  assert.deepEqual(antwort.tags.slice(-2), [["e", patch.id, "", "mention"], ["fall", "repo.patch"]]);
  assert.ok(antwort.tags.some((t) => t[0] === "e" && t[1] === frage.id && t[3] === "reply"));
  assert.equal((await antwortenAn(a.relay, sitzung)).find((e) => e.kind === 6050)?.content, antwort.content);
  assert.deepEqual(readdirSync(basis), [], "Arbeitsordner gelöscht");
  for (const z of log) assert.ok(!/a ist jetzt|bitte a auf|export const/.test(z), `kein Klartext im Log: ${z}`);
});

test("11.5c2a mit bubblewrap: Grenze erreicht – kein Patch, die Antwort sagt welche; bezahlt wird, was gerechnet wurde", { skip: ohne }, async () => {
  const a = await aufbau({ antworten: [bash("echo neu > neu.txt")], grenzen: { schritte: 1 } });
  await bundleImNetz(a.pool);
  const frage = await a.erwaehne(repoAuftragTags({ repo: REPO }));
  const sitzung = await frageNach(a.pool, frage.id);
  const jobs = await a.provider.pollOnce();
  assert.equal(jobs[0]?.amountMsat, 40);
  assert.deepEqual(await a.relay.query({ kinds: [KIND_PATCH] }), []);
  const [antwort] = await a.relay.query({ kinds: [42], authors: [a.ag.pk] });
  assert.equal(getTag(antwort!, "fall"), "repo.schritte");
  assert.ok(!antwort!.tags.some((t) => t[3] === "mention" && t[0] === "e"));
  assert.ok((await antwortenAn(a.relay, sitzung)).some((e) => e.kind === 6050));
});

test("11.5c3 mit bubblewrap: offener Raum – Pakete der Sperrdatei nicht zu holen, die Antwort sagt es mit Kennung", { skip: ohne }, async () => {
  const gefragt: string[] = [];
  const a = await aufbau({
    antworten: [bash(`printf '%s\\n' ${ENDE_MARKE} 'nichts'`)],
    pakete: { tor: null, plattform: { cpu: "x64" }, abruf: async (url) => { gefragt.push(url); return new Response("nicht da", { status: 404 }); } },
  });
  await bundleImNetz(a.pool, gruender, { "requirements.txt": `probe==1.0.0 --hash=sha256:${"a".repeat(64)}\n` });
  const frage = await a.erwaehne(repoAuftragTags({ repo: REPO }));
  const sitzung = await frageNach(a.pool, frage.id);
  assert.equal((await a.provider.pollOnce()).length, 1);
  assert.deepEqual(gefragt, ["https://pypi.org/pypi/probe/1.0.0/json"], "im offenen Raum holt der Knoten, was die Sperrdatei nennt");
  const [antwort] = await a.relay.query({ kinds: [42], authors: [a.ag.pk] });
  assert.deepEqual(antwort!.tags.slice(-2), [["fall", "repo.keine-aenderung"], ["pakete", "paket-netz"]]);
  assert.equal(antwort!.content, `Fertig, aber nichts geändert – kein Patch. ${PAKETE_FEHLEN_TEXT}`);
  assert.equal((await antwortenAn(a.relay, sitzung)).find((e) => e.kind === 6050)?.content, antwort!.content);
});

test("11.5c2a: abgelehnt mit Kennung, bevor gerechnet wird – aus, fremdes Repo, kein Bundle, fremdes Issue, gratis", async () => {
  const faelle: Array<[string, () => Promise<{ a: Awaited<ReturnType<typeof aufbau>>; frage: NostrEvent }>]> = [
    ["agent-repo-aus", async () => { const a = await aufbau({ einstellungRepo: false }); await bundleImNetz(a.pool); return { a, frage: await a.erwaehne(repoAuftragTags({ repo: REPO })) }; }],
    ["agent-repo-aus", async () => { const a = await aufbau({ repo: false }); await bundleImNetz(a.pool); return { a, frage: await a.erwaehne(repoAuftragTags({ repo: REPO })) }; }],
    ["agent-repo-fremd", async () => { const a = await aufbau(); return { a, frage: await a.erwaehne(repoAuftragTags({ repo: repoAdresse(fremd.pk, "app") })) }; }],
    ["agent-repo-bundle", async () => { const a = await aufbau(); return { a, frage: await a.erwaehne(repoAuftragTags({ repo: REPO })) }; }],
    ["agent-repo-bundle", async () => { const a = await aufbau(); await bundleImNetz(a.pool, fremd); return { a, frage: await a.erwaehne(repoAuftragTags({ repo: REPO })) }; }],
    ["agent-repo-issue", async () => {
      const a = await aufbau();
      await bundleImNetz(a.pool);
      const issue = signEvent(baueIssue({ repo: { eigentuemer: fremd.pk, id: "app" }, betreff: "x", text: "y" }, mensch.pk), mensch.sk);
      await a.pool.publish(issue);
      return { a, frage: await a.erwaehne(repoAuftragTags({ repo: REPO, issue: issue.id })) };
    }],
    // In der Bootstrap-Phase bedient der Knoten Gebote gratis (A-14) – Repo-Aufträge nie
    ["agent-repo-bezahlt", async () => { const a = await aufbau({ bootstrap: true }); await bundleImNetz(a.pool); return { a, frage: await a.erwaehne(repoAuftragTags({ repo: REPO })) }; }],
  ];
  for (const [fall, bau] of faelle) {
    const { a, frage } = await bau();
    const sitzung = await frageNach(a.pool, frage.id);
    const alt = console.error;
    console.error = () => {};
    try {
      await a.provider.pollOnce();
    } finally {
      console.error = alt;
    }
    assert.equal(getTag((await absage(a.relay, sitzung))!, "fall"), fall, fall);
    assert.equal(a.backend.gesehen, 0, `${fall}: nichts gerechnet`);
    assert.deepEqual(await a.relay.query({ kinds: [42], authors: [a.ag.pk] }), [], `${fall}: keine Antwort im Raum`);
  }
});

test("11.5c2a: Verdrahtung – Provider und main.ts", () => {
  const provider = quelle("../src/dvm-provider.ts");
  assert.match(provider, /agentAuftrag\?\.repo\s*\? this\.cfg\.agent!\.bearbeiteRepoAuftrag\(agentAuftrag/);
  assert.match(provider, /antworte\(agentAuftrag, result\.output, result\.fall \? \{ fall: result\.fall, patch: result\.patch, pakete: result\.pakete \} : undefined\)/);
  const main = quelle("../src/main.ts");
  assert.match(main, /if \(agentWahl\.einstellung\.repo\) \{\s*const sandbox = await pruefeSandbox\(\);/);
  assert.match(main, /\.\.\.\(repoSandbox \? \{ repo: \{ pakete: \{ tor: torProxy \?\? null, /, "Pakete mit Tor durch Tor (11.5c3)");
});
