/**
 * Schritt 8.10b: Repositories nach NIP-34 in der App – welche Repos, welche
 * Patches, und wer was tun darf.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  baueRepoAnkuendigung, bauePatch, baueStatus, generateKeypair, leseRepoAnkuendigung, lesePatch, signEvent, type NostrEvent,
} from "@freedomstack/protocol";
import { patchZeilen, repoZeilen } from "../src/repo-ansicht.js";

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

test("Patches: Maintainer annehmen/schliessen, Autor zurueckziehen, Fremde nichts; entschieden heisst keine Knoepfe", () => {
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
  assert.deepEqual(e[0].aktionen, ["annehmen", "schliessen"]);
  assert.deepEqual(e[1].aktionen, [], "entschieden");
  assert.deepEqual(fuer(helfer.pk)[0].aktionen, ["annehmen", "schliessen"]);
  assert.deepEqual(fuer(autor.pk)[0].aktionen, ["zurueckziehen"]);
  assert.deepEqual(fuer(fremd.pk)[0].aktionen, []);
  assert.deepEqual(fuer(undefined)[0].aktionen, []);
});
