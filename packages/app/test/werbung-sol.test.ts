/**
 * Phase 12.2 (E1 A): Der Werbelink trägt auch eine SOL-Adresse (`&sol=`) –
 * eine frische aus der eingebauten Wallet, je Kette einmal vergeben. Die App des
 * Geworbenen merkt sie wie die Lightning-Adresse: nur vom ersten Werber, nie
 * überschrieben. So kommt sein Anteil auch bei Zahlungen per Zahlkanal an.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SICHERUNG_EINTRAEGE, SICHERUNG_NIE } from "@freedomstack/protocol";
import {
  LS_WERBER, LS_WERBER_LN, LS_WERBER_NAME, LS_WERBER_SOL, LS_WERBE_SOL,
  loeseWerberName, merkeWerber, werbeLink, werbeSolAdresse, werberZahlziel,
} from "../src/werbung.js";

const pk = (c: string) => c.repeat(64);
const SOL_A = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const SOL_B = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
const speicher = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

test("Werbelink mit SOL-Adresse; eine ungültige fehlt", () => {
  const url = new URL(werbeLink("https://app.example/", pk("a"), "ich@wallet.example", SOL_A));
  assert.equal(url.searchParams.get("sol"), SOL_A);
  assert.equal(url.searchParams.get("ln"), "ich@wallet.example");
  assert.equal(new URL(werbeLink("https://app.example/", pk("a"), undefined, SOL_A)).searchParams.get("sol"), SOL_A, "auch ohne Lightning");
  for (const falsch of ["0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl", "abc", `${SOL_A}x`, ""]) {
    assert.equal(new URL(werbeLink("https://app.example/", pk("a"), undefined, falsch)).searchParams.has("sol"), false, falsch);
  }
});

test("Merken: SOL-Adresse nur vom ersten Werber, nicht überschrieben, Unsinn nicht", () => {
  const s = speicher();
  merkeWerber(`?ref=${pk("a")}&sol=${SOL_A}`, s);
  assert.equal(s.getItem(LS_WERBER_SOL), SOL_A);
  merkeWerber(`?ref=${pk("b")}&sol=${SOL_B}`, s);
  assert.equal(s.getItem(LS_WERBER), pk("a"));
  assert.equal(s.getItem(LS_WERBER_SOL), SOL_A, "ein fremder Link schiebt keine Adresse unter");
  merkeWerber(`?ref=${pk("a")}&sol=${SOL_B}`, s);
  assert.equal(s.getItem(LS_WERBER_SOL), SOL_A, "auch der eigene Werber überschreibt nicht");
  const t = speicher();
  merkeWerber(`?ref=${pk("c")}&sol=keine-adresse`, t);
  assert.equal(t.getItem(LS_WERBER_SOL), null);
});

test("Zahlziel des Werbers: Lightning, SOL oder beides – nie ohne Werber, nie an sich selbst", () => {
  const s = speicher();
  assert.equal(werberZahlziel(s), undefined);
  merkeWerber(`?ref=${pk("a")}&sol=${SOL_A}`, s);
  assert.deepEqual(werberZahlziel(s), { sol: SOL_A }, "nur SOL – der Anteil kommt per Zahlkanal an");
  s.setItem(LS_WERBER_LN, "anna@wallet.example");
  assert.deepEqual(werberZahlziel(s), { lud16: "anna@wallet.example", sol: SOL_A });
  assert.equal(werberZahlziel(s, pk("a")), undefined, "nicht an sich selbst");
});

test("Kurzer Name im Link: die SOL-Adresse reist mit und gilt erst nach der Auflösung", async () => {
  const s = speicher();
  merkeWerber(`?ref=alice@kopie.example&sol=${SOL_A}`, s);
  assert.equal(s.getItem(LS_WERBER_SOL), null, "noch nicht – erst der Schlüssel zählt");
  assert.match(s.getItem(LS_WERBER_NAME) ?? "", new RegExp(SOL_A));
  const r = await loeseWerberName(s, async () => ({ ok: true as const, pubkey: pk("a") }), async () => undefined);
  assert.equal(r, "gemerkt");
  assert.equal(s.getItem(LS_WERBER), pk("a"));
  assert.equal(s.getItem(LS_WERBER_SOL), SOL_A);
});

test("Eigene SOL-Adresse für den Link: je Kette einmal frisch, danach dieselbe; ohne Wallet keine", async () => {
  const s = speicher();
  let n = 0;
  const vorrat = [SOL_A, SOL_B];
  const frisch = async () => vorrat[n++];
  assert.equal(await werbeSolAdresse(s, "solana:mainnet", frisch), SOL_A);
  assert.equal(await werbeSolAdresse(s, "solana:mainnet", frisch), SOL_A, "nicht jedes Mal eine neue");
  assert.equal(await werbeSolAdresse(s, "solana:devnet", frisch), SOL_B, "je Kette eine eigene");
  assert.equal(n, 2);
  assert.equal(await werbeSolAdresse(speicher(), "solana:mainnet", async () => undefined), undefined, "ohne eingebaute Wallet");
  assert.equal(await werbeSolAdresse(speicher(), "solana:mainnet", async () => "kaputt"), undefined, "nur gültige Adressen");
  const kaputt = speicher();
  kaputt.setItem(LS_WERBE_SOL, "{nicht json");
  assert.equal(await werbeSolAdresse(kaputt, "solana:mainnet", async () => SOL_A), SOL_A);
});

test("Ablage: die SOL-Adresse des Werbers in der Sicherung, die eigene nur im Tresor (Präfix der Wallet), nie gesichert", () => {
  assert.ok((SICHERUNG_EINTRAEGE as readonly string[]).includes(LS_WERBER_SOL));
  assert.ok(LS_WERBE_SOL.startsWith("freedom.solWallet"), "geheim über das Präfix der Wallet");
  assert.ok(SICHERUNG_NIE.some((r) => r.test(LS_WERBE_SOL)));
});

test("Verdrahtet: der Earn-Tab setzt die eigene frische Adresse in den Link", () => {
  const earn = readFileSync(new URL("../src/shell/tabs/earn.ts", import.meta.url), "utf8");
  assert.match(earn, /werbeSolAdresse\(geheim, ketteAusRpc\(await solRpcUrl\(\)\), frischeEmpfangsadresse\)/);
  assert.match(earn, /link\.value = werbeLink\(basis, werbeRef\(localStorage, pub, basis\), lud16, sol\);/);
  assert.doesNotMatch(earn, /werbeLink\([^)]*hauptadresse/i, "nie die Hauptadresse");
});
