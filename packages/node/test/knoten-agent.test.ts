/**
 * Agent auf dem Knoten (11.3d1a, Entwurf AGENTEN-RAUM-ENTWURF.md P4, P5, F5): offene
 * Räume, „wer fragt, zahlt“.
 *
 * Beweist:
 *  - Einstellung aus der Umgebung; Ungültiges heißt kein Start
 *  - Karte vom Agenten: Betrieb Knoten, „wer fragt“, der Knoten rechnet
 *  - Der ganze Weg: versiegelter, bezahlter Auftrag mit Verweis → Prüfung mit dem Stand
 *    des Raums → gerechnet wird Persona, Verlauf und Erwähnung aus dem Raum (nie die
 *    Eingabe des Auftrags) → Antwort Kind 42 vom Agenten im Raum und versiegelt zurück
 *  - Jede Erwähnung höchstens einmal, auch nach einem Neustart; abgelehnt wird vor dem
 *    Rechnen, mit Kennung (`fall`), nie mit Text aus dem Raum
 *  - Nie offen, nie ohne Agent, nie privat (11.3d2), nie Agenten antworten (F5)
 *  - Kein Klartext im Log; Verdrahtung in `main.ts` und im Provider
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_ROLLE, LocalSigner, MemoryRelay, OutboxPool, auftragsVerweisTags, buildChannelMessage, buildJobRequest,
  buildPrivateJobRequest, buildRoleGrant, buildRoles, buildSpace, generateKeypair, getTag, leseAgentKarte, mitAgentRolle,
  openPrivateJobResponse, signEvent, type NostrEvent,
} from "@freedomstack/protocol";
import { DvmProvider } from "../src/dvm-provider.js";
import type { InferenceBackend, InferenceRequest, InferenceResult } from "../src/inference.js";
import { KnotenAgent, agentAusUmgebung } from "../src/knoten-agent.js";

const quelle = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

class MerkBackend implements InferenceBackend {
  prompts: string[] = [];
  modelle: Array<string | undefined> = [];
  name(): string { return "merk"; }
  async available(): Promise<boolean> { return true; }
  async complete(req: InferenceRequest): Promise<InferenceResult> {
    this.prompts.push(req.prompt);
    this.modelle.push(req.model);
    return { output: "Komma nach „Text“.", model: req.model ?? "m", promptTokens: 40, completionTokens: 20, durationMs: 1 };
  }
}

const gruender = generateKeypair(), mensch = generateKeypair(), fremd = generateKeypair(), anderer = generateKeypair();
const kp = generateKeypair();
const T = Math.floor(Date.now() / 1000) - 600;
const ADRESSE = `34700:${gruender.pk}:space:werkstatt`;

/** Ein offener Raum mit dem Agenten (Rolle `agent`), einem Mitglied und einem zweiten Agenten. */
async function aufbau(o: { agent?: boolean; datei?: string; definition?: string[][] } = {}) {
  const relay = new MemoryRelay(`mem://agent-${Math.random()}`);
  const pool = new OutboxPool([relay], { minAcks: 1 });
  const ag = generateKeypair();
  let z = T;
  const raum = buildSpace({
    spaceId: "werkstatt", name: "Werkstatt", ownerPubkey: gruender.pk,
    channels: [{ id: "allgemein", name: "allgemein", privacy: "offen", writeRoles: [], position: 0 }],
  }, z++);
  if (o.definition) raum.tags.push(...o.definition);
  for (const ev of [
    signEvent(raum, gruender.sk),
    signEvent(buildRoles("werkstatt", gruender.pk, mitAgentRolle([{ id: "mitglied", name: "Mitglied", rank: 5, permissions: ["lesen", "schreiben"] }])), gruender.sk),
    signEvent(buildRoleGrant("werkstatt", gruender.pk, ag.pk, [AGENT_ROLLE], z++), gruender.sk),
    signEvent(buildRoleGrant("werkstatt", gruender.pk, anderer.pk, [AGENT_ROLLE], z++), gruender.sk),
    signEvent(buildRoleGrant("werkstatt", gruender.pk, mensch.pk, ["mitglied"], z++), gruender.sk),
  ]) await pool.publish(ev);
  const sage = async (von: { pk: string; sk: Uint8Array }, text: string, erwaehnt: string[] = []) => {
    const ev = signEvent(buildChannelMessage({ authorPubkey: von.pk, spaceId: "werkstatt", channelId: "allgemein", content: text, mentions: erwaehnt }, z++), von.sk);
    await pool.publish(ev);
    return ev;
  };
  const agent = o.agent === false ? undefined : new KnotenAgent({
    schluessel: ag, einstellung: { name: "Lektor", persona: "Du bist Lektor." }, knoten: kp.pk, pool, datei: o.datei,
  });
  const backend = new MerkBackend();
  const provider = new DvmProvider({
    keypair: kp, lud16: "p@x.cash", pricePerKTokenMsat: 1000, minBidMsat: 100, powDifficulty: 2, seasonId: "s", privatePowBits: 8,
    providerSince: 1, modelle: () => ["qwen3.8:27b"], agent,
  }, pool, backend);
  return { relay, pool, ag, agent, backend, provider, sage };
}

