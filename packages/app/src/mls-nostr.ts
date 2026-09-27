/**
 * MLS über Nostr (Schritt 2.2b-c2): Einladungen, Gruppennachrichten, Abos –
 * nach dem Nostr-Transport von Marmot.
 *
 * - Gruppennachrichten (Kind 445) gehen an die Relays der Gruppe (Routing aus
 *   der Engine), abonniert mit `#h`. Ein Commit wird an die Relays der Epoche
 *   gesendet, in der er entstand – das Routing wird vorher festgehalten.
 * - Einladungen (Kind 1059 → Siegel → Kind 444) gehen an den Posteingang des
 *   Eingeladenen (Kind 10050) – erst, wenn der Commit angenommen ist, sonst
 *   käme jemand in eine Epoche, die es nie gab.
 * - Nach jeder Änderung wird der Zustand gesichert (`sichern`), bevor jemand
 *   von außen etwas davon sieht.
 * - Eine Einladung annehmen verbraucht das eigene KeyPackage (neu veröffentlichen).
 */
import type { Mls, MlsEmpfang, MlsNachricht, MlsSenden } from "@freedomstack/mls";
import { KIND_GIFT_WRAP, giftUnwrapMitSigner, type NostrEvent, type RelayFilter, type Signer } from "@freedomstack/protocol";
import { kpVerbraucht } from "./mls-keypackage.js";

export const KIND_WELCOME = 444;

export interface MlsNetz {
  /** An genau diese Relays senden; Anzahl, die annahmen. */
  sendeAn(ev: NostrEvent, urls: readonly string[]): Promise<number>;
  /** Posteingang (Kind 10050) eines Kontos; leer, wenn keiner bekannt ist. */
  posteingang(pk: string): Promise<string[]>;
}

interface Ablauf {
  mls: Mls;
  netz: MlsNetz;
  /** Zustand verschlüsselt ablegen (MlsZustand.sichern mit mls.zustand()). */
  sichern: () => Promise<void>;
}

const empfaengerVon = (wrap: NostrEvent): string | undefined => wrap.tags.find((t) => t[0] === "p")?.[1];

/** Einladungen an den Posteingang ihres Empfängers; wem keine zugestellt werden konnte. */
async function zustellen(netz: MlsNetz, einladungen: readonly NostrEvent[]): Promise<string[]> {
  const offen: string[] = [];
  for (const wrap of einladungen) {
    const pk = empfaengerVon(wrap);
    const ziele = pk ? await netz.posteingang(pk) : [];
    if (!pk || ziele.length === 0 || (await netz.sendeAn(wrap, ziele)) === 0) offen.push(pk ?? "?");
  }
  return offen;
}

/**
 * Gruppe gründen und die ersten Mitglieder einladen. `admins`: welche
 * Eingeladenen wie der Gründer einladen und entfernen dürfen (2.2b-e) – ohne
 * Angabe nur der Gründer.
 */
export async function gruendeGruppe(p: Ablauf & { name: string; keyPackages: NostrEvent[]; relays: string[]; admins?: string[] }):
  Promise<{ gruppe: string; nichtZugestellt: string[] }> {
  const g = await p.mls.gruppeAnlegen(p.name, p.keyPackages, p.relays, p.admins);
  await p.sichern();
  return { gruppe: g.gruppe, nichtZugestellt: await zustellen(p.netz, g.einladungen) };
}

/** Events eines Sendevorgangs an die Relays der Gruppe; bestätigt, wenn mindestens eins annahm. */
async function veroeffentliche(p: Ablauf, relays: readonly string[], s: MlsSenden): Promise<boolean> {
  let angenommen = true;
  for (const ev of s.events) angenommen = (await p.netz.sendeAn(ev, relays)) > 0 && angenommen;
  if (s.ausstehend) {
    if (angenommen) await p.mls.bestaetigt(s.ausstehend);
    else await p.mls.gescheitert(s.ausstehend);
  }
  await p.sichern();
  return angenommen;
}

/** Textnachricht in die Gruppe. */
export async function sendeInGruppe(p: Ablauf & { gruppe: string; text: string }): Promise<boolean> {
  const { relays } = p.mls.routing(p.gruppe);
  const s = await p.mls.senden(p.gruppe, p.text);
  await p.sichern();
  return veroeffentliche(p, relays, s);
}

/**
 * Inneres Event (Art, Tags) in die Gruppe – Räume (2.3): Kanalnachricht,
 * Rollenliste, Moderation. Ergebnis: die Id des inneren Events, wenn ein Relay
 * annahm, sonst null.
 */
export async function sendeEventInGruppe(p: Ablauf & { gruppe: string; art: number; tags: string[][]; text: string }): Promise<string | null> {
  const { relays } = p.mls.routing(p.gruppe);
  const s = await p.mls.sendenEvent(p.gruppe, p.art, p.tags, p.text);
  await p.sichern();
  return (await veroeffentliche(p, relays, s)) ? s.inneres ?? null : null;
}

/**
 * Mitglieder einladen oder entfernen (nur als Admin): Commit an die Relays der
 * alten Epoche; erst wenn er angenommen ist, gehen Einladungen hinaus. Nicht
 * angenommen → verworfen (`gescheitert`), niemand wird eingeladen.
 */
