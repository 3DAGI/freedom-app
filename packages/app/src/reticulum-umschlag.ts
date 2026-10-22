/**
 * Reticulum als zweiter Funkweg (Sammlung B-32, Entscheidungen RN-W1–W5 A, `docs/RETICULUM-ENTWURF.md`) – die
 * Bausteine ohne Netz und ohne Gerät: die eigene Identität und der Umschlag in einer LXMF-Nachricht (B-32a).
 *
 * Über Reticulum geht dasselbe wie über Meshtastic: nur, was `pruefeMeshInhalt()` durchlässt (Umschläge nach NIP-59,
 * voll signierte Solana-Transaktionen). LXMF trägt es als Daten der App – `FIELD_CUSTOM_TYPE` (0xFB) = `RETICULUM_ART`,
 * `FIELD_CUSTOM_DATA` (0xFC) = Art (1 Byte, `MeshKind`) + Nutzlast; Titel und Inhalt bleiben leer. Was jemand lesen
 * könnte, ist schon verschlüsselt; Reticulum verschlüsselt auf dem Weg zusätzlich an den Empfänger (B-32b).
 *
 * Die Identität (64 Byte wie in der Python-Referenz: X25519 und Ed25519 privat) liegt nur in `geheim`
 * (`freedom.reticulum.identitaet`), nie in der Sicherung, nie im Export. Die Bibliothek lädt erst bei Bedarf.
 */
import { MeshKind, pruefeMeshInhalt, type MeshPruefung } from "@freedomstack/protocol";
import type { Identity } from "@reticulum/core";
import type { Message } from "@reticulum/lxmf/src/message.js";

export const LS_RETICULUM_IDENTITAET = "freedom.reticulum.identitaet";
/** Kennung der Daten in `FIELD_CUSTOM_TYPE` – eine andere Form hieße eine neue Fassung. */
export const RETICULUM_ART = "freedom/mesh-1";
/** Höchstens so viel Nutzlast je Nachricht (wie ein NIP-44-Klartext) und so viel mit LXMF darum. */
export const RETICULUM_GRENZEN = Object.freeze({ nutzlast: 65_535, draht: 65_535 + 1024 });

/** Warum etwas nicht ging – die App zeigt es ab B-32b über die Kennung, nie über die Meldung. */
export type ReticulumFall = "identitaet-kaputt" | "adresse" | "zu-gross" | "inhalt" | "sendezeit";

export class ReticulumFehler extends Error {
  constructor(readonly fall: ReticulumFall, readonly pruefung?: Extract<MeshPruefung, { ok: false }>) {
    super(`Reticulum: ${fall}`); // kein UI-Text
    this.name = "ReticulumFehler";
  }
}

const FIELD_CUSTOM_TYPE = 0xfb;
const FIELD_CUSTOM_DATA = 0xfc;
const HEX128 = /^[0-9a-f]{128}$/;

interface Speicher {
  getItem(k: string): string | null;
  setItem(k: string, v: string): Promise<void>;
}

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const ausHex = (h: string): Uint8Array => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
const core = () => import("@reticulum/core");
const lxmf = () => import("@reticulum/lxmf/src/message.js");

/**
 * Die eigene Identität: gelesen aus `geheim`, sonst neu und dort gemerkt. Ein kaputter Eintrag wird nie ersetzt –
 * sonst wäre die Adresse still eine andere.
 */
export async function reticulumIdentitaet(speicher: Speicher): Promise<Identity> {
  const { Identity } = await core();
  const da = speicher.getItem(LS_RETICULUM_IDENTITAET);
  if (da !== null) {
    if (!HEX128.test(da)) throw new ReticulumFehler("identitaet-kaputt");
    const geladen = await Identity.fromPrivateKey(ausHex(da));
    if (!geladen) throw new ReticulumFehler("identitaet-kaputt");
    return geladen;
  }
  const neu = await Identity.generate();
  await speicher.setItem(LS_RETICULUM_IDENTITAET, hex(await neu.getPrivateKey()));
  return neu;
}

/** Die LXMF-Adresse einer Identität (`lxmf.delivery`, 16 Byte) – an sie stellt Reticulum zu. */
export async function lxmfAdresse(identitaet: Identity): Promise<Uint8Array> {
  const { Destination, Direction } = await core();
  const d = await Destination.SINGLE("lxmf.delivery", Direction.IN, identitaet);
  if (!d.destinationHash) throw new ReticulumFehler("adresse");
  return d.destinationHash;
}

