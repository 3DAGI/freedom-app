/**
 * Schritt 2.3a: Räume als MLS-Gruppen mit der echten MDK-Engine – was die
 * Karte verlangt: 50 Mitglieder, Entfernen samt Schlüsselwechsel,
 * Moderatorrechte. Dazu innere Events mit Art und Tags (Kanäle, Rollenliste)
 * und die von MLS belegte Admin-Angabe (nur bei Moderations-Arten, 4891).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { schnorr } from "@noble/curves/secp256k1.js";
import {
  LocalSigner, fromHex, generateKeypair, gruppenRaum, raumDefinition, raumLoeschung, raumNachricht, raumRollen, toHex, type NostrEvent,
} from "@freedomstack/protocol";
import { ART_CHAT, Mls, ladeMls, type MlsNachricht, type MlsSenden } from "../src/index.js";

ladeMls(gunzipSync(readFileSync(new URL("../dist/freedom_mls_bg.wasm.gz", import.meta.url))));

const RELAYS = ["wss://nostr.mom", "wss://offchain.pub"];
const schlafe = (ms: number) => new Promise((r) => setTimeout(r, ms));

function person() {
  const kp = generateKeypair();
  const signer = new LocalSigner(kp.sk);
  const beweis = (idHex: string) => toHex(schnorr.sign(fromHex(idHex), kp.sk));
  return { pk: kp.pk, signer, mls: new Mls(signer, beweis) };
}
type Person = ReturnType<typeof person>;

const keyPackage = async (p: Person) => p.signer.signEvent(await p.mls.keyPackage("geraet-1"));
const fuer = (einladungen: NostrEvent[], pk: string) => einladungen.find((e) => e.tags.some((t) => t[0] === "p" && t[1] === pk))!;

/** Ein Commit (oder eine Nachricht) an alle: erst empfangen, dann einmal warten, dann fortschreiten. */
async function anAlle(leute: Person[], gruppe: string, s: MlsSenden): Promise<Map<string, MlsNachricht[]>> {
  const bekommen = new Map<string, MlsNachricht[]>();
  for (const p of leute) {
    const r = await p.mls.empfangen(s.events[0]!).catch(() => ({ nachrichten: [] as MlsNachricht[] }));
    bekommen.set(p.pk, [...r.nachrichten]);
  }
  const warten = Math.max(0, ...leute.map((p) => p.mls.wartezeit(gruppe) ?? 0));
  if (warten > 0) await schlafe(warten + 20);
  for (const p of leute) {
    if (p.mls.wartezeit(gruppe) === undefined && warten === 0) continue;
    const f = await p.mls.fortschreiten(gruppe).catch(() => ({ nachrichten: [] as MlsNachricht[] }));
    bekommen.get(p.pk)!.push(...f.nachrichten);
  }
  return bekommen;
}

