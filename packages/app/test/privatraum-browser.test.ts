/**
 * Schritt C-12: Der private Raum läuft einmal vollständig im Browser – zwei
 * Browser hinter derselben Relay-Attrappe, je mit Tresor und echter
 * MLS-Engine (Smoke „privatraum“). Dieser Test hält fest, dass der Smoke-Test
 * die Schritte wirklich geht und das Ergebnis zählt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const smoke = readFileSync(new URL("../../../scripts/smoke_test.py", import.meta.url), "utf8");

test("C-12: Smoke „privatraum“ – angelegt, eingeladen, angenommen, Thread, Meldung, Moderation, Repo, Patch, kein Klartext", () => {
  assert.match(smoke, /erg\["privatraum"\] = privatraum_pruefen\(browser,/);
  assert.match(smoke, /and erg\.get\("privatraum", \{\}\)\.get\("bestanden"\) is True/);
  const teil = smoke.slice(smoke.indexOf("def privatraum_moderation("), smoke.indexOf("def privatraum_pruefen(") + 9000);
  // Zwei Browser, ein Relay: jede Attrappe mit eigenem Schlüssel, dieselben Events
  assert.match(teil, /rb\.events = ra\.events/);
  // KeyPackage (30443), Einladung an Bos Posteingang (1059 mit seinem p-Tag), Annahme beim nächsten Start
  assert.match(teil, /e\.get\("kind"\) == 30443 and e\.get\("pubkey"\) == pk_bo/);
  assert.match(teil, /e\.get\("kind"\) == 1059 and \["p", pk_bo\] in/);
  assert.match(teil, /entsperre_neu\(bo, "bo tresor 1"\)/);
  // Meldung nur an die Moderatorin, Moderation für alle, Repo und Patch nur in der Gruppe (kein offenes 1617)
  assert.match(teil, /an == \[relay\.ich\]/);
  assert.match(teil, /"bei_bo_weg": True/);
  assert.match(teil, /"offen_1617": False/);
  // Auf dem Relay weder Raumname noch Texte noch Repo-Kennung noch Betreff
  assert.match(teil, /erg\["klartext"\] = \[x for x in \("Probe privat", gruss, antwort, repo_id, betreff\) if x in roh\]/);
});
