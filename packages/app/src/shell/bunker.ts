/**
 * Anmelden per Bunker (Schritt 1.3f): Der Schluessel bleibt in einem
 * entfernten Signer (NIP-46, z. B. Amber oder nsecBunker). Die App fragt jede
 * Unterschrift und jede NIP-44-Operation dort an – in ihr liegt nur der
 * Pubkey und ein Wegwerf-Schluessel fuer die Verbindung.
 *
 * Gespeichert wird die Sitzung (Signer, Relays, Client-Schluessel, Nutzer) ueber
 * `geheim` – mit Tresor verschluesselt. Beim Start nimmt die App sie ohne Netz
 * wieder auf; der Schluessel auf diesem Geraet bleibt liegen, Abmelden bringt
 * ihn zurueck. Ohne rohen Schluessel gehen Sicherungsdatei, Export,
 * Zustandssicherung, Nachfolge und abgeleitete Swap-Adressen nicht.
 */
import {
  Nip46Signer, type Nip46Transport, OutboxPool, WebSocketRelay, fromHex, generateKeypair, parseBunkerUri, toHex,
} from "@freedomstack/protocol";
import { pkShort } from "../shell-logic.js";
import { LS_BUNKER, mitBunker, setzeSigner } from "./state.js";
import { geheim } from "./tresor.js";
import { $, toast } from "./ui.js";

const HEX64 = /^[0-9a-f]{64}$/;
/** Freigaben im Signer (Amber, Handy) dauern – eine Minute Zeit. */
const ANTWORT_MS = 60_000;

interface BunkerSitzung {
  signerPubkey: string;
  relays: string[];
  clientSk: string;
  nutzer: string;
}

export type TransportFuer = (relays: string[]) => Nip46Transport;

/** Eigener Pool fuer die Relays des Bunkers – nicht die der App. */
const relaysDesBunkers: TransportFuer = (relays) =>
  new OutboxPool(relays.map((u) => new WebSocketRelay(u, { timeoutMs: 8000 })), { minAcks: 1 });

/** Gespeicherte Sitzung – streng gelesen; Kaputtes zaehlt als keine. */
function ladeSitzung(): BunkerSitzung | null {
  let s: Partial<BunkerSitzung>;
  try { s = JSON.parse(geheim.getItem(LS_BUNKER) ?? "null") ?? {}; } catch { return null; }
  const ok = typeof s.signerPubkey === "string" && HEX64.test(s.signerPubkey)
    && typeof s.clientSk === "string" && HEX64.test(s.clientSk)
    && typeof s.nutzer === "string" && HEX64.test(s.nutzer)
    && Array.isArray(s.relays) && s.relays.length > 0
    && s.relays.every((r) => typeof r === "string" && /^wss:\/\/[^\s]+$/i.test(r));
  return ok ? (s as BunkerSitzung) : null;
}

/** Beim Start: gespeicherte Bunker-Sitzung wieder aufnehmen – ohne Netz. */
export function nimmBunkerAuf(transport: TransportFuer = relaysDesBunkers): boolean {
  const s = ladeSitzung();
  if (!s) return false;
  setzeSigner(new Nip46Signer({ signerPubkey: s.signerPubkey, relays: s.relays }, {
    transport: transport(s.relays), clientSk: fromHex(s.clientSk), nutzer: s.nutzer, timeoutMs: ANTWORT_MS,
  }));
  return true;
}

/** bunker://-Adresse verbinden, Nutzer-Pubkey holen, Sitzung sichern. Danach neu laden. */
export async function meldeMitBunkerAn(uri: string, transport: TransportFuer = relaysDesBunkers): Promise<string> {
  const bunker = parseBunkerUri(uri);
  const clientSk = generateKeypair().sk;
  const signer = new Nip46Signer(bunker, { transport: transport(bunker.relays), clientSk, timeoutMs: ANTWORT_MS });
  const nutzer = await signer.connect();
  // Das Secret der Adresse gilt nur fuer das erste Verbinden – es wird nicht gespeichert.
  const sitzung: BunkerSitzung = { signerPubkey: bunker.signerPubkey, relays: bunker.relays, clientSk: toHex(clientSk), nutzer };
  await geheim.setItem(LS_BUNKER, JSON.stringify(sitzung));
  return nutzer;
}

/** Abmelden: Sitzung loeschen. Beim Neuladen gilt wieder der Schluessel auf diesem Geraet. */
export async function meldeBunkerAb(): Promise<void> {
  await geheim.removeItem(LS_BUNKER);
}

/** Settings → Geraete: Karte „Anmelden per Bunker“. Waehrend ein Geldvorgang laeuft, kein Wechsel. */
export function wireBunkerKarte(beschaeftigt: () => boolean): void {
  const status = $("#bunker-status");
  const feld = $("#bunker-uri") as HTMLInputElement | null;
  const verbinden = $("#bunker-verbinden") as HTMLButtonElement | null;
  const abmelden = $("#bunker-abmelden") as HTMLButtonElement | null;
  if (!status || !feld || !verbinden || !abmelden) return;
  const s = mitBunker() ? ladeSitzung() : null;
  status.textContent = s
    ? `Angemeldet über den Bunker ${pkShort(s.signerPubkey)} (${s.relays.join(", ")}). Jede Unterschrift fragt die App dort an.`
    : "Nicht verbunden – die App nutzt den Schlüssel auf diesem Gerät.";
  feld.hidden = !!s;
  verbinden.hidden = !!s;
  abmelden.hidden = !s;

  verbinden.onclick = async () => {
    if (beschaeftigt()) { toast("Erst den laufenden Tausch oder Auftrag abschließen", true); return; }
    if (!confirm("Die App wechselt auf die Identität im Bunker. Der Schlüssel auf diesem Gerät bleibt gespeichert – Abmelden bringt ihn zurück. Weiter?")) return;
    verbinden.disabled = true;
    status.textContent = "verbinde … (falls nötig im Signer bestätigen)";
    try {
      const pk = await meldeMitBunkerAn(feld.value);
      feld.value = "";
      status.textContent = `Angemeldet als ${pkShort(pk)} – lade neu …`;
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      status.textContent = `Nicht verbunden: ${(e as Error).message}`;
      verbinden.disabled = false;
    }
  };
  abmelden.onclick = async () => {
    if (beschaeftigt()) { toast("Erst den laufenden Tausch oder Auftrag abschließen", true); return; }
    if (!confirm("Vom Bunker abmelden? Danach gilt wieder der Schlüssel auf diesem Gerät.")) return;
    try {
      await meldeBunkerAb();
      location.reload();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
}
