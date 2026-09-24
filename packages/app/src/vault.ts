/**
 * Tresor: verschluesselter Speicher fuer die Geheimnisse der App (Schritt 1.2).
 *
 * DAS PROBLEM
 * Der private Schluessel (`freedom.nsec`), die NWC-Verbindung zur Wallet, die
 * Swap-Geheimnisse, Unterhaltungen und der Agent-Verlauf lagen im Klartext in
 * localStorage. Jede Erweiterung mit Seitenzugriff, jede Kopie des
 * Browserprofils und jeder, der kurz an das entsperrte Geraet kommt, las mit.
 *
 * WAS HIER GEBAUT IST
 * - Schluessel aus der Passphrase: PBKDF2-SHA256, 600.000 Iterationen,
 *   16 Byte zufaelliges Salt je Tresor.
 * - Verschluesselung: AES-GCM 256, 12 Byte zufaellige IV bei JEDEM Schreiben.
 * - Alle Werte liegen als EIN Blob in IndexedDB, nicht in localStorage.
 * - Der Kopf (Version, Verfahren, Iterationen, Salt, IV) ist Zusatzdatum (AAD)
 *   der Verschluesselung: Wer ihn aendert, bricht den GCM-Tag. Weniger
 *   Iterationen als 600.000 werden gar nicht erst versucht.
 * - Nur WebCrypto – keine Bibliothek, kein WASM (die CSP bleibt, wie sie ist).
 *
 * GRENZEN
 * Solange der Tresor offen ist, liegen die Werte entschluesselt im Speicher der
 * Seite – wie bei jeder Web-App. Der Tresor schuetzt die gespeicherten Daten,
 * nicht eine bereits kompromittierte, laufende Seite. Eine falsche Passphrase
 * und veraenderte Daten sind fuer AES-GCM dasselbe: Beides scheitert am Tag.
 */

export const TRESOR_VERSION = 1;
export const PBKDF2_ITERATIONEN = 600_000;
/** Obergrenze, damit ein manipulierter Kopf das Entsperren nicht lahmlegt. */
const MAX_ITERATIONEN = 10_000_000;
export const MIN_PASSPHRASE = 8;
const SALT_BYTES = 16;
const IV_BYTES = 12;

/** Wo der verschluesselte Blob liegt. Im Browser IndexedDB, in Tests der RAM. */
export interface TresorSpeicher {
  lesen(): Promise<string | null>;
  schreiben(blob: string): Promise<void>;
  loeschen(): Promise<void>;
}

export class FalschePassphrase extends Error {
  constructor() {
    super("Passphrase falsch oder Tresor verändert");
    this.name = "FalschePassphrase";
  }
}

export interface Vault {
  /** Wert lesen; undefined, wenn es ihn nicht gibt. Wirft, wenn gesperrt. */
  get(key: string): string | undefined;
  /** Wert setzen und sofort verschluesselt speichern. */
  set(key: string, value: string): Promise<void>;
  /** Wert entfernen und speichern. */
  delete(key: string): Promise<void>;
  keys(): string[];
  /** Schluessel und Klartext vergessen. Danach hilft nur unlock(). */
  lock(): void;
  readonly locked: boolean;
}

interface Kopf {
  v: number;
  kdf: "PBKDF2-SHA256";
  iter: number;
  salt: string;
  iv: string;
}

interface TresorBlob extends Kopf {
  ct: string;
}

// ------------------------------------------------------------- Speicher

/** IndexedDB: eine Datenbank, ein Eintrag – der ganze Tresor. */
export class IndexedDbSpeicher implements TresorSpeicher {
  constructor(private dbName = "freedom-vault", private store = "tresor") {}

