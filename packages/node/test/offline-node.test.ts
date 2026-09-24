/**
 * Tests fuer den Offline-Betrieb des Providers.
 *
 * Bisher brauchte der Knoten zwingend Relays. Faellt das Netz aus, gibt es
 * zwar Nachrichten zwischen Menschen, aber keinen einzigen Provider — die
 * Haelfte des Systems faellt genau dann aus, wenn sie am wichtigsten waere.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryRelay, generateKeypair, signEvent, buildEvent, NostrEvent } from "@freedomstack/protocol";
import { OfflineCapablePool } from "../src/offline-node.js";

const KP = generateKeypair();
const ev = (content = "x", kind = 4): NostrEvent =>
  signEvent(buildEvent(KP.pk, kind, [], content), KP.sk);

async function mitOrdner<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "freedom-offline-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("Online: Ereignis geht ins Netz UND in den Ordner", async () => {
  await mitOrdner(async (dir) => {
    const relay = new MemoryRelay("mem://a");
    const p = new OfflineCapablePool([relay], { spoolDir: dir });

    assert.equal(await p.publish(ev("hallo")), true);
    assert.equal((await relay.query({ kinds: [4] })).length, 1);
    // Der Ordner ist der Bestand, aus dem spaeter abgeglichen wird.
    assert.equal((await p.status()).spooled, 1);
  });
});

test("Offline: der Knoten arbeitet weiter, statt stehenzubleiben", async () => {
  await mitOrdner(async (dir) => {
    const relay = new MemoryRelay("mem://a");
    relay.setOffline(true);
    const p = new OfflineCapablePool([relay], { spoolDir: dir });

    // Kein Wurf, kein Abbruch — der Knoten muss weiterlaufen.
    assert.equal(await p.publish(ev("offline")), false);
    const st = await p.status();
    assert.equal(st.online, false);
    assert.equal(st.pending, 1);
    assert.equal(st.spooled, 1, "im Ordner liegt es trotzdem");
  });
});

test("Die Statusmeldung nennt den Ausweg", async () => {
  // "Offline" allein hilft dem Betreiber nicht — er soll wissen, dass der
  // Ordner weitergegeben werden kann.
  await mitOrdner(async (dir) => {
    const relay = new MemoryRelay("mem://a");
    relay.setOffline(true);
    const p = new OfflineCapablePool([relay], { spoolDir: dir });
    await p.publish(ev());
    assert.match((await p.status()).message, /Stick oder Funk/);
  });
});

test("Kommt das Netz zurueck, wird nachgereicht", async () => {
  await mitOrdner(async (dir) => {
    const relay = new MemoryRelay("mem://a");
    relay.setOffline(true);
    const p = new OfflineCapablePool([relay], { spoolDir: dir });

    await p.publish(ev("eins"));
    await p.publish(ev("zwei"));
    assert.equal((await p.status()).pending, 2);

    relay.setOffline(false);
    assert.equal(await p.flush(), 2);
    assert.equal((await relay.query({ kinds: [4] })).length, 2);
    assert.equal((await p.status()).pending, 0);
  });
});

test("Ein Ergebnis, das nur im Ordner liegt, gilt NICHT als zugestellt", async () => {
  // Fuer den Kunden waere das dasselbe wie keine Antwort.
  await mitOrdner(async (dir) => {
    const relay = new MemoryRelay("mem://a");
    relay.setOffline(true);
    const p = new OfflineCapablePool([relay], { spoolDir: dir });
    assert.equal(await p.publish(ev("ergebnis")), false);
  });
});

test("Der Puffer waechst nicht unbegrenzt", async () => {
  // Ein voller Puffer fuellt die Platte und beendet den Knoten — dann ist
  // gar nichts mehr zugestellt.
  await mitOrdner(async (dir) => {
    const relay = new MemoryRelay("mem://a");
    relay.setOffline(true);
    const p = new OfflineCapablePool([relay], { spoolDir: dir, maxEvents: 10 });
    for (let i = 0; i < 50; i++) await p.publish(ev(`n${i}`));
    assert.ok((await p.status()).pending <= 10);
  });
});

test("Abfrage findet auch, was nur im Ordner liegt", async () => {
  await mitOrdner(async (dir) => {
    const relay = new MemoryRelay("mem://a");
    relay.setOffline(true);
    const p = new OfflineCapablePool([relay], { spoolDir: dir });
    await p.publish(ev("nur lokal"));

    const gefunden = await p.query({ kinds: [4] });
    assert.equal(gefunden.length, 1);
    assert.equal(gefunden[0].content, "nur lokal");
  });
});

test("Netz und Ordner werden dedupliziert", async () => {
  await mitOrdner(async (dir) => {
    const relay = new MemoryRelay("mem://a");
    const p = new OfflineCapablePool([relay], { spoolDir: dir });
    await p.publish(ev("einmal"));
    // Liegt jetzt in beiden — darf aber nur einmal erscheinen.
    assert.equal((await p.query({ kinds: [4] })).length, 1);
  });
});

test("Der Pool laeuft offline weiter statt zu werfen", async () => {
  // Mit minAcks 2 wuerde ein Publish offline jedes Mal werfen und den
  // Job-Loop anhalten.
  await mitOrdner(async (dir) => {
    const relay = new MemoryRelay("mem://a");
    relay.setOffline(true);
    const p = new OfflineCapablePool([relay], { spoolDir: dir });
    await assert.doesNotReject(() => p.pool().publish(ev("test")));
  });
});

// ---------------------------------------------------------- Abgleich

test("Bestand laesst sich kompakt anbieten", async () => {
  await mitOrdner(async (dir) => {
    const p = new OfflineCapablePool([new MemoryRelay("mem://a")], { spoolDir: dir });
    for (let i = 0; i < 5; i++) await p.publish(ev(`n${i}`));

    const d = await p.digest();
    assert.equal(d.count, 5);
    // 1 KB statt 160 Byte je Kennung — der ganze Grund fuer den Filter.
    assert.ok(d.bits.length <= 1024);
  });
});

test("Aus einem fremden Bestand ergibt sich die Differenz", async () => {
  await mitOrdner(async (dir) => {
    const p = new OfflineCapablePool([new MemoryRelay("mem://a")], { spoolDir: dir });
    const meins: NostrEvent[] = [];
    for (let i = 0; i < 5; i++) {
      const e = ev(`n${i}`);
      meins.push(e);
      await p.publish(e);
    }

    const { buildDigest } = await import("@freedomstack/protocol");
    const fremd = buildDigest([meins[0]]);
    const plan = await p.syncPlanFor(fremd.bits, fremd.count);
    assert.ok(plan.events.length >= 3, `nur ${plan.events.length} — Differenz nicht erkannt`);
  });
});

test("Fremde Ereignisse lassen sich einspielen", async () => {
  // Der Stick-Weg: Was jemand mitbringt, landet im eigenen Bestand.
  await mitOrdner(async (dir) => {
    const p = new OfflineCapablePool([new MemoryRelay("mem://a")], { spoolDir: dir });
    const fremd = [ev("von aussen 1"), ev("von aussen 2")];
    assert.equal(await p.ingest(fremd), 2);
    assert.equal((await p.query({ kinds: [4] })).length, 2);
  });
});

test("Der Bestand ueberlebt einen Neustart des Knotens", async () => {
  await mitOrdner(async (dir) => {
    const a = new OfflineCapablePool([new MemoryRelay("mem://a")], { spoolDir: dir });
    await a.publish(ev("bleibt"));

    const b = new OfflineCapablePool([new MemoryRelay("mem://b")], { spoolDir: dir });
    const gefunden = await b.query({ kinds: [4] });
    assert.equal(gefunden.length, 1);
    assert.equal(gefunden[0].content, "bleibt");
  });
});
