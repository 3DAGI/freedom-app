/**
 * Mehrere Geräte: Gerätschlüssel mit Vollmacht.
 *
 * DAS PROBLEM
 * Es gab keinen Weg, dieselbe Identität auf Laptop und Handy zu benutzen,
 * außer den privaten Schlüssel zu kopieren. Das ist genau das, was man
 * Nutzern abgewöhnen will — und es ist der Grund, warum viele Nostr-Clients
 * in der Praxis unbenutzbar bleiben: Wer sein Handy verliert, hat seine
 * Identität verloren, obwohl der Laptop noch da ist.
 *
 * ZWEI WEGE, EINER GEWÄHLT
 * NIP-46 lässt den Schlüssel auf einem Gerät und fragt von dort
 * Unterschriften ab. Sauber, aber das Hauptgerät muss erreichbar sein — und
 * damit fällt es für ein System aus, das ohne Internet funktionieren soll.
 *
 * Hier stattdessen: **Jedes Gerät hat einen eigenen Schlüssel, den die
 * Hauptidentität beglaubigt.** Das Gerät arbeitet allein weiter, auch offline,
 * und ein verlorenes Gerät lässt sich einzeln entziehen — dieselbe Mechanik
 * wie beim Schlüsselwechsel.
 *
 * DIE KOSTEN, EHRLICH BENANNT
 * Ein Gerätschlüssel ist ein vollwertiger Schlüssel. Wer ihn hat, kann in
 * deinem Namen schreiben, bis die Vollmacht entzogen ist — und der Entzug
 * erreicht nur, wer ihn sieht. Das ist schwächer als NIP-46 und der Preis
 * dafür, dass es offline funktioniert.
 *
 * Deshalb: **Vollmachten sind eingeschränkt und befristet.** Ein Gerät, das
 * nur Nachrichten schreiben darf, kann keine Zahlungen auslösen; eine
 * Vollmacht, die nach einem Jahr endet, begrenzt den Schaden eines Geräts,
 * das in einer Schublade vergessen wurde.
 */
import { NostrEvent, UnsignedEvent, buildEvent, getTag } from "./event.js";

/** Vollmacht der Hauptidentität für einen Gerätschlüssel. */
export const KIND_DEVICE_GRANT = 38070;
/** Entzug einer Vollmacht. */
export const KIND_DEVICE_REVOKE = 38071;

export type DevicePermission =
  | "nachrichten"
  | "raeume"
  | "zahlungen"
  | "provider"
  | "identitaet";

export const ALL_DEVICE_PERMISSIONS: DevicePermission[] = [
  "nachrichten", "raeume", "zahlungen", "provider", "identitaet",
];

export const PERMISSION_LABEL: Record<DevicePermission, string> = {
  nachrichten: "Nachrichten schreiben",
  raeume: "in Räumen schreiben und moderieren",
  zahlungen: "Zahlungen auslösen",
  provider: "als Provider arbeiten",
  identitaet: "Profil und Vollmachten ändern",
};

export interface DeviceGrant {
  /** Hauptidentität. */
  ownerPubkey: string;
  /** Schlüssel des Geräts. */
  devicePubkey: string;
  /** Wie das Gerät heißt — für die Anzeige beim Entziehen. */
  label: string;
  permissions: DevicePermission[];
  /** Ab wann die Vollmacht erlischt. */
  expiresAt: number;
  createdAt: number;
}

/**
 * Vollmacht ausstellen.
 *
 * `identitaet` ist absichtlich nicht voreingestellt: Ein Gerät, das neue
 * Vollmachten ausstellen darf, kann die Hauptidentität vollständig
 * übernehmen. Wer das will, muss es ausdrücklich wählen.
 */
export function buildDeviceGrant(
  g: Omit<DeviceGrant, "createdAt">,
  createdAt?: number,
): UnsignedEvent {
  if (g.ownerPubkey === g.devicePubkey) {
    throw new Error("Ein Gerät kann sich nicht selbst bevollmächtigen.");
  }
  if (g.permissions.length === 0) {
    throw new Error("Eine Vollmacht ohne Rechte ist sinnlos.");
  }
  return buildEvent(
    g.ownerPubkey,
    KIND_DEVICE_GRANT,
    [
      ["d", `device:${g.devicePubkey}`],
      ["p", g.devicePubkey, "", "device"],
      ["label", g.label],
      ["expiration", String(g.expiresAt)],
      ...g.permissions.map((p) => ["perm", p]),
    ],
    "",
    createdAt,
  );
}

