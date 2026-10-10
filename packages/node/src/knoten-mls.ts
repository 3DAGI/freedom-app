/**
 * Agent auf dem Knoten in privaten Räumen (11.3d2a, Entwurf `docs/AGENTEN-RAUM-ENTWURF.md`
 * P2, P4; MENSCH 10.10.2026: Schalter `besitzer|alle`, Stand verschlüsselt, Chat nur im Speicher).
 *
 * - Ein eigenes MLS-Konto mit dem Schlüssel des Agenten – nie dem des Knotens.
 * - Einladen lässt er sich nur mit `AGENT_PRIVAT`: `besitzer` nur von `AGENT_BESITZER`,
 *   `alle` von jedem; höchstens `KNOTEN_MLS_GRENZEN.gruppen` Gruppen.
 * - Auf der Platte nur verschlüsselt (AES-256-GCM wie `MlsZustand` in der App, Schlüssel in
 *   eigener Datei, alles 0600): der MLS-Zustand und der Raumstand – Definition, Rollen,
 *   Zuweisungen, Karten, Agentenlisten. Chat-Nachrichten hält der Knoten nur im Speicher, je
 *   Gruppe die letzten `KNOTEN_MLS_GRENZEN.chat` – nie in eine eigene Datei, nie ins Log. Die
 *   Engine (MDK) behält Verarbeitetes wie bei jedem Mitglied in ihrem Zustand und stellt es nach
 *   einem Neustart erneut zu, wenn die Relays die Nachricht noch haben.
 * - Relays der Gruppe: eigene über den Pool des Knotens; fremde nur `wss://`, plausibel und
 *   geprüft (`pruefeRelay`), höchstens `KNOTEN_MLS_GRENZEN.relays`, über `neuesRelay` aus
 *   `main.ts` (über Tor wie alle Verbindungen des Knotens).
 * - Nach dem Beitritt sendet der Agent seine Karte als inneres Event (Leak-Regel
 *   `agent-raum-privat`) und ein neues KeyPackage. Antworten kommen mit 11.3d2b.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  KIND_AGENTEN_LISTE, KIND_AGENT_KARTE, KIND_GIFT_WRAP, KIND_ROLE_GRANT, KIND_SPACE, KIND_SPACE_ROLES, LocalSigner, OutboxPool,
  buildDmRelayList, buildRelayList, giftUnwrapMitSigner, isPlausibleRelayUrl, normalizeRelayUrl, raumAgentKarte, signEvent, signiereId,
  type AgentKarteDaten, type InneresEvent, type InneresSenden, type NostrEvent, type Relay, type RelayFilter,
} from "@freedomstack/protocol";
import { KIND_GRUPPENNACHRICHT, Mls, ladeMls, type MlsNachricht, type MlsSenden } from "@freedomstack/mls";

export const KNOTEN_MLS_GRENZEN = Object.freeze({ gruppen: 20, chat: 50, stand: 300, relays: 10, gesehen: 5000 });
/** Einladung nach Marmot (Kern eines Umschlags). */
const KIND_WELCOME = 444;
/** Was als Raumstand verschlüsselt auf die Platte darf – alles andere bleibt im Speicher. */
const STRUKTUR = new Set([KIND_SPACE, KIND_SPACE_ROLES, KIND_ROLE_GRANT, KIND_AGENT_KARTE, KIND_AGENTEN_LISTE]);
const HEX64 = /^[0-9a-f]{64}$/;
const IV = 12, TAG = 16;
/** Umschläge sind bis zu zwei Tage zurückdatiert (NIP-59). */
const UMSCHLAG_SPIELRAUM_SEK = 3 * 86_400;

let engine = false;
/** Die Engine aus `@freedomstack/mls` laden – einmal je Prozess. */
export function ladeMlsImKnoten(): void {
  if (engine) return;
  ladeMls(gunzipSync(readFileSync(createRequire(import.meta.url).resolve("@freedomstack/mls/wasm"))));
  engine = true;
}

// ------------------------------------------------------------ Ablage

/** Dateien des MLS-Kontos neben dem Schlüssel des Agenten – alle 0600. */
export class MlsAblage {
  readonly schluessel: Buffer;
  /** d-Tag des KeyPackages – einmal zufällig, bleibt (Marmot). */
  readonly platz: string;

