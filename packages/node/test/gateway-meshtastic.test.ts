/**
 * Schritt 7.5d: Das Gateway spricht direkt mit einem Meshtastic-Gerät per TCP
 * (`FUNK_GATEWAY=meshtastic:host[:4403]`) – gegen einen Server, der wie ein Gerät
 * antwortet (Einstellungen auf `want_config`, Pakete in beide Richtungen).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { readFileSync } from "node:fs";
import {
  FREEDOM_KANAL, MeshtasticStrom, Sendezeitkonto, baueFunkPaket, meshtasticSendezeit, mitMeshtasticKopf,
  LORA_MTU, LocalSigner, generateKeypair,
} from "@freedomstack/protocol";
import { GatewayRolle, meshtasticBefunde, meshtasticTcp, type FunkStrecke } from "../src/gateway-role.js";

const REF = JSON.parse(readFileSync(new URL("../../protocol/test/fixtures/meshtastic-referenz.json", import.meta.url), "utf8")) as {
  vomGeraet: { fall: string; hex: string }[];
};
const vom = (fall: string): Uint8Array => Uint8Array.from(Buffer.from(REF.vomGeraet.find((f) => f.fall === fall)!.hex, "hex"));
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const varint = (n: number): number[] => { const o: number[] = []; while (n > 0x7f) { o.push((n % 128) | 0x80); n = Math.floor(n / 128); } o.push(n); return o; };
const bis = async (f: () => boolean) => { for (let i = 0; i < 400 && !f(); i++) await new Promise((r) => setTimeout(r, 5)); };

/** FromRadio.packet aus unserem ToRadio.packet (Feld 1 → 2) – so gibt ein Gerät empfangene Pakete heraus. */
function ausDemFunk(kanal: number, rahmen: Uint8Array): Uint8Array {
  const zum = baueFunkPaket({ kanal, hopLimit: 3, nutzlast: rahmen });
  const n0 = zum[1]! < 0x80 ? zum[1]! : (zum[1]! & 0x7f) | (zum[2]! << 7);
  const inhalt = [0x0d, 0x78, 0x56, 0x34, 0x12, ...zum.subarray(zum.length - n0)];
  return Uint8Array.from([0x12, ...varint(inhalt.length), ...inhalt]);
}

