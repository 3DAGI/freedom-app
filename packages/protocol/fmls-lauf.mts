import { createRequire } from "node:module";
import { schnorr } from "@noble/curves/secp256k1.js";
import { LocalSigner, computeEventId, generateKeypair, toHex, fromHex } from "./src/index.ts";
const require = createRequire(import.meta.url);
const M = require("/tmp/claude-0/-home-user-freedom-app/f964fb30-17be-56cd-a5cb-ae651c3a3ddd/scratchpad/fmls-node/freedom_mls.js");

function person(name: string) {
  const kp = generateKeypair();
  const signer = new LocalSigner(kp.sk);
  const bruecke = {
    signEvent: async (json: string) => JSON.stringify(await signer.signEvent(JSON.parse(json))),
    nip44Encrypt: (pk: string, t: string) => signer.nip44Encrypt(pk, t),
    nip44Decrypt: (pk: string, t: string) => signer.nip44Decrypt(pk, t),
  };
  const beweis = (json: string) => {
    const ev = JSON.parse(json);
    if (ev.kind !== 450 || ev.pubkey !== kp.pk) throw new Error("kein Kontobeweis");
    return toHex(schnorr.sign(fromHex(computeEventId(ev)), kp.sk));
  };
  const konto = () => new M.MlsKonto(kp.pk, beweis, bruecke, undefined);
  return { name, kp, signer, bruecke, beweis, konto: konto(), neu: (z?: Uint8Array) => new M.MlsKonto(kp.pk, beweis, bruecke, z) };
}
const J = (s: string) => JSON.parse(s);
const [a, b, c] = [person("Alice"), person("Bob"), person("Carol")];
const kp = async (p: ReturnType<typeof person>) => JSON.stringify(await p.signer.signEvent(J(await p.konto.keyPackageEvent("geraet-1"))));
const kpB = await kp(b), kpC = await kp(c);
console.log("KeyPackage-Kind", J(kpB).kind, "Tags", J(kpB).tags.map((t: string[]) => t[0]).join(","));
const g = J(await a.konto.gruppeAnlegen("Test", [kpB, kpC], ["wss://nostr.mom", "wss://offchain.pub"]));
console.log("Gruppe", g.gruppe.slice(0, 8), "Einladungen", g.einladungen.length, g.einladungen.map((e: string) => J(e).kind));
const fuer = (pk: string) => g.einladungen.find((e: string) => J(e).tags.some((t: string[]) => t[0] === "p" && t[1] === pk));
console.log("Bob tritt bei", await b.konto.beitreten(fuer(b.kp.pk)) === g.gruppe);
console.log("Carol tritt bei", await c.konto.beitreten(fuer(c.kp.pk)) === g.gruppe);
console.log("Mitglieder", a.konto.mitglieder(g.gruppe).length);
const s1 = J(await a.konto.senden(g.gruppe, "Hallo Gruppe"));
const e1 = J(s1.events[0]);
console.log("Nachricht Kind", e1.kind, "Autor ist nicht Alice", e1.pubkey !== a.kp.pk, "Tags", e1.tags.map((t: string[]) => t[0]).join(","));
console.log("Bob liest", J(await b.konto.empfangen(s1.events[0])).nachrichten.map((n: any) => [n.text, n.von === a.kp.pk]));
console.log("Carol liest", J(await c.konto.empfangen(s1.events[0])).nachrichten.map((n: any) => n.text));
console.log("doppelt", J(await c.konto.empfangen(s1.events[0])).ergebnis);
const rm = J(await a.konto.entfernen(g.gruppe, [b.kp.pk]));
await a.konto.bestaetigt(rm.ausstehend);
console.log("Commit an Carol", J(await c.konto.empfangen(rm.events[0])).ergebnis, "an Bob", J(await b.konto.empfangen(rm.events[0])).ergebnis);
for (const p of [c, b]) { const w = p.konto.wartezeit(g.gruppe); if (w != null) await new Promise((r) => setTimeout(r, w + 20)); const f = J(await p.konto.fortschreiten(g.gruppe)); console.log(p.name, "fortschreiten", w, f.geaendert.length); }
console.log("Mitglieder nach Entfernen", a.konto.mitglieder(g.gruppe).length, c.konto.mitglieder(g.gruppe).length);
const s2 = J(await a.konto.senden(g.gruppe, "Geheim ohne Bob"));
console.log("Carol liest", J(await c.konto.empfangen(s2.events[0])).nachrichten.map((n: any) => n.text));
const rb = J(await b.konto.empfangen(s2.events[0]).catch((e: unknown) => JSON.stringify({ ergebnis: "Fehler " + e, nachrichten: [] })));
console.log("Bob liest", rb.ergebnis, rb.nachrichten.length);
const z = c.konto.zustand();
console.log("Zustand Bytes", z.length);
const c2 = c.neu(z);
console.log("Carol neu geladen, Gruppen", c2.gruppen().includes(g.gruppe));
const s3 = J(await c2.senden(g.gruppe, "Wieder da"));
console.log("Alice liest", J(await a.konto.empfangen(s3.events[0])).nachrichten.map((n: any) => n.text));
