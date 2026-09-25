// Spike 2.2a (b): ts-mls – Gruppe mit zwei Mitgliedern, Nachricht, Mitglied entfernen.
import {
  createApplicationMessage, createCommit, createGroup, joinGroup, processPrivateMessage, getCiphersuiteImpl,
  getCiphersuiteFromName, defaultCapabilities, defaultLifetime, emptyPskIndex, generateKeyPackage,
  encodeMlsMessage, decodeMlsMessage, zeroOutUint8Array, type Credential, type Proposal,
} from "ts-mls";

const t0 = performance.now();
const impl = await getCiphersuiteImpl(getCiphersuiteFromName("MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519"));
const enc = new TextEncoder();
const kp = async (name: string) => generateKeyPackage({ credentialType: "basic", identity: enc.encode(name) } as Credential, defaultCapabilities(), defaultLifetime, [], impl);
const alice = await kp("alice");
const bob = await kp("bob");
let a = await createGroup(enc.encode("gruppe-1"), alice.publicPackage, alice.privatePackage, [], impl);

// Bob hinzufuegen (KeyPackage ueber die Leitung)
const kpMsg = decodeMlsMessage(encodeMlsMessage({ keyPackage: bob.publicPackage, wireformat: "mls_key_package", version: "mls10" }), 0)![0];
if (kpMsg.wireformat !== "mls_key_package") throw new Error("kp");
const add: Proposal = { proposalType: "add", add: { keyPackage: kpMsg.keyPackage } };
const c1 = await createCommit({ state: a, cipherSuite: impl }, { extraProposals: [add] });
a = c1.newState; c1.consumed.forEach(zeroOutUint8Array);
const wMsg = decodeMlsMessage(encodeMlsMessage({ welcome: c1.welcome!, wireformat: "mls_welcome", version: "mls10" }), 0)![0];
if (wMsg.wireformat !== "mls_welcome") throw new Error("welcome");
let b = await joinGroup(wMsg.welcome, bob.publicPackage, bob.privatePackage, emptyPskIndex, impl, a.ratchetTree);

// Nachricht Alice -> Bob
const send = async (text: string) => {
  const r = await createApplicationMessage(a, enc.encode(text), impl);
  a = r.newState; r.consumed.forEach(zeroOutUint8Array);
  return encodeMlsMessage({ privateMessage: r.privateMessage, wireformat: "mls_private_message", version: "mls10" });
};
const read = async (bytes: Uint8Array) => {
  const m = decodeMlsMessage(bytes, 0)![0];
  if (m.wireformat !== "mls_private_message") throw new Error("pm");
  const r = await processPrivateMessage(b, m.privateMessage, emptyPskIndex, impl);
  b = r.newState;
  if (r.kind === "newState") return null;
  return new TextDecoder().decode(r.message);
};
const m1 = await send("Hallo Bob");
const gelesen1 = await read(m1);

// Bob entfernen; danach kann er neue Nachrichten nicht lesen
const bobIndex = 1;
const remove: Proposal = { proposalType: "remove", remove: { removed: bobIndex } };
const c2 = await createCommit({ state: a, cipherSuite: impl }, { extraProposals: [remove] });
a = c2.newState; c2.consumed.forEach(zeroOutUint8Array);
const m2 = await send("Nach dem Entfernen");
let gelesen2: string | null | Error;
try { gelesen2 = await read(m2); } catch (e) { gelesen2 = e as Error; }
console.log(JSON.stringify({
  nachricht_1_bei_bob: gelesen1,
  nach_entfernen_bei_bob: gelesen2 instanceof Error ? `Fehler: ${gelesen2.message.slice(0, 80)}` : gelesen2,
  groesse_nachricht_bytes: m1.length,
  dauer_ms: Math.round(performance.now() - t0),
}, null, 1));
