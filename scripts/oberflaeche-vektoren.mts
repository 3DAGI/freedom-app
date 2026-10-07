// Gemeinsame Prüffälle für das Update der Oberfläche (6.1a3a): dieselben signierten
// Release-Manifeste prüfen die Desktop-Hülle (Rust, `packages/launcher/src/update.rs`)
// und das Protokoll (`suchUpdate()` + `pruefeDatei()`, Test `oberflaeche-vektoren.test.ts`).
// Beide müssen gleich entscheiden – so fällt auf, wenn eine Seite anders rechnet
// (Ereignis-Kennung nach NIP-01, Gruppierung, k von n, Zeitpunkt).
//
// Signiert mit Wegwerfschlüsseln, die nur hier entstehen; in der Datei stehen nur
// öffentliche Schlüssel und signierte Events. Neu erzeugen nur, wenn sich die Regeln
// ändern: npx tsx scripts/oberflaeche-vektoren.mts > packages/launcher/tests/vektoren.json
import { buildReleaseManifest, generateKeypair, hashText, signEvent, type NostrEvent } from "../packages/protocol/src/index.ts";

const [a, b, c, fremd] = [generateKeypair(), generateKeypair(), generateKeypair(), generateKeypair()];
const html = (n: number) => `<!doctype html><title>Fassung ${n}</title><p>Oberfläche ${n} – „Zitat“ \\ ü</p>\n`;
const sw = "self.addEventListener('push', () => {});";
const bytes = (s: string) => new TextEncoder().encode(s).length;

function manifest(kp: { pk: string; sk: Uint8Array }, inhalt: string, o: { version?: string; releasedAt?: number; notiz?: string; mitSw?: boolean } = {}): NostrEvent {
  const artifacts = [{ name: "freedom.html", sha256: hashText(inhalt), sizeBytes: bytes(inhalt) }];
  if (o.mitSw ?? true) artifacts.push({ name: "freedom-sw.js", sha256: hashText(sw), sizeBytes: bytes(sw) });
  return signEvent(buildReleaseManifest({
    version: o.version ?? "2.0.0",
    releasedAt: o.releasedAt ?? 2000,
    artifacts,
    sources: ["https://3dagi.github.io/freedom-app/freedom.html"],
    notes: o.notiz,
  }, kp.pk, 1_700_000_000), kp.sk);
}

function gefaelscht(ev: NostrEvent): NostrEvent {
  return { ...ev, tags: ev.tags.map((t) => (t[0] === "artifact" && t[1] === "freedom.html" ? [t[0], t[1], hashText("<script>steal()</script>"), t[3]!] : t)) };
}

type Erwartet = { ok: { version: string; released_at: number } } | { fehler: "kein-beleg" | "zu-wenig" | "abweichend" | "nicht-neuer" };
const faelle: { name: string; html: string; laufend_seit: number; belege: NostrEvent[]; erwartet: Erwartet }[] = [
  {
    name: "zwei vertraute Signierer, Datei stimmt",
    html: html(2), laufend_seit: 1000,
    belege: [manifest(a, html(2)), manifest(b, html(2))],
    erwartet: { ok: { version: "2.0.0", released_at: 2000 } },
  },
  {
    name: "Notizen mit Steuerzeichen, Anführungszeichen und Emoji – Kennung nach NIP-01",
    html: html(2), laufend_seit: 0,
    belege: [manifest(a, html(2), { notiz: "Zeile 1\nZeile 2\t\"zitiert\" \\ ü 😀 \u0001  " }), manifest(c, html(2), { notiz: "</script>" })],
    erwartet: { ok: { version: "2.0.0", released_at: 2000 } },
  },
  {
    name: "der früheste Zeitpunkt der Signierer zählt",
    html: html(2), laufend_seit: 0,
    belege: [manifest(a, html(2), { releasedAt: 9000 }), manifest(b, html(2), { releasedAt: 2500 })],
    erwartet: { ok: { version: "2.0.0", released_at: 2500 } },
  },
  {
    name: "ein Signierer allein",
    html: html(2), laufend_seit: 0,
    belege: [manifest(a, html(2))],
    erwartet: { fehler: "zu-wenig" },
  },
  {
    name: "derselbe Signierer zweimal",
    html: html(2), laufend_seit: 0,
    belege: [manifest(a, html(2)), manifest(a, html(2), { notiz: "noch einmal" })],
    erwartet: { fehler: "zu-wenig" },
  },
  {
    name: "zweite Stimme von einem fremden Schlüssel",
    html: html(2), laufend_seit: 0,
    belege: [manifest(a, html(2)), manifest(fremd, html(2))],
    erwartet: { fehler: "zu-wenig" },
  },
  {
    name: "Prüfsumme nach dem Signieren geändert",
    html: html(2), laufend_seit: 0,
    belege: [manifest(a, html(2)), gefaelscht(manifest(b, html(2)))],
    erwartet: { fehler: "zu-wenig" },
  },
  {
    name: "fremdes Manifest unter vertrautem Schlüssel ausgegeben",
    html: html(2), laufend_seit: 0,
    belege: [manifest(a, html(2)), { ...manifest(fremd, html(2)), pubkey: b.pk }],
    erwartet: { fehler: "zu-wenig" },
  },
  {
    name: "uneinig über die Version",
    html: html(2), laufend_seit: 0,
    belege: [manifest(a, html(2), { version: "2.0.0" }), manifest(b, html(2), { version: "2.0.1" })],
    erwartet: { fehler: "zu-wenig" },
  },
  {
    name: "uneinig über die Dateien",
    html: html(2), laufend_seit: 0,
    belege: [manifest(a, html(2)), manifest(b, html(2), { mitSw: false })],
    erwartet: { fehler: "zu-wenig" },
  },
  {
    name: "die Datei ist eine andere als bestätigt",
    html: html(3), laufend_seit: 0,
    belege: [manifest(a, html(2)), manifest(b, html(2))],
    erwartet: { fehler: "abweichend" },
  },
  {
    name: "nicht neuer als die laufende Fassung",
    html: html(2), laufend_seit: 2000,
    belege: [manifest(a, html(2)), manifest(b, html(2))],
    erwartet: { fehler: "nicht-neuer" },
  },
  {
    name: "keine Belege",
    html: html(2), laufend_seit: 0,
    belege: [],
    erwartet: { fehler: "kein-beleg" },
  },
];

console.log(JSON.stringify({
  hinweis: "Erzeugt mit scripts/oberflaeche-vektoren.mts – nur Wegwerfschlüssel, nicht von Hand ändern.",
  vertraut: [a.pk, b.pk, c.pk],
  k: 2,
  faelle,
}, null, 1));
