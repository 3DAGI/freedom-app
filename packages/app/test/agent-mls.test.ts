/**
 * 11.3c3a (Entwurf AGENTEN-RAUM-ENTWURF.md P2, P4): Agent auf dem Gerät mit eigenem MLS-Konto im privaten Raum.
 *
 * Beweist (echte Engine, Speicher im RAM):
 *  - eigenes Konto des Agenten (sein Schlüssel, eigener Zustand, an ihn gebunden), nie das der Identität
 *  - Einladen nur als Admin; KeyPackage vom Gerät, die Einladung nie an ein Relay – nur der Commit geht an die Gruppe
 *  - danach liest der Agent, was die Gruppe schreibt, und schreibt selbst hinein
 *  - Ablauf in der App: erst sichern, dann einladen; Raumstand, Karte vom Agenten, Liste des Besitzers,
 *    Hinweis ohne Erwähnung – alles nur in der Gruppe; als Gerät nie; Notfall-Löschung kennt die Datenbank
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { schnorr } from "@noble/curves/secp256k1.js";
import { LocalSigner, WIPE_DATENBANKEN, fromHex, generateKeypair, toHex, type NostrEvent, type RelayFilter } from "@freedomstack/protocol";
import { Mls } from "@freedomstack/mls";

const ls = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => void ls.set(k, v),
  removeItem: (k: string) => void ls.delete(k), key: (i: number) => [...ls.keys()][i] ?? null,
  get length() { return ls.size; },
};
const { setzeIdentitaet } = await import("../src/shell/state.js");
const { mlsKonto, mlsLadeAgentEin } = await import("../src/shell/mls-konto.js");
const { agentKonto, AGENTEN_MLS_DB } = await import("../src/shell/agent-mls.js");
const { empfangeGruppe, gruendeGruppe, sendeInGruppe } = await import("../src/mls-nostr.js");
const { mlsEngine } = await import("../src/mls-engine.js");
const { SpeicherImRam, createVault, geheimSpeicher } = await import("../src/vault.js");
const { LS_TRESOR } = await import("../src/shell/tresor.js");
const { GeraeteBuch } = await import("../src/geraete-buch.js");
const { AufzeichnungsRelay } = await import("./leak/aufzeichnung.js");

const gz = readFileSync(new URL("../../mls/dist/freedom_mls_bg.wasm.gz", import.meta.url));
await mlsEngine(async () => gz.toString("base64"));

const relays = new Map<string, InstanceType<typeof AufzeichnungsRelay>>();
const relay = (u: string) => relays.get(u) ?? (relays.set(u, new AufzeichnungsRelay()), relays.get(u)!);
const eingaenge = new Map<string, string[]>();
const netz = {
  async sendeAn(ev: NostrEvent, urls: readonly string[]) { for (const u of urls) await relay(u).publish(ev); return urls.length; },
  async posteingang(pk: string) { return eingaenge.get(pk) ?? []; },
};
const frage = async (f: RelayFilter, urls?: readonly string[]) => (await Promise.all((urls ?? [...relays.keys()]).map((u) => relay(u).query(f)))).flat();
const tresor = await createVault("passphrase lang genug", new SpeicherImRam());
const geheim = geheimSpeicher(() => tresor, () => true, localStorage);
const u = { zustand: () => new SpeicherImRam(), verlauf: () => new SpeicherImRam(), frage, netz, geheim, geraete: new GeraeteBuch((f) => frage(f as RelayFilter)) };
const GRUPPE = ["wss://gruppe.test"];
const ich = generateKeypair();
setzeIdentitaet(ich.sk);
ls.set(LS_TRESOR, "1");
const lies = (datei: string) => readFileSync(new URL(`../src/${datei}`, import.meta.url), "utf8");

const bobKp = generateKeypair();
const bob = { pk: bobKp.pk, signer: new LocalSigner(bobKp.sk), mls: new Mls(new LocalSigner(bobKp.sk), (id) => toHex(schnorr.sign(fromHex(id), bobKp.sk))), sichern: async () => {} };
eingaenge.set(bob.pk, ["wss://eingang-bob.test"]);

test("11.3c3a: Agent lokal eingeladen – eigenes Konto, Einladung über kein Relay, danach liest und schreibt er", async () => {
  const k = await mlsKonto(u)!;
  const kpBob = await bob.signer.signEvent(await bob.mls.keyPackage("cd".repeat(32)));
  const g = await gruendeGruppe({ mls: k.mls, netz, sichern: k.sichern, name: "Werkstatt", keyPackages: [kpBob], relays: GRUPPE, admins: [] });
  const agentKp = generateKeypair();
  const eintrag = { pk: agentKp.pk, sk: toHex(agentKp.sk), name: "Lektor", persona: "P", raeume: [] };
  const zustand = new SpeicherImRam();
  const agent = await agentKonto(eintrag, { zustand: () => zustand, geheim, netz })!;
  assert.notEqual(agent.mls, k.mls, "eigenes Konto");
  const kp = await new LocalSigner(agentKp.sk).signEvent(await agent.mls.keyPackage("ab".repeat(32)));
  await agent.sichern();
  const vorher = [...relays.values()].reduce((n, r) => n + r.gesendet.length, 0);
  let uebergeben = 0;
  const r = await mlsLadeAgentEin(g.gruppe, kp, async (wrap) => {
    uebergeben++;
    assert.equal(await agent.mls.beitreten(wrap), g.gruppe);
    await agent.sichern();
    return true;
  }, u);
  assert.equal(r, "eingeladen");
  assert.equal(uebergeben, 1);
  const neu = [...relays.values()].flatMap((x) => x.gesendet).slice(vorher);
  assert.deepEqual(neu.map((e) => e.kind), [445], "nur der Commit an die Gruppe");
  assert.ok(!relays.has(`wss://eingang-${agentKp.pk}.test`) && ![...relays.values()].some((x) => x.gesendet.some((e) => e.kind === 1059 && e.tags.some((t) => t[1] === agentKp.pk))), "keine Einladung an ein Relay");
  assert.ok(zustand.blob, "Zustand des Agenten verschlüsselt abgelegt");
  assert.ok(!Buffer.from(zustand.blob!, "base64").toString("latin1").includes("Werkstatt"));
  assert.ok(agent.mls.mitglieder(g.gruppe).includes(agentKp.pk) && k.mls.mitglieder(g.gruppe).includes(agentKp.pk));

  // Er liest, was die Gruppe schreibt …
  assert.ok(await sendeInGruppe({ mls: k.mls, netz, sichern: k.sichern, gruppe: g.gruppe, text: "Hallo Agent" }));
  const texte: string[] = [];
  for (const ev of relay(GRUPPE[0]!).gesendet.filter((e) => e.kind === 445).slice(-1)) {
    await empfangeGruppe({ mls: agent.mls, sichern: agent.sichern, ev, merken: async (n) => void texte.push(...n.map((x) => x.text)) });
  }
  assert.deepEqual(texte, ["Hallo Agent"]);
  // … und schreibt selbst hinein, als er selbst
  assert.ok(await sendeInGruppe({ mls: agent.mls, netz, sichern: agent.sichern, gruppe: g.gruppe, text: "Hallo zurück" }));
});

test("11.3c3a: nur als Admin", async () => {
  const k = await mlsKonto(u)!;
  // Bob gründet, ich bin nur Mitglied
  const kpIch = await (await import("../src/shell/state.js")).state.signer!.signEvent(await k.mls.keyPackage("ee".repeat(32)));
  await k.sichern();
  const g = await bob.mls.gruppeAnlegen("Bobs Raum", [kpIch], GRUPPE);
  await k.mls.beitreten(g.einladungen[0]!);
  const agentKp = generateKeypair();
  const agent = await agentKonto({ pk: agentKp.pk, sk: toHex(agentKp.sk), name: "B", persona: "P", raeume: [] }, { zustand: () => new SpeicherImRam(), geheim, netz })!;
  const kp = await new LocalSigner(agentKp.sk).signEvent(await agent.mls.keyPackage("ac".repeat(32)));
  let uebergeben = 0;
  assert.equal(await mlsLadeAgentEin(g.gruppe, kp, async () => { uebergeben++; return true; }, u), "kein Admin");
  assert.equal(uebergeben, 0);
});

test("11.3c3a: Ablauf in der App – nur in der Gruppe, erst sichern, als Gerät nie; Notfall-Löschung", () => {
  const q = lies("shell/agent-mls.ts");
  const i = (s: string) => { const n = q.indexOf(s); assert.ok(n >= 0, s); return n; };
  assert.ok(i("await k.sichern();\n  const r = await mlsLadeAgentEin(") > 0, "privater Teil des KeyPackages gesichert, bevor es benutzt wird");
  assert.ok(i("const r = await mlsLadeAgentEin(") < i("await sendeRaumstand(raum)"));
  assert.ok(i("await sendeRaumstand(raum)") < i("...raumAgentKarte({"));
  assert.match(q, /await sendeEventInGruppe\(\{\s*mls: k\.mls, netz: k\.netz, sichern: k\.sichern, gruppe: raum\.gruppe,\s*\.\.\.raumAgentKarte\(/, "Karte vom Agenten");
  assert.match(q, /await mlsSendeEvent\(raum\.gruppe, listeImRaum\(besitzer, raum\.gruppe\)\);/, "Liste vom Besitzer, innen");
  assert.match(q, /await sendePrivat\(raum\.gruppe, kanal, t\("agentRaum\.hinweisGeraet", \{ name: agent\.name \}\)\);/, "Hinweis ohne Erwähnung");
  assert.doesNotMatch(q, /publish\(|signiere\(|veroeffentlicheAn\(ev/, "nichts offen");
  assert.equal(q.match(/if \(!state\.keypair \|\| alsGeraet\(\)\) throw/g)?.length, 2);
  assert.ok(WIPE_DATENBANKEN.includes(AGENTEN_MLS_DB));
  assert.match(lies("vault.ts"), /constructor\(private dbName = "freedom-vault", private store = "tresor", private eintrag = "blob"\)/);
});
