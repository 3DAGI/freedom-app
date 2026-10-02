/**
 * Sprachnachrichten (Schritt C-7, Sammlung C-7) – Aufnahme ohne DOM.
 *
 * Das Mikrofon geht nur auf Klick an (`starte()`), und nach jedem Ende –
 * beendet, abgebrochen, Grenze erreicht, Fehler – sind alle Spuren gestoppt:
 * Der Browser zeigt dann kein Mikrofon mehr an. Die Aufnahme wird ein
 * gewöhnlicher Anhang und reist wie jede Datei im Chat: klein in der
 * verschlüsselten Nachricht, sonst verschlüsselt über `uploadAnhang()` (2.4).
 *
 * Mikrofon, Recorder und Uhr kommen von außen, damit sich das ohne Browser
 * prüfen lässt.
 */

/**
 * Grenzen: eine Sprachnachricht ist kurz. Mit 32 kbit/s (für Sprache genug; Browser nehmen sonst
 * 128 kbit/s) sind zwei Minuten rund 480 KB, und bis etwa acht Sekunden reist sie in der Nachricht selbst.
 */
export const SPRACH_GRENZEN = { sekunden: 120, bitsProSekunde: 32_000 } as const;

/** Formate in der Reihenfolge der Wahl: Opus in WebM (Chromium, Firefox), in Ogg, sonst MP4 (Safari). */
export const SPRACH_FORMATE = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"] as const;

/** Das erste Format, das der Recorder kann – sonst null (dann wählt der Browser selbst). */
export function waehleSprachFormat(kann: (mime: string) => boolean): string | null {
  for (const f of SPRACH_FORMATE) {
    try {
      if (kann(f)) return f;
    } catch { /* ältere Browser werfen statt false */ }
  }
  return null;
}

/** Dateiname der Aufnahme – Daten, nicht Oberfläche; er reist nur in der verschlüsselten Nachricht. */
export function sprachDateiname(mime: string): string {
  const art = mime.split(";")[0]!.trim().toLowerCase();
  const endung = art === "audio/ogg" ? "ogg" : art === "audio/mp4" ? "m4a" : "webm";
  return `sprachnachricht.${endung}`; // kein UI-Text
}

/**
 * Ist der Typ eines Anhangs (aus einer fremden Nachricht) ein Ton, den die App
 * abspielen darf? Nur `audio/<name>` mit optionalen Parametern – nichts anderes
 * landet in einem Abspieler.
 */
