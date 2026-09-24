/**
 * Vollstaendige End-to-End-Demo des Protokolls.
 *   npm run demo:full
 *
 * Durchlaeuft den kompletten Loop in der Reihenfolge des Integrationsplans:
 *   1 Identitaet + Profil mit lud16 (Clawstr-Muster) - Mensch UND Agent
 *   2 Outbox/Multi-Relay: Publikation ueberlebt ein zensierendes Relay (Luecke #1)
 *   3 KI-Job ueber NIP-90 DVM: Request -> Result
 *   4 Bezahlung per NIP-57 Zap, Zahlungsbeweis via Preimage
 *   5 Non-custodial Fee-Split -> Reward-Pool
 *   6 Leistungs-Event (kind 38010) mit PoW
 *   7 Leaderboard mit Web-of-Trust (Sybil-Schutz)
 *   8 Proportionale Ausschuettung + Payout-Nachweis (kind 38011)
 *   9 Cross-Chain: Atomic Swap Lightning -> Solana (bestehender Kern)
 */
import { generateKeypair, signEvent, verifyEvent } from "../src/event.js";
import { buildProfile, parseProfile } from "../src/profile.js";
import { OutboxPool, MemoryRelay } from "../src/outbox.js";
import { buildJobRequest, buildJobResult, parseJobResult } from "../src/dvm.js";
import { buildZapRequest, buildZapReceipt, parseZapReceipt, verifyZapPayment } from "../src/zap.js";
import { computeFeeSplit, accumulatePool, buildLeaderboard, allocateProportional, totalAllocated } from "../src/rewards.js";
import { buildPerformanceEvent, buildRewardPayout } from "../src/performance.js";
import { buildSwapAttestation, buildLpOffer } from "../src/nostr-order.js";
import { mineEvent, eventDifficulty } from "../src/pow.js";
import { generatePreimage, hashlock, toHex } from "../src/htlc.js";
import { runSwap } from "../src/swap.js";
import { MockLightning, MockSolana } from "../src/mocks.js";

const hr = (t: string) => console.log("\n" + "=".repeat(66) + "\n " + t + "\n" + "=".repeat(66));
const T0 = 1_700_000_000;

