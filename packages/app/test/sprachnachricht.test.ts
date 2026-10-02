/**
 * Schritt C-7a: Sprachnachrichten, die Aufnahme ohne DOM. Das Mikrofon geht
 * nur nach `starte()` an und nach jedem Ende wieder aus – beendet, verworfen,
 * an der Grenze, bei einem Fehler, und auch, wenn der Browser die Erlaubnis
 * erst gibt, nachdem abgebrochen wurde. Ein Ton aus fremder Nachricht gilt nur
 * mit geprüftem Typ als Ton. Knopf, Anhang und Abspielen kommen mit C-7b.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SPRACH_FORMATE, SPRACH_GRENZEN, SprachAufnahme, type SprachErgebnis, type SprachUmgebung,
  dauerText, istAudioTyp, sprachDateiname, waehleSprachFormat,
} from "../src/sprachnachricht.js";

class Spur { gestoppt = false; stop() { this.gestoppt = true; } }
class Strom {
  spuren = [new Spur()];
  getTracks() { return this.spuren; }
  get aus() { return this.spuren.every((s) => s.gestoppt); }
}
class Recorder {
  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(public strom: Strom, mime: string | null) { this.mimeType = mime ?? ""; }
  start() { this.state = "recording"; }
  /** Wie der Browser: erst die letzten Daten, dann `stop` – hier ohne Wartezeit. */
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])], { type: this.mimeType }) });
    this.onstop?.();
  }
}

function umgebung(o: { verweigert?: boolean; recorderWirft?: boolean; mikrofon?: () => Promise<Strom> } = {}) {
  const u = {
    stroeme: [] as Strom[],
    recorder: [] as Recorder[],
    uhr: null as null | (() => void),
    zeit: 1_000_000,
  };
  const umg: SprachUmgebung = {
    mikrofon: async () => {
      if (o.verweigert) throw new Error("NotAllowedError");
      const s = o.mikrofon ? await o.mikrofon() : new Strom();
      u.stroeme.push(s);
      return s as never;
    },
    recorder: (s, mime) => {
      if (o.recorderWirft) throw new Error("NotSupportedError");
      const r = new Recorder(s as never, mime);
      u.recorder.push(r);
      return r as never;
    },
    kann: (m) => m === "audio/ogg;codecs=opus",
    spaeter: (fn) => {
      u.uhr = fn;
      return () => { u.uhr = null; };
    },
    jetzt: () => u.zeit,
  };
  return { u, umg };
}

test("C-7: Format, Dateiname, Dauer und geprüfter Typ", () => {
  assert.equal(waehleSprachFormat((m) => m === "audio/mp4"), "audio/mp4");
  assert.equal(waehleSprachFormat((m) => SPRACH_FORMATE.includes(m as never)), "audio/webm;codecs=opus");
  assert.equal(waehleSprachFormat(() => { throw new Error("alt"); }), null, "ältere Browser werfen – dann wählt der Browser");
  assert.equal(waehleSprachFormat(() => false), null);
  assert.equal(sprachDateiname("audio/webm;codecs=opus"), "sprachnachricht.webm");
  assert.equal(sprachDateiname("audio/ogg; codecs=opus"), "sprachnachricht.ogg");
  assert.equal(sprachDateiname("audio/mp4"), "sprachnachricht.m4a");
  assert.equal(dauerText(0), "0:00");
  assert.equal(dauerText(65.9), "1:05");
  assert.equal(dauerText(SPRACH_GRENZEN.sekunden), "2:00");
  for (const ja of ["audio/webm", "audio/webm;codecs=opus", "audio/ogg; codecs=opus", "AUDIO/MP4", "audio/mpeg"]) assert.ok(istAudioTyp(ja), ja);
  for (const nein of ["", "audio/", "text/html", "video/webm", "image/svg+xml", 'audio/webm" onerror="x', "audio/webm;<b>", "application/octet-stream"]) {
    assert.ok(!istAudioTyp(nein), nein);
  }
});

