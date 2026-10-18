/**
 * B-34c1: Gruppenanruf im privaten Raum – Zugänge vom eigenen Knoten (je Mitglied einer), Einladung nur als inneres
 * Event der Gruppe, laufende Anrufe nur aus den inneren Events des Raums.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ART_GRUPPENANRUF, LIVEKIT_GRENZEN, type InneresEvent, type InneresSenden, type LivekitAnfrage, type LivekitZugaenge } from "@freedomstack/protocol";
import type { GruppenanrufUmgebung } from "../src/shell/gruppenanruf.js";
import type { PrivaterRaum } from "../src/shell/raum-mls.js";

// tresor.ts liest localStorage beim Laden – vor dem Import bereitstellen.
const ls = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => void ls.set(k, v), removeItem: (k: string) => void ls.delete(k),
  key: (i: number) => [...ls.keys()][i] ?? null, get length() { return ls.size; },
};
const { beendeGruppenanruf, laufendeGruppenanrufe, starteGruppenanruf } = await import("../src/shell/gruppenanruf.js");

const JETZT = Math.floor(Date.now() / 1000);
const [A, B, C] = ["a", "b", "c"].map((x) => x.repeat(64));
const GRUPPE = "f".repeat(32);
const raum = (mitglieder: string[], ereignisse: InneresEvent[] = [], ich = A) => ({ gruppe: GRUPPE, mitglieder, ereignisse, ich }) as unknown as PrivaterRaum;
const zugaengeFuer = (a: LivekitAnfrage): LivekitZugaenge => ({
  url: "wss://knoten.example.org", raum: a.raum, bis: JETZT + 3600,
  zugaenge: Array.from({ length: a.anzahl }, (_, i) => ({ kennung: i.toString(16).padStart(16, "0"), token: `eyJ0.eyJ${i}.c2ln${i}` })),
});

function umgebung(antwort: (a: LivekitAnfrage) => LivekitZugaenge | null = zugaengeFuer) {
  const anfragen: LivekitAnfrage[] = [];
  const gesendet: Array<{ gruppe: string; s: InneresSenden }> = [];
  const u: GruppenanrufUmgebung = {
    async zugaenge(a) { anfragen.push(a); return antwort(a); },
    async sende(gruppe, s) { gesendet.push({ gruppe, s }); return true; },
  };
  return { u, anfragen, gesendet };
}
const alsInnen = (s: InneresSenden, von: string): InneresEvent => ({ id: "1".repeat(64), von, art: s.art, tags: s.tags, text: s.text, zeit: JETZT });

test("B-34c1: anrufen – je Mitglied ein Zugang vom eigenen Knoten, Einladung nur in die Gruppe; jeder findet seinen", async () => {
  const { u, anfragen, gesendet } = umgebung();
  assert.equal(await starteGruppenanruf(raum([A, B, C]), u), "gestartet");
  assert.equal(anfragen.length, 1);
  assert.match(anfragen[0]!.raum, /^[0-9a-f]{32}$/, "eine zufällige Kennung – nie die Gruppe");
  assert.notEqual(anfragen[0]!.raum, GRUPPE);
  assert.equal(anfragen[0]!.anzahl, 3, "auch für mich selbst");
  assert.equal(gesendet.length, 1);
  assert.equal(gesendet[0]!.gruppe, GRUPPE);
  assert.equal(gesendet[0]!.s.art, ART_GRUPPENANRUF);

  const e = alsInnen(gesendet[0]!.s, A);
  const kennungen = [A, B, C].map((ich) => laufendeGruppenanrufe(raum([A, B, C], [e], ich))[0]!.zugang!.kennung);
  assert.equal(new Set(kennungen).size, 3, "jeder seinen eigenen");
  assert.equal(laufendeGruppenanrufe(raum([A, B, C], [e], "d".repeat(64)))[0]!.zugang, undefined);

  // beenden: ein Ende in die Gruppe, danach läuft nichts mehr
  assert.equal(await beendeGruppenanruf(raum([A, B, C], [e]), anfragen[0]!.raum, u), true);
  const ende = { ...alsInnen(gesendet[1]!.s, A), id: "2".repeat(64), zeit: JETZT + 1 };
  assert.deepEqual(laufendeGruppenanrufe(raum([A, B, C], [e, ende], B)), []);
});

test("B-34c1: zu viele Mitglieder, kein Zugang vom Knoten – nichts geht in die Gruppe", async () => {
  const viele = Array.from({ length: LIVEKIT_GRENZEN.teilnehmer + 1 }, (_, i) => i.toString(16).padStart(64, "0"));
  const a = umgebung();
  assert.equal(await starteGruppenanruf(raum(viele), a.u), "zu-viele");
  assert.equal(a.anfragen.length + a.gesendet.length, 0);
  const b = umgebung(() => null);
  assert.equal(await starteGruppenanruf(raum([A, B]), b.u), "kein-zugang");
  assert.equal(b.gesendet.length, 0);
});

test("B-34c1: verdrahtet wie TURN – nur gekoppelt, über wegZumKnoten mit frischem Sitzungsschlüssel, nie offen, nichts ins Log", () => {
  const q = readFileSync(new URL("../src/shell/gruppenanruf.ts", import.meta.url), "utf8");
  assert.match(q, /const k = meineKopplung\(\);\n\s+if \(!k\) return null;/);
  assert.match(q, /new LocalSigner\(generateKeypair\(\)\.sk\)/);
  assert.match(q, /await wegZumKnoten\(k\.knoten, sitzung\)/);
  assert.match(q, /leseLivekitZugaenge\(a\.ergebnis, anfrage\)/, "die Antwort nur streng gelesen");
  assert.match(q, /sende: mlsSendeEvent/, "Einladungen nur als inneres Event");
  assert.deepEqual(q.match(/\.publish\(/g), [".publish("], "hinaus nur die versiegelte Anfrage über den Weg zum Knoten");
  assert.match(q, /await weg\.publish\(wrap\);/);
  assert.doesNotMatch(q, /ensurePool|pool\.|console\.|localStorage|geheim\./, "nichts offen, nichts ins Log, nichts gemerkt");
});
