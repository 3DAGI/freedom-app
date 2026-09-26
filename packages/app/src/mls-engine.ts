/**
 * MLS-Engine in der App (Schritt 2.2b-b).
 *
 * Die Engine (MDK als WASM, `packages/mls`) steckt gzip-komprimiert als
 * Base64-Text im einen Skript von freedom.html – mit dessen CSP-Hash
 * abgedeckt, ohne Nachladen von außen. Entpackt und gestartet wird sie erst,
 * wenn sie gebraucht wird (`mlsEngine()`), einmal je Seite; bis dahin kostet
 * sie nur die Bytes im Download. Übersetzen darf die Seite WASM nur dank
 * `'wasm-unsafe-eval'` in der CSP (`build.mjs`).
 */
import { schnorr } from "@noble/curves/secp256k1.js";
import { LocalSigner, fromHex, generateKeypair, toHex, type NostrEvent } from "@freedomstack/protocol";
import { Mls, starteMls } from "@freedomstack/mls";

/** Liefert die Engine als Base64 der `.wasm.gz`. */
export type WasmQuelle = () => Promise<string>;

// Dynamischer Import: esbuild bündelt ihn ins eine Skript (Loader base64), der
// Text wird aber erst beim ersten Aufruf dekodiert.
const eingebettet: WasmQuelle = async () => (await import("@freedomstack/mls/wasm")).default;

/** Base64 → gzip entpacken (DecompressionStream, im Browser und in Node). */
export async function entpacke(base64: string): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Dieser Browser kann die MLS-Engine nicht entpacken (DecompressionStream fehlt).");
  }
  const bin = atob(base64);
  const gz = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) gz[i] = bin.charCodeAt(i);
  const strom = new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(strom).arrayBuffer());
}

let start: Promise<void> | null = null;

/** Engine laden und starten – beim ersten Aufruf, danach sofort. */
export function mlsEngine(quelle: WasmQuelle = eingebettet): Promise<void> {
  if (!start) {
    start = (async () => {
      if (typeof WebAssembly === "undefined") throw new Error("Dieser Browser kann kein WebAssembly – MLS nicht verfügbar.");
      const wasm = await entpacke(await quelle());
      try {
        await starteMls(wasm);
      } catch (e) {
        // CSP ohne 'wasm-unsafe-eval' (älterer Browser) meldet sich als CompileError.
        const name = e instanceof Error ? e.name : "Fehler";
        throw new Error(`MLS-Engine startet nicht (${name}).`);
      }
    })();
    // Gescheitert: beim nächsten Aufruf neu versuchen, nicht den Fehler merken.
    start.catch(() => { start = null; });
  }
  return start;
}

export interface Selbsttest {
  ok: boolean;
  /** Dauer in ms, samt erstem Laden der Engine. */
  ms: number;
  /** Was geprüft wurde bzw. woran es scheiterte (feste Texte, kein Fremdtext). */
  text: string;
}

function wegwerfKonto() {
  const kp = generateKeypair();
  const signer = new LocalSigner(kp.sk);
  const mls = new Mls(signer, (idHex) => toHex(schnorr.sign(fromHex(idHex), kp.sk)));
  return { pk: kp.pk, signer, mls };
}

/**
 * Selbsttest ohne Netz und ohne die eigene Identität: zwei Wegwerf-Konten
 * im Speicher – KeyPackage, Gruppe, Einladung, eine Nachricht hin, lesen.
 * Zeigt, ob die Engine in diesem Browser läuft (CSP, WASM, Entpacken).
 */
export async function mlsSelbsttest(quelle?: WasmQuelle): Promise<Selbsttest> {
  const t0 = performance.now();
  const fertig = (ok: boolean, text: string): Selbsttest => ({ ok, ms: Math.round(performance.now() - t0), text });
  try {
    await mlsEngine(quelle);
  } catch (e) {
    return fertig(false, e instanceof Error && e.message.startsWith("Dieser Browser") ? e.message : "Die MLS-Engine startet in diesem Browser nicht.");
  }
  try {
    const [a, b] = [wegwerfKonto(), wegwerfKonto()];
    const kp: NostrEvent = await b.signer.signEvent(await b.mls.keyPackage("selbsttest"));
    // Die Gruppe braucht ein Relay in ihren Daten; gesendet wird nichts (.invalid löst nie auf).
    const g = await a.mls.gruppeAnlegen("Selbsttest", [kp], ["wss://selbsttest.invalid"]);
    if ((await b.mls.beitreten(g.einladungen[0])) !== g.gruppe) return fertig(false, "Beitritt scheiterte.");
    const probe = "Probe " + toHex(crypto.getRandomValues(new Uint8Array(4)));
    const s = await a.mls.senden(g.gruppe, probe);
    if (s.events[0]?.content.includes(probe)) return fertig(false, "Nachricht nicht verschlüsselt.");
    const r = await b.mls.empfangen(s.events[0]);
    if (r.nachrichten[0]?.text !== probe || r.nachrichten[0]?.von !== a.pk) return fertig(false, "Nachricht kam nicht an.");
    return fertig(true, "Gruppe angelegt, eingeladen, Nachricht verschlüsselt und gelesen.");
  } catch {
    return fertig(false, "Der Ablauf scheiterte.");
  }
}
