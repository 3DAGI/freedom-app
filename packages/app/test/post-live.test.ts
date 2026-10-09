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
import { LivePost, POST_LIVE_JE_MINUTE, postFilter } from "../src/post-live.js";

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
