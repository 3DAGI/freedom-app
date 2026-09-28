/**
 * Schritt C.3a2: Einstellungen des Eigentümers (Felder → neue Ankündigung,
 * geprüft von `baueRepoAnkuendigung()`), Web-Adressen nur mit https,
 * Mitwirkende als Reiter (dieselbe Liste wie auf der Seite „Repos“) und
 * „Neue Version hochladen“ auf der Repo-Seite statt in app.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ProtokollFehler, baueRepoAnkuendigung, buildContribution, generateKeypair, leseRepoAnkuendigung, signEvent,
} from "@freedomstack/protocol";
import { EINSTELLUNG_MAX, type EinstellungFelder, ankuendigungAusFeldern, sichereWebAdressen } from "../src/repo-ansicht.js";
import { mitwirkendeListe } from "../src/shell/mitwirkende.js";

const quelle = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const eigen = generateKeypair(), ada = generateKeypair(), bo = generateKeypair();
const leer: EinstellungFelder = { name: "", beschreibung: "", klon: "", web: "", maintainer: "", ersterCommit: "" };

test("C.3a2: Felder → Ankündigung – Kennung bleibt, Zeilen getrennt, doppelte und leere fallen weg, Schlüssel klein", () => {
  const r = ankuendigungAusFeldern("werkzeug", {
    name: "  Werkzeug  ", beschreibung: " Hämmer und Zangen \n",
    klon: "https://example.org/w.git\n\nrad:z3gqcJUoA1n9HaHKufZs5FCSGazv5,https://example.org/w.git",
    web: "https://example.org/werkzeug", maintainer: `${ada.pk.toUpperCase()}\n${bo.pk} ${ada.pk}`,
    ersterCommit: ` ${"AB".repeat(20)} `,
  });
  assert.deepEqual(r, {
    id: "werkzeug", name: "Werkzeug", beschreibung: "Hämmer und Zangen",
    klon: ["https://example.org/w.git", "rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5"], web: ["https://example.org/werkzeug"],
    maintainer: [ada.pk, bo.pk], ersterCommit: "ab".repeat(20),
  });
  // Hin und zurück über das Protokoll: dasselbe Repo, dieselben Felder
  const gelesen = leseRepoAnkuendigung(signEvent(baueRepoAnkuendigung(r, eigen.pk), eigen.sk));
  assert.equal(gelesen.adresse, `30617:${eigen.pk}:werkzeug`);
  assert.deepEqual([gelesen.name, gelesen.klon, gelesen.web, gelesen.maintainer, gelesen.ersterCommit], [r.name, r.klon, r.web, r.maintainer, r.ersterCommit]);
  // Ohne Namen gilt die Kennung; leere Felder kommen gar nicht vor
  assert.deepEqual(ankuendigungAusFeldern("x", leer), { id: "x", name: "x", klon: [] });
});

test("C.3a2: feindliche Eingaben – das Protokoll weist sie ab, nie still übernommen; höchstens 20 je Feld", () => {
  const baue = (f: Partial<EinstellungFelder>) => baueRepoAnkuendigung(ankuendigungAusFeldern("x", { ...leer, ...f }), eigen.pk);
  const kennung = (fn: () => unknown) => { try { fn(); return "keiner"; } catch (e) { return e instanceof ProtokollFehler ? e.kennung : "anderer"; } };
  assert.equal(kennung(() => baue({ klon: "javascript:alert(1)" })), "repo-klon");
  assert.equal(kennung(() => baue({ maintainer: "npub1abc" })), "repo-maintainer");
  assert.equal(kennung(() => baue({ maintainer: `${ada.pk}zz` })), "repo-maintainer");
  assert.equal(kennung(() => baue({ ersterCommit: "1234" })), "repo-erster-commit");
  assert.equal(kennung(() => baueRepoAnkuendigung(ankuendigungAusFeldern("böse id", leer), eigen.pk)), "repo-kennung");
  const viele = Array.from({ length: 100 }, (_, i) => `https://example.org/${i}.git`).join("\n");
  assert.equal(ankuendigungAusFeldern("x", { ...leer, klon: viele }).klon.length, EINSTELLUNG_MAX);
});

test("C.3a2: Web-Adressen fremder Repos anklickbar nur mit https und ohne Zugangsdaten", () => {
  assert.deepEqual(sichereWebAdressen([
    "https://example.org/a", "http://example.org/b", "javascript:alert(1)", "data:text/html,x",
    "https://nutzer:pw@example.org/c", "kein url", "HTTPS://Example.org/d",
  ]), ["https://example.org/a", "HTTPS://Example.org/d"]);
  assert.deepEqual(sichereWebAdressen(undefined), []);
  assert.equal(sichereWebAdressen(Array.from({ length: 9 }, (_, i) => `https://example.org/${i}`)).length, 5);
});

/** Kleinstes DOM für `mitwirkendeListe()` – merkt sich, ob jemand innerHTML setzt. */
function mitAttrappe<T>(fn: () => T): T {
  type Knoten = { tag: string; textContent: string; className: string; title: string; kinder: Knoten[]; append: (...k: Knoten[]) => void };
  const alt = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = {
    createElement: (tag: string): Knoten => {
      const k: Knoten = { tag, textContent: "", className: "", title: "", kinder: [], append: (...x) => { k.kinder.push(...x); } };
      return Object.seal(k);
    },
  };
  try {
    return fn();
  } finally {
    (globalThis as { document?: unknown }).document = alt;
  }
}

