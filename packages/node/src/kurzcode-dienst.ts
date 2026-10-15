/**
 * Code zum Eintippen im laufenden Knoten (VKf, K1): `npm run koppeln -- --code` legt nur die Datei an
 * und verbindet sich mit keinem Relay (Tor, 8.2c). Der Knoten sieht im Takt nach, legt das Event mit
 * dem verschlüsselten Kopplungscode auf seine Relays (`baueKurzcodeEvent()`) und löscht es (NIP-09)
 * samt Datei, sobald die App den Code eingelöst hat (`eingeloest()`, aus der Statusabfrage des
 * Besitzers) oder die Frist um ist. Ins Log nur feste Texte – nie der Code, nie die Suchkennung.
 */
import { rmSync } from "node:fs";
import { KURZCODE_GUELTIG, type Kopplung, type NostrEvent, baueKurzcodeEvent, baueKurzcodeLoeschung, getTag, signEvent } from "@freedomstack/protocol";
import { leseKurzcodeEintrag } from "./kopplung-datei.js";

export interface KurzcodeDienstOpts {
  datei: string;
  sk: Uint8Array;
  kopplung: () => Kopplung | null;
  veroeffentliche: (ev: NostrEvent) => Promise<unknown>;
  jetzt?: () => number;
}

export class KurzcodeDienst {
  /** Das veröffentlichte Event zum Code in der Datei – undefined, solange keines draußen ist. */
  private draussen?: { code: string; ev: NostrEvent };
  private eingeloesteSuche?: string;
  private laeuft = false;

  constructor(private readonly o: KurzcodeDienstOpts) {}

  private jetzt(): number {
    return this.o.jetzt?.() ?? Math.floor(Date.now() / 1000);
  }

  /** Die App hat den Code eingelöst (Statusabfrage mit Nachweis) – beim nächsten Takt löschen. */
  eingeloest(suche: string): void {
    if (this.draussen && getTag(this.draussen.ev, "d") === suche) this.eingeloesteSuche = suche;
  }

  /** Ein Durchgang: löschen, was eingelöst, ersetzt oder abgelaufen ist; sonst veröffentlichen, was neu ist. Nie zwei zugleich. */
  async takt(): Promise<void> {
    if (this.laeuft) return;
    this.laeuft = true;
    try {
      const e = leseKurzcodeEintrag(this.o.datei);
      const jetzt = this.jetzt();
      if (this.draussen) {
        const alt = this.draussen;
        const eingeloest = this.eingeloesteSuche === getTag(alt.ev, "d");
        if (!eingeloest && e?.code === alt.code && e.bis > jetzt) return; // läuft noch
        this.draussen = undefined;
        this.eingeloesteSuche = undefined;
        await this.o.veroeffentliche(signEvent(baueKurzcodeLoeschung(alt.ev, jetzt), this.o.sk)).catch(() => undefined);
        // Die Datei nur löschen, wenn sie noch zu diesem Code gehört – ein neuer Code bleibt für den nächsten Takt
        if (e?.code === alt.code) rmSync(this.o.datei, { force: true });
        console.log(eingeloest ? "[kopplung] Code eingelöst – Event gelöscht" : "[kopplung] Code verfallen – Event gelöscht");
        return;
      }
      if (!e) return;
      if (e.bis <= jetzt) {
        rmSync(this.o.datei, { force: true });
        return;
      }
      const k = this.o.kopplung();
      if (!k) {
        console.warn("[kopplung] Code liegt bereit, aber der Knoten ist nicht gekoppelt – npm run koppeln");
        return;
      }
      // Die Frist steht in der Datei: Das Event läuft mit ihr ab, nicht erst zehn Minuten nach diesem Takt
      const ev = signEvent(await baueKurzcodeEvent({ kopplung: k, code: e.code, jetzt: e.bis - KURZCODE_GUELTIG }), this.o.sk);
      await this.o.veroeffentliche(ev);
      this.draussen = { code: e.code, ev };
      console.log("[kopplung] Code zum Eintippen veröffentlicht");
    } catch (err) {
      console.warn(`[kopplung] Code nicht veröffentlicht (${(err as Error).name})`);
    } finally {
      this.laeuft = false;
    }
  }
}