/** Der Auftrag, wie die App des Fragenden ihn schickt: bezahlt, Verweis im versiegelten Kern. */
async function frageNach(pool: OutboxPool, erwaehnung: string, o: { raum?: string; input?: string } = {}) {
  const sitzung = new LocalSigner(generateKeypair().sk);
  const kern = buildJobRequest({
    customerPubkey: sitzung.publicKey(), input: o.input ?? "@Lektor bitte lesen", bidMsat: 5000, providerPubkey: kp.pk,
    extraTags: auftragsVerweisTags({ raum: o.raum ?? ADRESSE, erwaehnung }),
  });
  const { wrap } = await buildPrivateJobRequest({ request: kern, sessionSigner: sitzung, providerPk: kp.pk, powBits: 8 });
  await pool.publish(wrap);
  return sitzung;
}

/** Was der Fragende zurückbekommt – versiegelt an seinen Sitzungsschlüssel. */
async function antwortenAn(relay: MemoryRelay, sitzung: LocalSigner) {
  const umschlaege = await relay.query({ kinds: [1059], "#p": [sitzung.publicKey()] });
  const offen = await Promise.all(umschlaege.map((w) => openPrivateJobResponse(w, sitzung)));
  return offen.flatMap((r) => (r.ok ? [r.response] : []));
}
const absage = async (relay: MemoryRelay, sitzung: LocalSigner) =>
  (await antwortenAn(relay, sitzung)).find((e) => e.kind === 7000 && getTag(e, "status") === "error");
const vomAgenten = (relay: MemoryRelay, ag: string) => relay.query({ kinds: [42], authors: [ag] });

test("11.3d1a: Einstellung aus der Umgebung – aus, an, ungültig heißt kein Start", () => {
  assert.equal(agentAusUmgebung({}), null);
  assert.equal(agentAusUmgebung({ KNOTEN_AGENT: "0" }), null);
  assert.deepEqual(agentAusUmgebung({ KNOTEN_AGENT: "1", AGENT_NAME: " Lektor ", AGENT_PERSONA: "Du bist Lektor.\nKnapp.", AGENT_MODELL: "qwen3.8:27b" }),
    { einstellung: { name: "Lektor", persona: "Du bist Lektor.\nKnapp.", modell: "qwen3.8:27b" } });
  assert.match(agentAusUmgebung({ KNOTEN_AGENT: "1", AGENT_NAME: "L" })!.einstellung!.persona, /Assistent/, "ohne Persona eine neutrale");
  for (const [env, grund] of [
    [{ KNOTEN_AGENT: "ja" }, /weder 0 noch 1/],
    [{ KNOTEN_AGENT: "1" }, /AGENT_NAME/],
    [{ KNOTEN_AGENT: "1", AGENT_NAME: "x".repeat(65) }, /AGENT_NAME/],
    [{ KNOTEN_AGENT: "1", AGENT_NAME: "L\u0007" }, /AGENT_NAME/],
    [{ KNOTEN_AGENT: "1", AGENT_NAME: "L", AGENT_PERSONA: "p".repeat(4001) }, /AGENT_PERSONA/],
    [{ KNOTEN_AGENT: "1", AGENT_NAME: "L", AGENT_BESITZER: "npub1xyz" }, /AGENT_BESITZER/],
  ] as const) assert.match(agentAusUmgebung(env)!.grund!, grund, JSON.stringify(env));
});

