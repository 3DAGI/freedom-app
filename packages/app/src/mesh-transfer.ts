/**
 * Mesh-Transfer UI: Umschlaege als Datei exportieren/importieren.
 *
 * Offline-Kanal: die Post fuer einen Kontakt als .json-Datei mitnehmen ->
 * USB-Stick/Bluetooth/QR -> auf einem Geraet mit Netz importieren, das sie
 * an die Relays gibt.
 *
 * Seit 7.1 nur Umschlaege (NIP-59): Die Datei ist ein Mesh-Paket wie jedes
 * andere, wer sie findet, soll weder Inhalt noch Absender sehen. Deshalb auch
 * kein `exportedBy` mehr im Kopf – bis 7.1 stand dort der eigene npub.
 */
import { MeshKind, pruefeMeshInhalt, type NostrEvent } from "@freedomstack/protocol";

export interface MeshBundle {
  format: "freedom-mesh";
  /** 2 seit 7.1: nur Umschlaege, kein Absender im Kopf. */
  version: 2;
  exportedAt: number;
  events: NostrEvent[];
}

/** Darf dieses Event in eine Mesh-Datei? Dieselbe Regel wie ueber Funk. */
function erlaubt(ev: unknown, eigeneSchluessel: readonly string[]): ev is NostrEvent {
  let bytes: Uint8Array;
  try {
    bytes = new TextEncoder().encode(JSON.stringify(ev));
  } catch {
    return false;
  }
  return pruefeMeshInhalt(bytes, MeshKind.NostrEvent, { eigeneSchluessel }).ok;
}

/**
 * Buendel bauen: nur Umschlaege, keiner mit einem eigenen Schluessel (auch
 * nicht als Empfaenger). `abgelehnt` zaehlt, was draussen blieb.
 */
export function baueMeshBuendel(
  events: readonly unknown[],
  eigeneSchluessel: readonly string[],
  jetzt = Date.now(),
): { bundle: MeshBundle; abgelehnt: number } {
  const ok = events.filter((e): e is NostrEvent => erlaubt(e, eigeneSchluessel));
  return {
    bundle: { format: "freedom-mesh", version: 2, exportedAt: jetzt, events: ok },
    abgelehnt: events.length - ok.length,
  };
}

/**
 * Buendel lesen: nur Umschlaege mit gueltiger Signatur kommen durch. Aeltere
 * Dateien (Version 1, mit Kind 4/42 und npub) werden gelesen, ihr Offenes
 * aber abgelehnt.
 */
export function leseMeshBuendel(text: string): { events: NostrEvent[]; abgelehnt: number } {
  let parsed: { format?: unknown; events?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("keine gueltige JSON-datei");
  }
  if (parsed?.format !== "freedom-mesh" || !Array.isArray(parsed.events)) {
    throw new Error("kein freedom-mesh-bundle");
  }
  const events = parsed.events.filter((e): e is NostrEvent => erlaubt(e, []));
  return { events, abgelehnt: parsed.events.length - events.length };
}

/** Umschlaege als .json-Datei herunterladen (USB/Bluetooth/Share-Sheet). */
export function exportMeshFile(
  events: readonly unknown[],
  eigeneSchluessel: readonly string[],
): { exportiert: number; abgelehnt: number } {
  const { bundle, abgelehnt } = baueMeshBuendel(events, eigeneSchluessel);
  if (bundle.events.length === 0) return { exportiert: 0, abgelehnt };
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  // Neutraler Name: der Dateiname soll keinen Kontakt verraten.
  a.download = `freedom-post-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  return { exportiert: bundle.events.length, abgelehnt };
}

/** .json-Datei oeffnen und die Umschlaege zurueckgeben. */
export async function importMeshFile(file: File): Promise<{ events: NostrEvent[]; abgelehnt: number }> {
  return leseMeshBuendel(await file.text());
}
