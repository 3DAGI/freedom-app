/**
 * Mesh-Transfer UI: Nostr-Events als Datei exportieren/importieren.
 *
 * Offline-Kanal: Chat-Verlauf (oder alle ungelesenen DMs) als .json-Datei
 * exportieren -> USB-Stick/Bluetooth/QR -> auf anderem Geraet importieren.
 * Nutzt FileRelay-Format aus dem Protokoll (signierte Events, transport-
 * unabhaengig — Empfaenger verifiziert Signaturen beim Import).
 */

export interface MeshBundle {
  format: "freedom-mesh";
  version: 1;
  exportedAt: number;
  exportedBy: string;
  events: unknown[];
}

/** Events als .json-Datei herunterladen (USB/Bluetooth/Share-Sheet). */
export function exportMeshFile(events: unknown[], exportedBy: string, label = "chat"): void {
  const bundle: MeshBundle = {
    format: "freedom-mesh",
    version: 1,
    exportedAt: Date.now(),
    exportedBy,
    events,
  };
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `freedom-${label}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** .json-Datei oeffnen und Events zurueckgeben (verifiziert Format). */
export async function importMeshFile(file: File): Promise<unknown[]> {
  const text = await file.text();
  let parsed: MeshBundle;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("keine gueltige JSON-datei");
  }
  if (parsed.format !== "freedom-mesh" || !Array.isArray(parsed.events)) {
    throw new Error("kein freedom-mesh-bundle");
  }
  return parsed.events;
}