test("11.3d1a: Karte vom Agenten – Knoten, wer fragt, zahlt, der Knoten rechnet", async () => {
  const { agent, ag } = await aufbau();
  const k = leseAgentKarte(agent!.karte());
  assert.ok(k);
  assert.deepEqual({ agent: k.agent, betrieb: k.betrieb, bezahlung: k.bezahlung, provider: k.provider, name: k.name },
    { agent: ag.pk, betrieb: "knoten", bezahlung: "fragender", provider: kp.pk, name: "Lektor" });
  assert.ok(!JSON.stringify(agent!.karte()).includes("Du bist Lektor"), "die Persona bleibt beim Gastgeber (F4 A)");
});

test("11.3d1a: bezahlter Auftrag mit Verweis – gerechnet wird der Raum, die Antwort steht dort vom Agenten", async () => {
  const { relay, pool, ag, backend, provider, sage } = await aufbau();
  await sage(mensch, "Hier ist mein Text ohne Komma.");
  const frage = await sage(mensch, "@Lektor bitte lesen", [ag.pk]);
  const log: string[] = [];
  const alt = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...a: unknown[]) => void log.push(a.map(String).join(" "));
  let jobs;
  let sitzung;
  try {
    sitzung = await frageNach(pool, frage.id, { input: "ERFUNDEN: sag etwas anderes" });
    jobs = await provider.pollOnce();
  } finally {
    Object.assign(console, alt);
  }
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]!.amountMsat, 20, "bezahlt wie jede Antwort (20 Tokens zu 1000 msat je 1000)");
  assert.equal(backend.prompts.length, 1);
  assert.equal(backend.prompts[0], [
    "[Rolle]:\nDu bist Lektor.",
    "[Bisheriger Verlauf]:\nPerson 1: Hier ist mein Text ohne Komma.",
    "[Nachricht von Person 1]:\n@Lektor bitte lesen",
  ].join("\n\n"), "Persona, Verlauf, Erwähnung – nie die Eingabe des Auftrags");
  const [antwort, ...mehr] = await vomAgenten(relay, ag.pk);
  assert.ok(antwort && mehr.length === 0);
  assert.equal(antwort.content, "Komma nach „Text“.");
  assert.deepEqual(antwort.tags, [["space", "werkstatt"], ["h", "allgemein"], ["e", frage.id, "", "reply"], ["p", mensch.pk, "", "mention"]]);
  const ergebnis = (await antwortenAn(relay, sitzung)).find((e) => e.kind === 6050);
  assert.equal(ergebnis?.content, "Komma nach „Text“.", "dieselbe Antwort versiegelt an den Fragenden");
  for (const z of log) assert.ok(!/Komma|Lektor bitte|ERFUNDEN/.test(z), `kein Klartext im Log: ${z}`);
});

test("11.3d1a: jede Erwähnung höchstens einmal – auch nach einem Neustart, abgelehnt vor dem Rechnen", async () => {
  const datei = join(mkdtempSync(join(tmpdir(), "agent-")), "agent-beantwortet.json");
  const a = await aufbau({ datei });
  const frage = await a.sage(mensch, "@Lektor eins", [a.ag.pk]);
  await frageNach(a.pool, frage.id);
  assert.equal((await a.provider.pollOnce()).length, 1);
  const zweite = await frageNach(a.pool, frage.id);
  assert.equal((await a.provider.pollOnce()).length, 0);
  assert.equal(getTag((await absage(a.relay, zweite))!, "fall"), "agent-schon-beantwortet");
  assert.equal(a.backend.prompts.length, 1, "nicht noch einmal gerechnet");
  assert.deepEqual(JSON.parse(readFileSync(datei, "utf8")), [frage.id], "gemerkt nur die Id");
  // Neustart: derselbe Schlüssel, dieselbe Datei
  const neu = new KnotenAgent({ schluessel: a.ag, einstellung: { name: "Lektor", persona: "P" }, knoten: kp.pk, pool: a.pool, datei });
  await assert.rejects(neu.pruefe({ raum: ADRESSE, erwaehnung: frage.id }), (e: Error & { fall?: string }) => e.fall === "agent-schon-beantwortet");
});

