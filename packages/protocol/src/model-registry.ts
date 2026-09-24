/**
 * Modell-Katalog: Gewichte über das eigene Netz, nicht über einen Anbieter.
 *
 * DAS PROBLEM, DAS DAS LÖST
 * Provider holen ihre Modelle heute von HuggingFace. Das ist dieselbe
 * Abhängigkeit wie bei den Relays und beim Solana-RPC, nur unbemerkt: Wird ein
 * Modell dort entfernt, oder kommt ein Provider von seinem Standort aus nicht
 * hin, bricht die Angebotsseite weg — und zwar genau dort, wo das Netz am
 * nötigsten ist.
 *
 * WIE ES FUNKTIONIERT
 * Ein Modell wird in Stücke zerlegt, über das vorhandene Blob-Netz verteilt
 * und durch ein signiertes Manifest beschrieben: Prüfsummen, Größe, Quantisierung,
 * Bezugsquellen. Wer es lädt, prüft jedes Stück gegen seine Prüfsumme — eine
 * manipulierte Datei fällt auf, egal von wem sie kam.
 *
 * MODELL-AGNOSTISCH, UND ZWAR ABSICHTLICH
 * Der Katalog kennt keine Kategorien, keine Empfehlungen, keine Kuratierung.
 * Er beschreibt, was jemand anbietet, und prüft, ob die Datei echt ist. Was
 * gespiegelt wird, entscheiden die Betreiber — genau wie bei den Relays. Eine
 * kuratierte Liste wäre die zentrale Instanz, die das Projekt nicht haben
 * will, und der erste Ort, an dem jemand Druck ausüben würde.
 *
 * WAS DER KATALOG NICHT LEISTET
 * Er sagt nicht, ob ein Modell gut, sicher oder legal ist. Er sagt, ob die
 * Bytes die sind, die der Anbieter angekündigt hat. Wer mehr behauptet, hat
 * die Grenze nicht verstanden.
 */
import { NostrEvent, UnsignedEvent, buildEvent, getTag } from "./event.js";

/** Beschreibung eines Modells samt Prüfsummen. */
export const KIND_MODEL_MANIFEST = 38057;
/** „Ich halte dieses Modell vor." */
export const KIND_MODEL_SEED = 38058;

export interface ModelFile {
  name: string;
  sha256: string;
  sizeBytes: number;
  /** Blob-Kennung im eigenen Netz, falls dort abgelegt. */
  blobId?: string;
}

export interface ModelManifest {
  /** Eindeutig, z. B. "qwen2.5-7b-instruct-q4". */
  modelId: string;
  /** Anzeigename. */
  name: string;
  /** Quantisierung, z. B. "Q4_K_M". */
  quant?: string;
  /** Parameter in Milliarden — für die Abschätzung des Speicherbedarfs. */
  paramsB?: number;
  files: ModelFile[];
  totalBytes: number;
  /** Woher es ursprünglich stammt. Herkunft ist prüfbar, nicht bloß behauptet. */
  upstream?: string;
  /** Lizenz, wie vom Anbieter angegeben. */
  license?: string;
  publisherPubkey: string;
  createdAt: number;
}

export function buildModelManifest(
  m: Omit<ModelManifest, "createdAt" | "totalBytes">,
  createdAt?: number,
): UnsignedEvent {
  const totalBytes = m.files.reduce((s, f) => s + f.sizeBytes, 0);
  const tags: string[][] = [
    ["d", `model:${m.modelId}`],
    ["model", m.modelId],
    ["name", m.name],
    ["bytes", String(totalBytes)],
  ];
  if (m.quant) tags.push(["quant", m.quant]);
  if (m.paramsB) tags.push(["params_b", String(m.paramsB)]);
  if (m.upstream) tags.push(["upstream", m.upstream]);
  if (m.license) tags.push(["license", m.license]);
  for (const f of m.files) {
    tags.push(["file", f.name, f.sha256, String(f.sizeBytes), f.blobId ?? ""]);
  }
  return buildEvent(m.publisherPubkey, KIND_MODEL_MANIFEST, tags, "", createdAt);
}

