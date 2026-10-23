/**
 * B-32b2: Reticulum über die RNode – zwei Apps mit je einer RNode-Attrappe in derselben „Luft“: Umschläge gehen über
 * LXMF hin und kommen geprüft an; jedes Paket an die RNode bucht das Sendezeitkonto, was nicht hineinpasst, geht nicht
 * hinaus.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import {
  FUNK_REGIONEN, MeshKind, ReticulumFehler, Sendezeitkonto, buildPrivateDm, generateKeypair, reticulumIdentitaet, rnodeSendezeit,
  starteReticulum, type ReticulumFunk,
} from "@freedomstack/protocol";
import { verbindeRNode, type FunkWahl } from "../src/rnode-funk.js";
import { rnodeAttrappe, type Luft } from "../../protocol/test/rnode-attrappe.js";

const EU = FUNK_REGIONEN[0]!;
const wahl: FunkWahl = { region: EU.kennung, parameter: { ...EU.vorgabe }, bestaetigt: 1_790_000_000 };

const alice = generateKeypair();
const bob = generateKeypair();
/** Ein echter Umschlag (NIP-59) an Bob – Kind 1059, Inhalt NIP-44. */
async function umschlag(text = "Treffen um 19 Uhr"): Promise<Uint8Array> {
  const dm = await buildPrivateDm({ senderSk: alice.sk, senderPk: alice.pk, recipientPk: bob.pk, content: text });
  return new TextEncoder().encode(JSON.stringify(dm.toRecipient));
}

function speicher() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => void m.set(k, v) };
}

async function app(luft: Luft, konto = new Sendezeitkonto(), jetzt?: () => number) {
  const a = rnodeAttrappe({ luft });
  const rnode = await verbindeRNode(a.port, wahl, { postOpenDelayMs: 0, detectTimeout: 2 });
  const angekommen: Array<{ payload: Uint8Array; kind: MeshKind }> = [];
  const funk: ReticulumFunk = await starteReticulum({
    rnode, identitaet: await reticulumIdentitaet(speicher()), parameter: wahl.parameter, konto, jetzt, sendeFristMs: 5000,
    beiEmpfang: (payload, kind) => angekommen.push({ payload, kind }),
  });
  return { funk, attrappe: a, angekommen, konto, rnode };
}

async function bis(bedingung: () => boolean, frist = 10_000): Promise<void> {
  const ende = Date.now() + frist;
  while (!bedingung()) {
    if (Date.now() > ende) throw new Error("Frist abgelaufen");
    await new Promise((r) => setTimeout(r, 10));
  }
}

test("B-32b2: Sendezeit einer RNode – Formel von Semtech, Präambel wie die Firmware, zwei Rahmen über 254 Byte", () => {
  const p = EU.vorgabe; // SF 8, 125 kHz, CR 4/5: ein Symbol 2,048 ms, Präambel 18 Symbole
  assert.ok(Math.abs(rnodeSendezeit(p, 50) - 0.2053) < 0.001, String(rnodeSendezeit(p, 50)));
  assert.ok(rnodeSendezeit(p, 254) < rnodeSendezeit(p, 255), "über 254 Byte ein zweiter Rahmen samt Präambel");
  assert.ok(rnodeSendezeit(p, 255) - rnodeSendezeit(p, 254) > 18 * 0.002048, "der zweite Rahmen kostet mindestens seine Präambel");
  assert.ok(rnodeSendezeit({ ...p, spreadingFactor: 12 }, 50) > 10 * rnodeSendezeit(p, 50), "SF 12 ist vielfach langsamer");
});

