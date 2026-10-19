/**
 * Vorlesen auf dem Gerät (B-38a, SP-W2 A, `docs/SPRACHE-ENTWURF.md` V1 und V5) – ohne DOM.
 *
 * Gelesen wird nur mit Stimmen, die der Browser als lokal meldet (`localService`). Chrome bietet daneben Stimmen
 * „Google …“ an, die den Text an Google schicken – die nimmt die App nie, auch nicht als Rückfall. Ohne lokale Stimme
 * in der Sprache liest sie nicht vor und sagt das (`keine-stimme`). Die Spracherkennung des Browsers (Ton an Google) nutzt die App
 * nirgends.
 *
 * Der Text geht in Stücken an den Browser: Manche Systeme brechen lange Äußerungen nach etwa 15 Sekunden ab.
 */

/** Was die App von einer Stimme braucht (`SpeechSynthesisVoice`). */
export interface Stimme {
  name: string;
  lang: string;
  localService: boolean;
  default?: boolean;
}

/** Grenzen: so viel liest die App höchstens vor, so lang ist ein Stück. */
export const VORLESE_GRENZEN = { zeichen: 8000, stueck: 220, stimmenWartenMs: 1500 } as const;

/** Nur Stimmen, die auf dem Gerät sprechen – `localService` muss wirklich `true` sein. */
export function lokaleStimmen<S extends Stimme>(alle: readonly S[]): S[] {
  return alle.filter((s) => s.localService === true);
}

/** Die Sprache einer Stimme („de-DE“, „de_AT“ → „de“). */
function grundsprache(lang: string): string {
  return lang.trim().toLowerCase().split(/[-_]/)[0] ?? "";
}

/**
 * Die Stimme für eine Sprache („de“, „en“): unter den lokalen erst die Vorgabe des Systems, dann die erste. Nie eine
 * Netzstimme und nie eine andere Sprache – dann `null`.
 */
export function waehleStimme<S extends Stimme>(alle: readonly S[], sprache: string): S | null {
  const passend = lokaleStimmen(alle).filter((s) => grundsprache(s.lang) === grundsprache(sprache));
  return passend.find((s) => s.default === true) ?? passend[0] ?? null;
}

/**
 * Der Text in Stücken: Leerraum zusammengezogen, höchstens `VORLESE_GRENZEN.zeichen`, geteilt an Satzenden, sonst an
 * Leerzeichen – ein Stück höchstens `VORLESE_GRENZEN.stueck` Zeichen (ein Wort ohne Leerzeichen notfalls hart).
 */
export function vorleseStuecke(text: string, g: { zeichen: number; stueck: number } = VORLESE_GRENZEN): string[] {
  const ganz = text.replace(/\s+/g, " ").trim().slice(0, g.zeichen);
  const saetze = ganz.match(/[^.!?…]+(?:[.!?…]+|$)/g) ?? [];
  const stuecke: string[] = [];
  let aktuell = "";
  const ab = (s: string): void => {
    if (s) stuecke.push(s);
  };
  for (const roh of saetze) {
    const satz = roh.trim();
    if (!satz) continue;
    if (aktuell && (aktuell + " " + satz).length <= g.stueck) {
      aktuell = `${aktuell} ${satz}`;
      continue;
    }
    ab(aktuell);
    aktuell = "";
    if (satz.length <= g.stueck) {
      aktuell = satz;
      continue;
    }
    // Ein langer Satz: an Leerzeichen teilen
    for (const wort of satz.split(" ")) {
      if (aktuell && (aktuell + " " + wort).length > g.stueck) {
        ab(aktuell);
        aktuell = "";
      }
      let rest = aktuell ? `${aktuell} ${wort}` : wort;
      while (rest.length > g.stueck) {
        ab(rest.slice(0, g.stueck));
        rest = rest.slice(g.stueck);
      }
      aktuell = rest;
    }
  }
  ab(aktuell);
  return stuecke;
}

/** Was der Vorleser vom Browser braucht (`speechSynthesis`) – von außen, damit er sich ohne Browser prüfen lässt. */
export interface Sprecher {
  stimmen(): readonly Stimme[];
  /** Sobald sich die Stimmen ändern (`voiceschanged`); gibt das Abmelden zurück. */
  aufStimmen(f: () => void): () => void;
  /** Ein Stück sprechen; `fertig(true)` am Ende, `fertig(false)` bei Fehler oder Abbruch. */
  sprich(stueck: string, stimme: Stimme, fertig: (ok: boolean) => void): void;
  stopp(): void;
}

