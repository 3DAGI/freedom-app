/**
 * Adressen fuer Swaps: frisch statt wiederverwendet.
 *
 * DAS PROBLEM, DAS DAS LOEST
 * Eine Solana-Adresse ist ein dauerhafter Name. Wer sie einmal einer Person
 * zuordnet, sieht rueckwirkend und kuenftig ALLES, was sie damit getan hat.
 * Das ist kein theoretischer Angriff, sondern das Geschaeftsmodell mehrerer
 * Firmen.
 *
 * Kein Mixnetz und kein Tor aendert daran etwas: Der Abfluss passiert auf der
 * Kette, nicht auf der Leitung.
 *
 * DIE MASSNAHME
 * Fuer jeden Swap eine frische Adresse, abgeleitet aus demselben Schluessel.
 * Der Nutzer merkt nichts, muss nichts sichern und behaelt trotzdem alles —
 * die Ableitung ist deterministisch.
 *
 * DIE ZWEITE, WICHTIGERE MASSNAHME
 * Runde Betraege verbinden Adressen wieder. Wer dreimal exakt 0,5 SOL
 * bewegt, hat drei Adressen und ein Muster. Deshalb wird gewarnt und ein
 * unauffaelligerer Betrag vorgeschlagen.
 *
 * WAS DAS NICHT LEISTET
 * Zeitkorrelation bleibt. Wer beobachtet, dass zwei Adressen immer im Abstand
 * von Sekunden aktiv werden, kann sie verbinden — dagegen hilft nur Warten,
 * und das gehoert gesagt statt verschwiegen.
 */
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export interface DerivedAddress {
  /** Laufende Nummer. */
  index: number;
  /** Privater Schluessel dieser Adresse. */
  secret: Uint8Array;
  /** Woraus abgeleitet — zur Wiederherstellung. */
  path: string;
}

/**
 * Frische Adresse ableiten.
 *
 * Deterministisch aus dem Hauptschluessel: Wer seine Merkphrase hat, kommt an
 * jede jemals abgeleitete Adresse zurueck. Eine zufaellige Adresse waere
 * ebenso privat und muesste einzeln gesichert werden — und genau daran
 * scheitern solche Verfahren in der Praxis.
 */
export function deriveSwapAddress(identitySecret: Uint8Array, index: number): DerivedAddress {
  if (!Number.isInteger(index) || index < 0) throw new Error("Index muss eine natuerliche Zahl sein.");
  const path = `freedom-swap-v1/${index}`;
  const secret = hkdf(
    sha256, identitySecret,
    new TextEncoder().encode("freedom-swap-v1"),
    new TextEncoder().encode(String(index)),
    32,
  );
  return { index, secret, path };
}

export interface AddressUsage {
  address: string;
  /** Wie oft benutzt. */
  uses: number;
  firstUsed: number;
  lastUsed: number;
}

export type ReuseSeverity = "frisch" | "einmal_wiederverwendet" | "muster";

export interface ReuseCheck {
  severity: ReuseSeverity;
  message: string;
  /** Empfohlene naechste Nummer. */
  nextIndex: number;
}

/**
 * Wiederverwendung pruefen.
 *
 * Schon die zweite Benutzung verbindet zwei Vorgaenge. Ab der dritten
 * entsteht ein Muster, aus dem sich Gewohnheiten ablesen lassen — und
 * Gewohnheiten identifizieren Menschen zuverlaessiger als einzelne Vorgaenge.
 */
export function checkReuse(usage: AddressUsage[], nextIndexHint = 0): ReuseCheck {
  const benutzt = usage.filter((u) => u.uses > 0);
  const naechste = Math.max(nextIndexHint, benutzt.length);

  const mehrfach = benutzt.filter((u) => u.uses > 1);
  if (mehrfach.length === 0) {
    return {
      severity: "frisch", nextIndex: naechste,
      message: `${benutzt.length} Adresse(n), jede nur einmal benutzt. So soll es sein.`,
    };
  }

  const schlimmste = mehrfach.sort((a, b) => b.uses - a.uses)[0];
  if (schlimmste.uses >= 3) {
    return {
      severity: "muster", nextIndex: naechste,
      message:
        `Eine Adresse wurde ${schlimmste.uses}-mal benutzt. Daraus laesst sich ein ` +
        `Muster ablesen — und Gewohnheiten identifizieren Menschen zuverlaessiger ` +
        `als einzelne Vorgaenge. Die Vergangenheit laesst sich nicht mehr trennen.`,
    };
  }
  return {
    severity: "einmal_wiederverwendet", nextIndex: naechste,
    message:
      `Eine Adresse wurde zweimal benutzt. Damit sind diese beiden Vorgaenge ` +
      `oeffentlich miteinander verbunden. Ab jetzt eine frische nehmen.`,
  };
}

export interface AmountAdvice {
  suspicious: boolean;
  /** Vorschlag fuer einen unauffaelligeren Betrag. */
  suggested?: number;
  message: string;
}

/**
 * Runde Betraege verbinden Adressen wieder.
 *
 * Wer dreimal exakt 0,5 SOL bewegt, hat drei Adressen und ein Muster. Ein
 * kleiner zufaelliger Zuschlag kostet nichts und bricht die Verbindung.
 */
