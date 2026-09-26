/**
 * MLS in der App (Schritt 2.2b-d1): das Konto dieses Geräts – Engine,
 * Zustand und Verlauf (verschlüsselt, an die Identität gebunden) –, das eigene
 * KeyPackage, Einladungen von Kontakten und Nachrichten aus den Gruppen.
 * Gesendet wird seit d2 über `mlsSendeAn()`.
 *
 * Die Engine lädt erst bei Bedarf: beim Öffnen einer 1:1-Unterhaltung, wenn
 * das KeyPackage fällig ist, bei einer Einladung eines Kontakts oder wenn eine
 * Unterhaltung eine MLS-Gruppe hat – nie beim Start.
 *
 * Nur mit Tresor (Entscheidung vom 26.09.2026): Der Schlüssel des Zustands
 * soll nicht offen im Browser liegen. Gesperrt mit Bunker (NIP-46): Der
 * Kontobeweis (Kind 450) muss synchron signiert werden, das kann ein
 * entfernter Signer nicht.
 *
 * Als Gerät (8.6c, seit 2.2b-e1) ist das Konto der Geräteschlüssel – ein
 * eigenes Mitglied (Entscheidung 2.2b-e: A). Sein KeyPackage liegt an den
 * Schreib-Relays der Person; Geräte haben keine eigene Relay-Liste.
 */
import { schnorr } from "@noble/curves/secp256k1.js";
import { fromHex, toHex, type NostrEvent, type RelayFilter } from "@freedomstack/protocol";
import { Mls, type MlsNachricht } from "@freedomstack/mls";
import { mlsEngine } from "../mls-engine.js";
import { LS_MLS_KP, LS_MLS_PLATZ, kpErneuern, schreibRelaysVon, sucheKeyPackages, veroeffentlicheKeyPackage } from "../mls-keypackage.js";
import { empfangeGruppe, gruendeGruppe, gruppenAbos, nimmEinladungAn, schreiteFort, sendeInGruppe, type MlsEinladung, type MlsNetz } from "../mls-nostr.js";
import { MlsVerlauf, MlsZustand, mlsDatenbank, mlsSchluessel, mlsVerlaufDatenbank, type VerlaufEintrag } from "../mls-speicher.js";
import { ladeEigeneRelays } from "../relay-satz.js";
import type { GeheimSpeicher, TresorSpeicher } from "../vault.js";
import { ensurePool, frageAn, mitBunker, mitRohemSchluessel, posteingangVon, state, veroeffentlicheAn } from "./state.js";
import { geheim, tresorEingerichtet } from "./tresor.js";

/** Wem der gespeicherte Zustand gehört – für eine andere Identität wird er verworfen, nie geladen. */
export const LS_MLS_IDENTITAET = "freedom.mls.identitaet";
/** Schon bearbeitete Einladungen (Umschlag-Ids) – sonst lüde jeder Start die Engine erneut. */
export const LS_MLS_EINLADUNGEN = "freedom.mls.einladungen";

/** Warum MLS hier nicht geht – oder null. Feste Texte. */
export function mlsGesperrt(): string | null {
  if (!state.keypair || !state.signer) return "keine Identität";
  if (mitBunker()) return "mit Bunker (NIP-46) nicht möglich – der Kontobeweis braucht den Schlüssel auf diesem Gerät";
  if (!tresorEingerichtet()) return "nur mit Tresor – richte ihn in den Settings unter Sicherheit ein";
  return null;
}

/** Speicher und Netz – in der App die echten, in Tests austauschbar. */
export interface MlsUmgebung {
  zustand: () => TresorSpeicher;
  verlauf: () => TresorSpeicher;
  /** Ohne `urls`: wo die App sonst fragt (Pool). */
  frage: (filter: RelayFilter, urls?: readonly string[]) => Promise<NostrEvent[]>;
  netz: MlsNetz;
  /** Hier liegt der Schlüssel des Zustands – mit Tresor im Tresor. */
  geheim: GeheimSpeicher;
}
const APP: MlsUmgebung = {
  zustand: mlsDatenbank, verlauf: mlsVerlaufDatenbank, geheim,
  frage: async (f, urls) => (urls ? frageAn(f, urls) : (await ensurePool()).query(f)),
  netz: { sendeAn: veroeffentlicheAn, posteingang: posteingangVon },
};

interface Konto { pk: string; mls: Mls; verlauf: MlsVerlauf; sichern: () => Promise<void>; u: MlsUmgebung }
let konto: { pk: string; lauf: Promise<Konto> } | null = null;
const beiNeuem: ((gruppe: string) => void)[] = [];