export type VorleseErgebnis = "fertig" | "keine-stimme" | "leer" | "abgebrochen";

/**
 * Liest vor – immer nur einen Text zugleich: Ein neuer Aufruf oder `stopp()` beendet den laufenden
 * (`abgebrochen`).
 */
export class Vorleser {
  private lauf = 0;
  private laeuft = false;

  constructor(private readonly s: Sprecher, private readonly warteMs: number = VORLESE_GRENZEN.stimmenWartenMs) {}

  get spricht(): boolean {
    return this.laeuft;
  }

  stopp(): void {
    this.lauf++;
    if (this.laeuft) this.s.stopp();
    this.laeuft = false;
  }

  async lies(text: string, sprache: string): Promise<VorleseErgebnis> {
    this.stopp();
    const meiner = this.lauf;
    const stuecke = vorleseStuecke(text);
    if (stuecke.length === 0) return "leer";
    const stimme = await this.stimmeFuer(sprache);
    if (meiner !== this.lauf) return "abgebrochen";
    if (!stimme) return "keine-stimme";
    this.laeuft = true;
    for (const stueck of stuecke) {
      const ok = await new Promise<boolean>((fertig) => this.s.sprich(stueck, stimme, fertig));
      if (meiner !== this.lauf) return "abgebrochen";
      if (!ok) {
        this.laeuft = false;
        return "abgebrochen";
      }
    }
    this.laeuft = false;
    return "fertig";
  }

  /** Die Stimmen kommen in manchen Browsern erst nach dem Start (`voiceschanged`) – so lange, höchstens `warteMs`. */
  private stimmeFuer(sprache: string): Promise<Stimme | null> {
    const jetzt = this.s.stimmen();
    if (jetzt.length > 0) return Promise.resolve(waehleStimme(jetzt, sprache));
    return new Promise((fertig) => {
      let abmelden = (): void => {};
      const uhr = setTimeout(() => {
        abmelden();
        fertig(waehleStimme(this.s.stimmen(), sprache));
      }, this.warteMs);
      abmelden = this.s.aufStimmen(() => {
        if (this.s.stimmen().length === 0) return;
        clearTimeout(uhr);
        abmelden();
        fertig(waehleStimme(this.s.stimmen(), sprache));
      });
    });
  }
}

/** Der Teil von `speechSynthesis`, den der Vorleser nutzt. */
interface SynthBrowser {
  getVoices(): SpeechSynthesisVoice[];
  speak(u: SpeechSynthesisUtterance): void;
  cancel(): void;
  addEventListener(art: "voiceschanged", f: () => void): void;
  removeEventListener(art: "voiceschanged", f: () => void): void;
}

/**
 * Der Sprecher des Browsers – `null`, wo es `speechSynthesis` nicht gibt (etwa im Android-WebView der Hülle). Jede
 * Äußerung bekommt ausdrücklich eine Stimme aus `getVoices()`, die `localService` meldet: Ohne `voice` nähme der
 * Browser seine Vorgabe, und die kann eine Netzstimme sein. Ist die Stimme nicht (mehr) da, wird nichts gesprochen.
 */
export function browserSprecher(w: unknown = globalThis): Sprecher | null {
  const synth = (w as { speechSynthesis?: SynthBrowser }).speechSynthesis;
  const Aeusserung = (w as { SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance }).SpeechSynthesisUtterance;
  if (!synth || typeof synth.speak !== "function" || typeof Aeusserung !== "function") return null;
  return {
    stimmen: () => synth.getVoices(),
    aufStimmen: (f) => {
      synth.addEventListener("voiceschanged", f);
      return () => synth.removeEventListener("voiceschanged", f);
    },
    sprich: (stueck, stimme, fertig) => {
      const echte = synth.getVoices().find((v) => v === stimme || (v.name === stimme.name && v.lang === stimme.lang));
      if (!echte || echte.localService !== true) {
        fertig(false);
        return;
      }
      const u = new Aeusserung(stueck);
      u.voice = echte;
      u.lang = echte.lang;
      u.onend = () => fertig(true);
      u.onerror = () => fertig(false);
      synth.speak(u);
    },
    stopp: () => synth.cancel(),
  };
}
