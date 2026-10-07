/**
 * Neue Oberfläche prüfen (6.1a2, Entscheidung N2): Gibt es eine neuere
 * freedom.html, die k vertraute Signierer bestätigen – und ist eine
 * heruntergeladene Datei genau diese?
 *
 * Die Desktop-Hülle (`packages/launcher`) tauscht ihre Oberfläche erst aus, wenn
 * diese Prüfung ein Angebot ergibt, der Nutzer zustimmt und die Hülle dieselben
 * Belege selbst noch einmal geprüft hat (6.1a3). Im Browser nennt die App damit
 * die neuere Version und woher sie kommt.
 *
 * Regeln:
 * - Es zählen nur Release-Manifeste (Kind 38054) mit gültiger Signatur von
 *   Schlüsseln aus der Liste der vertrauten Signierer. Ein einzelner gestohlener
 *   Schlüssel reicht nie (k von n, `RELEASE_MIN_SIGNATUREN`).
 * - Dieselbe Version heißt: dieselbe Versionsangabe und dieselben Dateien
 *   (Name, Prüfsumme, Größe). Quellen und Notizen dürfen je Signierer abweichen.
 * - Als Zeitpunkt einer Version gilt der früheste der Signierer – ein einzelner
 *   kann sie nicht neuer machen, als die anderen sagen.
 * - Angeboten wird nur, was neuer ist als die laufende Fassung; ist die laufende
 *   selbst bestätigt, zählt ihr Zeitpunkt. Nie eine ältere.
 * - Quellen nur über https ohne Zugangsdaten – heruntergeladen wird im Webview,
 *   geprüft wird jede Datei vor dem Installieren (`pruefeDatei()`).
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { type NostrEvent, verifyEvent } from "./event.js";
import { KIND_RELEASE_MANIFEST, RELEASE_MIN_SIGNATUREN, type ReleaseManifest, parseReleaseManifest } from "./release.js";

/** Die Datei der Oberfläche im Release-Manifest. */
export const OBERFLAECHE_DATEI = "freedom.html";

/** Grenzen: wie viele Manifeste geprüft werden, wie groß die Datei, wie viele Quellen. */
export const UPDATE_GRENZEN = { manifeste: 200, bytes: 32 * 1024 * 1024, quellen: 8 } as const;

const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,31}$/;
const DATEINAME = /^[A-Za-z0-9._-]{1,64}$/;

export interface UpdateAngebot {
  version: string;
  /** Frühester Zeitpunkt der Signierer (Unix-Sekunden). */
  releasedAt: number;
  sha256: string;
  sizeBytes: number;
  /** Bezugsquellen über https – aus den bestätigenden Manifesten. */
  quellen: string[];
  /** Je Signierer ein Manifest, nach Schlüssel sortiert – die Hülle prüft sie selbst noch einmal. */
  belege: NostrEvent[];
}

export type UpdateFall = "kein-manifest" | "zu-wenig" | "aktuell";

export type UpdateErgebnis =
  | { angebot: UpdateAngebot }
  | { fall: UpdateFall; noetig: number; bestaetigt?: number };

/** Die laufende Fassung: ihre Prüfsumme und, falls bekannt (Hülle), wann sie erschien. */
export interface Laufend {
  sha256: string;
  releasedAt?: number;
}

interface Gruppe {
  manifest: ReleaseManifest;
  /** Je Signierer das neueste Manifest dieser Version. */
  je: Map<string, { ev: NostrEvent; m: ReleaseManifest }>;
}

function gueltig(m: ReleaseManifest): boolean {
  if (!VERSION.test(m.version) || !Number.isSafeInteger(m.releasedAt) || m.releasedAt <= 0) return false;
  const namen = new Set<string>();
  for (const a of m.artifacts) {
    if (!DATEINAME.test(a.name) || namen.has(a.name)) return false;
    if (!Number.isSafeInteger(a.sizeBytes) || a.sizeBytes <= 0 || a.sizeBytes > UPDATE_GRENZEN.bytes) return false;
    namen.add(a.name);
  }
  return namen.has(OBERFLAECHE_DATEI);
}

