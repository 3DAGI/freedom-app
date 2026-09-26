/**
 * KeyPackages nach Marmot (Schritt 2.2b-c): Wer eingeladen werden will,
 * veröffentlicht ein KeyPackage (Kind 30443, von der eigenen Identität) an
 * seine Schreib-Relays aus NIP-65 (Kind 10002); wer einlädt, liest dort.
 *
 * - Platz: der d-Tag, einmal aus 32 Zufallsbytes, bleibt für dieses Gerät
 *   gleich – ein neues KeyPackage ersetzt das alte im selben Platz. Nie aus
 *   Schlüsseln abgeleitet (Marmot, KeyPackage publication).
 * - Erneuern: wenn keins veröffentlicht ist, nach einer angenommenen
 *   Einladung (verbraucht) und nach 30 Tagen (gültig sind höchstens 84).
 * - Auswahl: nur Events in der Form nach Marmot, je Platz das neueste, dann
 *   das neueste, bei Gleichstand das kleinere `i` (KeyPackageRef). Die Engine
 *   prüft beim Einladen den Inhalt (Lebensdauer, Kontobeweis, Fähigkeiten).
 */
import { KIND_KEY_PACKAGE, type Mls } from "@freedomstack/mls";
import { KIND_RELAY_LIST, schreibRelays, toHex, verifyEvent, type NostrEvent, type RelayFilter, type Signer } from "@freedomstack/protocol";

export const LS_MLS_PLATZ = "freedom.mls.platz";
/** Zuletzt veröffentlichtes eigenes KeyPackage: `{ id, zeit }`. */
export const LS_MLS_KP = "freedom.mls.kp";
export const KP_ERNEUERN_S = 30 * 86_400;

type Speicher = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const HEX64 = /^[0-9a-f]{64}$/;
const KOMPONENTE = /^0x[0-9a-f]{4}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})+(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const ID_LISTEN = ["mls_ciphersuite", "mls_extensions", "mls_proposals", "app_components"];

/** d-Tag dieses Geräts – beim ersten Mal zufällig erzeugt. */
export function kpPlatz(s: Speicher): string {
  const da = s.getItem(LS_MLS_PLATZ);
  if (da && HEX64.test(da)) return da;
  const neu = toHex(crypto.getRandomValues(new Uint8Array(32)));
  s.setItem(LS_MLS_PLATZ, neu);
  return neu;
}

const wert = (ev: NostrEvent, name: string): string | undefined => ev.tags.find((t) => t[0] === name)?.[1];

/** Form nach Marmot (Nostr-Transport, KeyPackage publication) – vom angegebenen Autor, gültig signiert. */
export function kpGueltig(ev: NostrEvent, autor: string): boolean {
  if (ev.kind !== KIND_KEY_PACKAGE || ev.pubkey !== autor || !verifyEvent(ev)) return false;
  const tags = (name: string) => ev.tags.filter((t) => t[0] === name);
  const einzeln = (name: string, form: RegExp) => tags(name).length === 1 && form.test(tags(name)[0]![1] ?? "");
  if (!einzeln("d", HEX64) || !einzeln("i", HEX64) || !einzeln("mls_protocol_version", /^1\.0$/)) return false;
  for (const name of ID_LISTEN) {
    const t = tags(name);
    if (t.length !== 1) return false;
    const ids = t[0]!.slice(1);
    if (ids.length === 0 || new Set(ids).size !== ids.length || !ids.every((w) => KOMPONENTE.test(w))) return false;
  }
  return tags("mls_ciphersuite")[0]!.includes("0x0001") && tags("app_components")[0]!.includes("0x8009") && BASE64.test(ev.content);
}

/** Kandidaten eines Kontos, der beste zuerst. */
export function waehleKeyPackages(events: readonly NostrEvent[], autor: string): NostrEvent[] {
  const jePlatz = new Map<string, NostrEvent>();
  for (const ev of events) {
    if (!kpGueltig(ev, autor)) continue;
    const alt = jePlatz.get(wert(ev, "d")!);
    if (!alt || ev.created_at > alt.created_at || (ev.created_at === alt.created_at && ev.id < alt.id)) jePlatz.set(wert(ev, "d")!, ev);
  }
  return [...jePlatz.values()].sort((a, b) => b.created_at - a.created_at || (wert(a, "i")! < wert(b, "i")! ? -1 : 1));
}

/** Muss das eigene KeyPackage (neu) veröffentlicht werden? */
export function kpErneuern(s: Pick<Storage, "getItem">, jetzt = Math.floor(Date.now() / 1000)): boolean {
  try {
    const { zeit } = JSON.parse(s.getItem(LS_MLS_KP) ?? "null") as { zeit: number };
    return !(typeof zeit === "number" && jetzt - zeit < KP_ERNEUERN_S && zeit <= jetzt + 3600);
  } catch {
    return true;
  }
}

/** Eine Einladung hat das KeyPackage verbraucht – beim nächsten Mal ein neues. */
export function kpVerbraucht(s: Pick<Storage, "removeItem">): void {
  s.removeItem(LS_MLS_KP);
}

/**
 * Eigenes KeyPackage erzeugen und veröffentlichen. `sichern` legt den Zustand
 * ab, BEVOR es jemand sieht – sonst gäbe es ein KeyPackage, dessen privater
 * Teil verloren sein kann. `senden` stellt es an die eigenen Schreib-Relays zu
 * (Anzahl, die annahmen).
 */
export async function veroeffentlicheKeyPackage(p: {
  mls: Mls; signer: Signer; speicher: Speicher;
  sichern: () => Promise<void>; senden: (ev: NostrEvent) => Promise<number>;
}): Promise<NostrEvent> {
  const ev = await p.signer.signEvent(await p.mls.keyPackage(kpPlatz(p.speicher)));
  await p.sichern();
  if ((await p.senden(ev)) === 0) throw new Error("KeyPackage: kein Relay nahm es an");
  p.speicher.setItem(LS_MLS_KP, JSON.stringify({ id: ev.id, zeit: ev.created_at }));
  return ev;
}

type Abfrage = (filter: RelayFilter, urls?: readonly string[]) => Promise<NostrEvent[]>;

/** Schreib-Relays eines Kontos aus seiner neuesten NIP-65-Liste (geprüft); leer ohne Liste. */
export async function schreibRelaysVon(p: { pk: string; abfrage: Abfrage }): Promise<string[]> {
  const listen = await p.abfrage({ kinds: [KIND_RELAY_LIST], authors: [p.pk], limit: 5 });
  const liste = listen.filter((e) => e.kind === KIND_RELAY_LIST && e.pubkey === p.pk && verifyEvent(e))
    .sort((a, b) => b.created_at - a.created_at)[0];
  return schreibRelays(liste);
}

/**
 * KeyPackages eines Kontakts suchen: seine NIP-65-Liste lesen, an deren
 * Schreib-Relays Kind 30443 abfragen (ohne Liste: wo `abfrage` sonst sucht).
 * Für ein Gerät (2.2b-e2): `listeVon` ist die Person – Geräte haben keine
 * eigene Liste, ihr KeyPackage liegt an den Schreib-Relays der Person.
 */
export async function sucheKeyPackages(p: { pk: string; listeVon?: string; abfrage: Abfrage }): Promise<NostrEvent[]> {
  const urls = await schreibRelaysVon({ pk: p.listeVon ?? p.pk, abfrage: p.abfrage });
  const evs = await p.abfrage({ kinds: [KIND_KEY_PACKAGE], authors: [p.pk], limit: 20 }, urls.length > 0 ? urls : undefined);
  return waehleKeyPackages(evs, p.pk);
}
