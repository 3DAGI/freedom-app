/**
 * Leak-Szenario „Datei anhaengen“ (Schritt 1.5): der echte Upload der App
 * (`uploadBlob` aus `blob-client.ts`, aufgerufen von `handleChatFiles()` und
 * dem Git-Bundle), mitgeschnitten am Pool. Heute liegen die Chunks im Klartext –
 * Schritt 2.4 verschluesselt sie. Kleine Anhaenge reisen als data-URL in der
 * Nachricht selbst; der Blossom-Ausweg laeuft ueber HTTP und ist hier nicht
 * mitgeschnitten – beides gehoert ebenfalls zu 2.4.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LocalSigner, generateKeypair, regelKeinKind4, regelUploadVerschluesselt } from "@freedomstack/protocol";
import { uploadBlob } from "../../src/blob-client.js";
import { aufzeichnung } from "./aufzeichnung.js";

async function lade() {
  const { pool, relay } = aufzeichnung();
  const inhalt = crypto.getRandomValues(new Uint8Array(5000));
  await uploadBlob(new File([inhalt], "bericht.pdf", { type: "application/pdf" }), pool, new LocalSigner(generateKeypair().sk));
  return { gesendet: relay.gesendet, inhalt };
}

test("Anhang: der Upload geht ueber den Pool", async () => {
  const { gesendet } = await lade();
  assert.ok(gesendet.length >= 2, "Chunks und Manifest");
  assert.deepEqual(regelKeinKind4(gesendet), []);
});

test("Anhang: nur verschluesselt", { todo: "Schritt 2.4" }, async () => {
  const { gesendet, inhalt } = await lade();
  assert.deepEqual(regelUploadVerschluesselt(gesendet, inhalt), []);
});

test("Verdrahtung: Chat-Anhang und Git-Bundle laden ueber uploadBlob", () => {
  const kom = readFileSync(new URL("../../src/shell/tabs/kommunikation.ts", import.meta.url), "utf8");
  const app = readFileSync(new URL("../../src/shell/app.ts", import.meta.url), "utf8");
  assert.match(kom, /uploadBlob\(file, pool as never, state\.signer!\)/);
  assert.match(app, /uploadBlob\(\s*new File\(/);
});
