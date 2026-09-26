/**
 * Abnahme-Lauf des Liquiditaetsgebers (Schritt 8.3b): beide Swap-Richtungen,
 * je einmal mit Erfolg und einmal mit Ablauf – gegen dieselben Schnittstellen,
 * die der Knoten nutzt. Mit Mocks laeuft er im Test in Sekunden; gegen echtes
 * Devnet und Lightning-Testnet (`lp-abnahme-lauf.ts`) dauert er, so lange die
 * Fristen es verlangen.
 *
 * Kunde und LP haben je eigene Adapter (eigener Lightning-Knoten, eigenes
 * Solana-Konto). Das Relay ist ein Speicher im Prozess: Hier wird der Swap
 * geprueft, nicht die Zustellung.
 */
import {
  MemoryRelay, OutboxPool, buildEvent, generateKeypair, generatePreimage, getTag, hashlock, rueckSwapId, rueckSwapLamports,
  signEvent, toHex, type LightningAdapter, type LpOffer, type SolanaHtlcAdapter,
} from "@freedomstack/protocol";
import { FixedRate, KIND_SWAP_REQUEST, KIND_SWAP_RESPONSE, LpDaemon, RUECKHOL_PUFFER_SECS, type RueckSitzung, type SwapSession } from "./lp-daemon.js";

export interface AbnahmeSeite {
  ln: LightningAdapter;
  sol: SolanaHtlcAdapter;
  /** SOL-Adresse dieses Kontos (Empfaenger bzw. Initiator der Sperren). */
  solAdresse: string;
}

export interface Abnahme {
  lp: AbnahmeSeite;
  kunde: AbnahmeSeite;
  uhr: () => number;
  /** Echte Zeit vergehen lassen (echter Lauf) oder die Uhr vorstellen (Mock). */
  warte: (secs: number) => Promise<void>;
  sats: number;
  lamportsPerSat: number;
  feePpm: number;
  /** Hinrichtung: Sperrfrist und Lightning-Frist (die Lightning-Frist muss laenger sein, `validateTimelockOrdering`). */
  hin: { tSolSecs: number; lnCltvDeltaBlocks: number };
  /** Gegenrichtung: Sperrfrist des Kunden und hoechstes cltv_limit des LP. */
  rueck: { sperrSecs: number; lnCltvDeltaBlocks: number };
  /** Wie oft und wie lange auf die Kette oder Lightning gewartet wird (Sekunden). */
  takt?: number;
  geduld?: number;
  log?: (zeile: string) => void;
}

export type FallName = "hin" | "hin-ablauf" | "rueck" | "rueck-ablauf";
export const ALLE_FAELLE: readonly FallName[] = ["hin", "hin-ablauf", "rueck", "rueck-ablauf"];

export interface Fall {
  name: FallName;
  ok: boolean;
  grund?: string;
  sekunden: number;
}

const NOSTR_LP = generateKeypair();

/** Alle gewaehlten Faelle nacheinander – ein Fehler beendet nur seinen Fall. */
export async function lpAbnahme(a: Abnahme, faelle: readonly FallName[] = ALLE_FAELLE): Promise<Fall[]> {
  const out: Fall[] = [];
  for (const name of faelle) {
    const start = a.uhr();
    a.log?.(`▶ ${name}`);
    try {
      await FAELLE[name](a);
      out.push({ name, ok: true, sekunden: a.uhr() - start });
    } catch (e) {
      out.push({ name, ok: false, grund: (e as Error).message.slice(0, 200), sekunden: a.uhr() - start });
    }
    a.log?.(`${out.at(-1)!.ok ? "✓" : "✗"} ${name}${out.at(-1)!.grund ? `: ${out.at(-1)!.grund}` : ""}`);
  }
  return out;
}

