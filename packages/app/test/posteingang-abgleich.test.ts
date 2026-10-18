/**
 * B-35c (NG2 A): Nach einer Pause gleicht die App den eigenen Posteingang mit dem eigenen Knoten ab – Negentropy mit
 * jedem Posteingang, geholt wird nur, was dem Knoten fehlt, und es landet auch beim Knoten.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  NegFehler, NegSpeicher, Negentropy, buildEvent, generateKeypair, signEvent, type NostrEvent, type RelayFilter,
} from "@freedomstack/protocol";
import { POSTEINGANG_ABGLEICH, abgleichSeit, gleichePosteingangAb, type AbgleichWege } from "../src/posteingang-abgleich.js";

const lies = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const ich = generateKeypair().pk, fremd = generateKeypair().pk;
const JETZT = 1_760_000_000;
const SEIT = JETZT - 3 * 24 * 3600;
let n = 0;
const umschlag = (an: string, zeit = JETZT - 3600 - n++): NostrEvent => {
  const weg = generateKeypair();
  return signEvent({ ...buildEvent(weg.pk, 1059, [["p", an]], `chiffrat ${n}`), created_at: zeit }, weg.sk);
};

/** Ein Relay im Speicher: REQ mit `ids`/`#p`/`since`, NIP-77 wie die Relay-Rolle (der Stand des Relays antwortet). */
function relay(events: NostrEvent[]) {
  const passt = (f: RelayFilter, ev: NostrEvent) =>
    (!f.ids || f.ids.includes(ev.id)) && (!f.kinds || f.kinds.includes(ev.kind)) && (f.since === undefined || ev.created_at >= f.since)
    && (!f["#p"] || ev.tags.some((t) => t[0] === "p" && f["#p"]!.includes(t[1]!)));
  return {
    events,
    fragen: [] as RelayFilter[],
    frage(f: RelayFilter) { this.fragen.push(f); return events.filter((ev) => passt(f, ev)); },
    gleicheAb(f: RelayFilter, speicher: NegSpeicher) {
      const s = new NegSpeicher();
      for (const ev of events.filter((e) => passt(f, e))) s.einfuegen(ev.created_at, ev.id);
      const server = new Negentropy(s.versiegeln()), client = new Negentropy(speicher);
      const habe: string[] = [], brauche: string[] = [];
      let msg: string | null = client.beginne();
      while (msg !== null) {
        const r = client.abgleich(server.abgleich(msg).antwort!);
        habe.push(...r.habe);
        brauche.push(...r.brauche);
        msg = r.antwort;
      }
      return { habe, brauche };
    },
  };
}

function wege(relays: Record<string, ReturnType<typeof relay> | "ohne-nip77">, abgelegt: NostrEvent[], legeOk = true): AbgleichWege {
  return {
    frage: async (f, urls) => urls.flatMap((u) => (relays[u] === "ohne-nip77" ? [] : relays[u]!.frage(f))),
    gleicheAb: async (u, f, s) => {
      const r = relays[u];
      if (r === "ohne-nip77" || !r) throw new NegFehler("neg.zeit");
      return r.gleicheAb(f, s);
    },
    lege: async (ev) => {
      if (!legeOk) throw new Error("Knoten nicht erreichbar");
      abgelegt.push(ev);
      return 1;
    },
  };
}

test("B-35c: eine Runde – nur das Fehlende geholt, beim Knoten abgelegt, Posteingang ohne NIP-77 ausgelassen", async () => {
  const gemeinsam = [umschlag(ich), umschlag(ich)];
  const nurDraussen = [umschlag(ich), umschlag(ich), umschlag(ich)];
  const nurKnoten = umschlag(ich);
  const knoten = relay([...gemeinsam, nurKnoten]);
  const draussen = relay([...gemeinsam, ...nurDraussen, umschlag(fremd), umschlag(ich, SEIT - 10)]);
  const abgelegt: NostrEvent[] = [];
  const r = await gleichePosteingangAb(ich, "wss://knoten", ["wss://knoten", "wss://a", "wss://b", "wss://a"], SEIT,
    wege({ "wss://knoten": knoten, "wss://a": draussen, "wss://b": "ohne-nip77" }, abgelegt));
  const ids = (evs: NostrEvent[]) => evs.map((e) => e.id).sort();
  assert.deepEqual(ids(r.umschlaege), ids([...gemeinsam, nurKnoten, ...nurDraussen]), "alles an mich, nichts an andere, nichts vor `seit`");
  assert.deepEqual(ids(abgelegt), ids(nurDraussen), "beim Knoten nur, was ihm fehlte");
  assert.equal(r.geholt, 3);
  assert.equal(r.abgelegt, 3);
  assert.equal(r.vollstaendig, true);
  assert.deepEqual(r.ohne, [{ url: "wss://b", fall: "neg.zeit" }], "nie alles laden, wo es kein NIP-77 gibt");
  // draußen nur nach Ids gefragt – nie alle Umschläge
  assert.ok(draussen.fragen.every((f) => Array.isArray(f.ids) && f.ids.every((id) => ids(nurDraussen).includes(id))));
  assert.deepEqual(knoten.fragen[0], { kinds: [1059], "#p": [ich], since: SEIT, limit: POSTEINGANG_ABGLEICH.vomKnoten });
});

