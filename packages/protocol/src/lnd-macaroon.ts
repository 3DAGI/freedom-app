/**
 * Rechte einer LND-Macaroon lesen (Schritt 8.3), ohne LND zu fragen.
 *
 * Eine LND-Macaroon ist im Binaerformat v2 gespeichert: Version 2, dann Felder
 * (Typ-Byte, Laenge als Varint, Daten) – Ort (1), Kennung (2), … Die Kennung
 * beginnt mit Version 3, danach Protobuf `MacaroonId { nonce = 1; storageId = 2;
 * repeated Op ops = 3 }` mit `Op { entity = 1; repeated actions = 2 }`. Die Ops
 * sind die Obergrenze der Rechte; Caveats koennen sie nur weiter einschraenken.
 *
 * Der LP-Daemon braucht Rechnungen und Zahlungen – nie `admin.macaroon`. Wer
 * den Daemon uebernimmt, soll weder On-Chain-Geld bewegen noch Kanaele
 * schliessen noch sich weitere Rechte backen koennen (docs/SWAPS.md).
 */
import { fromHex } from "./htlc.js";

export interface MacaroonRecht {
  entity: string;
  actions: string[];
}

/** Was der LP-Daemon braucht – und mehr darf die Macaroon nicht erlauben (`info:read` ist erlaubt, nicht noetig). */
export const LP_RECHTE_NOETIG = ["invoices:read", "invoices:write", "offchain:read", "offchain:write"] as const;
export const LP_RECHTE_ERLAUBT = [...LP_RECHTE_NOETIG, "info:read"] as const;

class Leser {
  i = 0;
  constructor(private b: Uint8Array) {}
  ende(): boolean { return this.i >= this.b.length; }
  byte(): number {
    if (this.i >= this.b.length) throw new Error("Macaroon zu kurz");
    return this.b[this.i++]!;
  }
  varint(): number {
    let wert = 0;
    for (let schub = 0; schub < 35; schub += 7) {
      const b = this.byte();
      wert += (b & 0x7f) * 2 ** schub;
      if (b < 0x80) return wert;
    }
    throw new Error("Varint zu lang");
  }
  stueck(n: number): Uint8Array {
    if (n > this.b.length - this.i) throw new Error("Laenge ueber das Ende hinaus");
    const s = this.b.subarray(this.i, this.i + n);
    this.i += n;
    return s;
  }
}

/** Kennung aus einer Macaroon im Binaerformat v2 (Feld 2 des ersten Abschnitts). */
function kennung(bytes: Uint8Array): Uint8Array {
  const r = new Leser(bytes);
  if (r.byte() !== 2) throw new Error("keine Macaroon im Binärformat v2");
  while (!r.ende()) {
    const typ = r.byte();
    if (typ === 0) break; // Ende des ersten Abschnitts ohne Kennung
    const daten = r.stueck(r.varint());
    if (typ === 2) return daten;
  }
  throw new Error("Macaroon ohne Kennung");
}

/** Protobuf lesen – hier kommen nur Felder mit Laenge vor (Draht-Typ 2). */
function felder(b: Uint8Array): Array<{ nr: number; daten: Uint8Array }> {
  const r = new Leser(b);
  const out: Array<{ nr: number; daten: Uint8Array }> = [];
  while (!r.ende()) {
    const kopf = r.varint();
    if ((kopf & 7) !== 2) throw new Error("unerwartetes Protobuf-Feld");
    out.push({ nr: Math.floor(kopf / 8), daten: r.stueck(r.varint()) });
  }
  return out;
}

const text = (b: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(b);

/** Rechte (Ops) einer LND-Macaroon. Wirft, wenn sie nicht lesbar ist. */
export function macaroonRechte(hex: string): MacaroonRecht[] {
  const h = hex.trim().toLowerCase();
  if (!/^(?:[0-9a-f]{2})+$/.test(h)) throw new Error("Macaroon ist kein Hex");
  const id = kennung(fromHex(h));
  if (id[0] !== 3) throw new Error("Kennung nicht im LND-Format (Version 3)");
  return felder(id.subarray(1)).filter((f) => f.nr === 3).map((op) => {
    const teile = felder(op.daten);
    return {
      entity: text(teile.find((t) => t.nr === 1)?.daten ?? new Uint8Array()),
      actions: teile.filter((t) => t.nr === 2).map((t) => text(t.daten)),
    };
  });
}

/**
 * Taugt diese Macaroon fuer den LP-Daemon? Genau die noetigen Rechte, nichts
 * darueber hinaus – sonst nennt `grund`, was zu viel ist oder fehlt.
 */
export function pruefeLpMacaroon(hex: string): { ok: true } | { ok: false; grund: string } {
  let rechte: MacaroonRecht[];
  try {
    rechte = macaroonRechte(hex);
  } catch (e) {
    return { ok: false, grund: `Macaroon nicht lesbar (${(e as Error).message})` };
  }
  const hat = new Set(rechte.flatMap((r) => r.actions.map((a) => `${r.entity}:${a}`)));
  const zuviel = [...hat].filter((r) => !(LP_RECHTE_ERLAUBT as readonly string[]).includes(r)).sort();
  if (zuviel.length > 0) return { ok: false, grund: `Macaroon erlaubt zu viel: ${zuviel.join(", ")}` };
  const fehlt = LP_RECHTE_NOETIG.filter((r) => !hat.has(r));
  if (fehlt.length > 0) return { ok: false, grund: `Macaroon fehlt: ${fehlt.join(", ")}` };
  return { ok: true };
}