  constructor(private readonly ordner: string, private readonly pk: string) {
    const datei = this.datei("json");
    if (existsSync(datei)) {
      // Kaputt heißt: kein Start – nie ersetzen, sonst wären Zustand und Gruppen verloren
      const j = JSON.parse(readFileSync(datei, "utf8")) as { schluessel?: unknown; platz?: unknown };
      if (typeof j.schluessel !== "string" || !HEX64.test(j.schluessel) || typeof j.platz !== "string" || !HEX64.test(j.platz)) {
        throw new Error("agent-mls.json ist beschädigt");
      }
      this.schluessel = Buffer.from(j.schluessel, "hex");
      this.platz = j.platz;
    } else {
      this.schluessel = randomBytes(32);
      this.platz = randomBytes(32).toString("hex");
      this.schreibe(datei, JSON.stringify({ schluessel: this.schluessel.toString("hex"), platz: this.platz }));
    }
  }

  private datei(name: string): string {
    return join(this.ordner, `agent-mls.${name}`);
  }

  private schreibe(datei: string, text: string): void {
    mkdirSync(this.ordner, { recursive: true, mode: 0o700 });
    writeFileSync(`${datei}.neu`, text, { mode: 0o600 });
    renameSync(`${datei}.neu`, datei);
  }

  /** Zusatzdaten wie in der App (`freedom.mls.zustand.v1:<bindung>`): unter einem anderen Agenten öffnet sich nichts. */
  private zusatz(name: string): Buffer {
    return Buffer.from(`freedom.mls.zustand.v1:agent:${this.pk}${name === "zustand" ? "" : `:${name}`}`);
  }

  lese(name: "zustand" | "raumstand"): Buffer | undefined {
    const datei = this.datei(name);
    if (!existsSync(datei)) return undefined;
    const roh = Buffer.from(readFileSync(datei, "utf8"), "base64");
    const d = createDecipheriv("aes-256-gcm", this.schluessel, roh.subarray(0, IV));
    d.setAAD(this.zusatz(name));
    d.setAuthTag(roh.subarray(roh.length - TAG));
    return Buffer.concat([d.update(roh.subarray(IV, roh.length - TAG)), d.final()]);
  }

  speichere(name: "zustand" | "raumstand", klar: Uint8Array): void {
    const iv = randomBytes(IV);
    const c = createCipheriv("aes-256-gcm", this.schluessel, iv);
    c.setAAD(this.zusatz(name));
    const ct = Buffer.concat([c.update(klar), c.final(), c.getAuthTag()]);
    this.schreibe(this.datei(name), Buffer.concat([iv, ct]).toString("base64"));
  }
}

// ------------------------------------------------------------ Konto

export interface KnotenMlsUmgebung {
  pool: Pick<OutboxPool, "urls" | "publish" | "publishAn" | "queryAn" | "query">;
  /** Verbindung zu einem fremden Relay – in `main.ts` dieselbe wie für alle Relays (Tor). */
  neuesRelay: (url: string) => Relay;
  /** Darf der Knoten sich mit diesem fremden Relay verbinden (öffentlich, nicht im Heimnetz)? */
  pruefeRelay: (url: string) => Promise<boolean>;
  jetzt?: () => number;
}

/** Ausgang einer Einladung – fürs Log nur die Kennung. */
export type EinladungsAusgang = { gruppe: string } | { fall: string };

const alsInneres = (n: MlsNachricht): InneresEvent => ({
  id: n.inneres || n.id, von: n.von, art: n.art, tags: n.tags ?? [], text: n.text, zeit: n.zeit, ...(n.admin !== undefined ? { admin: n.admin } : {}),
});

export class KnotenMls {
  readonly pk: string;
  private kette: Promise<unknown> = Promise.resolve();
  private readonly stand = new Map<string, InneresEvent[]>();
  private readonly chat = new Map<string, InneresEvent[]>();
  private readonly gesehen = new Set<string>();
  /** Verbindungen zu fremden Relays der Gruppen – erst mit dem ersten. */
  private fremd?: OutboxPool;
  /** Eigenes Relay des Knotens, als der Agent angemeldet – sonst sähe er dort keine Umschläge an sich. */
  private posteingang?: Pick<Relay, "query">;
  private wartend = new Map<string, NodeJS.Timeout>();

