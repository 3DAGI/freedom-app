/**
 * Tor für die Verbindungen des Knotens zu Relays (Schritt 8.2c) – SOCKS5 ohne
 * neue Abhängigkeit.
 *
 * - Den Hostnamen löst Tor auf (Adresstyp 3): Der Knoten fragt nie selbst
 *   einen DNS-Server nach einem Relay, und .onion-Adressen gehen.
 * - wss: TLS über den Tunnel, mit Prüfung des Zertifikats gegen den Hostnamen.
 * - Kein Ausweg: Ist `TOR_SOCKS` gesetzt, aber ungültig, startet der Knoten
 *   nicht; ist Tor nicht erreichbar, scheitern die Verbindungen – nie geht er
 *   still ohne Tor ins Netz.
 *
 * Relays sehen dann die Adresse eines Tor-Ausgangs statt der des Knotens.
 * Nicht über Tor gehen Solana-RPC, LND, Ollama und die Selbstprüfung
 * (`docs/PROVIDER.md`).
 */
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { Duplex } from "node:stream";
import tls from "node:tls";
import { WebSocket } from "ws";

export interface SocksZiel { host: string; port: number }

/** Feste Texte je SOCKS5-Antwort (RFC 1928) – nie Meldungen von außen. */
const ANTWORT: Record<number, string> = {
  1: "allgemeiner Fehler", 2: "nicht erlaubt", 3: "Netz nicht erreichbar", 4: "Ziel nicht erreichbar",
  5: "Verbindung abgelehnt", 6: "Zeit abgelaufen", 7: "Befehl nicht unterstützt", 8: "Adresstyp nicht unterstützt",
};

export class SocksFehler extends Error {
  override name = "SocksFehler";
}

/** Eine TCP-Verbindung zu `ziel` durch den SOCKS5-Proxy – der Proxy löst den Namen auf. */
export function socksVerbinde(proxy: SocksZiel, ziel: SocksZiel, zeitMs = 30_000): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const name = Buffer.from(ziel.host);
    if (name.length < 1 || name.length > 255) return reject(new SocksFehler("Hostname ungültig"));
    if (!Number.isInteger(ziel.port) || ziel.port < 1 || ziel.port > 65_535) return reject(new SocksFehler("Port ungültig"));
    const s = net.connect(proxy.port, proxy.host);
    let puffer = Buffer.alloc(0);
    let stufe: "gruss" | "antwort" = "gruss";
    const ende = (e?: Error) => {
      clearTimeout(timer);
      s.removeListener("data", lies);
      if (e) { s.destroy(); reject(e); }
    };
    const timer = setTimeout(() => ende(new SocksFehler("Zeit abgelaufen")), zeitMs);
    const lies = (d: Buffer) => {
      puffer = Buffer.concat([puffer, d]);
      if (stufe === "gruss") {
        if (puffer.length < 2) return;
        if (puffer[0] !== 5 || puffer[1] !== 0) return ende(new SocksFehler("Proxy verlangt eine Anmeldung oder ist kein SOCKS5"));
        puffer = puffer.subarray(2);
        stufe = "antwort";
        s.write(Buffer.concat([Buffer.from([5, 1, 0, 3, name.length]), name, Buffer.from([ziel.port >> 8, ziel.port & 0xff])]));
      }
      if (puffer.length < 5) return;
      if (puffer[0] !== 5) return ende(new SocksFehler("keine SOCKS5-Antwort"));
      if (puffer[1] !== 0) return ende(new SocksFehler(ANTWORT[puffer[1]!] ?? "unbekannte Antwort"));
      const laenge = puffer[3] === 1 ? 4 : puffer[3] === 4 ? 16 : puffer[3] === 3 ? 1 + puffer[4]! : -1;
      if (laenge < 0) return ende(new SocksFehler("unbekannter Adresstyp"));
      if (puffer.length < 4 + laenge + 2) return;
      const rest = puffer.subarray(4 + laenge + 2);
      ende();
      if (rest.length > 0) s.unshift(rest);
      s.removeListener("error", fehler);
      resolve(s);
    };
    const fehler = (e: Error) => ende(e);
    s.on("data", lies);
    s.once("error", fehler);
    s.once("connect", () => s.write(Buffer.from([5, 1, 0])));
  });
}

type Rueckruf = (e: Error | null, s: Duplex) => void;
const verbinde = (proxy: SocksZiel, o: { host?: string | null; port?: number | string | null }, sicher: boolean, cb?: Rueckruf): undefined => {
  const host = o.host ?? "";
  socksVerbinde(proxy, { host, port: Number(o.port) })
    // TLS über den Tunnel, Zertifikat gegen den Hostnamen geprüft (Standard von tls.connect)
    .then((roh) => cb?.(null, sicher ? tls.connect({ socket: roh, servername: net.isIP(host) ? undefined : host }) : roh))
    .catch((e: Error) => cb?.(e, undefined as unknown as Duplex));
  return undefined;
};

class TorHttpAgent extends http.Agent {
  constructor(private readonly proxy: SocksZiel) { super({ keepAlive: false }); }
  override createConnection(o: http.ClientRequestArgs, cb?: Rueckruf): undefined {
    return verbinde(this.proxy, o, false, cb);
  }
}

class TorHttpsAgent extends https.Agent {
  constructor(private readonly proxy: SocksZiel) { super({ keepAlive: false }); }
  override createConnection(o: https.RequestOptions, cb?: Rueckruf): undefined {
    return verbinde(this.proxy, o, true, cb);
  }
}

/** WebSocket-Fabrik für `WebSocketRelay` (Option `verbinde`): jede Verbindung durch Tor. */
export function torWebSocket(proxy: SocksZiel): (url: string) => globalThis.WebSocket {
  const agenten = { ws: new TorHttpAgent(proxy), wss: new TorHttpsAgent(proxy) };
  return (url) => new WebSocket(url, { agent: url.startsWith("wss:") ? agenten.wss : agenten.ws }) as unknown as globalThis.WebSocket;
}

/** `TOR_SOCKS=host:port` – ohne: kein Tor; ungültig: ein Grund (der Knoten startet dann nicht). */
export function torAusUmgebung(env: { TOR_SOCKS?: string }): { proxy?: SocksZiel; grund?: string } {
  const w = env.TOR_SOCKS?.trim();
  if (!w) return {};
  const m = /^(\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+):(\d{1,5})$/.exec(w);
  const port = m ? Number(m[2]) : 0;
  if (!m || port < 1 || port > 65_535) return { grund: `TOR_SOCKS ungültig (erwartet host:port, z. B. 127.0.0.1:9050)` };
  return { proxy: { host: m[1]!.replace(/^\[|\]$/g, ""), port } };
}