test("B-35c: Knoten nicht erreichbar – nichts gilt als erledigt; was der Relay unterschiebt, bleibt draußen", async () => {
  const fehlt = [umschlag(ich), umschlag(ich)];
  const draussen = relay(fehlt);
  const falsch = umschlag(fremd);
  // ein Relay, das zu den gefragten Ids etwas anderes liefert
  const boese = { ...draussen, fragen: [] as RelayFilter[], frage: (f: RelayFilter) => [...draussen.frage(f), falsch] };
  const r = await gleichePosteingangAb(ich, "wss://knoten", ["wss://a"], SEIT,
    wege({ "wss://knoten": relay([]), "wss://a": boese as ReturnType<typeof relay> }, [], false));
  assert.equal(r.geholt, 2);
  assert.equal(r.abgelegt, 0);
  assert.equal(r.vollstaendig, false, "erst wenn alles beim Knoten liegt");
  assert.ok(!r.umschlaege.some((e) => e.id === falsch.id), "nur gefragte Ids an mich");
});

test("B-35c: höchstens `hoechstens` je Runde, in Stücken – und `seit` reicht um die Rückdatierung zurück", async () => {
  const viele = Array.from({ length: POSTEINGANG_ABGLEICH.hoechstens + 40 }, () => umschlag(ich));
  const draussen = relay(viele);
  const r = await gleichePosteingangAb(ich, "wss://knoten", ["wss://a"], SEIT, wege({ "wss://knoten": relay([]), "wss://a": draussen }, []));
  assert.equal(r.geholt, POSTEINGANG_ABGLEICH.hoechstens);
  assert.ok(draussen.fragen.every((f) => (f.ids?.length ?? 0) <= POSTEINGANG_ABGLEICH.jeAbfrage));
  assert.equal(draussen.fragen.length, Math.ceil(POSTEINGANG_ABGLEICH.hoechstens / POSTEINGANG_ABGLEICH.jeAbfrage));

  assert.equal(abgleichSeit(null, JETZT), JETZT - POSTEINGANG_ABGLEICH.ersteSek, "ohne Runde höchstens 30 Tage");
  assert.equal(abgleichSeit(JETZT - 600, JETZT), JETZT - 600 - POSTEINGANG_ABGLEICH.rueckSek, "Umschläge sind bis zu zwei Tage zurückdatiert");
  assert.equal(abgleichSeit(JETZT - 400 * 24 * 3600, JETZT), JETZT - POSTEINGANG_ABGLEICH.ersteSek);
  assert.ok(POSTEINGANG_ABGLEICH.hoechstens < 600, "unter dem Flutschutz des Knotens (600 Events je Minute)");
});

test("B-35c: verdrahtet – aus dem Abgleich des Posteingangs, nur gekoppelt, nur mit dem Knoten im eigenen Satz, als Gerät nie", () => {
  const post = lies("shell/tabs/posteingang.ts");
  assert.match(post, /await abgleichMitKnoten\(me\.pk\)/);
  const knoten = lies("shell/posteingang-knoten.ts");
  assert.match(knoten, /alsGeraet\(\)\) return \[\]/);
  assert.match(knoten, /meineKopplung\(\)/);
  assert.match(knoten, /!eigene\.includes\(normalizeRelayUrl\(url\)\)\) return \[\]/, "nur, wenn der Knoten Posteingang ist (B-9c3)");
  assert.match(knoten, /gleichePosteingangAb\(/);
  assert.match(knoten, /if \(r\.vollstaendig\) await geheim\.setItem\(LS_POSTEINGANG_RUNDE/);
  assert.match(knoten, /"online"/);
  assert.match(knoten, /visibilitychange/);
  assert.doesNotMatch(knoten, /setInterval|setTimeout/, "kein eigener Takt (6.4) – nur aus dem Abgleich");
  assert.match(lies("shell/tresor.ts"), /"freedom\.posteingang\.knotenRunde"/, "im Tresor");
  const state = lies("shell/state.ts");
  assert.match(state, /pool\.abgleicheAn\(/);
  assert.match(state, /v\.abgleiche\(filter, speicher\)\.then\(\(ok\) => \(\{ ok \}\), \(fehler: unknown\) => \(\{ fehler \}\)\)/, "kein Aussetzen (A-26) für Relays ohne NIP-77");
});