export function checkAmount(lamports: number, randomFn: () => number = Math.random): AmountAdvice {
  if (lamports <= 0) return { suspicious: false, message: "Kein Betrag." };

  // Runde Betraege in SOL oder Zehntel-SOL sind das Auffaellige.
  const rundungen = [1_000_000_000, 100_000_000, 10_000_000];
  const istRund = rundungen.some((r) => lamports % r === 0);

  if (!istRund) {
    return { suspicious: false, message: "Betrag unauffaellig." };
  }

  // Bis zu 0,3 % Zuschlag: genug zum Unterscheiden, zu wenig zum Aerger.
  const zuschlag = Math.floor(lamports * (randomFn() * 0.003));
  return {
    suspicious: true,
    suggested: lamports + Math.max(1, zuschlag),
    message:
      `${(lamports / 1e9).toFixed(3)} SOL ist ein runder Betrag. Wer mehrfach ` +
      `denselben runden Betrag bewegt, verbindet damit seine Adressen wieder — ` +
      `auch wenn jede frisch war. Ein kleiner Zuschlag bricht das Muster.`,
  };
}

export interface TimingAdvice {
  correlated: boolean;
  message: string;
}

/**
 * Zeitkorrelation.
 *
 * Die Grenze des ganzen Verfahrens: Zwei Adressen, die immer im Abstand von
 * Sekunden aktiv werden, gehoeren erkennbar zusammen. Dagegen hilft nur
 * Warten — und das gehoert gesagt, statt eine Sicherheit vorzutaeuschen, die
 * frische Adressen allein nicht geben.
 */
export function checkTiming(
  lastSwapAt: number | undefined,
  nowSecs = Math.floor(Date.now() / 1000),
): TimingAdvice {
  if (lastSwapAt === undefined) {
    return { correlated: false, message: "Erster Swap." };
  }
  const abstand = nowSecs - lastSwapAt;
  if (abstand < 300) {
    return {
      correlated: true,
      message:
        `Der letzte Swap war vor ${Math.round(abstand / 60)} Minuten. Zwei Vorgaenge ` +
        `dicht hintereinander lassen sich ueber die Zeit verbinden, auch bei ` +
        `frischen Adressen. Wenn es darauf ankommt: warten.`,
    };
  }
  if (abstand < 3600) {
    return {
      correlated: true,
      message: `Letzter Swap vor ${Math.round(abstand / 60)} Minuten — eine Verbindung ist moeglich.`,
    };
  }
  return { correlated: false, message: "Genug zeitlicher Abstand." };
}

export interface SwapPrivacyReport {
  ok: boolean;
  findings: string[];
  /** Was zu tun ist, in der Reihenfolge des Gewinns. */
  actions: string[];
}

/** Gesamtbild vor einem Swap. */
export function swapPrivacyCheck(input: {
  usage: AddressUsage[];
  lamports: number;
  lastSwapAt?: number;
  nowSecs?: number;
  randomFn?: () => number;
}): SwapPrivacyReport {
  const reuse = checkReuse(input.usage);
  const amount = checkAmount(input.lamports, input.randomFn);
  const timing = checkTiming(input.lastSwapAt, input.nowSecs);

  const findings: string[] = [];
  const actions: string[] = [];

  if (reuse.severity !== "frisch") {
    findings.push(reuse.message);
    actions.push(`Frische Adresse nehmen (Nummer ${reuse.nextIndex}).`);
  }
  if (amount.suspicious) {
    findings.push(amount.message);
    actions.push(`Betrag auf ${((amount.suggested ?? 0) / 1e9).toFixed(6)} SOL aendern.`);
  }
  if (timing.correlated) {
    findings.push(timing.message);
    actions.push("Warten, wenn es darauf ankommt.");
  }

  return {
    ok: findings.length === 0,
    findings: findings.length > 0 ? findings : ["Nichts Auffaelliges."],
    actions,
  };
}

export function swapPrivacyInfo(): string {
  return [
    "Jede Kettentransaktion ist dauerhaft oeffentlich.",
    "",
    "Deshalb bekommt jeder Swap eine frische Adresse, abgeleitet aus deinem",
    "Schluessel. Du musst nichts zusaetzlich sichern — deine Merkphrase",
    "bringt jede davon zurueck.",
    "",
    "Was frische Adressen NICHT loesen:",
    "  · Runde Betraege verbinden sie wieder.",
    "  · Zwei Swaps dicht hintereinander lassen sich ueber die Zeit verbinden.",
    "  · Wer einmal eine Adresse einer Person zuordnet, sieht rueckwirkend",
    "    alles, was ueber sie lief.",
    "",
    "Kein Mixnetz und kein Tor aendert daran etwas: Der Abfluss passiert auf",
    "der Kette, nicht auf der Leitung.",
  ].join("\n");
}

/** Oeffentlicher Teil einer abgeleiteten Adresse, zum Wiederfinden. */
export function addressFingerprint(d: DerivedAddress): string {
  return bytesToHex(sha256(d.secret)).slice(0, 16);
}
