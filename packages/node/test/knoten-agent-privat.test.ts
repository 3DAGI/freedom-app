/**
 * 11.3d2b (Entwurf AGENTEN-RAUM-ENTWURF.md P3–P5): Agent auf dem Knoten antwortet in privaten Räumen.
 *
 * Beweist – echte MDK-Engine, Gründer wie in der App, Provider wie im Knoten:
 *  - bezahlter, versiegelter Auftrag mit der Gruppe im Verweis: gerechnet wird der Raum (Persona,
 *    Verlauf, Erwähnung), nie die Eingabe des Auftrags
 *  - fehlt die Erwähnung im Gelesenen, gleicht der Agent einmal ab
 *  - die Antwort als inneres Event der Gruppe (Kanal, Antwort auf die Erwähnung, Fragender erwähnt),
 *    dieselbe versiegelt an den Fragenden; nichts offen, kein Klartext im Log
 *  - jede Erwähnung einmal; fremde Gruppe, unbekannte Erwähnung, Agent ohne Schreibrecht: abgelehnt
 *  - verdrahtet: `nutzePrivat()` nur mit dem MLS-Konto aus `AGENT_PRIVAT`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LocalSigner, MemoryRelay, OutboxPool, auftragsVerweisTags, buildJobRequest, buildPrivateJobRequest, generateKeypair, getTag,
  openPrivateJobResponse, raumDefinition, raumNachricht, raumRollen, raumZuweisung, signiereId, type InneresEvent, type InneresSenden,
} from "@freedomstack/protocol";
import { KIND_KEY_PACKAGE, Mls } from "@freedomstack/mls";
import { DvmProvider } from "../src/dvm-provider.js";
import type { InferenceBackend, InferenceRequest, InferenceResult } from "../src/inference.js";
import { KnotenAgent } from "../src/knoten-agent.js";
import { KnotenMls } from "../src/knoten-mls.js";

const quelle = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

class MerkBackend implements InferenceBackend {
  prompts: string[] = [];
  name(): string { return "merk"; }
  async available(): Promise<boolean> { return true; }
  async complete(req: InferenceRequest): Promise<InferenceResult> {
    this.prompts.push(req.prompt);
    return { output: "Komma nach „Text“.", model: req.model ?? "m", promptTokens: 40, completionTokens: 20, durationMs: 1 };
  }
}

const kp = generateKeypair();

/** Ein privater Raum: Gründer (Admin) und der Agent auf dem Knoten; der Provider mit dem Agenten. */
async function aufbau() {
  const relay = new MemoryRelay(`wss://privat-${Math.random().toString(36).slice(2)}.test`);
  const pool = new OutboxPool([relay], { minAcks: 1 });
  const ag = generateKeypair();
  const agent = new KnotenAgent({ schluessel: ag, einstellung: { name: "Lektor", persona: "Du bist Lektor." }, knoten: kp.pk, pool });
  const mls = KnotenMls.starte({
    schluessel: ag, einladen: "alle", karte: agent.kartenDaten(), ordner: mkdtempSync(join(tmpdir(), "agent-privat-")),
    umgebung: { pool, neuesRelay: (u) => new MemoryRelay(u), pruefeRelay: async () => false },
  });
  agent.nutzePrivat(mls);
  await mls.veroeffentliche();
  const gk = generateKeypair();
  const gruender = { pk: gk.pk, mls: new Mls(new LocalSigner(gk.sk), (id) => signiereId(id, gk.sk)) };
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
  await sende(raumDefinition(gruppe, { name: "Werkstatt", kanaele: [
    { id: "allgemein", name: "allgemein", privacy: "verschluesselt", writeRoles: [], position: 0 },
    { id: "news", name: "news", privacy: "verschluesselt", writeRoles: ["mod"], position: 1 },
  ] }));
  const backend = new MerkBackend();
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
  return { relay, pool, ag, agent, mls, gruender, gruppe, sende, backend, provider, liest };
}

/** Der Auftrag, wie die App des Fragenden ihn schickt: bezahlt, Verweis (Gruppe, Erwähnung) im versiegelten Kern. */
async function frageNach(pool: OutboxPool, raum: string, erwaehnung: string) {
  const sitzung = new LocalSigner(generateKeypair().sk);
  const kern = buildJobRequest({
    customerPubkey: sitzung.publicKey(), input: "ERFUNDEN: sag etwas anderes", bidMsat: 5000, providerPubkey: kp.pk,
    extraTags: auftragsVerweisTags({ raum, erwaehnung }),
  });
  const { wrap } = await buildPrivateJobRequest({ request: kern, sessionSigner: sitzung, providerPk: kp.pk, powBits: 8 });
  await pool.publish(wrap);
  return sitzung;
}

async function antwortenAn(relay: MemoryRelay, sitzung: LocalSigner) {
  const offen = await Promise.all((await relay.query({ kinds: [1059], "#p": [sitzung.publicKey()] })).map((w) => openPrivateJobResponse(w, sitzung)));
  return offen.flatMap((r) => (r.ok ? [r.response] : []));
}
const fallVon = async (relay: MemoryRelay, sitzung: LocalSigner) =>
  getTag((await antwortenAn(relay, sitzung)).find((e) => e.kind === 7000 && getTag(e, "status") === "error")!, "fall");