/** Schlüssel einer Version: Versionsangabe und Dateien – Reihenfolge nach Name (Bytes, nicht Sprache). */
function versionsSchluessel(m: ReleaseManifest): string {
  const dateien = [...m.artifacts]
    .sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0))
    .map((a) => [a.name, a.sha256, a.sizeBytes]);
  return JSON.stringify([m.version, dateien]);
}

function html(m: ReleaseManifest) {
  return m.artifacts.find((a) => a.name === OBERFLAECHE_DATEI)!;
}

function httpsQuelle(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "https:" && !u.username && !u.password && u.hostname.length > 0;
  } catch {
    return false;
  }
}

/** Gibt es eine neuere, von k vertrauten Signierern bestätigte Oberfläche? */
export function suchUpdate(events: NostrEvent[], vertraut: string[], laufend: Laufend, k = RELEASE_MIN_SIGNATUREN): UpdateErgebnis {
  const anker = new Set(vertraut);
  const kandidaten = events
    .filter((e) => e.kind === KIND_RELEASE_MANIFEST && anker.has(e.pubkey))
    .slice(0, UPDATE_GRENZEN.manifeste)
    .filter((e) => verifyEvent(e));

  const gruppen = new Map<string, Gruppe>();
  for (const ev of kandidaten) {
    let m: ReleaseManifest;
    try {
      m = parseReleaseManifest(ev);
    } catch {
      continue;
    }
    if (!gueltig(m)) continue;
    const schluessel = versionsSchluessel(m);
    const g = gruppen.get(schluessel) ?? { manifest: m, je: new Map() };
    const bisher = g.je.get(ev.pubkey);
    if (!bisher || ev.created_at > bisher.ev.created_at) g.je.set(ev.pubkey, { ev, m });
    gruppen.set(schluessel, g);
  }

  const zeit = (g: Gruppe) => Math.min(...[...g.je.values()].map((x) => x.m.releasedAt));
  const bestaetigt = [...gruppen.values()].filter((g) => g.je.size >= k);
  if (bestaetigt.length === 0) {
    if (gruppen.size === 0) return { fall: "kein-manifest", noetig: k };
    return { fall: "zu-wenig", noetig: k, bestaetigt: Math.max(...[...gruppen.values()].map((g) => g.je.size)) };
  }

  const neueste = bestaetigt.reduce((a, b) => {
    const za = zeit(a), zb = zeit(b);
    if (za !== zb) return zb > za ? b : a;
    return html(b.manifest).sha256 > html(a.manifest).sha256 ? b : a;
  });
  const datei = html(neueste.manifest);
  const eigene = laufend.sha256.toLowerCase();
  if (datei.sha256 === eigene) return { fall: "aktuell", noetig: k, bestaetigt: neueste.je.size };

  const laufendeGruppe = bestaetigt.find((g) => html(g.manifest).sha256 === eigene);
  const laufendSeit = laufend.releasedAt ?? (laufendeGruppe ? zeit(laufendeGruppe) : undefined);
  if (laufendSeit !== undefined && zeit(neueste) <= laufendSeit) return { fall: "aktuell", noetig: k, bestaetigt: neueste.je.size };

  const quellen = [...new Set([...neueste.je.values()].flatMap((x) => x.m.sources).filter(httpsQuelle))].slice(0, UPDATE_GRENZEN.quellen);
  const belege = [...neueste.je.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, x]) => x.ev);
  return {
    angebot: {
      version: neueste.manifest.version,
      releasedAt: zeit(neueste),
      sha256: datei.sha256,
      sizeBytes: datei.sizeBytes,
      quellen,
      belege,
    },
  };
}

/** Ist die heruntergeladene Datei genau die angebotene? Erst Größe, dann Prüfsumme. */
export function pruefeDatei(angebot: Pick<UpdateAngebot, "sha256" | "sizeBytes">, daten: Uint8Array): { ok: true } | { ok: false; fall: "groesse" | "pruefsumme" } {
  if (daten.length !== angebot.sizeBytes || daten.length > UPDATE_GRENZEN.bytes) return { ok: false, fall: "groesse" };
  if (bytesToHex(sha256(daten)) !== angebot.sha256) return { ok: false, fall: "pruefsumme" };
  return { ok: true };
}
