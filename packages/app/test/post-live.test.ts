/**
 * A-15a (Nutzertest 08.10.2026, Befund C-12): Post kommt sofort – über ein Abo an den eigenen Schlüssel.
 *
 * Beweist:
 *  - der Filter hat kein `since` (Chat-Umschläge sind bis zu zwei Tage zurückdatiert) und holt nichts Altes nach
 *  - ein zurückdatierter Chat-Umschlag wird gleich geöffnet, ein schon geöffneter nicht noch einmal
 *  - Anrufe nicht (die haben ihr eigenes Abo), andere Kinds nicht
 *  - höchstens 30 je Minute – eine Flut entschlüsselt die App nicht je Umschlag
 *  - verdrahtet: nach jedem Abgleich, über dieselbe Kette wie der Abgleich, das Abo für Anrufe unverändert
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LocalSigner, MAX_TIME_JITTER_SECS, baueAnrufNachricht, buildPrivateDm, generateKeypair, neueAnrufKennung } from "@freedomstack/protocol";
import { LivePost, Nachziehen, POST_LIVE_JE_MINUTE, postFilter } from "../src/post-live.js";

const lies = (d: string): string => readFileSync(new URL(`../src/${d}`, import.meta.url), "utf8");
const ICH = "a".repeat(64);

test("A-15a: Filter ohne since, nur Neues", () => {
  const f = postFilter(ICH);
  assert.deepEqual(f, { kinds: [1059], "#p": [ICH], limit: 1 });
  assert.ok(!("since" in f), "zurückdatierte Umschläge sähe ein Abo „ab jetzt“ nie");
});

test("A-15a: zurückdatierter Chat-Umschlag gleich öffnen – einmal, keine Anrufe, keine anderen Kinds", async () => {
  const jetzt = 1_800_000_000;
  const uhr = () => jetzt * 1000;
  const von = generateKeypair(), an = generateKeypair();
  const dm = await buildPrivateDm({ signer: new LocalSigner(von.sk), recipientPk: an.pk, content: "hallo", nowSecs: jetzt, wrapOptions: { nowSecs: jetzt, fixedJitter: MAX_TIME_JITTER_SECS - 1 } });
  assert.ok(dm.toRecipient.created_at < jetzt - 3600, "zurückdatiert");
  const lp = new LivePost(uhr);
  assert.equal(lp.nimm(dm.toRecipient, () => false), true);
  assert.equal(new LivePost(uhr).nimm(dm.toRecipient, (id) => id === dm.toRecipient.id), false, "schon geöffnet");
  const [anruf] = await baueAnrufNachricht({ von: new LocalSigner(von.sk), an: [an.pk], nowSecs: jetzt, nachricht: { anruf: neueAnrufKennung(), typ: "ende", grund: "aufgelegt" } });
  assert.equal(new LivePost(uhr).nimm(anruf!, () => false), false, "Anrufe kommen über ihr eigenes Abo");
  assert.equal(new LivePost(uhr).nimm({ ...dm.toRecipient, kind: 4 }, () => false), false);
});

test("A-15a: höchstens 30 je Minute, in der nächsten Minute wieder", () => {
  let ms = 1_800_000_000_000;
  const lp = new LivePost(() => ms);
  const w = (i: number) => ({ id: String(i).padStart(64, "0"), kind: 1059, created_at: 1_799_900_000, tags: [["p", ICH]] });
  const ja = Array.from({ length: POST_LIVE_JE_MINUTE + 5 }, (_, i) => lp.nimm(w(i), () => false)).filter(Boolean).length;
  assert.equal(ja, POST_LIVE_JE_MINUTE, "der Rest kommt mit dem Abgleich");
  ms += 60_000;
  assert.equal(lp.nimm(w(999), () => false), true);
});

test("A-15a: verdrahtet – nach jedem Abgleich, dieselbe Kette, das Abo für Anrufe bleibt", () => {
  const p = lies("shell/tabs/posteingang.ts");
  const sync = p.slice(p.indexOf("export async function syncDmInbox("), p.indexOf("async function ordneEin("));
  assert.match(sync, /void lauscheAufPost\(\);\n\}$/m, "am Ende des Abgleichs");
  assert.match(sync, /for \(const w of umschlaege\) if \(\(await ordneEin\(w, me\.pk\)\)\.neu\) neu\+\+;/);
  const ordne = p.slice(p.indexOf("async function ordneEin("), p.indexOf("let postAbo"));
  assert.match(ordne, /await oeffneUmschlag\(w\)/, "Abgleich und Abo öffnen über dieselbe Kette");
  assert.match(ordne, /if \(!e\) await alsMlsEinladung\(w\);/);
  const abo = p.slice(p.indexOf("export async function lauscheAufPost("));
  assert.match(abo, /pool\.subscribe\(postFilter\(ich\), \(w\) => \{\n\s+if \(livePost\.nimm\(w, \(id\) => dmCache\.has\(id\)\)\) void nimmLivePost\(w, ich\);/);
  assert.match(abo, /if \(r\.frischVon && r\.frischVon === activeConversation\) void loadChatMessages\(r\.frischVon\);/);
  assert.doesNotMatch(p, /setInterval/, "kein eigener Zeitgeber (6.4)");
  // Das Abo für Anrufe (B-13e) bleibt „ab jetzt“ – Anrufe sind nie zurückdatiert
  assert.match(lies("shell/anruf.ts"), /pool\.subscribe\(\{ kinds: \[1059\], "#p": \[ich\], since: jetzt\(\) - 60 \}/);
});

test("A-15b: Nachziehen – nie zwei Läufe zugleich, was dazwischen kommt, gibt genau einen weiteren mit Abstand", async () => {
  const geplant: { fn: () => void; ms: number }[] = [];
  let laeufe = 0;
  let fertig!: () => void;
  const n = new Nachziehen(() => { laeufe++; return new Promise<void>((r) => { fertig = r; }); }, 2_000, (fn, ms) => { geplant.push({ fn, ms }); });
  n.anstossen();
  n.anstossen();
  n.anstossen();
  assert.equal(laeufe, 1, "der zweite wartet");
  fertig();
  await new Promise((r) => setImmediate(r));
  assert.equal(geplant.length, 1, "genau einer nachgezogen");
  assert.equal(geplant[0]!.ms, 2_000);
  n.anstossen();
  assert.equal(laeufe, 1, "auch in der Pause keiner zusätzlich");
  geplant[0]!.fn();
  assert.equal(laeufe, 2);
  fertig();
  await new Promise((r) => setImmediate(r));
  assert.equal(geplant.length, 1, "danach nichts mehr offen");
  // Ein Fehler hält nichts auf
  const m = new Nachziehen(() => Promise.reject(new Error("MLS beschäftigt")), 0, (fn) => fn());
  m.anstossen();
  await new Promise((r) => setImmediate(r));
  m.anstossen();
});

test("A-15b: verdrahtet – die offene Unterhaltung abonniert ihre Gruppe, nur an deren Relays, nur zum Anstoßen", () => {
  const g = lies("shell/gruppe-live.ts");
  assert.match(g, /const a = await mlsGruppenAbo\(gruppe\)/);
  assert.match(g, /abonniereAn\(a\.filter, a\.relays, \(\) => nach\.anstossen\(\)\)/, "das Event stößt nur an");
  assert.match(g, /const zahlen = await mlsAbgleichen\(\[gruppe\]\)/);
  assert.match(lies("shell/mls-konto.ts"), /return a \? \{ filter: \{ \.\.\.a\.filter, limit: 1 \}, relays: a\.relays \} : null;/);
  const s = lies("shell/state.ts");
  const an = s.slice(s.indexOf("export async function abonniereAn("), s.indexOf("/** Outbox beim Lesen"));
  assert.match(an, /pool\.subscribeAn\(filter, imPool, onEvent\)/, "Relays des Pools über ihre Verbindung (seit A-16 über teileZiele())");
  assert.match(an, /if \(verifyEvent\(ev\)\) onEvent\(ev\);/);
  assert.doesNotMatch(an, /pool\.subscribe\(/, "nie an alle Relays des Pools – der Filter nennt die Gruppe");
  const k = lies("shell/tabs/kommunikation.ts");
  assert.match(k, /if \(cid === activeConversation\) void lauscheAufGruppe\(c\.type === "dm" \? c\.mls \?\? null : null, zeigeNeuesMls\);/);
  assert.match(k, /mlsBeiNeuem\(zeigeNeuesMls\);/);
});
