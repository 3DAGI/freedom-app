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
  { label: "Identität (Schlüssel, Merkphrase-Sicherung)", storageKeys: ["freedom.nsec", "freedom.backup.mnemonic"], critical: true },
  { label: "Tresor", storageKeys: ["freedom.vault", "freedom.vault.sperreMin"], critical: true },
  { label: "Unterhaltungen und Verläufe", storageKeys: ["freedom.chats", "freedom.agentHistory", "freedom.swapHistory"], critical: false },
  { label: "Räume und Lesestände", storageKeys: ["freedom.spaces", "freedom.lastRead"], critical: false },
  { label: "Eigene Namen", storageKeys: ["freedom.petnames"], critical: false },
  { label: "Profil", storageKeys: ["freedom.profile"], critical: false },
  { label: "Wallet-Verbindung und eingebaute SOL-Wallet", storageKeys: ["freedom.nwc.uri", "freedom.solWallet"], critical: true },
  { label: "Gerätevollmachten (Bunker-Sitzung)", storageKeys: ["freedom.bunker"], critical: true },
  { label: "Suchindex (Schlüssel)", storageKeys: ["freedom.suche.schluessel"], critical: false },
];

/**
 * IndexedDB-Datenbanken der App: Tresor, Suchindex (8.13), Blob-Speicher.
 * Geloescht wird zusaetzlich jede Datenbank, deren Name mit `freedom`
 * beginnt – wie beim Praefix fuer localStorage.
 */
export const WIPE_DATENBANKEN = ["freedom-vault", "freedom-suche", "freedom-blobs"];

const unsere = (name: string): boolean => name.startsWith("freedom");

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

/** Was `loescheAllesLokal()` braucht – im Browser localStorage, sessionStorage, indexedDB. */
export interface LoeschUmgebung {
  local: StorageLike;
  session?: StorageLike;
  /** Namen aller Datenbanken (`indexedDB.databases()`); fehlt, wo der Browser es nicht kann. */
  datenbanken?: () => Promise<string[]>;
  loescheDatenbank: (name: string) => Promise<void>;
}

export interface LoeschBericht extends WipeResult {
  /** Was nach dem Loeschen noch da ist – leer heisst: nachgeprueft, nichts uebrig. */
  uebrig: string[];
  /** false, wenn der Browser keine Liste der Datenbanken liefert. */
  nachgeprueft: boolean;
}

async function namen(u: LoeschUmgebung): Promise<string[] | null> {
  if (!u.datenbanken) return null;
  try {
    return (await u.datenbanken()).filter(unsere);
  } catch {
    return null;
  }
}

function reste(s: StorageLike | undefined): string[] {
  const r: string[] = [];
  if (!s) return r;
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (k && k.startsWith("freedom.")) r.push(k);
  }
  return r;
}

/**
 * Notfall-Loeschung (Schritt 8.14): alles, was die App auf diesem Geraet
 * hat – localStorage und sessionStorage (Praefix `freedom.`) und die
 * Datenbanken –, danach nachpruefen, ob noch etwas da ist.
 *
 * RECHTLICHER HINWEIS: In vielen Laendern ist das Vernichten von
 * Beweismitteln strafbar – etwa waehrend eines Verfahrens oder einer
 * Durchsuchung. Die Oberflaeche zeigt deshalb vor dem Loeschen
 * `wipeConfirmation()`, die das sagt. Relays erreicht die Loeschung nicht.
 */
export async function loescheAllesLokal(u: LoeschUmgebung): Promise<LoeschBericht> {
  const lokal = wipeAll(u.local);
  const sitzung = u.session ? wipeAll(u.session) : { cleared: [], failed: [] };
  const cleared = [...lokal.cleared, ...sitzung.cleared];
  const failed = [...lokal.failed, ...sitzung.failed];
  const dbs = [...new Set([...WIPE_DATENBANKEN, ...((await namen(u)) ?? [])])];
  for (const db of dbs) {
    try {
      await u.loescheDatenbank(db);
      cleared.push(`db:${db}`);
    } catch {
      failed.push(`db:${db}`);
    }
  }
  const nachher = await namen(u);
  const uebrig = [...reste(u.local), ...reste(u.session), ...(nachher ?? []).map((n) => `db:${n}`)];
  const offen = [...new Set([...failed, ...uebrig])];
  return {
    cleared,
    failed,
    uebrig,
    nachgeprueft: nachher !== null,
    message:
      offen.length === 0
        ? `${cleared.length} Einträge und Datenbanken gelöscht${nachher === null ? "" : " und nachgeprüft"}. Dieses Gerät weiß nichts mehr.`
        : `${cleared.length} gelöscht, ${offen.length} NICHT — ${offen.join(", ")}. Von Hand nachsehen.`,
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
    "Gelöscht werden Schlüssel, Tresor, Unterhaltungen, Suchindex, Räume,",
    "Namen, Wallet-Verbindung und die eingebaute SOL-Wallet.",
    "Es gibt KEINE Wiederherstellung.",
    "",
    "Ohne deine Merkphrase kommst du danach nicht zurück. Geld in laufenden",
    "Tauschvorgängen oder Sperren kann verloren sein – ihre Geheimnisse",
    "liegen nur hier.",
    "",
    "RECHTLICHER HINWEIS: In vielen Ländern ist das Vernichten von",
    "Beweismitteln strafbar – etwa während eines Verfahrens oder einer",
    "Durchsuchung. Das ist keine Rechtsberatung.",
    "",
    "Was NICHT gelöscht wird: alles, was schon auf Relays liegt.",
  ].join("\n");
}
