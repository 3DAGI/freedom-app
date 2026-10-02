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
 * Schreib-Relays der Person; Geräte haben keine eigene Relay-Liste. Seit
 * 2.2b-e2 sind in einer 1:1-Gruppe beide Personen und ihre Geräte mit
 * gültiger Vollmacht – vor jedem Senden abgeglichen (`mls-geraete.ts`).
 */
import { schnorr } from "@noble/curves/secp256k1.js";
import { fromHex, toHex, type InneresEvent, type InneresSenden, type NostrEvent, type RelayFilter } from "@freedomstack/protocol";
import { ART_CHAT, Mls, type MlsNachricht } from "@freedomstack/mls";
import { mlsEngine } from "../mls-engine.js";
import { LS_MLS_KP, LS_MLS_PLATZ, kpErneuern, schreibRelaysVon, sucheKeyPackages, veroeffentlicheKeyPackage } from "../mls-keypackage.js";
import { abgleich, partnerDerGruppe, sollMitglieder, type GeraeteQuelle } from "../mls-geraete.js";
import {
  aendereGruppe, empfangeGruppe, gruendeGruppe, gruppenAbos, nimmEinladungAn, schreiteFort, sendeEventInGruppe, sendeInGruppe, setzeAdmins,
  type MlsEinladung, type MlsNetz,
} from "../mls-nostr.js";
import { MlsVerlauf, MlsZustand, mlsDatenbank, mlsSchluessel, mlsVerlaufDatenbank, type VerlaufEintrag } from "../mls-speicher.js";
import { ladeEigeneRelays } from "../relay-satz.js";
import type { GeheimSpeicher, TresorSpeicher } from "../vault.js";
import { ensurePool, frageAn, mitBunker, mitRohemSchluessel, posteingangVon, state, veroeffentlicheAn } from "./state.js";
import { geheim, tresorEingerichtet } from "./tresor.js";
import { t } from "../i18n.js";

/** Wem der gespeicherte Zustand gehört – für eine andere Identität wird er verworfen, nie geladen. */
export const LS_MLS_IDENTITAET = "freedom.mls.identitaet";
/** Schon bearbeitete Einladungen (Umschlag-Ids) – sonst lüde jeder Start die Engine erneut. */
export const LS_MLS_EINLADUNGEN = "freedom.mls.einladungen";

