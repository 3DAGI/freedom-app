/**
 * Auswertung für die Status-Seite (Schritt 8.15) – ohne DOM, damit ein Test
 * sie prüfen kann (`packages/app/test/website-dashboard.test.ts`).
 *
 * Nur Öffentliches und Freiwilliges: Angebote (38027), Modellkataloge (38080),
 * Abdeckung (38055, nur Zellen über der Schwelle) und Werbe-Nennungen (38052,
 * nur als Summe). Was Provider über ihre eigene Arbeit melden, fragt die Seite
 * nicht ab – eine Selbstauskunft ist keine Zahl, der man glauben kann; bezahlt
 * wird privat, Quittungen liegen nur in den Tresoren der Kunden. Keine
 * Rangliste: Angebote stehen nach ihrer letzten Erneuerung, Kataloge nach Titel.
 */
export const KIND_ANGEBOT = 38027; // tiers.ts: KIND_PROVIDER_CAPABILITIES
export const KIND_KATALOG = 38080; // modell-katalog.ts
export const KIND_ABDECKUNG = 38055; // coverage.ts
export const KIND_NENNUNG = 38052; // werbe-nennung.ts
/** Wie `discoverProviders()` in der App: ein Angebot gilt 24 h, der Knoten erneuert es alle 30 min. */
export const ANGEBOT_FRISCH_SECS = 24 * 3600;
export const ZEITRAUM_SECS = 7 * 24 * 3600;
/** Wie `K_ANONYMITY` in coverage.ts: Funk- und Bluetooth-Zellen erst ab so vielen Knoten. */
export const K_SCHWELLE = 3;

const HEX64 = /^[0-9a-f]{64}$/;
const STUFEN = ["free", "classic", "pro"];
const EBENEN = ["online", "lora", "bluetooth"];
const tag = (ev, name) => {
  const t = ev.tags.find((x) => Array.isArray(x) && x[0] === name);
  return t && typeof t[1] === "string" ? t[1] : undefined;
};

/** Die Abfrage an jeden Relay – genau diese Arten, nichts sonst. */
export function filter(jetzt) {
  const since = jetzt - ZEITRAUM_SECS;
  return [
    { kinds: [KIND_ANGEBOT], since, limit: 500 },
    { kinds: [KIND_KATALOG], limit: 500 },
    { kinds: [KIND_ABDECKUNG], since, limit: 2000 },
    { kinds: [KIND_NENNUNG], limit: 2000 },
  ];
}

function angebote(events, jetzt) {
  const je = new Map();
  for (const ev of events) {
    if (ev.kind !== KIND_ANGEBOT || tag(ev, "d") !== ev.pubkey || !STUFEN.includes(tag(ev, "tier"))) continue;
    if (jetzt - ev.created_at > ZEITRAUM_SECS || (je.get(ev.pubkey)?.zeit ?? -1) >= ev.created_at) continue;
    const rate = Number(tag(ev, "text_rate_msat"));
    je.set(ev.pubkey, {
      pubkey: ev.pubkey,
      zeit: ev.created_at,
      stufe: tag(ev, "tier"),
      modelle: [...new Set(ev.tags.filter((t) => t[0] === "model" && typeof t[1] === "string" && t[1]).map((t) => t[1]))].slice(0, 50),
      satsJe1k: Number.isFinite(rate) && rate >= 0 ? rate / 1000 : null,
      gratis: tag(ev, "free") === "1",
      lightning: !!tag(ev, "lud16"),
      solKanal: ev.tags.some((t) => t[0] === "kanal" && t[1] && t[2]),
      funkGateway: ev.tags.some((t) => t[0] === "funk" && t[1] === "gateway"),
    });
  }
  return [...je.values()].sort((a, b) => b.zeit - a.zeit || (a.pubkey < b.pubkey ? -1 : 1));
}

