/**
 * Tests fuer den automatischen Rueckfluss.
 *
 * Der haeufigste Weg, auf dem Nutzer in solchen Systemen Geld verlieren, ist
 * nicht Betrug, sondern Vergessen: eine Sperre laeuft ab, und niemand ruft die
 * refund-Instruktion auf. Diese Tests pruefen vor allem, dass nichts zu frueh,
 * nichts doppelt und nichts endlos versucht wird.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rememberLock,
  forgetLock,
  listPendingLocks,
  viewLock,
  sweepPendingRefunds,
  startRefundWatcher,
  MAX_REFUND_ATTEMPTS,
  PendingLock,
  RefundRunner,
  setzeSperrSpeicher,
} from "../src/refund-watcher.js";

const NOW = 1_800_000_000;

/**
 * localStorage fuer den Testlauf bereitstellen.
 *
 * Muss `await`en: eine synchrone finally-Klausel raeumt den Speicher sonst ab,
 * waehrend die asynchrone Testfunktion noch laeuft.
 */
async function withStorage<T>(fn: () => T | Promise<T>): Promise<T> {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    setItem: (k: string, v: string) => store.set(k, v),
    getItem: (k: string) => store.get(k) ?? null,
    removeItem: (k: string) => store.delete(k),
    get length() { return store.size; },
    key: (i: number) => [...store.keys()][i] ?? null,
  };
  try {
    return await fn();
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
}

const lock = (over: Partial<PendingLock> = {}): PendingLock => ({
  kind: "swap",
  reference: "ref-1",
  swapIds: ["s1", "s2"],
  timelockUnix: NOW + 3600,
  amountLamports: 40_000_000,
  createdAt: NOW - 100,
  ...over,
});

function runner(erfolg = true, grund = "Timelock laeuft noch"): RefundRunner & { aufrufe: string[][] } {
  const aufrufe: string[][] = [];
  return {
    aufrufe,
    async refund(swapIds: string[]) {
      aufrufe.push(swapIds);
      return erfolg
        ? { signature: "sigX", refunded: swapIds, failed: [] }
        : { refunded: [], failed: swapIds.map((s) => ({ swapId: s, reason: grund })) };
    },
  };
}

// ------------------------------------------------------------- Ablage

test("Ablage: gemerkte Sperren ueberleben und lassen sich auflisten", async () => {
  await withStorage(() => {
    rememberLock(lock());
    rememberLock(lock({ reference: "ref-2" }));
    assert.equal(listPendingLocks().length, 2);
  });
});

test("Ablage: erledigte Sperren erscheinen nicht mehr", async () => {
  await withStorage(() => {
    rememberLock(lock({ settled: true }));
    assert.equal(listPendingLocks().length, 0);
  });
});

test("Ablage: nach Faelligkeit sortiert — was zuerst faellig ist, zuerst", async () => {
  await withStorage(() => {
    rememberLock(lock({ reference: "spaet", timelockUnix: NOW + 9999 }));
    rememberLock(lock({ reference: "frueh", timelockUnix: NOW + 10 }));
    assert.equal(listPendingLocks()[0].reference, "frueh");
  });
});

test("Ablage: beschaedigte Eintraege bringen die Liste nicht zum Absturz", async () => {
  await withStorage(() => {
    localStorage.setItem("freedom.pending.kaputt", "{kein json");
    rememberLock(lock());
    assert.equal(listPendingLocks().length, 1);
  });
});

// ------------------------------------------------------------- Anzeige

test("Anzeige: laufende Sperre erklaert die Wartezeit statt sie zu beklagen", () => {
  const v = viewLock(lock({ timelockUnix: NOW + 1800 }), NOW);
  assert.equal(v.status, "laeuft");
  assert.match(v.text, /30 min/);
  // Der Nutzer soll verstehen, WARUM er warten muss.
  assert.match(v.text, /Absicherung/);
});

test("Anzeige: lange Fristen in Stunden statt in dreistelligen Minuten", () => {
  const v = viewLock(lock({ timelockUnix: NOW + 7200 }), NOW);
  assert.match(v.text, / h\b/);
});

