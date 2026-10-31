/**
 * B-36c2b1: Bitchat-Schlüssel an Kontakte (BC-W3 A) – derselbe Versand wie die Reticulum-Adresse (`FunkAdressVersand`), mit der
 * Art `BITCHAT_SCHLUESSEL`: Kind 38083, nur mit Zustimmung und als Person, je Kontakt einmal; das Buch nimmt nur Kontakte.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LocalSigner, generateKeypair, oeffneBitchatSchluesselUmschlag, type NostrEvent } from "@freedomstack/protocol";
import { BITCHAT_SCHLUESSEL, FUNK_PRUEFEN_JEDEN, FunkAdressBuch, FunkAdressVersand, LS_FUNK_VERTEILT } from "../src/funk-adressen.js";

const NOISE = "5a".repeat(32);
const SIGNIER = "c3".repeat(32);
const WERT = `${NOISE}:${SIGNIER}`;
const speicher = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, w: string) => void m.set(k, w) };
};

test("B-36c2b1: Versand mit der Art Bitchat – je Kontakt ein Umschlag 38083, eigene Schlüssel im Tresor, nicht als Gerät", async () => {
  const ich = new LocalSigner(generateKeypair().sk);
  const kontakte = [new LocalSigner(generateKeypair().sk), new LocalSigner(generateKeypair().sk)];
  const s = speicher();
  const gesendet: { wrap: NostrEvent; an: string }[] = [];
  let alsGeraet = false;
  let wert = WERT;
  const v = new FunkAdressVersand({
    art: BITCHAT_SCHLUESSEL,
    zustimmung: () => true,
    signer: () => (alsGeraet ? null : ich),
    kontakte: () => kontakte.map((k) => k.publicKey()),
    adresse: async () => wert,
    sende: async (wrap, an) => { gesendet.push({ wrap, an }); return true; },
    speicher: s,
    jetzt: () => 1_800_000_000,
  });
  alsGeraet = true;
  assert.equal(await v.takt(), null, "als Gerät nie");
  alsGeraet = false;
  v.bald();
  for (let i = 0; i < 3; i++) await v.takt();
  assert.deepEqual(gesendet.map((g) => g.an), kontakte.map((k) => k.publicKey()), "je Kontakt einer, je Schlag einer");
  const r = await oeffneBitchatSchluesselUmschlag(gesendet[0]!.wrap, kontakte[0]!, new Set([ich.publicKey()]));
  assert.deepEqual([r?.noise, r?.signier], [NOISE, SIGNIER]);
  assert.ok(s.m.has(BITCHAT_SCHLUESSEL.verteilt) && !s.m.has(LS_FUNK_VERTEILT), "eigener Eintrag, nicht der von Reticulum");
  // Neue Identität: alle bekommen die neuen Schlüssel
  wert = `${"77".repeat(32)}:${SIGNIER}`;
  for (let i = 0; i < FUNK_PRUEFEN_JEDEN + 2; i++) await v.takt();
  assert.equal(gesendet.length, 4);
  // Ein Wert anderer Form geht nie hinaus
  wert = NOISE;
  const vorher = gesendet.length;
  v.bald();
  for (let i = 0; i < FUNK_PRUEFEN_JEDEN + 2; i++) await v.takt();
  assert.equal(gesendet.length, vorher);
});

test("B-36c2b1: Buch – nur Kontakte, je Kontakt die neueste, nur die Form <noise>:<signier>, getrennt von Reticulum", async () => {
  const s = speicher();
  const b = new FunkAdressBuch(s, BITCHAT_SCHLUESSEL);
  const reticulum = new FunkAdressBuch(s);
  const k = generateKeypair().pk;
  assert.equal(await b.nimm({ von: k, zeit: 100, adresse: WERT }), true);
  assert.equal(await b.nimm({ von: k, zeit: 99, adresse: `${"11".repeat(32)}:${SIGNIER}` }), false, "älter");
  assert.deepEqual(b.vonKontakten(new Set([k])), [{ pk: k, adresse: WERT }]);
  assert.deepEqual(b.vonKontakten(new Set()), [], "kein Kontakt mehr");
  for (const kaputt of [NOISE, `${NOISE}:${SIGNIER.toUpperCase()}`, `${NOISE}:${SIGNIER}:x`, "7f3a".repeat(8)]) {
    assert.equal(await b.nimm({ von: k, zeit: 200, adresse: kaputt }), false, kaputt);
  }
  assert.equal(reticulum.zahl(new Set([k])), 0, "Reticulum liest seinen eigenen Eintrag");
  assert.ok(s.m.has(BITCHAT_SCHLUESSEL.kontakte));
});

test("B-36c2b1: verdrahtet – Takt, Empfang in der Kette, nur als Person, alles in geheim, Identität erst beim Senden", () => {
  const lies = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
  assert.match(lies("shell/app.ts"), /abrufTakt\.melde\("bitchat-schluessel", \(\) => import\("\.\/bitchat-kontakte\.js"\)\.then\(\(f\) => f\.bitchatSchluesselTakt\(\)\), 1\);/);
  assert.match(lies("shell/tabs/posteingang.ts"), /\(await alsFunkAdresse\(w\)\) \?\? \(await alsBitchatSchluessel\(w\)\) \?\?/);
  const glue = lies("shell/bitchat-kontakte.ts");
  assert.match(glue, /art: BITCHAT_SCHLUESSEL,/);
  assert.match(glue, /signer: \(\) => \(alsGeraet\(\) \? null : state\.signer\)/);
  assert.match(glue, /speicher: geheim,/);
  assert.match(glue, /geheim\.getItem\(LS_BITCHAT_TEILEN\) === "1"/);
  assert.match(glue, /bitchatIdentitaet\(geheim\)/, "die Identität nur aus geheim");
  assert.doesNotMatch(glue, /localStorage/);
  assert.match(lies("shell/tresor.ts"),
    /const GEHEIM_FEST = \[[^\]]*"freedom\.bitchat\.identitaet", "freedom\.bitchat\.teilen", "freedom\.bitchat\.verteilt", "freedom\.bitchat\.kontakte"/);
});