  private constructor(
    private readonly mls: Mls,
    private readonly ablage: MlsAblage,
    private readonly p: {
      schluessel: { sk: Uint8Array; pk: string };
      einladen: "besitzer" | "alle";
      besitzer?: string;
      karte: AgentKarteDaten;
      umgebung: KnotenMlsUmgebung;
      /** Höchstens so viele Gruppen (Vorgabe `KNOTEN_MLS_GRENZEN.gruppen`). */
      maxGruppen?: number;
    },
  ) {
    this.pk = p.schluessel.pk;
  }

  /** Konto laden (oder anlegen) – Engine, Schlüsseldatei, Zustand und Raumstand. */
  static starte(p: KnotenMls["p"] & { ordner: string }): KnotenMls {
    ladeMlsImKnoten();
    const ablage = new MlsAblage(p.ordner, p.schluessel.pk);
    const mls = new Mls(new LocalSigner(p.schluessel.sk), (id) => signiereId(id, p.schluessel.sk), ablage.lese("zustand"));
    const k = new KnotenMls(mls, ablage, p);
    const stand = ablage.lese("raumstand");
    if (stand) for (const [g, l] of Object.entries(JSON.parse(stand.toString("utf8")) as Record<string, InneresEvent[]>)) k.stand.set(g, l);
    return k;
  }

  private jetzt(): number {
    return this.p.umgebung.jetzt?.() ?? Math.floor(Date.now() / 1000);
  }

  /** Aufrufe des Kontos nacheinander – MDK weist einen zweiten während eines laufenden ab. */
  private exklusiv<T>(f: () => Promise<T>): Promise<T> {
    const lauf = this.kette.then(f, f);
    this.kette = lauf.catch(() => undefined);
    return lauf;
  }

  /** Umschläge an den Agenten im eigenen Relay (`RelayRole.alsRelay(agent)`) – in `main.ts` nach dem Start des Relays. */
  nutzePosteingang(relay: Pick<Relay, "query">): void {
    this.posteingang = relay;
  }

  gruppen(): string[] {
    return this.mls.gruppen();
  }

  mitglieder(gruppe: string): string[] {
    return this.mls.mitglieder(gruppe);
  }

  admins(gruppe: string): string[] {
    return this.mls.admins(gruppe);
  }

  /** Was der Agent in dieser Gruppe kennt: Raumstand (verschlüsselt gemerkt) und Chat (nur im Speicher). */
  ereignisse(gruppe: string): InneresEvent[] {
    return [...(this.stand.get(gruppe) ?? []), ...(this.chat.get(gruppe) ?? [])].sort((a, b) => a.zeit - b.zeit);
  }

  private sichern(): void {
    this.ablage.speichere("zustand", this.mls.zustand());
  }

  private merke(gruppe: string, neu: InneresEvent[]): void {
    let standNeu = false;
    for (const e of neu) {
      const ziel = STRUKTUR.has(e.art) ? this.stand : this.chat;
      const l = ziel.get(gruppe) ?? [];
      if (l.some((x) => x.id === e.id)) continue;
      l.push(e);
      const max = ziel === this.stand ? KNOTEN_MLS_GRENZEN.stand : KNOTEN_MLS_GRENZEN.chat;
      if (l.length > max) l.sort((a, b) => a.zeit - b.zeit).splice(0, l.length - max);
      ziel.set(gruppe, l);
      if (ziel === this.stand) standNeu = true;
    }
    if (standNeu) this.ablage.speichere("raumstand", Buffer.from(JSON.stringify(Object.fromEntries(this.stand)), "utf8"));
  }

  /**
   * Eigene Relay-Listen (10002, 10050) und ein KeyPackage – an die Relays des Knotens. Zurück: wie
   * viele Relays der Posteingang nennt – ohne öffentliches Relay keines, dann stellt keine App eine
   * Einladung zu.
   */
  async veroeffentliche(): Promise<{ posteingang: number }> {
    const { pool } = this.p.umgebung;
    const sk = this.p.schluessel.sk;
    const posteingang = buildDmRelayList(this.pk, pool.urls, this.jetzt());
    await pool.publish(signEvent(buildRelayList(this.pk, pool.urls.map((url) => ({ url })), this.jetzt()), sk));
    await pool.publish(signEvent(posteingang, sk));
    await this.neuesKeyPackage();
    return { posteingang: posteingang.tags.length };
  }

  private async neuesKeyPackage(): Promise<void> {
    const kp = await this.exklusiv(async () => {
      const u = await this.mls.keyPackage(this.ablage.platz);
      // Erst sichern (privater Teil im Zustand), dann veröffentlichen
      this.sichern();
      return signEvent(u, this.p.schluessel.sk);
    });
    await this.p.umgebung.pool.publish(kp);
  }

