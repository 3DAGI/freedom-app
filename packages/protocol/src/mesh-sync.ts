/**
 * Offline-Abgleich: alles außer Live-Inferenz läuft ohne Internet.
 *
 * DAS PROBLEM, DAS ZUERST GELÖST WERDEN MUSS
 * Treffen sich zwei Geräte über Funk, weiß keines, was das andere hat. Alles
 * zu senden ist unmöglich — über LoRa dauert ein Megabyte über eine Stunde.
 * Nichts zu senden ist nutzlos. Es braucht also einen **kompakten
 * Bestandsabgleich**: „Das habe ich" in wenigen hundert Byte, woraus sich die
 * Differenz ergibt.
 *
 * WARUM EIN BLOOM-FILTER
 * Eine Liste von Ereignis-Kennungen kostet 32 Byte je Eintrag; bei tausend
 * Ereignissen sind das 32 KB und damit über LoRa unbrauchbar. Ein
 * Bloom-Filter über dieselbe Menge braucht rund 1,2 KB und beantwortet die
 * einzige Frage, auf die es ankommt: „Hast du das schon?" Er irrt sich
 * gelegentlich in eine Richtung — er behauptet manchmal, etwas zu haben, das
 * er nicht hat. Die Folge ist, dass ein Ereignis beim ersten Treffen
 * ausgelassen und beim nächsten nachgereicht wird. Das ist der richtige
 * Fehler: lieber später als gar nicht, und niemals falscher Inhalt.
 *
 * WAS ÜBER WELCHE STRECKE GEHT
 * Die Bandbreiten liegen drei Größenordnungen auseinander. Eine Strecke zu
 * wählen, ohne die Größe zu kennen, führt dazu, dass ein Nutzer vier Stunden
 * auf etwas wartet, das er per Datei in Sekunden bekommen hätte.
 */
import { NostrEvent } from "./event.js";
import { sha256 } from "@noble/hashes/sha2.js";

export type Link = "lora" | "bluetooth" | "datei";

/** Grobe Durchsätze. Konservativ — im Feld ist es selten besser. */
export const LINK_BYTES_PER_SEC: Record<Link, number> = {
  lora: 200,
  bluetooth: 20_000,
  datei: 5_000_000,
};

export const LINK_LABEL: Record<Link, string> = {
  lora: "Funk (LoRa)",
  bluetooth: "Bluetooth",
  datei: "Datei / Stick",
};

/**
 * Was abgeglichen wird, nach Dringlichkeit.
 *
 * Die Reihenfolge ist die eigentliche Entscheidung: Bei 200 Byte pro Sekunde
 * entscheidet sie, ob eine Nachricht in Minuten oder in Stunden ankommt.
 * Modellgewichte stehen ganz unten — sie gehören auf keine Funkstrecke.
 */
export type SyncClass =
  | "nachricht"
  | "community"
  | "zahlung"
  | "verzeichnis"
  | "code"
  | "gewichte";

export interface ClassPolicy {
  cls: SyncClass;
  label: string;
  priority: number;
  /** Kinds, die dazugehören. */
  kinds: number[];
  /** Strecken, über die das sinnvoll geht. */
  links: Link[];
  note: string;
}

export const SYNC_POLICY: ClassPolicy[] = [
  {
    cls: "nachricht", label: "Nachrichten", priority: 0,
    kinds: [4, 1059, 42],
    links: ["lora", "bluetooth", "datei"],
    note: "Klein und dringend — geht über jede Strecke.",
  },
  {
    cls: "zahlung", label: "Zahlungen", priority: 1,
    kinds: [9734, 9735, 38051],
    links: ["lora", "bluetooth", "datei"],
    note: "Signierte Transaktionen und Belege. Eine Solana-Transaktion passt in 1.232 Byte.",
  },
  {
    cls: "community", label: "Räume", priority: 2,
    kinds: [34700, 34701, 34702, 34550, 34551, 34552],
    links: ["lora", "bluetooth", "datei"],
    note: "Kanäle, Rollen, Moderation. Ohne sie erscheinen Nachrichten im luftleeren Raum.",
  },
  {
    cls: "verzeichnis", label: "Verzeichnis", priority: 3,
    kinds: [0, 10002, 38055, 38057, 38062, 30009, 8],
    links: ["lora", "bluetooth", "datei"],
    note: "Profile, Relays, Namen, Abzeichen, Modell-Manifeste. Klein, aber macht alles andere lesbar.",
  },
  {
    cls: "code", label: "Code", priority: 4,
    kinds: [38056, 30617],
    links: ["bluetooth", "datei"],
    note: "Git-Bündel sind zu groß für Funk — über Bluetooth machbar, per Datei problemlos.",
  },
  {
    cls: "gewichte", label: "Modellgewichte", priority: 5,
    kinds: [38058],
    links: ["datei"],
    note: "Gigabytes. Nur per Datei oder Stick — alles andere wäre ein leeres Versprechen.",
  },
];

