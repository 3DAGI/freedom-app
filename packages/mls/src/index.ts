/**
 * MLS nach Marmot (Schritt 2.2b) – TypeScript-Seite des Bausteins.
 *
 * Die Engine ist MDK als WASM (`dist/`, gebaut mit `bauen.sh`). Hier: laden,
 * die zwei Brücken zum Signer der App und typisierte Ergebnisse. Den
 * Identitätsschlüssel sieht die Engine nie – sie bittet nur um Signaturen,
 * und beide Brücken signieren nur das, wofür sie da sind:
 * - der Kontobeweis nur ein Marmot-Beweis-Event (Kind 450) der eigenen Identität,
 * - der Signer nur Siegel (Kind 13, NIP-59) der eigenen Identität für Einladungen.
 */
import { computeEventId, type NostrEvent, type Signer, type UnsignedEvent } from "@freedomstack/protocol";
import { MlsKonto, initSync } from "../dist/freedom_mls.js";

export const KIND_KEY_PACKAGE = 30443;
export const KIND_GRUPPENNACHRICHT = 445;
export const KIND_KONTOBEWEIS = 450;
const KIND_SIEGEL = 13;
const BEWEIS_D = "marmot.account-identity-proof.v2";
const BEWEIS_TEXT = "Authorize this MLS leaf key for my Marmot account";

let geladen = false;

/** Engine aus den (entpackten) WASM-Bytes laden – einmal je Seite. */
export function ladeMls(wasm: BufferSource): void {
  if (geladen) return;
  initSync({ module: wasm });
  geladen = true;
}

function kern(ev: Record<string, unknown>): UnsignedEvent {
  const { pubkey, created_at, kind, tags, content } = ev as unknown as UnsignedEvent;
  return { pubkey, created_at, kind, tags, content };
}

/** Kontobeweis: prüft das Event, dann signiert `signiere(idHex)` synchron (Schnorr). */
export function beweisBruecke(pk: string, signiere: (idHex: string) => string): (json: string) => string {
  return (json) => {
    const ev = kern(JSON.parse(json) as Record<string, unknown>);
    const d = ev.tags.find((t) => t[0] === "d")?.[1];
    if (ev.kind !== KIND_KONTOBEWEIS || ev.pubkey !== pk || ev.content !== BEWEIS_TEXT || d !== BEWEIS_D) {
      throw new Error("kein Marmot-Kontobeweis – nicht signiert");
    }
    return signiere(computeEventId(ev));
  };
}

/** Signer der App (auch NIP-46) für Einladungen: nur Siegel der eigenen Identität. */
export function signerBruecke(signer: Signer) {
  return {
    signEvent: async (json: string): Promise<string> => {
      const ev = kern(JSON.parse(json) as Record<string, unknown>);
      if (ev.kind !== KIND_SIEGEL || ev.pubkey !== signer.publicKey()) throw new Error("nur Siegel (Kind 13) – nicht signiert");
      return JSON.stringify(await signer.signEvent(ev));
    },
    nip44Encrypt: (pk: string, text: string) => signer.nip44Encrypt(pk, text),
    nip44Decrypt: (pk: string, text: string) => signer.nip44Decrypt(pk, text),
  };
}

export interface MlsNachricht {
  gruppe: string;
  /** Identität des Absenders (hex), von MLS authentifiziert. */
  von: string;
  text: string;
  zeit: number;
  id: string;
}

export interface MlsEmpfang {
  /** `Processed`, `Buffered`, `Ignored`, `LocalState`, … bzw. `beigetreten`. */
  ergebnis: string;
  nachrichten: MlsNachricht[];
  /** Gruppen, deren Zustand sich änderte (Mitglieder, Epoche). */
  geaendert: string[];
}

export interface MlsSenden {
  /** Signierte Events in dieser Reihenfolge veröffentlichen. */
  events: NostrEvent[];
  /** Nach dem Veröffentlichen `bestaetigt()` bzw. `gescheitert()` damit rufen. */
  ausstehend: string | null;
  /** Einladungen (Kind 1059) an neue Mitglieder. */
  einladungen: NostrEvent[];
}

