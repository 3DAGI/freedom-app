/**
 * Schritt 8.10a: Git ueber Nostr nach NIP-34 – Repo ankuendigen, Patch
 * einreichen, Status. Abnahme: ein Patch wird ueber NIP-34 eingereicht, vom
 * Maintainer angenommen und laesst sich mit echtem git einspielen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeypair, signEvent, verifyEvent, type NostrEvent } from "../src/event.js";
import { MemoryRelay } from "../src/outbox.js";
import {
  KIND_PATCH, KIND_REPO_ANKUENDIGUNG, PATCH_MAX_BYTES, baueRepoAnkuendigung, bauePatch, baueStatus, darfAnnehmen,
  lesePatch, lesePatchText, leseRepoAnkuendigung, patchStatus, repoAdresse,
} from "../src/nip34.js";

const eigen = generateKeypair();
const helfer = generateKeypair();
const fremd = generateKeypair();
const beitrag = generateKeypair();
const SHA = "a".repeat(40);

const PATCH = `From ${SHA} Mon Sep 17 00:00:00 2001
From: Beitrag <b@example.org>
Date: Sat, 26 Sep 2026 10:00:00 +0200
Subject: [PATCH] Tippfehler in README behoben

---
 README.md | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)

diff --git a/README.md b/README.md
index 1111111..2222222 100644
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-Hallo Welt
+Hallo, Welt
--
2.43.0
`;

const repoEv = () => signEvent(baueRepoAnkuendigung({
  id: "freedom-app", name: "FreedomStack", beschreibung: "App und Protokoll",
  klon: ["https://github.com/3DAGI/freedom-app.git", "rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5"],
  ersterCommit: "b".repeat(40), maintainer: [helfer.pk],
}, eigen.pk), eigen.sk);

test("Repo-Ankuendigung: Rundreise, Radicle-Spiegel als Klon-Adresse, Maintainer", () => {
  const r = leseRepoAnkuendigung(repoEv());
  assert.equal(r.adresse, `${KIND_REPO_ANKUENDIGUNG}:${eigen.pk}:freedom-app`);
  assert.deepEqual(r.klon, ["https://github.com/3DAGI/freedom-app.git", "rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5"]);
  assert.deepEqual(r.maintainer, [helfer.pk]);
  assert.equal(r.ersterCommit, "b".repeat(40));
  assert.ok(darfAnnehmen(r, eigen.pk) && darfAnnehmen(r, helfer.pk) && !darfAnnehmen(r, fremd.pk));
});

test("Repo-Ankuendigung: Unfug wird abgelehnt bzw. beim Lesen verworfen", () => {
  assert.throws(() => baueRepoAnkuendigung({ id: "a b", name: "x", klon: [] }, eigen.pk), /Kennung/);
  assert.throws(() => baueRepoAnkuendigung({ id: "x", name: "x", klon: ["javascript:alert(1)"] }, eigen.pk), /Klon-Adresse/);
  assert.throws(() => baueRepoAnkuendigung({ id: "x", name: "x", klon: [], maintainer: ["abc"] }, eigen.pk), /Maintainer/);
  const roh = signEvent({ pubkey: eigen.pk, created_at: 1, kind: KIND_REPO_ANKUENDIGUNG, content: "",
    tags: [["d", "x"], ["clone", "https://ok.example/x.git", "javascript:alert(1)"], ["maintainers", "kaputt", eigen.pk]] }, eigen.sk);
  const r = leseRepoAnkuendigung(roh);
  assert.deepEqual(r.klon, ["https://ok.example/x.git"]);
  assert.deepEqual(r.maintainer, [], "ungültige und der Eigentümer selbst fallen heraus");
});

test("Patch: nur Text aus git format-patch, mit Betreff und Aenderung, begrenzt", () => {
  assert.deepEqual(lesePatchText(PATCH), { commit: SHA, betreff: "Tippfehler in README behoben" });
  assert.throws(() => lesePatchText("Hallo"), /format-patch/);
  assert.throws(() => lesePatchText(PATCH.replace(/^Subject:.*$/m, "")), /Betreff/);
  assert.throws(() => lesePatchText(PATCH.replace(/^diff --git.*$/m, "")), /kein „diff --git“/);
  assert.throws(() => lesePatchText(PATCH + "x".repeat(PATCH_MAX_BYTES)), /zu groß/);
  const ev = signEvent(bauePatch({ repo: leseRepoAnkuendigung(repoEv()), text: PATCH }, beitrag.pk), beitrag.sk);
  assert.equal(ev.kind, KIND_PATCH);
  const p = lesePatch(ev);
  assert.equal(p.repoAdresse, repoAdresse(eigen.pk, "freedom-app"));
  assert.equal(p.betreff, "Tippfehler in README behoben");
  assert.ok(ev.tags.some((t) => t[0] === "p" && t[1] === eigen.pk), "Eigentümer wird benachrichtigt");
  assert.ok(ev.tags.some((t) => t[0] === "r" && t[1] === "b".repeat(40)));
});

test("Betreff: RFC 2047 (Umlaute) und umgebrochene Zeilen wie aus git", () => {
  const mit = (kopf: string) => lesePatchText(PATCH.replace(/^Subject:.*$/m, kopf)).betreff;
  assert.equal(mit("Subject: [PATCH] =?UTF-8?q?Komma=20erg=C3=A4nzt?="), "Komma ergänzt");
  assert.equal(mit("Subject: [PATCH 2/3] =?UTF-8?b?R3LDvMOfZQ==?="), "Grüße");
  assert.equal(mit("Subject: [PATCH] Ein sehr langer Betreff, den git\n auf zwei Zeilen umbricht"), "Ein sehr langer Betreff, den git auf zwei Zeilen umbricht");
  assert.equal(mit("Subject: [PATCH] =?UTF-8?q?Gr=C3=BC?=\n =?UTF-8?q?=C3=9Fe?="), "Grüße");
});

test("Status: angenommen nur vom Eigentuemer oder Maintainer; der neueste gueltige zaehlt", () => {
  const repo = leseRepoAnkuendigung(repoEv());
  const patch = lesePatch(signEvent(bauePatch({ repo, text: PATCH }, beitrag.pk), beitrag.sk));
  const status = (s: "offen" | "angenommen" | "geschlossen" | "entwurf", kp: typeof eigen, zeit: number): NostrEvent =>
    signEvent({ ...baueStatus({ patch, status: s, eigentuemer: repo.eigentuemer }, kp.pk), created_at: zeit }, kp.sk);

  assert.equal(patchStatus(patch, repo, []).status, "offen");
  assert.equal(patchStatus(patch, repo, [status("angenommen", fremd, 10)]).status, "offen", "Fremde zählen nicht");
  assert.equal(patchStatus(patch, repo, [status("angenommen", beitrag, 10)]).status, "offen", "der Autor nimmt nicht selbst an");
  assert.equal(patchStatus(patch, repo, [status("entwurf", beitrag, 10)]).status, "entwurf", "der Autor darf Entwurf/Schließen");
  assert.equal(patchStatus(patch, repo, [status("angenommen", helfer, 10)]).status, "angenommen");
  assert.equal(patchStatus(patch, repo, [status("angenommen", eigen, 10), status("geschlossen", beitrag, 20)]).status, "geschlossen");
  const anderer = { ...patch, id: "f".repeat(64) };
  assert.equal(patchStatus(anderer, repo, [status("angenommen", eigen, 10)]).status, "offen", "Status gilt nur für seinen Patch");
  assert.throws(() => baueStatus({ patch, status: "angenommen", eigentuemer: repo.eigentuemer, commits: ["xyz"] }, eigen.pk), /SHA-1/);
});

/** git mit fester Identitaet, ohne globale Einstellungen. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=t@example.org", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8" });
}

test("ABNAHME: Patch ueber NIP-34 eingereicht, vom Maintainer angenommen, mit git eingespielt", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nip34-"));
  try {
    // Eigentuemer: Repo mit erstem Commit; Beitrag: Klon mit einer Aenderung.
    const haupt = join(dir, "haupt"), klon = join(dir, "klon");
    execFileSync("mkdir", [haupt]);
    git(haupt, "init", "-q");
    writeFileSync(join(haupt, "README.md"), "Hallo Welt\n");
    git(haupt, "add", "README.md");
    git(haupt, "commit", "-q", "-m", "Anfang");
    const euc = git(haupt, "rev-list", "--max-parents=0", "HEAD").trim();
    git(dir, "clone", "-q", haupt, klon);
    writeFileSync(join(klon, "README.md"), "Hallo, Welt\n");
    git(klon, "commit", "-q", "-am", "Komma ergänzt");
    const text = git(klon, "format-patch", "-1", "--stdout");

    // Ueber ein Relay: ankuendigen, einreichen, annehmen.
    const relay = new MemoryRelay("mem://nip34");
    const ank = signEvent(baueRepoAnkuendigung({ id: "demo", name: "Demo", klon: ["https://x.invalid/demo.git"], ersterCommit: euc }, eigen.pk), eigen.sk);
    await relay.publish(ank);
    const repo = leseRepoAnkuendigung((await relay.query({ kinds: [KIND_REPO_ANKUENDIGUNG], "#d": ["demo"] }))[0]);
    const patchEv = signEvent(bauePatch({ repo, text }, beitrag.pk), beitrag.sk);
    await relay.publish(patchEv);

    const eingang = await relay.query({ kinds: [KIND_PATCH], "#a": [repo.adresse] });
    assert.equal(eingang.length, 1);
    assert.ok(verifyEvent(eingang[0]));
    const patch = lesePatch(eingang[0]);
    assert.equal(patch.betreff, "Komma ergänzt");

    // Maintainer spielt den Patch aus dem Event ein – der Inhalt kommt nur ueber Nostr.
    const datei = join(dir, "eingang.patch");
    writeFileSync(datei, patch.text);
    git(haupt, "am", "-q", datei);
    const commit = git(haupt, "rev-parse", "HEAD").trim();
    assert.equal(git(haupt, "show", "HEAD:README.md"), "Hallo, Welt\n");
    await relay.publish(signEvent(baueStatus({ patch, status: "angenommen", eigentuemer: repo.eigentuemer, commits: [commit] }, eigen.pk), eigen.sk));

    const st = patchStatus(patch, repo, await relay.query({ kinds: [1630, 1631, 1632, 1633], "#e": [patch.id] }));
    assert.equal(st.status, "angenommen");
    assert.equal(st.von, eigen.pk);
    assert.deepEqual(st.commits, [commit]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