async function main() {
  // ---------------------------------------------------------------- 1
  hr("1) IDENTITAET: Mensch und KI-Agent, beide mit Lightning-Adresse");
  const root = generateKeypair();      // Vertrauensanker
  const customer = generateKeypair();  // Mensch, kauft KI-Leistung
  const agent = generateKeypair();     // KI-Agent, erbringt Leistung
  const lp = generateKeypair();        // Liquiditaetsgeber
  const zapper = generateKeypair();    // Lightning-Knoten (erzeugt Receipts)

  const agentProfile = signEvent(buildProfile(agent.pk, {
    name: "inference-agent-1", agent: true,
    lud16: `${agent.pk.slice(0, 16)}@npub.cash`,
    chains: { solana: "So1AgentAddr", polygon: "0xAgent", ton: "EQAgent" },
  }, T0), agent.sk);

  console.log(`   Agent npub:  ${agent.pk.slice(0, 24)}...`);
  console.log(`   lud16:       ${parseProfile(agentProfile).lud16}`);
  console.log(`   Solana:      ${parseProfile(agentProfile).chains?.solana}`);
  console.log(`   Signatur gueltig: ${verifyEvent(agentProfile)}`);
  console.log("   -> Agent ist ohne Konto, ohne Plattform zahlungsfaehig.");

  // ---------------------------------------------------------------- 2
  hr("2) OUTBOX: Publikation ueberlebt Zensur (Luecke #1 gegenueber Buzz)");
  const censor = new MemoryRelay("wss://staatsrelay", [38001, 5050]); // blockt LP-Angebote + KI-Jobs
  const pool = new OutboxPool([censor, new MemoryRelay("wss://frei-1"), new MemoryRelay("wss://frei-2")], { minAcks: 2 });

  const offer = signEvent(buildLpOffer({
    offerId: "ln-sol-1", pair: "LN-BTC/SOL", direction: "sell-sol",
    minSats: 10_000, maxSats: 5_000_000, feePpm: 3000,
    tSolSecs: 600, lnCltvDeltaBlocks: 12, expiry: T0 + 86_400,
  }, lp.pk, T0), lp.sk);

  const rep = await pool.publish(offer);
  console.log(`   Relays gesamt: ${pool.urls.length}`);
  console.log(`   akzeptiert:    ${rep.accepted.join(", ")}`);
  console.log(`   abgelehnt:     ${rep.rejected.map((r) => r.url).join(", ") || "-"}`);
  console.log(`   Publikation ok: ${rep.ok}`);
  const audit = await pool.auditAvailability(offer.id);
  console.log(`   Zensur-Audit -> fehlt bei: ${audit.missing.join(", ")}`);
  console.log("   -> Ein zensierendes Relay kann nichts faelschen, nur vorenthalten.");

  // ---------------------------------------------------------------- 3
  hr("3) KI-JOB ueber NIP-90 DVM");
  const jobReq = signEvent(buildJobRequest({
    customerPubkey: customer.pk,
    input: "Fasse dieses Dokument zusammen.",
    bidMsat: 50_000,
  }, T0 + 10), customer.sk);
  await pool.publish(jobReq);

  const jobRes = signEvent(buildJobResult({
    providerPubkey: agent.pk, requestId: jobReq.id, requestKind: jobReq.kind,
    customerPubkey: customer.pk, output: "Zusammenfassung: ...",
    amountMsat: 50_000, bolt11: "lnbc500n1...",
  }, T0 + 20), agent.sk);
  await pool.publish(jobRes);

  const parsedRes = parseJobResult(jobRes);
  console.log(`   Request  kind ${jobReq.kind} -> Result kind ${jobRes.kind}`);
  console.log(`   Anbieter fordert: ${parsedRes.amountMsat} msat`);

  // ---------------------------------------------------------------- 4
  hr("4) BEZAHLUNG per Zap (NIP-57) mit Preimage-Zahlungsbeweis");
  const preimage = generatePreimage();
  const paymentHash = hashlock(preimage);

  const zapReq = buildZapRequest({
    senderPubkey: customer.pk, recipientPubkey: agent.pk,
    eventId: jobRes.id, amountMsat: 50_000,
    relays: pool.urls, comment: "danke!",
  }, T0 + 30);

  const zapReceipt = signEvent(buildZapReceipt({
    zapperPubkey: zapper.pk, recipientPubkey: agent.pk, eventId: jobRes.id,
    zapRequestJson: JSON.stringify(zapReq), bolt11: "lnbc500n1...",
    preimageHex: toHex(preimage), senderPubkey: customer.pk,
  }, T0 + 40), zapper.sk);
  await pool.publish(zapReceipt);

  const pz = parseZapReceipt(zapReceipt);
  console.log(`   Betrag laut Receipt: ${pz.amountMsat} msat`);
  console.log(`   Zahlungsbeweis (Preimage passt zu Payment-Hash): ${verifyZapPayment(pz, toHex(paymentHash))}`);
  console.log("   -> Gleiche Preimage/Hash-Logik wie im HTLC des Atomic Swaps.");

  // ---------------------------------------------------------------- 5
  hr("5) NON-CUSTODIAL FEE-SPLIT");
  const split = computeFeeSplit(50_000, { totalFeePpm: 30_000, poolSharePercent: 60 });
  console.log(`   Zahlung gesamt:     ${split.totalMsat} msat`);
  console.log(`   -> an Agent:        ${split.recipientMsat} msat`);
  console.log(`   -> in Reward-Pool:  ${split.poolMsat} msat`);
  console.log(`   -> an Protokoll:    ${split.protocolMsat} msat`);
  console.log(`   Summe erhalten: ${split.recipientMsat + split.poolMsat + split.protocolMsat === split.totalMsat}`);
  console.log("   -> Aufteilung an der Quelle: kein zentraler Topf, nichts zu verwahren.");

  // ---------------------------------------------------------------- 6
  hr("6) LEISTUNGS-EVENT (kind 38010) mit Proof-of-Work");
  const sybil = generateKeypair();
  const mkPerf = (kp: { sk: Uint8Array; pk: string }, units: number, vol: number, t: number) =>
    signEvent(mineEvent(buildPerformanceEvent({
      workerPubkey: kp.pk, workType: "ai_job", units, volumeMsat: vol,
      chain: "lightning", seasonId: "season-1", proofEventId: zapReceipt.id,
    }, t), 8), kp.sk);

  const perfAgent = mkPerf(agent, 1, 50_000, T0 + 50);
  const perfSybil1 = mkPerf(sybil, 200, 10_000_000, T0 + 51); // massiv gefarmt
  await pool.publish(perfAgent);
  console.log(`   Agent-Leistung: 1 Job, PoW-Schwierigkeit ${eventDifficulty(perfAgent)} Bits`);
  console.log(`   Sybil-Leistung: 200 Jobs behauptet (ohne Vertrauensanker)`);

  // ---------------------------------------------------------------- 7
  hr("7) LEADERBOARD mit Web-of-Trust");
  const attestations = [
    signEvent(buildSwapAttestation({ swapId: "s1", counterpartyPubkey: agent.pk, success: true }, root.pk, T0 + 5), root.sk),
    signEvent(buildSwapAttestation({ swapId: "s2", counterpartyPubkey: lp.pk, success: true }, root.pk, T0 + 6), root.sk),
  ];
  const board = buildLeaderboard([perfAgent, perfSybil1], attestations, "season-1", {
    pointsPerUnit: { ai_job: 10, message: 1, liquidity: 5, relay: 2 },
    pointsPerKMsat: 1, minPowDifficulty: 8,
    wot: { roots: [root.pk], maxDepth: 3, decay: 0.5 },
  });
  for (const e of board) {
    console.log(`   ${e.pubkey.slice(0, 10)}...  roh: ${e.rawPoints.toFixed(0).padStart(6)}  vertrauen: ${e.trustWeight}  SCORE: ${e.score.toFixed(1)}`);
  }
  console.log("   -> Sybil hat mehr Rohpunkte, aber Vertrauen 0 => Score 0.");

  // ---------------------------------------------------------------- 8
  hr("8) AUSSCHUETTUNG (pay-for-work) + Nachweis (kind 38011)");
  const rewardPool = accumulatePool([split, split, split], "season-1", "lightning");
  const allocs = allocateProportional(rewardPool, board);
  console.log(`   Pool: ${rewardPool.balanceMsat} msat`);
  for (const a of allocs) {
    console.log(`   Rang ${a.rank}: ${a.pubkey.slice(0, 10)}... erhaelt ${a.amountMsat} msat`);
    const payout = signEvent(buildRewardPayout({
      pubkey: a.pubkey, seasonId: "season-1", recipientPubkey: a.pubkey,
      amountMsat: a.amountMsat, chain: "lightning", settlementRef: zapReceipt.id, rank: a.rank,
    }, T0 + 100), a.pubkey === agent.pk ? agent.sk : sybil.sk);
    await pool.publish(payout);
  }
  console.log(`   verteilt gesamt: ${totalAllocated(allocs)} <= Pool ${rewardPool.balanceMsat}: ${totalAllocated(allocs) <= rewardPool.balanceMsat}`);

  // ---------------------------------------------------------------- 9
  hr("9) CROSS-CHAIN: Atomic Swap Lightning -> Solana");
  let t = T0; const now = () => t;
  const ln = new MockLightning(100_000);
  const sol = new MockSolana(500_000_000, now);
  const res = await runSwap(ln, sol, {
    swapId: "swap-e2e", amountSats: 100_000, amountLamports: 500_000_000,
    userSolanaAddress: "UserSol", lpSolanaAddress: "LpSol",
    tSolSecs: 600, lnCltvDeltaBlocks: 12, now,
  }, true);
  for (const l of res.log) console.log("   " + l);
  console.log(`   Ergebnis: ${res.phase}`);

  hr("ZUSAMMENFASSUNG");
  console.log(`   Events publiziert und signaturgeprueft ueber ${pool.urls.length} Relays`);
  console.log(`   KI-Leistung bezahlt, Fee non-custodial gesplittet, Reward verteilt`);
  console.log(`   Wert chainuebergreifend getauscht - ohne Bridge, ohne Verwahrer.`);
  console.log("");
}

main().catch((e) => { console.error(e); process.exit(1); });
