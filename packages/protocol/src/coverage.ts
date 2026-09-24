/**
 * Abdeckungskarte: wo funktioniert das Netz — online und per Funk.
 *
 * MEINE EINSCHÄTZUNG ZUR IDEE, VORWEG
 * Die Karte ist wertvoll: Sie beantwortet die eine Frage, die ein Interessent
 * wirklich hat („funktioniert das bei mir?"), und für die Ausfall-Geschichte
 * ist sie das entscheidende Bild. Aber sie hat eine Schattenseite, die man
 * nicht mit „teilanonym" wegbekommt:
 *
 * **Eine Karte von Funkknoten ist eine Karte von Menschen, die Funkgeräte
 * besitzen und zensurresistente Infrastruktur betreiben.** Genau in den
 * Regimen, in denen das Projekt am meisten Sinn ergibt, ist diese Karte eine
 * Zielliste. Ein Punkt mit genug Genauigkeit ist ein Haushalt.
 *
 * DESHALB: ZWEI VERSCHIEDENE MODELLE, NICHT EINES
 *
 * *Online-Provider* haben ohnehin eine öffentliche IP, die jeder sieht, der
 * sich verbindet. Sie regional anzuzeigen fügt kaum Risiko hinzu. Hier ist
 * Genauigkeit auf Landes- oder Regionsebene vertretbar.
 *
 * *Funkknoten* sind etwas völlig anderes: physischer Standort, Funktechnik,
 * in manchen Ländern strafbar. Für sie gilt:
 *   - Nur grobe Zellen (~50 km), nie Einzelmarkierungen.
 *   - Erst ab k Knoten in einer Zelle wird überhaupt etwas angezeigt. Eine
 *     Zelle mit einem Knoten ist eine Adresse.
 *   - Ausdrückliches Opt-in, Voreinstellung aus.
 *   - Kein Verlauf. Bewegungsmuster über die Zeit sind deutlich
 *     identifizierender als ein einzelner Punkt — eine Karte, die gestern
 *     kennt, verrät mehr als eine, die nur heute kennt.
 *   - Der Knoten wählt seine Zelle SELBST und veröffentlicht nie Koordinaten.
 *
 * Und die unbequeme Ehrlichkeit: Eine Karte, die zeigt, wo Funk funktioniert,
 * zeigt auch, wo er nicht funktioniert — das ist für jemanden, der eine
 * Abschaltung plant, eine nützliche Information. Der Nutzen für die Nutzer
 * überwiegt meiner Einschätzung nach, aber es ist ein Tausch, kein Gewinn.
 */
import { NostrEvent, UnsignedEvent, buildEvent, getTag } from "./event.js";

/** Abdeckungs-Ankündigung eines Knotens. */
export const KIND_COVERAGE = 38055;

/**
 * Ebenen der Abdeckung.
 *
 * `mesh` war ursprünglich eine Sammelkategorie. Funk und Bluetooth sind aber
 * zwei völlig verschiedene Aussagen: LoRa reicht Kilometer und trägt Text,
 * Bluetooth reicht Meter und trägt Dateien. Wer beides zusammenwirft, zeigt
 * einem Nutzer „Abdeckung vorhanden" und meint etwas, das ihm nicht hilft.
 */
export type CoverageLayer = "online" | "lora" | "bluetooth";

export const LAYER_LABEL: Record<CoverageLayer, string> = {
  online: "Provider im Netz",
  lora: "Funk (LoRa)",
  bluetooth: "Bluetooth",
};

/**
 * Zellgröße je Ebene, in Grad.
 *
 * Bluetooth reicht nur Meter — eine Zelle dieser Größe wäre praktisch eine
 * Adresse. Deshalb wird sie GRÖBER angezeigt als die von LoRa, nicht feiner:
 * Die Anzeige sagt „hier gibt es Leute mit Bluetooth-Geräten", nicht wo.
 */
export const LAYER_CELL_DEGREES: Record<CoverageLayer, number> = {
  online: 2,
  lora: 0.5,
  bluetooth: 1,
};

