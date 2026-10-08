/**
 * Schritt 7.5b: USB-Strecke, die Meshtastic spricht – mit einer Attrappe des
 * Geräts aus den Referenz-Nachrichten (meshtastic 2.7.11) – und sonst wie
 * bisher Rahmen mit Längenpräfix.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FREEDOM_KANAL, LORA_MTU, MeshKind, baueFunkPaket, baueKonfigAnfrage, fragment, generateKeypair,
  meshtasticSendezeit, mitLaenge, mitMeshtasticKopf, buildEvent, signEvent,
} from "@freedomstack/protocol";
import { erkenneSerielleStrecke, meshtasticHinweise, type MeshtasticStand } from "../src/meshtastic-strecke.js";
import { MeshNode, eventToMesh, type MeshTransport, type SerialPortLike } from "../src/mesh-radio.js";
import { setLang, t } from "../src/i18n.js";

const REF = JSON.parse(readFileSync(new URL("../../protocol/test/fixtures/meshtastic-referenz.json", import.meta.url), "utf8")) as {
  vomGeraet: { fall: string; hex: string }[];
};
const vom = (fall: string): Uint8Array => Uint8Array.from(Buffer.from(REF.vomGeraet.find((f) => f.fall === fall)!.hex, "hex"));
const KONFIG_ID = 0x12345678; // so steht es in der Referenz („fertig“)
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

/** FromRadio.packet aus unserem ToRadio.packet – so gibt das Gerät des Empfängers es heraus. */
function ausDemFunk(kanal: number, rahmen: Uint8Array): Uint8Array {
  const zum = baueFunkPaket({ kanal, hopLimit: 3, nutzlast: rahmen });
  let i = 1, laenge = 0, faktor = 1;
  for (;;) { const b = zum[i++]!; laenge += (b & 0x7f) * faktor; faktor *= 128; if (b < 0x80) break; }
  const paket = [0x0d, 0xef, 0xbe, 0xad, 0xde, ...zum.subarray(i, i + laenge)]; // from = 0xDEADBEEF
  const n = paket.length;
  return Uint8Array.from([0x12, ...(n > 127 ? [(n & 0x7f) | 0x80, n >> 7] : [n]), ...paket]);
}

/** Einstellungen eines Geräts wie nach `want_config`: Nummer, LoRa, Kanäle, Ende. */
function einstellungen(kanal: "freedom" | "fehlt" | "fremd" = "freedom", lora = vom("lora")): Uint8Array[] {
  const kanaele = [vom("kanal-primaer")];
  if (kanal === "freedom") kanaele.push(vom("kanal"));
  if (kanal === "fremd") kanaele.push(Uint8Array.from([0x52, 0x13, 0x08, 0x01, 0x12, 0x0d, 0x12, 0x02, 0x01, 0x02, 0x1a, 0x07, ...new TextEncoder().encode("freedom"), 0x18, 0x02]));
  return [vom("ich"), lora, ...kanaele, vom("fertig")];
}

/** Port wie Web Serial: schreibt mit, liefert Häppchen – auch Debug-Text der Firmware dazwischen. */
function geraet(nachrichten: Uint8Array[], roh: Uint8Array[] = []) {
  const geschrieben: Uint8Array[] = [];
  const log = new TextEncoder().encode("DEBUG | 12:00:00 [Router] Rx\r\n");
  const strom = [...nachrichten.flatMap((m) => [log, mitMeshtasticKopf(m)]), ...roh];
  let abgebrochen = false;
  const port: SerialPortLike & { geschrieben: Uint8Array[]; abgebrochen: () => boolean; nach: (m: Uint8Array) => void } = {
    geschrieben, abgebrochen: () => abgebrochen,
    nach: (m) => strom.push(mitMeshtasticKopf(m)),
    async open() { /* offen */ },
    async close() { /* zu */ },
    writable: { getWriter: () => ({ async write(d: Uint8Array) { geschrieben.push(d); }, releaseLock() { /* frei */ } }) },
    readable: {
      getReader: () => ({
        async read() {
          for (let i = 0; i < 500 && strom.length === 0 && !abgebrochen; i++) await new Promise((r) => setTimeout(r, 2));
          const value = strom.shift();
          return value ? { value, done: false } : { done: true };
        },
        async cancel() { abgebrochen = true; },
        releaseLock() { /* frei */ },
      }),
    },
  };
  return port;
}

const umschlag = (bytes = 600) => {
  const w = generateKeypair();
  const inhalt = Buffer.from([2, ...crypto.getRandomValues(new Uint8Array(bytes))]).toString("base64");
  return eventToMesh(signEvent(buildEvent(w.pk, 1059, [["p", generateKeypair().pk]], inhalt, 1000), w.sk));
};
const bis = async (f: () => boolean) => { for (let i = 0; i < 300 && !f(); i++) await new Promise((r) => setTimeout(r, 5)); };

