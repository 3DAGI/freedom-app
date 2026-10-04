/**
 * Anrufe (Sammlung B-13d2, Entscheidungen T1 A, T2 A, T3 B): WebRTC nur über
 * einen Vermittler (TURN, `iceTransportPolicy: "relay"`), Aufbau nur
 * versiegelt (`baueAnrufNachricht()`, an die Person und ihre Geräte, an deren
 * Posteingang). Nur mit Kontakten.
 *
 * - Anrufen braucht den eigenen Vermittler (gekoppelter Knoten, 5079). Sein
 *   kurzlebiger Zugang reist im Angebot mit (T3 B): Hat die Angerufene keinen
 *   eigenen, nimmt sie ihn – dann sieht der Knoten der Anruferin ihre IP, und
 *   die App sagt das vor dem Annehmen (`fremderVermittler`).
 * - Hinaus geht nur, was `nurRelaySdp()`/`sendbarerKandidat()` durchlässt.
 * - Eingehende Angebote kommen mit dem Posteingang (`alsAnruf()` am Ende der
 *   Kette in `oeffneUmschlag()`) und – damit es sofort klingelt (B-13e, T4 A) –
 *   über ein Abo an den eigenen Schlüssel, solange die App offen ist
 *   (`lauscheAufAnrufe()`); daraus nur, was `vielleichtAnruf()` durchlässt.
 *
 * Die Oberfläche (B-13d3) hört über `beiAnruf()` zu; hier nur Zustand und Verbindung.
 */
import {
  KIND_DVM_TURN, LocalSigner, baueAnrufNachricht, baueTurnAnfrage, generateKeypair, leseTurnZugang, neueAnrufKennung,
  oeffneAnrufNachricht, type AnrufNachricht, type EndeGrund, type Medium, type NostrEvent, type TurnZugang,
} from "@freedomstack/protocol";
import {
  type Anruf, type AnrufEreignis, eingehendesAngebot, iceServerAus, naechsterZustand, nurRelaySdp, sendbarerKandidat, vielleichtAnruf,
  waehleVermittler,
} from "../anruf-ablauf.js";
import { STATUS_TAKT_MS, STATUS_ZEIT_MS } from "../knoten-status-ansicht.js";
import { powFuerKnoten } from "./knoten-status-ui.js";
import { warteAufKnoten, wegZumKnoten } from "./knoten-weg-ui.js";
import { meineKopplung } from "./mein-knoten.js";
import { ensurePool, state } from "./state.js";

/** Was die Oberfläche zeigt – Medien nur als Ströme, kein Text aus dem Netz. */
export interface AnrufAnsicht { anruf: Anruf | null; lokal: MediaStream | null; entfernt: MediaStream | null }

let anruf: Anruf | null = null;
let angebot: Extract<AnrufNachricht, { typ: "angebot" }> | null = null;
let pc: RTCPeerConnection | null = null;
let lokal: MediaStream | null = null;
let entfernt: MediaStream | null = null;
let wartendeKandidaten: RTCIceCandidateInit[] = [];
let abo: { fuer: string; stopp: () => void } | null = null;
let takt: ReturnType<typeof setInterval> | null = null;
const zuhoerer = new Set<(a: AnrufAnsicht) => void>();

const jetzt = () => Math.floor(Date.now() / 1000);

/** Die Oberfläche hört zu – zurück eine Funktion zum Abmelden. */
export function beiAnruf(f: (a: AnrufAnsicht) => void): () => void {
  zuhoerer.add(f);
  return () => zuhoerer.delete(f);
}

function melde(): void {
  for (const f of zuhoerer) f({ anruf, lokal, entfernt });
}

function ereignis(e: AnrufEreignis): void {
  if (!anruf) return;
  const vorher = anruf.phase;
  anruf = naechsterZustand(anruf, e);
  if (anruf.phase === "beendet" && vorher !== "beendet") raeumeAuf();
  melde();
}

/** Verbindung, Medien, Abo und Takt weg – der Zustand „beendet“ bleibt zum Anzeigen. */
function raeumeAuf(): void {
  pc?.close();
  pc = null;
  for (const t of lokal?.getTracks() ?? []) t.stop();
  lokal = null;
  entfernt = null;
  wartendeKandidaten = [];
  angebot = null;
  if (takt) clearInterval(takt);
  takt = null;
}

/** Ist dieser Schlüssel (Person) ein Kontakt? Nur mit Kontakten wird telefoniert. */
async function istKontakt(person: string): Promise<boolean> {
  const { conversations } = await import("./tabs/kommunikation.js");
  return conversations.some((c) => c.type === "dm" && c.id === person);
}

