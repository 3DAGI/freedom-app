/**
 * Release-Manifest: die App überlebt den Verlust der Domain.
 *
 * DAS PROBLEM
 * Die App ist eine einzelne HTML-Datei — die beste Verteilungsform, die es
 * gibt. Aber sie kommt von einer Domain. Eine Domain ist beschlagnahmbar, ein
 * Hoster kündbar, ein DNS-Eintrag manipulierbar. Und wer eine weitergereichte
 * Kopie bekommt, hat keine Möglichkeit zu prüfen, ob sie echt ist.
 *
 * Das ist der zweite Punkt, an dem ein „unabschaltbares" System doch
 * abschaltbar war: Nicht das Protokoll, sondern der Bezugsweg.
 *
 * DIE LÖSUNG
 * Jede Veröffentlichung bekommt ein signiertes Manifest auf den Relays: welche
 * Version, welche Prüfsumme, welche Bezugsquellen. Damit gilt:
 *
 * - Eine Kopie von einem USB-Stick, aus einem Chat oder von einem fremden
 *   Server lässt sich gegen die Prüfsumme halten. Stimmt sie, ist die Datei
 *   echt — egal woher sie kam.
 * - Fällt die Domain aus, nennt das Manifest die übrigen Quellen.
 * - Die App kann sich selbst exportieren. Jede Installation wird damit zu
 *   einer Bezugsquelle.
 *
 * WAS DAS NICHT LEISTET
 * Es schützt nicht davor, dass jemand den Signierschlüssel stiehlt. Und es
 * hilft nur, wer das Manifest findet — deshalb liegt es auf den Relays und
 * nicht auf demselben Server wie die Datei. Ein Manifest neben der Datei wäre
 * wertlos: Wer die Datei austauschen kann, tauscht auch das Manifest aus.
 */
import { NostrEvent, UnsignedEvent, buildEvent, getTag } from "./event.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** Signiertes Release-Manifest. */
export const KIND_RELEASE_MANIFEST = 38054;

export interface ReleaseArtifact {
  /** Dateiname, z. B. "freedom.html". */
  name: string;
  /** SHA-256 der Datei in Hex. */
  sha256: string;
  sizeBytes: number;
}

export interface ReleaseManifest {
  version: string;
  /** Unix-Zeit der Veröffentlichung. */
  releasedAt: number;
  artifacts: ReleaseArtifact[];
  /** Bezugsquellen. Mehrere, damit der Ausfall einer nichts bedeutet. */
  sources: string[];
  /** Pubkey des Signierschlüssels — der Anker des Vertrauens. */
  signerPubkey: string;
  notes?: string;
}

export async function hashBytes(data: Uint8Array): Promise<string> {
  return bytesToHex(sha256(data));
}

/** Prüfsumme einer Zeichenkette (z. B. der HTML-Datei). */
export function hashText(text: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(text)));
}

export function buildReleaseManifest(
  m: Omit<ReleaseManifest, "signerPubkey">,
  signerPubkey: string,
  createdAt?: number,
): UnsignedEvent {
  const tags: string[][] = [
    ["d", `release:${m.version}`],
    ["version", m.version],
    ["released_at", String(m.releasedAt)],
  ];
  for (const a of m.artifacts) {
    tags.push(["artifact", a.name, a.sha256, String(a.sizeBytes)]);
  }
  for (const s of m.sources) tags.push(["source", s]);
  if (m.notes) tags.push(["notes", m.notes]);
  return buildEvent(signerPubkey, KIND_RELEASE_MANIFEST, tags, m.notes ?? "", createdAt);
}

export function parseReleaseManifest(ev: NostrEvent): ReleaseManifest {
  if (ev.kind !== KIND_RELEASE_MANIFEST) {
    throw new Error(`kein Release-Manifest: kind ${ev.kind}`);
  }
  const version = getTag(ev, "version");
  if (!version) throw new Error("Manifest ohne Version");

  const artifacts = ev.tags
    .filter((t) => t[0] === "artifact" && t.length >= 3)
    .map((t) => ({ name: t[1], sha256: (t[2] ?? "").toLowerCase(), sizeBytes: Number(t[3] ?? 0) }))
    .filter((a) => /^[0-9a-f]{64}$/.test(a.sha256));

  return {
    version,
    releasedAt: Number(getTag(ev, "released_at") ?? ev.created_at),
    artifacts,
    sources: ev.tags.filter((t) => t[0] === "source" && t[1]).map((t) => t[1]),
    signerPubkey: ev.pubkey,
    notes: getTag(ev, "notes") ?? undefined,
  };
}

export type VerifyStatus = "echt" | "abweichend" | "unbekannt";