test("Anzeige: faellige Sperre wird als solche gemeldet", () => {
  const v = viewLock(lock({ timelockUnix: NOW - 1 }), NOW);
  assert.equal(v.status, "faellig");
  assert.equal(v.secondsLeft, 0);
});

test("Anzeige: nach zu vielen Fehlversuchen wird der wahrscheinliche Grund genannt", () => {
  const v = viewLock(
    lock({ timelockUnix: NOW - 1, attempts: MAX_REFUND_ATTEMPTS, lastError: "AlreadyClosed" }),
    NOW,
  );
  assert.equal(v.status, "aufgegeben");
  // Nicht "Fehler", sondern die wahrscheinlichste Erklaerung.
  assert.match(v.text, /bereits eingelöst/);
  assert.match(v.text, /AlreadyClosed/);
});

// ------------------------------------------------------------- Rueckfluss

test("Rueckfluss: faellige Sperre wird zurueckgeholt", async () => {
  await withStorage(async () => {
    rememberLock(lock({ timelockUnix: NOW - 10 }));
    const r = runner(true);
    const res = await sweepPendingRefunds(r, NOW);

    assert.equal(res.zurueckgeholt, 1);
    assert.equal(res.lamports, 40_000_000);
    assert.deepEqual(r.aufrufe[0], ["s1", "s2"], "beide Sperren in einem Aufruf");
    assert.equal(listPendingLocks().length, 0, "erledigt und nicht mehr offen");
  });
});

test("Rueckfluss: laufende Sperre wird NICHT angefasst", async () => {
  await withStorage(async () => {
    rememberLock(lock({ timelockUnix: NOW + 3600 }));
    const r = runner(true);
    const res = await sweepPendingRefunds(r, NOW);

    // Vor Ablauf zurueckzuholen wuerde die Absicherung aushebeln, die den
    // Gegenueber ueberhaupt erst ohne Vertrauen arbeiten laesst.
    assert.equal(r.aufrufe.length, 0);
    assert.equal(res.zurueckgeholt, 0);
    assert.equal(res.offen.length, 1);
  });
});

test("Rueckfluss: derselbe Betrag wird nicht zweimal geholt", async () => {
  await withStorage(async () => {
    rememberLock(lock({ timelockUnix: NOW - 10 }));
    const r = runner(true);
    await sweepPendingRefunds(r, NOW);
    await sweepPendingRefunds(r, NOW);
    assert.equal(r.aufrufe.length, 1, "nach Erfolg kein zweiter Versuch");
  });
});

test("Rueckfluss: ein Fehlschlag blockiert die anderen Sperren nicht", async () => {
  await withStorage(async () => {
    rememberLock(lock({ reference: "a", swapIds: ["a1"], timelockUnix: NOW - 10 }));
    rememberLock(lock({ reference: "b", swapIds: ["b1"], timelockUnix: NOW - 10 }));

    let ersterAufruf = true;
    const r: RefundRunner = {
      async refund(ids) {
        if (ersterAufruf) { ersterAufruf = false; throw new Error("RPC weg"); }
        return { signature: "s", refunded: ids, failed: [] };
      },
    };
    const res = await sweepPendingRefunds(r, NOW);
    assert.equal(res.zurueckgeholt, 1, "die zweite geht trotzdem durch");
    assert.equal(res.fehler.length, 1);
  });
});

test("Rueckfluss: Fehlversuche werden gezaehlt und irgendwann eingestellt", async () => {
  await withStorage(async () => {
    rememberLock(lock({ timelockUnix: NOW - 10 }));
    const r = runner(false, "AlreadyClosed");

    for (let i = 0; i < MAX_REFUND_ATTEMPTS + 3; i++) {
      await sweepPendingRefunds(r, NOW);
    }
    // Jeder Versuch kostet Transaktionsgebuehren; endlos zu probieren waere
    // teurer als der Betrag, um den es geht.
    assert.equal(r.aufrufe.length, MAX_REFUND_ATTEMPTS);
  });
});

test("Rueckfluss: leere Ablage ergibt ein sauberes Ergebnis", async () => {
  await withStorage(async () => {
    const res = await sweepPendingRefunds(runner(true), NOW);
    assert.equal(res.geprueft, 0);
    assert.equal(res.zurueckgeholt, 0);
    assert.equal(res.fehler.length, 0);
  });
});