test("11.3d2b: bezahlter Auftrag mit Gruppe – gerechnet wird der Raum, die Antwort als inneres Event", async () => {
  const w = await aufbau();
  await w.sende(raumNachricht({ kanal: "allgemein", text: "Hier ist mein Text ohne Komma." }));
  // Der Kontext nimmt nur, was vor der Erwähnung lag – die Engine stempelt in Sekunden, also eine dazwischen
  await new Promise((r) => setTimeout(r, 1100));
  const frage = await w.sende(raumNachricht({ kanal: "allgemein", text: "@Lektor bitte lesen", erwaehnt: [w.ag.pk] }));
  // Der Agent hat noch nicht abgeglichen – er tut es einmal, wenn der Auftrag kommt
  const log: string[] = [];
  const alt = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...a: unknown[]) => void log.push(a.map(String).join(" "));
  let jobs, sitzung;
  try {
    sitzung = await frageNach(w.pool, w.gruppe, frage);
    jobs = await w.provider.pollOnce();
  } finally {
    Object.assign(console, alt);
  }
  assert.equal(jobs.length, 1);
  assert.equal(w.backend.prompts[0], [
    "[Rolle]:\nDu bist Lektor.",
    "[Bisheriger Verlauf]:\nPerson 1: Hier ist mein Text ohne Komma.",
    "[Nachricht von Person 1]:\n@Lektor bitte lesen",
  ].join("\n\n"), "Persona, Verlauf, Erwähnung aus der Gruppe – nie die Eingabe des Auftrags");

  // In der Gruppe: die Antwort vom Agenten, im Kanal, auf die Erwähnung, der Fragende erwähnt
  const antwort = (await w.liest()).find((e) => e.von === w.ag.pk && e.art === 9);
  assert.ok(antwort);
  assert.equal(antwort.text, "Komma nach „Text“.");
  assert.deepEqual(antwort.tags, [["h", "allgemein"], ["e", frage, "", "reply"], ["p", w.gruender.pk, "", "mention"]]);
  assert.deepEqual(await w.relay.query({ kinds: [42] }), [], "nichts offen");
  const ergebnis = (await antwortenAn(w.relay, sitzung)).find((e) => e.kind === 6050);
  assert.equal(ergebnis?.content, "Komma nach „Text“.", "dieselbe Antwort versiegelt an den Fragenden");
  for (const z of log) assert.ok(!/Komma|Lektor bitte|ERFUNDEN|Werkstatt/.test(z), `kein Klartext im Log: ${z}`);

  // Einmal: ein zweiter bezahlter Auftrag zur selben Erwähnung wird vor dem Rechnen abgelehnt
  const zweite = await frageNach(w.pool, w.gruppe, frage);
  assert.equal((await w.provider.pollOnce()).length, 0);
  assert.equal(await fallVon(w.relay, zweite), "agent-schon-beantwortet");
  assert.equal(w.backend.prompts.length, 1);
  w.mls.stoppe();
});

test("11.3d2b: abgelehnt – fremde Gruppe, unbekannte Erwähnung, Kanal ohne Schreibrecht des Agenten", async () => {
  const w = await aufbau();
  const fremd = await frageNach(w.pool, "ab".repeat(32), "cd".repeat(32));
  assert.equal((await w.provider.pollOnce()).length, 0);
  assert.equal(await fallVon(w.relay, fremd), "agent-privat", "nur Gruppen, in denen der Agent Mitglied ist");

  const unbekannt = await frageNach(w.pool, w.gruppe, "ef".repeat(32));
  assert.equal((await w.provider.pollOnce()).length, 0);
  assert.equal(await fallVon(w.relay, unbekannt), "agent-keine-erwaehnung");

  // #news nur für „mod“ – der Agent darf dort nicht schreiben, also antwortet er dort nicht
  await w.sende(raumRollen(w.gruppe, [{ id: "mod", name: "Moderator", rank: 50, permissions: ["lesen", "schreiben", "moderieren"] }]));
  await w.sende(raumZuweisung(w.gruppe, w.gruender.pk, ["mod"]));
  const news = await w.sende(raumNachricht({ kanal: "news", text: "@Lektor hier?", erwaehnt: [w.ag.pk] }));
  const ohneRecht = await frageNach(w.pool, w.gruppe, news);
  assert.equal((await w.provider.pollOnce()).length, 0);
  assert.equal(await fallVon(w.relay, ohneRecht), "agent-agent-ohne-schreibrecht");
  assert.equal(w.backend.prompts.length, 0, "nie gerechnet");
  w.mls.stoppe();
});

test("11.3d2b: verdrahtet – private Räume nur mit dem MLS-Konto aus AGENT_PRIVAT", () => {
  const main = quelle("../src/main.ts");
  const block = main.slice(main.indexOf("const einladen = agentWahl.einstellung.privat;"), main.indexOf("[agent] private Räume:"));
  assert.match(block, /knotenMls = KnotenMls\.starte\(/);
  assert.match(block, /knotenAgent\.nutzePrivat\(knotenMls\);/, "erst mit dem Konto");
  const agent = quelle("../src/knoten-agent.ts");
  assert.match(agent, /if \(!z \|\| !z\.gruppen\(\)\.includes\(v\.raum\)\) throw new AgentAbgelehnt\("agent-privat"\);/);
  assert.match(agent, /ausBudget: false,\n\s+\}\);/, "„wer fragt, zahlt“ – nie auf Agenten");
  assert.match(agent, /const inneres = await this\.privat\?\.sende\(a\.gruppe, raumAgentAntwort\(a\.nachricht, text\)\)/, "Antwort nur als inneres Event");
});