test("B-32b2: ein Umschlag von A nach B über LXMF – geprüft angekommen, jedes Paket gebucht", { timeout: 30_000 }, async () => {
  const luft: Luft = new Set();
  const a = await app(luft);
  const b = await app(luft);
  try {
    assert.equal(a.funk.adresse.length, 16);
    const roh = await umschlag("x".repeat(600));
    await a.funk.sende(b.funk.adresse, roh, MeshKind.NostrEvent, []);
    await bis(() => b.angekommen.length > 0);
    assert.deepEqual(b.angekommen, [{ payload: roh, kind: MeshKind.NostrEvent }]);
    assert.equal(a.angekommen.length, 0);
    for (const s of [a, b]) {
      assert.ok(s.funk.zaehler.gesendet > 0, "beide Seiten senden (Pfad, Link, Bestätigung)");
      assert.equal(s.funk.zaehler.verworfen, 0);
      assert.equal(s.attrappe.gesendet.length, s.funk.zaehler.gesendet, "nichts geht am Konto vorbei in die Luft");
      const gebucht = s.attrappe.gesendet.reduce((n, d) => n + rnodeSendezeit(wahl.parameter, d.length), 0);
      assert.ok(Math.abs(s.konto.budget - s.konto.frei(Date.now() / 1000) - gebucht) < 1e-6, "gebucht ist, was in der Luft war");
    }
  } finally {
    await a.funk.stoppe();
    await b.funk.stoppe();
  }
});

test("B-32b2: Sendezeit aufgebraucht – vorab „sendezeit“, was der Kern selbst sendet, geht still verloren; danach wieder frei", { timeout: 30_000 }, async () => {
  const luft: Luft = new Set();
  let uhr = 1_790_000_000;
  const a = await app(luft, new Sendezeitkonto(), () => uhr);
  const b = await app(luft);
  try {
    a.konto.buche(a.konto.budget, uhr); // 36 s je Stunde, alles verbraucht
    await assert.rejects(a.funk.sende(b.funk.adresse, await umschlag(), MeshKind.NostrEvent, []),
      (e) => e instanceof ReticulumFehler && e.fall === "sendezeit");
    // was der Kern von sich aus schickt (Antwort auf eine Pfad-Anfrage, Bestätigung), geht durch dasselbe Konto
    await a.rnode.send({ serialize: () => new Uint8Array(50) } as never);
    assert.equal(a.attrappe.gesendet.length, 0, "nichts in der Luft");
    assert.equal(a.funk.zaehler.verworfen, 1, "still verworfen – ein Fehler ließe den Schreibstrom des Kerns scheitern");
    uhr += 3601; // eine Stunde später ist das Konto wieder frei – und die Schnittstelle lebt noch
    const roh = await umschlag("wieder da");
    await a.funk.sende(b.funk.adresse, roh, MeshKind.NostrEvent, []);
    await bis(() => b.angekommen.length > 0);
    assert.deepEqual(b.angekommen, [{ payload: roh, kind: MeshKind.NostrEvent }]);
  } finally {
    await a.funk.stoppe();
    await b.funk.stoppe();
  }
});

test("B-32b2: nur was `pruefeMeshInhalt()` durchlässt – kein offenes Event, nicht die eigene DM-Kopie", { timeout: 30_000 }, async () => {
  const luft: Luft = new Set();
  const a = await app(luft);
  const b = await app(luft);
  try {
    const offen = finalizeEvent({ kind: 1, created_at: 1_790_000_000, tags: [], content: "offen" }, generateSecretKey());
    await assert.rejects(a.funk.sende(b.funk.adresse, new TextEncoder().encode(JSON.stringify(offen)), MeshKind.NostrEvent, []),
      (e) => e instanceof ReticulumFehler && e.fall === "inhalt");
    await assert.rejects(a.funk.sende(b.funk.adresse, await umschlag(), MeshKind.NostrEvent, [bob.pk]),
      (e) => e instanceof ReticulumFehler && e.fall === "inhalt", "die eigene DM-Kopie geht nie hinaus");
    await assert.rejects(a.funk.sende(new Uint8Array(15), await umschlag(), MeshKind.NostrEvent, []),
      (e) => e instanceof ReticulumFehler && e.fall === "adresse");
    assert.equal(a.attrappe.gesendet.length, 0);
  } finally {
    await a.funk.stoppe();
    await b.funk.stoppe();
  }
});