function kataloge(events) {
  const je = new Map();
  for (const ev of events) {
    const d = ev.kind === KIND_KATALOG ? tag(ev, "d") : undefined;
    if (!d || !/^[A-Za-z0-9._-]{1,64}$/.test(d)) continue;
    const key = `${ev.pubkey}:${d}`;
    if ((je.get(key)?.zeit ?? -1) >= ev.created_at) continue;
    const modelle = new Set(ev.tags.filter((t) => t[0] === "model" && typeof t[1] === "string" && t[1]).map((t) => t[1].toLowerCase()));
    je.set(key, { kurator: ev.pubkey, titel: (tag(ev, "title") || d).slice(0, 80), modelle: Math.min(modelle.size, 200), zeit: ev.created_at });
  }
  return [...je.values()].sort((a, b) => a.titel.localeCompare(b.titel) || b.zeit - a.zeit);
}

/** Wie `buildCoverage()`: Zellen unter der Schwelle erscheinen nicht, auch nicht als „mindestens einer“. */
function abdeckung(events, jetzt) {
  const zellen = new Map();
  for (const ev of events) {
    const ebene = ev.kind === KIND_ABDECKUNG ? tag(ev, "layer") : undefined;
    const zelle = tag(ev, "cell") ?? "";
    if (!EBENEN.includes(ebene) || !/^-?\d+\.\d{2},-?\d+\.\d{2}$/.test(zelle) || jetzt - ev.created_at > ZEITRAUM_SECS) continue;
    const ablauf = Number(tag(ev, "expiration") ?? NaN);
    if (Number.isFinite(ablauf) && ablauf <= jetzt) continue;
    const key = `${ebene}:${zelle}`;
    const z = zellen.get(key) ?? { ebene, schluessel: new Set() };
    z.schluessel.add(ev.pubkey);
    zellen.set(key, z);
  }
  const out = { online: { zellen: 0, knoten: 0 }, lora: { zellen: 0, knoten: 0 }, bluetooth: { zellen: 0, knoten: 0 }, verdeckt: 0 };
  for (const z of zellen.values()) {
    if (z.schluessel.size < (z.ebene === "online" ? 1 : K_SCHWELLE)) {
      out.verdeckt++;
      continue;
    }
    out[z.ebene].zellen++;
    out[z.ebene].knoten += z.schluessel.size;
  }
  return out;
}

/** Wie `zaehleNennungen()`: je Geworbenem die früheste Angabe – hier nur als Summe, ohne Liste der Werber. */
function nennungen(events) {
  const frueh = new Map();
  for (const ev of events) {
    const w = ev.kind === KIND_NENNUNG ? tag(ev, "referrer") : undefined;
    if (!w || !HEX64.test(w) || w === ev.pubkey) continue;
    if ((frueh.get(ev.pubkey)?.zeit ?? Infinity) > ev.created_at) frueh.set(ev.pubkey, { werber: w, zeit: ev.created_at });
  }
  return { nennungen: frueh.size, werber: new Set([...frueh.values()].map((x) => x.werber)).size };
}

/** Alles, was die Seite zeigt – aus den Events aller Relays (Doppelte egal). */
export function werteAus(roh, jetzt) {
  const byId = new Map();
  for (const ev of roh) {
    if (ev && typeof ev === "object" && typeof ev.id === "string" && HEX64.test(ev.pubkey ?? "") && Number.isSafeInteger(ev.created_at)
      && Array.isArray(ev.tags) && ev.tags.every(Array.isArray)) byId.set(ev.id, ev);
  }
  const events = [...byId.values()];
  const alle = angebote(events, jetzt);
  const frisch = alle.filter((a) => jetzt - a.zeit <= ANGEBOT_FRISCH_SECS);
  const modelle = new Map();
  for (const a of frisch) for (const m of a.modelle) modelle.set(m, (modelle.get(m) ?? 0) + 1);
  const k = kataloge(events);
  return {
    ereignisse: events.length,
    angebote: frisch,
    angebote7Tage: alle.length,
    modelle: [...modelle].map(([name, anbieter]) => ({ name, anbieter })).sort((a, b) => b.anbieter - a.anbieter || a.name.localeCompare(b.name)),
    kataloge: k,
    kuratoren: new Set(k.map((x) => x.kurator)).size,
    abdeckung: abdeckung(events, jetzt),
    nennungen: nennungen(events),
  };
}
