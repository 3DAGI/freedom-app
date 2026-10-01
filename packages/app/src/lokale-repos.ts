/**
 * Repos nur auf diesem Gerät (Sammlung B-2, Entscheidung S1 „B mit Wechsel“):
 * Ein Repo kann privat bleiben – nichts geht auf ein Relay, kein Stück ins
 * Blob-Netz. Gemerkt werden die Angaben der Ankündigung (`RepoAnkuendigung`)
 * und je Repo das neueste Bundle: das Chiffrat in der IndexedDB
 * `freedom-repos`, sein Schlüssel (`verschluesseleDatei()`) hier im Eintrag.
 * Die Liste liegt in `geheim` (`freedom.repos.lokal`), mit Tresor also im
 * Tresor, und nie in der Sicherung (`SICHERUNG_NIE`) – die geht auf Relays.
 *
 * Ohne DOM, damit testbar; die Ablage steht in `shell/lokale-repos-ablage.ts`.
 * Gelesen wird streng: Was in localStorage stand, kann verändert sein.
 */
import { type DateiSchluessel, type RepoAnkuendigung, baueRepoAnkuendigung, entschluesseleDatei, verschluesseleDatei } from "@freedomstack/protocol";
import { type RepoKarte, repoKarten } from "./repo-ansicht.js";

export const LS_REPOS_LOKAL = "freedom.repos.lokal";
/** Höchstens so viele Repos nur auf diesem Gerät (je Identität). */
export const LOKAL_MAX = 50;

export interface LokalesBundle {
  zeit: number;
  /** Größe des Bundles (Klartext). */
  bytes: number;
  schluessel: DateiSchluessel;
}

export interface LokalesRepo {
  eigentuemer: string;
  angaben: RepoAnkuendigung;
  /** Letzte Änderung (Sekunden). */
  zeit: number;
  bundle?: LokalesBundle;
}

const HEX64 = /^[0-9a-f]{64}$/;
const HEX24 = /^[0-9a-f]{24}$/;
const zahl = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const texte = (x: unknown): string[] | undefined => (Array.isArray(x) && x.every((s) => typeof s === "string") ? x.slice(0, 20) : undefined);

/** Angaben aus dem Speicher: nur bekannte Felder, ohne Raum (ein Raum ist öffentlich), geprüft wie beim Ankündigen. */
function leseAngaben(x: unknown, eigentuemer: string): RepoAnkuendigung | null {
  if (!x || typeof x !== "object") return null;
  const a = x as Record<string, unknown>;
  if (typeof a.id !== "string" || typeof a.name !== "string") return null;
  const klon = texte(a.klon ?? []);
  const web = a.web === undefined ? undefined : texte(a.web);
  const maintainer = a.maintainer === undefined ? undefined : texte(a.maintainer);
  if (!klon || (a.web !== undefined && !web) || (a.maintainer !== undefined && !maintainer)) return null;
  if ((a.beschreibung !== undefined && typeof a.beschreibung !== "string") || (a.ersterCommit !== undefined && typeof a.ersterCommit !== "string")) return null;
  const angaben: RepoAnkuendigung = {
    id: a.id, name: a.name.slice(0, 100), klon,
    ...(a.beschreibung ? { beschreibung: (a.beschreibung as string).slice(0, 500) } : {}), ...(web?.length ? { web } : {}),
    ...(maintainer?.length ? { maintainer } : {}), ...(a.ersterCommit ? { ersterCommit: a.ersterCommit as string } : {}),
  };
  try {
    baueRepoAnkuendigung(angaben, eigentuemer);
  } catch {
    return null;
  }
  return angaben;
}

function leseBundle(x: unknown): LokalesBundle | null {
  if (!x || typeof x !== "object") return null;
  const b = x as Record<string, unknown>;
  const s = b.schluessel as Record<string, unknown> | undefined;
  if (!zahl(b.zeit) || !zahl(b.bytes) || !s || s.alg !== "aes-gcm") return null;
  if (typeof s.key !== "string" || !HEX64.test(s.key) || typeof s.nonce !== "string" || !HEX24.test(s.nonce) || typeof s.ox !== "string" || !HEX64.test(s.ox)) return null;
  return { zeit: b.zeit, bytes: b.bytes, schluessel: { alg: "aes-gcm", key: s.key, nonce: s.nonce, ox: s.ox } };
}