  /** Relays einer Gruppe: eigene (Pool des Knotens) und zugelassene fremde (eigene Verbindungen). */
  private async verbindungen(urls: readonly string[]): Promise<{ eigene: string[]; fremde: string[] }> {
    const pool = this.p.umgebung.pool;
    const eigeneJe = new Map(pool.urls.map((u) => [normalizeRelayUrl(u), u]));
    const eigene: string[] = [], fremde: string[] = [];
    for (const roh of urls) {
      const n = normalizeRelayUrl(roh);
      const e = eigeneJe.get(n);
      if (e) {
        eigene.push(e);
        continue;
      }
      if (this.fremd?.urls.includes(n)) {
        fremde.push(n);
        continue;
      }
      if ((this.fremd?.urls.length ?? 0) >= KNOTEN_MLS_GRENZEN.relays || !n.startsWith("wss://") || !isPlausibleRelayUrl(n).ok) continue;
      if (!(await this.p.umgebung.pruefeRelay(n).catch(() => false))) continue;
      const relay = this.p.umgebung.neuesRelay(n);
      if (this.fremd) this.fremd.addRelay(relay);
      else this.fremd = new OutboxPool([relay], { minAcks: 1 });
      fremde.push(n);
    }
    return { eigene, fremde };
  }

  /**
   * Eine Einladung (Umschlag an den Agenten) annehmen – nach dem Schalter, unter der Grenze.
   * Danach: Karte in die Gruppe, neues KeyPackage (das alte ist verbraucht).
   */
  async nimmEinladung(wrap: NostrEvent): Promise<EinladungsAusgang> {
    if (wrap.kind !== KIND_GIFT_WRAP || !wrap.tags.some((t) => t[0] === "p" && t[1] === this.pk)) return { fall: "einladung-ungueltig" };
    const u = await giftUnwrapMitSigner(wrap, new LocalSigner(this.p.schluessel.sk)).catch(() => null);
    if (!u?.ok || !u.inner || u.inner.kind !== KIND_WELCOME || !u.senderPubkey) return { fall: "einladung-ungueltig" };
    if (this.p.einladen === "besitzer" && u.senderPubkey !== this.p.besitzer) return { fall: "einladung-fremd" };
    if (this.mls.gruppen().length >= (this.p.maxGruppen ?? KNOTEN_MLS_GRENZEN.gruppen)) return { fall: "gruppen-voll" };
    const gruppe = await this.exklusiv(async () => {
      const g = await this.mls.beitreten(wrap);
      this.sichern();
      return g;
    }).catch(() => null);
    if (!gruppe) return { fall: "beitritt-gescheitert" };
    const { eigene, fremde } = await this.verbindungen(this.mls.routing(gruppe).relays);
    if (eigene.length + fremde.length === 0) return { fall: "relays-ungueltig" };
    await this.neuesKeyPackage().catch(() => undefined);
    await this.sende(gruppe, raumAgentKarte(this.p.karte));
    return { gruppe };
  }

  /** Als Agent in die Gruppe schreiben (inneres Event) – eigene Nachrichten entschlüsselt MLS nicht zurück. */
  async sende(gruppe: string, s: InneresSenden): Promise<string | null> {
    const { eigene, fremde } = await this.verbindungen(this.mls.routing(gruppe).relays);
    return this.exklusiv(async () => {
      const r: MlsSenden = await this.mls.sendenEvent(gruppe, s.art, s.tags, s.text);
      this.sichern();
      const angenommen = await this.verteile(r.events, eigene, fremde);
      if (r.ausstehend) {
        if (angenommen) await this.mls.bestaetigt(r.ausstehend);
        else await this.mls.gescheitert(r.ausstehend);
        this.sichern();
      }
      if (!angenommen || !r.inneres) return null;
      this.merke(gruppe, [{ id: r.inneres, von: this.pk, art: s.art, tags: s.tags, text: s.text, zeit: this.jetzt() }]);
      return r.inneres;
    });
  }

  private async verteile(events: readonly NostrEvent[], eigene: string[], fremde: string[]): Promise<boolean> {
    let alle = true;
    for (const ev of events) {
      const a = await Promise.all([
        eigene.length ? this.p.umgebung.pool.publishAn(ev, eigene) : undefined,
        fremde.length && this.fremd ? this.fremd.publishAn(ev, fremde) : undefined,
      ]);
      if (!a.some((x) => x?.ok)) alle = false;
    }
    return alle;
  }

