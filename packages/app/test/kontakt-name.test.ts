/**
 * Schritt C-33 (Nutzertest C-8, C-2, R-2, G-4): Namen von Kontakten. Profilnamen (Kind 0)
 * erscheinen mit „~“, „Anfrage · …“ endet mit der ersten Antwort, der Prüfung oder einem
 * eigenen Namen, und Raum, Umfrage und Repo nennen nie „Anfrage“. Den Ablauf im Browser
 * prüft der Smoke-Test „kontaktname“.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { displayWithSource } from "@freedomstack/protocol";
import {
  istAnfrage, istAnfrageName, istPlatzhalterName, kontaktAnzeige, kontaktInitiale, kontaktKurzName, neuesteProfilNamen, profilNameAus,
} from "../src/kontakt-name.js";
import { pkShort } from "../src/shell-logic.js";
import { setLang, t } from "../src/i18n.js";

setLang("de");
const PK = "2a".repeat(32);
const quelle = (pfad: string) => readFileSync(new URL(pfad, import.meta.url), "utf8");
const profil = (inhalt: unknown, created_at = 100, pubkey = PK) => ({ pubkey, created_at, content: JSON.stringify(inhalt) });

test("Profilname: display_name vor name, nur Text, kurz, ohne unsichtbare Zeichen und gemischte Schriften", () => {
  assert.equal(profilNameAus(profil({ name: "ada", display_name: "Ada L." })), "Ada L.");
  assert.equal(profilNameAus(profil({ name: "ada" })), "ada");
  assert.equal(profilNameAus(profil({ displayName: "Ada" })), "Ada");
  assert.equal(profilNameAus(profil({ display_name: "  ", name: "ada" })), "ada", "leerer Anzeigename → name");
  assert.equal(profilNameAus(profil({ name: "<b>Ada</b>" })), "<b>Ada</b>", "HTML bleibt Text – gezeigt wird nur über textContent");
  assert.equal(profilNameAus(profil({ name: "x".repeat(80) }))?.length, 40);
  assert.equal(profilNameAus(profil({ name: "A​da" })), undefined, "unsichtbare Zeichen");
  assert.equal(profilNameAus(profil({ name: "Pаypal" })), undefined, "lateinisch mit kyrillischem а");
  assert.equal(profilNameAus(profil({ name: 42 })), undefined);
  assert.equal(profilNameAus(profil(["ada"])), undefined);
  assert.equal(profilNameAus({ content: "kein json" }), undefined);
  assert.equal(profilNameAus(profil(null)), undefined);
});

test("je Schlüssel gilt das neueste Profil – hat es keinen Namen, gibt es keinen", () => {
  const b = "3b".repeat(32);
  const namen = neuesteProfilNamen([profil({ name: "Alt" }, 10), profil({ name: "Neu" }, 20), profil({ name: "Bea" }, 5, b)]);
  assert.deepEqual([...namen], [[PK, "Neu"], [b, "Bea"]]);
  assert.equal(neuesteProfilNamen([profil({ name: "Alt" }, 10), profil({ about: "ohne Namen" }, 20)]).size, 0);
});

test("Platzhalter und Anfragen aus der Zeit vor C-33 erkannt – in beiden Sprachen", () => {
  assert.ok(istAnfrageName(`Anfrage · ${pkShort(PK)}`, PK));
  assert.ok(istAnfrageName(`Request · ${pkShort(PK)}`, PK));
  assert.ok(!istAnfrageName("Anfrage · Ada", PK));
  for (const n of [pkShort(PK), PK.slice(0, 12) + "…", `Anfrage · ${pkShort(PK)}`, "", " "]) assert.ok(istPlatzhalterName(n, PK), n);
  assert.ok(!istPlatzhalterName("Ada", PK));
  assert.ok(istAnfrage({ id: PK, name: `Anfrage · ${pkShort(PK)}` }), "alt: am Namen");
  assert.ok(!istAnfrage({ id: PK, name: `Anfrage · ${pkShort(PK)}`, anfrage: false }), "das Merkmal gilt vor dem Namen");
  assert.ok(istAnfrage({ id: PK, name: pkShort(PK), anfrage: true }));
});

test("Anzeige: eigener Name, sonst „~Profilname“, sonst Schlüssel – „Anfrage · “ nur, solange es eine ist", () => {
  assert.equal(kontaktAnzeige({ id: PK, name: pkShort(PK), anfrage: true, profil: "Ada" }), "Anfrage · ~Ada");
  assert.equal(kontaktAnzeige({ id: PK, name: pkShort(PK), anfrage: false, profil: "Ada" }), "~Ada");
  assert.equal(kontaktAnzeige({ id: PK, name: "Ada Lovelace", profil: "ada" }), "Ada Lovelace", "eigener Name schlägt den Profilnamen");
  assert.equal(kontaktAnzeige({ id: PK, name: `Anfrage · ${pkShort(PK)}` }), `Anfrage · ${pkShort(PK)}`, "alte Anfrage ohne Profil bleibt lesbar");
  assert.equal(kontaktAnzeige({ id: PK, name: `Anfrage · ${pkShort(PK)}`, profil: "Ada" }), "Anfrage · ~Ada");
  // Raum, Umfrage, Repo: nie „Anfrage“
  assert.equal(kontaktKurzName({ id: PK, name: pkShort(PK), anfrage: true, profil: "Ada" }), "~Ada");
  assert.equal(kontaktKurzName({ id: PK, name: pkShort(PK), anfrage: true }), pkShort(PK));
  setLang("en");
  assert.equal(kontaktAnzeige({ id: PK, name: pkShort(PK), anfrage: true, profil: "Ada" }), "Request · ~Ada");
  setLang("de");
});

test("das runde Zeichen: erster Buchstabe des Namens – nie „~“, nie „A“ aus „Anfrage“, ganze Zeichen", () => {
  assert.equal(kontaktInitiale({ id: PK, name: pkShort(PK), anfrage: true, profil: "bea" }), "B");
  assert.equal(kontaktInitiale({ id: PK, name: `Anfrage · ${pkShort(PK)}` }), "2");
  assert.equal(kontaktInitiale({ id: PK, name: "🦊 Fuchs" }), "🦊");
});

test("„so nennen ihn … deiner Kontakte“: Text der App wortgleich mit dem Protokoll", () => {
  const r = { pubkey: PK, display: "Max", source: "bekanntenkreis" as const, agreement: 3, alternatives: [] };
  assert.equal(t("komm.nameBekannt", { name: r.display, n: r.agreement }), displayWithSource(r));
});

test("verdrahtet: Profile bei den Autoren, Anfrage als Merkmal, endet mit Antwort, Prüfung und eigenem Namen", () => {
  const kontakte = quelle("../src/shell/tabs/kontakte.ts");
  assert.match(kontakte, /frageBeiAutoren\(\{ kinds: \[0\], authors: pks, limit: pks\.length \* 2 \}\)/, "Kind 0 nur über die Outbox (5.4b)");
  assert.match(kontakte, /selfNames: profile/);
  assert.match(kontakte, /: profile\.has\(pk\) \? `~\$\{r\.display\}`/);
  assert.doesNotMatch(kontakte, /displayWithSource/, "deutscher Satz aus dem Protokoll – die App baut ihn selbst");
  const ein = quelle("../src/shell/tabs/posteingang.ts");
  assert.equal(ein.match(/name: pkShort\((r|e)\.partner\), anfrage: true,/g)?.length, 2, "MLS-Einladung und NIP-17");
  const komm = quelle("../src/shell/tabs/kommunikation.ts");
  assert.match(komm, /c\.lastTs = Math\.floor\(Date\.now\(\) \/ 1000\);\n[^\n]*\n\s+if \(c\.type === "dm"\) nimmAnfrageAn\(c\.id\);/, "nach dem Senden");
  assert.match(komm, /if \(name\.trim\(\)\) c\.anfrage = false;/, "eigener Name");
  assert.match(quelle("../src/shell/app.ts"), /if \(await pruefeKontakt\(c\.id, kontaktKurzName\(c\)\)\) nimmAnfrageAn\(c\.id\);/, "Prüfung");
  assert.match(quelle("../src/shell/tabs/raeume.ts"), /if \(c\) return kontaktKurzName\(c\);/, "Raum, Umfrage, Repo");
});
