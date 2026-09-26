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
/** … und eine für den Verlauf der Gruppen (2.2b-d1). */
export const mlsVerlaufDatenbank = (): TresorSpeicher => new IndexedDbSpeicher("freedom-mls-verlauf", "verlauf");

export class MlsZustand {
  #kette: Promise<unknown> = Promise.resolve();
  readonly #zusatz: Uint8Array<ArrayBuffer>;

  /** `bindung` (etwa die Identität) gehört zu den Zusatzdaten: unter einer anderen lässt sich nichts öffnen. */
  constructor(private speicher: TresorSpeicher, private schluessel: CryptoKey, bindung = "") {
    this.#zusatz = new TextEncoder().encode(`freedom.mls.zustand.v1${bindung ? `:${bindung}` : ""}`);
  }

  /** Gespeicherten Zustand entschlüsseln; undefined, wenn es keinen gibt. */
  async laden(): Promise<Uint8Array | undefined> {
    const blob = await this.speicher.lesen();
    if (!blob) return undefined;
    const roh = ausB64(blob);
    try {
      const klar = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: roh.subarray(0, IV_BYTES), additionalData: this.#zusatz }, this.schluessel, roh.subarray(IV_BYTES));
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
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: this.#zusatz }, this.schluessel, kopie));
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

export interface VerlaufEintrag {
  id: string;
  /** Identität des Absenders (von MLS authentifiziert). */
  von: string;
  text: string;
  zeit: number;
}

export const VERLAUF_MAX = 1000;

/**
 * Verlauf der MLS-Gruppen (Schritt 2.2b-d1). Eine MLS-Nachricht lässt sich
 * nur einmal entschlüsseln – danach ist ihr Schlüssel weg (Vorwärtsgeheimnis).
 * Was angezeigt werden soll, liegt deshalb verschlüsselt auf dem Gerät, je
 * Gruppe höchstens `VERLAUF_MAX` Nachrichten. Vor dem Zustand sichern: Geht
 * dazwischen etwas verloren, stellt die Engine die Nachricht erneut zu.
 */
export class MlsVerlauf {
  #gruppen: Record<string, VerlaufEintrag[]> = {};

  constructor(private ablage: MlsZustand) {}

  async laden(): Promise<void> {
    const roh = await this.ablage.laden();
    if (!roh) return;
    const d = JSON.parse(new TextDecoder().decode(roh)) as { gruppen?: unknown };
    if (!d.gruppen || typeof d.gruppen !== "object") throw new Error("MLS-Verlauf beschädigt");
    this.#gruppen = d.gruppen as Record<string, VerlaufEintrag[]>;
  }

  nachrichten(gruppe: string): VerlaufEintrag[] {
    return [...(this.#gruppen[gruppe] ?? [])];
  }

  /** Neue Nachrichten aufnehmen (je Id einmal, nach Zeit); wie viele neu waren. */
  nimmAuf(gruppe: string, neu: readonly VerlaufEintrag[]): number {
    const alt = this.#gruppen[gruppe] ?? [];
    const ids = new Set(alt.map((e) => e.id));
    const dazu = neu.filter((e) => !ids.has(e.id) && ids.add(e.id));
    if (dazu.length > 0) this.#gruppen[gruppe] = [...alt, ...dazu].sort((a, b) => a.zeit - b.zeit).slice(-VERLAUF_MAX);
    return dazu.length;
  }

  sichern(): Promise<void> {
    return this.ablage.sichern(new TextEncoder().encode(JSON.stringify({ gruppen: this.#gruppen })));
  }

  async loeschen(): Promise<void> {
    this.#gruppen = {};
    await this.ablage.loeschen();
  }
}