export interface VerifyResult {
  status: VerifyStatus;
  /** Welche Version die Datei ist, falls erkannt. */
  version?: string;
  /** Klartext für die Anzeige. */
  message: string;
}

/**
 * Prüft eine Datei gegen bekannte Manifeste.
 *
 * `trustedSigners` ist der Kern: Ohne festgelegte Signierschlüssel könnte
 * jeder ein Manifest für seine eigene manipulierte Datei veröffentlichen und
 * sie damit als „echt" ausweisen. Die Prüfung ist nur so viel wert wie die
 * Liste der akzeptierten Signierer.
 */
export function verifyArtifact(
  fileHash: string,
  artifactName: string,
  manifests: ReleaseManifest[],
  trustedSigners: string[],
): VerifyResult {
  const hash = fileHash.toLowerCase();
  const vertrauenswuerdig = manifests.filter((m) => trustedSigners.includes(m.signerPubkey));

  if (vertrauenswuerdig.length === 0) {
    return {
      status: "unbekannt",
      message:
        "Kein Manifest eines bekannten Signierers gefunden. Die Datei lässt sich " +
        "nicht prüfen — das heißt nicht, dass sie falsch ist, nur dass niemand " +
        "für sie bürgt.",
    };
  }

  for (const m of vertrauenswuerdig) {
    const a = m.artifacts.find((x) => x.name === artifactName);
    if (a && a.sha256 === hash) {
      return {
        status: "echt",
        version: m.version,
        message: `Geprüft: Version ${m.version}, Prüfsumme stimmt mit dem signierten Manifest überein.`,
      };
    }
  }

  // Der Name kommt vor, die Prüfsumme nicht — das ist der interessante Fall.
  const kenntNamen = vertrauenswuerdig.some((m) => m.artifacts.some((a) => a.name === artifactName));
  if (kenntNamen) {
    return {
      status: "abweichend",
      message:
        "Diese Datei stimmt mit KEINER veröffentlichten Version überein. Entweder " +
        "ist sie älter als die bekannten Manifeste — oder sie wurde verändert. " +
        "Im Zweifel aus einer der genannten Quellen neu beziehen.",
    };
  }
  return {
    status: "unbekannt",
    message: `Für "${artifactName}" gibt es kein Manifest eines bekannten Signierers.`,
  };
}

/** Neuestes Manifest eines vertrauenswürdigen Signierers. */
export function latestRelease(
  manifests: ReleaseManifest[],
  trustedSigners: string[],
): ReleaseManifest | null {
  const gueltig = manifests
    .filter((m) => trustedSigners.includes(m.signerPubkey))
    .sort((a, b) => b.releasedAt - a.releasedAt);
  return gueltig[0] ?? null;
}

/**
 * Alle bekannten Bezugsquellen, dedupliziert.
 *
 * Sortiert so, dass nicht-webbasierte Quellen zuerst kommen: Wenn die Domain
 * ausgefallen ist, hilft eine weitere Domain am wenigsten.
 */
export function allSources(manifests: ReleaseManifest[], trustedSigners: string[]): string[] {
  const alle = new Set<string>();
  for (const m of manifests) {
    if (!trustedSigners.includes(m.signerPubkey)) continue;
    for (const s of m.sources) alle.add(s);
  }
  const rang = (s: string): number => {
    if (s.startsWith("magnet:") || s.startsWith("ipfs://")) return 0;
    if (s.startsWith("nostr:") || s.startsWith("freedom-blob:")) return 1;
    return 2;
  };
  return [...alle].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b));
}

/**
 * Anleitung zum Weitergeben — der eigentliche Zweck der ganzen Übung.
 *
 * Steht bewusst als fertiger Text bereit: Wer eine App weitergibt, soll die
 * Prüfanleitung mitgeben können, ohne sie selbst formulieren zu müssen.
 */
export function sharingInstructions(hash: string, version: string): string {
  return [
    `FreedomStack ${version}`,
    "",
    "Diese Datei ist die vollständige App. Sie braucht keine Installation und",
    "keinen Server — im Browser öffnen genügt.",
    "",
    "Echtheit prüfen (empfohlen, wenn du sie nicht selbst heruntergeladen hast):",
    `  sha256sum freedom.html`,
    `  erwartet: ${hash}`,
    "",
    "Stimmt die Prüfsumme, ist die Datei unverändert — unabhängig davon, woher",
    "sie kam. Stimmt sie nicht, nicht benutzen.",
    "",
    "Die Prüfsumme steht signiert auf den Nostr-Relays (kind 38054), nicht nur",
    "hier. Wer die Datei austauschen könnte, könnte diesen Text mit austauschen.",
  ].join("\n");
}