/**
 * Mindestzahl an Knoten je Zelle, bevor etwas angezeigt wird.
 *
 * Der wichtigste Wert in dieser Datei. Bei k=1 wäre die Karte eine Adressliste.
 */
export const K_ANONYMITY = 3;

/** Kantenlänge der Funk-Zellen in Grad (~55 km bei mittleren Breiten). */
export const MESH_CELL_DEGREES = 0.5;

/** Online-Provider dürfen genauer sein — ihre IP ist ohnehin sichtbar. */
export const ONLINE_CELL_DEGREES = 2;

export interface CoverageAnnouncement {
  pubkey: string;
  layer: CoverageLayer;
  /** Grobe Zelle, vom Knoten selbst gewählt. Nie Koordinaten. */
  cell: string;
  region: string;
  /** Bei Funk: ungefähre Reichweite in km, wie der Betreiber sie einschätzt. */
  rangeKm?: number;
  createdAt: number;
}

/**
 * Rundet Koordinaten auf eine Zelle.
 *
 * Läuft ausschließlich lokal auf dem Gerät des Nutzers — die genauen
 * Koordinaten verlassen es nie. Was veröffentlicht wird, ist das Ergebnis.
 */
export function toCell(lat: number, lon: number, degrees: number): string {
  const rund = (v: number): number => Math.floor(v / degrees) * degrees;
  // Auf eine feste Nachkommastelle bringen, damit dieselbe Zelle immer
  // dieselbe Zeichenkette ergibt.
  return `${rund(lat).toFixed(2)},${rund(lon).toFixed(2)}`;
}

export function cellCenter(cell: string, degrees: number): { lat: number; lon: number } | null {
  const [a, b] = cell.split(",").map(Number);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { lat: a + degrees / 2, lon: b + degrees / 2 };
}

export function buildCoverageAnnouncement(
  a: Omit<CoverageAnnouncement, "createdAt">,
  createdAt?: number,
): UnsignedEvent {
  const tags: string[][] = [
    ["d", `coverage:${a.layer}`],
    ["layer", a.layer],
    ["cell", a.cell],
    ["region", a.region],
  ];
  if (a.rangeKm) tags.push(["range_km", String(Math.round(a.rangeKm))]);
  return buildEvent(a.pubkey, KIND_COVERAGE, tags, "", createdAt);
}

export function parseCoverageAnnouncement(ev: NostrEvent): CoverageAnnouncement {
  if (ev.kind !== KIND_COVERAGE) throw new Error(`keine Abdeckungs-Meldung: kind ${ev.kind}`);
  const layer = getTag(ev, "layer");
  const cell = getTag(ev, "cell");
  if (layer !== "online" && layer !== "lora" && layer !== "bluetooth") {
    throw new Error("Meldung ohne gültige Ebene");
  }
  if (!cell || !/^-?\d+\.\d{2},-?\d+\.\d{2}$/.test(cell)) {
    // Eine feinere Angabe als erlaubt wird nicht „gerundet übernommen",
    // sondern verworfen: Sonst könnte ein Client heimlich genauer melden.
    throw new Error("Meldung ohne gültige Zelle");
  }
  const range = Number(getTag(ev, "range_km") ?? "0");
  return {
    pubkey: ev.pubkey,
    layer,
    cell,
    region: getTag(ev, "region") ?? "",
    rangeKm: Number.isFinite(range) && range > 0 ? range : undefined,
    createdAt: ev.created_at,
  };
}

export interface CoverageCell {
  cell: string;
  layer: CoverageLayer;
  /** Anzahl Knoten — nur wenn k erreicht ist. */
  nodes: number;
  center: { lat: number; lon: number } | null;
  region: string;
  /** Grobe Angabe statt exakter Zahl bei kleinen Zellen. */
  label: string;
}

export interface CoverageOptions {
  /** Wie lange eine Meldung als aktuell gilt. */
  maxAgeSeconds?: number;
  nowSecs?: number;
  /** Mindestzahl je Zelle. Nur für Tests kleiner setzen, nie im Betrieb. */
  kAnonymity?: number;
}

