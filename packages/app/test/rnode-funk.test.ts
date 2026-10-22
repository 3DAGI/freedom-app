/**
 * B-32b1: Funkparameter der RNode (RN-W6 A) – Vorgaben je Region mit Quelle, Abweichen nur in den Grenzen, verbunden
 * wird nur mit bestätigter Wahl; die Firmware bekommt genau diese Werte und die Sendezeit-Sperre der Region.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FUNK_REGIONEN, LS_RETICULUM_FUNK, funkWahlText, leseFunkWahl, maxSendeleistungDbm, pruefeFunkParameter, rnodeOptionen, verbindeRNode,
  type FunkParameter, type FunkWahl, type RNodePort,
} from "../src/rnode-funk.js";

const EU = FUNK_REGIONEN.find((r) => r.kennung === "eu-869")!;
const wahl = (p: Partial<FunkParameter> = {}, region = "eu-869"): FunkWahl => ({
  region, parameter: { ...FUNK_REGIONEN.find((r) => r.kennung === region)!.vorgabe, ...p }, bestaetigt: 1_790_000_000,
});

test("B-32b1: jede Region hat Quelle, Grenzen und Vorgaben darunter – das Signal liegt ganz im Band", () => {
  assert.deepEqual(FUNK_REGIONEN.map((r) => r.kennung), ["eu-869", "eu-433"]);
  for (const r of FUNK_REGIONEN) {
    assert.match(r.quelle, /^set\.rnodeQuelle/, `${r.kennung}: Quelle als Text in beiden Sprachen`);
    assert.ok(r.von < r.bis && r.maxErpMw > 0 && r.maxSendezeitProzent > 0 && r.maxSendezeitProzent <= 10);
    assert.deepEqual(pruefeFunkParameter(r.kennung, r.vorgabe), { ok: true, region: r }, `${r.kennung}: Vorgabe gültig`);
    assert.ok(r.vorgabe.txPower <= 14, "die Vorgabe bleibt bei höchstens 25 mW");
  }
  assert.equal(maxSendeleistungDbm(EU), 26, "500 mW = 27 dBm, abgerundet unter der Grenze");
  assert.equal(maxSendeleistungDbm(FUNK_REGIONEN[1]!), 10);
});

test("B-32b1: Abweichen nur innerhalb der Grenzen – sonst ein Fall, nie ein stiller Ersatz", () => {
  const p = EU.vorgabe;
  const falsch: Array<[Partial<FunkParameter>, string]> = [
    [{ frequency: 869_400_000 }, "frequenz"], // die halbe Bandbreite ragte unten heraus
    [{ frequency: 869_600_000 }, "frequenz"],
    [{ frequency: 868_100_000 }, "frequenz"],
    [{ bandwidth: 500_000 }, "frequenz"], // 869,525 ± 250 kHz ragt über das 250-kHz-Band hinaus
    [{ bandwidth: 100_000 }, "bandbreite"],
    [{ spreadingFactor: 6 }, "spreizfaktor"],
    [{ spreadingFactor: 13 }, "spreizfaktor"],
    [{ codingRate: 4 }, "kodierrate"],
    [{ txPower: 27 }, "leistung"],
    [{ txPower: -1 }, "leistung"],
    [{ txPower: 14.5 }, "form"],
  ];
  for (const [aenderung, fall] of falsch) assert.deepEqual(pruefeFunkParameter("eu-869", { ...p, ...aenderung }), { ok: false, fall }, JSON.stringify(aenderung));
  assert.deepEqual(pruefeFunkParameter("us-915", p), { ok: false, fall: "region" }, "ohne Eintrag keine Region");
  assert.ok(pruefeFunkParameter("eu-869", { ...p, frequency: 869_462_500 }).ok, "unten bündig");
  assert.ok(pruefeFunkParameter("eu-869", { ...p, bandwidth: 250_000 }).ok, "869,525 ± 125 kHz füllt das Band genau");
  assert.ok(pruefeFunkParameter("eu-869", { ...p, txPower: 26, spreadingFactor: 12 }).ok);
});

test("B-32b1: gemerkt wird nur eine bestätigte, gültige Wahl", () => {
  const w = wahl({ txPower: 10 });
  assert.equal(LS_RETICULUM_FUNK, "freedom.reticulum.funk");
  assert.deepEqual(leseFunkWahl(funkWahlText(w)), w);
  assert.throws(() => funkWahlText(wahl({ txPower: 30 })), RangeError);
  assert.throws(() => funkWahlText({ ...w, bestaetigt: 0 }), RangeError);
  for (const roh of [null, "", "{", "[]", JSON.stringify({ ...w, bestaetigt: 0 }), JSON.stringify({ ...w, region: "us-915" }),
    JSON.stringify({ ...w, parameter: { ...w.parameter, frequency: 868_000_000 } })]) {
    assert.equal(leseFunkWahl(roh), null, String(roh));
  }
  assert.deepEqual(rnodeOptionen(w), { ...w.parameter, airtimeLimitLong: 10 }, "die Firmware sperrt selbst bei 10 % Sendezeit");
  assert.throws(() => rnodeOptionen(wahl({ frequency: 1 })), RangeError);
});

// --- eine RNode zum Prüfen: antwortet wie die Firmware (KISS, Befehle zurückgemeldet) ---

const FEND = 0xc0, FESC = 0xdb, TFEND = 0xdc, TFESC = 0xdd;
const CMD = { FREQUENZ: 0x01, BANDBREITE: 0x02, LEISTUNG: 0x03, SF: 0x04, CR: 0x05, ZUSTAND: 0x06, DETECT: 0x08, LEAVE: 0x0a, ST_ALOCK: 0x0b, LT_ALOCK: 0x0c, PLATTFORM: 0x48, MCU: 0x49, FW: 0x50 };

function rnodeAttrappe(o: { firmware?: [number, number]; leistungMeldet?: number } = {}) {
  const befehle: Array<{ cmd: number; daten: number[] }> = [];
  let ausgabe!: ReadableStreamDefaultController<Uint8Array>;
  const sende = (cmd: number, daten: number[]) => {
    const roh: number[] = [];
    for (const b of daten) roh.push(...(b === FEND ? [FESC, TFEND] : b === FESC ? [FESC, TFESC] : [b]));
    ausgabe.enqueue(Uint8Array.from([FEND, cmd, ...roh, FEND]));
  };
  let rahmen: number[] = [];
  let esc = false;
  const antworte = (cmd: number, daten: number[]) => {
    befehle.push({ cmd, daten });
    if (cmd === CMD.DETECT) return sende(cmd, [0x46]);
    if (cmd === CMD.FW) return sende(cmd, o.firmware ?? [1, 82]);
    if (cmd === CMD.PLATTFORM) return sende(cmd, [0x80]);
    if (cmd === CMD.MCU) return sende(cmd, [0x81]);
    if (cmd === CMD.LEISTUNG && o.leistungMeldet !== undefined) return sende(cmd, [o.leistungMeldet]);
    if ([CMD.FREQUENZ, CMD.BANDBREITE, CMD.LEISTUNG, CMD.SF, CMD.CR, CMD.ZUSTAND, CMD.ST_ALOCK, CMD.LT_ALOCK].includes(cmd)) return sende(cmd, daten);
  };
  let offen = false;
  const port: RNodePort & { geschlossen: boolean } = {
    geschlossen: false,
    readable: null,
    writable: null,
    async open() {
      offen = true;
      port.readable = new ReadableStream<Uint8Array>({ start: (c) => { ausgabe = c; } });
      port.writable = new WritableStream<Uint8Array>({
        write(stueck) {
          for (const b of stueck) {
            if (b === FEND) {
              if (rahmen.length > 0) antworte(rahmen[0]!, rahmen.slice(1));
              rahmen = [];
              continue;
            }
            if (esc) {
              rahmen.push(b === TFEND ? FEND : b === TFESC ? FESC : b);
              esc = false;
            } else if (b === FESC) esc = true;
            else rahmen.push(b);
          }
        },
      });
    },
    async close() {
      offen = false;
      port.geschlossen = true;
    },
  };
  return { port, befehle, offen: () => offen };
}

const u32 = (d: number[]) => ((d[0]! << 24) >>> 0) + (d[1]! << 16) + (d[2]! << 8) + d[3]!;

test("B-32b1: verbinden – die RNode bekommt genau die bestätigten Werte und die Sendezeit-Sperre, dann aus", async () => {
  const a = rnodeAttrappe();
  const w = wahl({ txPower: 12, spreadingFactor: 9 });
  const rnode = await verbindeRNode(a.port, w, { postOpenDelayMs: 0, detectTimeout: 2 });
  try {
    assert.equal(rnode.online, true);
    const zuletzt = (cmd: number) => a.befehle.filter((b) => b.cmd === cmd).at(-1)?.daten ?? [];
    assert.equal(u32(zuletzt(CMD.FREQUENZ)), 869_525_000);
    assert.equal(u32(zuletzt(CMD.BANDBREITE)), 125_000);
    assert.deepEqual(zuletzt(CMD.LEISTUNG), [12]);
    assert.deepEqual(zuletzt(CMD.SF), [9]);
    assert.deepEqual(zuletzt(CMD.CR), [5]);
    const lt = zuletzt(CMD.LT_ALOCK);
    assert.equal(((lt[0]! << 8) + lt[1]!) / 100, 10, "Sendezeit-Sperre der Region: 10 %");
    assert.deepEqual(zuletzt(CMD.ZUSTAND), [1], "Radio an");
  } finally {
    await rnode.disconnect();
  }
  assert.equal(a.port.geschlossen, true, "Port wieder zu");
});

test("B-32b1: nicht verbunden – ungültige Wahl, alte Firmware oder Werte, die das Gerät anders meldet", async () => {
  const a = rnodeAttrappe();
  await assert.rejects(verbindeRNode(a.port, wahl({ txPower: 27 })), RangeError);
  assert.equal(a.offen(), false, "bei ungültiger Wahl wird der Port gar nicht geöffnet");
  const alt = rnodeAttrappe({ firmware: [1, 40] });
  await assert.rejects(verbindeRNode(alt.port, wahl(), { postOpenDelayMs: 0, detectTimeout: 2 }), /too old/);
  const anders = rnodeAttrappe({ leistungMeldet: 22 });
  await assert.rejects(verbindeRNode(anders.port, wahl(), { postOpenDelayMs: 0, detectTimeout: 2 }), /did not match/);
});

test("B-32b1: verdrahtet – Knopf „RNode“ im Funk-Bereich, Region bestätigt vor dem Port, Texte je Region in beiden Sprachen", async () => {
  const { readFileSync } = await import("node:fs");
  const lies = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  assert.match(lies("src/shell/index.html"), /<button id="mesh-rnode" class="ghost"[^>]*data-i18n="set\.rnode">/);
  assert.match(lies("src/shell/tabs/mesh.ts"), /const rnode = \$\("#mesh-rnode"\);\n\s+if \(rnode\) rnode\.onclick = async \(\) => \{\n\s+const \{ rnodeKnopf \} = await import\("\.\.\/rnode-ui\.js"\);/);
  const ui = lies("src/shell/rnode-ui.ts");
  assert.ok(ui.indexOf("await waehleFunkRegion()") < ui.indexOf("serial.requestPort()"), "erst bestätigen, dann den Port wählen");
  assert.match(ui, /parameter: \{ \.\.\.region\.vorgabe \}/, "nur die Vorgabe der Region – keine freien Werte");
  assert.doesNotMatch(ui, /\.message|innerHTML|console\./, "keine Meldungen der Bibliothek, nur feste Texte");
  const { setLang, t } = await import("../src/i18n.js");
  for (const sprache of ["de", "en"] as const) {
    setLang(sprache);
    for (const k of ["set.rnode", "set.rnodeTitel", "set.rnodeText", "set.rnodeRegion", "set.rnodeRegionZeile", "set.rnodeVorgabe", "set.rnodeBestaetigen",
      "set.rnodeVerbunden", "set.rnodeNicht", "set.rnodeGetrennt", ...FUNK_REGIONEN.map((r) => r.quelle)]) {
      assert.notEqual(t(k), k, `${sprache}: ${k}`);
    }
    for (const r of FUNK_REGIONEN) assert.match(t(r.quelle), /2006\/771\/(EG|EC).*2019\/1345/, `${sprache}: Quelle ${r.kennung}`);
  }
  setLang("en");
});
