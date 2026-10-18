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
  // Auf dem Relay weder Raumname noch Texte noch Repo-Kennung noch Betreff – seit B-34d auch nicht die Adresse des SFU
  assert.match(teil, /erg\["klartext"\] = \[x for x in \("Probe privat", gruss, antwort, repo_id, betreff, "sfu\.probe\.test"\) if x in roh\]/);
});

test("B-34d: Smoke „privatraum“ – Gruppenanruf: Zugänge vom Knoten, Rückfrage vor dem Beitritt, abgebrochen nichts hinaus, SFU nur aus der Einladung", () => {
  const teil = smoke.slice(smoke.indexOf("def privatraum_anruf("), smoke.indexOf("def privatraum_pruefen("));
  assert.match(smoke, /privatraum_anruf\(ada, bo, ra, pille, erg\)/);
  assert.match(smoke, /ada = DialogSeite\(browser, url, ra, erg, init=GRUPPENANRUF_ZAEHLER\)/);
  // Der Knoten bekommt erst die Frage nach Zugängen (5081), dann – beim Beitreten der Anruferin – nach ihrem TURN (5079)
  assert.match(teil, /"anfragen": \[5081, 5079\]/);
  // Bo: die Frage nennt die IP; abgebrochen kein Worker und keine Verbindung zum SFU; danach genau die Adresse der Einladung
  assert.match(teil, /"sieht deine IP-Adresse" in \(b\["frage"\] or ""\) and b\["abgebrochen"\] == \[0, 0\] and b\["sfu"\] == a\["sfu"\]/);
  assert.match(teil, /all\(u\.startswith\("wss:\/\/sfu\.probe\.test\/rtc"\) for u in a\["sfu"\]\)/);
  assert.match(teil, /"zaehler": \[1, \[\]\]/, "ein E2EE-Worker aus blob:, kein Verstoß gegen die CSP");
  // Die Verbindung zum SFU stellt die Seite nach, nie der Handler von route_web_socket (close() hielte den Test an)
  assert.match(smoke, /Object\.defineProperty\(window, 'WebSocket', \{ configurable: true, get: \(\) => Huelle, set:/);
  assert.doesNotMatch(smoke.slice(smoke.indexOf("class ProbeRelay"), smoke.indexOf("def zustellen(")), /ws\.close\(\)/);
});