export function parseModelManifest(ev: NostrEvent): ModelManifest {
  if (ev.kind !== KIND_MODEL_MANIFEST) throw new Error(`kein Modell-Manifest: kind ${ev.kind}`);
  const modelId = getTag(ev, "model");
  if (!modelId) throw new Error("Manifest ohne Modell-Kennung");

  const files: ModelFile[] = ev.tags
    .filter((t) => t[0] === "file" && t.length >= 4)
    .map((t) => ({
      name: t[1],
      sha256: (t[2] ?? "").toLowerCase(),
      sizeBytes: Number(t[3]),
      blobId: t[4] || undefined,
    }))
    // Ohne gültige Prüfsumme ist eine Datei wertlos: Man könnte sie laden,
    // aber nicht feststellen, ob es die richtige ist.
    .filter((f) => /^[0-9a-f]{64}$/.test(f.sha256) && Number.isFinite(f.sizeBytes) && f.sizeBytes > 0);

  if (files.length === 0) throw new Error("Manifest ohne prüfbare Dateien");

  const params = Number(getTag(ev, "params_b") ?? "");
  return {
    modelId,
    name: getTag(ev, "name") ?? modelId,
    quant: getTag(ev, "quant") ?? undefined,
    paramsB: Number.isFinite(params) && params > 0 ? params : undefined,
    files,
    totalBytes: files.reduce((s, f) => s + f.sizeBytes, 0),
    upstream: getTag(ev, "upstream") ?? undefined,
    license: getTag(ev, "license") ?? undefined,
    publisherPubkey: ev.pubkey,
    createdAt: ev.created_at,
  };
}

/** „Ich halte dieses Modell vor und gebe es weiter." */
export interface ModelSeed {
  modelId: string;
  seederPubkey: string;
  /** Welche Dateien vorliegen — Teilbestände sind ausdrücklich erlaubt. */
  files: string[];
  region?: string;
  createdAt: number;
}

export function buildModelSeed(
  modelId: string, seederPubkey: string, files: string[], region?: string, createdAt?: number,
): UnsignedEvent {
  const tags: string[][] = [
    ["d", `seed:${modelId}`],
    ["model", modelId],
    ...files.map((f) => ["f", f]),
  ];
  if (region) tags.push(["region", region]);
  return buildEvent(seederPubkey, KIND_MODEL_SEED, tags, "", createdAt);
}

export function parseModelSeed(ev: NostrEvent): ModelSeed {
  if (ev.kind !== KIND_MODEL_SEED) throw new Error(`keine Seed-Meldung: kind ${ev.kind}`);
  const modelId = getTag(ev, "model");
  if (!modelId) throw new Error("Seed ohne Modell");
  return {
    modelId,
    seederPubkey: ev.pubkey,
    files: ev.tags.filter((t) => t[0] === "f").map((t) => t[1]),
    region: getTag(ev, "region") ?? undefined,
    createdAt: ev.created_at,
  };
}

export type Availability = "gut" | "knapp" | "gefaehrdet" | "weg";

export interface ModelEntry {
  manifest: ModelManifest;
  /** Wie viele Knoten es vorhalten. */
  seeders: number;
  /** Dateien, die niemand mehr hat — dann ist das Modell unvollständig. */
  missingFiles: string[];
  availability: Availability;
  note: string;
}

export interface RegistryOptions {
  /** Ab wann eine Seed-Meldung als veraltet gilt. */
  maxAgeSeconds?: number;
  nowSecs?: number;
}

/**
 * Baut den Katalog aus Manifesten und Seed-Meldungen.
 *
 * Der wichtigste Wert ist nicht die Zahl der Seeder, sondern ob ALLE Dateien
 * noch verfügbar sind. Ein Modell mit zwanzig Seedern, denen allen dieselbe
 * Datei fehlt, ist nicht ladbar — und sähe in einer reinen Seeder-Zählung
 * bestens aus.
 */
