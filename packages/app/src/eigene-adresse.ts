/**
 * Werbelink mit eigener Domain (Schritt 11.2a), ohne DOM.
 *
 * Wer freedom.html auf einer eigenen Domain anbietet, wirbt mit dieser Adresse
 * statt mit der, unter der die App gerade läuft. Wer über den Link kommt, lädt
 * die App von dort: Der Werber bekommt 0,5 % (`ref`, 5.1.3b), und liegt dort
 * `freedom-spiegel.json`, geht der Hosting-Anteil von 1 % an deren Adressen
 * (5.3a) – beides nur für KI-Zahlungen über diese Kopie.
 *
 * Nur https: Geworbene sollen die App nicht über eine Verbindung laden, auf der
 * jeder unterwegs die Datei austauschen kann. Ob dort eine echte Version liegt,
 * prüft `pruefeKopie()` gegen die signierten Manifeste (5.2) – nur auf
 * Knopfdruck, denn die Abfrage nennt dem Server die eigene IP. Ohne Manifest
 * bekannter Signierer sagt die App ehrlich „nicht geprüft“.
 */
import {
  SPIEGEL_DATEI, hashBytes, isPrivateAddress, leseSpiegelDatei, verifyArtifact,
  type ReleaseManifest, type VerifyResult, type Zahlziel,
} from "@freedomstack/protocol";

/** Die eigene Adresse der App – kein Geheimnis, kommt mit der Sicherung (8.12). */
export const LS_EIGENE_ADRESSE = "freedom.werben.adresse";

/** Größte Datei, die die Prüfung liest – freedom.html hat rund 7 MB. */
export const KOPIE_MAX_BYTES = 32 * 1024 * 1024;

export type AdressFall = "leer" | "ungueltig" | "kein-https" | "zugangsdaten" | "lokal";

/**
 * Eingabe prüfen: nur https, ohne Zugangsdaten, keine lokale oder private
 * Adresse. Suchteil und Anker fallen weg – den Rest setzt `werbeLink()`.
 */
export function pruefeEigeneAdresse(eingabe: string): { ok: true; basis: string } | { ok: false; fall: AdressFall } {
  const roh = eingabe.trim();
  if (!roh) return { ok: false, fall: "leer" };
  let url: URL;
  try {
    url = new URL(roh);
  } catch {
    return { ok: false, fall: "ungueltig" };
  }
  if (url.protocol !== "https:") return { ok: false, fall: "kein-https" };
  if (url.username || url.password) return { ok: false, fall: "zugangsdaten" };
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host.includes(".") && !host.includes(":")) return { ok: false, fall: "lokal" };
  // isPrivateAddress() nimmt nur IP-Adressen (anderes gilt ihr als privat)
  const ip = /^[\d.]+$/.test(host) || host.includes(":");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || (ip && isPrivateAddress(host))) {
    return { ok: false, fall: "lokal" };
  }
  url.search = "";
  url.hash = "";
  return { ok: true, basis: url.toString() };
}

/** Die gemerkte eigene Adresse – nur, wenn sie die Prüfung noch besteht. */
export function eigeneBasis(s: Pick<Storage, "getItem">): string | undefined {
  const r = pruefeEigeneAdresse(s.getItem(LS_EIGENE_ADRESSE) ?? "");
  return r.ok ? r.basis : undefined;
}

export interface KopieErgebnis {
  /** Echtheit der Datei dort (k von n) – null, wenn sie nicht lesbar war. */
  pruefung: VerifyResult | null;
  /** Warum nicht lesbar: Server antwortet nicht oder verbietet die Abfrage (CORS), oder zu groß. */
  fall?: "nicht-erreichbar" | "zu-gross";
  /** Hosting-Anteil laut `freedom-spiegel.json` dort – null ohne gültige Datei. */
  hosting: Zahlziel | null;
}

type Holen = (url: string) => Promise<Response>;
// Weiterleitungen folgen: Geworbene landen auch dort – geprüft wird, was sie bekämen
const holenStandard: Holen = (url) => fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });

/**
 * Liegt an der eigenen Adresse eine echte Version? Die Datei wird gehasht und
 * gegen die Manifeste der vertrauten Signierer gehalten; daneben die
 * Spiegel-Datei gelesen. Nie geworfen – jeder Ausgang ist ein Ergebnis.
 */
export async function pruefeKopie(
  basis: string,
  manifeste: ReleaseManifest[],
  signierer: string[],
  holen: Holen = holenStandard,
): Promise<KopieErgebnis> {
  const hosting = await holen(new URL(SPIEGEL_DATEI, basis).toString())
    .then(async (r) => (r.ok ? leseSpiegelDatei(await r.json()) : null))
    .catch(() => null);
  let r: Response;
  try {
    r = await holen(basis);
  } catch {
    return { pruefung: null, fall: "nicht-erreichbar", hosting };
  }
  if (!r.ok) return { pruefung: null, fall: "nicht-erreichbar", hosting };
  if (Number(r.headers.get("content-length") ?? 0) > KOPIE_MAX_BYTES) return { pruefung: null, fall: "zu-gross", hosting };
  let daten: Uint8Array;
  try {
    daten = new Uint8Array(await r.arrayBuffer());
  } catch {
    return { pruefung: null, fall: "nicht-erreichbar", hosting };
  }
  if (daten.byteLength > KOPIE_MAX_BYTES) return { pruefung: null, fall: "zu-gross", hosting };
  return { pruefung: verifyArtifact(await hashBytes(daten), "freedom.html", manifeste, signierer), hosting };
}