/**
 * Baut die Karte aus Meldungen.
 *
 * Zellen unter der k-Schwelle erscheinen NICHT — auch nicht als „mindestens
 * einer". Die Aussage „hier ist genau ein Funkknoten" ist der gesamte
 * Informationsgehalt, den ein Angreifer braucht.
 */
export function buildCoverage(
  events: NostrEvent[],
  opts: CoverageOptions = {},
): { cells: CoverageCell[]; hiddenCells: number; totalNodes: number } {
  const now = opts.nowSecs ?? Math.floor(Date.now() / 1000);
  const maxAge = opts.maxAgeSeconds ?? 7 * 24 * 3600;
  const k = opts.kAnonymity ?? K_ANONYMITY;

  const byCell = new Map<string, { layer: CoverageLayer; region: string; pubkeys: Set<string> }>();
  let totalNodes = 0;
  const gesehen = new Set<string>();

  for (const ev of events) {
    let a: CoverageAnnouncement;
    try {
      a = parseCoverageAnnouncement(ev);
    } catch {
      continue;
    }
    if (now - a.createdAt > maxAge) continue;

    const key = `${a.layer}:${a.cell}`;
    const e = byCell.get(key) ?? { layer: a.layer, region: a.region, pubkeys: new Set<string>() };
    e.pubkeys.add(a.pubkey);
    byCell.set(key, e);
    if (!gesehen.has(a.pubkey)) {
      gesehen.add(a.pubkey);
      totalNodes++;
    }
  }

  const cells: CoverageCell[] = [];
  let hidden = 0;

  for (const [key, e] of byCell) {
    const cell = key.slice(key.indexOf(":") + 1);
    // Online-Provider dürfen ab 1 gezeigt werden: Ihre Adresse ist ohnehin
    // öffentlich, sobald sich jemand verbindet. Für alles Physische gilt die
    // volle Schwelle — ein einzelner Funkknoten ist ein Haushalt.
    const schwelle = e.layer === "online" ? 1 : k;
    if (e.pubkeys.size < schwelle) {
      hidden++;
      continue;
    }
    const grad = LAYER_CELL_DEGREES[e.layer];
    cells.push({
      cell,
      layer: e.layer,
      nodes: e.pubkeys.size,
      center: cellCenter(cell, grad),
      region: e.region,
      // Grobe Stufen statt exakter Zahlen: „4" ist bei kleinen Zellen selbst
      // schon ein Merkmal.
      label: e.pubkeys.size >= 20 ? "viele" : e.pubkeys.size >= 8 ? "mehrere" : "wenige",
    });
  }

  return {
    cells: cells.sort((a, b) => b.nodes - a.nodes),
    hiddenCells: hidden,
    totalNodes,
  };
}

/**
 * Antwort auf „funktioniert das bei mir?".
 *
 * Bewusst ohne Zahlen für die Funk-Ebene: Der Nutzer braucht ja/nein, nicht
 * die Größe einer Gruppe, deren Mitglieder ein Risiko tragen.
 */
export interface LocalCoverage {
  online: boolean;
  lora: boolean;
  bluetooth: boolean;
  message: string;
  /** Welche Ebene hier fehlt und sich am meisten lohnt. */
  biggestGap?: CoverageLayer;
}

export function coverageAt(lat: number, lon: number, cells: CoverageCell[]): LocalCoverage {
  const hat = (layer: CoverageLayer): boolean =>
    cells.some((c) => c.layer === layer && c.cell === toCell(lat, lon, LAYER_CELL_DEGREES[layer]));

  const online = hat("online");
  const lora = hat("lora");
  const bluetooth = hat("bluetooth");

  const teile: string[] = [];
  if (online) teile.push("Provider");
  if (lora) teile.push("Funk");
  if (bluetooth) teile.push("Bluetooth");

  if (teile.length === 0) {
    return {
      online, lora, bluetooth,
      biggestGap: "online",
      message:
        "In deiner Gegend ist noch nichts eingetragen. Das heißt nicht, dass nichts " +
        "da ist — Eintragen ist freiwillig.",
    };
  }

  // Die größte Lücke ist die, die bei einem Ausfall am meisten fehlt: ohne
  // Funk hilft der beste Provider nichts, wenn das Netz weg ist.
  const luecke: CoverageLayer | undefined = !lora ? "lora" : !online ? "online" : !bluetooth ? "bluetooth" : undefined;

  const hinweis = !lora
    ? " Bei einem Netzausfall gibt es hier keine Funkabdeckung — ein Knoten würde die Lücke schließen."
    : !online
      ? " Kein Provider in der Nähe; Anfragen laufen über weiter entfernte."
      : "";

  return {
    online, lora, bluetooth,
    biggestGap: luecke,
    message: `${teile.join(" und ")} in deiner Gegend vorhanden.${hinweis}`,
  };
}