/** Warum MLS hier nicht geht – oder null. Feste Texte. */
export function mlsGesperrt(): string | null {
  if (!state.keypair || !state.signer) return t("bau.mlsKeineIdentitaet");
  if (mitBunker()) return t("bau.mlsBunker");
  if (!tresorEingerichtet()) return t("bau.mlsTresor");
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
  /** Vollmachten der Geräte (8.6b) – wer in eine 1:1-Gruppe gehört. */
  geraete: GeraeteQuelle;
}
// Dasselbe Buch wie im Chat (erst beim Aufruf geladen – der Chat lädt dieses Modul)
const buch = async () => (await import("./tabs/posteingang.js")).geraeteBuch;
const APP: MlsUmgebung = {
  zustand: mlsDatenbank, verlauf: mlsVerlaufDatenbank, geheim,
  geraete: { kopienFuer: async (pk) => (await buch()).kopienFuer(pk), alle: async (pk) => (await buch()).alle(pk) },
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

const alsEintrag = (n: MlsNachricht): VerlaufEintrag => ({
  id: n.id, von: n.von, text: n.text, zeit: n.zeit, inneres: n.inneres,
  ...(n.art !== ART_CHAT ? { art: n.art } : {}), ...(n.tags.length > 0 ? { tags: n.tags } : {}), ...(n.admin !== undefined ? { admin: n.admin } : {}),
});
const istChat = (e: VerlaufEintrag) => (e.art ?? ART_CHAT) === ART_CHAT;
/**
 * Alles in den Verlauf – Räume (2.3b) brauchen Kanäle und Rollen –, gezählt
 * wird nur Chat. Der 1:1-Chat zeigt nur Chat (`mlsVerlauf`).
 */
function nimmAuf(k: Konto, gruppe: string, n: MlsNachricht[]): number {
  const alle = n.map(alsEintrag);
  k.verlauf.nimmAuf(gruppe, alle.filter((e) => !istChat(e)));
  return k.verlauf.nimmAuf(gruppe, alle.filter(istChat));
}

/**
 * Einladung annehmen. Gruppe und Partner, wenn sie eine 1:1-Gruppe ist – ohne
 * Namen, alle Mitglieder gehören zu mir oder zu genau einer anderen Person
 * (mit ihren Geräten, 2.2b-e2) –, sonst `partner: null`: ein privater Raum
 * (2.3b). Räume tragen einen Namen – auch einer zu zweit ist kein 1:1-Chat.
 * null, wenn schon bearbeitet oder gesperrt.
 */
export async function mlsEinladungAnnehmen(e: MlsEinladung, u: MlsUmgebung = APP): Promise<{ gruppe: string; partner: string | null } | null> {
  const bearbeitet = JSON.parse(localStorage.getItem(LS_MLS_EINLADUNGEN) ?? "[]") as string[];
  if (bearbeitet.includes(e.wrap.id)) return null;
  localStorage.setItem(LS_MLS_EINLADUNGEN, JSON.stringify([...bearbeitet, e.wrap.id].slice(-200)));
  const k = mlsKonto(u);
  if (!k) return null;
  const { mls, sichern, pk } = await k;
  const gruppe = await nimmEinladungAn({ mls, sichern, speicher: localStorage, einladung: e });
  if (mls.name(gruppe).trim()) return { gruppe, partner: null };
  const partner = await partnerDerGruppe(mls.mitglieder(gruppe), state.person ?? pk, pk, u.geraete).catch(() => null);
  return { gruppe, partner: partner ?? null };
}

/** Nach der Wartezeit zurückgehaltene Nachrichten zustellen. */
async function nachWartezeit(k: Konto, gruppe: string): Promise<void> {
  let neu = 0;
  const merken = async (n: MlsNachricht[]) => {
    neu = nimmAuf(k, gruppe, n);
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
      n += nimmAuf(k, abo.gruppe, m);
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

/** Verlauf einer 1:1-Gruppe (zum Anzeigen) – nur Chat. */
export async function mlsVerlauf(gruppe: string, u: MlsUmgebung = APP): Promise<VerlaufEintrag[]> {
  const k = mlsKonto(u);
  return k ? (await k).verlauf.nachrichten(gruppe).filter(istChat) : [];
}

// ------------------------------------------------------------ Räume (2.3b)

/** Stand einer Raum-Gruppe: alle inneren Events, heutige Admins und Mitglieder, ich. */
export async function mlsGruppenStand(gruppe: string, u: MlsUmgebung = APP): Promise<{ ereignisse: InneresEvent[]; admins: string[]; mitglieder: string[]; ich: string } | null> {
  const kl = mlsKonto(u);
  if (!kl) return null;
  const k = await kl;
  if (!k.mls.gruppen().includes(gruppe)) return null;
  const ereignisse = k.verlauf.nachrichten(gruppe).map((e): InneresEvent => ({
    id: e.inneres ?? e.id, von: e.von, art: e.art ?? ART_CHAT, tags: e.tags ?? [], text: e.text, zeit: e.zeit, ...(e.admin !== undefined ? { admin: e.admin } : {}),
  }));
  return { ereignisse, admins: k.mls.admins(gruppe), mitglieder: k.mls.mitglieder(gruppe), ich: k.pk };
}

/** Eine Gruppe nur mit mir gründen – ein neuer privater Raum – an meinen Relays. */
export async function mlsGruende(name: string, u: MlsUmgebung = APP): Promise<string | null> {
  const kl = mlsKonto(u);
  if (!kl) return null;
  const relays = await eigeneMlsRelays(u);
  if (relays.length === 0) return null;
  const k = await kl;
  const r = await gruendeGruppe({ mls: k.mls, netz: k.u.netz, sichern: k.sichern, name, keyPackages: [], relays }).catch(() => null);
  return r?.gruppe ?? null;
}

/** Inneres Event in die Gruppe; eigene entschlüsselt MLS nicht zurück – darum gleich in den Verlauf. */
export async function mlsSendeEvent(gruppe: string, s: InneresSenden, u: MlsUmgebung = APP): Promise<boolean> {
  const kl = mlsKonto(u);
  if (!kl) return false;
  const k = await kl;
  const inneres = await sendeEventInGruppe({ mls: k.mls, netz: k.u.netz, sichern: k.sichern, gruppe, ...s }).catch(() => null);
  if (!inneres) return false;
  k.verlauf.nimmAuf(gruppe, [{
    id: `eigen:${inneres}`, inneres, von: k.pk, text: s.text, zeit: Math.floor(Date.now() / 1000),
    ...(s.art !== ART_CHAT ? { art: s.art } : {}), ...(s.tags.length > 0 ? { tags: s.tags } : {}),
  }]);
  await k.verlauf.sichern();
  return true;
}

/** Ergebnis einer Einladung – Kennungen; angezeigt über `einladungsText()` (raum-mls.ts). */
export type EinladungsErgebnis = "eingeladen" | "kein Admin" | "kein KeyPackage" | "nicht zugestellt"; // kein UI-Text

/** Jemanden einladen (nur als Admin): KeyPackage und Posteingang nötig; nicht zugestellt → wieder entfernen. */
export async function mlsLadeEin(gruppe: string, pk: string, u: MlsUmgebung = APP): Promise<EinladungsErgebnis> {
  const kl = mlsKonto(u);
  if (!kl || !HEX64.test(pk)) return "kein KeyPackage"; // kein UI-Text
  const k = await kl;
  if (!k.mls.admins(gruppe).includes(k.pk)) return "kein Admin"; // kein UI-Text
  const a: Ablauf = { mls: k.mls, netz: k.u.netz, sichern: k.sichern };
  const kps = await vorbereiten([pk], new Map([[pk, pk]]), a, u);
  if (!kps) return "kein KeyPackage"; // kein UI-Text
  const r = await aendereGruppe({ ...a, gruppe, einladen: kps }).catch(() => null);
  return r?.angenommen && (await ohneUnzugestellte(a, gruppe, r.nichtZugestellt)) ? "eingeladen" : "nicht zugestellt"; // kein UI-Text
}

/** Mitglied entfernen (nur als Admin): ein Commit – danach liest es nichts mehr (neuer Schlüssel). */
export async function mlsEntferne(gruppe: string, pk: string, u: MlsUmgebung = APP): Promise<boolean> {
  const kl = mlsKonto(u);
  if (!kl || !HEX64.test(pk)) return false;
  const k = await kl;
  if (!k.mls.admins(gruppe).includes(k.pk) || !k.mls.mitglieder(gruppe).includes(pk) || pk === k.pk) return false;
  const r = await aendereGruppe({ mls: k.mls, netz: k.u.netz, sichern: k.sichern, gruppe, entfernen: [pk] }).catch(() => null);
  return !!r?.angenommen;
}

/** Moderatoren (Admins der Gruppe) neu setzen – ein Commit; nur als Admin. */
export async function mlsSetzeAdmins(gruppe: string, admins: string[], u: MlsUmgebung = APP): Promise<boolean> {
  const kl = mlsKonto(u);
  if (!kl) return false;
  const k = await kl;
  if (!k.mls.admins(gruppe).includes(k.pk)) return false;
  return setzeAdmins({ mls: k.mls, netz: k.u.netz, sichern: k.sichern, gruppe, admins }).catch(() => false);
}

/** Ergebnis von `mlsSendeAn`: die Gruppe der Unterhaltung (auch wenn es diesmal NIP-17 war) und ob die Nachricht über MLS ging. */
export interface MlsSendung {
  gruppe?: string;
  gesendet: boolean;
}

type Ablauf = { mls: Mls; netz: MlsNetz; sichern: () => Promise<void> };
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Je Mitglied ein KeyPackage – Geräte an den Schreib-Relays ihrer Person –
 * und ein Posteingang für die Einladung. Fehlt eins: null (dann NIP-17, damit
 * jedes Gerät die Nachricht bekommt).
 */
async function vorbereiten(mitglieder: readonly string[], soll: ReadonlyMap<string, string>, a: Ablauf, u: MlsUmgebung): Promise<NostrEvent[] | null> {
  const kps: NostrEvent[] = [];
  for (const m of mitglieder) {
    const person = soll.get(m)!;
    const [kp] = await sucheKeyPackages({ pk: m, ...(person !== m ? { listeVon: person } : {}), abfrage: u.frage }).catch(() => []);
    if (!kp || (await a.netz.posteingang(m).catch(() => [])).length === 0) return null;
    kps.push(kp);
  }
  return kps;
}

/** Nicht zugestellte Einladungen: wieder entfernen – Mitglied ist nur, wer seine Einladung bekam. */
async function ohneUnzugestellte(a: Ablauf, gruppe: string, offen: readonly string[]): Promise<boolean> {
  if (offen.length === 0) return true;
  await aendereGruppe({ ...a, gruppe, entfernen: offen.filter((m) => HEX64.test(m)) }).catch(() => undefined);
  return false;
}

/**
 * Gruppe mit dem Soll abgleichen (2.2b-e2): entzogene und fremde Mitglieder
 * entfernen, fehlende einladen (als Admin). true, wenn danach genau das Soll
 * Mitglied ist.
 */
async function gleicheAb(a: Ablauf, gruppe: string, soll: ReadonlyMap<string, string>, ich: string, u: MlsUmgebung): Promise<boolean> {
  const { fehlen, zuViel } = abgleich(a.mls.mitglieder(gruppe), soll);
  if (fehlen.length === 0 && zuViel.length === 0) return true;
  if (!a.mls.admins(gruppe).includes(ich)) return false;
  if (zuViel.length > 0 && !(await aendereGruppe({ ...a, gruppe, entfernen: zuViel }).catch(() => null))?.angenommen) return false;
  if (fehlen.length === 0) return true;
  const kps = await vorbereiten(fehlen, soll, a, u);
  if (!kps) return false;
  const r = await aendereGruppe({ ...a, gruppe, einladen: kps, admins: fehlen }).catch(() => null);
  return !!r?.angenommen && (await ohneUnzugestellte(a, gruppe, r.nichtZugestellt));
}

/**
 * 1:1 über MLS senden (2.2b-d2): in die Gruppe der Unterhaltung; gibt es
 * keine, eine gründen. Mitglieder sind beide Personen und ihre Geräte mit
 * gültiger Vollmacht, alle Admin (2.2b-e2); Einladungen an Geräte gehen an den
 * Posteingang ihrer Person. Vor dem Senden wird die Gruppe abgeglichen.
 * `gesendet: false` – dann sendet der Chat per NIP-17: gesperrt, keine
 * eigenen Relays, ein Mitglied ohne KeyPackage oder Posteingang, Einladung
 * nicht zustellbar, nicht Admin, kein Relay nahm an, als Gerät ohne gültige
 * Vollmacht.
 */
export async function mlsSendeAn(partner: string, gruppe: string | undefined, text: string, u: MlsUmgebung = APP): Promise<MlsSendung> {
  const kl = mlsKonto(u);
  if (!kl) return { gesendet: false };
  const relays = await eigeneMlsRelays(u);
  if (relays.length === 0) return { gesendet: false };
  const k = await kl;
  const soll = await sollMitglieder(state.person ?? k.pk, partner, u.geraete).catch(() => null);
  if (!soll?.has(k.pk)) return { gesendet: false };
  // Einladungen an Geräte gehen an den Posteingang ihrer Person
  const netz: MlsNetz = { sendeAn: (ev, urls) => k.u.netz.sendeAn(ev, urls), posteingang: (pk) => k.u.netz.posteingang(soll.get(pk) ?? pk) };
  const a: Ablauf = { mls: k.mls, netz, sichern: k.sichern };
  let g = gruppe && k.mls.gruppen().includes(gruppe) ? gruppe : undefined;
  if (g) {
    if (!(await gleicheAb(a, g, soll, k.pk, u))) return { gruppe: g, gesendet: false };
  } else {
    const andere = [...soll.keys()].filter((m) => m !== k.pk);
    const kps = await vorbereiten(andere, soll, a, u);
    if (!kps) return { gesendet: false };
    // Alle sind Admin: Jede Seite darf eigene Geräte aufnehmen und entzogene entfernen
    const r = await gruendeGruppe({ ...a, name: "", keyPackages: kps, relays, admins: andere }).catch(() => null);
    if (!r) return { gesendet: false };
    g = r.gruppe;
    if (!(await ohneUnzugestellte(a, g, r.nichtZugestellt))) return { gruppe: g, gesendet: false };
  }
  if (!(await sendeInGruppe({ ...a, gruppe: g, text }))) return { gruppe: g, gesendet: false };
  // Eigene Nachrichten entschlüsselt MLS nicht zurück – in den Verlauf, wie gesendet
  k.verlauf.nimmAuf(g, [{ id: `eigen:${toHex(crypto.getRandomValues(new Uint8Array(16)))}`, von: k.pk, text, zeit: Math.floor(Date.now() / 1000) }]);
  await k.verlauf.sichern();
  return { gruppe: g, gesendet: true };
}
