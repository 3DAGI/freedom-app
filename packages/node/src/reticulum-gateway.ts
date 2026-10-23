/**
 * Reticulum-Gateway (B-32d2, RN-W7–W10 A, `docs/RETICULUM-ENTWURF.md`): Der Knoten steuert eine RNode selbst – über eine
 * TCP-Brücke zur seriellen Schnittstelle (`socat TCP-LISTEN:4404,reuseaddr FILE:/dev/ttyACM0,raw,b115200` oder ser2net),
 * KISS spricht `RNodeInterface` aus `@reticulum/core`. Kein `rnsd`: Der Knoten ist „Leaf“ wie die App.
 *
 * Funkwerte wie in der App (RN-W10 A): `RETICULUM_REGION` mit den Vorgaben aus `FUNK_REGIONEN`, eigene Werte nur in deren
 * Grenzen (`pruefeFunkParameter()`), die Sendezeit-Sperre der Region in der Firmware, dazu ein Sendezeitkonto (1 % je
 * Stunde) für jedes Paket an die RNode. Die Identität liegt in `~/.freedom/reticulum-identitaet` (0600); eine kaputte
 * Datei wird nie ersetzt – sonst wäre die Adresse still eine andere.
 *
 * Empfangen wird wie über Funk (RN-W9 A): Was der Kern durchlässt (`leseReticulumFelder()`), nimmt `UmschlagAnnahme` –
 * Weiterleitungsaufträge ins Buch, Umschläge einmal ins Netz. Zurück über Reticulum geht erst ab B-32d3.
 */
import net from "node:net";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  FUNK_REGIONEN, Sendezeitkonto, pruefeFunkParameter, pruefeMeshInhalt, reticulumIdentitaet, rnodeOptionen, starteReticulum,
  type FunkParameter, type MeshKind, type NostrEvent, type ReticulumFunk, type RNodeSchnittstelle,
} from "@freedomstack/protocol";
import type { RNodeTransport } from "@reticulum/core/src/interfaces/rnode.js";
import { leseAdresse, type UmschlagAnnahme } from "./gateway-role.js";

export const reticulumIdentitaetDatei = (home = process.env.HOME ?? "."): string => join(home, ".freedom", "reticulum-identitaet");

export interface ReticulumEinstellung {
  host: string;
  port: number;
  region: string;
  parameter: FunkParameter;
}

/**
 * Aus der Umgebung: `FUNK_GATEWAY=rnode:host:port` (Port Pflicht), `RETICULUM_REGION` (Pflicht, eine Kennung aus
 * `FUNK_REGIONEN`), `RETICULUM_WERTE` (frei: Frequenz in Hz, Bandbreite in Hz, Spreizfaktor, Kodierrate, dBm – durch Komma).
 * Was nicht passt, ergibt einen Grund – dann startet das Gateway nicht. Nie still die Vorgabe statt eigener Werte.
 */
export function reticulumAusUmgebung(env: NodeJS.ProcessEnv): { einstellung: ReticulumEinstellung } | { grund: string } {
  const ziel = (env.FUNK_GATEWAY ?? "").replace(/^rnode:/, "");
  let host: string, port: number;
  try {
    ({ host, port } = leseAdresse(ziel));
  } catch {
    return { grund: "FUNK_GATEWAY=rnode:host:port erwartet" };
  }
  const region = FUNK_REGIONEN.find((r) => r.kennung === (env.RETICULUM_REGION ?? "").trim());
  if (!region) return { grund: `RETICULUM_REGION fehlt oder ist unbekannt (${FUNK_REGIONEN.map((r) => r.kennung).join(", ")})` };
  let parameter: FunkParameter = { ...region.vorgabe };
  const werte = (env.RETICULUM_WERTE ?? "").trim();
  if (werte) {
    const z = werte.split(",").map((w) => w.trim());
    if (z.length !== 5 || !z.every((w) => /^\d{1,10}$/.test(w))) return { grund: "RETICULUM_WERTE: Frequenz,Bandbreite,SF,CR,dBm erwartet" };
    const [frequency, bandwidth, spreadingFactor, codingRate, txPower] = z.map(Number) as [number, number, number, number, number];
    parameter = { frequency, bandwidth, spreadingFactor, codingRate, txPower };
  }
  const geprueft = pruefeFunkParameter(region.kennung, parameter);
  if (!geprueft.ok) return { grund: `RETICULUM_WERTE außerhalb der Grenzen von ${region.kennung} (${geprueft.fall})` };
  return { einstellung: { host, port, region: region.kennung, parameter } };
}

