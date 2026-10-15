/**
 * VKf (K1): Koppeln mit dem Code zum Eintippen in der App. Gesucht wird nur nach der Kennung;
 * genommen wird nur, was `leseKurzcodeEvent()` durchlässt – ein fremdes Event unter derselben
 * Kennung koppelt nie. Danach löst die Statusabfrage den Code ein.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  KIND_KURZCODE, baueKurzcodeEvent, generateKeypair, kurzcodeAbleitung, neueKopplung, neuerKurzcode, signEvent, type RelayFilter,
} from "@freedomstack/protocol";
import { kopplungAusKurzcode } from "../src/kurzcode-kopplung.js";

const JETZT = 1_790_000_000;

test("VKf: die App findet den Knoten über den Code – nur mit passender Kennung, Schlüssel und Autor", async () => {
  const knoten = generateKeypair();
  const kopplung = neueKopplung(knoten.pk);
  const code = neuerKurzcode();
  const echt = signEvent(await baueKurzcodeEvent({ kopplung, code, jetzt: JETZT }), knoten.sk);
  const ab = await kurzcodeAbleitung(code);
  // Ein Fremder legt unter dieser Kennung eine eigene Kopplung ab – ohne den Schlüssel aus dem Code unlesbar
  const fremd = generateKeypair();
  const falsch = await baueKurzcodeEvent({ kopplung: neueKopplung(fremd.pk), code: neuerKurzcode(), jetzt: JETZT });
  const unterschoben = signEvent({ ...falsch, tags: [["d", ab.suche], ...falsch.tags.slice(1)] }, fremd.sk);
  const gefragt: RelayFilter[] = [];
  const r = await kopplungAusKurzcode(code.toLowerCase().replace(/-/g, " "), async (f) => { gefragt.push(f); return [unterschoben, echt]; }, JETZT + 60);
  assert.deepEqual(r, { kopplung, suche: ab.suche });
  assert.deepEqual(gefragt, [{ kinds: [KIND_KURZCODE], "#d": [ab.suche], limit: 10 }], "gefragt nur nach der Kennung");
  assert.equal(await kopplungAusKurzcode(code, async () => [unterschoben], JETZT + 60), null);
  assert.equal(await kopplungAusKurzcode(code, async () => [echt], JETZT + 600), null, "abgelaufen");
});

test("VKf verdrahtet: der Dialog nimmt beide Codes, löst den Code mit der Statusabfrage ein", () => {
  const ui = readFileSync(new URL("../src/shell/mein-knoten.ts", import.meta.url), "utf8");
  assert.match(ui, /leseKopplungscode\(String\(v\.code \?\? ""\)\) \|\| leseKurzcode\(String\(v\.code \?\? ""\)\)/);
  assert.match(ui, /kopplungAusKurzcode\(kurz, \(f\) => frageAn\(f, urls\)\)/);
  assert.match(ui, /const urls = \[\.\.\.\(await ensurePool\(\)\)\.urls, \.\.\.startUrls\(\)\];/);
  assert.match(ui, /frageKnotenStatus\(k, kurzSuche\)/);
  const status = readFileSync(new URL("../src/shell/knoten-status-ui.ts", import.meta.url), "utf8");
  assert.match(status, /baueStatusAuftrag\(\{ sitzung, kopplung: k, powBits, kurzcode \}\)/);
});