test("C.3a2: Mitwirkende je Kennung – nur Beiträge dieses Repos, Namen nur als Text (DOM-Attrappe ohne innerHTML)", () => {
  const tag = 86_400, t0 = 1_800_000_000;
  const beitrag = (kp: typeof ada, repo: string, n: number) => signEvent(buildContribution({ repoId: repo, authorPubkey: kp.pk, kind: "patch", summary: "x", ref: `r${repo}${n}` }, t0 + n * tag), kp.sk);
  const evs = [beitrag(ada, "werkzeug", 0), beitrag(ada, "werkzeug", 1), beitrag(bo, "werkzeug", 2), beitrag(bo, "anderes", 3)];
  const teile = mitAttrappe(() => mitwirkendeListe("werkzeug", evs, (pk) => (pk === ada.pk ? "<img src=x onerror=alert(1)>" : "Bo")));
  const zeilen = teile.filter((e) => e.className === "usage-row") as unknown as Array<{ kinder: Array<{ textContent: string; title: string }> }>;
  assert.equal(zeilen.length, 2, "anderes Repo zählt nicht");
  const namen = zeilen.map((z) => z.kinder[0]!.textContent).sort();
  assert.deepEqual(namen, ["<img src=x onerror=alert(1)>", "Bo"], "Namen stehen als Text da");
  assert.ok(zeilen.every((z) => /^[0-9a-f]{64}$/.test(z.kinder[0]!.title)), "voller Schlüssel nur im Tooltip");
  // Ohne Beiträge ein Satz, keine Zeilen
  const leer = mitAttrappe(() => mitwirkendeListe("nichts", evs, () => "?"));
  assert.equal(leer.length, 1);
  assert.equal(leer[0]!.className, "muted mitwirkende-leer");
});

test("C.3a2: verdrahtet – Reiter Mitwirkende, Einstellungen nur für den Eigentümer, Hochladen zog aus app.ts um", () => {
  const seite = quelle("../src/shell/tabs/repo-seite.ts");
  const repos = quelle("../src/shell/tabs/repos.ts");
  const app = quelle("../src/shell/app.ts");
  const earn = quelle("../src/shell/tabs/earn.ts");
  const mit = quelle("../src/shell/mitwirkende.ts");
  // Einstellungen nur mit dem eigenen Schlüssel als Eigentümer; wer es nicht ist, landet bei „Code“
  assert.match(seite, /const eigentuemer = !!state\.keypair && k\.eigentuemer === state\.keypair\.pk;/);
  assert.match(seite, /if \(reiter === "einstellungen" && !eigentuemer\) reiter = "code";/);
  assert.match(seite, /if \(eigentuemer\) leiste\.append\(reiterKnopf\("einstellungen", t\("repo\.einstellungen"\)\)\);/);
  // Speichern: erst prüfen (baueRepoAnkuendigung wirft), dann Rückfrage, dann signieren
  const speichern = seite.slice(seite.indexOf("async function speichereEinstellungen("));
  const [bau, frage, sig, raum] = ["baueRepoAnkuendigung(angaben, state.keypair.pk)", "await bestaetige(", "await signiere(ev)", "await sendeInRaum(k.privatRaum"].map((x) => speichern.indexOf(x));
  assert.ok(bau! > 0 && bau! < frage! && frage! < sig!, "prüfen → fragen → signieren");
  assert.ok(frage! < raum!, "im privaten Raum (11.4b2) ebenso: erst fragen, dann in die Gruppe");
  assert.match(speichern, /fehler\.textContent = fehlerText\(e\);/);
  // Neue Version mit derselben Kennung; Mitwirkende aus allen Beiträgen (keine Abfrage nach Kennung)
  assert.match(seite, /void h\.hochladen\(f, k\.id, k\.privatRaum\)/);
  assert.match(repos, /query\(\{ kinds: \[KIND_GIT_CONTRIBUTION\], limit: 1000 \}\)/);
  assert.doesNotMatch(repos, /"#r"/, "keine Abfrage, die verrät, welches Repo man ansieht");
  assert.match(repos, /mitwirkende: ladeBeitraege,\n\s+hochladen: ladeBundleHoch,/);
  assert.match(repos, /hoch\.addEventListener\("click", \(\) => bundle\.click\(\)\);/);
  assert.doesNotMatch(app, /git-bundle-file|gitPublishBtn/);
  // Eine Liste für beide Orte, nur DOM
  assert.match(earn, /box\.replaceChildren\(\.\.\.mitwirkendeListe\(repo, evs, pkShort\)\);/);
  assert.match(seite, /mitwirkendeListe\(k\.id, evs, eigentuemerName\)/);
  for (const [name, text] of [["mitwirkende.ts", mit], ["repo-seite.ts", seite]]) assert.doesNotMatch(text, /innerHTML/, name);
  // Links fremder Repos öffnen ohne Zugriff auf die App
  assert.match(seite, /a\.relList\.add\("noopener", "noreferrer"\);/);
});