/** Zugang zum eigenen Vermittler – versiegelt mit Nachweis über den Weg aus B-9c2; null ohne Knoten oder Antwort. */
export async function eigenerTurnZugang(): Promise<TurnZugang | null> {
  const k = meineKopplung();
  if (!k) return null;
  const powBits = await powFuerKnoten(k.knoten);
  const sitzung = new LocalSigner(generateKeypair().sk);
  const weg = await wegZumKnoten(k.knoten, sitzung);
  if (!weg) return null;
  try {
    const { wrap, requestId } = await baueTurnAnfrage({ sitzung, kopplung: k, powBits });
    await weg.publish(wrap);
    const a = await warteAufKnoten(weg, sitzung, requestId, KIND_DVM_TURN + 1000, STATUS_ZEIT_MS, STATUS_TAKT_MS);
    return a && "ergebnis" in a ? leseTurnZugang(a.ergebnis) : null;
  } finally {
    weg.schliesse();
  }
}

/** An die Person und ihre Geräte, an deren Posteingang – je Empfänger ein Umschlag (B-13c). */
async function sende(partner: string, n: AnrufNachricht): Promise<void> {
  // rufeAn() und nimmAn() fangen es und melden „fehler“ – der Satz erscheint nie
  if (!state.signer) throw new Error("keine Identität"); // kein UI-Text
  const { geraeteBuch, veroeffentlicheDm } = await import("./tabs/posteingang.js");
  const geraete = await geraeteBuch.kopienFuer(partner).catch(() => []);
  const wraps = await baueAnrufNachricht({ von: state.signer, an: [partner, ...geraete], nachricht: n });
  // Ein Anruf ist jetzt oder nie: sofort hinaus, nicht über versendeVerzoegert() (das gilt für Chat-Nachrichten)
  await Promise.all(wraps.map((w) => veroeffentlicheDm(w, partner)));
}

/**
 * Solange die App offen ist: ein Abo an den eigenen Schlüssel (B-13e, T4 A), damit Angebot, Antwort und
 * Kandidaten sofort ankommen. Entschlüsselt wird nur, was am Umschlag wie ein Anruf aussieht – Chat-Nachrichten
 * kommen weiter mit dem Abgleich des Posteingangs. Gelingt das Abo nicht, versucht der nächste Aufruf es neu.
 */
export async function lauscheAufAnrufe(): Promise<void> {
  const ich = state.signer?.publicKey();
  if (!ich || abo?.fuer === ich) return;
  abo?.stopp();
  abo = null;
  const pool = await ensurePool();
  const stopp = await pool.subscribe({ kinds: [1059], "#p": [ich], since: jetzt() - 60 }, (w) => {
    if (vielleichtAnruf(w, jetzt())) void alsAnruf(w);
  }).catch(() => null);
  if (stopp) abo = { fuer: ich, stopp };
}

function starteTakt(): void {
  takt ??= setInterval(() => ereignis({ art: "takt", jetzt: jetzt() }), 1000);
}

/** Verbindung nur über den Vermittler; Kandidaten nur vom Typ relay hinaus. */
function neueVerbindung(zugang: TurnZugang, partner: string, kennung: string): RTCPeerConnection {
  const v = new RTCPeerConnection({ iceServers: [iceServerAus(zugang)], iceTransportPolicy: "relay" });
  v.onicecandidate = (e) => {
    const n = e.candidate ? sendbarerKandidat(kennung, e.candidate) : null;
    if (n) void sende(partner, n).catch(() => undefined);
  };
  v.ontrack = (e) => {
    entfernt = e.streams[0] ?? new MediaStream([e.track]);
    melde();
  };
  v.onconnectionstatechange = () => {
    if (v.connectionState === "connected") ereignis({ art: "verbunden", jetzt: jetzt() });
    if (v.connectionState === "failed") void legeAuf("fehler");
  };
  return v;
}

async function medien(m: readonly Medium[]): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: true, video: m.includes("video") });
}

async function wendeKandidatenAn(): Promise<void> {
  if (!pc?.remoteDescription) return;
  for (const k of wartendeKandidaten.splice(0)) await pc.addIceCandidate(k).catch(() => undefined);
}

/**
 * Anrufen – nur Kontakte, nur mit eigenem Vermittler. Zurück null oder eine
 * Kennung, warum nicht (die Oberfläche macht Text daraus).
 */
export async function rufeAn(partner: string, m: Medium[]): Promise<null | "laeuft" | "kein-kontakt" | "kein-vermittler" | "fehler"> {
  if (anruf && anruf.phase !== "beendet") return "laeuft";
  if (!(await istKontakt(partner))) return "kein-kontakt";
  const zugang = await eigenerTurnZugang();
  if (!zugang) return "kein-vermittler";
  const kennung = neueAnrufKennung();
  anruf = { kennung, partner, richtung: "aus", medien: m, phase: "klingelt", fremderVermittler: false, seit: jetzt() };
  melde();
  try {
    lokal = await medien(m);
    pc = neueVerbindung(zugang, partner, kennung);
    for (const t of lokal.getTracks()) pc.addTrack(t, lokal);
    const o = await pc.createOffer();
    await pc.setLocalDescription(o);
    const sdp = nurRelaySdp(o.sdp ?? "");
    if (!sdp) throw new Error("sdp");
    await lauscheAufAnrufe();
    // Der eigene Zugang reist mit (T3 B) – die Angerufene nimmt ihn nur ohne eigenen Vermittler
    await sende(partner, { anruf: kennung, typ: "angebot", sdp, medien: m, turn: zugang });
    starteTakt();
    melde();
    return null;
  } catch {
    ereignis({ art: "ende", grund: "fehler", jetzt: jetzt() });
    return "fehler";
  }
}