test("Meshtastic: erkannt, Kanal „freedom“ gefunden, Rahmen hin und zurück nur auf diesem Kanal", async () => {
  setLang("de");
  const rahmen = fragment(umschlag(), MeshKind.NostrEvent)[0]!;
  const port = geraet([
    ...einstellungen(),
    vom("text"), // Text auf Kanal 0, Port 1: nicht für uns
    ausDemFunk(0, rahmen), // Port 256, aber Hauptkanal: nicht für uns
    ausDemFunk(1, rahmen),
  ]);
  const empfangen: string[] = [];
  const tr = await erkenneSerielleStrecke(port, (r) => empfangen.push(hex(r)), { konfigId: KONFIG_ID });
  assert.equal(tr.name, t("bau.meshtasticUsb"));
  assert.equal(tr.leitetSelbstWeiter, true, "die Firmware flutet selbst");
  assert.deepEqual(tr.meshtastic, { kanal: 1, kanalFremd: false, region: 3, hopLimit: 3, senden: true, preset: 0, vorgabe: true } satisfies MeshtasticStand);
  assert.equal(tr.sendezeit!(LORA_MTU), meshtasticSendezeit({ preset: 0, vorgabe: true }, LORA_MTU));
  // Erst geweckt und gefragt
  assert.equal(hex(port.geschrieben[0]!), "c3".repeat(32) + hex(mitMeshtasticKopf(baueKonfigAnfrage(KONFIG_ID))));
  await bis(() => empfangen.length > 0);
  assert.deepEqual(empfangen, [hex(rahmen)], "nur das Paket auf Kanal „freedom“ mit Port 256");
  // Senden: ein Paket an alle auf Kanal 1 mit dem Hop-Limit des Geräts
  await tr.send(rahmen);
  assert.equal(hex(port.geschrieben.at(-1)!), hex(mitMeshtasticKopf(baueFunkPaket({ kanal: 1, hopLimit: 3, nutzlast: rahmen }))));
  await assert.rejects(tr.send(new Uint8Array(LORA_MTU + 1)));
  // Startet das Gerät neu, fragt die App erneut nach den Einstellungen (schon geweckt: ohne 0xC3 davor)
  const vorher = port.geschrieben.length;
  port.nach(vom("neustart"));
  await bis(() => port.geschrieben.length > vorher);
  const neu = port.geschrieben.at(-1)!;
  assert.deepEqual([...neu.subarray(0, 2)], [0x94, 0xc3]);
  assert.equal(neu[4], 0x18, "want_config");
  // Bis das Gerät seine Einstellungen wieder ganz geschickt hat, gilt der alte Kanal – nichts geht verloren
  await tr.send(rahmen);
  assert.equal(hex(port.geschrieben.at(-1)!), hex(mitMeshtasticKopf(baueFunkPaket({ kanal: 1, hopLimit: 3, nutzlast: rahmen }))));
  await tr.close();
  assert.ok(port.abgebrochen(), "Lesen beim Trennen beendet");
});

test("Meshtastic: ohne Hop-Limit im Gerät 3 wie die Firmware; ohne Kanal geht nichts hinaus", async () => {
  setLang("de");
  const neu = geraet(einstellungen("freedom", vom("lora-neu")));
  const tr = await erkenneSerielleStrecke(neu, () => {}, { konfigId: KONFIG_ID });
  const rahmen = new Uint8Array(50).fill(7);
  await tr.send(rahmen);
  assert.equal(hex(neu.geschrieben.at(-1)!), hex(mitMeshtasticKopf(baueFunkPaket({ kanal: 1, hopLimit: 3, nutzlast: rahmen }))), "Hop-Limit 3 statt 0");
  // lora-neu: eigene Funkwerte (keine Vorgabe) – die App rechnet so langsam wie LongSlow
  assert.equal(tr.sendezeit!(LORA_MTU), meshtasticSendezeit({ preset: 1, vorgabe: true }, LORA_MTU));
  await tr.close();

  const port = geraet(einstellungen("fehlt"));
  const ohne = await erkenneSerielleStrecke(port, () => {}, { konfigId: KONFIG_ID });
  assert.equal(ohne.meshtastic?.kanal, null);
  const zahl = port.geschrieben.length;
  await assert.rejects(ohne.send(rahmen), { kennung: "meshtastic-ohne-kanal" });
  assert.equal(port.geschrieben.length, zahl, "nichts geschrieben");
  await ohne.close();
});

test("Hinweise: Kanal fehlt oder fremd (mit öffentlichem Schlüssel), Region, Senden aus", async () => {
  setLang("de");
  const psk = Buffer.from(FREEDOM_KANAL.psk).toString("base64");
  const fremd = await erkenneSerielleStrecke(geraet(einstellungen("fremd")), () => {}, { konfigId: KONFIG_ID });
  assert.equal(fremd.meshtastic?.kanal, null);
  assert.equal(fremd.meshtastic?.kanalFremd, true);
  assert.deepEqual(meshtasticHinweise(fremd.meshtastic!), [t("set.meshtasticKanalFremd", { name: "freedom", psk })]);
  await fremd.close();

  const s: MeshtasticStand = { kanal: 1, kanalFremd: false, region: 3, hopLimit: 3, senden: true, preset: 0, vorgabe: true };
  assert.deepEqual(meshtasticHinweise(s), [], "alles passt: kein Hinweis");
  assert.deepEqual(meshtasticHinweise({ ...s, region: 0 }), [t("set.meshtasticRegion")]);
  assert.deepEqual(meshtasticHinweise({ ...s, senden: false }), [t("set.meshtasticSendenAus")]);
  const fehlt = meshtasticHinweise({ ...s, kanal: null });
  assert.deepEqual(fehlt, [t("set.meshtasticKanalFehlt", { name: "freedom", psk })]);
  assert.match(fehlt[0]!, new RegExp(psk.replace(/[+/]/g, "\\$&")), "der Schlüssel steht zum Abtippen da");
});