  /**
   * Abgleich: neue Einladungen an den Agenten, dann je Gruppe die Nachrichten in ihrer
   * Reihenfolge (auch Commits – wer einen auslässt, liest danach nichts mehr).
   * Zurück: was neu in den Verlauf kam, je Gruppe.
   */
  async abgleich(): Promise<{ einladungen: EinladungsAusgang[]; neu: Map<string, InneresEvent[]> }> {
    const pool = this.p.umgebung.pool;
    const einladungen: EinladungsAusgang[] = [];
    const fu: RelayFilter = { kinds: [KIND_GIFT_WRAP], "#p": [this.pk], since: this.jetzt() - UMSCHLAG_SPIELRAUM_SEK };
    const wraps = [
      ...(await pool.query(fu).catch(() => [])),
      ...(this.posteingang ? await this.posteingang.query(fu).catch(() => []) : []),
    ];
    for (const w of wraps.sort((a, b) => a.created_at - b.created_at)) {
      if (!this.erstmals(w.id)) continue;
      einladungen.push(await this.nimmEinladung(w));
    }
    const neu = new Map<string, InneresEvent[]>();
    for (const gruppe of this.mls.gruppen()) {
      const { h, relays } = this.mls.routing(gruppe);
      const { eigene, fremde } = await this.verbindungen(relays);
      const f: RelayFilter = { kinds: [KIND_GRUPPENNACHRICHT], "#h": [h], limit: 200 };
      const evs = [
        ...(eigene.length ? await pool.queryAn(f, eigene).catch(() => []) : []),
        ...(fremde.length && this.fremd ? await this.fremd.queryAn(f, fremde).catch(() => []) : []),
      ].sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1));
      const l: InneresEvent[] = [];
      for (const ev of evs) {
        if (!this.erstmals(ev.id)) continue;
        l.push(...(await this.empfange(gruppe, ev)));
      }
      if (l.length) neu.set(gruppe, l);
    }
    return { einladungen, neu };
  }

  private erstmals(id: string): boolean {
    if (this.gesehen.has(id)) return false;
    this.gesehen.add(id);
    if (this.gesehen.size > KNOTEN_MLS_GRENZEN.gesehen) this.gesehen.delete(this.gesehen.values().next().value!);
    return true;
  }

  /** Eine Gruppennachricht empfangen; zurückgehaltene stellt `fortschreiten()` nach der Wartezeit zu. */
  private empfange(gruppe: string, ev: NostrEvent): Promise<InneresEvent[]> {
    return this.exklusiv(async () => {
      const r = await this.mls.empfangen(ev).catch(() => null);
      if (!r) return [];
      const neu = r.nachrichten.filter((n) => n.gruppe === gruppe).map(alsInneres);
      this.merke(gruppe, neu);
      // „Ignored“ ist eine Kennung der Engine
      if (r.nachrichten.length > 0 || r.geaendert.length > 0 || r.ergebnis !== "Ignored") this.sichern();
      const w = this.mls.wartezeit(gruppe);
      if (w !== undefined && !this.wartend.has(gruppe)) {
        this.wartend.set(gruppe, setTimeout(() => void this.schreiteFort(gruppe).catch(() => undefined), w + 50));
      }
      return neu;
    });
  }

  /** Nach der Wartezeit: Zurückgehaltenes zustellen; was die Engine dabei sendet (Commit), geht an die Gruppe. */
  private async schreiteFort(gruppe: string): Promise<void> {
    this.wartend.delete(gruppe);
    const { eigene, fremde } = await this.verbindungen(this.mls.routing(gruppe).relays);
    await this.exklusiv(async () => {
      const f = await this.mls.fortschreiten(gruppe);
      this.merke(gruppe, f.nachrichten.map(alsInneres));
      this.sichern();
      if (f.events.length === 0) return;
      const angenommen = await this.verteile(f.events, eigene, fremde);
      if (f.ausstehend) {
        if (angenommen) await this.mls.bestaetigt(f.ausstehend);
        else await this.mls.gescheitert(f.ausstehend);
        this.sichern();
      }
    });
  }

  stoppe(): void {
    for (const t of this.wartend.values()) clearTimeout(t);
    this.wartend.clear();
  }
}
