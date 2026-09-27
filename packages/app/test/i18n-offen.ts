/**
 * Offene Rohtexte (8.16) – dürfen nur sinken; fertig heißt 0. Jeder
 * Teilschritt setzt seine Bereiche und Dateien auf 0 bzw. streicht sie.
 * Eine Datei, die hier fehlt, ist fertig – auch jede neue.
 */

/** index.html je Bereich (Seite eines Tabs, sonst Rahmen). */
export const OFFEN_HTML: Record<string, number> = {
  rahmen: 0,
  "page-ai": 0,
  "page-comm": 0,
  "page-wallet": 0,
  "page-earn": 0,
  "page-profile": 0,
  "page-settings": 0,
};

/** Code je Datei (relativ zu src/). */
export const OFFEN_CODE: Record<string, number> = {
  "local-tools.ts": 14,
  "mesh-radio.ts": 18,
  "mesh-transfer.ts": 1,
  "mls-engine.ts": 13,
  "mls-keypackage.ts": 1,
  "mls-nostr.ts": 1,
  "mls-speicher.ts": 3,
  "shell/datenschutz.ts": 5,
  "shell/mls-konto.ts": 10,
  "shell/raum-mls.ts": 7,
  "shell/shims/crypto.ts": 2,
  "shell/shims/fs-promises.ts": 1,
  "shell/shims/reed-solomon.ts": 1,
};