async function starte(u: MlsUmgebung): Promise<Konto> {
  const pk = state.keypair!.pk;
  await mlsEngine();
  const schluessel = await mlsSchluessel(u.geheim);
  const zustand = new MlsZustand(u.zustand(), schluessel, pk);
  const verlauf = new MlsVerlauf(new MlsZustand(u.verlauf(), schluessel, pk));
  if (localStorage.getItem(LS_MLS_IDENTITAET) !== pk) {
    // Stand einer früheren Identität: verwerfen. Auch Platz und KeyPackage –
    // derselbe d-Tag unter zwei Identitäten verbände beide.
    await zustand.loeschen();
    await verlauf.loeschen();
    for (const k of [LS_MLS_PLATZ, LS_MLS_KP, LS_MLS_EINLADUNGEN]) localStorage.removeItem(k);
    localStorage.setItem(LS_MLS_IDENTITAET, pk);
  }
  await verlauf.laden();
  // Kontobeweis synchron mit dem Schlüssel dieses Geräts – nur dafür, die Kopie wird genullt
  const beweis = (id: string) => mitRohemSchluessel("MLS-Kontobeweis", (sk) => toHex(schnorr.sign(fromHex(id), sk)));
  const mls = new Mls(state.signer!, beweis, await zustand.laden());
  return { pk, mls, verlauf, sichern: () => zustand.sichern(mls.zustand()), u };
}

/** Das Konto – beim ersten Aufruf geladen; null, wenn gesperrt. */
export function mlsKonto(u: MlsUmgebung = APP): Promise<Konto> | null {
  if (mlsGesperrt()) return null;
  if (!konto || konto.pk !== state.keypair!.pk) {
    const lauf = starte(u);
    konto = { pk: state.keypair!.pk, lauf };
    lauf.catch(() => { if (konto?.lauf === lauf) konto = null; });
  }
  return konto.lauf;
}

/** Neue Nachrichten in einer Gruppe melden (die Unterhaltung neu zeichnen). */
export function mlsBeiNeuem(f: (gruppe: string) => void): void {
  beiNeuem.push(f);
}

/**
 * Wohin eigenes KeyPackage und eigene Gruppen gehen: die eigenen Relays
 * (NIP-65, 5.4a); als Gerät die Schreib-Relays der Person (2.2b-e1).
 */
async function eigeneMlsRelays(u: MlsUmgebung): Promise<string[]> {
  if (!state.person) return ladeEigeneRelays(localStorage);
  return schreibRelaysVon({ pk: state.person, abfrage: u.frage }).catch(() => []);
}

/**
 * Beim Öffnen einer 1:1-Unterhaltung: das eigene KeyPackage veröffentlichen,
 * wenn keins da oder es fällig ist – an die eigenen Relays (NIP-65, 5.4a).
 */
export async function mlsErreichbar(u: MlsUmgebung = APP): Promise<boolean> {
  if (mlsGesperrt()) return false;
  // Nach einem Wechsel der Identität gilt das gemerkte KeyPackage der alten nicht
  if (!kpErneuern(localStorage) && localStorage.getItem(LS_MLS_IDENTITAET) === state.keypair!.pk) return false;
  const eigene = await eigeneMlsRelays(u);
  if (eigene.length === 0) return false;
  const k = await mlsKonto(u)!;
  await veroeffentlicheKeyPackage({
    mls: k.mls, signer: state.signer!, speicher: localStorage, sichern: k.sichern, senden: (ev) => u.netz.sendeAn(ev, eigene),
  });
  return true;
}

const alsEintrag = (n: MlsNachricht): VerlaufEintrag => ({ id: n.id, von: n.von, text: n.text, zeit: n.zeit });

/**
 * Einladung eines Kontakts annehmen. Die Gruppe, wenn sie eine 1:1-Gruppe mit
 * ihm ist – sonst null (Gruppen zu mehreren zeigt erst 2.3).
 */
export async function mlsEinladungAnnehmen(e: MlsEinladung, u: MlsUmgebung = APP): Promise<string | null> {
  const bearbeitet = JSON.parse(localStorage.getItem(LS_MLS_EINLADUNGEN) ?? "[]") as string[];
  if (bearbeitet.includes(e.wrap.id)) return null;
  localStorage.setItem(LS_MLS_EINLADUNGEN, JSON.stringify([...bearbeitet, e.wrap.id].slice(-200)));
  const k = mlsKonto(u);
  if (!k) return null;
  const { mls, sichern, pk } = await k;
  const gruppe = await nimmEinladungAn({ mls, sichern, speicher: localStorage, einladung: e });
  const m = mls.mitglieder(gruppe);
  return m.length === 2 && m.includes(pk) && m.includes(e.von) ? gruppe : null;
}

