/**
 * Gateway-Rolle (Schritt 7.4b2): KI über Funk.
 *
 * Wer kein Internet hat, funkt seinen versiegelten KI-Auftrag an diesen
 * Knoten. Der Knoten sieht nur Umschläge (NIP-59): Er reicht sie ins Netz und
 * funkt die Antwort zurück – aber nur an Sitzungen, die ihm ein versiegelter
 * Weiterleitungsauftrag (Kind 25030) genannt hat, und höchstens drei Umschläge
 * je Auftrag (`GatewayBuch`). Inhalt, Identität und Bezahlung sieht er nicht.
 *
 * Über Funk gilt die Sendezeit (1 % je Stunde, 7.1): Alles geht über die
 * Warteschlange mit `Sendezeitkonto`, auch Nachforderungen und Nachgesendetes
 * (7.4b1). Das Funkgerät hängt über eine TCP-Brücke am Knoten (z. B. ser2net
 * oder `socat TCP-LISTEN:4403,reuseaddr FILE:/dev/ttyUSB0,raw`): je Rahmen zwei
 * Byte Länge (Big Endian), dann der Rahmen – keine neue Abhängigkeit.
 */
import net from "node:net";
import {
  GatewayBuch, KIND_FUNK_WEITERLEITUNG, KIND_GIFT_WRAP, LORA_MTU, MeshKind, MeshPriority, MeshQueue, Reassembler, Sendegedaechtnis,
  Sendezeitkonto, WEITERLEITUNG_MAX_SECS, baueNachforderung, getTag, giftUnwrapMitSigner, leseNachforderung, oeffneWeiterleitung,
  parseFrame, pruefeMeshInhalt, type NostrEvent, type RelayFilter, type Signer,
} from "@freedomstack/protocol";

