/**
 * Tests fuer das Onboarding.
 *
 * Die Reihenfolge der Schritte ist hier die eigentliche Entscheidung — sie
 * bestimmt, wie viele Menschen an der ersten Huerde abbrechen. Deshalb pruefen
 * die Tests vor allem, dass nichts zu frueh verlangt wird.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextStep, pitchFor, providerNextStep, Readiness } from "../src/onboarding.js";

const neu: Readiness = {
  hasIdentity: true, backedUp: false, hasVault: false, hasWallet: false,
  hasUsedOnce: false, gratisErschoepft: false,
};

test("Neuer Nutzer wird NICHT nach einer Wallet gefragt", () => {
  // Wer noch nie etwas gemacht hat, hat keinen Grund, eine einzurichten.
  // Hier zu fragen ist der teuerste Fehler im ganzen Ablauf.
  const s = nextStep(neu);
  assert.equal(s.id, "los");
  assert.notEqual(s.id, "wallet");
  assert.match(s.body, /kostenlos|nichts einzurichten/);
});

test("Neuer Nutzer wird NICHT zuerst zur Sicherung gedraengt", () => {
  // Er hat noch nichts zu verlieren — die Warnung waere Laerm.
  assert.notEqual(nextStep(neu).id, "sichern");
});

test("Nach der ersten Nutzung kommt die Sicherung — und zwar als Warnung", () => {
  const s = nextStep({ ...neu, hasUsedOnce: true });
  assert.equal(s.id, "sichern");
  assert.equal(s.urgency, "warnung");
  assert.match(s.body, /niemanden, der das zurücksetzen kann/);
});

test("8.1a: Sicherung nennt, was wirklich geht – Merkphrase nur, solange sie auf dem Geraet liegt", () => {
  const mit = nextStep({ ...neu, hasUsedOnce: true, merkphraseDa: true });
  assert.equal(mit.action, "Merkphrase anzeigen");
  assert.match(mit.body, /Zwölf Wörter/);
  const ohne = nextStep({ ...neu, hasUsedOnce: true });
  assert.equal(ohne.action, "Sicherungsdatei speichern");
  assert.doesNotMatch(ohne.body, /Zwölf Wörter/, "ohne gespeicherte Merkphrase keine Woerter versprechen");
});

test("8.1a: kein erfundener Zaehler fuer Gratis-Anfragen", () => {
  for (const gratisErschoepft of [true, false]) {
    for (const hasUsedOnce of [true, false]) {
      const s = nextStep({ ...neu, hasUsedOnce, backedUp: true, hasVault: true, gratisErschoepft });
      assert.doesNotMatch(s.body, /Noch \d+|\d+ Gratis/, s.body);
    }
  }
});

test("Sicherung ist ueberspringbar, aber nicht unsichtbar", () => {
  const s = nextStep({ ...neu, hasUsedOnce: true });
  assert.equal(s.skippable, true, "niemanden einsperren");
  assert.ok(s.action, "aber einen Weg anbieten");
});

test("Wallet wird erst verlangt, wenn kein Provider mehr gratis antwortet", () => {
  const nochGratis = nextStep({ ...neu, hasUsedOnce: true, backedUp: true, hasVault: true, gratisErschoepft: false });
  assert.equal(nochGratis.skippable, true);
  assert.equal(nochGratis.urgency, "info");
  assert.match(nochGratis.title, /Später/);

  const leer = nextStep({ ...neu, hasUsedOnce: true, backedUp: true, hasVault: true, gratisErschoepft: true });
  assert.equal(leer.id, "wallet");
  assert.equal(leer.skippable, false, "jetzt ist die Frage berechtigt");
});

test("Verdienen-Absicht fuehrt zur Anleitung, nicht zur Wallet-Frage", () => {
  const s = nextStep({ ...neu, hasUsedOnce: true, backedUp: true, hasVault: true }, "verdienen");
  assert.equal(s.id, "provider-anleitung");
  // Ehrlich statt werbend: ohne GPU lohnt es sich kaum.
  assert.match(s.body, /GPU/);
});

test("Sicherung geht auch der Verdienen-Absicht vor", () => {
  // Wer vermietet, hat Einnahmen — ein Verlust waere dort besonders teuer.
  const s = nextStep({ ...neu, hasUsedOnce: true, backedUp: false }, "verdienen");
  assert.equal(s.id, "sichern");
});

// ------------------------------------------------------------- Tresor (Schritt 1.2)

test("Tresor kommt erst nach der ersten Nutzung und nach der Sicherung", () => {
  // Entscheidung zu 1.2: erst benutzen, dann einrichten.
  assert.equal(nextStep(neu).id, "los");
  assert.equal(nextStep({ ...neu, hasUsedOnce: true }).id, "sichern");
  const s = nextStep({ ...neu, hasUsedOnce: true, backedUp: true });
  assert.equal(s.id, "tresor");
  assert.equal(s.skippable, true, "angeboten, nicht erzwungen");
  assert.equal(s.urgency, "hinweis");
  assert.match(s.body, /unverschlüsselt/);
  assert.ok(s.action);
});

test("Tresor geht der Wallet-Frage und der Verdienen-Anleitung vor", () => {
  // Wallet-Zugaenge kommen in den Tresor – also erst der Tresor.
  const r = { ...neu, hasUsedOnce: true, backedUp: true, gratisErschoepft: true };
  assert.equal(nextStep(r).id, "tresor");
  assert.equal(nextStep(r, "verdienen").id, "tresor");
  assert.equal(nextStep({ ...r, hasVault: true }).id, "wallet");
});

test("Mit Tresor, aber ohne Sicherung: zuerst die Sicherung", () => {
  // Ein Tresor ohne Merkphrase ist bei vergessener Passphrase verloren.
  assert.equal(nextStep({ ...neu, hasUsedOnce: true, hasVault: true }).id, "sichern");
});

test("Alles erledigt: kein erfundener naechster Schritt", () => {
  const s = nextStep({
    hasIdentity: true, backedUp: true, hasVault: true, hasWallet: true, hasUsedOnce: true, gratisErschoepft: true,
  });
  assert.equal(s.id, "fertig");
  assert.equal(s.action, undefined, "keine Beschaeftigungstherapie");
});

test("Es gibt IMMER genau einen naechsten Schritt", () => {
  // Eine Liste von acht offenen Punkten schreckt ab, obwohl man sieben davon
  // nie braucht.
  const kombis: Readiness[] = [];
  for (const backedUp of [true, false]) {
    for (const hasVault of [true, false]) {
      for (const hasWallet of [true, false]) {
        for (const hasUsedOnce of [true, false]) {
          for (const gratisErschoepft of [true, false]) {
            kombis.push({ hasIdentity: true, backedUp, hasVault, hasWallet, hasUsedOnce, gratisErschoepft });
          }
        }
      }
    }
  }
  for (const r of kombis) {
    for (const intent of ["unbekannt", "nutzen", "verdienen", "kommunizieren"] as const) {
      const s = nextStep(r, intent);
      assert.ok(s.title.length > 0 && s.body.length > 0, JSON.stringify(r));
    }
  }
});

// ------------------------------------------------------------- Erklaerung

test("Erklaerung passt zum Vorhaben", () => {
  assert.match(pitchFor("nutzen").headline, /ohne Konto/);
  assert.match(pitchFor("verdienen").headline, /vermieten/);
  assert.match(pitchFor("kommunizieren").headline, /Nachrichten/);
  assert.ok(pitchFor("unbekannt").points.length >= 3);
});

test("Erklaerung verspricht nichts Unhaltbares", () => {
  // Kein "unzensierbar", kein "fuer immer" — Begriffe, die eine Behoerde
  // aufmerksam machen und Nutzer anziehen, die man nicht will.
  for (const i of ["nutzen", "verdienen", "kommunizieren", "unbekannt"] as const) {
    const text = pitchFor(i).headline + " " + pitchFor(i).points.join(" ");
    assert.doesNotMatch(text, /unzensierbar|unabschaltbar|für immer/i);
  }
});

// ------------------------------------------------------------- Provider

test("Provider: zuerst die Auszahlungsadresse", () => {
  // Ohne sie arbeitet der Knoten und das Geld geht nirgendwo hin.
  const s = providerNextStep({ ollama: true, lightningAddress: false, gpu: true });
  assert.match(s.title, /Auszahlungsadresse/);
});

test("Provider: fehlende Software kommt mit kopierbarem Befehl", () => {
  // "Installiere Ollama" ist keine Anleitung. Ein Befehl ist eine.
  const s = providerNextStep({ ollama: false, lightningAddress: true, gpu: true });
  assert.ok(s.command);
  assert.match(s.command!, /ollama/);
});

test("Provider: ohne GPU wird vorher gewarnt, nicht hinterher enttaeuscht", () => {
  const s = providerNextStep({ ollama: true, lightningAddress: true, gpu: false });
  assert.match(s.body, /langsam/);
  assert.match(s.body, /Enttäuschung|kaum ein Kunde/);
});

test("Provider: bereit heisst ein Befehl", () => {
  const s = providerNextStep({ ollama: true, lightningAddress: true, gpu: true });
  assert.match(s.title, /Bereit/);
  assert.match(s.command!, /install\.sh/);
  assert.match(s.command!, /NODE_LUD16/);
});
