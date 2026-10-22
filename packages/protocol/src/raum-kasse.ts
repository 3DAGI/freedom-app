/**
 * Kasse im Raum (A-12b1, `docs/KASSE-ENTWURF.md` V3–V5, `docs/PROTOCOL.md` §42).
 *
 * Wer Mitglied der Kasse werden darf, sagt der Raum (Recht „kasse“, W4); wer es ist, sagt die
 * Kette (`leseKassenStand()`). Die Kasse steht in der Definition des Raums (Tag `kasse`,
 * `buildSpace()`/`raumDefinition()`): offen nur in der des Gründers (`raumZustandFuer()`), privat
 * nur in der eines Admins (`gruppenRaum()`).
 *
 * Jedes Mitglied nennt dem Raum seine Adresse für die Kasse (V4: eine eigene je Raum, nie die
 * Hauptadresse) – Kind 34704, offen an die Adresse des Raums, privat nur als inneres Event der
 * Gruppe. Damit niemand eine fremde Adresse als seine ausgibt, trägt die Meldung einen Nachweis:
 * Die Adresse signiert (Ed25519) „freedomstack-kasse-v1:<ort>:<schlüssel>“ – Ort ist die Adresse
 * des offenen Raums oder `mls:<gruppe>` (`kassenOrt()`).
 *
 * Abweichungen (V3) nur über `kassenAbweichungen()`: ein Recht ohne Mitgliedschaft, eine
 * Mitgliedschaft ohne Recht. Es zählt immer die Kette – die App zeigt sie nur an.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { address, getAddressDecoder, getAddressEncoder, isAddress } from "@solana/kit";
import { buildEvent, type NostrEvent, type UnsignedEvent } from "./event.js";
import type { KassenMitglied } from "./kasse.js";
import type { InneresEvent, InneresSenden } from "./raum-gruppe.js";
import { can, KANAL_GRENZEN, leseRaumAdresse, type SpaceState } from "./spaces.js";

/** Adresse eines Mitglieds für die Kasse des Raums – offen an die Adresse des Raums, privat inneres Event. */
export const KIND_KASSEN_ADRESSE = 34704;
/** Das Recht im Raum, Mitglied der Kasse zu werden (W4). */
export const RAUM_KASSEN_RECHT = "kasse" as const;

const PRAEFIX = "freedomstack-kasse-v1";
const HEX64 = /^[0-9a-f]{64}$/;
const GRUPPE_HEX = /^[0-9a-f]{32,64}$/;
const SIGNATUR = /^[0-9a-f]{128}$/;
const text = new TextEncoder();

/** Ort für den Nachweis: die Adresse eines offenen Raums, sonst eine Gruppe (`mls:<gruppe>`). */
export function kassenOrt(raumOderGruppe: string): string {
  if (leseRaumAdresse(raumOderGruppe)) return raumOderGruppe;
  if (GRUPPE_HEX.test(raumOderGruppe)) return `mls:${raumOderGruppe}`;
  throw new Error("weder Raum-Adresse noch Gruppe");
}

/** Was die Adresse signiert – lesbarer Text, damit eine Wallet ihn zeigen kann. */
export function kassenNachweisNachricht(ort: string, pubkey: string): Uint8Array {
  if (!HEX64.test(pubkey)) throw new Error("Schlüssel ungültig");
  return text.encode(`${PRAEFIX}:${ort}:${pubkey}`);
}

/** Nachweis mit dem geheimen Schlüssel der Adresse (32 Byte, hält und nullt der Aufrufer). */
export function signiereKassenAdresse(ort: string, pubkey: string, geheim: Uint8Array): { adresse: string; nachweis: string } {
  const adresse = getAddressDecoder().decode(ed25519.getPublicKey(geheim));
  return { adresse, nachweis: bytesToHex(ed25519.sign(kassenNachweisNachricht(ort, pubkey), geheim)) };
}

/** Hat die Adresse genau diesem Schlüssel für genau diesen Ort zugestimmt? */
export function pruefeKassenNachweis(ort: string, pubkey: string, adresse: string, nachweis: string): boolean {
  if (!isAddress(adresse) || !SIGNATUR.test(nachweis) || !HEX64.test(pubkey)) return false;
  try {
    return ed25519.verify(hexToBytes(nachweis), kassenNachweisNachricht(ort, pubkey), Uint8Array.from(getAddressEncoder().encode(address(adresse))));
  } catch {
    return false;
  }
}

/** Meldung im offenen Raum – `raum` ist dessen Adresse (`raumAdresse()`). */
export function baueKassenAdresse(p: { autor: string; raum: string; adresse: string; nachweis: string; createdAt?: number }): UnsignedEvent {
  const r = leseRaumAdresse(p.raum);
  if (!r) throw new Error("Raum-Adresse ungültig");
  if (!pruefeKassenNachweis(p.raum, p.autor, p.adresse, p.nachweis)) throw new Error("Nachweis der Adresse ungültig");
  return buildEvent(p.autor, KIND_KASSEN_ADRESSE, [
    ["d", `kasse:${r.spaceId}`], ["space", r.spaceId], ["a", p.raum], ["sol", p.adresse, p.nachweis],
  ], "", p.createdAt);
}

/** Meldung im privaten Raum – nur als inneres Event der Gruppe, nie offen. */
export function raumKassenAdresse(gruppe: string, adresse: string, nachweis: string): InneresSenden {
  if (!GRUPPE_HEX.test(gruppe) || !isAddress(adresse) || !SIGNATUR.test(nachweis)) throw new Error("Meldung unvollständig");
  return { art: KIND_KASSEN_ADRESSE, tags: [["d", `kasse:${gruppe}`], ["space", gruppe], ["sol", adresse, nachweis]], text: "" };
}