/** Annehmen: eigener Vermittler zuerst, sonst der aus dem Angebot (davor hat die Oberfläche gewarnt). */
export async function nimmAn(): Promise<boolean> {
  if (!anruf || anruf.phase !== "eingehend" || !angebot) return false;
  const { partner, kennung } = anruf;
  const v = waehleVermittler(await eigenerTurnZugang(), angebot.turn);
  if (!v) {
    await legeAuf("fehler");
    return false;
  }
  ereignis({ art: "angenommen", jetzt: jetzt() });
  try {
    lokal = await medien(anruf.medien);
    pc = neueVerbindung(v.zugang, partner, kennung);
    for (const t of lokal.getTracks()) pc.addTrack(t, lokal);
    await pc.setRemoteDescription({ type: "offer", sdp: angebot.sdp });
    await wendeKandidatenAn();
    const a = await pc.createAnswer();
    await pc.setLocalDescription(a);
    const sdp = nurRelaySdp(a.sdp ?? "");
    if (!sdp) throw new Error("sdp");
    await sende(partner, { anruf: kennung, typ: "antwort", sdp });
    melde();
    return true;
  } catch {
    await legeAuf("fehler");
    return false;
  }
}

/** Auflegen oder ablehnen – dem Gegenüber Bescheid geben, dann alles weg. */
export async function legeAuf(grund: EndeGrund = "aufgelegt"): Promise<void> {
  const a = anruf;
  if (!a || a.phase === "beendet") return;
  ereignis({ art: "ende", grund, jetzt: jetzt() });
  await sende(a.partner, { anruf: a.kennung, typ: "ende", grund }).catch(() => undefined);
}

/** Nach dem Anzeigen des Endes: vergessen. */
export function vergissAnruf(): void {
  if (anruf?.phase !== "beendet") return;
  anruf = null;
  melde();
}

/**
 * Am Ende der Kette in `oeffneUmschlag()` (und aus dem Abo `lauscheAufAnrufe()`):
 * eine Anruf-Nachricht annehmen. Im Chat erscheint nichts – immer null.
 */
export async function alsAnruf(w: NostrEvent): Promise<null> {
  if (!state.signer) return null;
  const r = await oeffneAnrufNachricht(w, state.signer);
  if (!r) return null;
  // Für wen spricht der Absender? Ein gültiges Gerät eines Kontakts zählt als der Kontakt
  const { geraeteBuch } = await import("./tabs/posteingang.js");
  const z = await geraeteBuch.zuordnen(r.von, jetzt(), () => false).catch(() => null);
  const person = z?.gueltig ? z.person : r.von;
  const n = r.nachricht;
  if (n.typ === "angebot") {
    if (anruf?.kennung === n.anruf) return null; // dasselbe Angebot an ein zweites eigenes Gerät
    const was = eingehendesAngebot({ vonKontakt: await istKontakt(person), laufend: anruf });
    if (was === "besetzt") await sende(person, { anruf: n.anruf, typ: "ende", grund: "besetzt" }).catch(() => undefined);
    if (was !== "klingeln") return null;
    angebot = n;
    wartendeKandidaten = [];
    const eigenerMoeglich = meineKopplung() !== null;
    anruf = { kennung: n.anruf, partner: person, richtung: "ein", medien: n.medien, phase: "eingehend", fremderVermittler: !eigenerMoeglich && !!n.turn, seit: jetzt() };
    await lauscheAufAnrufe();
    starteTakt();
    melde();
    return null;
  }
  // Alles andere nur zum laufenden Anruf, nur vom Gegenüber
  if (!anruf || anruf.kennung !== n.anruf || anruf.partner !== person) return null;
  if (n.typ === "antwort" && anruf.richtung === "aus" && pc && !pc.remoteDescription) {
    await pc.setRemoteDescription({ type: "answer", sdp: n.sdp }).catch(() => void legeAuf("fehler"));
    ereignis({ art: "antwort", jetzt: jetzt() });
    await wendeKandidatenAn();
  } else if (n.typ === "kandidat") {
    wartendeKandidaten.push(n.kandidat);
    await wendeKandidatenAn();
  } else if (n.typ === "ende") {
    ereignis({ art: "ende", grund: n.grund, jetzt: jetzt() });
  }
  return null;
}
