/**
 * Leak-Szenario „Gruppenanruf“ (B-34c1): Die Einladung trägt die Zugänge zum SFU (JWT) und seine Adresse – sie geht nur
 * als inneres Event durch die MLS-Gruppe. Relays sehen nur Kind 445: keinen Zugang, keine Adresse, keine Kennung des
 * Anrufs, keine Identität.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { schnorr } from "@noble/curves/secp256k1.js";
import {
  LocalSigner, fromHex, generateKeypair, raumGruppenanruf, raumGruppenanrufe, regelKeinKind4, regelKeinKlartext, regelMlsGruppe, toHex,
  type LivekitZugaenge,
} from "@freedomstack/protocol";
import { Mls, ladeMls } from "@freedomstack/mls";
import { aufzeichnung } from "./aufzeichnung.js";

ladeMls(gunzipSync(readFileSync(new URL("../../../mls/dist/freedom_mls_bg.wasm.gz", import.meta.url))));
const person = () => {
  const kp = generateKeypair();
  return { pk: kp.pk, signer: new LocalSigner(kp.sk), mls: new Mls(new LocalSigner(kp.sk), (id) => toHex(schnorr.sign(fromHex(id), kp.sk))) };
};

const ANRUF = toHex(crypto.getRandomValues(new Uint8Array(16)));
const URL_SFU = "wss://sfu-geheim.example.org";
// Zugänge ab 32 Zeichen – nach Geheimnissen dieser Länge darf ein Leak-Test suchen
const TOKENS = [0, 1].map(() => `eyJhbGciOiJIUzI1NiJ9.${toHex(crypto.getRandomValues(new Uint8Array(24)))}.${toHex(crypto.getRandomValues(new Uint8Array(24)))}`);

test("Gruppenanruf (B-34c1): Zugänge, Adresse und Kennung nur in der Gruppe – Relays sehen nur Kind 445", async () => {
  const { pool, relay } = aufzeichnung();
  const [a, b] = [person(), person()];
  const g = await a.mls.gruppeAnlegen("Anrufraum", [await b.signer.signEvent(await b.mls.keyPackage("ab".repeat(32)))], ["wss://gruppe.test"]);
  await b.mls.beitreten(g.einladungen[0]!);
  const z: LivekitZugaenge = {
    url: URL_SFU, raum: ANRUF, bis: Math.floor(Date.now() / 1000) + 3600,
    zugaenge: TOKENS.map((token, i) => ({ kennung: String(i).repeat(16), token })),
  };
  const s = raumGruppenanruf(g.gruppe, z, [a.pk, b.pk]);
  const r = await a.mls.sendenEvent(g.gruppe, s.art, s.tags, s.text);
  for (const ev of r.events) await pool.publish(ev);

  const gesendet = relay.gesendet;
  assert.deepEqual([...new Set(gesendet.map((e) => e.kind))], [445]);
  assert.deepEqual(regelKeinKlartext(gesendet, [...TOKENS, URL_SFU, ANRUF]), []);
  assert.deepEqual(regelMlsGruppe(gesendet, { gruppenIds: [g.gruppe], identitaeten: [a.pk, b.pk] }), []);
  assert.deepEqual(regelKeinKind4(gesendet), []);

  // Bob liest seinen Zugang aus der Gruppe
  const empfang = await b.mls.empfangen(gesendet[0]!);
  const innen = empfang.nachrichten.map((n) => ({ id: n.inneres ?? n.id, von: n.von, art: n.art ?? 9, tags: n.tags ?? [], text: n.text, zeit: n.zeit }));
  const [anruf] = raumGruppenanrufe(g.gruppe, innen, { ich: b.pk });
  assert.equal(anruf?.zugang?.token, TOKENS[1]);
  assert.equal(anruf?.url, URL_SFU);
});