function lpFuer(a: Abnahme, pool: OutboxPool, richtung: "sell-sol" | "buy-sol"): LpDaemon {
  const offer: Omit<LpOffer, "expiry"> = richtung === "sell-sol"
    ? { offerId: "abnahme-hin", pair: "LN-BTC/SOL", direction: "sell-sol", minSats: 1, maxSats: a.sats, feePpm: a.feePpm, tSolSecs: a.hin.tSolSecs, lnCltvDeltaBlocks: a.hin.lnCltvDeltaBlocks }
    : { offerId: "abnahme-rueck", pair: "LN-BTC/SOL", direction: "buy-sol", minSats: 1, maxSats: a.sats, feePpm: a.feePpm, tSolSecs: a.rueck.sperrSecs, lnCltvDeltaBlocks: a.rueck.lnCltvDeltaBlocks };
  let rueck: RueckSitzung[] = [];
  return new LpDaemon({
    keypair: NOSTR_LP, offer, offerTtlSecs: 3600, maxLamportsPerSwap: a.sats * a.lamportsPerSat * 2, solAdresse: a.lp.solAdresse,
    speicher: { lade: () => rueck, speichere: (s) => { rueck = s; } },
  }, pool, a.lp.ln, a.lp.sol, new FixedRate(a.lamportsPerSat), a.uhr);
}

/** Bis `pruefe` etwas liefert – im Takt, hoechstens `geduld` Sekunden. */
async function bis<T>(a: Abnahme, was: string, pruefe: () => Promise<T | undefined | null | false>): Promise<T> {
  const takt = a.takt ?? 5;
  const ende = a.uhr() + (a.geduld ?? 600);
  for (;;) {
    const r = await pruefe();
    if (r) return r;
    if (a.uhr() >= ende) throw new Error(`Zeit abgelaufen: ${was}`);
    await a.warte(takt);
  }
}

async function anfrage(pool: OutboxPool, tags: string[][]): Promise<string> {
  const k = generateKeypair();
  const ev = signEvent(buildEvent(k.pk, KIND_SWAP_REQUEST, [["p", NOSTR_LP.pk], ...tags], ""), k.sk);
  await pool.publish(ev);
  return ev.id;
}

async function antwort(pool: OutboxPool, anfrageId: string) {
  return (await pool.query({ kinds: [KIND_SWAP_RESPONSE], "#e": [anfrageId] }))[0];
}

/** Hinrichtung bis zur bezahlten Hold-Invoice: LP sperrt, Kunde zahlt. */
async function hinBisBezahlt(a: Abnahme) {
  const pool = new OutboxPool([new MemoryRelay("mem://abnahme-hin")], { minAcks: 1 });
  const lp = lpFuer(a, pool, "sell-sol");
  const R = generatePreimage();
  const H = hashlock(R);
  const id = await anfrage(pool, [["offer", "abnahme-hin"], ["amount_sats", String(a.sats)], ["hashlock", toHex(H)], ["solana_address", a.kunde.solAdresse]]);
  const [s] = await lp.pollOnce(a.uhr()) as SwapSession[];
  if (s?.phase !== "INVOICE_CREATED") throw new Error(`LP hat nicht gesperrt (${s?.phase ?? "keine Sitzung"})`);
  const ant = await bis(a, "Antwort des LP", () => antwort(pool, id));
  const swapId = getTag(ant, "swap_id")!;
  const sperre = await bis(a, "Sperre auf der Kette", () => a.kunde.sol.get(swapId));
  if (sperre.amountLamports !== a.sats * a.lamportsPerSat) throw new Error(`gesperrt ${sperre.amountLamports} statt ${a.sats * a.lamportsPerSat}`);
  await a.kunde.ln.payHoldInvoice(ant.content);
  await bis(a, "Hold-Invoice bezahlt", async () => (await a.lp.ln.getInvoiceState(H)) === "ACCEPTED");
  return { lp, R, H, swapId, s };
}

