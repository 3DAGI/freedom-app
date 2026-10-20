/**
 * Tunnel zum TURN des Knotens für den Bildstrom (VKg2a1, Entscheidung VKg-W2 vom 18.10.2026,
 * `docs/VIBECODEN-ENTWURF.md` VKg2).
 *
 * Die Sandbox bleibt ohne Netz (VK4). Den Bildstrom schickt webrtcbin darin nur über den TURN des Knotens (B-13); den
 * erreicht es über einen Unix-Socket in einem Ordner, den der Knoten anlegt und nur dieser Sandbox gibt –
 * `freedom_motor.py` reicht `127.0.0.1:<port>` in der Sandbox dorthin. Der Knoten verbindet über TCP (bei `turns:` über
 * TLS) und liest mit, was aus der Sandbox kommt:
 * - nur STUN-Anfragen und -Hinweise, die ein Client für eine UDP-Allokation braucht (Binding, Allocate mit UDP,
 *   Refresh, CreatePermission, ChannelBind, Send), dazu ChannelData – nie TCP-Allokationen (Connect, RFC 6062);
 * - Erlaubnisse, Kanäle und Send nur zu den Adressen, die die App im Angebot als Relay-Kandidaten nennt.
 * Ein Zugang zum TURN ist sonst ein Weg ins ganze Internet (UDP) – auch für den Code des Projekts, der in derselben
 * Sandbox läuft und den Zugang lesen kann. Was nicht passt, schließt die Verbindung; zur Sandbox geht alles unverändert.
 * Ins Log nur Zahlen – die Adressen der App sind Inhalt.
 */