export function buildRegistry(
  events: NostrEvent[],
  opts: RegistryOptions = {},
): { models: ModelEntry[]; unknownSeeds: number } {
  const now = opts.nowSecs ?? Math.floor(Date.now() / 1000);
  const maxAge = opts.maxAgeSeconds ?? 14 * 24 * 3600;

  const manifeste = new Map<string, ModelManifest>();
  for (const ev of events) {
    if (ev.kind !== KIND_MODEL_MANIFEST) continue;
    try {
      const m = parseModelManifest(ev);
      const bisher = manifeste.get(m.modelId);
      if (!bisher || m.createdAt > bisher.createdAt) manifeste.set(m.modelId, m);
    } catch { /* unbrauchbar */ }
  }

  const seeds = new Map<string, Map<string, Set<string>>>(); // modelId -> pubkey -> files
  let unknownSeeds = 0;
  for (const ev of events) {
    if (ev.kind !== KIND_MODEL_SEED) continue;
    if (now - ev.created_at > maxAge) continue;
    try {
      const s = parseModelSeed(ev);
      if (!manifeste.has(s.modelId)) {
        unknownSeeds++;
        continue;
      }
      const proModell = seeds.get(s.modelId) ?? new Map<string, Set<string>>();
      proModell.set(s.seederPubkey, new Set(s.files));
      seeds.set(s.modelId, proModell);
    } catch { /* unbrauchbar */ }
  }

  const models: ModelEntry[] = [...manifeste.values()].map((manifest) => {
    const proModell = seeds.get(manifest.modelId) ?? new Map<string, Set<string>>();
    const seeders = proModell.size;

    const vorhanden = new Set<string>();
    for (const dateien of proModell.values()) for (const f of dateien) vorhanden.add(f);
    const missingFiles = manifest.files.map((f) => f.name).filter((n) => !vorhanden.has(n));

    let availability: Availability;
    let note: string;
    if (missingFiles.length > 0) {
      availability = seeders === 0 ? "weg" : "gefaehrdet";
      note = seeders === 0
        ? "Niemand hält dieses Modell mehr vor."
        : `${missingFiles.length} Datei(en) fehlen im Netz — so nicht ladbar, auch wenn es ${seeders} Seeder gibt.`;
    } else if (seeders >= 5) {
      availability = "gut";
      note = `${seeders} Seeder, vollständig.`;
    } else if (seeders >= 2) {
      availability = "knapp";
      note = `Nur ${seeders} Seeder. Fällt einer aus, wird es eng.`;
    } else {
      availability = "gefaehrdet";
      note = "Ein einziger Seeder. Verschwindet er, ist das Modell weg.";
    }

    return { manifest, seeders, missingFiles, availability, note };
  });

  return {
    models: models.sort((a, b) => b.seeders - a.seeders || a.manifest.name.localeCompare(b.manifest.name)),
    unknownSeeds,
  };
}

/** Prüft eine geladene Datei gegen das Manifest. */
export function verifyFile(
  manifest: ModelManifest,
  fileName: string,
  sha256: string,
): { ok: boolean; message: string } {
  const f = manifest.files.find((x) => x.name === fileName);
  if (!f) {
    return { ok: false, message: `"${fileName}" steht nicht im Manifest von ${manifest.modelId}.` };
  }
  if (f.sha256 !== sha256.toLowerCase()) {
    return {
      ok: false,
      message:
        `Prüfsumme stimmt nicht. Die Datei ist nicht die angekündigte — ` +
        `nicht verwenden, egal von wem sie kam.`,
    };
  }
  return { ok: true, message: "Datei geprüft." };
}

/**
 * Passt das Modell auf die Hardware?
 *
 * Ein Provider soll das VOR dem Download erfahren, nicht nach zwanzig
 * Gigabyte. Die Faustregel ist grob, aber grob und vorher schlägt genau und
 * hinterher.
 */
export function fitsOnDevice(
  manifest: ModelManifest,
  availableGb: number,
): { fits: boolean; neededGb: number; note: string } {
  const gewichteGb = manifest.totalBytes / 1e9;
  // Reserve für KV-Cache und Aktivierungen: grob ein Fünftel.
  const neededGb = gewichteGb * 1.2;
  if (neededGb <= availableGb) {
    return { fits: true, neededGb, note: `${gewichteGb.toFixed(1)} GB Gewichte, passt.` };
  }
  return {
    fits: false,
    neededGb,
    note:
      `Braucht etwa ${neededGb.toFixed(1)} GB, verfügbar sind ${availableGb.toFixed(1)} GB. ` +
      `Eine stärker quantisierte Fassung wäre die Alternative.`,
  };
}

/** Wo fehlen Seeder am dringendsten? Für die Anzeige im Netz. */
export function modelsAtRisk(models: ModelEntry[]): ModelEntry[] {
  return models
    .filter((m) => m.availability === "gefaehrdet" || m.availability === "weg")
    .sort((a, b) => a.seeders - b.seeders);
}
