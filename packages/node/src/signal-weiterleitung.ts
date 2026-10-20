/**
 * Signalverbindung zum Gruppenanruf weiterreichen (Sammlung B-34e, Entscheidung LK5 A, `docs/PROTOCOL.md` 41):
 * `livekit-client` verbindet sich für die Signalisierung per WebSocket mit dem SFU – ohne diesen Weg sähe der Knoten der
 * anrufenden Person die IP-Adresse jedes Teilnehmenden. Hier öffnet der eigene Knoten die Verbindung zum SFU (über Tor,
 * wenn er Tor nutzt) und reicht die Rahmen unverändert durch. Bild und Ton gehen weiter über den eigenen TURN (B-34c2).
 *
 * Nur für den Besitzer: Ein Zeichen gibt es nur über eine versiegelte Anfrage mit Nachweis (5082, `dvm-provider.ts`),
 * es gilt nur für das genannte Ziel (`wss://`, ohne Tor keine private Adresse – `pruefeZiel`) und nur bis zum Ablauf.
 * Weitergereicht wird nur der Pfad `/rtc` bzw. `/rtc/v1` samt Anfrage – keine Kopfzeilen des Browsers (Herkunft,
 * Cookies, Browserkennung). Zeichen liegen nur im Speicher; nach einem Neustart fragt die App neu. Die Anfrage trägt den
 * Zugang zum Anruf (`access_token`): Adressen nie ins Log.
 */
import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type ClientOptions, type RawData } from "ws";
import { SIGNAL_GRENZEN, SIGNAL_PFAD, leseSignalPfad, type SignalZugang } from "@freedomstack/protocol";

/** Grenzen der Weiterleitung – der Besitzer braucht selten mehr als einen Anruf zugleich. */
export const SIGNAL_WEITER = {
  /** Zeichen zugleich; ein neues verdrängt das älteste ohne offene Verbindung. */
  zeichen: 16,
  /** Verbindungen zugleich, insgesamt und je Zeichen (eine Neuverbindung überlappt kurz die alte). */
  verbindungen: 8,
  jeZeichen: 2,
  /** Größte Nachricht in beide Richtungen; Signalnachrichten (SDP) sind weit kleiner. */
  nachrichtBytes: 1 << 20,
  /** Gepuffert und nicht abgeholt – darüber schließt die Weiterleitung beide Seiten. */
  pufferBytes: 4 << 20,
  /** So lange darf der Aufbau zum SFU dauern (über Tor langsamer). */
  aufbauMs: 30_000,
} as const;

/** Wie die Weiterleitung den SFU erreicht – `main.ts` gibt mit Tor `torWsVerbindung()`, sonst `direktVerbinden`. */
export type SignalVerbinde = (url: string, o: ClientOptions) => WebSocket;

/** Ohne Tor: direkt (die Adresse prüft vorher `pruefeZiel`). */
export const direktVerbinden: SignalVerbinde = (url, o) => new WebSocket(url, o);

export interface SignalWeiterleitungOptionen {
  verbinde: SignalVerbinde;
  /** Darf der Knoten dieses Ziel erreichen? Ohne Tor nur öffentliche Adressen (`checkUrlSafe()`). */
  pruefeZiel: (ziel: string) => Promise<boolean>;
  /** Unix-Sekunden (Tests). */
  jetzt?: () => number;
}

/** Eine offene Verbindung zum SFU samt dem, was vor dem Browser ankam. */
interface Offen {
  ws: WebSocket;
  frueh: Array<[RawData, boolean]>;
  fruehBytes: number;
  merke: (d: RawData, binaer: boolean) => void;
}

interface Eintrag {
  ziel: string;
  bis: number;
  offen: number;
}

/** Feste Antworten auf eine abgelehnte Verbindung – nie Text vom SFU. */
const STATUS: Record<number, string> = { 403: "Forbidden", 404: "Not Found", 502: "Bad Gateway", 503: "Service Unavailable" };