import { chmodSync } from "node:fs";
import { BlockList, connect, createServer, isIPv4, isIPv6, type Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { istRelayKandidat, istTurnUrl } from "@freedomstack/protocol";

export const TUNNEL_GRENZEN = {
  /** Verbindungen zum TURN je Tunnel (eine je ICE-Komponente; mit Bündelung eine). */
  verbindungen: 4,
  /** Relay-Adressen der App, die der Tunnel erlaubt. */
  adressen: 8,
} as const;

export interface TurnZiel {
  host: string;
  port: number;
  tls: boolean;
}

/**
 * Wohin der Knoten den Tunnel verbindet: `intern` (`TURN_INTERN`, `host:port` – etwa `127.0.0.1:3478`, wenn coturn auf
 * demselben Rechner läuft und der öffentliche Name von innen nicht erreichbar ist), sonst die erste Adresse aus
 * `TURN_URLS`, die TCP spricht – `?transport=tcp`, dann `turns:` (TLS), dann ohne Angabe (coturn lauscht auf demselben
 * Port auch über TCP). Ungültiges → null.
 */
export function turnZiel(urls: readonly string[], intern?: string): TurnZiel | null {
  if (intern !== undefined && intern !== "") {
    const m = intern.match(/^([A-Za-z0-9.-]{1,190}|\[[0-9a-fA-F:]{2,39}\]):(\d{1,5})$/);
    const port = m ? Number(m[2]) : 0;
    return m && port >= 1 && port <= 65_535 ? { host: m[1]!.replace(/^\[|\]$/g, ""), port, tls: false } : null;
  }
  const gueltig = urls.filter(istTurnUrl).map((u) => {
    const m = u.match(/^(turns?):([^:?]+)(?::(\d+))?(?:\?transport=(udp|tcp))?$/)!;
    const tls = m[1] === "turns";
    return { ziel: { host: m[2]!, port: m[3] ? Number(m[3]) : tls ? 5349 : 3478, tls }, rang: m[4] === "tcp" ? 0 : tls ? 1 : m[4] ? 3 : 2 };
  }).filter((z) => z.ziel.port >= 1 && z.ziel.port <= 65_535);
  gueltig.sort((a, b) => a.rang - b.rang);
  return gueltig[0]?.ziel ?? null;
}

/** Die Adressen der Relay-Kandidaten im Angebot der App (höchstens `TUNNEL_GRENZEN.adressen`, ohne Doppelte). */
export function relayAdressen(sdp: string): string[] {
  const aus = new Set<string>();
  for (const z of sdp.split(/\r?\n/)) {
    if (!z.startsWith("a=candidate:") || !istRelayKandidat(z.slice(2))) continue;
    const ip = z.split(" ")[4]!;
    if (isIPv4(ip) || isIPv6(ip)) aus.add(ip);
  }
  return [...aus].slice(0, TUNNEL_GRENZEN.adressen);
}

const COOKIE = 0x2112a442;
const XOR_PEER_ADDRESS = 0x0012;
const REQUESTED_TRANSPORT = 0x0019;
const UDP = 17;
/** Methoden und ihre erlaubten Klassen (0 Anfrage, 1 Hinweis) – alles andere schließt den Tunnel. */
const ERLAUBT = new Map<number, readonly number[]>([
  [0x001, [0, 1]], // Binding (Anfrage, Keepalive)
  [0x003, [0]], // Allocate
  [0x004, [0]], // Refresh
  [0x006, [1]], // Send
  [0x008, [0]], // CreatePermission
  [0x009, [0]], // ChannelBind
]);
/** Diese Methoden brauchen mindestens eine Gegenstelle (XOR-PEER-ADDRESS). */
const MIT_GEGENSTELLE = new Set([0x006, 0x008, 0x009]);

const auf4 = (n: number) => (n + 3) & ~3;

/** Die Gegenstelle aus XOR-PEER-ADDRESS (RFC 8489 14.2) – sonst null. */
function gegenstelle(wert: Buffer, kennung: Buffer): { ip: string; art: "ipv4" | "ipv6" } | null {
  if (wert.length === 8 && wert[1] === 1) {
    const ip = [0, 1, 2, 3].map((i) => wert[4 + i]! ^ ((COOKIE >>> (24 - 8 * i)) & 0xff)).join(".");
    return { ip, art: "ipv4" };
  }
  if (wert.length === 20 && wert[1] === 2) {
    const maske = Buffer.concat([Buffer.from([0x21, 0x12, 0xa4, 0x42]), kennung]);
    const b = Buffer.from(wert.subarray(4, 20).map((x, i) => x ^ maske[i]!));
    const gruppen = Array.from({ length: 8 }, (_, i) => b.readUInt16BE(2 * i).toString(16));
    return { ip: gruppen.join(":"), art: "ipv6" };
  }
  return null;
}

/**
 * Liest den Strom aus der Sandbox (TURN über TCP, RFC 8656 Abschnitt 12.5: STUN-Nachrichten und ChannelData, auf vier
 * Byte aufgefüllt) und gibt nur vollständige, erlaubte Nachrichten weiter. ChannelData mit jeder Nummer ab 0x4000 – coturn
 * vergibt sie wie RFC 5766 bis 0x7FFF; welche Kanäle gebunden sind, prüft der TURN. `nimm()` liefert, was zum TURN darf, oder
 * null – dann ist der Tunnel zu.
 */
export class TurnFilter {
  private rest: Buffer = Buffer.alloc(0);
  private readonly liste = new BlockList();
  private kaputt = false;

  constructor(erlaubt: readonly string[]) {
    for (const ip of erlaubt) {
      if (isIPv4(ip)) this.liste.addAddress(ip, "ipv4");
      else if (isIPv6(ip)) this.liste.addAddress(ip, "ipv6");
    }
  }

  nimm(daten: Buffer): Buffer | null {
    if (this.kaputt) return null;
    this.rest = this.rest.length === 0 ? daten : Buffer.concat([this.rest, daten]);
    const raus: Buffer[] = [];
    while (this.rest.length >= 4) {
      const kopf = this.rest[0]! >> 6;
      const laenge = this.rest.readUInt16BE(2);
      // was schon am Kopf falsch ist, gleich ablehnen – nicht erst auf die angekündigte Länge warten
      if (kopf === 0 ? laenge % 4 !== 0 || (this.rest.length >= 8 && this.rest.readUInt32BE(4) !== COOKIE) : kopf !== 1) return this.zu();
      const gesamt = kopf === 0 ? 20 + laenge : 4 + auf4(laenge);
      if (this.rest.length < gesamt) break;
      const nachricht = this.rest.subarray(0, gesamt);
      if (kopf === 0 && !this.stunErlaubt(nachricht)) return this.zu();
      raus.push(nachricht);
      this.rest = this.rest.subarray(gesamt);
    }
    if (this.rest.length > 0) this.rest = Buffer.from(this.rest);
    return raus.length === 1 ? Buffer.from(raus[0]!) : Buffer.concat(raus);
  }

  private zu(): null {
    this.kaputt = true;
    this.rest = Buffer.alloc(0);
    return null;
  }

  private stunErlaubt(n: Buffer): boolean {
    if (n.length < 20 || n.readUInt16BE(2) % 4 !== 0 || n.readUInt32BE(4) !== COOKIE) return false;
    const typ = n.readUInt16BE(0);
    const methode = (typ & 0x000f) | ((typ & 0x00e0) >> 1) | ((typ & 0x3e00) >> 2);
    const klasse = ((typ >> 4) & 1) | ((typ >> 7) & 2);
    if (!ERLAUBT.get(methode)?.includes(klasse)) return false;
    const kennung = n.subarray(8, 20);
    let gegenstellen = 0;
    let udp = false;
    for (let o = 20; o < n.length;) {
      if (o + 4 > n.length) return false;
      const art = n.readUInt16BE(o);
      const l = n.readUInt16BE(o + 2);
      if (o + 4 + l > n.length) return false;
      const wert = n.subarray(o + 4, o + 4 + l);
      if (art === XOR_PEER_ADDRESS) {
        const g = gegenstelle(wert, kennung);
        if (!g || !this.liste.check(g.ip, g.art)) return false;
        gegenstellen++;
      } else if (art === REQUESTED_TRANSPORT) udp = l === 4 && wert[0] === UDP;
      o += 4 + auf4(l);
    }
    if (MIT_GEGENSTELLE.has(methode) ? gegenstellen === 0 : gegenstellen > 0) return false;
    return methode !== 0x003 || udp;
  }
}

export interface TurnTunnel {
  /** Verbindungen, die der Filter geschlossen hat. */
  readonly verstoesse: number;
  schliesse(): Promise<void>;
}

/** Zum TURN verbinden – über TLS nur mit geprüftem Zertifikat. */
function verbindeZiel(z: TurnZiel): Socket {
  return z.tls ? tlsConnect({ host: z.host, port: z.port, servername: z.host }) : connect({ host: z.host, port: z.port });
}

/**
 * Den Tunnel am Socket `sockel` öffnen (0600). Je Verbindung aus der Sandbox eine zum TURN, höchstens
 * `TUNNEL_GRENZEN.verbindungen`; was der Filter nicht durchlässt, schließt beide Seiten.
 */
export async function oeffneTurnTunnel(o: {
  sockel: string; ziel: TurnZiel; erlaubt: readonly string[]; verbinde?: (z: TurnZiel) => Socket;
}): Promise<TurnTunnel> {
  if (o.erlaubt.length === 0 || o.erlaubt.length > TUNNEL_GRENZEN.adressen) throw new Error("Tunnel ohne erlaubte Adressen");
  const offen = new Set<Socket>();
  let kunden = 0;
  let verstoesse = 0;
  const server = createServer((kunde) => {
    if (kunden >= TUNNEL_GRENZEN.verbindungen) return kunde.destroy();
    kunden++;
    kunde.once("close", () => kunden--);
    const ziel = (o.verbinde ?? verbindeZiel)(o.ziel);
    const filter = new TurnFilter(o.erlaubt);
    const ende = () => { kunde.destroy(); ziel.destroy(); };
    for (const s of [kunde, ziel]) {
      offen.add(s);
      s.on("close", () => { offen.delete(s); ende(); });
      s.on("error", ende);
    }
    kunde.on("data", (d: Buffer) => {
      const raus = filter.nimm(d);
      if (raus === null) {
        verstoesse++;
        return ende();
      }
      if (raus.length > 0 && !ziel.write(raus)) {
        kunde.pause();
        ziel.once("drain", () => kunde.resume());
      }
    });
    ziel.pipe(kunde);
  });
  await new Promise<void>((fertig, scheitern) => {
    server.once("error", scheitern);
    server.listen(o.sockel, () => fertig());
  });
  chmodSync(o.sockel, 0o600);
  return {
    get verstoesse() { return verstoesse; },
    schliesse: () => new Promise<void>((fertig) => {
      for (const s of offen) s.destroy();
      server.close(() => fertig());
    }),
  };
}
