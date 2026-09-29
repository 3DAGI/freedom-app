/**
 * Schritt 5.1.3: KI-Aufträge im echten Pfad bezahlt. Deklaration im Kern vor
 * dem Versiegeln, Abrechnung bei der Antwort mit denselben Empfängern, Anteil
 * des Providers an seine Lightning-Adresse aus dem Angebot, übrige Anteile in
 * die Kasse – alles nur über die Zahlschienen. Die App-Gebühr ist weg.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hoechstMsat } from "../src/anteile-kasse.js";

const lies = (pfad: string) => readFileSync(new URL(`../src/${pfad}`, import.meta.url), "utf8");

test("Höchstbetrag je Antwort: Gebot plus Werkzeuge nach Preisliste; Gratis-Tarif nichts", () => {
  assert.equal(hoechstMsat(21, []), 21_000);
  assert.equal(hoechstMsat(0, [{ kind: 5250 }]), 0);
  assert.equal(hoechstMsat(Number.NaN, []), 0);
  // web_search 5 sats, browser_use 15 sats – wie der Knoten rechnet (defaultToolPrice)
  assert.equal(hoechstMsat(21, [{ kind: 5060 }, { kind: 5062 }]), 41_000);
  assert.equal(hoechstMsat(21, [{ kind: 424242 }]), 21_000, "unbekanntes Werkzeug kostet nichts extra");
});

test("verdrahtet: Deklaration vor dem Versiegeln, Abrechnung bei der Antwort, Zahlung über die Schienen", () => {
  const agent = lies("shell/tabs/agent.ts");
  const bau = agent.slice(agent.indexOf("async function buildJobEvent("), agent.indexOf("/** Abbruch-Signal"));
  // Ohne Zahlkanal die Deklaration, mit ihm die Gutschrift (4.3d) – beides vor dem Versiegeln
  assert.match(bau, /const empfaenger = await empfaengerFuer\(targetPubkey\);\s*const hoechst = hoechstMsat\(bid, selectedTools\);[\s\S]*?extraTags\.push\(\.\.\.\(kanal \? kanal\.tags : deklaration\(empfaenger\)\)\);/);
  assert.match(bau, /merkeAnfrage\(auftrag\.requestId, empfaenger, hoechst, !!kanal\);\s*return auftrag;/);
  const antwort = agent.slice(agent.indexOf("async function handleAnswer("), agent.indexOf("/** Send-Button nach Job-Ende"));
  assert.match(antwort, /const abrechnung = kanal \? undefined : await rechneAntwortAb\(r\.requestId, r\.amountMsat\);/);
  assert.match(antwort, /const \{ zahlung, grund \} = await providerZahlung\(r\.providerPubkey\);\s*const charge = await sc\.chargeForResult\(r\.providerPubkey, abrechnung\.providerMsat, ev\.id, zahlung\);/);
  assert.match(antwort, /void zahleAnteile\(\)/);

  const kz = lies("shell/ki-zahlung.ts");
  assert.match(kz, /rechnung: \(msat\) => rechnungUeber\(lud16, msat\),/);
  assert.match(kz, /rechnung: \(ziel, msat\) => rechnungUeber\(ziel, msat\),/);
  assert.match(kz, /if \(bolt11BetragMsat\(rechnung\) !== msat\) throw/, "Betrag vor dem Zahlen geprüft – sonst nichts gezahlt, nicht unklar");
  assert.match(kz, /zahle\(zahlschienen\(\), \{ ziel: rechnung, betrag: \{ einheit: "msat", wert: msat \}, zweck: "job" \}\)/);
  assert.match(kz, /zahle\(zahlschienen\(\), \{ ziel: rechnung, betrag: \{ einheit: "msat", wert: msat \}, zweck: "gebuehr" \}\)/);
  // Empfänger (5.1.3b): Werber beider Seiten, Relays des Pools – nur bekannte, gelernt im Hintergrund
  assert.match(kz, /const kundenWerber = werberZahlziel\(localStorage, state\.keypair\?\.pk\);/);
  assert.match(kz, /void relayZiele\.lerne\(urls\)[\s\S]*const relays = relayZiele\.bekannte\(urls\);/);
  assert.match(kz, /entwicklung: ENTWICKLUNG,\s*\.\.\.\(werber \? \{ "werber-provider": \{ lud16: werber \} \} : \{\}\),\s*\.\.\.\(kundenWerber \? \{ "werber-kunde": kundenWerber \} : \{\}\),\s*\.\.\.\(relays\.length > 0 \? \{ relays \} : \{\}\),/);
  const earn = lies("shell/tabs/earn.ts");
  // seit 11.2a mit der eigenen Adresse der App, falls gesetzt; seit 11.2b mit dem Namen statt des Schlüssels, falls geprüft
  assert.match(earn, /const basis = eigeneBasis\(localStorage\) \?\? window\.location\.origin \+ window\.location\.pathname;/);
  assert.match(earn, /link\.value = werbeLink\(basis, werbeRef\(localStorage, pub, basis\), lud16\);/);
  assert.match(earn, /merkeWerber\(window\.location\.search, localStorage, window\.location\.hostname\);/);
  assert.match(kz, /new AnteilsKasse\(\{ speicher: geheim \}\)/, "Stand nur über geheim");
  assert.match(lies("shell/tresor.ts"), /"freedom\.anteile"/, "im Tresor");
  assert.match(lies("shell/tabs/settings.ts"), /kasse\.klaere\(u\.rechnung, gezahlt\)/, "unklare Zahlungen klärt der Nutzer");
});

test("keine App-Gebühr und kein Keysend mehr; keine Verwahrer-Adresse in der App", () => {
  const wurzel = fileURLToPath(new URL("../src/", import.meta.url));
  const dateien = (d: string): string[] => readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? dateien(p) : /\.(ts|html)$/.test(n) ? [p] : [];
  });
  for (const f of dateien(wurzel)) {
    const s = readFileSync(f, "utf8");
    assert.doesNotMatch(s, /walletof[s]atoshi|clientFeeTag|aktiveClientGebuehr|clientfee-percent|\.keysend\(/, f);
  }
});