export async function aendereGruppe(p: Ablauf & { gruppe: string } & ({ einladen: NostrEvent[]; admins?: string[] } | { entfernen: string[] })):
  Promise<{ angenommen: boolean; nichtZugestellt: string[] }> {
  const { relays } = p.mls.routing(p.gruppe);
  const s = "einladen" in p ? await p.mls.einladen(p.gruppe, p.einladen, p.admins) : await p.mls.entfernen(p.gruppe, p.entfernen);
  await p.sichern();
  const angenommen = await veroeffentliche(p, relays, s);
  return { angenommen, nichtZugestellt: angenommen ? await zustellen(p.netz, s.einladungen) : [] };
}

/** Admins neu setzen (Räume, 2.3b: Moderatoren) – ein Commit wie beim Entfernen, nur als Admin. */
export async function setzeAdmins(p: Ablauf & { gruppe: string; admins: string[] }): Promise<boolean> {
  const { relays } = p.mls.routing(p.gruppe);
  const s = await p.mls.adminsSetzen(p.gruppe, p.admins);
  await p.sichern();
  return veroeffentliche(p, relays, s);
}

/** Abos für alle Gruppen: Kind 445 mit `#h` an deren Relays. */
export function gruppenAbos(mls: Mls): { gruppe: string; filter: RelayFilter; relays: string[] }[] {
  return mls.gruppen().map((gruppe) => {
    const r = mls.routing(gruppe);
    return { gruppe, filter: { kinds: [445], "#h": [r.h] } as RelayFilter, relays: r.relays };
  });
}

/**
 * Nachrichten ablegen, BEVOR der Zustand gesichert wird (2.2b-d1): Eine
 * MLS-Nachricht lässt sich nur einmal entschlüsseln. Geht zwischen beidem
 * etwas verloren, stellt die Engine sie aus dem älteren Zustand erneut zu.
 */
export type Merken = (nachrichten: MlsNachricht[]) => Promise<void>;

/**
 * Gruppennachricht empfangen. Nachrichten vor ihrem Commit hält die Engine
 * zurück; `wartezeit` sagt, wann `fortschreiten` sie zustellt.
 */
export async function empfangeGruppe(p: { mls: Mls; sichern: () => Promise<void>; ev: NostrEvent; merken?: Merken }):
  Promise<MlsEmpfang & { wartezeit?: Record<string, number> }> {
  const r = await p.mls.empfangen(p.ev);
  if (r.nachrichten.length > 0) await p.merken?.(r.nachrichten);
  if (r.nachrichten.length > 0 || r.geaendert.length > 0 || r.ergebnis !== "Ignored") await p.sichern();
  const wartezeit: Record<string, number> = {};
  for (const g of p.mls.gruppen()) {
    const w = p.mls.wartezeit(g);
    if (w !== undefined) wartezeit[g] = w;
  }
  return Object.keys(wartezeit).length > 0 ? { ...r, wartezeit } : r;
}

/**
 * Nach der Wartezeit fortschreiten: zurückgehaltene Nachrichten zustellen;
 * was die Engine dabei selbst sendet (etwa einen Commit), geht an die Relays
 * der Gruppe. Aufrufen, wenn `wartezeit` aus `empfangeGruppe` abgelaufen ist.
 */
export async function schreiteFort(p: Ablauf & { gruppe: string; merken?: Merken }): Promise<MlsEmpfang> {
  const { relays } = p.mls.routing(p.gruppe);
  const r = await p.mls.fortschreiten(p.gruppe);
  if (r.nachrichten.length > 0) await p.merken?.(r.nachrichten);
  await p.sichern();
  if (r.events.length > 0) await veroeffentliche(p, relays, { events: r.events, ausstehend: r.ausstehend, einladungen: [] });
  return { ergebnis: r.ergebnis, nachrichten: r.nachrichten, geaendert: r.geaendert };
}

export interface MlsEinladung {
  /** Wer einlädt (aus dem Siegel, nicht aus dem Umschlag). */
  von: string;
  /** Relays, an denen die Gruppe liest (Angabe des Einladenden). */
  relays: string[];
  wrap: NostrEvent;
}

/**
 * Ist dieser Umschlag eine MLS-Einladung? Öffnet ihn über den Signer; nur
 * Kind 444 mit e- und relays-Tag zählt. Alles andere (z. B. NIP-17) → null.
 */
export async function oeffneEinladung(wrap: NostrEvent, signer: Signer): Promise<MlsEinladung | null> {
  if (wrap.kind !== KIND_GIFT_WRAP || empfaengerVon(wrap) !== signer.publicKey()) return null;
  const u = await giftUnwrapMitSigner(wrap, signer);
  if (!u.ok || !u.inner || !u.senderPubkey || u.inner.kind !== KIND_WELCOME) return null;
  const e = u.inner.tags.filter((t) => t[0] === "e");
  const relays = u.inner.tags.find((t) => t[0] === "relays")?.slice(1) ?? [];
  if (e.length !== 1 || !/^[0-9a-f]{64}$/.test(e[0]![1] ?? "") || relays.length === 0) return null;
  return { von: u.senderPubkey, relays, wrap };
}

/** Einladung annehmen: beitreten, KeyPackage gilt als verbraucht, Zustand sichern. */
export async function nimmEinladungAn(p: { mls: Mls; sichern: () => Promise<void>; speicher: Pick<Storage, "removeItem">; einladung: MlsEinladung }):
  Promise<string> {
  const gruppe = await p.mls.beitreten(p.einladung.wrap);
  kpVerbraucht(p.speicher);
  await p.sichern();
  return gruppe;
}