test("Raum mit 50 Mitgliedern: Kanäle als innere Events, Entfernen mit Schlüsselwechsel, Moderatorrechte", { timeout: 600_000 }, async () => {
  const gruender = person();
  const moderator = person();
  const andere = Array.from({ length: 48 }, person);
  const eingeladen = [moderator, ...andere];
  const g = await gruender.mls.gruppeAnlegen("Werkstatt", await Promise.all(eingeladen.map(keyPackage)), RELAYS, [moderator.pk]);
  for (const p of eingeladen) assert.equal(await p.mls.beitreten(fuer(g.einladungen, p.pk)), g.gruppe);
  const alle = [gruender, ...eingeladen];
  assert.equal(gruender.mls.mitglieder(g.gruppe).length, 50);
  assert.deepEqual(andere[0]!.mls.admins(g.gruppe), [gruender.pk, moderator.pk].sort());

  // Kanäle und Rollenliste als innere Events vom Gründer – bei allen mit Art und Tags
  const def = raumDefinition(g.gruppe, { name: "Werkstatt", kanaele: [
    { id: "allgemein", name: "allgemein", privacy: "verschluesselt", writeRoles: [], position: 0 },
    { id: "ankuendigungen", name: "ankündigungen", privacy: "verschluesselt", writeRoles: ["mod"], position: 1 },
  ] });
  const rollen = raumRollen(g.gruppe, [{ id: "mod", name: "Moderator", rank: 50, permissions: ["lesen", "schreiben", "moderieren"] }]);
  const d = await gruender.mls.sendenEvent(g.gruppe, def.art, def.tags, def.text);
  const r = await gruender.mls.sendenEvent(g.gruppe, rollen.art, rollen.tags, rollen.text);
  const nachDef = await anAlle(eingeladen, g.gruppe, d);
  const nachRollen = await anAlle(eingeladen, g.gruppe, r);
  const beiLetzter = [...nachDef.get(andere[47]!.pk)!, ...nachRollen.get(andere[47]!.pk)!];
  assert.deepEqual(beiLetzter.map((n) => [n.art, n.von, n.admin]), [[def.art, gruender.pk, undefined], [rollen.art, gruender.pk, undefined]]);
  assert.deepEqual(beiLetzter[0]!.tags, def.tags);

  // Ein Mitglied schreibt – kein Admin; ein Mitglied versucht eine eigene Definition: verworfen
  const hallo = raumNachricht({ kanal: "allgemein", text: "hallo" });
  const fremdDef = raumDefinition(g.gruppe, { name: "Übernommen", kanaele: [] });
  const m1 = await andere[0]!.mls.sendenEvent(g.gruppe, hallo.art, hallo.tags, hallo.text);
  const m2 = await andere[1]!.mls.sendenEvent(g.gruppe, fremdDef.art, fremdDef.tags, fremdDef.text);
  const beiMod = [...beiLetzter, ...(await anAlle([moderator], g.gruppe, m1)).get(moderator.pk)!, ...(await anAlle([moderator], g.gruppe, m2)).get(moderator.pk)!];
  assert.equal(beiMod.at(-2)!.art, ART_CHAT);
  const raum = gruppenRaum(g.gruppe, beiMod, { admins: moderator.mls.admins(g.gruppe), mitglieder: moderator.mls.mitglieder(g.gruppe) });
  assert.equal(raum.zustand.space?.name, "Werkstatt", "Definition eines Nicht-Admins zählt nicht");
  assert.deepEqual(raum.nachrichten.map((m) => m.content), ["hallo"]);

  // Moderatorrechte: ein Mitglied darf nicht entfernen und keine Admins setzen
  await assert.rejects(andere[0]!.mls.entfernen(g.gruppe, [andere[1]!.pk]));
  await assert.rejects(andere[0]!.mls.adminsSetzen(g.gruppe, [andere[0]!.pk]));

  // Der Moderator entfernt ein Mitglied – Commit an alle, neue Epoche
  const epoche = gruender.mls.epoche(g.gruppe);
  const raus = andere[47]!;
  const rm = await moderator.mls.entfernen(g.gruppe, [raus.pk]);
  await moderator.mls.bestaetigt(rm.ausstehend!);
  await anAlle(alle.filter((p) => p !== moderator), g.gruppe, rm);
  assert.equal(gruender.mls.mitglieder(g.gruppe).length, 49);
  assert.ok(!andere[0]!.mls.mitglieder(g.gruppe).includes(raus.pk));
  assert.ok(gruender.mls.epoche(g.gruppe) > epoche, "neue Epoche – neuer Schlüssel");

  // Danach: alle lesen, das entfernte Mitglied nicht
  const danach = raumNachricht({ kanal: "allgemein", text: "ohne dich" });
  const s = await gruender.mls.sendenEvent(g.gruppe, danach.art, danach.tags, danach.text);
  const gelesen = await anAlle(alle.filter((p) => p !== gruender), g.gruppe, s);
  for (const p of alle.filter((q) => q !== gruender && q !== raus)) assert.deepEqual(gelesen.get(p.pk)!.map((n) => n.text), ["ohne dich"]);
  assert.equal(gelesen.get(raus.pk)!.length, 0, "entfernt – liest nichts mehr");

  // Moderator ernennen: nur per Commit eines Admins; danach löscht er mit belegtem Admin-Stand
  const neu = andere[2]!;
  const hoch = await gruender.mls.adminsSetzen(g.gruppe, [gruender.pk, moderator.pk, neu.pk]);
  await gruender.mls.bestaetigt(hoch.ausstehend!);
  const rest = alle.filter((p) => p !== gruender && p !== raus);
  await anAlle(rest, g.gruppe, hoch);
  assert.deepEqual(andere[5]!.mls.admins(g.gruppe), [gruender.pk, moderator.pk, neu.pk].sort());
  const loeschen = raumLoeschung(beiMod.at(-2)!.id, true);
  const l = await neu.mls.sendenEvent(g.gruppe, loeschen.art, loeschen.tags, loeschen.text);
  const beiAnderen = (await anAlle([andere[5]!], g.gruppe, l)).get(andere[5]!.pk)!;
  assert.deepEqual(beiAnderen.map((n) => [n.art, n.admin]), [[4891, true]], "MLS belegt: beim Senden Admin");
  // Ein Mitglied, das „als Admin“ löschen will: schon die Engine sendet das nicht
  await assert.rejects(andere[6]!.mls.sendenEvent(g.gruppe, loeschen.art, loeschen.tags, loeschen.text), /admin authority required/);
});

test("Innere Events: Art prüft der Wrapper, Tags kommen unverändert an; Chat bleibt Art 9 ohne Tags", async () => {
  const [a, b] = [person(), person()];
  const g = await a.mls.gruppeAnlegen("", [await keyPackage(b)], RELAYS);
  await b.mls.beitreten(g.einladungen[0]!);
  await assert.rejects(a.mls.sendenEvent(g.gruppe, -1, [], "x"), /Art ungültig/);
  await assert.rejects(a.mls.sendenEvent(g.gruppe, 1.5, [], "x"), /Art ungültig/);
  const chat = await a.mls.senden(g.gruppe, "hallo");
  const n = (await b.mls.empfangen(chat.events[0]!)).nachrichten;
  assert.deepEqual(n.map((x) => [x.art, x.tags, x.text, x.admin]), [[ART_CHAT, [], "hallo", undefined]]);
  const tags = [["h", "kanal"], ["e", "x".repeat(64), "", "root"]];
  const ev = await a.mls.sendenEvent(g.gruppe, 1984, tags, "Meldung");
  const m = (await b.mls.empfangen(ev.events[0]!)).nachrichten;
  assert.deepEqual(m.map((x) => [x.art, x.tags, x.text]), [[1984, tags, "Meldung"]]);
  // Relays sehen nur Kind 445 – Art und Tags stecken im Chiffrat
  assert.equal(ev.events[0]!.kind, 445);
  assert.ok(!JSON.stringify(ev.events[0]).includes("Meldung") && !JSON.stringify(ev.events[0]).includes("kanal"));
});
