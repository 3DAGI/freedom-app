/**
 * Leak-Szenario „Profil speichern“ (Schritt 1.5): das Profil (Kind 0) aus den
 * Feldern, die `sammeln()` in `tabs/profil.ts` liest. Eine Rechnung nie; die
 * Lightning-Adresse (lud16) seit 6.3 nur mit Häkchen, die SOL-Adresse (`sol`)
 * seit 12.6 ebenso – eine andere als die eingetragene nie.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
import {
  LocalSigner, buildProfile, generateKeypair, oeffentlichesProfil, regelKeinBolt11, regelKeinKind4, regelKeineLnAdresse, regelKeineSolAdresse,
} from "@freedomstack/protocol";
import { aufzeichnung } from "./aufzeichnung.js";

const LN = "ada@wallet.example";
const SOL = Keypair.generate().publicKey.toBase58();

async function speichere(lightning = false, sol = false) {
  const { pool, relay } = aufzeichnung();
  const signer = new LocalSigner(generateKeypair().sk);
  const entwurf = {
    name: "Ada", about: "Baut Funknetze", picture: "https://bilder.example/ada.png", lud16: "ada@wallet.example", sol: SOL,
    freedom_style: { accent: "messing", layout: "schlicht", pattern: "keines" },
  };
  // wie `oeffentlich(entwurf)` in tabs/profil.ts
  await pool.publish(await signer.signEvent(buildProfile(signer.publicKey(), oeffentlichesProfil(entwurf, { lightning, sol }) as never)));
  return relay.gesendet;
}

test("Profil: keine SOL-Adresse, keine Rechnung, kein Kind 4", async () => {
  const gesendet = await speichere();
  const solDerWallet = Keypair.generate().publicKey.toBase58();
  assert.equal(gesendet.length, 1);
  assert.deepEqual(regelKeineSolAdresse(gesendet, [solDerWallet, SOL]), [], "12.6: ohne Häkchen keine SOL-Adresse");
  assert.deepEqual(regelKeinBolt11(gesendet), []);
  assert.deepEqual(regelKeinKind4(gesendet), []);
  assert.deepEqual(regelKeineLnAdresse(gesendet, [LN]), [], "6.3: ohne Häkchen keine Lightning-Adresse");
});

test("6.3: mit Häkchen steht die Lightning-Adresse im Profil – und die Regel findet sie", async () => {
  const gesendet = await speichere(true);
  assert.equal(regelKeineLnAdresse(gesendet, [LN]).length, 1);
  assert.equal(JSON.parse(gesendet[0].content).lud16, LN);
});

test("12.6: mit Häkchen steht genau die eingetragene SOL-Adresse im Profil – und die Regel findet sie", async () => {
  const gesendet = await speichere(false, true);
  assert.equal(regelKeineSolAdresse(gesendet, [SOL]).length, 1);
  assert.equal(JSON.parse(gesendet[0].content).sol, SOL);
  assert.equal(JSON.parse(gesendet[0].content).lud16, undefined, "die Häkchen sind unabhängig");
  assert.deepEqual(regelKeineSolAdresse(gesendet, [Keypair.generate().publicKey.toBase58()]), [], "keine andere Adresse der Wallet");
});

test("Verdrahtung: das Profil-Formular sammelt keine Chain-Liste, die SOL-Adresse nur als `sol`", () => {
  const p = readFileSync(new URL("../../src/shell/tabs/profil.ts", import.meta.url), "utf8");
  const f = p.slice(p.indexOf("const sammeln = (): ProfilEntwurf => ({"), p.indexOf("const zeigeOffenlegung"));
  assert.ok(f.length > 0);
  assert.doesNotMatch(f, /chains|solana/);
  assert.match(f, /sol: \(\$\("#pf-sol"\) as HTMLInputElement\)\?\.value\.trim\(\) \|\| undefined,/);
  assert.match(p, /signiere\(buildProfile\(state\.keypair\.pk, oeffentlich\(entwurf\) as never\)\)/);
  assert.match(p, /const oeffentlich = \(e: ProfilEntwurf\): ProfilEntwurf => oeffentlichesProfil\(e, \{ lightning: lnOeffentlich\(localStorage\), sol: solOeffentlich\(localStorage\) \}\);/);
  assert.equal((p.match(/buildProfile\(/g) ?? []).length, 1, "ein Weg ins Profil");
});
