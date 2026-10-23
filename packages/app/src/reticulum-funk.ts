/**
 * Reticulum über die RNode (B-32b2, `docs/RETICULUM-ENTWURF.md`, V1–V3): ein Reticulum-Kern mit der RNode als einziger
 * Schnittstelle und dem eigenen LXMF-Ziel (`lxmf.delivery` der Identität aus B-32a). Was ankommt, geht nur weiter, wenn
 * es `leseReticulumFelder()` durchlässt (Daten der App, `pruefeMeshInhalt()`); gesendet wird nur, was
 * `baueReticulumNachricht()` baut.
 *
 * Sendezeit (V3): Jedes Paket an die RNode – Nachrichten, Antworten auf Pfad-Anfragen, Empfangsbestätigungen, Links –
 * geht durch `send()` der Schnittstelle; dort bucht das `Sendezeitkonto` (1 % je Stunde, wie bei Meshtastic) und
 * verwirft still, was nicht mehr hineinpasst – wie ein verlorenes Paket im Funk. Ein Fehler dort ließe den Schreibstrom
 * des Kerns für immer scheitern. Darunter sperrt die Firmware selbst bei der Grenze der Region (B-32b1).
 * Von selbst kündigt die App nichts an; auf eine Pfad-Anfrage nach der eigenen Adresse antwortet der Kern
 * (Grenze „reticulum-ankuendigung“ im Datenschutzbericht).
 */
import { Sendezeitkonto, type MeshKind } from "@freedomstack/protocol";
import type { Identity, Reticulum } from "@reticulum/core";
import type { LXMRouter } from "@reticulum/lxmf/src/router.js";
import type { FunkParameter } from "./rnode-funk.js";
import { baueReticulumNachricht, leseReticulumFelder, ReticulumFehler } from "./reticulum-umschlag.js";

/** Was der Kern von der RNode braucht – `RNodeWebSerialInterface` nach `verbindeRNode()`. */
export interface RNodeSchnittstelle extends EventTarget {
  name: string;
  send(packet: { serialize(): Uint8Array }): Promise<void>;
  disconnect(): Promise<void>;
}

/**
 * Sendezeit eines Pakets mit `bytes` Byte über eine RNode, in Sekunden – Formel von Semtech (explizite Kopfzeile, CRC
 * an), Präambel wie die Firmware (mindestens 18 Symbole, sonst 24 ms). Die Firmware teilt Pakete über 254 Byte in zwei
 * Rahmen mit je einem Byte Kopf.
 */
export function rnodeSendezeit(p: FunkParameter, bytes: number): number {
  const symbol = 2 ** p.spreadingFactor / p.bandwidth;
  const de = symbol > 0.016 ? 1 : 0;
  const praeambel = Math.max(18, Math.ceil(0.024 / symbol));
  const rahmen = (n: number): number => {
    const nutz = 8 + Math.max(Math.ceil((8 * n - 4 * p.spreadingFactor + 28 + 16) / (4 * (p.spreadingFactor - 2 * de))) * p.codingRate, 0);
    return (praeambel + 4.25 + nutz) * symbol;
  };
  const mitKopf = bytes + 1;
  return mitKopf <= 255 ? rahmen(mitKopf) : rahmen(255) + rahmen(mitKopf - 254 + 1);
}

/**
 * Die Gegenstelle (B-32b3): die LXMF-Adresse, an die die App über Reticulum sendet – eine andere App mit Netz, die
 * weiterreicht, später der eigene Knoten (B-32d). Nur in `geheim`: Sie verrät, mit wem man funkt.
 */
export const LS_RETICULUM_GEGENSTELLE = "freedom.reticulum.gegenstelle";

/** Eine LXMF-Adresse aus Text – 32 Zeichen Hex, wie Reticulum sie zeigt auch in spitzen Klammern; sonst null. */
export function leseLxmfAdresse(text: string | null | undefined): Uint8Array | null {
  const m = /^<?([0-9a-fA-F]{32})>?$/.exec((text ?? "").trim());
  return m ? Uint8Array.from(m[1]!.match(/../g)!, (x) => parseInt(x, 16)) : null;
}

/** Wohin eine Direktnachricht über Reticulum geht (B-32c2, W3 A). */
export interface FunkZiel {
  art: "kontakt" | "gegenstelle";
  an: Uint8Array;
}

/** Erst direkt an die Adresse des Kontakts (B-32c1), dann an die Gegenstelle, die weiterreicht – je Adresse einmal. */
export function funkZiele(kontakt: Uint8Array | null, gegenstelle: Uint8Array | null): FunkZiel[] {
  const ziele: FunkZiel[] = [];
  if (kontakt?.length === 16) ziele.push({ art: "kontakt", an: kontakt });
  if (gegenstelle?.length === 16 && !(kontakt && kontakt.every((b, i) => b === gegenstelle[i]))) ziele.push({ art: "gegenstelle", an: gegenstelle });
  return ziele;
}

