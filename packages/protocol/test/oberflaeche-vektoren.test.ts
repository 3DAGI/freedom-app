/**
 * Gemeinsame Prüffälle (6.1a3a): Die Desktop-Hülle prüft ein Update der Oberfläche
 * in Rust (`packages/launcher/src/update.rs`) noch einmal selbst. Beide Seiten müssen
 * bei denselben signierten Manifesten gleich entscheiden – hier die Seite des
 * Protokolls (`suchUpdate()` + `pruefeDatei()`), in `update.rs` die der Hülle.
 * Neu erzeugt werden die Fälle nur mit `scripts/oberflaeche-vektoren.mts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { type NostrEvent } from "../src/event.js";
import { hashText } from "../src/release.js";
import { pruefeDatei, suchUpdate } from "../src/oberflaeche-update.js";

interface Fall {
  name: string;
  html: string;
  laufend_seit: number;
  belege: NostrEvent[];
  erwartet: { ok: { version: string; released_at: number } } | { fehler: "kein-beleg" | "zu-wenig" | "abweichend" | "nicht-neuer" };
}
const v = JSON.parse(readFileSync(new URL("../../launcher/tests/vektoren.json", import.meta.url), "utf8")) as { vertraut: string[]; k: number; faelle: Fall[] };

test("6.1a3a: die gemeinsamen Prüffälle sind vollständig", () => {
  assert.equal(v.k, 2);
  assert.equal(v.vertraut.length, 3);
  const arten = new Set(v.faelle.map((f) => ("ok" in f.erwartet ? "ok" : f.erwartet.fehler)));
  assert.deepEqual([...arten].sort(), ["abweichend", "kein-beleg", "nicht-neuer", "ok", "zu-wenig"]);
});

for (const f of v.faelle) {
  test(`6.1a3a: Protokoll entscheidet wie die Hülle – ${f.name}`, () => {
    // Die Hülle bekommt Datei und Belege und kennt den Zeitpunkt der laufenden Fassung;
    // die laufende ist eine andere Datei (sonst gäbe es nichts zu installieren).
    const r = suchUpdate(f.belege, v.vertraut, { sha256: hashText("<p>laufende Fassung</p>"), releasedAt: f.laufend_seit }, v.k);
    const daten = new TextEncoder().encode(f.html);
    if ("ok" in f.erwartet) {
      assert.ok("angebot" in r, JSON.stringify(r));
      assert.equal(r.angebot.version, f.erwartet.ok.version);
      assert.equal(r.angebot.releasedAt, f.erwartet.ok.released_at);
      assert.deepEqual(pruefeDatei(r.angebot, daten), { ok: true });
      return;
    }
    switch (f.erwartet.fehler) {
      case "kein-beleg":
        assert.deepEqual(r, { fall: "kein-manifest", noetig: v.k });
        break;
      case "zu-wenig":
        assert.ok("fall" in r && (r.fall === "zu-wenig" || r.fall === "kein-manifest"), JSON.stringify(r));
        break;
      case "nicht-neuer":
        assert.ok("fall" in r && r.fall === "aktuell", JSON.stringify(r));
        break;
      case "abweichend":
        assert.ok("angebot" in r, JSON.stringify(r));
        assert.equal(pruefeDatei(r.angebot, daten).ok, false);
        break;
    }
  });
}