/** Die Tags einer Definition mit dieser Kasse (A-12b2b): ein altes `kasse` fällt weg, alles andere bleibt. */
export function mitKassenTag(tags: readonly (readonly string[])[], adresse: string): string[][] {
  if (!isAddress(adresse)) throw new Error("Adresse der Kasse ungültig");
  return [...tags.filter((t) => t[0] !== "kasse").map((t) => [...t]), ["kasse", adresse]];
}

interface Meldung { id: string; von: string; zeit: number; tags: string[][] }

/**
 * Je Schlüssel die neueste Meldung; sie zählt nur mit gültigem Nachweis. Eine Adresse, die mehrere
 * nennen, gilt für keinen – sonst entschiede die Reihenfolge, wem ein Mitglied der Kette gehört.
 */
function auswerten(ort: string, meldungen: readonly Meldung[], jetzt: number): Map<string, string> {
  const neueste = new Map<string, Meldung>();
  for (const m of meldungen) {
    if (!HEX64.test(m.von) || m.zeit > jetzt + KANAL_GRENZEN.zukunft) continue;
    const alt = neueste.get(m.von);
    if (!alt || m.zeit > alt.zeit || (m.zeit === alt.zeit && m.id > alt.id)) neueste.set(m.von, m);
  }
  const adressen = new Map<string, string>();
  for (const [pk, m] of neueste) {
    const sol = m.tags.find((t) => t[0] === "sol");
    if (sol && pruefeKassenNachweis(ort, pk, sol[1] ?? "", sol[2] ?? "")) adressen.set(pk, sol[1]!);
  }
  const zahl = new Map<string, number>();
  for (const a of adressen.values()) zahl.set(a, (zahl.get(a) ?? 0) + 1);
  return new Map([...adressen].filter(([, a]) => zahl.get(a) === 1));
}

/** Adressen der Mitglieder eines offenen Raums (Schlüssel → Adresse): nur Meldungen an genau diese Adresse. */
export function kassenAdressenOffen(raum: string, events: readonly NostrEvent[], jetzt = Math.floor(Date.now() / 1000)): Map<string, string> {
  const r = leseRaumAdresse(raum);
  if (!r) return new Map();
  const tag = (e: NostrEvent, n: string) => e.tags.find((t) => t[0] === n)?.[1];
  const passend = events.filter((e) => e.kind === KIND_KASSEN_ADRESSE && tag(e, "a") === raum && tag(e, "d") === `kasse:${r.spaceId}`);
  return auswerten(raum, passend.map((e) => ({ id: e.id, von: e.pubkey, zeit: e.created_at, tags: e.tags })), jetzt);
}

/** Adressen der Mitglieder eines privaten Raums aus den inneren Events der Gruppe (MLS belegt den Absender). */
export function kassenAdressenPrivat(gruppe: string, ereignisse: readonly InneresEvent[], jetzt = Math.floor(Date.now() / 1000)): Map<string, string> {
  if (!GRUPPE_HEX.test(gruppe)) return new Map();
  const tag = (e: InneresEvent, n: string) => e.tags.find((t) => t[0] === n)?.[1];
  const passend = ereignisse.filter((e) => e.art === KIND_KASSEN_ADRESSE && tag(e, "space") === gruppe);
  return auswerten(kassenOrt(gruppe), passend.map((e) => ({ id: e.id, von: e.von, zeit: e.zeit, tags: e.tags })), jetzt);
}

/** Wer im Raum das Recht „kasse“ hat – der Gründer offener Räume, Admins privater immer. */
export function mitKassenRecht(zustand: SpaceState): string[] {
  const alle = new Set([...(zustand.ownerPubkey ? [zustand.ownerPubkey] : []), ...zustand.grants.keys()]);
  return [...alle].filter((pk) => HEX64.test(pk) && can(pk, RAUM_KASSEN_RECHT, zustand)).sort();
}

export interface KassenAbweichungen {
  /** Recht „kasse“, aber nicht Mitglied auf der Kette – ohne `adresse`, wenn er keine genannt hat. */
  rechtOhneMitgliedschaft: { pubkey: string; adresse?: string }[];
  /** Mitglied auf der Kette ohne Recht „kasse“ – ohne `pubkey`, wenn niemand im Raum die Adresse nennt. */
  mitgliedschaftOhneRecht: { adresse: string; pubkey?: string }[];
}

/** Abweichungen zwischen Raum und Kette (V3). `mitglieder` nur aus `leseKassenStand()`. */
export function kassenAbweichungen(p: { mitglieder: readonly KassenMitglied[]; adressen: ReadonlyMap<string, string>; zustand: SpaceState }): KassenAbweichungen {
  const aufKette = new Set(p.mitglieder.map((m) => m.adresse));
  const wer = new Map([...p.adressen].map(([pk, a]) => [a, pk]));
  const rechtOhneMitgliedschaft = mitKassenRecht(p.zustand)
    .filter((pk) => !aufKette.has(p.adressen.get(pk) ?? ""))
    .map((pk) => (p.adressen.has(pk) ? { pubkey: pk, adresse: p.adressen.get(pk)! } : { pubkey: pk }));
  const mitgliedschaftOhneRecht = p.mitglieder
    .filter((m) => { const pk = wer.get(m.adresse); return !pk || !can(pk, RAUM_KASSEN_RECHT, p.zustand); })
    .map((m) => (wer.has(m.adresse) ? { adresse: m.adresse, pubkey: wer.get(m.adresse)! } : { adresse: m.adresse }));
  return { rechtOhneMitgliedschaft, mitgliedschaftOhneRecht };
}
