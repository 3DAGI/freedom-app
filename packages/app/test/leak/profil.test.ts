/**
 * Leak-Szenario „Profil speichern“ (Schritt 1.5): das Profil (Kind 0) aus den
 * Feldern, die `sammeln()` in `tabs/profil.ts` liest. Eine Lightning-Adresse
 * (lud16) ist gewollt oeffentlich; eine SOL-Adresse oder Rechnung nicht.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
import {
  LocalSigner, buildProfile, generateKeypair, regelKeinBolt11, regelKeinKind4, regelKeineSolAdresse,
} from "@freedomstack/protocol";
import { aufzeichnung } from "./aufzeichnung.js";

async function speichere() {
  const { pool, relay } = aufzeichnung();
  const signer = new LocalSigner(generateKeypair().sk);
  const entwurf = {
    name: "Ada", about: "Baut Funknetze", picture: "https://bilder.example/ada.png", lud16: "ada@wallet.example",
    freedom_style: { accent: "messing", layout: "schlicht", pattern: "keines" },
  };
  await pool.publish(await signer.signEvent(buildProfile(signer.publicKey(), entwurf as never)));
  return relay.gesendet;
}

test("Profil: keine SOL-Adresse, keine Rechnung, kein Kind 4", async () => {
  const gesendet = await speichere();
  const solDerWallet = Keypair.generate().publicKey.toBase58();
  assert.equal(gesendet.length, 1);
  assert.deepEqual(regelKeineSolAdresse(gesendet, [solDerWallet]), []);
  assert.deepEqual(regelKeinBolt11(gesendet), []);
  assert.deepEqual(regelKeinKind4(gesendet), []);
});

test("Verdrahtung: das Profil-Formular sammelt keine Chain-Adressen", () => {
  const p = readFileSync(new URL("../../src/shell/tabs/profil.ts", import.meta.url), "utf8");
  const f = p.slice(p.indexOf("const sammeln = (): ProfilEntwurf => ({"), p.indexOf("const zeigeOffenlegung"));
  assert.ok(f.length > 0);
  assert.doesNotMatch(f, /chains|solana/);
  assert.match(p, /signiere\(buildProfile\(state\.keypair\.pk, entwurf as never\)\)/);
});
