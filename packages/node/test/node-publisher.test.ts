/**
 * Tests fuer die periodischen Veroeffentlichungen.
 *
 * Diese Mechanismen waren gebaut, getestet — und wurden nirgends aufgerufen.
 * Sie existierten nur in ihren eigenen Tests. Die Tests hier pruefen deshalb
 * vor allem, dass tatsaechlich etwas AUF DEM RELAY landet.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OutboxPool, MemoryRelay, generateKeypair,
  KIND_TIME_WITNESS, KIND_RELAY_PROOF, KIND_PRICE_TICKER, KIND_SWAP_ATTESTATION,
  parseTimeWitness, parseRelayProof, extractEdges, computeTrust, trustOf,
} from "@freedomstack/protocol";
import { NodePublisher, publisherSelfCheck, observeAll } from "../src/node-publisher.js";

const NOW = 1_800_000_000;
const KP = generateKeypair();
const GEGENSEITE = generateKeypair();

function setup(relayUrl?: string) {
  const relay = new MemoryRelay("mem://a");
  const pool = new OutboxPool([relay], { minAcks: 1 });
  return { relay, pool, p: new NodePublisher(pool, { keypair: KP, relayUrl }) };
}

// ------------------------------------------------------------- Zeugen

test("Ohne beobachtete Ereignisse gibt es keinen Zeugen", async () => {
  const { p, relay } = setup();
  assert.equal(await p.publishWitness(NOW), false);
  assert.equal((await relay.query({ kinds: [KIND_TIME_WITNESS] })).length, 0);
});

test("DER KERN: der Zeuge landet tatsaechlich auf dem Relay", async () => {
  // Genau das passierte vorher NICHT — die Zeitstempel-Absicherung lief
  // vollstaendig ins Leere, und der Aufgaben-Angriff war weiter offen.
  const { p, relay } = setup();
  p.observe("a".repeat(64));
  p.observe("b".repeat(64));

  assert.equal(await p.publishWitness(NOW), true);
  const evs = await relay.query({ kinds: [KIND_TIME_WITNESS] });
  assert.equal(evs.length, 1);
  assert.equal(parseTimeWitness(evs[0]).count, 2);
});

test("Nach dem Zeugen faengt die Sammlung neu an", async () => {
  // Sonst wuerde jeder Zeuge alles seit Knotenstart enthalten und immer
  // groesser werden.
  const { p } = setup();
  p.observe("a".repeat(64));
  await p.publishWitness(NOW);
  assert.equal(p.pendingWitnessCount, 0);
});

test("Der Zeitraum schliesst an den vorigen an", async () => {
  const { p, relay } = setup();
  p.observe("a".repeat(64));
  await p.publishWitness(NOW - 3600);
  p.observe("b".repeat(64));
  await p.publishWitness(NOW);

  const evs = await relay.query({ kinds: [KIND_TIME_WITNESS] });
  const zweiter = evs.map(parseTimeWitness).sort((a, b) => b.untilUnix - a.untilUnix)[0];
  assert.equal(zweiter.fromUnix, NOW - 3600, "keine Luecke zwischen den Zeitraeumen");
});

test("Die Sammlung waechst nicht unbegrenzt", async () => {
  // Ein Zeuge ueber hunderttausend Kennungen waere so gross, dass ihn
  // niemand mehr abruft.
  const { p } = setup();
  for (let i = 0; i < 60_000; i++) p.observe(`id-${i}`);
  assert.ok(p.pendingWitnessCount <= 50_000, `${p.pendingWitnessCount}`);
});

test("Ereignisse lassen sich gebuendelt vormerken", async () => {
  const { p } = setup();
  const evs = Array.from({ length: 5 }, (_, i) => ({ id: `e${i}` })) as never[];
  assert.equal(observeAll(p, evs), 5);
});

// ------------------------------------------------------ Relay-Nachweis

test("Ohne oeffentliche Adresse kein Nachweis", async () => {
  // Ein Nachweis ohne erreichbare Adresse wird bei der Verteilung ohnehin
  // verworfen.
  const { p } = setup(undefined);
  assert.equal(await p.publishRelayProof(1000, 50, NOW), false);
});

test("Mit Adresse landet der Nachweis auf dem Relay", async () => {
  // Vorher bekam kein Relay je Geld, obwohl die Verteilung gebaut war.
  const { p, relay } = setup("wss://mein-relay.example");
  assert.equal(await p.publishRelayProof(1000, 50, NOW), true);

  const evs = await relay.query({ kinds: [KIND_RELAY_PROOF] });
  assert.equal(evs.length, 1);
  const n = parseRelayProof(evs[0]);
  assert.equal(n.uniqueClients, 50);
  assert.equal(n.url, "wss://mein-relay.example");
});

test("Ohne Clients wird nichts gemeldet", async () => {
  const { p } = setup("wss://leer.example");
  assert.equal(await p.publishRelayProof(0, 0, NOW), false);
});

// ------------------------------------------------- Attestierungen

test("Eine Attestierung erzeugt eine Kante im Vertrauensgraphen", async () => {
  // Ohne sie hatte der Graph KEINE Kante — jeder Vertrauenswert im ganzen
  // System war null, inklusive Prueferzulassung und Provider-Stufen.
  const { p, relay } = setup();
  await p.attestSwap("swap-1", GEGENSEITE.pk, true, NOW);

  const evs = await relay.query({ kinds: [KIND_SWAP_ATTESTATION] });
  assert.equal(evs.length, 1);

  const t = computeTrust(extractEdges(evs), { roots: [KP.pk] });
  assert.ok(trustOf(t, GEGENSEITE.pk) > 0, "die Gegenseite muss Vertrauen bekommen");
});

test("Ein gescheiterter Swap wird als solcher attestiert", async () => {
  const { p, relay } = setup();
  await p.attestSwap("swap-2", GEGENSEITE.pk, false, NOW);
  const evs = await relay.query({ kinds: [KIND_SWAP_ATTESTATION] });
  const t = computeTrust(extractEdges(evs), { roots: [KP.pk] });
  assert.equal(trustOf(t, GEGENSEITE.pk), 0, "Fehlschlaege erzeugen kein Vertrauen");
});

// ------------------------------------------------------------- Kurse

test("Kurse landen auf dem Relay", async () => {
  // Ohne sie hatte der Liquiditaetsgeber keine Wechselkursquelle.
  const { p, relay } = setup();
  await p.publishTicker("SOL/BTC", 250_000, NOW);
  assert.equal((await relay.query({ kinds: [KIND_PRICE_TICKER] })).length, 1);
});

// ------------------------------------------------------------- Takt

test("Ein Takt veroeffentlicht alles auf einmal", async () => {
  const { p, relay } = setup("wss://relay.example");
  p.observe("a".repeat(64));

  const r = await p.cycle({
    delivered: 500, uniqueClients: 20,
    rates: [{ pair: "SOL/BTC", satsPerUnit: 250_000 }],
    nowSecs: NOW,
  });

  assert.equal(r.witnesses, 1);
  assert.equal(r.relayProofs, 1);
  assert.equal(r.tickers, 1);
  assert.equal(r.errors.length, 0);
  assert.equal((await relay.query({ limit: 100 })).length, 3);
});

test("Ein Fehler stoppt nicht den ganzen Takt", async () => {
  // Ein Knoten, der wegen eines Problems keine Zeugen mehr veroeffentlicht,
  // faellt still aus dem Verfahren.
  const relay = new MemoryRelay("mem://a");
  const pool = new OutboxPool([relay], { minAcks: 1 });
  const p = new NodePublisher(pool, { keypair: KP, relayUrl: "wss://x" });
  p.observe("a".repeat(64));

  let ersterAufruf = true;
  const orig = pool.publish.bind(pool);
  pool.publish = async (ev) => {
    if (ersterAufruf) { ersterAufruf = false; throw new Error("Relay weg"); }
    return orig(ev);
  };

  const r = await p.cycle({ delivered: 1, uniqueClients: 1, nowSecs: NOW });
  assert.equal(r.errors.length, 1);
  assert.equal(r.relayProofs, 1, "der Rest muss trotzdem durchlaufen");
});

// ------------------------------------------------------------ Selbstauskunft

test("Der Betreiber sieht, was sein Knoten NICHT beitraegt", () => {
  // Sonst glaubt er beizutragen, weil die Software die Funktion enthaelt.
  const ohne = publisherSelfCheck({ keypair: KP }, false);
  assert.ok(ohne.inactive.some((x) => /RELAY_PUBLIC_URL/.test(x)));
  assert.match(ohne.message, /kosten dich Einnahmen/);

  const mit = publisherSelfCheck({ keypair: KP, relayUrl: "wss://x" }, true);
  assert.equal(mit.inactive.length, 0);
  assert.match(mit.message, /alles bei, was er kann/);
});

test("Zeitzeugen sind immer aktiv", () => {
  // Sie brauchen keine Konfiguration und sichern die Aufgaben ab.
  assert.ok(publisherSelfCheck({ keypair: KP }, false).active.some((x) => /Zeitzeugen/.test(x)));
});