test("B-32b2: von sich aus kündigt die App nichts an – erst wer fragt, bekommt eine Antwort (Grenze im Bericht)", { timeout: 30_000 }, async () => {
  const luft: Luft = new Set();
  const a = await app(luft);
  try {
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(a.attrappe.gesendet.length, 0, "nach dem Start still in der Luft");
  } finally {
    await a.funk.stoppe();
  }
  const { PRIVACY_FACTS } = await import("@freedomstack/protocol");
  assert.equal(PRIVACY_FACTS.find((f) => f.id === "reticulum-ankuendigung")?.status, "grenze");
  const { faktAussage } = await import("../src/datenschutz-bericht.js");
  const { setLang } = await import("../src/i18n.js");
  setLang("en");
  assert.match(faktAussage({ id: "reticulum-ankuendigung", aussage: "", status: "grenze" }), /answers over the air/);
});

test("B-32b2: verdrahtet – nach dem Verbinden läuft Reticulum, Empfang wie Funk, Identität nur aus `geheim`", async () => {
  const { readFileSync } = await import("node:fs");
  const lies = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const ui = lies("src/shell/rnode-ui.ts");
  assert.match(ui, /starteReticulum\(\{\n\s+rnode, identitaet: await reticulumIdentitaet\(geheim\), parameter: wahl\.parameter, beiEmpfang: nimmFunkInhalt,/);
  assert.ok(ui.indexOf("tresorOffen()") < ui.indexOf("serial.requestPort()"), "gesperrter Tresor: gar nicht erst verbinden");
  assert.match(ui, /await rnode\.disconnect\(\)\.catch/, "startet Reticulum nicht, wird die RNode wieder getrennt");
  assert.match(ui, /await r\.stoppe\(\)/, "ein zweiter Klick stoppt Reticulum samt RNode");
  assert.match(lies("src/shell/tabs/mesh.ts"), /onMessage: nimmFunkInhalt,/, "Meshtastic und Reticulum teilen denselben Empfang");
  // Im Build führen alle Pfade in die Bibliothek auf EIN vorab minifiziertes Modul (W5: unter 150 KB gepackt) – jeder Pfad,
  // den die App lädt, muss dort stehen, sonst fehlte der Name zur Laufzeit; zwei Kopien des Kerns gäbe es nie
  const bau = lies("build.mjs");
  assert.match(bau, /b\.onResolve\(\{ filter: \/\^@reticulum\\\/\/ \}, \(\) => \(\{ path: "reticulum", namespace: "freedom-ret" \}\)\)/);
  const { readdirSync } = await import("node:fs");
  // seit B-32d1 laden auch Umschlag und Kern im Protokoll die Bibliothek – im Build über dasselbe Modul
  const pfade = new Set(["../src/", "../../protocol/src/"].flatMap((ordner) => {
    const src = new URL(ordner, import.meta.url);
    return (readdirSync(src, { recursive: true }) as string[]).filter((f) => f.endsWith(".ts"))
      .flatMap((f) => [...readFileSync(new URL(f, src), "utf8").matchAll(/import\("(@reticulum\/[^"]+)"\)/g)].map((m) => m[1]!));
  }));
  assert.deepEqual([...pfade].sort(), ["@reticulum/core", "@reticulum/core/src/interfaces/rnode-webserial.js", "@reticulum/lxmf/src/message.js", "@reticulum/lxmf/src/router.js"]);
  for (const pfad of pfade) assert.ok(bau.includes(`from "${pfad}";`), `${pfad} steht im Modul „reticulum-klein“`);
  const funk = lies("../protocol/src/reticulum-kern.ts");
  assert.doesNotMatch(funk, /\.announce\(|startAnnouncing|console\./, "von sich aus keine Ankündigung, nichts ins Log");
  const { setLang, t } = await import("../src/i18n.js");
  for (const sprache of ["de", "en"] as const) {
    setLang(sprache);
    assert.match(t("set.rnodeVerbunden", { adresse: "ab".repeat(16) }), new RegExp("ab".repeat(16)));
  }
  setLang("en");
});