export class SignalWeiterleitung {
  private readonly zeichen = new Map<string, Eintrag>();
  private readonly verbindungen = new Set<{ schliesse: () => void }>();
  private offen = 0;
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: SIGNAL_WEITER.nachrichtBytes });
  private readonly jetzt: () => number;

  constructor(private readonly o: SignalWeiterleitungOptionen) {
    this.jetzt = o.jetzt ?? (() => Math.floor(Date.now() / 1000));
  }

  /**
   * Ein Zeichen für ein Ziel – nur für den Besitzer (5082). Es gilt bis zum genannten Ablauf, höchstens einen Tag;
   * liegt der schon zurück, gibt es keines (`null`).
   */
  vergib(ziel: string, bis: number): SignalZugang | null {
    const jetzt = this.jetzt();
    const ende = Math.min(bis, jetzt + SIGNAL_GRENZEN.hoechstensSek);
    if (ende <= jetzt) return null;
    for (const [z, e] of this.zeichen) if (e.bis <= jetzt && e.offen === 0) this.zeichen.delete(z);
    while (this.zeichen.size >= SIGNAL_WEITER.zeichen) {
      const alt = [...this.zeichen].find(([, e]) => e.offen === 0)?.[0] ?? this.zeichen.keys().next().value!;
      this.zeichen.delete(alt);
    }
    const zeichen = randomBytes(32).toString("hex");
    this.zeichen.set(zeichen, { ziel, bis: ende, offen: 0 });
    return { zeichen, bis: ende };
  }

  /** Gehört diese Verbindung zur Weiterleitung? Dann übernimmt `weiter()` sie ganz – sonst ist sie Nostr. */
  istSignal(req: IncomingMessage): boolean {
    return (req.url ?? "").startsWith(SIGNAL_PFAD);
  }

  /** Wie viele Verbindungen gerade weitergereicht werden (Tests, Status). */
  get offeneVerbindungen(): number {
    return this.offen;
  }

  /**
   * Eine Verbindung aus dem Relay (`upgrade` auf `/signal/…`): Zeichen prüfen, Ziel prüfen, zum SFU verbinden – erst
   * dann den Browser annehmen und die Rahmen in beide Richtungen durchreichen. Was nicht passt, endet mit einem festen
   * HTTP-Status.
   */
  async weiter(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    socket.on("error", () => socket.destroy());
    const ablehnen = (status: number): void => {
      if (!socket.destroyed) socket.end(`HTTP/1.1 ${status} ${STATUS[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    };
    const p = leseSignalPfad(req.url ?? "");
    const e = p ? this.zeichen.get(p.zeichen) : undefined;
    if (!p || !e || e.bis <= this.jetzt()) return ablehnen(404);
    if (this.offen >= SIGNAL_WEITER.verbindungen || e.offen >= SIGNAL_WEITER.jeZeichen) return ablehnen(503);
    e.offen++;
    this.offen++;
    let frei = false;
    const gibFrei = (): void => {
      if (frei) return;
      frei = true;
      e.offen--;
      this.offen--;
    };
    let sfu: Offen;
    try {
      if (!(await this.o.pruefeZiel(e.ziel))) {
        gibFrei();
        return ablehnen(403);
      }
      sfu = await this.oeffne(`${e.ziel}${p.pfad}${p.anfrage}`);
    } catch {
      gibFrei();
      return ablehnen(502);
    }
    if (socket.destroyed) {
      sfu.ws.terminate();
      gibFrei();
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (browser) => this.verbinde(browser, sfu, e.bis, gibFrei));
  }

  /** Alle weitergereichten Verbindungen schließen (Ende des Relays). */
  stop(): void {
    for (const v of [...this.verbindungen]) v.schliesse();
    this.wss.close();
  }

  /**
   * Zum SFU verbinden. Was er gleich nach dem Öffnen schickt (die Antwort auf den Beitritt), kann vor dem Browser
   * ankommen – es wird bis `verbinde()` aufgehoben, begrenzt wie der Puffer.
   */
  private oeffne(url: string): Promise<Offen> {
    return new Promise((ok, fehler) => {
      const ws = this.o.verbinde(url, { maxPayload: SIGNAL_WEITER.nachrichtBytes, handshakeTimeout: SIGNAL_WEITER.aufbauMs, followRedirects: false });
      const offen: Offen = { ws, frueh: [], fruehBytes: 0, merke: () => {} };
      offen.merke = (d: RawData, binaer: boolean) => {
        offen.fruehBytes += Buffer.isBuffer(d) ? d.length : Array.isArray(d) ? d.reduce((n, b) => n + b.length, 0) : d.byteLength;
        if (offen.fruehBytes > SIGNAL_WEITER.pufferBytes) return ws.terminate();
        offen.frueh.push([d, binaer]);
      };
      ws.on("message", offen.merke);
      const uhr = setTimeout(() => {
        ws.terminate();
        fehler(new Error("Zeit abgelaufen"));
      }, SIGNAL_WEITER.aufbauMs);
      ws.once("open", () => {
        clearTimeout(uhr);
        ok(offen);
      });
      // Eine Antwort ohne Wechsel (etwa 401): nichts davon an den Browser
      ws.once("unexpected-response", (_req, res) => {
        clearTimeout(uhr);
        res.resume();
        ws.terminate();
        fehler(new Error("keine WebSocket-Antwort"));
      });
      ws.on("error", (err) => {
        clearTimeout(uhr);
        fehler(err);
      });
    });
  }

  private verbinde(browser: WebSocket, offen: Offen, bis: number, gibFrei: () => void): void {
    const sfu = offen.ws;
    let zu = false;
    const v = {
      schliesse: (code = 1000): void => {
        if (zu) return;
        zu = true;
        clearTimeout(ablauf);
        this.verbindungen.delete(v);
        gibFrei();
        for (const ws of [browser, sfu]) {
          if (ws.readyState === WebSocket.OPEN) ws.close(code);
          else ws.terminate();
        }
      },
    };
    this.verbindungen.add(v);
    // Das Zeichen gilt bis zum Ablauf – danach endet auch die Verbindung
    const ablauf = setTimeout(() => v.schliesse(), Math.max(0, bis - this.jetzt()) * 1000);
    ablauf.unref();
    // Nur gültige Codes weiter (1005/1006 dürfen nicht gesendet werden)
    const weiterCode = (c: number): number => (c === 1000 || (c >= 3000 && c < 5000) ? c : 1000);
    const reiche = (von: WebSocket, an: WebSocket): void => {
      von.on("message", (d: RawData, binaer: boolean) => {
        if (an.readyState !== WebSocket.OPEN) return;
        if (an.bufferedAmount > SIGNAL_WEITER.pufferBytes) return v.schliesse(1011);
        an.send(d, { binary: binaer });
      });
      von.on("close", (code: number) => v.schliesse(weiterCode(code)));
      von.on("error", () => v.schliesse(1011));
    };
    sfu.off("message", offen.merke);
    for (const [d, binaer] of offen.frueh) browser.send(d, { binary: binaer });
    offen.frueh.length = 0;
    reiche(browser, sfu);
    reiche(sfu, browser);
    if (sfu.readyState !== WebSocket.OPEN) v.schliesse();
  }
}