/**
 * Die Ziele nacheinander versuchen; Ergebnis: wer die Nachricht nahm. Scheitert eines, kommt das nächste – außer bei
 * „sendezeit“: Reicht sie für das erste nicht, reicht sie für das zweite auch nicht. Scheitern alle, wirft der letzte Fehler.
 */
export async function stelleUeberFunkZu(ziele: readonly FunkZiel[], sende: (an: Uint8Array) => Promise<void>): Promise<FunkZiel["art"]> {
  let fehler: unknown = new ReticulumFehler("adresse");
  for (const z of ziele) {
    try {
      await sende(z.an);
      return z.art;
    } catch (e) {
      fehler = e;
      if (e instanceof ReticulumFehler && e.fall === "sendezeit") break;
    }
  }
  throw fehler;
}

/** Konto für die RNode – eines je Sitzung, auch über Trennen und neu Verbinden hinweg. */
export const RETICULUM_KONTO = new Sendezeitkonto();

export interface ReticulumFunk {
  /** Die eigene LXMF-Adresse (16 Byte). */
  readonly adresse: Uint8Array;
  /** Gebucht, verworfen – für die Anzeige und Tests. */
  readonly zaehler: { gesendet: number; verworfen: number };
  /** Umschlag oder Zahlung an eine LXMF-Adresse; wirft `ReticulumFehler` (`sendezeit`, `adresse`, `inhalt` …). */
  sende(an: Uint8Array, payload: Uint8Array, kind: MeshKind, eigeneSchluessel: readonly string[]): Promise<void>;
  stoppe(): Promise<void>;
}

/**
 * Den Kern über einer verbundenen RNode starten. `beiEmpfang` bekommt nur, was die Prüfung durchließ; `konto` und
 * `jetzt` nur für Tests.
 */
export async function starteReticulum(o: {
  rnode: RNodeSchnittstelle; identitaet: Identity; parameter: FunkParameter;
  beiEmpfang: (payload: Uint8Array, kind: MeshKind) => void;
  konto?: Sendezeitkonto; jetzt?: () => number; sendeFristMs?: number;
}): Promise<ReticulumFunk> {
  const konto = o.konto ?? RETICULUM_KONTO;
  const jetzt = o.jetzt ?? (() => Date.now() / 1000);
  const zaehler = { gesendet: 0, verworfen: 0 };
  // Jedes Paket an die RNode geht hier durch – auch was der Kern von sich aus schickt
  const senden = o.rnode.send.bind(o.rnode);
  o.rnode.send = async (packet) => {
    const sek = rnodeSendezeit(o.parameter, packet.serialize().length);
    if (konto.frei(jetzt()) < sek) {
      zaehler.verworfen++;
      return;
    }
    konto.buche(sek, jetzt());
    zaehler.gesendet++;
    await senden(packet);
  };
  const [{ Reticulum: Kern, LogLevel }, { LXMRouter: Router }] = await Promise.all([
    import("@reticulum/core"), import("@reticulum/lxmf/src/router.js"),
  ]);
  // Ohne Speicher: gelernte Pfade und Identitäten gelten nur für diese Sitzung
  const rns: Reticulum = new Kern({ logLevel: LogLevel.ERROR });
  rns.addInterface(o.rnode as never);
  await rns.ready();
  const router: LXMRouter = new Router(o.identitaet, rns);
  await router.init();
  const adresse = router.deliveryDest?.destinationHash;
  if (!adresse) throw new ReticulumFehler("adresse");
  router.addEventListener("message", (e) => {
    const inhalt = leseReticulumFelder((e as CustomEvent<{ message?: { fields?: unknown } }>).detail?.message?.fields);
    if (inhalt) o.beiEmpfang(inhalt.payload, inhalt.kind);
  });
  return {
    adresse, zaehler,
    async sende(an, payload, kind, eigeneSchluessel) {
      const m = await baueReticulumNachricht({ payload, kind, von: o.identitaet, an, eigeneSchluessel });
      // Vorab: Reicht die Sendezeit für die Nachricht selbst nicht, gar nicht erst anfangen
      if (konto.frei(jetzt()) < rnodeSendezeit(o.parameter, payload.length + 112)) throw new ReticulumFehler("sendezeit");
      await router.send(m as never, o.identitaet, { fallback: "opportunistic", timeoutMs: o.sendeFristMs ?? 60_000 });
    },
    async stoppe() {
      await rns.stop();
    },
  };
}