/** Ein „Gerät“ mit WLAN: antwortet auf want_config, schreibt mit, was ankommt. */
async function geraet(mitKanal = true) {
  const zumGeraet: Uint8Array[] = [];
  let verbunden: net.Socket | undefined;
  const server = net.createServer((s) => {
    verbunden = s;
    const strom = new MeshtasticStrom();
    s.on("data", (d: Buffer) => {
      for (const m of strom.push(new Uint8Array(d))) {
        zumGeraet.push(m);
        if (m[0] !== 0x18) continue; // want_config
        let id = 0, f = 1;
        for (let i = 1; i < m.length; i++) { id += (m[i]! & 0x7f) * f; f *= 128; if (m[i]! < 0x80) break; }
        const antwort = [vom("ich"), vom("lora"), vom("kanal-primaer"), ...(mitKanal ? [vom("kanal")] : []), Uint8Array.from([0x38, ...varint(id)])];
        for (const a of antwort) s.write(mitMeshtasticKopf(a));
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as net.AddressInfo).port;
  return { port, zumGeraet, socket: () => verbunden, schliesse: () => new Promise<void>((r) => { verbunden?.destroy(); server.close(() => r()); }) };
}

test("Meshtastic per TCP: Einstellungen, senden auf Kanal „freedom“, empfangen nur dort, Sendezeit des Presets", async () => {
  const g = await geraet();
  const log: string[] = [];
  const empfangen: string[] = [];
  let tr: ReturnType<typeof meshtasticTcp> | undefined;
  try {
    tr = meshtasticTcp(`127.0.0.1:${g.port}`, (f) => empfangen.push(hex(f)), (z) => log.push(z), 50);
    await bis(() => tr!.stand().kanal === 1);
    assert.equal(tr.stand().kanal, 1);
    assert.equal(tr.stand().region, 3);
    assert.deepEqual(log.filter((z) => z.includes("fehlt") || z.includes("Region")), [], "nichts zu bemängeln");
    const rahmen = new Uint8Array(80).fill(4);
    await tr.send(rahmen);
    await bis(() => g.zumGeraet.length >= 2);
    assert.equal(hex(g.zumGeraet.at(-1)!), hex(baueFunkPaket({ kanal: 1, hopLimit: 3, nutzlast: rahmen })));
    g.socket()!.write(mitMeshtasticKopf(ausDemFunk(0, rahmen)));
    g.socket()!.write(mitMeshtasticKopf(ausDemFunk(1, rahmen)));
    await bis(() => empfangen.length > 0);
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(empfangen, [hex(rahmen)], "nur Kanal „freedom“");
    assert.equal(tr.sendezeit!(LORA_MTU), meshtasticSendezeit({ preset: 0, vorgabe: true }, LORA_MTU));
    // Getrennt: verbindet neu und fragt wieder
    const vorher = g.zumGeraet.filter((m) => m[0] === 0x18).length;
    g.socket()!.destroy();
    await bis(() => g.zumGeraet.filter((m) => m[0] === 0x18).length > vorher);
    assert.ok(g.zumGeraet.filter((m) => m[0] === 0x18).length > vorher, "nach der Trennung neu gefragt");
  } finally {
    await tr?.close();
    await g.schliesse();
  }
  await assert.rejects(tr.send(new Uint8Array(1)), /getrennt/);
});

test("Meshtastic per TCP: ohne Kanal sagt es das Log – mit öffentlichem Schlüssel –, und nichts geht hinaus", async () => {
  const g = await geraet(false);
  const log: string[] = [];
  let tr: ReturnType<typeof meshtasticTcp> | undefined;
  try {
    tr = meshtasticTcp(`127.0.0.1:${g.port}`, () => {}, (z) => log.push(z), 50);
    await bis(() => log.some((z) => z.includes("fehlt")));
    const psk = Buffer.from(FREEDOM_KANAL.psk).toString("base64");
    assert.ok(log.some((z) => z.startsWith("[funk] Meshtastic: Kanal „freedom“ fehlt") && z.includes(psk)), log.join("\n"));
    const zahl = g.zumGeraet.length;
    await assert.rejects(tr.send(new Uint8Array(10)), (e: unknown) => (e as { kennung?: string }).kennung === "meshtastic-ohne-kanal");
    assert.equal(g.zumGeraet.length, zahl);
  } finally {
    await tr?.close();
    await g.schliesse();
  }
  // Befunde: Region und Senden
  const s = { kanal: 1, kanalFremd: false, region: 3, hopLimit: 3, senden: true, preset: 0, vorgabe: true };
  assert.deepEqual(meshtasticBefunde(s), []);
  assert.deepEqual(meshtasticBefunde({ ...s, region: 0 }), ["keine Region gesetzt – das Gerät sendet nicht"]);
  assert.deepEqual(meshtasticBefunde({ ...s, senden: false }), ["Senden am Gerät ausgeschaltet"]);
  // Adresse: ohne Port 4403, sonst wie die Brücke
  assert.throws(() => meshtasticTcp("nicht gültig", () => {}), /host:port/);
  assert.throws(() => meshtasticTcp("127.0.0.1:70000", () => {}), /host:port/);
});

test("Gateway: Sendezeit und Takt von der Strecke statt 200 Byte/s (7.5d)", async () => {
  const gesendet: Uint8Array[] = [];
  const pausen: number[] = [];
  const strecke: FunkStrecke = { send: async (f) => { gesendet.push(f); }, close: async () => {}, sendezeit: (n) => n / 50 };
  const konto = new Sendezeitkonto();
  let jetzt = 1_000_000;
  const k = generateKeypair();
  const g = new GatewayRolle({
    strecke, gateway: new LocalSigner(k.sk), netz: { publish: async () => {}, query: async () => [] },
    konto, jetzt: () => jetzt, schlafe: async (ms) => { pausen.push(ms); jetzt += Math.ceil(ms / 1000); }, log: () => {},
  });
  // Eine Nachforderung genügt, um einen Rahmen in die Warteschlange zu bringen
  (g as unknown as { reiheEin(b: Uint8Array, p: number, n: number): void }).reiheEin(new Uint8Array(150).fill(1), 1, jetzt);
  await bis(() => gesendet.length > 0);
  assert.ok(gesendet.length > 0);
  const n = gesendet[0]!.length;
  assert.equal(pausen[0], (n / 50) * 1000, "Takt nach der Sendezeit der Strecke");
  assert.ok(Math.abs(konto.frei(jetzt) - (konto.budget - n / 50)) < 1e-9, "gebucht nach der Sendezeit der Strecke");
  await g.stoppe();
});