export function parseDeviceGrant(ev: NostrEvent): DeviceGrant {
  if (ev.kind !== KIND_DEVICE_GRANT) throw new Error(`keine Vollmacht: kind ${ev.kind}`);
  const device = ev.tags.find((t) => t[0] === "p" && t[3] === "device")?.[1];
  if (!device) throw new Error("Vollmacht ohne Gerät");
  if (device === ev.pubkey) throw new Error("Vollmacht auf sich selbst");

  const perms = ev.tags
    .filter((t) => t[0] === "perm")
    .map((t) => t[1])
    .filter((p): p is DevicePermission => (ALL_DEVICE_PERMISSIONS as string[]).includes(p));
  if (perms.length === 0) throw new Error("Vollmacht ohne gültige Rechte");

  const bis = Number(getTag(ev, "expiration") ?? "NaN");
  if (!Number.isFinite(bis)) throw new Error("Vollmacht ohne Ablauf");

  return {
    ownerPubkey: ev.pubkey,
    devicePubkey: device,
    label: getTag(ev, "label") ?? "unbenanntes Gerät",
    permissions: perms,
    expiresAt: bis,
    createdAt: ev.created_at,
  };
}

export function buildDeviceRevoke(
  ownerPubkey: string,
  devicePubkey: string,
  reason: string,
  createdAt?: number,
): UnsignedEvent {
  return buildEvent(
    ownerPubkey,
    KIND_DEVICE_REVOKE,
    [["d", `revoke-device:${devicePubkey}`], ["p", devicePubkey, "", "device"]],
    reason,
    createdAt,
  );
}

export type DeviceStatus = "aktiv" | "abgelaufen" | "entzogen" | "unbekannt";

export interface DeviceState {
  devicePubkey: string;
  label: string;
  status: DeviceStatus;
  permissions: Set<DevicePermission>;
  expiresAt?: number;
  revokedAt?: number;
  message: string;
}

export interface DeviceListOptions {
  nowSecs?: number;
}

/**
 * Alle Geräte einer Identität.
 *
 * Ein Entzug wirkt ab seinem Zeitpunkt, nicht rückwirkend: Was ein Gerät
 * vorher geschrieben hat, bleibt gültig. Alles nachträglich zu verwerfen
 * würde bedeuten, dass ein verlorenes Handy die gesamte Vorgeschichte
 * löscht.
 */
export function listDevices(
  ownerPubkey: string,
  events: NostrEvent[],
  opts: DeviceListOptions = {},
): DeviceState[] {
  const now = opts.nowSecs ?? Math.floor(Date.now() / 1000);

  const grants = new Map<string, DeviceGrant>();
  for (const ev of events) {
    if (ev.kind !== KIND_DEVICE_GRANT) continue;
    if (ev.pubkey !== ownerPubkey) continue;
    let g: DeviceGrant;
    try {
      g = parseDeviceGrant(ev);
    } catch {
      continue;
    }
    // Neuere Vollmacht ersetzt die ältere — Rechte müssen änderbar sein.
    const bisher = grants.get(g.devicePubkey);
    if (!bisher || g.createdAt > bisher.createdAt) grants.set(g.devicePubkey, g);
  }

  const revokes = new Map<string, number>();
  for (const ev of events) {
    if (ev.kind !== KIND_DEVICE_REVOKE) continue;
    // Nur der Eigentümer entzieht. Sonst könnte ein Gerät ein anderes
    // aussperren — oder ein Fremder alle.
    if (ev.pubkey !== ownerPubkey) continue;
    const d = ev.tags.find((t) => t[0] === "p" && t[3] === "device")?.[1];
    if (!d) continue;
    const bisher = revokes.get(d);
    if (bisher === undefined || ev.created_at < bisher) revokes.set(d, ev.created_at);
  }

  return [...grants.values()].map((g) => {
    const entzogen = revokes.get(g.devicePubkey);
    if (entzogen !== undefined) {
      return {
        devicePubkey: g.devicePubkey, label: g.label, status: "entzogen" as const,
        permissions: new Set<DevicePermission>(), expiresAt: g.expiresAt, revokedAt: entzogen,
        message: `Entzogen am ${new Date(entzogen * 1000).toISOString().slice(0, 10)}.`,
      };
    }
    if (now >= g.expiresAt) {
      return {
        devicePubkey: g.devicePubkey, label: g.label, status: "abgelaufen" as const,
        permissions: new Set<DevicePermission>(), expiresAt: g.expiresAt,
        message: "Vollmacht abgelaufen. Neu ausstellen, um das Gerät weiter zu nutzen.",
      };
    }
    const tage = Math.floor((g.expiresAt - now) / 86_400);
    return {
      devicePubkey: g.devicePubkey, label: g.label, status: "aktiv" as const,
      permissions: new Set(g.permissions), expiresAt: g.expiresAt,
      message: tage < 14
        ? `Läuft in ${tage} Tag(en) ab.`
        : `Aktiv, ${g.permissions.length} Recht(e).`,
    };
  }).sort((a, b) => {
    const rang = (s: DeviceStatus): number => (s === "aktiv" ? 0 : s === "abgelaufen" ? 1 : 2);
    return rang(a.status) - rang(b.status) || a.label.localeCompare(b.label);
  });
}

