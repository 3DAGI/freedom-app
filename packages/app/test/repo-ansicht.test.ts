/**
 * Schritt 8.10b: Repositories nach NIP-34 in der App – welche Repos, welche
 * Patches, und wer was tun darf.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  baueRepoAnkuendigung, bauePatch, baueStatus, generateKeypair, leseRepoAnkuendigung, lesePatch, signEvent, type NostrEvent,
} from "@freedomstack/protocol";
import { patchZeilen, repoKarten, repoZeilen, zeitNachDer } from "../src/repo-ansicht.js";

const eigen = generateKeypair(), helfer = generateKeypair(), autor = generateKeypair(), fremd = generateKeypair();
const patchText = (betreff: string) => `From ${"a".repeat(40)} Mon Sep 17 00:00:00 2001
Subject: [PATCH] ${betreff}

---
diff --git a/x b/x
--- a/x
+++ b/x
@@ -1 +1 @@
-a
+b
`;
const ank = (id: string, name: string, zeit: number, kp = eigen): NostrEvent =>
  signEvent({ ...baueRepoAnkuendigung({ id, name, klon: [], maintainer: [helfer.pk] }, kp.pk), created_at: zeit }, kp.sk);

test("Repos: je Eigentuemer und Kennung die neueste Ankuendigung, Unfug faellt heraus", () => {
  const kaputt = signEvent({ pubkey: fremd.pk, created_at: 5, kind: 30617, tags: [["d", "a b"]], content: "" }, fremd.sk);
  const r = repoZeilen([ank("demo", "Alt", 1), ank("demo", "Neu", 2), ank("demo", "Fork", 1, fremd), kaputt]);
  assert.deepEqual(r.map((x) => x.name), ["Fork", "Neu"]);
});

test("Patches: Maintainer annehmen/Entwurf/schliessen, Autor Entwurf/zurueckziehen (seit C.3b2), Fremde nichts; entschieden heisst keine Knoepfe", () => {
  const repo = leseRepoAnkuendigung(ank("demo", "Demo", 1));
  const p1 = signEvent({ ...bauePatch({ repo, text: patchText("Erster") }, autor.pk), created_at: 10 }, autor.sk);
  const p2 = signEvent({ ...bauePatch({ repo, text: patchText("Zweiter") }, autor.pk), created_at: 20 }, autor.sk);
  const anderesRepo = leseRepoAnkuendigung(ank("anderes", "Anderes", 1));
  const p3 = signEvent(bauePatch({ repo: anderesRepo, text: patchText("Woanders") }, autor.pk), autor.sk);
  const angenommen = signEvent(baueStatus({ patch: lesePatch(p1), status: "angenommen", eigentuemer: eigen.pk }, helfer.pk), helfer.sk);

  const fuer = (ich?: string) => patchZeilen(repo, [p1, p2, p3], [angenommen], ich);
  const e = fuer(eigen.pk);
  assert.deepEqual(e.map((z) => z.patch.betreff), ["Zweiter", "Erster"], "neueste zuerst, nur dieses Repo");
  assert.deepEqual(e.map((z) => z.status), ["offen", "angenommen"]);
  assert.deepEqual(e[0].aktionen, ["annehmen", "entwurf", "schliessen"]);
  assert.deepEqual(e[1].aktionen, [], "entschieden");
  assert.deepEqual(fuer(helfer.pk)[0].aktionen, ["annehmen", "entwurf", "schliessen"]);
  assert.deepEqual(fuer(autor.pk)[0].aktionen, ["entwurf", "zurueckziehen"]);
  assert.deepEqual(fuer(fremd.pk)[0].aktionen, []);
  assert.deepEqual(fuer(undefined)[0].aktionen, []);
});

test("Ankündigung derselben Sekunde: kleinere Id gilt (NIP-01), eine neue Fassung bekommt eine spätere Sekunde", () => {
  // Zwei Fassungen in derselben Sekunde – egal in welcher Reihenfolge, es gilt die kleinere Id (wie bei den Relays)
  const a = ank("gleich", "Fassung A", 1_790_000_500), b = ank("gleich", "Fassung B", 1_790_000_500);
  const kleiner = a.id < b.id ? a : b;
  for (const reihe of [[a, b], [b, a]]) assert.equal(repoZeilen(reihe)[0]!.name, leseRepoAnkuendigung(kleiner).name);
  // Die Karte kennt die Zeit der geltenden Ankündigung; die neue Fassung liegt danach, auch in derselben Sekunde
  const karte = repoKarten([a], [], [], [], undefined)[0]!;
  assert.equal(karte.ankuendigungZeit, 1_790_000_500);
  assert.equal(zeitNachDer(karte.ankuendigungZeit, 1_790_000_500), 1_790_000_501, "gleiche Sekunde → eine später");
  assert.equal(zeitNachDer(karte.ankuendigungZeit, 1_790_000_400), 1_790_000_501, "Uhr zurück → trotzdem später");
  assert.equal(zeitNachDer(karte.ankuendigungZeit, 1_790_000_900), 1_790_000_900, "sonst die Uhr");
  assert.equal(zeitNachDer(undefined, 5), 5);
  assert.match(readFileSync(new URL("../src/shell/tabs/repo-seite.ts", import.meta.url), "utf8"),
    /const ev = baueRepoAnkuendigung\(angaben, state\.keypair\.pk\);\n {4}ev\.created_at = zeitNachDer\(k\.ankuendigungZeit, ev\.created_at\);/,
    "Einstellungen speichern nie in derselben Sekunde wie die geltende Ankündigung");
});

