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
  "geraete-buch.ts": 8,
  "geraete-modus.ts": 4,
  "identity.ts": 19,
  "local-tools.ts": 14,
  "mesh-radio.ts": 18,
  "mesh-transfer.ts": 1,
  "mls-engine.ts": 13,
  "mls-keypackage.ts": 1,
  "mls-nostr.ts": 1,
  "mls-speicher.ts": 3,
  "nachfolge.ts": 1,
  "onboarding.ts": 68,
  "relay-satz.ts": 5,
  "shell-logic.ts": 10,
  "shell/app.ts": 32,
  "shell/bunker.ts": 9,
  "shell/datenschutz.ts": 5,
  "shell/einrichtung-ui.ts": 8,
  "shell/mls-konto.ts": 10,
  "shell/nachfolge-ui.ts": 19,
  "shell/notfall.ts": 12,
  "shell/raum-mls.ts": 7,
  "shell/shims/crypto.ts": 2,
  "shell/shims/fs-promises.ts": 1,
  "shell/shims/reed-solomon.ts": 1,
  "shell/state.ts": 6,
  "shell/suche-ui.ts": 1,
  "shell/tresor.ts": 21,
  "shell/ui.ts": 4,
  "shell/versand.ts": 1,
  "suche.ts": 2,
  "vault.ts": 8,
};