  private oeffnen(): Promise<IDBDatabase> {
    return new Promise((res, rej) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(this.store)) req.result.createObjectStore(this.store);
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  private async tx<T>(modus: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.oeffnen();
    return new Promise((res, rej) => {
      const t = db.transaction(this.store, modus);
      const req = f(t.objectStore(this.store));
      t.oncomplete = () => { db.close(); res(req.result); };
      t.onerror = () => { db.close(); rej(t.error); };
      t.onabort = () => { db.close(); rej(t.error); };
    });
  }

  async lesen(): Promise<string | null> {
    const wert = await this.tx("readonly", (s) => s.get("blob"));
    return typeof wert === "string" ? wert : null;
  }

  async schreiben(blob: string): Promise<void> {
    await this.tx("readwrite", (s) => s.put(blob, "blob"));
  }

  async loeschen(): Promise<void> {
    await this.tx("readwrite", (s) => s.delete("blob"));
  }
}

/** Fuer Tests: haelt den Blob nur im Arbeitsspeicher. */
export class SpeicherImRam implements TresorSpeicher {
  blob: string | null = null;
  async lesen(): Promise<string | null> { return this.blob; }
  async schreiben(blob: string): Promise<void> { this.blob = blob; }
  async loeschen(): Promise<void> { this.blob = null; }
}

// ------------------------------------------------------------- Krypto

function zuB64(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

function ausB64(s: string, laenge: number): Uint8Array {
  let bin: string;
  try { bin = atob(s); } catch { throw new FalschePassphrase(); }
  if (laenge > 0 && bin.length !== laenge) throw new FalschePassphrase();
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Kopf in fester Reihenfolge – genau diese Bytes sind die AAD. */
function aad(k: Kopf): Uint8Array {
  return new TextEncoder().encode(JSON.stringify([k.v, k.kdf, k.iter, k.salt, k.iv]));
}

async function schluessel(passphrase: string, salt: Uint8Array, iter: number): Promise<CryptoKey> {
  // NFC: dieselbe Passphrase, auf einem anderen Geraet anders zusammengesetzt
  // eingegeben (z. B. "é" als ein oder zwei Zeichen), oeffnet denselben Tresor.
  const roh = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(passphrase.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: iter },
    roh,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function kopfPruefen(x: unknown): TresorBlob {
  const b = x as Partial<TresorBlob> | null;
  if (!b || b.v !== TRESOR_VERSION || b.kdf !== "PBKDF2-SHA256"
    || typeof b.salt !== "string" || typeof b.iv !== "string" || typeof b.ct !== "string"
    || !Number.isSafeInteger(b.iter)) {
    throw new FalschePassphrase();
  }
  // Weniger Iterationen waeren ein Herabstufen – das wird nicht versucht.
  if (b.iter! < PBKDF2_ITERATIONEN || b.iter! > MAX_ITERATIONEN) throw new FalschePassphrase();
  return b as TresorBlob;
}

class OffenerTresor implements Vault {
  private werte: Map<string, string> | null;
  private key: CryptoKey | null;
  private kette: Promise<void> = Promise.resolve();

  constructor(
    werte: Map<string, string>,
    key: CryptoKey,
    private salt: string,
    private iter: number,
    private speicher: TresorSpeicher,
  ) {
    this.werte = werte;
    this.key = key;
  }

  get locked(): boolean {
    return this.key === null;
  }

  private offen(): { werte: Map<string, string>; key: CryptoKey } {
    if (!this.werte || !this.key) throw new Error("Tresor gesperrt");
    return { werte: this.werte, key: this.key };
  }

  get(key: string): string | undefined {
    return this.offen().werte.get(key);
  }

  keys(): string[] {
    return [...this.offen().werte.keys()];
  }

  set(key: string, value: string): Promise<void> {
    if (typeof value !== "string") return Promise.reject(new TypeError("Tresor speichert nur Text"));
    this.offen().werte.set(key, value);
    return this.speichern();
  }

  delete(key: string): Promise<void> {
    this.offen().werte.delete(key);
    return this.speichern();
  }

  lock(): void {
    this.werte?.clear();
    this.werte = null;
    this.key = null;
  }

  /** Schreibvorgaenge nacheinander – der zuletzt gesetzte Stand gewinnt. */
  private speichern(): Promise<void> {
    const { werte, key } = this.offen();
    const klartext = JSON.stringify(Object.fromEntries(werte));
    const lauf = this.kette.then(() => verschluesseln(klartext, key, this.salt, this.iter))
      .then((blob) => this.speicher.schreiben(blob));
    this.kette = lauf.catch(() => undefined);
    return lauf;
  }
}

async function verschluesseln(klartext: string, key: CryptoKey, salt: string, iter: number): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const kopf: Kopf = { v: TRESOR_VERSION, kdf: "PBKDF2-SHA256", iter, salt, iv: zuB64(iv) };
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource, additionalData: aad(kopf) as BufferSource },
    key,
    new TextEncoder().encode(klartext),
  ));
  return JSON.stringify({ ...kopf, ct: zuB64(ct) } satisfies TresorBlob);
}

// ------------------------------------------------------------- Oeffentlich

/** Gibt es schon einen Tresor? */
export async function vaultExists(speicher: TresorSpeicher = new IndexedDbSpeicher()): Promise<boolean> {
  return (await speicher.lesen()) !== null;
}

/**
 * Neuen, leeren Tresor anlegen. Ueberschreibt nie einen vorhandenen – wer die
 * Passphrase vergessen hat, loescht ihn ausdruecklich (speicher.loeschen()).
 */
export async function createVault(
  passphrase: string,
  speicher: TresorSpeicher = new IndexedDbSpeicher(),
): Promise<Vault> {
  if (passphrase.normalize("NFC").length < MIN_PASSPHRASE) {
    throw new Error(`Passphrase zu kurz – mindestens ${MIN_PASSPHRASE} Zeichen`);
  }
  if (await vaultExists(speicher)) throw new Error("Es gibt schon einen Tresor");
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await schluessel(passphrase, salt, PBKDF2_ITERATIONEN);
  const tresor = new OffenerTresor(new Map(), key, zuB64(salt), PBKDF2_ITERATIONEN, speicher);
  await speicher.schreiben(await verschluesseln("{}", key, zuB64(salt), PBKDF2_ITERATIONEN));
  return tresor;
}

/** Vorhandenen Tresor mit der Passphrase oeffnen. */
export async function unlock(
  passphrase: string,
  speicher: TresorSpeicher = new IndexedDbSpeicher(),
): Promise<Vault> {
  const roh = await speicher.lesen();
  if (roh === null) throw new Error("Kein Tresor vorhanden");
  let blob: TresorBlob;
  try { blob = kopfPruefen(JSON.parse(roh)); } catch { throw new FalschePassphrase(); }
  const salt = ausB64(blob.salt, SALT_BYTES);
  const iv = ausB64(blob.iv, IV_BYTES);
  const ct = ausB64(blob.ct, 0);
  const key = await schluessel(passphrase, salt, blob.iter);
  let klartext: string;
  try {
    klartext = new TextDecoder().decode(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource, additionalData: aad(blob) as BufferSource },
      key,
      ct as BufferSource,
    ));
  } catch {
    throw new FalschePassphrase();
  }
  const daten = JSON.parse(klartext) as Record<string, unknown>;
  const werte = new Map<string, string>();
  for (const [k, v] of Object.entries(daten)) if (typeof v === "string") werte.set(k, v);
  return new OffenerTresor(werte, key, blob.salt, blob.iter, speicher);
}
