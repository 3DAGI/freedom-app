/**
 * Mesh: Store-and-Forward mit Kurier-Belohnung (dezentral, kein Betreiber).
 *
 * Modell: Ein Nutzer will eine Nachricht (oder sats/SOL-Zahlung) an jemanden
 * ohne direkte Verbindung zustellen. Ein KURIER transportiert das Paket
 * (USB-Stick, Bluetooth, QR). Beim Empfang erzeugt der Empfaenger ein
 * signiertes DELIVERY-RECEIPT — der Beweis, dass der Kurier zugestellt hat.
 * Der Kurier loest das Receipt ein und bekommt die Belohnung aus dem Escrow.
 *
 * KEIN Topf: die Belohnung kommt aus der Nachrichten-Fee, die der Sender
 * beim Erstellen des Pakets in ein HTLC lockt. Empfaenger-Receipt (preimage)
 * oeffnet die Auszahlung an den Kurier. Non-custodial, on-chain erzwungen.
 *
 * Kinds:
 *   38030  MESH_PACKET    — zu transportierendes Paket (payload + reward + escrow)
 *   38031  DELIVERY_RECEIPT — Empfaenger-Bestätigung (oeffnet Kurier-Belohnung)
 */
import { UnsignedEvent, NostrEvent, buildEvent, getTag } from "./event.js";
import { KIND_MESH_PACKET, KIND_DELIVERY_RECEIPT } from "./kinds.js";

export interface MeshPacket {
  /** Paket-ID (d-tag). */
  packetId: string;
  /** Empfaenger-pubkey (wer das Paket bekommen soll). */
  recipientPubkey: string;
  /** Kurier-Belohnung in msat (aus Escrow beim Receipt). */
  rewardMsat: number;
  /** swap_id des Reward-HTLC (Sender lockt, Kurier claimt mit preimage). */
  rewardSwapId: string;
  /** Das eigentliche Paket (verschluesseltes Nostr-Event als JSON-string). */
  payload: string;
  /** Ablauf (Unix-Sekunden) — danach refunded der Sender die Belohnung. */
  expiryUnix: number;
}

export interface DeliveryReceipt {
  /** Paket-ID, das zugestellt wurde. */
  packetId: string;
  /** Kurier-pubkey, der zugestellt hat. */
  courierPubkey: string;
  /** HTLC-preimage (hex) — oeffnet die Kurier-Belohnung. */
  preimageHex: string;
}

export function buildMeshPacket(p: MeshPacket, senderPubkey: string): UnsignedEvent {
  return buildEvent(
    senderPubkey,
    KIND_MESH_PACKET,
    [
      ["d", p.packetId],
      ["p", p.recipientPubkey],
      ["reward_msat", String(p.rewardMsat)],
      ["reward_swap", p.rewardSwapId],
      ["expiry", String(p.expiryUnix)],
    ],
    p.payload,
  );
}

export function parseMeshPacket(ev: UnsignedEvent): MeshPacket {
  if (ev.kind !== KIND_MESH_PACKET) throw new Error(`kein Mesh-Paket: kind ${ev.kind}`);
  const req = (n: string) => {
    const v = getTag(ev, n);
    if (!v) throw new Error(`Mesh-Paket ohne ${n}`);
    return v;
  };
  return {
    packetId: req("d"),
    recipientPubkey: req("p"),
    rewardMsat: Number(req("reward_msat")),
    rewardSwapId: req("reward_swap"),
    payload: ev.content,
    expiryUnix: Number(req("expiry")),
  };
}

export function buildDeliveryReceipt(r: DeliveryReceipt, recipientPubkey: string): UnsignedEvent {
  return buildEvent(
    recipientPubkey,
    KIND_DELIVERY_RECEIPT,
    [
      ["d", r.packetId],
      ["courier", r.courierPubkey],
      ["preimage", r.preimageHex],
    ],
    "",
  );
}

export function parseDeliveryReceipt(ev: UnsignedEvent): DeliveryReceipt {
  if (ev.kind !== KIND_DELIVERY_RECEIPT) throw new Error(`kein Receipt: kind ${ev.kind}`);
  const req = (n: string) => {
    const v = getTag(ev, n);
    if (!v) throw new Error(`Receipt ohne ${n}`);
    return v;
  };
  return { packetId: req("d"), courierPubkey: req("courier"), preimageHex: req("preimage") };
}

/** Konsistenz-Check: Receipt gehoert zum Paket, nicht abgelaufen. */
export function receiptMatchesPacket(receipt: DeliveryReceipt, packet: MeshPacket, now = Math.floor(Date.now() / 1000)): boolean {
  if (receipt.packetId !== packet.packetId) return false;
  if (now > packet.expiryUnix) return false; // abgelaufen -> Sender refundet
  return true;
}