export interface DeviceCheck {
  valid: boolean;
  /** Die Identität, in deren Namen gehandelt wird. */
  actingFor?: string;
  reason: string;
}

/**
 * Darf dieses Gerät dieses Ereignis im Namen des Eigentümers erzeugt haben?
 *
 * Wird beim EMPFANG geprüft. Ohne diese Prüfung wäre eine Vollmacht wertlos:
 * Jeder könnte behaupten, im Namen eines anderen zu handeln.
 */
export function checkDeviceEvent(
  ev: NostrEvent,
  needed: DevicePermission,
  devices: DeviceState[],
  grantsAt?: Map<string, DeviceGrant>,
): DeviceCheck {
  const d = devices.find((x) => x.devicePubkey === ev.pubkey);
  if (!d) {
    return { valid: false, reason: "Kein bevollmächtigtes Gerät." };
  }

  if (d.status === "entzogen") {
    // Rückwirkend gilt weiter, was vor dem Entzug entstand.
    const g = grantsAt?.get(ev.pubkey);
    if (d.revokedAt !== undefined && ev.created_at < d.revokedAt) {
      const durfte = g?.permissions.includes(needed) ?? true;
      return durfte
        ? { valid: true, actingFor: g?.ownerPubkey, reason: "Vor dem Entzug entstanden." }
        : { valid: false, reason: `Das Gerät durfte nie „${PERMISSION_LABEL[needed]}“.` };
    }
    return { valid: false, reason: "Vollmacht entzogen." };
  }

  if (d.status === "abgelaufen") {
    return { valid: false, reason: "Vollmacht abgelaufen." };
  }
  if (!d.permissions.has(needed)) {
    return {
      valid: false,
      reason: `Dieses Gerät darf nicht „${PERMISSION_LABEL[needed]}“.`,
    };
  }
  return { valid: true, reason: "Gültige Vollmacht." };
}

/** Voreinstellung für ein neues Gerät. */
export function defaultPermissions(kind: "vollzugriff" | "lesen-schreiben" | "nur-chat"): DevicePermission[] {
  switch (kind) {
    case "vollzugriff":
      return [...ALL_DEVICE_PERMISSIONS];
    case "nur-chat":
      return ["nachrichten"];
    default:
      // Zahlungen bewusst nicht: Das ist die Grenze, an der ein verlorenes
      // Gerät von ärgerlich zu teuer wird.
      return ["nachrichten", "raeume"];
  }
}

/**
 * Hinweistext beim Einrichten.
 *
 * Die Schwäche gegenüber NIP-46 gehört nach vorn, nicht ins Kleingedruckte.
 */
export function deviceWarning(perms: DevicePermission[], tage: number): string {
  const zahlt = perms.includes("zahlungen");
  const identitaet = perms.includes("identitaet");
  return [
    `Dieses Gerät bekommt einen eigenen Schlüssel mit ${perms.length} Recht(en),`,
    `gültig für ${tage} Tage:`,
    ...perms.map((p) => `  · ${PERMISSION_LABEL[p]}`),
    "",
    "Was das heißt: Wer dieses Gerät in die Hand bekommt, kann in deinem",
    "Namen handeln — bis du die Vollmacht entziehst. Der Entzug erreicht nur",
    "Clients, die ihn sehen.",
    "",
    zahlt
      ? "⚠ Mit Zahlungsrecht kann ein verlorenes Gerät Geld ausgeben."
      : "Ohne Zahlungsrecht kann ein verlorenes Gerät kein Geld ausgeben.",
    identitaet
      ? "⚠ Mit Identitätsrecht kann dieses Gerät weitere Geräte bevollmächtigen — also alles."
      : "Ohne Identitätsrecht kann dieses Gerät keine weiteren Geräte zulassen.",
  ].join("\n");
}