test("Vergessen: eine Sperre laesst sich manuell entfernen", async () => {
  await withStorage(() => {
    rememberLock(lock());
    forgetLock("ref-1");
    assert.equal(listPendingLocks().length, 0);
  });
});

// ------------------------------------------------------------- Watcher

test("Watcher: prueft sofort, nicht erst nach dem ersten Intervall", async () => {
  await withStorage(async () => {
    // ECHTE Uhrzeit: der Watcher bekommt kein nowUnix uebergeben, weil er im
    // Betrieb auch keins hat. Eine fiktive Zukunftszeit waere hier nie faellig.
    rememberLock(lock({ timelockUnix: Math.floor(Date.now() / 1000) - 10 }));
    const r = runner(true);
    let ergebnis: { zurueckgeholt: number } | null = null;

    // Wer die App nach zwei Tagen oeffnet, soll sein Geld bekommen, ohne auf
    // das naechste Intervall zu warten.
    const stop = startRefundWatcher(r, (res) => { ergebnis = res; }, 60_000);
    await new Promise((res) => setTimeout(res, 200));
    stop();

    assert.ok(ergebnis, "sofortiger Durchlauf");
    assert.equal(r.aufrufe.length, 1);
  });
});

test("Watcher: stop() beendet die Ueberwachung", async () => {
  await withStorage(async () => {
    rememberLock(lock({ timelockUnix: Math.floor(Date.now() / 1000) - 10 }));
    const r = runner(false);
    const stop = startRefundWatcher(r, undefined, 20);
    await new Promise((res) => setTimeout(res, 50));
    stop();
    const stand = r.aufrufe.length;
    await new Promise((res) => setTimeout(res, 80));
    assert.equal(r.aufrufe.length, stand, "nach stop() keine weiteren Versuche");
  });
});

// ------------------------------------------------ Kette zuerst (4.6c)

test("Kette zuerst: schon eingeloeste Sperren werden ohne Transaktion abgeschlossen", async () => {
  await withStorage(async () => {
    await rememberLock(lock({ timelockUnix: NOW - 1 }));
    const r = runner();
    const mitKette = { ...r, offen: async () => [] as string[] };
    const res = await sweepPendingRefunds(mitKette, NOW);
    assert.equal(r.aufrufe.length, 0, "kein Wallet-Dialog fuer nichts");
    assert.equal(res.fehler.length, 0);
    assert.equal(listPendingLocks().length, 0, "abgeschlossen");
  });
});

test("Kette zuerst: nur die offenen Sperren kommen in die Rueckholung", async () => {
  // Frueher riss ein eingeloestes HTLC in derselben Transaktion das offene mit.
  await withStorage(async () => {
    await rememberLock(lock({ timelockUnix: NOW - 1, swapIds: ["spend", "rest"] }));
    const r = runner();
    await sweepPendingRefunds({ ...r, offen: async (ids) => ids.filter((i) => i === "rest") }, NOW);
    assert.deepEqual(r.aufrufe, [["rest"]]);
  });
});

test("Speicher: mit Tresor liegen die Sperren dort, nicht in localStorage", async () => {
  await withStorage(async () => {
    const tresor = new Map<string, string>();
    setzeSperrSpeicher({
      getItem: (k) => tresor.get(k) ?? null,
      setItem: async (k, v) => { tresor.set(k, v); },
      removeItem: async (k) => { tresor.delete(k); },
      keys: () => [...tresor.keys()],
    });
    try {
      await rememberLock(lock({ reference: "im-tresor" }));
      assert.equal(localStorage.length, 0);
      assert.equal(listPendingLocks()[0].reference, "im-tresor");
      await forgetLock("im-tresor");
      assert.equal(tresor.size, 0);
    } finally {
      setzeSperrSpeicher({
        getItem: (k) => localStorage.getItem(k),
        setItem: (k, v) => localStorage.setItem(k, v),
        removeItem: (k) => localStorage.removeItem(k),
        keys: () => Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((k): k is string => k !== null),
      });
    }
  });
});
