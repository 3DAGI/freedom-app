/**
 * aria2c als Torrent-Client des Knotens (Schritt B-29c2b, entschieden 12.10.2026,
 * `docs/E9-ENTWURF.md`). Ein eigenes Programm neben dem Knoten – keine
 * npm-Abhängigkeit; GPL-2.0+, als getrenntes Programm ohne Folge für die EUPL.
 *
 * - Gestartet nur über `starteAria2()`: JSON-RPC nur auf 127.0.0.1, das Geheimnis
 *   je Start neu und nur in einer Datei (0600) – nie auf der Befehlszeile (dort
 *   sähe es jeder Benutzer des Rechners in `ps`), nie ins Log.
 * - Gesteuert nur über `Aria2.rufe()`: Antworten begrenzt, Fehler nur mit
 *   Kennung (`Aria2Fehler`, Code von aria2), nie mit dem Text von aria2.
 * - Geteilt wird unbegrenzt lange (`seed-ratio=0`), hochgeladen höchstens
 *   `TORRENT_HOCHLADEN_KBS`.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { leseMagnet } from "@freedomstack/protocol";
import { leseBegrenzt } from "./url-guard.js";

type Holen = (url: string, init: RequestInit) => Promise<Response>;
const fehler = (name: string, code?: number): Error => Object.assign(new Error(name), { name, ...(code !== undefined ? { code } : {}) });

export interface Aria2Status {
  gid: string;
  status: "active" | "waiting" | "paused" | "error" | "complete" | "removed";
  totalLength: string;
  completedLength: string;
  errorCode?: string;
  followedBy?: string[];
  infoHash?: string;
}
export interface Aria2Datei { index: string; path: string; length: string; completedLength: string; selected: string }

/** JSON-RPC an aria2 – nur über `rufe()`, mit Geheimnis. */
export class Aria2 {
  private id = 0;
  constructor(private o: { url: string; geheimnis: string; holen?: Holen }) {}

  async rufe<T>(methode: string, ...params: unknown[]): Promise<T> {
    const holen = this.o.holen ?? ((i, x) => fetch(i, x));
    const r = await holen(this.o.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: String(++this.id), method: `aria2.${methode}`, params: [`token:${this.o.geheimnis}`, ...params] }),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    const { text, abgeschnitten } = await leseBegrenzt(r, 1024 * 1024);
    if (abgeschnitten) throw fehler("Aria2Fehler");
    let d: { result?: T; error?: { code?: unknown } };
    try { d = JSON.parse(text); } catch { throw fehler("Aria2Fehler"); }
    if (d.error) throw fehler("Aria2Fehler", typeof d.error.code === "number" ? d.error.code : undefined);
    return d.result as T;
  }

  addUri(uris: string[], optionen: Record<string, string>): Promise<string> { return this.rufe("addUri", uris, optionen); }
  addTorrent(torrent: Buffer, optionen: Record<string, string>): Promise<string> { return this.rufe("addTorrent", torrent.toString("base64"), [], optionen); }
  status(gid: string): Promise<Aria2Status> {
    return this.rufe("tellStatus", gid, ["gid", "status", "totalLength", "completedLength", "errorCode", "followedBy", "infoHash"]);
  }
  dateien(gid: string): Promise<Aria2Datei[]> { return this.rufe("getFiles", gid); }
  aendere(gid: string, optionen: Record<string, string>): Promise<string> { return this.rufe("changeOption", gid, optionen); }
  weiter(gid: string): Promise<string> { return this.rufe("unpause", gid); }
  entferne(gid: string): Promise<string> { return this.rufe("forceRemove", gid); }
  aktive(): Promise<Aria2Status[]> { return this.rufe("tellActive", ["gid", "status", "infoHash", "totalLength", "completedLength"]); }
  wartende(): Promise<Aria2Status[]> { return this.rufe("tellWaiting", 0, 1000, ["gid", "status", "infoHash", "totalLength", "completedLength"]); }
  stoppe(): Promise<string> { return this.rufe("shutdown"); }
}

export interface Aria2Einstellung {
  /** Arbeitsordner (Konfiguration, Torrents). */
  ordner: string;
  rpcPort: number;
  /** Port für BitTorrent (TCP und DHT über UDP). */
  btPort: number;
  /** Höchstens so viel hochladen (KiB/s), 0 = ohne Grenze. */
  hochladenKbs: number;
  /** DHT an (Vorgabe) – in Tests aus. */
  dht?: boolean;
  /** Erster Teilnehmer im DHT (`host:port`), nur bis die eigene Tabelle (`dht.dat`) gefüllt ist. */
  dhtEinstieg?: string;
  /** Tracker für jeden Torrent dazu (`TORRENT_TRACKER`), geprüft wie in Magneten. */
  tracker?: string[];
  befehl?: string;
}

/** Vorgabe für den Einstieg ins DHT – ändern mit `TORRENT_DHT_EINSTIEG`. */
export const DHT_EINSTIEG = "router.bittorrent.com:6881";