test("Ohne Antwort eines Meshtastic-Geräts: Längenpräfix wie bisher – auch was schon kam", async () => {
  setLang("de");
  const rahmen = fragment(umschlag(), MeshKind.NostrEvent);
  const roh = [Uint8Array.from(rahmen.flatMap((f) => [...mitLaenge(f)]))];
  const port = geraet([], roh);
  const empfangen: string[] = [];
  const tr = await erkenneSerielleStrecke(port, (r) => empfangen.push(hex(r)), { konfigId: KONFIG_ID, suchMs: 60, wiederholMs: 20 });
  assert.equal(tr.name, t("bau.usbFunk"));
  assert.equal(tr.meshtastic, undefined);
  assert.equal(tr.leitetSelbstWeiter, undefined, "eigene Firmware: die App reicht weiter wie bisher");
  assert.equal(tr.sendezeit, undefined);
  assert.ok(port.geschrieben.length >= 2, "während der Suche erneut gefragt (ein ESP32 startet beim Öffnen neu)");
  await bis(() => empfangen.length === rahmen.length);
  assert.deepEqual(empfangen, rahmen.map(hex));
  await tr.send(rahmen[0]!);
  assert.deepEqual(port.geschrieben.at(-1), mitLaenge(rahmen[0]!));
  await tr.close();
});

test("Knoten: über Meshtastic kein Weiterreichen, Sendezeit vom Gerät (7.5b)", async () => {
  const fremdeNachricht = umschlag(300);
  const rahmen = fragment(fremdeNachricht, MeshKind.NostrEvent);
  const strecke = (selbst: boolean): MeshTransport & { gesendet: Uint8Array[] } => {
    const gesendet: Uint8Array[] = [];
    return { kind: "seriell", name: "T", gesendet, leitetSelbstWeiter: selbst, sendezeit: () => 0.001, async send(f) { gesendet.push(f); }, async close() {} };
  };
  for (const selbst of [false, true]) {
    const n = new MeshNode({ onMessage: () => {} });
    try {
      const tr = strecke(selbst);
      await n.attach(tr);
      tr.gesendet.length = 0; // Bestandsmeldung beim Verbinden
      for (const f of rahmen) n.receive(f);
      await bis(() => tr.gesendet.length >= rahmen.length);
      assert.equal(tr.gesendet.length > 0, !selbst, selbst ? "Meshtastic: nichts weitergereicht" : "eigene Firmware: weitergereicht");
    } finally {
      await n.detach(); // sonst hält der Takt den Lauf offen, wenn ein assert scheitert
    }
  }
  // Die Dauer folgt der Sendezeit der Strecke statt 200 Byte/s
  const langsam = new MeshNode({ onMessage: () => {} });
  const schnell = new MeshNode({ onMessage: () => {} });
  try {
    await langsam.attach({ ...strecke(true), sendezeit: (b: number) => b / 50 });
    await schnell.attach({ ...strecke(true), sendezeit: (b: number) => b / 400 });
    const a = langsam.enqueue(umschlag(), MeshKind.NostrEvent, 1, "x").etaSeconds;
    const b = schnell.enqueue(umschlag(), MeshKind.NostrEvent, 1, "x").etaSeconds;
    assert.ok(a > 4 * b, `${a} gegen ${b}`);
  } finally {
    await langsam.detach();
    await schnell.detach();
  }
});

test("Verdrahtung: USB über die Erkennung, Hinweise in der Mesh-Karte", () => {
  const radio = readFileSync(new URL("../src/mesh-radio.ts", import.meta.url), "utf8");
  assert.match(radio, /await port\.open\(\{ baudRate \}\);\n\s+return erkenneSerielleStrecke\(port, onFrame\);/);
  assert.match(radio, /if \(!this\.transport \|\| this\.transport\.leitetSelbstWeiter\) return;/);
  const mesh = readFileSync(new URL("../src/shell/tabs/mesh.ts", import.meta.url), "utf8");
  assert.match(mesh, /hinweis\.textContent = tr\.meshtastic \? meshtasticHinweise\(tr\.meshtastic\)\.join\(" "\) : "";/);
  const html = readFileSync(new URL("../src/shell/index.html", import.meta.url), "utf8");
  assert.match(html, /<div id="mesh-hinweis" class="mono-sm"><\/div>/);
});
