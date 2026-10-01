/**
 * Knoten mit Besitzer koppeln (Sammlung B-8, L1 A): Kopplungscode, Nachweis im
 * versiegelten Kern, Prüfung beim Knoten – und offen nie.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEvent, generateKeypair, signEvent } from "../src/event.js";
import { ProtokollFehler } from "../src/fehler.js";
import {
  BESITZER_FENSTER, BESITZER_TAG, KOPPLUNG_PRAEFIX, besitzerNachweis, istBesitzer, kopplungscode, leseKopplungscode, mitBesitzerNachweis, neueKopplung,
} from "../src/kopplung.js";
import { regelBesitzerVersiegelt } from "../src/leak-rules.js";
import { buildPrivateJobRequest, openPrivateJobRequest } from "../src/private-job.js";
import { LocalSigner } from "../src/signer.js";

const KNOTEN = generateKeypair();
const SITZUNG = generateKeypair();
const JETZT = 1_800_000_000;
const anfrage = (p = KNOTEN.pk, zeit = JETZT) => buildEvent(SITZUNG.pk, 5050, [["i", "Hallo", "text"], ["p", p]], "", zeit);

test("B-8: Kopplungscode – neu je Kopplung, streng gelesen", () => {
  const k = neueKopplung(KNOTEN.pk);
  assert.match(k.geheimnis, /^[0-9a-f]{64}$/);
  assert.notEqual(neueKopplung(KNOTEN.pk).geheimnis, k.geheimnis, "frisch je Kopplung");
  const code = kopplungscode(k);
  assert.ok(code.startsWith(KOPPLUNG_PRAEFIX));
  assert.deepEqual(leseKopplungscode(`  ${code}\n`), k, "eingefügt oder gescannt, mit Leerraum");
  for (const falsch of ["", code.replace("kopplung:1", "kopplung:2"), code.slice(0, -1), `${code}0`, code.toUpperCase(), code.replace(k.knoten, "zz".repeat(32)), `x${code}`]) {
    assert.equal(leseKopplungscode(falsch), null, falsch);
  }
  assert.throws(() => neueKopplung("kein-schluessel"), (e: unknown) => e instanceof ProtokollFehler && e.kennung === "kopplung-knoten");
  assert.throws(() => besitzerNachweis("zu-kurz", SITZUNG.pk, JETZT), (e: unknown) => e instanceof ProtokollFehler && e.kennung === "kopplung-geheimnis");
});

test("B-8: Nachweis – gebunden an Geheimnis, Sitzung und Zeit; nur an den gekoppelten Knoten", () => {
  const k = neueKopplung(KNOTEN.pk);
  const n = besitzerNachweis(k.geheimnis, SITZUNG.pk, JETZT);
  assert.match(n, /^[0-9a-f]{64}$/);
  assert.equal(besitzerNachweis(k.geheimnis, SITZUNG.pk, JETZT), n, "deterministisch");
  assert.notEqual(besitzerNachweis(k.geheimnis, SITZUNG.pk, JETZT + 1), n);
  assert.notEqual(besitzerNachweis(k.geheimnis, generateKeypair().pk, JETZT), n);
  assert.notEqual(besitzerNachweis(neueKopplung(KNOTEN.pk).geheimnis, SITZUNG.pk, JETZT), n);
  const kern = mitBesitzerNachweis(anfrage(), k);
  assert.deepEqual(kern.tags.filter((t) => t[0] === BESITZER_TAG), [[BESITZER_TAG, n]]);
  assert.ok(!JSON.stringify(kern).includes(k.geheimnis), "nie das Geheimnis selbst");
  assert.deepEqual(mitBesitzerNachweis(kern, k).tags.filter((t) => t[0] === BESITZER_TAG).length, 1, "ersetzt, nie doppelt");
  assert.throws(() => mitBesitzerNachweis(anfrage(generateKeypair().pk), k), (e: unknown) => e instanceof ProtokollFehler && e.kennung === "kopplung-fremd");
});

test("B-8: Prüfung beim Knoten – Fenster, falsches Geheimnis, Fälschungen", () => {
  const k = neueKopplung(KNOTEN.pk);
  const kern = mitBesitzerNachweis(anfrage(), k);
  assert.ok(istBesitzer(kern, [k.geheimnis], JETZT));
  assert.ok(istBesitzer(kern, ["kaputt", neueKopplung(KNOTEN.pk).geheimnis, k.geheimnis], JETZT + BESITZER_FENSTER), "eines von mehreren, Rand des Fensters");
  assert.ok(!istBesitzer(kern, [k.geheimnis], JETZT + BESITZER_FENSTER + 1), "zu alt");
  assert.ok(!istBesitzer(kern, [k.geheimnis], JETZT - BESITZER_FENSTER - 1), "aus der Zukunft");
  assert.ok(!istBesitzer(kern, [neueKopplung(KNOTEN.pk).geheimnis], JETZT), "ein neues Geheimnis widerruft das alte");
  assert.ok(!istBesitzer(kern, [], JETZT));
  assert.ok(!istBesitzer(anfrage(), [k.geheimnis], JETZT), "ohne Nachweis");
  assert.ok(!istBesitzer({ ...kern, created_at: JETZT + 5 }, [k.geheimnis], JETZT), "Zeit verändert");
  assert.ok(!istBesitzer({ ...kern, pubkey: generateKeypair().pk }, [k.geheimnis], JETZT), "andere Sitzung");
  assert.ok(!istBesitzer({ ...kern, tags: [...kern.tags, ...kern.tags.filter((t) => t[0] === BESITZER_TAG)] }, [k.geheimnis], JETZT), "doppelt");
  assert.ok(!istBesitzer({ ...kern, tags: kern.tags.map((t) => (t[0] === BESITZER_TAG ? [t[0], "zz"] : t)) }, [k.geheimnis], JETZT), "kein Hex");
});

test("B-8: nur versiegelt – im Umschlag steht kein Nachweis, offen meldet ihn die Leak-Regel", async () => {
  const k = neueKopplung(KNOTEN.pk);
  const kern = mitBesitzerNachweis(anfrage(KNOTEN.pk, Math.floor(Date.now() / 1000)), k);
  const { wrap } = await buildPrivateJobRequest({ request: kern, sessionSigner: new LocalSigner(SITZUNG.sk), providerPk: KNOTEN.pk, powBits: 0 });
  assert.deepEqual(regelBesitzerVersiegelt([wrap]), []);
  assert.ok(!JSON.stringify(wrap).includes(kern.tags.find((t) => t[0] === BESITZER_TAG)![1]!));
  const geoeffnet = await openPrivateJobRequest(wrap, new LocalSigner(KNOTEN.sk));
  assert.ok(geoeffnet.ok && istBesitzer(geoeffnet.request, [k.geheimnis], Math.floor(Date.now() / 1000)), "der Knoten liest ihn aus dem Umschlag");
  const offen = signEvent(kern, SITZUNG.sk);
  assert.equal(regelBesitzerVersiegelt([offen]).length, 1);
});