export interface LayerSummary {
  layer: CoverageLayer;
  label: string;
  cells: number;
  nodes: number;
  hidden: number;
}

/** Übersicht je Ebene — die Zahl, die auf eine Karte gehört. */
export function summarizeLayers(
  cells: CoverageCell[],
  hiddenCells: number,
): LayerSummary[] {
  return (["online", "lora", "bluetooth"] as CoverageLayer[]).map((layer) => {
    const eigene = cells.filter((c) => c.layer === layer);
    return {
      layer,
      label: LAYER_LABEL[layer],
      cells: eigene.length,
      nodes: eigene.reduce((s, c) => s + c.nodes, 0),
      // Verdeckte Zellen lassen sich nicht je Ebene aufschlüsseln, ohne genau
      // das preiszugeben, was die Schwelle schützen soll.
      hidden: layer === "online" ? 0 : hiddenCells,
    };
  });
}

/**
 * Was der Nutzer VOR dem Eintragen wissen muss.
 *
 * Steht als Text im Protokoll und nicht nur in der Oberfläche, damit jeder
 * Client dieselbe Warnung zeigen kann. Eine Zustimmung ohne Verständnis ist
 * keine Zustimmung.
 */
export function coverageConsentText(layer: CoverageLayer): string {
  if (layer === "bluetooth") {
    return [
      "Bluetooth reicht nur wenige Meter.",
      "",
      "Deshalb wird deine Zelle GRÖBER angezeigt als bei Funk, nicht feiner:",
      "Die Karte sagt „hier gibt es Leute mit Bluetooth-Geräten“, nicht wo.",
      "",
      `Erst ab ${K_ANONYMITY} Knoten in derselben Zelle erscheint überhaupt etwas.`,
      "",
      "Im Zweifel: nicht eintragen. Der Austausch funktioniert auch ohne Karte —",
      "man muss sich ohnehin begegnen.",
    ].join("\n");
  }
  if (layer === "online") {
    return [
      "Du wirst mit einer groben Region auf der Karte erscheinen (etwa 200 km).",
      "Deine Adresse ist als Provider ohnehin sichtbar, sobald sich jemand",
      "verbindet — die Karte fügt wenig hinzu.",
      "",
      "Jederzeit widerrufbar.",
    ].join("\n");
  }
  return [
    "ÜBERLEG DIR DAS.",
    "",
    "Eine Karte von Funkknoten ist eine Karte von Menschen, die Funktechnik",
    "besitzen und zensurresistente Infrastruktur betreiben. In manchen Ländern",
    "ist das ein Risiko — und dort ist das Netz am wichtigsten.",
    "",
    "Was geschützt wird:",
    `  · Nur eine grobe Zelle (~55 km), nie Koordinaten.`,
    `  · Erst ab ${K_ANONYMITY} Knoten in derselben Zelle wird überhaupt etwas angezeigt.`,
    "  · Kein Verlauf — nur der aktuelle Stand, keine Bewegungsmuster.",
    "",
    "Was NICHT geschützt wird:",
    "  · Wer über längere Zeit mitliest, sieht Veränderungen.",
    "  · Deine Zelle plus Funkreichweite grenzt das Gebiet weiter ein.",
    "",
    "Im Zweifel: nicht eintragen. Das Netz funktioniert auch ohne Karte.",
  ].join("\n");
}