const FAELLE: Record<FallName, (a: Abnahme) => Promise<void>> = {
  /** sats → SOL: Kunde loest mit R ein, LP rechnet mit R ab. */
  async hin(a) {
    const { lp, R, H, swapId } = await hinBisBezahlt(a);
    await a.kunde.sol.claim(swapId, R, a.lp.solAdresse);
    await bis(a, "Abrechnung des LP", async () => (await lp.settleSweep()).length > 0);
    if ((await a.lp.ln.getInvoiceState(H)) !== "SETTLED") throw new Error("Hold-Invoice nicht abgerechnet");
  },

  /** sats → SOL, Kunde loest nie ein: LP holt nach der Frist zurueck, die Zahlung geht an den Kunden zurueck. */
  async "hin-ablauf"(a) {
    const { lp, H, swapId, s } = await hinBisBezahlt(a);
    await a.warte(Math.max(0, s.timelockUnix! + RUECKHOL_PUFFER_SECS - a.uhr()));
    const [z] = await bis(a, "Rueckholung", async () => { const r = await lp.holeAbgelaufeneZurueck(); return r.length > 0 ? r : undefined; });
    if (z!.phase !== "REFUNDED") throw new Error(`Phase ${z!.phase} statt REFUNDED`);
    const sperre = await a.kunde.sol.get(swapId);
    if (sperre && !sperre.refunded) throw new Error("Sperre nicht zurueckgeholt");
    if ((await a.lp.ln.getInvoiceState(H)) !== "CANCELED") throw new Error("Hold-Invoice nicht abgebrochen");
  },

  /** SOL → sats: Kunde sperrt SOL unter dem Hash seiner Rechnung, LP zahlt sie und loest ein. */
  async rueck(a) {
    const { lp, swapId } = await rueckSperre(a, false);
    const [s] = await bis(a, "Zahlung und Einloesung", async () => {
      await lp.pollOnce(a.uhr());
      await lp.warteAufZahlungen();
      await lp.nachholen();
      const r = lp.rueckSitzungen().filter((x) => x.swapId === swapId && ["EINGELOEST", "GESCHEITERT", "ZU_SPAET"].includes(x.phase));
      return r.length > 0 ? r : undefined;
    });
    if (s!.phase !== "EINGELOEST") throw new Error(`Phase ${s!.phase} statt EINGELOEST`);
    const sperre = await a.kunde.sol.get(swapId);
    if (sperre && !sperre.claimed) throw new Error("SOL nicht eingeloest");
  },

  /** SOL → sats, die Zahlung scheitert: Der Kunde holt seine SOL nach der Frist zurueck. */
  async "rueck-ablauf"(a) {
    const { lp, swapId, frist } = await rueckSperre(a, true);
    const [s] = await bis(a, "Zahlung scheitert", async () => {
      await lp.pollOnce(a.uhr());
      await lp.warteAufZahlungen();
      await lp.nachholen();
      const r = lp.rueckSitzungen().filter((x) => x.swapId === swapId && x.phase !== "ZAHLT");
      return r.length > 0 ? r : undefined;
    });
    if (s!.phase !== "GESCHEITERT") throw new Error(`Phase ${s!.phase} statt GESCHEITERT – der LP darf nicht einloesen`);
    await a.warte(Math.max(0, frist + 60 - a.uhr()));
    await a.kunde.sol.refund(swapId);
    const sperre = await a.kunde.sol.get(swapId);
    if (sperre && !sperre.refunded) throw new Error("Sperre nicht zurueckgeholt");
  },
};

/** Gegenrichtung: Rechnung des Kunden, Sperre auf der Kette, Anfrage. `unbezahlbar`: Rechnung vorher abbrechen. */
async function rueckSperre(a: Abnahme, unbezahlbar: boolean) {
  if (!a.kunde.ln.createInvoice) throw new Error("Lightning des Kunden kann keine Rechnung stellen");
  const pool = new OutboxPool([new MemoryRelay("mem://abnahme-rueck")], { minAcks: 1 });
  const lp = lpFuer(a, pool, "buy-sol");
  const r = await a.kunde.ln.createInvoice(a.sats);
  if (unbezahlbar) await a.kunde.ln.cancelHoldInvoice(r.paymentHash);
  const swapId = rueckSwapId(r.bolt11);
  const frist = a.uhr() + a.rueck.sperrSecs;
  await a.kunde.sol.lock({
    swapId, hashlock: r.paymentHash, amountLamports: rueckSwapLamports(a.sats, a.lamportsPerSat, a.feePpm), timelockUnix: frist,
    recipient: a.lp.solAdresse, initiator: a.kunde.solAdresse,
  });
  await bis(a, "Sperre auf der Kette", () => a.lp.sol.get(swapId));
  await anfrage(pool, [["offer", "abnahme-rueck"], ["bolt11", r.bolt11]]);
  return { lp, swapId, frist, paymentHash: toHex(r.paymentHash) };
}

/** Ergebnis als Tabelle fuer die Ausgabe. */
export function abnahmeBericht(faelle: readonly Fall[]): string {
  return faelle.map((f) => `${f.ok ? "✓" : "✗"} ${f.name.padEnd(13)} ${String(f.sekunden).padStart(6)} s${f.grund ? `  ${f.grund}` : ""}`).join("\n");
}