/** Die gemerkte Liste lesen – Kaputtes fällt weg, je Eigentümer und Kennung der erste Eintrag. */
export function leseLokaleRepos(roh: string | null): LokalesRepo[] {
  let liste: unknown;
  try {
    liste = JSON.parse(roh ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(liste)) return [];
  const aus: LokalesRepo[] = [];
  const gesehen = new Set<string>();
  for (const x of liste) {
    if (!x || typeof x !== "object") continue;
    const e = x as Record<string, unknown>;
    if (typeof e.eigentuemer !== "string" || !HEX64.test(e.eigentuemer) || !zahl(e.zeit)) continue;
    const angaben = leseAngaben(e.angaben, e.eigentuemer);
    const bundle = e.bundle === undefined ? undefined : leseBundle(e.bundle);
    if (!angaben || bundle === null) continue;
    const schluessel = `${e.eigentuemer}:${angaben.id}`;
    if (gesehen.has(schluessel)) continue;
    gesehen.add(schluessel);
    aus.push({ eigentuemer: e.eigentuemer, angaben, zeit: e.zeit, ...(bundle ? { bundle } : {}) });
  }
  return aus;
}

/**
 * Karten der eigenen Repos auf diesem Gerät (nur Identität `ich`): dieselben
 * Karten wie im Netz, aus der lokal gebauten Ankündigung – mit eigenem
 * Schlüssel (`lokal:…`), nie mit einem öffentlichen Repo gleicher Kennung
 * vermischt, und `lokal` leitet jede Aktion auf das Gerät.
 */
export function lokaleKarten(repos: readonly LokalesRepo[], ich: string | undefined): RepoKarte[] {
  if (!ich) return [];
  return repos.filter((r) => r.eigentuemer === ich).flatMap((r) => {
    const ev = { ...baueRepoAnkuendigung(r.angaben, ich), created_at: Math.max(r.zeit, r.bundle?.zeit ?? 0) };
    return repoKarten([ev as never], [], [], [], ich).map((k) => ({
      ...k, schluessel: `lokal:${k.schluessel}`, lokal: r.bundle ? { bundle: { zeit: r.bundle.zeit, bytes: r.bundle.bytes } } : {},
    }));
  });
}

/** Ein Repo neu merken oder seine Angaben ersetzen; ein neues nur bis `LOKAL_MAX`. */
export function merkeLokal(repos: readonly LokalesRepo[], eintrag: LokalesRepo): LokalesRepo[] {
  const gleich = (r: LokalesRepo) => r.eigentuemer === eintrag.eigentuemer && r.angaben.id === eintrag.angaben.id;
  const alt = repos.find(gleich);
  if (!alt && repos.filter((r) => r.eigentuemer === eintrag.eigentuemer).length >= LOKAL_MAX) throw new LokalVoll();
  const bundle = eintrag.bundle ?? alt?.bundle;
  return [...repos.filter((r) => !gleich(r)), { ...eintrag, ...(bundle ? { bundle } : {}) }];
}

export const vergissLokal = (repos: readonly LokalesRepo[], eigentuemer: string, id: string): LokalesRepo[] =>
  repos.filter((r) => r.eigentuemer !== eigentuemer || r.angaben.id !== id);

/** Schlüssel des Chiffrats in der IndexedDB – mit der Prüfsumme des Klartexts, damit eine neue Version die alte erst ersetzt, wenn sie gemerkt ist. */
export const bundleSchluessel = (eigentuemer: string, id: string, ox: string): string => `${eigentuemer}:${id}:${ox}`;

/** Mehr als `LOKAL_MAX` – die App zeigt dafür `repo.lokalVoll`. */
export class LokalVoll extends Error {
  constructor() {
    super("lokal-voll"); // kein UI-Text
    this.name = "LokalVoll";
  }
}

/** Wo die Chiffrate liegen (in der App: IndexedDB `freedom-repos`). */
export interface BundleSpeicher {
  lies(k: string): Promise<Uint8Array | null>;
  lege(k: string, v: Uint8Array): Promise<void>;
  loesche(k: string): Promise<void>;
}

/** Wo die Liste liegt (in der App: `geheim`). */
export interface ListenSpeicher {
  getItem(k: string): string | null;
  setItem(k: string, v: string): Promise<void>;
}

/**
 * Die Repos dieses Geräts: Liste und Bundles zusammen. Ein Bundle wird erst
 * verschlüsselt abgelegt, dann gemerkt, dann die alte Version gelöscht – bricht
 * etwas ab, bleibt die bisherige lesbar.
 */
export class LokaleRepos {
  constructor(private liste: ListenSpeicher, private bundles: BundleSpeicher, private jetzt = () => Math.floor(Date.now() / 1000)) {}

  alle(): LokalesRepo[] {
    return leseLokaleRepos(this.liste.getItem(LS_REPOS_LOKAL));
  }

  karten(ich: string | undefined): RepoKarte[] {
    return lokaleKarten(this.alle(), ich);
  }

  finde(ich: string, id: string): LokalesRepo | undefined {
    return this.alle().find((r) => r.eigentuemer === ich && r.angaben.id === id);
  }

  /** Anlegen oder die Angaben ändern – geprüft wie beim Ankündigen, ohne Raum. */
  async merke(ich: string, angaben: RepoAnkuendigung): Promise<void> {
    const ohneRaum = { ...angaben };
    delete ohneRaum.raum;
    baueRepoAnkuendigung(ohneRaum, ich);
    await this.schreibe(merkeLokal(this.alle(), { eigentuemer: ich, angaben: ohneRaum, zeit: this.jetzt() }));
  }

  /** Neue Version eines gemerkten Repos – verschlüsselt mit frischem Schlüssel (`verschluesseleDatei()`). */
  async legeBundleAb(ich: string, id: string, klartext: Uint8Array): Promise<void> {
    const r = this.finde(ich, id);
    if (!r) throw new Error("kein lokales Repo"); // kein UI-Text
    const { chiffrat, schluessel } = verschluesseleDatei(klartext);
    await this.bundles.lege(bundleSchluessel(ich, id, schluessel.ox), chiffrat);
    const bundle = { zeit: this.jetzt(), bytes: klartext.length, schluessel };
    await this.schreibe(merkeLokal(this.alle(), { ...r, zeit: bundle.zeit, bundle }));
    if (r.bundle && r.bundle.schluessel.ox !== schluessel.ox) await this.bundles.loesche(bundleSchluessel(ich, id, r.bundle.schluessel.ox)).catch(() => undefined);
  }

  /** Das gemerkte Bundle entschlüsseln; null ohne Bundle. Verändertes Chiffrat wirft (GCM, Prüfsumme). */
  async holeBundle(ich: string, id: string): Promise<Uint8Array | null> {
    const b = this.finde(ich, id)?.bundle;
    if (!b) return null;
    const chiffrat = await this.bundles.lies(bundleSchluessel(ich, id, b.schluessel.ox));
    return chiffrat ? entschluesseleDatei(chiffrat, b.schluessel) : null;
  }

  /** Vom Gerät löschen: erst aus der Liste (ohne Schlüssel ist das Chiffrat nichts wert), dann das Chiffrat. */
  async entferne(ich: string, id: string): Promise<void> {
    const r = this.finde(ich, id);
    await this.schreibe(vergissLokal(this.alle(), ich, id));
    if (r?.bundle) await this.bundles.loesche(bundleSchluessel(ich, id, r.bundle.schluessel.ox)).catch(() => undefined);
  }

  private schreibe(repos: readonly LokalesRepo[]): Promise<void> {
    return this.liste.setItem(LS_REPOS_LOKAL, JSON.stringify(repos));
  }
}
