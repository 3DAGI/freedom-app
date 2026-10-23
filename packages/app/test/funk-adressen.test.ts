/**
 * B-32c1: Reticulum-Adresse an Kontakte (W2 A) – Versand im Abruftakt nur mit Zustimmung und als Person, je Kontakt
 * einmal, je Schlag höchstens ein Umschlag; das Buch nimmt nur Kontakte und je Kontakt die neueste Adresse.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LocalSigner, generateKeypair, oeffneFunkAdresseUmschlag, type NostrEvent } from "@freedomstack/protocol";
import { setLang, t } from "../src/i18n.js";
import {
  FUNK_KONTAKTE_MAX, FUNK_PAUSE_SECS, FUNK_PRUEFEN_JEDEN, FunkAdressBuch, FunkAdressVersand, LS_FUNK_KONTAKTE, LS_FUNK_VERTEILT,
} from "../src/funk-adressen.js";

const ADRESSE = "7f3a".repeat(8);
const speicher = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, w: string) => void m.set(k, w) };
};

function aufbau(o: { zustimmung?: boolean; alsGeraet?: boolean; sendeOk?: (an: string) => boolean } = {}) {
  const ich = new LocalSigner(generateKeypair().sk);
  const kontakte = [generateKeypair().pk, generateKeypair().pk];
  const s = speicher();
  const gesendet: Array<{ wrap: NostrEvent; an: string }> = [];
  let uhr = 1_800_000_000;
  let adresse = ADRESSE;
  let adresseGefragt = 0;
  const v = new FunkAdressVersand({
    zustimmung: () => o.zustimmung ?? true,
    signer: () => (o.alsGeraet ? null : ich),
    kontakte: () => [...kontakte, kontakte[0]!, "zz"],
    adresse: async () => { adresseGefragt++; return adresse; },
    sende: async (wrap, an) => { if (o.sendeOk && !o.sendeOk(an)) return false; gesendet.push({ wrap, an }); return true; },
    speicher: s,
    jetzt: () => uhr,
  });
  const schlaege = async (n: number) => { for (let i = 0; i < n; i++) { uhr += 30; await v.takt(); } };
  return {
    v, ich, kontakte, s, gesendet, schlaege,
    setzeAdresse: (a: string) => { adresse = a; }, gefragt: () => adresseGefragt, vor: (sek: number) => { uhr += sek; },
  };
}

test("B-32c1: ohne Zustimmung oder als Gerät geht nichts hinaus – nicht einmal die eigene Adresse wird gerechnet", async () => {
  for (const o of [{ zustimmung: false }, { alsGeraet: true }]) {
    const a = aufbau(o);
    await a.schlaege(3);
    assert.deepEqual(a.gesendet, [], JSON.stringify(o));
    assert.equal(a.gefragt(), 0, "die Bibliothek von Reticulum lädt nur, wenn es etwas zu senden gibt");
    assert.equal(a.s.m.size, 0);
  }
});

test("B-32c1: je Schlag ein Umschlag, je Kontakt einmal – lesbar nur für ihn, gemerkt, wer ihn hat", async () => {
  const a = aufbau();
  await a.schlaege(1);
  assert.equal(a.gesendet.length, 1, "je Schlag höchstens einer");
  await a.schlaege(FUNK_PRUEFEN_JEDEN * 2);
  assert.deepEqual(a.gesendet.map((g) => g.an), a.kontakte, "je Kontakt einer, nichts Ungültiges, nicht doppelt");
  assert.deepEqual(JSON.parse(a.s.m.get(LS_FUNK_VERTEILT)!), { adresse: ADRESSE, an: a.kontakte });
  const k0 = new LocalSigner(generateKeypair().sk);
  assert.equal(await oeffneFunkAdresseUmschlag(a.gesendet[0]!.wrap, k0, new Set([a.ich.publicKey()])), null, "nur der Empfänger liest ihn");
  // Ein neuer Kontakt kommt beim nächsten Prüfen dran, die anderen nicht noch einmal
  const neu = generateKeypair().pk;
  a.kontakte.push(neu);
  await a.schlaege(FUNK_PRUEFEN_JEDEN);
  assert.deepEqual(a.gesendet.map((g) => g.an).slice(2), [neu]);
  // Eine neue Adresse (andere Identität) bekommen alle neu
  a.setzeAdresse("00".repeat(16));
  await a.schlaege(FUNK_PRUEFEN_JEDEN * 3 + 1);
  assert.deepEqual(a.gesendet.map((g) => g.an).slice(3), a.kontakte);
  assert.equal(JSON.parse(a.s.m.get(LS_FUNK_VERTEILT)!).adresse, "00".repeat(16));
});

test("B-32c1: nicht zustellbar – einen Tag Pause für diesen Kontakt; nach der Zustimmung gleich beim nächsten Schlag", async () => {
  let kaputt = true;
  const a = aufbau({ sendeOk: () => !kaputt });
  await a.schlaege(2);
  assert.equal(a.gesendet.length, 0);
  kaputt = false;
  await a.schlaege(FUNK_PRUEFEN_JEDEN + 2);
  assert.equal(a.gesendet.length, 0, "beide Kontakte haben Pause");
  a.vor(FUNK_PAUSE_SECS);
  a.v.bald();
  await a.schlaege(2);
  assert.deepEqual(a.gesendet.map((g) => g.an), a.kontakte, "nach der Pause und mit bald() sofort");
});

test("B-32c1: das Buch – nur neuere Adressen, nur gültige, höchstens FUNK_KONTAKTE_MAX, gelesen nur für Kontakte", async () => {
  const s = speicher();
  const b = new FunkAdressBuch(s);
  const k = generateKeypair().pk;
  assert.equal(await b.nimm({ von: k, zeit: 100, adresse: ADRESSE }), true);
  assert.equal(await b.nimm({ von: k, zeit: 100, adresse: "00".repeat(16) }), false, "nicht gleich alt");
  assert.equal(await b.nimm({ von: k, zeit: 99, adresse: "00".repeat(16) }), false, "nicht älter");
  assert.equal(b.adresseVon(k, new Set([k])), ADRESSE);
  assert.equal(b.adresseVon(k, new Set()), null, "nur, solange er Kontakt ist");
  assert.equal(await b.nimm({ von: k, zeit: 101, adresse: "00".repeat(16) }), true);
  assert.equal(b.adresseVon(k, new Set([k])), "00".repeat(16));
  for (const kaputt of [{ von: "zz", zeit: 200, adresse: ADRESSE }, { von: k, zeit: 200, adresse: ADRESSE.toUpperCase() }, { von: k, zeit: 1.5, adresse: ADRESSE }]) {
    assert.equal(await b.nimm(kaputt), false, JSON.stringify(kaputt));
  }
  const viele = Array.from({ length: FUNK_KONTAKTE_MAX + 5 }, (_, i) => ({ von: generateKeypair().pk, zeit: 1000 + i, adresse: ADRESSE }));
  for (const r of viele) await b.nimm(r);
  const alle = new Set([k, ...viele.map((r) => r.von)]);
  assert.equal(b.zahl(alle), FUNK_KONTAKTE_MAX, "die ältesten gehen zuerst");
  assert.equal(b.adresseVon(k, alle), null);
  assert.equal(b.adresseVon(viele.at(-1)!.von, alle), ADRESSE);
  s.m.set(LS_FUNK_KONTAKTE, JSON.stringify({ [k]: { adresse: "x", zeit: 1 }, zz: { adresse: ADRESSE, zeit: 1 } }));
  assert.equal(b.zahl(new Set([k, "zz"])), 0, "Kaputtes im Speicher zählt nicht");
  s.m.set(LS_FUNK_KONTAKTE, "kein json");
  assert.equal(b.zahl(new Set([k])), 0);
});

test("B-32c1: verdrahtet – Takt, Empfang in der Kette, Schalter im Dialog nur als Person, alles in geheim, Texte", () => {
  const app = readFileSync(new URL("../src/shell/app.ts", import.meta.url), "utf8");
  assert.match(app, /abrufTakt\.melde\("funk-adressen", \(\) => import\("\.\/funk-kontakte\.js"\)\.then\(\(f\) => f\.funkAdressTakt\(\)\), 1\);/);
  const post = readFileSync(new URL("../src/shell/tabs/posteingang.ts", import.meta.url), "utf8");
  assert.match(post, /\(await alsRufZusammenfassung\(w\)\) \?\? \(await alsFunkAdresse\(w\)\) \?\?/);
  const glue = readFileSync(new URL("../src/shell/funk-kontakte.ts", import.meta.url), "utf8");
  assert.match(glue, /signer: \(\) => \(alsGeraet\(\) \? null : state\.signer\)/);
  assert.match(glue, /speicher: geheim,/);
  assert.match(glue, /geheim\.getItem\(LS_FUNK_TEILEN\) === "1"/);
  assert.doesNotMatch(glue, /localStorage/, "Zustimmung, Verteilung und Buch nur in geheim");
  assert.match(readFileSync(new URL("../src/shell/tresor.ts", import.meta.url), "utf8"),
    /const GEHEIM_FEST = \[[^\]]*"freedom\.reticulum\.teilen", "freedom\.reticulum\.verteilt", "freedom\.reticulum\.kontakte"/, "im Tresor, Notfall-Löschung erfasst sie");
  assert.doesNotMatch(glue, /^import .*reticulum-umschlag/m, "die Bibliothek lädt erst beim Senden");
  const ui = readFileSync(new URL("../src/shell/rnode-ui.ts", import.meta.url), "utf8");
  assert.match(ui, /\.\.\.\(alsGeraet\(\) \? \[\] : \[/);
  assert.match(ui, /if \(!alsGeraet\(\)\) await setzeFunkTeilen\(Array\.isArray\(w\.teilen\) && w\.teilen\.includes\("ja"\)\);/);
  for (const sprache of ["de", "en"] as const) {
    setLang(sprache);
    for (const k of ["set.rnodeTeilen", "set.rnodeTeilenJa", "set.rnodeTeilenHinweis", "set.rnodeKontakteStand"]) assert.notEqual(t(k), k, `${k} (${sprache})`);
    assert.match(t("set.rnodeKontakteZahl", { geteilt: 3, erhalten: 2 }), /3.*2/);
  }
  setLang("de");
});
