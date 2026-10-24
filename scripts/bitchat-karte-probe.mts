// Bitchat-Code eines Gegenübers für Browser-Prüfungen (seit B-36e2): eine Bitchat-Karte (BC-W5 A) von einem
// Wegwerfschlüssel mit festen Bitchat-Schlüsseln. Nur für smoke_test.py.
// Aufruf: npx tsx scripts/bitchat-karte-probe.mts  ->  {"person": "<hex>", "noise": "<hex>", "signier": "<hex>", "karte": "freedom-bitchat:1:…"}
import { LocalSigner, baueBitchatKarte, generateKeypair } from "../packages/protocol/src/index.ts";

const person = new LocalSigner(generateKeypair().sk);
const noise = "5a".repeat(32);
const signier = "c3".repeat(32);
const karte = await baueBitchatKarte({ von: person, noise, signier });
if (!karte) throw new Error("keine Karte");
console.log(JSON.stringify({ person: person.publicKey(), noise, signier, karte }));