/** Nach der Wartezeit zurückgehaltene Nachrichten zustellen. */
async function nachWartezeit(k: Konto, gruppe: string): Promise<void> {
  let neu = 0;
  const merken = async (n: MlsNachricht[]) => {
    neu = k.verlauf.nimmAuf(gruppe, n.map(alsEintrag));
    await k.verlauf.sichern();
  };
  await schreiteFort({ mls: k.mls, netz: k.u.netz, sichern: k.sichern, gruppe, merken }).catch(() => undefined);
  if (neu > 0) for (const f of beiNeuem) f(gruppe);
}

/**
 * Nachrichten der Gruppen an ihren Relays abholen (Kind 445, `#h`), in den
 * Verlauf legen – vor dem Zustand. Je Gruppe, wie viele neu sind.
 */
export async function mlsAbgleichen(gruppen: readonly string[], u: MlsUmgebung = APP): Promise<Map<string, number>> {
  const neu = new Map<string, number>();
  const kl = gruppen.length > 0 ? mlsKonto(u) : null;
  if (!kl) return neu;
  const k = await kl;
  const warten = new Map<string, number>();
  // Den Zustand (Megabytes) einmal am Ende sichern, nicht je Event; der Verlauf liegt vorher
  let geaendert = false;
  const vormerken = async () => { geaendert = true; };
  for (const abo of gruppenAbos(k.mls).filter((a) => gruppen.includes(a.gruppe))) {
    const evs = (await k.u.frage({ ...abo.filter, limit: 200 }, abo.relays)).sort((a, b) => a.created_at - b.created_at);
    let n = 0;
    const merken = async (m: MlsNachricht[]) => {
      n += k.verlauf.nimmAuf(abo.gruppe, m.map(alsEintrag));
      await k.verlauf.sichern();
    };
    for (const ev of evs) {
      const r = await empfangeGruppe({ mls: k.mls, sichern: vormerken, ev, merken }).catch(() => null);
      for (const [g, ms] of Object.entries(r?.wartezeit ?? {})) warten.set(g, ms);
    }
    neu.set(abo.gruppe, n);
  }
  if (geaendert) await k.sichern();
  for (const [g, ms] of warten) setTimeout(() => void nachWartezeit(k, g), ms + 50);
  return neu;
}

/** Verlauf einer Gruppe (zum Anzeigen). */
export async function mlsVerlauf(gruppe: string, u: MlsUmgebung = APP): Promise<VerlaufEintrag[]> {
  const k = mlsKonto(u);
  return k ? (await k).verlauf.nachrichten(gruppe) : [];
}

/**
 * 1:1 über MLS senden (2.2b-d2): in die Gruppe der Unterhaltung; gibt es
 * keine, mit dem KeyPackage des Kontakts eine gründen (Einladung an seinen
 * Posteingang). Die Gruppe, wenn die Nachricht angenommen wurde – sonst null,
 * dann sendet der Chat per NIP-17 (Kontakt ohne KeyPackage, keine eigenen
 * Relays, Einladung nicht zustellbar, kein Relay nahm an).
 */
export async function mlsSendeAn(partner: string, gruppe: string | undefined, text: string, u: MlsUmgebung = APP): Promise<string | null> {
  const kl = mlsKonto(u);
  if (!kl) return null;
  const relays = await eigeneMlsRelays(u);
  if (relays.length === 0) return null;
  const k = await kl;
  let g = gruppe && k.mls.gruppen().includes(gruppe) ? gruppe : undefined;
  if (!g) {
    for (const kp of await sucheKeyPackages({ pk: partner, abfrage: k.u.frage }).catch(() => [])) {
      // Beide sind Admin (2.2b-e): Jeder darf eigene Geräte aufnehmen und entzogene entfernen
      const r = await gruendeGruppe({ mls: k.mls, netz: k.u.netz, sichern: k.sichern, name: "", keyPackages: [kp], relays, admins: [kp.pubkey] }).catch(() => null);
      if (r && r.nichtZugestellt.length === 0) { g = r.gruppe; break; }
    }
    if (!g) return null;
  }
  if (!(await sendeInGruppe({ mls: k.mls, netz: k.u.netz, sichern: k.sichern, gruppe: g, text }))) return null;
  // Eigene Nachrichten entschlüsselt MLS nicht zurück – in den Verlauf, wie gesendet
  k.verlauf.nimmAuf(g, [{ id: `eigen:${toHex(crypto.getRandomValues(new Uint8Array(16)))}`, von: k.pk, text, zeit: Math.floor(Date.now() / 1000) }]);
  await k.verlauf.sichern();
  return g;
}