/** Die Identität als Datei: gelesen, wenn es sie gibt; neu nur, wenn es sie noch nicht gibt (0600, „wx“). */
export function identitaetsSpeicher(datei: string): { getItem(k: string): string | null; setItem(k: string, v: string): Promise<void> } {
  return {
    getItem: () => (existsSync(datei) ? readFileSync(datei, "utf8").trim() : null),
    setItem: async (_k, v) => {
      mkdirSync(dirname(datei), { recursive: true, mode: 0o700 });
      writeFileSync(datei, `${v}\n`, { mode: 0o600, flag: "wx" });
    },
  };
}

/**
 * Die RNode hinter der TCP-Brücke verbinden – mit den geprüften Werten und der Sendezeit-Sperre der Region. Nach einer
 * Trennung verbindet die Bibliothek neu (alle `neuSek`); die Schnittstelle prüft das Echo der Firmware selbst. Scheitert
 * schon das erste Verbinden, endet auch ihr Versuch im Hintergrund – ohne Kern hätte er keinen Zweck.
 */
export async function verbindeRNodeTcp(
  e: ReticulumEinstellung, o: { postOpenDelayMs?: number; detectTimeout?: number; neuSek?: number } = {},
): Promise<RNodeSchnittstelle> {
  const { RNodeInterface } = await import("@reticulum/core/src/interfaces/rnode.js");
  class RNodeTcp extends RNodeInterface {
    protected _openTransport(): Promise<RNodeTransport> {
      return new Promise((fertig, fehler) => {
        const sock = net.connect(e.port, e.host);
        sock.once("error", fehler);
        sock.once("connect", () => {
          sock.off("error", fehler);
          // Ohne Zuhörer beendete ein Fehler der Brücke den Knoten – das Ende des Stroms meldet die Trennung
          sock.on("error", () => undefined);
          const readable = new ReadableStream<Uint8Array>({
            start(c) {
              sock.on("data", (d: Buffer) => c.enqueue(new Uint8Array(d)));
              sock.on("close", () => {
                try {
                  c.close();
                } catch {
                  // schon geschlossen
                }
              });
            },
            cancel: () => void sock.destroy(),
          });
          fertig({
            readable,
            write: (bytes) => new Promise<void>((ok, nein) => sock.write(bytes, (f) => (f ? nein(f) : ok()))),
            close: () => void sock.destroy(),
          });
        });
      });
    }
  }
  const rnode = new RNodeTcp({
    ...rnodeOptionen(e), name: "freedom-rnode-tcp", autoReconnect: true, reconnectWait: o.neuSek ?? 30,
    postOpenDelayMs: o.postOpenDelayMs ?? 2000, detectTimeout: o.detectTimeout ?? 15,
  });
  try {
    await rnode.connect();
  } catch (e) {
    await rnode.disconnect().catch(() => undefined);
    throw e;
  }
  return rnode;
}

/**
 * Was der Kern durchließ, an die Annahme: nur Umschläge (Bestand, Nachforderungen und Solana-Transaktionen sind nicht
 * Sache des Gateways – über Reticulum gibt es keine Rahmen nachzufordern).
 */
export async function nimmAusReticulum(annahme: UmschlagAnnahme, payload: Uint8Array, kind: MeshKind, now: number): Promise<void> {
  const pr = pruefeMeshInhalt(payload, kind);
  if (!pr.ok || pr.art !== "umschlag") return;
  await annahme.nimm(JSON.parse(new TextDecoder().decode(payload)) as NostrEvent, now);
}

/** Das Gateway starten: Identität, RNode, Kern mit eigenem Konto; jeder Fehler beim Empfang nur mit Namen ins Log. */
export async function starteReticulumGateway(o: {
  einstellung: ReticulumEinstellung; annahme: UmschlagAnnahme; datei: string;
  log: (zeile: string) => void; rnode?: { postOpenDelayMs?: number; detectTimeout?: number; neuSek?: number };
  konto?: Sendezeitkonto; sendeFristMs?: number;
}): Promise<ReticulumFunk> {
  const log = o.log;
  const identitaet = await reticulumIdentitaet(identitaetsSpeicher(o.datei));
  const rnode = await verbindeRNodeTcp(o.einstellung, o.rnode);
  try {
    return await starteReticulum({
      rnode, identitaet, parameter: o.einstellung.parameter, konto: o.konto ?? new Sendezeitkonto(), sendeFristMs: o.sendeFristMs,
      beiEmpfang: (payload, kind) => void nimmAusReticulum(o.annahme, payload, kind, Math.floor(Date.now() / 1000))
        .catch((e) => log(`[funk] ${(e as Error).name}`)),
    });
  } catch (e) {
    await rnode.disconnect().catch(() => undefined);
    throw e;
  }
}
