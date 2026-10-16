/**
 * SOCKS5-Attrappe für Tests (aus `tor.test.ts`, seit RM2b3 geteilt): nimmt nur „ohne Anmeldung“, löst jeden
 * Namen auf 127.0.0.1 auf (wie Tor ins Netz) und merkt sich, welche Namen gefragt wurden.
 */
import { once } from "node:events";
import net from "node:net";
import type { AddressInfo } from "node:net";

export async function socksAttrappe(p: { antwort?: number; methode?: number } = {}) {
  const gesehen: { atyp: number; host: string; port: number }[] = [];
  const server = net.createServer((c) => {
    let stufe = 0;
    let buf = Buffer.alloc(0);
    const lies = (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      if (stufe === 0) {
        if (buf.length < 2 || buf.length < 2 + buf[1]!) return;
        c.write(Buffer.from([5, p.methode ?? 0]));
        if (p.methode) return void c.end();
        buf = buf.subarray(2 + buf[1]!);
        stufe = 1;
      }
      if (buf.length < 5 || buf.length < 5 + buf[4]! + 2) return;
      const n = buf[4]!;
      gesehen.push({ atyp: buf[3]!, host: buf.subarray(5, 5 + n).toString(), port: buf.readUInt16BE(5 + n) });
      c.removeListener("data", lies);
      if (p.antwort) return void c.end(Buffer.from([5, p.antwort, 0, 1, 0, 0, 0, 0, 0, 0]));
      const ziel = net.connect(buf.readUInt16BE(5 + n), "127.0.0.1", () => {
        c.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
        c.pipe(ziel);
        ziel.pipe(c);
      });
      ziel.on("error", () => c.destroy());
      c.on("error", () => ziel.destroy());
    };
    c.on("data", lies);
    c.on("error", () => {});
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { gesehen, server, proxy: { host: "127.0.0.1", port: (server.address() as AddressInfo).port } };
}
