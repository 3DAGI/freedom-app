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
 * Von selbst kündigt der Kern nichts an; auf eine Pfad-Anfrage nach der eigenen Adresse antwortet er
 * (Grenze „reticulum-ankuendigung“ im Datenschutzbericht).
 *
 * Seit B-32d1 im Protokoll: Die App gibt die RNode über WebSerial, der Knoten (B-32d2) über eine TCP-Brücke.
 */
/// <reference path="./reticulum-typen.d.ts" />
import type { Identity, Reticulum } from "@reticulum/core";
import type { LXMRouter } from "@reticulum/lxmf/src/router.js";
import { rnodeSendezeit, type FunkParameter } from "./funk-region.js";
import type { MeshKind, Sendezeitkonto } from "./mesh-transport.js";
import { baueReticulumNachricht, leseReticulumFelder, ReticulumFehler } from "./reticulum-umschlag.js";

/** Was der Kern von der RNode braucht – in der App `RNodeWebSerialInterface` nach `verbindeRNode()`. */
export interface RNodeSchnittstelle extends EventTarget {
  name: string;
  send(packet: { serialize(): Uint8Array }): Promise<void>;
  disconnect(): Promise<void>;
}

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
 * Den Kern über einer verbundenen RNode starten. `beiEmpfang` bekommt nur, was die Prüfung durchließ, dazu die
 * LXMF-Adresse des Absenders (16 Byte), wie die Nachricht sie nennt – signiert ist sie nur, wenn der Kern seine Identität
 * schon kennt; der Knoten funkt dorthin nur Antworten (B-32d3a). `konto` ist eines je Gerät und Sitzung, auch über
 * Trennen und neu Verbinden hinweg; `jetzt` nur für Tests.
 */
export async function starteReticulum(o: {
  rnode: RNodeSchnittstelle; identitaet: Identity; parameter: FunkParameter;
  beiEmpfang: (payload: Uint8Array, kind: MeshKind, von?: Uint8Array) => void;
  konto: Sendezeitkonto; jetzt?: () => number; sendeFristMs?: number;
}): Promise<ReticulumFunk> {
  const konto = o.konto;
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
    const m = (e as CustomEvent<{ message?: { fields?: unknown; sourceHash?: unknown } }>).detail?.message;
    const inhalt = leseReticulumFelder(m?.fields);
    const von = m?.sourceHash instanceof Uint8Array && m.sourceHash.length === 16 ? m.sourceHash.slice() : undefined;
    if (inhalt) o.beiEmpfang(inhalt.payload, inhalt.kind, von);
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
