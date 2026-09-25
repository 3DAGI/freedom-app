/**
 * Leak-Szenario „Datei anhaengen“ (Schritt 1.5, seit 2.4 verschluesselt): der
 * echte Upload der App fuer Chat-Anhaenge (`uploadAnhang` aus
 * `blob-client.ts`, aufgerufen von `handleChatFiles()`), mitgeschnitten am
 * Pool. Ins Blob-Netz geht nur Chiffrat, ohne Name und Typ; der Schluessel
 * reist in der Nachricht. Der Blossom-Ausweg verschluesselt genauso (siehe
 * Verdrahtung). Das Git-Bundle ist mit Absicht oeffentlich (`uploadBlob`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LocalSigner, generateKeypair, regelKeinKind4, regelKeinKlartext, regelUploadVerschluesselt,
} from "@freedomstack/protocol";
import { downloadBlob, oeffneAnhang, uploadAnhang } from "../../src/blob-client.js";
import { aufzeichnung } from "./aufzeichnung.js";

async function lade() {
  const { pool, relay } = aufzeichnung();
  const inhalt = crypto.getRandomValues(new Uint8Array(50_000));
  const res = await uploadAnhang(new File([inhalt], "bericht.pdf", { type: "application/pdf" }), pool, new LocalSigner(generateKeypair().sk));
  return { gesendet: relay.gesendet, inhalt, pool, res };
}

test("Anhang: der Upload geht ueber den Pool", async () => {
  const { gesendet } = await lade();
  assert.ok(gesendet.length >= 2, "Chunks und Manifest");
  assert.deepEqual(regelKeinKind4(gesendet), []);
});

test("Anhang: nur verschluesselt – kein Inhalt, kein Name, kein Typ", async () => {
  const { gesendet, inhalt } = await lade();
  assert.deepEqual(regelUploadVerschluesselt(gesendet, inhalt), []);
  assert.deepEqual(regelKeinKlartext(gesendet, ["bericht.pdf", "application/pdf"]), []);
});

test("Anhang: der Empfaenger laedt und oeffnet ihn mit dem Schluessel aus der Nachricht", async () => {
  const { inhalt, pool, res } = await lade();
  const geladen = await downloadBlob(res.blobId, pool as never);
  assert.ok(geladen, "Blob rekonstruiert");
  assert.notDeepEqual(geladen.bytes, inhalt, "im Netz liegt Chiffrat");
  assert.deepEqual(await oeffneAnhang(geladen.bytes, res.schluessel), inhalt);
  const kaputt = geladen.bytes.slice();
  kaputt[0] ^= 1;
  await assert.rejects(oeffneAnhang(kaputt, res.schluessel), /beschädigt/);
});

test("Verdrahtung: Chat-Anhang verschluesselt (Blob-Netz und Blossom), Git-Bundle offen", () => {
  const kom = readFileSync(new URL("../../src/shell/tabs/kommunikation.ts", import.meta.url), "utf8");
  const app = readFileSync(new URL("../../src/shell/app.ts", import.meta.url), "utf8");
  const f = kom.slice(kom.indexOf("export async function handleChatFiles("), kom.indexOf("function setAttachStatus("));
  assert.match(f, /uploadAnhang\(file, pool as never, state\.signer!\)/);
  assert.match(f, /uploadToBlossom\(new File\(\[chiffrat as BlobPart\], "", \{ type: "application\/octet-stream" \}\)\)/);
  assert.doesNotMatch(f, /uploadBlob\(|uploadToBlossom\(file\)/, "kein Klartext-Upload mehr");
  assert.match(f, /file\.size <= INLINE_MAX_BYTES/);
  // Der Knopf oeffnet mit dem Schluessel aus der Nachricht
  assert.match(kom, /bytes: await oeffneAnhang\(chiffrat, schluessel\)/);
  assert.match(kom, /\.\.\.imetaSchluessel\(a\)/);
  // Git-Bundle: mit Absicht oeffentlich
  assert.match(app, /uploadBlob\(\s*new File\(/);
});