export function policyFor(kind: number): ClassPolicy | undefined {
  return SYNC_POLICY.find((p) => p.kinds.includes(kind));
}

// ------------------------------------------------------- Bestandsabgleich

const FILTER_BITS = 8192; // 1 KB
const HASHES = 4;

/** Kompakter Bestand: „das habe ich", in 1 KB statt 32 KB. */
export interface SyncDigest {
  /** Bitfeld. */
  bits: Uint8Array;
  /** Wie viele Ereignisse eingetragen sind — für die Fehlerabschätzung. */
  count: number;
  /** Ältestes berücksichtigtes Ereignis. */
  since: number;
}

function positionen(id: string): number[] {
  const h = sha256(new TextEncoder().encode(id));
  const out: number[] = [];
  for (let i = 0; i < HASHES; i++) {
    const v = (h[i * 4] << 24) | (h[i * 4 + 1] << 16) | (h[i * 4 + 2] << 8) | h[i * 4 + 3];
    out.push(Math.abs(v) % FILTER_BITS);
  }
  return out;
}

export function buildDigest(events: NostrEvent[], since = 0): SyncDigest {
  const bits = new Uint8Array(FILTER_BITS / 8);
  let count = 0;
  for (const ev of events) {
    if (ev.created_at < since) continue;
    for (const p of positionen(ev.id)) bits[p >> 3] |= 1 << (p & 7);
    count++;
  }
  return { bits, count, since };
}

export function digestHas(d: SyncDigest, id: string): boolean {
  return positionen(id).every((p) => (d.bits[p >> 3] & (1 << (p & 7))) !== 0);
}

/**
 * Wie oft der Bestand fälschlich „habe ich" sagt.
 *
 * Bei über etwa fünf Prozent lohnt der Abgleich nicht mehr — dann werden zu
 * viele Ereignisse ausgelassen. Die Zahl gehört in die Anzeige, damit ein
 * Nutzer versteht, warum ein zweites Treffen noch etwas bringt.
 */
export function falsePositiveRate(d: SyncDigest): number {
  const k = HASHES;
  const m = FILTER_BITS;
  const n = Math.max(1, d.count);
  return Math.pow(1 - Math.exp((-k * n) / m), k);
}

export interface SyncPlan {
  /** Was gesendet werden soll, nach Dringlichkeit sortiert. */
  send: NostrEvent[];
  /** Was aus Bandbreitengründen wegbleibt. */
  skipped: { cls: SyncClass; count: number; reason: string }[];
  totalBytes: number;
  estimatedSeconds: number;
  note: string;
}

export interface PlanOptions {
  link: Link;
  /** Wie lange der Abgleich höchstens dauern darf. */
  maxSeconds?: number;
  nowSecs?: number;
}

/**
 * Plant, was über diese Strecke gesendet wird.
 *
 * Zwei Filter, in dieser Reihenfolge: Erst fällt weg, was über diese Strecke
 * nicht sinnvoll geht (Gewichte über Funk), dann wird nach Dringlichkeit
 * gefüllt, bis das Zeitbudget erschöpft ist. Andersherum würde ein großes
 * Git-Bündel die Nachrichten verdrängen.
 */
export function planSync(
  eigene: NostrEvent[],
  fremd: SyncDigest,
  opts: PlanOptions,
): SyncPlan {
  const maxSec = opts.maxSeconds ?? 300;
  const rate = LINK_BYTES_PER_SEC[opts.link];
  const budget = maxSec * rate;

  const kandidaten: { ev: NostrEvent; p: ClassPolicy; bytes: number }[] = [];
  const uebersprungen = new Map<SyncClass, { count: number; reason: string }>();

  const merke = (cls: SyncClass, reason: string): void => {
    const e = uebersprungen.get(cls) ?? { count: 0, reason };
    e.count++;
    uebersprungen.set(cls, e);
  };

  for (const ev of eigene) {
    if (digestHas(fremd, ev.id)) continue;

    const p = policyFor(ev.kind);
    if (!p) {
      merke("verzeichnis", "unbekannte Ereignisart");
      continue;
    }
    if (!p.links.includes(opts.link)) {
      merke(p.cls, `${p.label} gehen nicht über ${LINK_LABEL[opts.link]}`);
      continue;
    }
    kandidaten.push({ ev, p, bytes: JSON.stringify(ev).length });
  }

  kandidaten.sort((a, b) => a.p.priority - b.p.priority || b.ev.created_at - a.ev.created_at);

  const send: NostrEvent[] = [];
  let bytes = 0;
  for (const k of kandidaten) {
    if (bytes + k.bytes > budget) {
      merke(k.p.cls, `Zeitbudget von ${maxSec}s erschöpft`);
      continue;
    }
    send.push(k.ev);
    bytes += k.bytes;
  }

  const sekunden = Math.ceil(bytes / rate);
  const fehlerquote = falsePositiveRate(fremd);

  return {
    send,
    skipped: [...uebersprungen.entries()].map(([cls, v]) => ({ cls, count: v.count, reason: v.reason })),
    totalBytes: bytes,
    estimatedSeconds: sekunden,
    note:
      send.length === 0
        ? "Nichts auszutauschen — die Gegenseite hat alles."
        : `${send.length} Ereignisse, ${bytes} Byte, etwa ${sekunden}s über ${LINK_LABEL[opts.link]}.` +
          (fehlerquote > 0.05
            ? ` Der Bestandsabgleich ist zu ${Math.round(fehlerquote * 100)} % ungenau — ein zweites Treffen bringt noch etwas.`
            : ""),
  };
}