export function istAudioTyp(mime: string): boolean {
  return /^audio\/[a-z0-9][a-z0-9.+-]{0,60}(\s*;\s*[a-z]+=[a-z0-9.,"' -]{1,60})*$/i.test(mime.trim());
}

/** Dauer als „m:ss“. */
export function dauerText(sekunden: number): string {
  const s = Math.max(0, Math.floor(sekunden));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Was die Aufnahme vom Browser braucht – im Browser `getUserMedia` und `MediaRecorder`. */
export interface SprachUmgebung {
  mikrofon(): Promise<MediaStream>;
  recorder(strom: MediaStream, mime: string | null): MediaRecorder;
  kann(mime: string): boolean;
  /** Ruft `fn` nach `ms` – gibt eine Funktion zum Abbrechen zurück. */
  spaeter(fn: () => void, ms: number): () => void;
  jetzt(): number;
}

export type SprachErgebnis = { datei: Blob; mime: string; sekunden: number };

export type SprachZustand = "bereit" | "startet" | "nimmt-auf";

/**
 * Eine Aufnahme nach der anderen. `starte()` fragt das Mikrofon an, `beende()`
 * liefert die Aufnahme, `brichAb()` verwirft sie. Endet die Aufnahme von selbst
 * (Grenze, Gerät weg), kommt das Ergebnis über `beiEnde`.
 */
export class SprachAufnahme {
  private zustand: SprachZustand = "bereit";
  private strom: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private teile: Blob[] = [];
  private beginn = 0;
  private uhr: (() => void) | null = null;
  private behalten = true;
  private fertig: ((e: SprachErgebnis | null) => void) | null = null;

  constructor(private readonly u: SprachUmgebung, private readonly beiEnde: (e: SprachErgebnis | null) => void = () => {}) {}

  get stand(): SprachZustand {
    return this.zustand;
  }

  /** Sekunden seit dem Beginn – 0, wenn nichts läuft. */
  get sekunden(): number {
    return this.zustand === "nimmt-auf" ? (this.u.jetzt() - this.beginn) / 1000 : 0;
  }

  /** Mikrofon an und aufnehmen. Wirft, wenn der Browser es verweigert – dann ist nichts an. */
  async starte(): Promise<void> {
    if (this.zustand !== "bereit") return;
    this.zustand = "startet";
    let strom: MediaStream;
    try {
      strom = await this.u.mikrofon();
    } catch (e) {
      this.zustand = "bereit";
      throw e;
    }
    // Abgebrochen, während der Browser noch fragte: sofort wieder aus
    if (this.zustand !== "startet") {
      stoppeSpuren(strom);
      return;
    }
    this.strom = strom;
    this.teile = [];
    this.behalten = true;
    try {
      const mime = waehleSprachFormat((m) => this.u.kann(m));
      const rec = this.u.recorder(strom, mime);
      rec.ondataavailable = (ev: BlobEvent) => {
        if (ev.data && ev.data.size > 0) this.teile.push(ev.data);
      };
      rec.onstop = () => this.schliesse();
      rec.start(1000);
      this.rec = rec;
    } catch (e) {
      this.aufraeumen();
      throw e;
    }
    this.beginn = this.u.jetzt();
    this.zustand = "nimmt-auf";
    // An der Grenze endet sie von selbst – das Ergebnis geht an `beiEnde`
    this.uhr = this.u.spaeter(() => void this.beende().then((e) => this.beiEnde(e)), SPRACH_GRENZEN.sekunden * 1000);
  }

  /** Aufnahme beenden – das Mikrofon geht aus, das Ergebnis kommt zurück (null ohne Ton). */
  beende(): Promise<SprachErgebnis | null> {
    return this.halte(true);
  }

  /** Aufnahme verwerfen – das Mikrofon geht aus, nichts bleibt. */
  async brichAb(): Promise<void> {
    if (this.zustand === "startet") {
      this.zustand = "bereit";
      return;
    }
    await this.halte(false);
  }

  private halte(behalten: boolean): Promise<SprachErgebnis | null> {
    if (this.zustand !== "nimmt-auf" || !this.rec) return Promise.resolve(null);
    this.behalten = behalten;
    const p = new Promise<SprachErgebnis | null>((res) => { this.fertig = res; });
    this.uhr?.();
    this.uhr = null;
    // Spuren sofort stoppen – nicht erst, wenn der Recorder fertig ist
    stoppeSpuren(this.strom);
    if (this.rec.state === "inactive") this.schliesse();
    else this.rec.stop();
    return p;
  }

  /** Nach `onstop`: Teile zusammensetzen, alles freigeben. */
  private schliesse(): void {
    const sekunden = (this.u.jetzt() - this.beginn) / 1000;
    const mime = this.rec?.mimeType || this.teile[0]?.type || "audio/webm";
    const ergebnis = this.behalten && this.teile.length > 0
      ? { datei: new Blob(this.teile, { type: mime }), mime, sekunden }
      : null;
    this.aufraeumen();
    const fertig = this.fertig;
    this.fertig = null;
    // Wer beende() rief, bekommt das Ergebnis; endete der Recorder von selbst (Gerät weg), `beiEnde`
    if (fertig) fertig(ergebnis);
    else this.beiEnde(ergebnis);
  }

  private aufraeumen(): void {
    stoppeSpuren(this.strom);
    this.uhr?.();
    this.uhr = null;
    this.strom = null;
    this.rec = null;
    this.teile = [];
    this.zustand = "bereit";
  }
}

function stoppeSpuren(strom: MediaStream | null): void {
  for (const s of strom?.getTracks() ?? []) s.stop();
}
