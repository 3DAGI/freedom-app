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
 *
 * WAS ÜBERHAUPT GEHT (seit 7.1)
 * Nur Umschläge (NIP-59). Profile, Räume, Code und offene Belege tragen den
 * Schlüssel ihres Autors oder Klartext – der Abgleich nennt sie, sendet sie
 * aber nicht. Über Funk begrenzt zusätzlich die Sendezeit (1 % je Stunde).
 */
import { NostrEvent } from "./event.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { BESTAND_BYTES, SENDEZEIT_ANTEIL, SENDEZEIT_FENSTER_SEKUNDEN, istMeshUmschlag, luftBytes } from "./mesh-transport.js";

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
  | "altnachricht"
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
    cls: "nachricht", label: "Umschläge", priority: 0,
    kinds: [1059],
    links: ["lora", "bluetooth", "datei"],
    note: "Verschlüsselt nach NIP-59 (Nachrichten, Belege, private Aufträge) – ohne Absender, ohne Klartext.",
  },
  // Ab hier: bekannt, aber nicht über Mesh (7.1) – `links` bleibt leer.
  {
    cls: "altnachricht", label: "Alte Direktnachrichten", priority: 1,
    kinds: [4],
    links: [],
    note: "Kind 4 zeigt Absender und Empfänger offen – nicht über Mesh.",
  },
  {
    cls: "zahlung", label: "Offene Zahlungsbelege", priority: 2,
    kinds: [9734, 9735, 38051],
    links: [],
    note: "Tragen Schlüssel und Rechnung offen – nicht über Mesh. Solana-Transaktionen gehen als eigene Paketart.",
  },
  {
    cls: "community", label: "Räume", priority: 3,
    kinds: [42, 34700, 34701, 34702, 34550, 34551, 34552],
    links: [],
    note: "Räume sind noch nicht verschlüsselt (2.3) – bis dahin nicht über Mesh.",
  },
  {
    cls: "verzeichnis", label: "Verzeichnis", priority: 4,
    kinds: [0, 10002, 38055, 38057, 38062, 30009, 8],
    links: [],
    note: "Öffentlich und mit dem Schlüssel des Autors – über Mesh geht nur Verschlüsseltes.",
  },
  {
    cls: "code", label: "Code", priority: 5,
    kinds: [38056, 30617],
    links: [],
    note: "Öffentliche Bündel mit dem Schlüssel des Autors – nicht über Mesh.",
  },
  {
    cls: "gewichte", label: "Modellgewichte", priority: 6,
    kinds: [38058],
    links: [],
    note: "Gigabytes und öffentlich – nicht über Mesh.",
  },
];

export function policyFor(kind: number): ClassPolicy | undefined {
  return SYNC_POLICY.find((p) => p.kinds.includes(kind));
}

// ------------------------------------------------------- Bestandsabgleich

const FILTER_BITS = BESTAND_BYTES * 8; // 1 KB
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
  /**
   * Freie Sendezeit über Funk (Sekunden, aus dem `Sendezeitkonto`). Ohne
   * Angabe das volle Budget: 1 % je Stunde. Gilt nur für `lora`.
   */
  sendezeitSekunden?: number;
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
  const sendezeit = opts.link === "lora"
    ? opts.sendezeitSekunden ?? SENDEZEIT_ANTEIL * SENDEZEIT_FENSTER_SEKUNDEN
    : Infinity;
  const budget = Math.min(maxSec, sendezeit) * rate;
  const grenze = sendezeit < maxSec
    ? `Funk: höchstens ${Math.round(SENDEZEIT_ANTEIL * 100)} % Sendezeit je Stunde`
    : `höchstens ${maxSec}s`;

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
      merke("verzeichnis", "unbekannte Ereignisart – über Mesh gehen nur Umschläge");
      continue;
    }
    if (!p.links.includes(opts.link)) {
      merke(p.cls, `${p.label} gehen nicht über ${LINK_LABEL[opts.link]}: ${p.note}`);
      continue;
    }
    // Nur, was wirklich ein Umschlag ist – ein Kind 1059 mit Klartext-Tags nicht.
    if (!istMeshUmschlag(ev)) {
      merke(p.cls, "kein gültiger Umschlag – über Mesh geht nur Verschlüsseltes");
      continue;
    }
    kandidaten.push({ ev, p, bytes: luftBytes(new TextEncoder().encode(JSON.stringify(ev)).length) });
  }

  kandidaten.sort((a, b) => a.p.priority - b.p.priority || b.ev.created_at - a.ev.created_at);

  const send: NostrEvent[] = [];
  let bytes = 0;
  for (const k of kandidaten) {
    if (bytes + k.bytes > budget) {
      merke(k.p.cls, `Zeitbudget erschöpft (${grenze})`);
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
  const nurVerschluesselt = "Über Mesh geht nur Verschlüsseltes.";
  return [
    {
      feature: "Direktnachrichten", works: true,
      note: "Nur als Umschlag – ohne Absender, ohne Klartext. Empfangene gibt die App ans Netz weiter; " +
        "Post für einen Kontakt nimmst du im Chat als Datei mit." +
        (ueberFunk ? " Funk: höchstens 1 % Sendezeit je Stunde – drei bis vier kurze Nachrichten." : ""),
    },
    { feature: "Räume und Kanäle", works: false, note: "Noch nicht verschlüsselt (2.3) – bis dahin nicht über Mesh." },
    {
      // Seit 7.2: Durable Nonce – die Transaktion bleibt gueltig, bis ein Geraet mit Netz sie einreicht.
      feature: "Solana-Zahlungen", works: true,
      note: "Mit vorbereitetem Nonce-Konto (eingebaute Wallet): offline signieren, über Funk oder als Datei weitergeben – ein Gerät mit Netz reicht ein. Ein Nonce-Wert zahlt einmal.",
    },
    {
      // Stand heute NICHT gebaut. Eine Faehigkeit zu behaupten, die es nicht
      // gibt, ist schlimmer als sie wegzulassen — der Nutzer plant damit.
      feature: "Ecash-Token", works: false,
      note: "Noch nicht gebaut – und nur verschlüsselt denkbar: Ein Token ist Bargeld für jeden, der mithört.",
    },
    { feature: "Profile und Namen", works: false, note: `Öffentlich, mit dem Schlüssel des Autors. ${nurVerschluesselt}` },
    { feature: "Code (Git)", works: false, note: `Öffentliche Bündel mit dem Schlüssel des Autors. ${nurVerschluesselt}` },
    { feature: "Modellgewichte", works: false, note: "Gigabytes – nicht über Mesh." },
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