const alsEvents = (l: string[]): NostrEvent[] => l.map((e) => JSON.parse(e) as NostrEvent);

function senden(json: string): MlsSenden {
  const r = JSON.parse(json) as { events: string[]; ausstehend: string | null; einladungen: string[] };
  return { events: alsEvents(r.events), ausstehend: r.ausstehend ?? null, einladungen: alsEvents(r.einladungen ?? []) };
}

/** Ein MLS-Konto: eine Identität auf diesem Gerät, Zustand im Speicher. */
export class Mls {
  readonly konto: MlsKonto;

  constructor(signer: Signer, signiereBeweis: (idHex: string) => string, zustand?: Uint8Array) {
    const pk = signer.publicKey();
    this.konto = new MlsKonto(pk, beweisBruecke(pk, signiereBeweis), signerBruecke(signer), zustand ?? null);
  }

  /** Unsigniertes KeyPackage-Event (Kind 30443); `platz`: d-Tag dieses Geräts. */
  async keyPackage(platz: string): Promise<UnsignedEvent> {
    return JSON.parse(await this.konto.keyPackageEvent(platz)) as UnsignedEvent;
  }

  async gruppeAnlegen(name: string, keyPackages: NostrEvent[], relays: string[]): Promise<{ gruppe: string; einladungen: NostrEvent[] }> {
    const r = JSON.parse(await this.konto.gruppeAnlegen(name, keyPackages.map((k) => JSON.stringify(k)), relays)) as { gruppe: string; einladungen: string[] };
    return { gruppe: r.gruppe, einladungen: alsEvents(r.einladungen) };
  }

  async beitreten(einladung: NostrEvent): Promise<string> {
    return (await this.konto.beitreten(JSON.stringify(einladung))) as string;
  }

  async senden(gruppe: string, text: string): Promise<MlsSenden> {
    return senden(await this.konto.senden(gruppe, text));
  }

  async einladen(gruppe: string, keyPackages: NostrEvent[]): Promise<MlsSenden> {
    return senden(await this.konto.einladen(gruppe, keyPackages.map((k) => JSON.stringify(k))));
  }

  async entfernen(gruppe: string, mitglieder: string[]): Promise<MlsSenden> {
    return senden(await this.konto.entfernen(gruppe, mitglieder));
  }

  bestaetigt(ausstehend: string): Promise<void> {
    return this.konto.bestaetigt(ausstehend);
  }

  gescheitert(ausstehend: string): Promise<void> {
    return this.konto.gescheitert(ausstehend);
  }

  async empfangen(event: NostrEvent): Promise<MlsEmpfang> {
    return JSON.parse(await this.konto.empfangen(JSON.stringify(event))) as MlsEmpfang;
  }

  /** ms bis `fortschreiten()` sinnvoll ist; undefined, wenn nichts gepuffert ist. */
  wartezeit(gruppe: string): number | undefined {
    return this.konto.wartezeit(gruppe);
  }

  async fortschreiten(gruppe: string): Promise<MlsEmpfang & { events: NostrEvent[]; ausstehend: string | null }> {
    const r = JSON.parse(await this.konto.fortschreiten(gruppe)) as { nachrichten: MlsNachricht[]; geaendert: string[]; events: string[]; ausstehend: string | null };
    return { ergebnis: "fortgeschritten", nachrichten: r.nachrichten, geaendert: r.geaendert, events: alsEvents(r.events), ausstehend: r.ausstehend ?? null };
  }

  mitglieder(gruppe: string): string[] {
    return this.konto.mitglieder(gruppe);
  }

  gruppen(): string[] {
    return this.konto.gruppen();
  }

  epoche(gruppe: string): number {
    return this.konto.epoche(gruppe);
  }

  /** Ganzer Zustand (SQLite) – gehört verschlüsselt in den Tresor, nie offen abgelegt. */
  zustand(): Uint8Array {
    return this.konto.zustand();
  }
}