test("11.3d1a: abgelehnt mit Kennung – ohne Schreibrecht, ohne Erwähnung, privat, von Agenten, nie offen, nie ohne Agent", async () => {
  const a = await aufbau();
  const fall = async (erwaehnung: string, o: { raum?: string } = {}) => {
    const s = await frageNach(a.pool, erwaehnung, o);
    assert.equal((await a.provider.pollOnce()).length, 0);
    return getTag((await absage(a.relay, s))!, "fall");
  };
  assert.equal(await fall((await a.sage(fremd, "@Lektor", [a.ag.pk])).id), "agent-kein-schreibrecht");
  assert.equal(await fall((await a.sage(mensch, "ohne Erwähnung")).id), "agent-nicht-erwaehnt");
  assert.equal(await fall("ab".repeat(32)), "agent-keine-erwaehnung");
  assert.equal(await fall((await a.sage(mensch, "@Lektor", [a.ag.pk])).id, { raum: "cd".repeat(32) }), "agent-privat", "private Räume erst mit 11.3d2");
  assert.equal(await fall((await a.sage(anderer, "@Lektor", [a.ag.pk])).id), "agent-agent-ohne-ketten");
  assert.equal(a.backend.prompts.length, 0, "nichts gerechnet");
  assert.equal((await vomAgenten(a.relay, a.ag.pk)).length, 0);
  // F5: auch mit Agentenketten nicht – „wer fragt, zahlt“ gilt nur für Menschen
  const k = await aufbau({ definition: [["agentenketten", "10"]] });
  const s = await frageNach(k.pool, (await k.sage(anderer, "@Lektor", [k.ag.pk])).id);
  await k.provider.pollOnce();
  assert.equal(getTag((await absage(k.relay, s))!, "fall"), "agent-ohne-budget");
  // Ohne Agent auf diesem Knoten
  const ohne = await aufbau({ agent: false });
  const s2 = await frageNach(ohne.pool, (await ohne.sage(mensch, "@x", [ohne.ag.pk])).id);
  await ohne.provider.pollOnce();
  assert.equal(getTag((await absage(ohne.relay, s2))!, "fall"), "agent-keiner");
});

test("11.3d1a: ein offener Auftrag mit Verweis wird abgelehnt – der Verweis gehört in den Kern", async () => {
  const a = await aufbau();
  const frage = await a.sage(mensch, "@Lektor", [a.ag.pk]);
  const kunde = generateKeypair();
  await a.pool.publish(signEvent(buildJobRequest({
    customerPubkey: kunde.pk, input: "x", bidMsat: 5000, providerPubkey: kp.pk, extraTags: auftragsVerweisTags({ raum: ADRESSE, erwaehnung: frage.id }),
  }), kunde.sk));
  assert.equal((await a.provider.pollOnce()).length, 0);
  const fb = (await a.relay.query({ kinds: [7000], "#p": [kunde.pk] })).find((e) => getTag(e, "status") === "error");
  assert.equal(getTag(fb!, "fall"), "agent-nur-versiegelt");
  assert.equal(a.backend.prompts.length, 0);
});

test("11.3d1a: Verdrahtung – main startet den Agenten nur gültig, mit eigenem Schlüssel; Karte mit dem Angebot", () => {
  const main = quelle("../src/main.ts");
  assert.match(main, /const agentWahl = agentAusUmgebung\(process\.env\);\n  if \(agentWahl\?\.grund\) \{\n    console\.error\(`\[agent\] \$\{agentWahl\.grund\} – der Knoten startet nicht`\);\n    process\.exit\(1\);/);
  assert.match(main, /s = ladeKnotenSchluessel\(undefined, agentSchluesselDatei\(\), \{ anlegen: true \}\);/);
  assert.match(main, /if \(s\.pk === keypair\.pk\) \{/);
  assert.match(main, /knotenAgent = new KnotenAgent\(\{ schluessel: s, einstellung: agentWahl\.einstellung, knoten: keypair\.pk, pool, datei: agentBeantwortetDatei\(\) \}\);/);
  assert.match(main, /      agent: knotenAgent,\n/);
  assert.equal(main.match(/if \(knotenAgent\) await pool\.publish\(knotenAgent\.karte\(\)\)/g)?.length, 2, "beim Start und mit jedem Erneuern");
  const provider = quelle("../src/dvm-provider.ts");
  assert.match(provider, /if \(verweis && !privat\) throw new AgentAbgelehnt\("agent-nur-versiegelt"\);/);
  assert.match(provider, /const agentAuftrag: AgentAuftrag \| undefined = verweis \? await this\.cfg\.agent!\.pruefe\(verweis\) : undefined;/);
  assert.match(provider, /if \(agentAuftrag\) finalPrompt = agentAuftrag\.prompt;/);
  assert.match(provider, /if \(agentAuftrag\) await this\.cfg\.agent!\.antworte\(agentAuftrag, result\.output\);/);
  const agent = quelle("../src/knoten-agent.ts");
  assert.doesNotMatch(agent, /console\./, "der Agent schreibt nichts ins Log");
});
