/**
 * Notfall-Löschung und Zwangslage.
 *
 * WARUM DAS HEIKEL IST
 * Diese Funktion kann ihrem Nutzer schaden. In vielen Rechtsordnungen ist das
 * Vernichten von Beweismitteln strafbar, und eine **entdeckte**
 * Zwangslagenfunktion verschlechtert die Situation erheblich: Wer glaubhaft
 * machen kann, dass jemand eine Zweitphrase besitzt, wird danach fragen — und
 * das Vorhandensein der Funktion ist öffentlich bekannt, weil die Software
 * offen ist.
 *
 * DESHALB ZWEI ENTSCHEIDUNGEN
 *
 * 1. **Die Löschung ist echt.** Keine Wiederherstellung, keine
 *    Sicherheitskopie, keine Bestätigungsfrist. Eine Löschung, die sich
 *    rückgängig machen lässt, ist keine.
 * 2. **Die Zwangsphrase ist AUS, bis jemand sie ausdrücklich einschaltet** —
 *    und der Einrichtungstext nennt die Gefahr zuerst, nicht die Funktion.
 *
 * WAS DIE LÖSCHUNG NICHT KANN
 * Sie erreicht nur dieses Gerät. Alles, was auf Relays liegt, bleibt dort.
 * Wer das für eine Löschung hält, täuscht sich über das Wesentliche.
 */

export interface WipeTarget {
  /** Anzeigename. */
  label: string;
  /** Schlüssel im lokalen Speicher. */
  storageKeys: string[];
  critical: boolean;
}

/** Was gelöscht wird, mit ausdrücklicher Benennung. */
export const WIPE_TARGETS: WipeTarget[] = [
  { label: "Identität (Schlüssel)", storageKeys: ["freedom.sk", "freedom.identity"], critical: true },
  { label: "Unterhaltungen", storageKeys: ["freedom.conversations", "freedom.messages"], critical: false },
  { label: "Räume und Lesestände", storageKeys: ["freedom.spaces", "freedom.lastRead"], critical: false },
  { label: "Eigene Namen", storageKeys: ["freedom.petnames"], critical: false },
  { label: "Profil", storageKeys: ["freedom.profile"], critical: false },
  { label: "Wallet-Verbindung", storageKeys: ["freedom.nwc", "freedom.wallet"], critical: true },
  { label: "Gerätevollmachten", storageKeys: ["freedom.devices"], critical: true },
];

export interface WipeResult {
  cleared: string[];
  failed: string[];
  message: string;
}

export interface StorageLike {
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

/**
 * Alles löschen.
 *
 * Löscht auch Schlüssel, die nicht in der Liste stehen, sofern sie mit
 * `freedom.` beginnen. Eine Liste veraltet; ein Präfix nicht — und ein
 * vergessener Eintrag wäre genau der, der jemanden verrät.
 */
export function wipeAll(storage: StorageLike): WipeResult {
  const cleared: string[] = [];
  const failed: string[] = [];

  const alle: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k && k.startsWith("freedom.")) alle.push(k);
  }
  for (const t of WIPE_TARGETS) for (const k of t.storageKeys) if (!alle.includes(k)) alle.push(k);

  for (const k of alle) {
    try {
      storage.removeItem(k);
      cleared.push(k);
    } catch {
      failed.push(k);
    }
  }

  return {
    cleared,
    failed,
    message:
      failed.length === 0
        ? `${cleared.length} Einträge gelöscht. Dieses Gerät weiß nichts mehr.`
        : `${cleared.length} gelöscht, ${failed.length} NICHT — ${failed.join(", ")}. ` +
          `Von Hand nachsehen.`,
  };
}

export type UnlockResult = "normal" | "zwang" | "falsch";

export interface UnlockCheck {
  result: UnlockResult;
  /** Was die Oberfläche tun soll. */
  action: "oeffnen" | "leer_oeffnen_und_loeschen" | "ablehnen";
  /** Nie an den Nutzer ausgeben, wenn `zwang` — er wird beobachtet. */
  internalNote: string;
}

/**
 * Eingegebene Phrase prüfen.
 *
 * Bei der Zwangsphrase darf die Oberfläche sich **in nichts** von der
 * normalen unterscheiden: keine andere Meldung, keine andere Ladezeit, kein
 * anderer Aufbau. Wer daneben steht, sieht eine App, die aufgeht.
 */
export function checkUnlock(
  eingabe: string,
  normalHash: string,
  duressHash: string | null,
  hashFn: (s: string) => string,
): UnlockCheck {
  const h = hashFn(eingabe.trim());

  if (h === normalHash) {
    return { result: "normal", action: "oeffnen", internalNote: "" };
  }
  if (duressHash && h === duressHash) {
    return {
      result: "zwang",
      action: "leer_oeffnen_und_loeschen",
      internalNote: "Zwangsphrase — löschen und leere Oberfläche zeigen.",
    };
  }
  return { result: "falsch", action: "ablehnen", internalNote: "" };
}

/**
 * Aufklärung VOR dem Einrichten.
 *
 * Die Gefahr steht zuerst. Wer nach diesem Text noch einrichtet, hat die
 * Entscheidung bewusst getroffen — und das ist bei einer Funktion, die ihrem
 * Nutzer schaden kann, die Mindestanforderung.
 */
export function duressWarning(): string {
  return [
    "BEVOR DU DAS EINRICHTEST — lies das ganz.",
    "",
    "Eine Zwangsphrase kann dir SCHADEN:",
    "",
    "  · In vielen Ländern ist das Vernichten von Beweismitteln strafbar.",
    "  · Diese Software ist quelloffen. Dass es die Funktion gibt, ist",
    "    öffentlich bekannt — man wird also danach fragen.",
    "  · Wird sie entdeckt, ist deine Lage schlechter als vorher: Du hast",
    "    dann nachweislich etwas verborgen.",
    "",
    "Sie hilft nur gegen jemanden, der die Funktion nicht kennt.",
    "Gegen eine Behörde, die dieses Programm kennt, hilft sie nicht.",
    "",
    "Was sie NICHT kann: Sie löscht nur dieses Gerät. Alles auf den Relays",
    "bleibt dort. Wer das für eine Löschung hält, täuscht sich über das",
    "Wesentliche.",
    "",
    "In den meisten Fällen ist es sicherer, diese Funktion NICHT zu nutzen",
    "und stattdessen gar nichts Belastendes auf dem Gerät zu haben.",
  ].join("\n");
}

/** Text vor der Sofortlöschung. */
export function wipeConfirmation(): string {
  return [
    "Alles auf diesem Gerät löschen?",
    "",
    "Gelöscht werden Schlüssel, Unterhaltungen, Räume, Namen und die",
    "Wallet-Verbindung. Es gibt KEINE Wiederherstellung.",
    "",
    "Ohne deine Merkphrase kommst du danach nicht zurück.",
    "",
    "Was NICHT gelöscht wird: alles, was schon auf Relays liegt.",
  ].join("\n");
}