/** Weg zum Funkgerät: Rahmen senden (höchstens `LORA_MTU` Byte). */
export interface FunkStrecke {
  send(frame: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

/** Was das Gateway vom Netz braucht – der Relay-Pool des Knotens. */
export interface GatewayNetz {
  publish(ev: NostrEvent): Promise<unknown>;
  query(f: RelayFilter): Promise<NostrEvent[]>;
}

/** Rahmen mit Längenpräfix für die Brücke. */
export function mitLaenge(frame: Uint8Array): Uint8Array {
  if (frame.length === 0 || frame.length > LORA_MTU) throw new Error(`Rahmen mit ${frame.length} Byte passt nicht über Funk`);
  const out = new Uint8Array(2 + frame.length);
  out[0] = frame.length >> 8;
  out[1] = frame.length & 0xff;
  out.set(frame, 2);
  return out;
}

/**
 * Rahmen aus dem Byte-Strom der Brücke. Eine unmögliche Länge (0 oder mehr als
 * ein Funkpaket) heißt: Der Strom hat sich verschoben – ein Byte weiter
 * suchen. Was dabei falsch zusammenkommt, verwirft der Zusammenbau (die
 * Kennung ist der Hash des Inhalts).
 */
export class LaengenRahmen {
  private puffer = new Uint8Array(0);

  push(chunk: Uint8Array): Uint8Array[] {
    const neu = new Uint8Array(this.puffer.length + chunk.length);
    neu.set(this.puffer);
    neu.set(chunk, this.puffer.length);
    this.puffer = neu;
    const out: Uint8Array[] = [];
    while (this.puffer.length >= 2) {
      const n = (this.puffer[0] << 8) | this.puffer[1];
      if (n === 0 || n > LORA_MTU) {
        this.puffer = this.puffer.subarray(1);
        continue;
      }
      if (this.puffer.length < 2 + n) break;
      out.push(this.puffer.slice(2, 2 + n));
      this.puffer = this.puffer.subarray(2 + n);
    }
    return out;
  }
}

/**
 * TCP-Brücke zum Funkgerät; verbindet nach einer Trennung alle `neuMs` neu.
 * Senden ohne Verbindung wirft – der Rahmen fehlt dann und wird nachgefordert.
 */
export function funkBruecke(
  adresse: string, onFrame: (f: Uint8Array) => void, log: (z: string) => void = console.log, neuMs = 30_000,
): FunkStrecke {
  const m = /^([A-Za-z0-9.-]+|\[[0-9a-fA-F:]+\]):(\d{1,5})$/.exec(adresse);
  const port = Number(m?.[2]);
  if (!m || port < 1 || port > 65535) throw new Error("FUNK_GATEWAY: host:port erwartet");
  const host = m[1].replace(/^\[|\]$/g, "");
  let sock: net.Socket | null = null;
  let aus = false;
  let wecker: ReturnType<typeof setTimeout> | null = null;
  const verbinde = () => {
    if (aus) return;
    const leser = new LaengenRahmen();
    const s = net.connect({ host, port });
    s.on("connect", () => { sock = s; log("[funk] Brücke verbunden"); });
    s.on("data", (d: Buffer) => { for (const f of leser.push(new Uint8Array(d))) onFrame(f); });
    s.on("error", (e) => log(`[funk] Brücke: ${e.name}`));
    s.on("close", () => {
      if (sock === s) sock = null;
      if (!aus) wecker = setTimeout(verbinde, neuMs);
    });
  };
  verbinde();
  return {
    send: (frame) => new Promise((ok, fehler) => {
      if (!sock) return fehler(new Error("Funkbrücke getrennt"));
      sock.write(mitLaenge(frame), (e) => (e ? fehler(e) : ok()));
    }),
    close: async () => {
      aus = true;
      if (wecker) clearTimeout(wecker);
      const s = sock;
      sock = null;
      s?.destroy();
    },
  };
}

export interface GatewayOptionen {
  strecke: FunkStrecke;
  /** Schlüssel des Knotens – an ihn sind Weiterleitungsaufträge versiegelt. */
  gateway: Signer;
  netz: GatewayNetz;
  konto?: Sendezeitkonto;
  bytesProSek?: number;
  /** Uhr in Sekunden und Warten – für Tests austauschbar. */
  jetzt?: () => number;
  schlafe?: (ms: number) => Promise<void>;
  log?: (zeile: string) => void;
}

export class GatewayRolle {
  private queue = new MeshQueue();
  private sammler = new Reassembler();
  private gedaechtnis = new Sendegedaechtnis();
  private buch = new GatewayBuch();
  private imNetz = new Set<string>();
  private laeuft: Promise<void> | null = null;
  private takte: ReturnType<typeof setInterval>[] = [];
  private gestoppt = false;
  private readonly konto: Sendezeitkonto;
  private readonly bytesProSek: number;
  private readonly jetzt: () => number;
  private readonly schlafe: (ms: number) => Promise<void>;
  private readonly log: (zeile: string) => void;

  constructor(private o: GatewayOptionen) {
    this.konto = o.konto ?? new Sendezeitkonto();
    this.bytesProSek = o.bytesProSek ?? 200;
    this.jetzt = o.jetzt ?? (() => Math.floor(Date.now() / 1000));
    this.schlafe = o.schlafe ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.log = o.log ?? ((z) => console.log(z));
  }

  /** Post holen alle `postMs`, Lücken prüfen alle `lueckenMs`. */
  starte(postMs = 5000, lueckenMs = 10_000): void {
    const melde = (e: unknown) => this.log(`[funk] ${(e as Error).name}`);
    this.takte.push(
      setInterval(() => void this.holePost().catch(melde), postMs),
      setInterval(() => { try { this.fordereNach(); } catch (e) { melde(e); } }, lueckenMs),
    );
  }

  async stoppe(): Promise<void> {
    this.gestoppt = true;
    for (const t of this.takte) clearInterval(t);
    this.takte = [];
    await this.o.strecke.close();
  }

  /** Rahmen vom Funkgerät. */
  async empfange(raw: Uint8Array): Promise<void> {
    const now = this.jetzt();
    const st = this.sammler.add(raw, now);
    if (!st?.complete || !st.payload) return;
    const pr = pruefeMeshInhalt(st.payload, st.kind);
    if (!pr.ok) return this.log(`[funk] verworfen (${pr.fall})`);
    if (pr.art === "nachforderung") return this.beantworte(st.payload, st.priority, now);
    // Bestand und Solana-Transaktionen sind nicht Sache des Gateways
    if (pr.art !== "umschlag") return;
    const ev = JSON.parse(new TextDecoder().decode(st.payload)) as NostrEvent;
    if (getTag(ev, "p") === this.o.gateway.publicKey()) {
      // Weiterleitungsauftrag: nur fürs Buch, nie ins Netz
      const w = await oeffneWeiterleitung(ev, this.o.gateway, now);
      if (w) {
        this.log(this.buch.merke(w, now) ? "[funk] Sitzung gemerkt" : "[funk] Buch voll – nichts zurück");
        return;
      }
      // Auch ein ungültiger (abgelaufen, fremd signiert) bleibt hier. Anderes an
      // diesen Schlüssel – ein Auftrag an den Provider auf demselben Knoten – geht ins Netz.
      const r = await giftUnwrapMitSigner(ev, this.o.gateway);
      if (!r.ok || r.inner?.kind === KIND_FUNK_WEITERLEITUNG) return this.log("[funk] Weiterleitung ungültig");
    }
    if (this.imNetz.has(ev.id)) return;
    this.imNetz.add(ev.id);
    if (this.imNetz.size > 1000) this.imNetz.delete(this.imNetz.values().next().value!);
    try {
      await this.o.netz.publish(ev);
    } catch (e) {
      // Später noch einmal möglich, wenn der Umschlag erneut kommt
      this.imNetz.delete(ev.id);
      this.log(`[funk] Netz: ${(e as Error).name}`);
    }
  }

  /** Post für gemerkte Sitzungen holen und zurückfunken; Zahl der eingereihten Umschläge. */
  async holePost(): Promise<number> {
    const now = this.jetzt();
    const offene = this.buch.offene(now);
    if (offene.length === 0) return 0;
    const post = await this.o.netz.query({ kinds: [KIND_GIFT_WRAP], "#p": offene, since: now - WEITERLEITUNG_MAX_SECS - 600 }).catch(() => []);
    let n = 0;
    for (const ev of post.sort((a, b) => a.created_at - b.created_at)) {
      const bytes = new TextEncoder().encode(JSON.stringify(ev));
      if (!pruefeMeshInhalt(bytes, MeshKind.NostrEvent, { eigeneSchluessel: [this.o.gateway.publicKey()] }).ok) continue;
      if (!this.buch.zurueck(ev, now)) continue;
      this.reiheEin(bytes, MeshPriority.Nachricht, now);
      n++;
    }
    return n;
  }

  /** Lücken in empfangenen Aufträgen nachfordern (7.4b1); Zahl der Nachforderungen. */
  fordereNach(): number {
    const now = this.jetzt();
    const faellig = this.sammler.faelligeNachforderungen(now);
    for (const f of faellig) this.reiheEin(baueNachforderung(f.msgId, f.fehlend), f.priority, now, false);
    return faellig.length;
  }

  /** Sendet die Warteschlange im Takt der Funkstrecke und in der Sendezeit ab; wartet, bis sie leer ist. */
  pump(): Promise<void> {
    if (!this.laeuft) {
      this.laeuft = this.sende().finally(() => {
        this.laeuft = null;
        if (!this.gestoppt && this.queue.pending.some((m) => m.framesLeft > 0)) void this.pump();
      });
    }
    return this.laeuft;
  }

  private beantworte(payload: Uint8Array, priority: MeshPriority, now: number): void {
    const n = leseNachforderung(payload);
    const frames = n ? this.gedaechtnis.nachsenden(n, now) : [];
    if (frames.length === 0) return;
    this.queue.enqueueFrames(frames, n!.msgId, priority, "nachgesendet", now);
    void this.pump();
  }

  private reiheEin(bytes: Uint8Array, priority: MeshPriority, now: number, merken = true): void {
    const m = this.queue.enqueue(bytes, MeshKind.NostrEvent, priority, "funk", now);
    if (merken) this.gedaechtnis.merke(m.msgId, m.frames, now);
    void this.pump();
  }

  private async sende(): Promise<void> {
    while (!this.gestoppt && this.queue.pending.some((m) => m.framesLeft > 0)) {
      const warte = this.konto.wartezeit(LORA_MTU / this.bytesProSek, this.jetzt());
      if (warte > 0) {
        await this.schlafe(Math.min(warte, 60) * 1000);
        continue;
      }
      const next = this.queue.next();
      if (!next) break;
      try {
        await this.o.strecke.send(next.frame);
      } catch (e) {
        // Brücke getrennt: Rahmen zurück in die Warteschlange, später weiter
        this.log(`[funk] Senden: ${(e as Error).name}`);
        this.queue.enqueueFrames([next.frame], next.msgId, parseFrame(next.frame).priority, "funk", this.jetzt());
        await this.schlafe(30_000);
        continue;
      }
      this.konto.buche(next.frame.length / this.bytesProSek, this.jetzt());
      // Takt einhalten: Ein zugeschüttetes Funkgerät verwirft still
      await this.schlafe((next.frame.length / this.bytesProSek) * 1000);
    }
  }
}
