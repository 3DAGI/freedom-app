/**
 * Schritt C-20i1: Labels ändern und Zuständige an Issues und Patches – NIP-32
 * (Kind 1985), je Ziel und Namensraum der ganze Stand; es zählt die neueste
 * Aussage von Eigentümer oder Maintainern. In privaten Räumen nur als inneres
 * Event.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, signEvent, type NostrEvent } from "../src/event.js";
import { ProtokollFehler } from "../src/fehler.js";
import { KIND_ISSUE, KIND_PATCH, baueRepoAnkuendigung, leseRepoAnkuendigung } from "../src/nip34.js";
import { KIND_LABEL, LABEL_GRENZEN, LABEL_RAEUME, baueLabelStand, labelStandZu, leseLabelStand } from "../src/repo-labels.js";
import { RAUM_REPO_ARTEN, raumRepoLabels, raumReposPrivat } from "../src/raum-repo.js";
import { gruppenRaum } from "../src/raum-gruppe.js";
import { regelRaumRepoPrivat } from "../src/leak-rules.js";

const eigentuemer = generateKeypair();
const maintainer = generateKeypair();
const fremd = generateKeypair();
const s = (ev: Parameters<typeof signEvent>[0], k: { sk: Uint8Array }, zeit: number) => signEvent({ ...ev, created_at: zeit }, k.sk);
const repo = leseRepoAnkuendigung(s(baueRepoAnkuendigung({ id: "app", name: "App", klon: [], maintainer: [maintainer.pk] }, eigentuemer.pk), eigentuemer, 100));
const issue = { id: "a".repeat(64), kind: KIND_ISSUE };
const kennung = (f: () => unknown) => {
  try { f(); } catch (e) { return e instanceof ProtokollFehler ? e.kennung : "anderer Fehler"; }
  return "kein Fehler";
};

test("C-20i1: Labels und Zuständige bauen und lesen – NIP-32 mit Namensraum, genau ein Ziel", () => {
  const l = s(baueLabelStand({ ziel: issue, art: "labels", werte: ["bug", "ui", "bug"] }, maintainer.pk), maintainer, 200);
  assert.equal(l.kind, KIND_LABEL);
  assert.deepEqual(l.tags, [["L", "#t"], ["l", "bug", "#t"], ["l", "ui", "#t"], ["e", issue.id], ["k", "1621"]]);
  assert.deepEqual(leseLabelStand(l).werte, ["bug", "ui"]);
  const z = s(baueLabelStand({ ziel: { id: issue.id, kind: KIND_PATCH }, art: "zustaendig", werte: [fremd.pk] }, eigentuemer.pk), eigentuemer, 210);
  assert.deepEqual(z.tags.filter((t) => t[0] === "p"), [], "Zuständige nie als p-Tag – das wären weitere Ziele");
  const g = leseLabelStand(z);
  assert.deepEqual([g.art, g.werte, g.zielKind], ["zustaendig", [fremd.pk], KIND_PATCH]);
  assert.equal(LABEL_RAEUME.zustaendig, "freedomstack.zustaendig");
  const leer = leseLabelStand(s(baueLabelStand({ ziel: issue, art: "labels", werte: [] }, maintainer.pk), maintainer, 220));
  assert.deepEqual(leer.werte, [], "ein leerer Stand entfernt alle Labels");
});

test("C-20i1: Negativfälle beim Bauen und strenges Lesen fremder Events", () => {
  assert.equal(kennung(() => baueLabelStand({ ziel: { id: issue.id, kind: 1 }, art: "labels", werte: [] }, maintainer.pk)), "label-ziel");
  assert.equal(kennung(() => baueLabelStand({ ziel: { id: "x", kind: KIND_ISSUE }, art: "labels", werte: [] }, maintainer.pk)), "label-ziel");
  assert.equal(kennung(() => baueLabelStand({ ziel: issue, art: "farbe" as never, werte: [] }, maintainer.pk)), "label-art");
  assert.equal(kennung(() => baueLabelStand({ ziel: issue, art: "labels", werte: ["mit leer"] }, maintainer.pk)), "issue-label");
  assert.equal(kennung(() => baueLabelStand({ ziel: issue, art: "zustaendig", werte: ["abc"] }, maintainer.pk)), "label-zustaendig");
  assert.equal(kennung(() => baueLabelStand({ ziel: issue, art: "zustaendig", werte: Array.from({ length: LABEL_GRENZEN.zustaendig + 1 }, (_, i) => i.toString(16).padStart(64, "0")) }, maintainer.pk)), "label-viele");
  const gut = s(baueLabelStand({ ziel: issue, art: "labels", werte: ["bug"] }, maintainer.pk), maintainer, 200);
  const mit = (tags: string[][]) => ({ ...gut, tags }) as NostrEvent;
  assert.throws(() => leseLabelStand({ ...gut, kind: 1 }), /Kein Label-Event/);
  assert.throws(() => leseLabelStand(mit([...gut.tags, ["L", "freedomstack.zustaendig"]])), /Namensraum/, "genau ein Namensraum");
  assert.throws(() => leseLabelStand(mit(gut.tags.map((t) => (t[0] === "L" ? ["L", "ISO-639-1"] : t)))), /Namensraum/);
  assert.throws(() => leseLabelStand(mit([...gut.tags, ["e", "b".repeat(64)]])), /genau ein Ziel/);
  assert.throws(() => leseLabelStand(mit(gut.tags.map((t) => (t[0] === "k" ? ["k", "1"] : t)))), /genau ein Ziel/);
  assert.throws(() => leseLabelStand(mit([...gut.tags, ["l", "a b", "#t"]])), /ungültigem Wert/);
  assert.deepEqual(leseLabelStand(mit([...gut.tags, ["l", "fremd", "anderer.raum"]])).werte, ["bug"], "Labels anderer Namensräume zählen nicht");
});

test("C-20i1: Stand – neueste Aussage von Eigentümer oder Maintainern, Fremde zählen nicht, je Namensraum getrennt", () => {
  const stand = (k: typeof eigentuemer, art: "labels" | "zustaendig", werte: string[], zeit: number) => s(baueLabelStand({ ziel: issue, art, werte }, k.pk), k, zeit);
  const events = [
    stand(eigentuemer, "labels", ["bug"], 200),
    stand(maintainer, "labels", ["bug", "ui"], 210),
    stand(fremd, "labels", ["spam"], 300),
    stand(eigentuemer, "zustaendig", [maintainer.pk], 205),
    s(baueLabelStand({ ziel: { id: "b".repeat(64), kind: KIND_ISSUE }, art: "labels", werte: ["anderes"] }, eigentuemer.pk), eigentuemer, 400),
  ];
  assert.deepEqual(labelStandZu(issue.id, "labels", repo, events)?.werte, ["bug", "ui"]);
  assert.deepEqual(labelStandZu(issue.id, "zustaendig", repo, events)?.werte, [maintainer.pk], "Labels ändern die Zuständigen nicht");
  assert.equal(labelStandZu("c".repeat(64), "labels", repo, events), undefined, "ohne Aussage gelten die t-Tags des Issues");
  assert.deepEqual(labelStandZu(issue.id, "labels", repo, [...events, stand(maintainer, "labels", [], 220)])?.werte, []);
});

test("C-20i1: im privaten Raum nur als inneres Event – die Liste kommt aus raumReposPrivat(), offen ist es ein Leck", () => {
  const admin = eigentuemer.pk;
  let n = 0;
  const innen = (von: string, x: { art: number; tags: string[][]; text: string }) =>
    ({ id: (++n).toString(16).padStart(64, "0"), von, art: x.art, tags: x.tags, text: x.text, zeit: 1_790_000_000 + n });
  const ank = innen(admin, { art: 30617, tags: [["space", "g"], ["d", "app"], ["name", "App"]], text: "" });
  const iss = innen(fremd.pk, { art: KIND_ISSUE, tags: [["space", "g"], ["a", `30617:${admin}:app`], ["subject", "S"]], text: "" });
  const lab = innen(admin, raumRepoLabels("g", { ziel: { id: iss.id, kind: KIND_ISSUE }, art: "labels", werte: ["dringend"] }));
  assert.ok(RAUM_REPO_ARTEN.includes(lab.art) && lab.tags[0]![0] === "space" && lab.tags[0]![1] === "g");
  const zustand = gruppenRaum("g", [ank, iss, lab], { admins: [admin], mitglieder: [admin, fremd.pk] }).zustand;
  const r = raumReposPrivat("g", [ank, iss, lab], zustand);
  assert.deepEqual(labelStandZu(iss.id, "labels", leseRepoAnkuendigung(r.ankuendigungen[0]!), r.labels)?.werte, ["dringend"]);
  const offen = s(baueLabelStand({ ziel: { id: iss.id, kind: KIND_ISSUE }, art: "labels", werte: ["x"] }, fremd.pk), fremd, 200);
  assert.deepEqual(regelRaumRepoPrivat([offen], { repoIds: [], schluessel: [], innere: [iss.id] }).map((f) => f.detail), ["Repo eines privaten Raums offen (Kind 1985)"]);
});