/**
 * Nutzlast für Reticulum einpacken: erst `pruefeMeshInhalt()` (mit den eigenen Schlüsseln – die eigene DM-Kopie geht
 * nie hinaus), dann eine LXMF-Nachricht von `von` an `an`, signiert mit der eigenen Identität.
 */
export async function verpackeFuerReticulum(p: {
  payload: Uint8Array; kind: MeshKind; von: Identity; an: Uint8Array; eigeneSchluessel: readonly string[];
}): Promise<Uint8Array> {
  return (await (await baueReticulumNachricht(p)).serialize(p.von)).wireData;
}

/** Die LXMF-Nachricht selbst – geprüft wie `verpackeFuerReticulum()`; der Router (B-32b2) serialisiert sie beim Senden. */
export async function baueReticulumNachricht(p: {
  payload: Uint8Array; kind: MeshKind; von: Identity; an: Uint8Array; eigeneSchluessel: readonly string[];
}): Promise<Message> {
  if (p.an.length !== 16) throw new ReticulumFehler("adresse");
  if (p.payload.length > RETICULUM_GRENZEN.nutzlast) throw new ReticulumFehler("zu-gross");
  const pruefung = pruefeMeshInhalt(p.payload, p.kind, { eigeneSchluessel: p.eigeneSchluessel });
  if (!pruefung.ok) throw new ReticulumFehler("inhalt", pruefung);
  const { Message } = await lxmf();
  const daten = new Uint8Array(1 + p.payload.length);
  daten[0] = p.kind;
  daten.set(p.payload, 1);
  return new Message({
    sourceHash: await lxmfAdresse(p.von), destinationHash: p.an, title: "", content: "",
    // Zahlen als Schlüssel (wie die Python-Referenz) – ein Objekt machte daraus Text
    fields: new Map<number, unknown>([[FIELD_CUSTOM_TYPE, RETICULUM_ART], [FIELD_CUSTOM_DATA, daten]]),
  });
}

/**
 * Eine LXMF-Nachricht an die eigene Adresse auspacken – nur `RETICULUM_ART`, nur was `pruefeMeshInhalt()` durchlässt;
 * sonst null. Nur die direkte Form (Ziel, Absender, Signatur, Inhalt): Ohne Ziel am Anfang nähme die Bibliothek die
 * Nachricht als „opportunistisch“ und setzte die eigene Adresse ein – auch für eine fremde. Die Signatur des Absenders
 * prüft erst B-32b (aus seiner Bekanntgabe); der Umschlag darin ist ohnehin signiert.
 */
export async function entpackeAusReticulum(wire: Uint8Array, eigeneAdresse: Uint8Array): Promise<{ kind: MeshKind; payload: Uint8Array } | null> {
  if (eigeneAdresse.length !== 16 || wire.length < 16 + 16 + 64 + 1 || wire.length > RETICULUM_GRENZEN.draht) return null;
  if (hex(wire.subarray(0, 16)) !== hex(eigeneAdresse)) return null;
  const { Message } = await lxmf();
  let m: Awaited<ReturnType<typeof Message.deserialize>>;
  try {
    m = await Message.deserialize(wire, eigeneAdresse);
  } catch {
    return null;
  }
  return leseReticulumFelder(m.fields);
}

/**
 * Die Daten der App aus den Feldern einer LXMF-Nachricht – nur `RETICULUM_ART`, nur was `pruefeMeshInhalt()`
 * durchlässt; sonst null. Für Nachrichten, die der Router (B-32b2) schon ausgepackt hat.
 */
export function leseReticulumFelder(felder: unknown): { kind: MeshKind; payload: Uint8Array } | null {
  if (typeof felder !== "object" || felder === null) return null;
  // der Decoder liefert Schlüssel als Text oder Zahl, je nach Herkunft
  const f = felder as Map<unknown, unknown> | Record<string, unknown>;
  const feld = (k: number): unknown => (f instanceof Map ? f.get(k) ?? f.get(String(k)) : f[String(k)]);
  const daten = feld(FIELD_CUSTOM_DATA);
  if (feld(FIELD_CUSTOM_TYPE) !== RETICULUM_ART || !(daten instanceof Uint8Array) || daten.length < 2) return null;
  if (daten.length - 1 > RETICULUM_GRENZEN.nutzlast) return null;
  const kind = daten[0] as MeshKind;
  const payload = daten.slice(1);
  return pruefeMeshInhalt(payload, kind).ok ? { kind, payload } : null;
}