test("C-7: Mikrofon nur nach starte(), nach beende() alle Spuren aus – die Aufnahme kommt zurück", async () => {
  const { u, umg } = umgebung();
  const a = new SprachAufnahme(umg);
  assert.equal(u.stroeme.length, 0, "ohne Klick kein Mikrofon");
  assert.equal(a.stand, "bereit");
  await a.starte();
  assert.equal(a.stand, "nimmt-auf");
  assert.equal(u.recorder[0]!.mimeType, "audio/ogg;codecs=opus", "das erste Format, das der Recorder kann");
  await a.starte();
  assert.equal(u.stroeme.length, 1, "ein zweiter Klick während der Aufnahme fragt nicht erneut");
  u.zeit += 4_500;
  assert.equal(a.sekunden, 4.5);
  const e = await a.beende();
  assert.ok(u.stroeme[0]!.aus, "Mikrofon aus");
  assert.equal(a.stand, "bereit");
  assert.equal(e?.mime, "audio/ogg;codecs=opus");
  assert.equal(e?.sekunden, 4.5);
  assert.equal(e?.datei.size, 3);
  assert.equal(u.uhr, null, "die Grenze ist abgemeldet");
  assert.equal(await a.beende(), null, "nichts läuft – nichts kommt");
});

test("C-7: verwerfen – Mikrofon aus, nichts bleibt, auch kein Ergebnis über beiEnde", async () => {
  const { u, umg } = umgebung();
  const enden: (SprachErgebnis | null)[] = [];
  const a = new SprachAufnahme(umg, (e) => enden.push(e));
  await a.starte();
  await a.brichAb();
  assert.ok(u.stroeme[0]!.aus);
  assert.equal(a.stand, "bereit");
  assert.deepEqual(enden, []);
});

test("C-7: an der Grenze endet die Aufnahme von selbst – Ergebnis über beiEnde, Mikrofon aus", async () => {
  const { u, umg } = umgebung();
  const enden: (SprachErgebnis | null)[] = [];
  const a = new SprachAufnahme(umg, (e) => enden.push(e));
  await a.starte();
  u.zeit += SPRACH_GRENZEN.sekunden * 1000;
  u.uhr!();
  await new Promise((r) => setImmediate(r));
  assert.ok(u.stroeme[0]!.aus);
  assert.equal(enden.length, 1);
  assert.equal(enden[0]?.sekunden, SPRACH_GRENZEN.sekunden);
  // Endet der Recorder von selbst (Mikrofon abgezogen), kommt das Ergebnis ebenso
  await a.starte();
  u.recorder[1]!.stop();
  assert.ok(u.stroeme[1]!.aus);
  assert.equal(enden.length, 2);
  assert.equal(a.stand, "bereit");
});

test("C-7: verweigert oder kaputt – nichts bleibt an, ein neuer Versuch geht", async () => {
  const nein = umgebung({ verweigert: true });
  const a = new SprachAufnahme(nein.umg);
  await assert.rejects(a.starte(), /NotAllowedError/);
  assert.equal(a.stand, "bereit");
  const kaputt = umgebung({ recorderWirft: true });
  const b = new SprachAufnahme(kaputt.umg);
  await assert.rejects(b.starte(), /NotSupportedError/);
  assert.ok(kaputt.u.stroeme[0]!.aus, "der Strom war schon offen – er geht wieder aus");
  assert.equal(b.stand, "bereit");
  assert.equal(kaputt.u.uhr, null);
});

test("C-7: abgebrochen, während der Browser noch fragt – die späte Erlaubnis schaltet nichts ein", async () => {
  let gib: (s: Strom) => void = () => {};
  const { u, umg } = umgebung({ mikrofon: () => new Promise<Strom>((r) => { gib = r; }) });
  const a = new SprachAufnahme(umg);
  const laeuft = a.starte();
  assert.equal(a.stand, "startet");
  await a.brichAb();
  const s = new Strom();
  gib(s);
  await laeuft;
  assert.ok(s.aus, "sofort wieder aus");
  assert.equal(u.recorder.length, 0, "kein Recorder");
  assert.equal(a.stand, "bereit");
});