// ------------------------------------------------------- Große Brocken

export interface BlobRequest {
  blobId: string;
  sizeBytes: number;
  label: string;
}

export interface BlobVerdict {
  feasible: boolean;
  seconds: number;
  recommendedLink: Link;
  note: string;
}

/**
 * Kann dieser Brocken über diese Strecke?
 *
 * Sagt immer auch, welche Strecke stattdessen taugt. „Geht nicht" allein
 * lässt den Nutzer ratlos zurück; „geht nicht über Funk, per Stick in zwei
 * Sekunden" ist eine Antwort.
 */
export function blobFeasibility(req: BlobRequest, link: Link): BlobVerdict {
  const sekunden = Math.ceil(req.sizeBytes / LINK_BYTES_PER_SEC[link]);
  const besser: Link = req.sizeBytes > 5_000_000 ? "datei" : req.sizeBytes > 100_000 ? "bluetooth" : link;

  if (sekunden <= 120) {
    return {
      feasible: true, seconds: sekunden, recommendedLink: link,
      note: `${Math.round(req.sizeBytes / 1024)} KB, etwa ${sekunden}s.`,
    };
  }
  if (sekunden <= 1800 && link !== "lora") {
    return {
      feasible: true, seconds: sekunden, recommendedLink: link,
      note: `${Math.round(req.sizeBytes / 1024)} KB, etwa ${Math.round(sekunden / 60)} Minuten. Geduld nötig.`,
    };
  }
  const bessereZeit = Math.ceil(req.sizeBytes / LINK_BYTES_PER_SEC[besser]);
  return {
    feasible: false,
    seconds: sekunden,
    recommendedLink: besser,
    note:
      `Über ${LINK_LABEL[link]} wären das ${Math.round(sekunden / 3600)} Stunden. ` +
      `Über ${LINK_LABEL[besser]} sind es ${bessereZeit < 60 ? `${bessereZeit}s` : `${Math.round(bessereZeit / 60)} Minuten`}.`,
  };
}

/**
 * Was ohne Internet funktioniert — und was nicht.
 *
 * Als Funktion, damit die Oberfläche dieselbe Auskunft gibt wie die
 * Dokumentation. Ein Versprechen, das an zwei Stellen verschieden lautet,
 * wird an der schwächeren geglaubt.
 */
export function offlineCapabilities(link: Link): { feature: string; works: boolean; note: string }[] {
  const ueberFunk = link === "lora";
  return [
    { feature: "Direktnachrichten", works: true, note: "Verschlüsselt, klein, geht über jede Strecke." },
    { feature: "Räume und Kanäle", works: true, note: "Nachrichten, Rollen und Moderation gleichen sich ab." },
    { feature: "Solana-Zahlungen", works: true, note: "Signierte Transaktion, höchstens 1.232 Byte." },
    {
      // Stand heute NICHT gebaut. Eine Faehigkeit zu behaupten, die es nicht
      // gibt, ist schlimmer als sie wegzulassen — der Nutzer plant damit.
      feature: "Ecash-Token", works: false,
      note: "Noch nicht gebaut. Waere als Zeichenkette uebertragbar — sogar vorgelesen.",
    },
    { feature: "Profile und Namen", works: true, note: "Klein und macht alles andere lesbar." },
    {
      feature: "Code (Git)", works: !ueberFunk,
      note: ueberFunk ? "Zu groß für Funk. Über Bluetooth oder Stick." : "Bündel werden übertragen.",
    },
    {
      feature: "Modellgewichte", works: link === "datei",
      note: link === "datei" ? "Per Stick übertragbar." : "Gigabytes — nur per Datei oder Stick.",
    },
    {
      feature: "Lightning-Zahlungen", works: false,
      note: "Braucht mehrere Runden Austausch. Das überlebt keine Offline-Strecke.",
    },
    {
      feature: "KI-Anfragen", works: false,
      note: "Eine Antwort mit 500 Wörtern bräuchte über Funk Stunden. Ehrlich: geht nicht.",
    },
  ];
}
