/**
 * Schritt 4.9d: Adresse fuer ein SOL-Trinkgeld versiegelt anfragen. Geprueft
 * wird der ganze Weg ueber ein Relay: Der Empfaenger antwortet nur bekannten
 * Kontakten, jedem mit einer eigenen, stabilen Adresse; der Geber merkt sie
 * sich. Fremde, alte oder falsche Anfragen bleiben ohne Antwort.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LocalSigner, MemoryRelay, OutboxPool, generateKeypair, type NostrEvent } from "@freedomstack/protocol";
import { identityFromMnemonic } from "../src/identity.js";
import { EingebauteSolWallet, type WalletSpeicher } from "../src/sol-wallet.js";
import { ANFRAGE_GUELTIG_SECS, beantworteAdressAnfrage, frageAdresseAn, gemerkteAdresse } from "../src/trinkgeld-adresse.js";

// Oeffentliche BIP-39-Testphrase – kein Geheimnis.
const PHRASE = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const KETTE = "solana:devnet";

function speicher(): WalletSpeicher {
  const d = new Map<string, string>();
  return { getItem: (k) => d.get(k) ?? null, async setItem(k, v) { d.set(k, v); }, async removeItem(k) { d.delete(k); } };
}

async function aufbau(o: { kontakte?: (pk: string) => boolean; mitWallet?: boolean; jetztVersatz?: number; kette?: string } = {}) {
  const pool = new OutboxPool([new MemoryRelay("mem://tip")], { minAcks: 1 });
  const empf = new LocalSigner(identityFromMnemonic(PHRASE).sk);
  const wallet = new EingebauteSolWallet(speicher());
  if (o.mitWallet !== false) await wallet.einrichten(PHRASE, empf.publicKey());
  const empfSpeicher = speicher();
  const beantwortet = new Set<string>();
  /** Die App des Empfaengers: oeffnet ihren Posteingang und antwortet (wie alsAdressAnfrage). */
  const empfaengerApp = async () => {
    for (const w of await pool.query({ kinds: [1059], "#p": [empf.publicKey()] })) {
      if (beantwortet.has(w.id)) continue;
      beantwortet.add(w.id);
      await beantworteAdressAnfrage({
        wrap: w, signer: empf, speicher: empfSpeicher, istKontakt: o.kontakte ?? (() => true),
        frischeAdresse: async () => (o.mitWallet === false || wallet.vorratFrei() === 0 ? undefined : wallet.frischeAdresse()),
        kette: o.kette ?? KETTE, sende: async (wrap: NostrEvent) => { await pool.publish(wrap); },
        jetzt: Math.floor(Date.now() / 1000) + (o.jetztVersatz ?? 0),
      });
    }
  };
  const frage = (geber: LocalSigner, sp: WalletSpeicher) =>
    frageAdresseAn({ pool, speicher: sp, signer: geber, empfaenger: empf.publicKey(), kette: KETTE, warteMs: 300, pause: empfaengerApp });
  return { pool, empf, wallet, frage };
}

test("Kontakt fragt an: bekommt eine eigene frische Adresse, gemerkt – beim zweiten Mal dieselbe, ohne den Vorrat zu leeren", async () => {
  const a = await aufbau();
  const geber = new LocalSigner(generateKeypair().sk);
  const sp = speicher();
  const erste = await a.frage(geber, sp);
  assert.ok(erste);
  assert.equal(gemerkteAdresse(sp, a.empf.publicKey(), KETTE), erste);
  assert.notEqual(erste, a.wallet.adresse(), "nie die Hauptadresse");
  const vorrat = a.wallet.vorratFrei();
  assert.equal(await a.frage(geber, speicher()), erste, "derselbe Kontakt: dieselbe Adresse");
  assert.equal(a.wallet.vorratFrei(), vorrat, "kein neuer Eintrag aus dem Vorrat");
  const zweiter = await a.frage(new LocalSigner(generateKeypair().sk), speicher());
  assert.ok(zweiter && zweiter !== erste, "ein anderer Kontakt: eine andere Adresse");
});

test("Keine Antwort: Fremde, alte Anfragen, andere Kette, ohne eingebaute Wallet", async () => {
  const geber = () => new LocalSigner(generateKeypair().sk);
  assert.equal(await (await aufbau({ kontakte: () => false })).frage(geber(), speicher()), undefined, "kein Kontakt");
  assert.equal(await (await aufbau({ jetztVersatz: ANFRAGE_GUELTIG_SECS + 60 })).frage(geber(), speicher()), undefined, "zu alt");
  assert.equal(await (await aufbau({ kette: "solana:mainnet" })).frage(geber(), speicher()), undefined, "andere Kette");
  assert.equal(await (await aufbau({ mitWallet: false })).frage(geber(), speicher()), undefined, "ohne Wallet");
});

test("Verdrahtung (4.9d): Trinkgeld fragt erst versiegelt an, Profil nur mit Warnung; Posteingang beantwortet Anfragen, jede Minute", () => {
  const z = readFileSync(new URL("../src/chat-zap.ts", import.meta.url), "utf8");
  const [gemerkt, gefragt, profil] = ["gemerkteAdresse(geheim, state.recipientPubkey, kette)", "await frageAdresseAn({", "if (!ziel && offen && confirm("].map((x) => z.indexOf(x));
  assert.ok(gemerkt > 0 && gemerkt < gefragt && gefragt < profil, "gemerkt → anfragen → Profil nur mit Rueckfrage");
  const k = readFileSync(new URL("../src/shell/tabs/kommunikation.ts", import.meta.url), "utf8");
  assert.match(k, /\(await alsTrinkgeld\(w\)\) \?\? \(await alsAdressAnfrage\(w\)\)/);
  assert.match(k, /istKontakt: \(pk\) => conversations\.some\(\(c\) => c\.type === "dm" && c\.id === pk\)/);
  const app = readFileSync(new URL("../src/shell/app.ts", import.meta.url), "utf8");
  assert.match(app, /setInterval\(\(\) => void posteingangAbgleichen\(\), 60_000\)/);
});
