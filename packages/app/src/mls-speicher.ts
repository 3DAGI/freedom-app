/**
 * MLS-Zustand verschlüsselt ablegen (Schritt 2.2b-c).
 *
 * Der Zustand (`Mls.zustand()`) ist MDKs SQLite-Datenbank mit allen
 * Gruppenschlüsseln – Megabytes groß, zu groß für den Tresor, der bei jeder
 * Änderung ganz neu verschlüsselt wird. Er liegt deshalb in einer eigenen
 * IndexedDB („freedom-mls“), verschlüsselt mit AES-256-GCM. Der Schlüssel liegt
 * in `geheim` (`freedom.mls.schluessel`): mit Tresor im Tresor, ohne wie die
 * übrigen Geheimnisse in localStorage. Gesichert wird der Zustand nie
 * (`SICHERUNG_NIE`: `freedom.mls…`) – ein neues Gerät tritt als eigenes Mitglied bei.
 */
import { fromHex, toHex } from "@freedomstack/protocol";
import { IndexedDbSpeicher, type GeheimSpeicher, type TresorSpeicher } from "./vault.js";

export const LS_MLS_SCHLUESSEL = "freedom.mls.schluessel";
const AAD = new TextEncoder().encode("freedom.mls.zustand.v1");
const IV_BYTES = 12;

function zuB64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

function ausB64(t: string): Uint8Array<ArrayBuffer> {
  const s = atob(t);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

/** Schlüssel aus `geheim` – beim ersten Mal erzeugt. Gesperrter Tresor: wirft, statt einen neuen anzulegen. */
export async function mlsSchluessel(geheim: GeheimSpeicher): Promise<CryptoKey> {
  let hex = geheim.getItem(LS_MLS_SCHLUESSEL);
  if (!hex) {
    hex = toHex(crypto.getRandomValues(new Uint8Array(32)));
    await geheim.setItem(LS_MLS_SCHLUESSEL, hex);
  }
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error("MLS-Schlüssel beschädigt");
  return crypto.subtle.importKey("raw", fromHex(hex) as Uint8Array<ArrayBuffer>, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Speicher der App: eine IndexedDB nur für den MLS-Zustand. */
export const mlsDatenbank = (): TresorSpeicher => new IndexedDbSpeicher("freedom-mls", "zustand");

export class MlsZustand {
  #kette: Promise<unknown> = Promise.resolve();

  constructor(private speicher: TresorSpeicher, private schluessel: CryptoKey) {}

  /** Gespeicherten Zustand entschlüsseln; undefined, wenn es keinen gibt. */
  async laden(): Promise<Uint8Array | undefined> {
    const blob = await this.speicher.lesen();
    if (!blob) return undefined;
    const roh = ausB64(blob);
    try {
      const klar = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: roh.subarray(0, IV_BYTES), additionalData: AAD }, this.schluessel, roh.subarray(IV_BYTES));
      return new Uint8Array(klar);
    } catch {
      throw new Error("MLS-Zustand beschädigt oder mit anderem Schlüssel verschlüsselt");
    }
  }

  /** Verschlüsselt sichern – Aufrufe nacheinander, der zuletzt übergebene Stand gewinnt. */
  sichern(zustand: Uint8Array): Promise<void> {
    const kopie = Uint8Array.from(zustand);
    const lauf = this.#kette.then(async () => {
      const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, this.schluessel, kopie));
      const roh = new Uint8Array(IV_BYTES + ct.length);
      roh.set(iv);
      roh.set(ct, IV_BYTES);
      await this.speicher.schreiben(zuB64(roh));
    });
    this.#kette = lauf.catch(() => undefined);
    return lauf;
  }

  loeschen(): Promise<void> {
    return this.speicher.loeschen();
  }
}