/** Werte aus der Umgebung: `TORRENT=1` schaltet ein; Ports und Grenze mit Vorgaben. Ungültig → Grund. */
export function torrentAusUmgebung(env: Record<string, string | undefined>, ordner: string): { einstellung?: Aria2Einstellung; grund?: string } {
  if (env.TORRENT?.trim() !== "1") return {};
  const zahl = (s: string | undefined, vorgabe: number, min: number, max: number) => {
    if (!s?.trim()) return vorgabe;
    const n = Number(s);
    return Number.isSafeInteger(n) && n >= min && n <= max ? n : NaN;
  };
  const rpcPort = zahl(env.TORRENT_RPC_PORT, 6800, 1024, 65535);
  const btPort = zahl(env.TORRENT_PORT, 6881, 1024, 65535);
  const hochladenKbs = zahl(env.TORRENT_HOCHLADEN_KBS, 0, 0, 10_000_000);
  if ([rpcPort, btPort, hochladenKbs].some(Number.isNaN)) return { grund: "TORRENT_RPC_PORT, TORRENT_PORT oder TORRENT_HOCHLADEN_KBS ungültig" };
  if (rpcPort === btPort) return { grund: "TORRENT_RPC_PORT und TORRENT_PORT sind gleich" };
  const einstieg = env.TORRENT_DHT_EINSTIEG?.trim() || DHT_EINSTIEG;
  if (!/^[a-z0-9.-]{1,253}:\d{1,5}$/i.test(einstieg)) return { grund: "TORRENT_DHT_EINSTIEG ist kein host:port" };
  // Tracker wie in Magneten: nur öffentliche Hosts, udp/http/https/wss – ein Magnet mit genau diesen prüft `leseMagnet()`
  const roh = (env.TORRENT_TRACKER ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const tracker = leseMagnet(`magnet:?xt=urn:btih:${"0".repeat(40)}${roh.map((t) => `&tr=${encodeURIComponent(t)}`).join("")}`)?.tracker ?? [];
  if (tracker.length !== roh.length) return { grund: "TORRENT_TRACKER enthält eine ungültige oder lokale Adresse" };
  return { einstellung: { ordner, rpcPort, btPort, hochladenKbs, ...(einstieg !== DHT_EINSTIEG ? { dhtEinstieg: einstieg } : {}), ...(tracker.length ? { tracker } : {}) } };
}

/** Die Konfiguration für aria2 – das Geheimnis steht nur hier, die Datei ist 0600. */
export function aria2Konfiguration(e: Aria2Einstellung, geheimnis: string): string {
  return [
    "enable-rpc=true", "rpc-listen-all=false", `rpc-listen-port=${e.rpcPort}`, `rpc-secret=${geheimnis}`,
    `listen-port=${e.btPort}`, `dht-listen-port=${e.btPort}`, `enable-dht=${e.dht === false ? "false" : "true"}`, "enable-dht6=false",
    `dht-entry-point=${e.dhtEinstieg ?? DHT_EINSTIEG}`, `dht-file-path=${join(e.ordner, "dht.dat")}`,
    ...(e.tracker?.length ? [`bt-tracker=${e.tracker.join(",")}`] : []),
    `bt-enable-lpd=false`, "enable-peer-exchange=true", "seed-ratio=0.0", `max-overall-upload-limit=${e.hochladenKbs}K`,
    "follow-torrent=mem", "bt-save-metadata=false", "check-integrity=true", "continue=true", "file-allocation=none",
    "bt-remove-unselected-file=true", "auto-file-renaming=false", "allow-overwrite=false", "max-concurrent-downloads=4",
    "console-log-level=error", "summary-interval=0", "quiet=true",
  ].join("\n") + "\n";
}

export interface LaufendesAria2 { aria2: Aria2; prozess: ChildProcess; stoppe(): void }

/**
 * aria2c starten und warten, bis es antwortet (höchstens `fristMs`). Das
 * Geheimnis entsteht hier, steht nur in `<ordner>/aria2.conf` (0600).
 */
export async function starteAria2(e: Aria2Einstellung, fristMs = 10_000): Promise<LaufendesAria2> {
  mkdirSync(e.ordner, { recursive: true, mode: 0o700 });
  const geheimnis = randomBytes(32).toString("hex");
  const konf = join(e.ordner, "aria2.conf");
  writeFileSync(konf, aria2Konfiguration(e, geheimnis), { mode: 0o600 });
  const prozess = spawn(e.befehl ?? "aria2c", [`--conf-path=${konf}`], { stdio: "ignore" });
  const aria2 = new Aria2({ url: `http://127.0.0.1:${e.rpcPort}/jsonrpc`, geheimnis });
  const bis = Date.now() + fristMs;
  let gestartet = false;
  prozess.once("error", () => { /* fehlt aria2c, scheitert die Frage unten */ });
  while (Date.now() < bis && prozess.exitCode === null) {
    try { await aria2.rufe("getVersion"); gestartet = true; break; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  if (!gestartet) {
    prozess.kill();
    throw fehler("Aria2Startet");
  }
  return { aria2, prozess, stoppe: () => { prozess.kill(); } };
}
