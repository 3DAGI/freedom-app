/**
 * Kasse im Raum (A-12, `docs/KASSE-ENTWURF.md`) – App, Teil b2a: die eigene Adresse für die Kasse nennen.
 *
 * Wer das Recht „kasse“ hat (W4), nennt dem Raum eine frische Adresse der eingebauten Wallet (V4, nie die
 * Hauptadresse) samt Nachweis dieser Adresse (`kassenNachweis()`): offen als Kind 34704 an die Adresse des
 * Raums, privat nur als inneres Event der Gruppe. Vorher sagt die App, was öffentlich wird (V5). Teil b2b: Gründer
 * (offen) bzw. Admin (privat) legt die Kasse an – Mitglieder sind die genannten Adressen derer mit dem Recht – und
 * schreibt sie in die Definition. Teil b2c: den Stand von der Kette zeigen (mit Abweichungen zum Raum) und einzahlen.
 * A-12c1: Auszahlungen vorschlagen, abstimmen, ausführen und abschließen – Empfänger und Betrag von der Kette (V6).
 * A-12c2: Einen neuen Vorschlag meldet die App im Raum – nur mit seiner Nummer (V6).
 * A-12c3: Abstimmen und auszahlen auch mit einer verbundenen Wallet, deren Adresse die für die Kasse ist.
 * Die Oberfläche baut Spur C (A-12e). Als Gerät nie – die Kasse gehört der Person.
 */
import {
  KASSEN_ZEITSCHLOSS_SEK, KIND_KASSEN_ADRESSE, KIND_SPACE, RAUM_KASSEN_RECHT, baueKassenAdresse, buildChannelMessage, buildEvent, can, istSolAdresse,
  kassenAbweichungen, kassenAdressenOffen, kassenAdressenPrivat, kassenAenderungen, kassenArt, kassenHinweisKanal, kassenNachweisNachricht, kassenOrt,
  kassenTresor, leseGuthaben, leseKasse, leseRaumAdresse, leseVorschlaege, mitKassenRecht, mitKassenTag, pruefeKassenNachweis, raumKassenAdresse, type Auszahlung,
  type KassenAbweichungen, type KassenSchritt, type KassenStand, type SpaceState,
} from "@freedomstack/protocol";
import { bytesToHex } from "@noble/hashes/utils.js";
import { t } from "../i18n.js";
import { aenderungenText, kassenAktionen, kassenStandText, vorschlaegeText, zeitschlossText } from "../kasse-anzeige.js";
import type { SolAnbieter } from "../solana-connect.js";
import { solText } from "../preis-anzeige.js";
import { solZuLamports } from "../zahlungs-anforderung.js";
import { fehlerText } from "../protokoll-texte.js";
import { bestaetige, dialog, hinweis } from "./dialog.js";
import { frischeKassenAdresse, kassenAdresseFehlt } from "./eingebaute-wallet.js";
import { mlsSendeEvent } from "./mls-konto.js";
import type { AgentZiel } from "./raum-agenten-ui.js";
import { gruenderDefinition } from "./raum-ketten-ui.js";
import { sendePrivat, setzePrivateKasse } from "./raum-mls.js";
import { alsGeraet, devnetRpc, ensurePool, signiere, state } from "./state.js";
import { tresorEingerichtet, tresorOffen, verlangeTresor } from "./tresor.js";
import { verbundeneSolanaWallet } from "./tabs/waehrung.js";
import { toast } from "./ui.js";

/** Die Adressen, die Mitglieder dem Raum genannt haben (Schlüssel → Adresse), nur mit gültigem Nachweis. */
export async function genannteKassenAdressen(ziel: AgentZiel): Promise<Map<string, string>> {
  if ("privat" in ziel) return kassenAdressenPrivat(ziel.privat.gruppe, ziel.privat.ereignisse);
  const evs = await (await ensurePool()).query({ kinds: [KIND_KASSEN_ADRESSE], "#a": [ziel.adresse], limit: 500 });
  return kassenAdressenOffen(ziel.adresse, evs);
}

/** Darf ich hier eine Adresse nennen? Recht „kasse“, als Person (nicht als Gerät). */
export function darfKassenAdresse(zustand: SpaceState | undefined): boolean {
  const ich = state.keypair?.pk;
  return !!ich && !!zustand && !alsGeraet() && can(ich, RAUM_KASSEN_RECHT, zustand);
}

/**
 * Nachweis aus einer verbundenen Wallet (A-12b2d): Sie signiert den festen Text der Kasse (`solana:signMessage`, bei
 * `window.solana` `signMessage`); gilt er nicht für genau diese Adresse, Ort und Schlüssel, geht nichts hinaus.
 */
async function nachweisDerVerbundenen(
  v: { adresse: string; provider?: SolAnbieter }, ort: string, ich: string,
): Promise<{ adresse: string; nachweis: string } | undefined> {
  const signatur = await v.provider!.signiereNachricht!(kassenNachweisNachricht(ort, ich));
  const nachweis = bytesToHex(signatur);
  return pruefeKassenNachweis(ort, ich, v.adresse, nachweis) ? { adresse: v.adresse, nachweis } : undefined;
}

/** Die eigene Adresse für die Kasse nennen – true, wenn eine hinausging. */
export async function nenneKassenAdresse(ziel: AgentZiel, zustand: SpaceState | undefined): Promise<boolean> {
  const ich = state.keypair?.pk;
  if (!ich || !darfKassenAdresse(zustand)) return false;
  try {
    const schon = (await genannteKassenAdressen(ziel)).get(ich);
    if (schon) {
      await hinweis(t("kasse.adresseTitel"), t("kasse.schonGenannt", { adresse: schon }));
      return false;
    }
    // Gesperrt wüsste die App nicht, ob es eine eingebaute Wallet gibt – sie ginge vor (frisch aus dem Vorrat, V4)
    if (tresorEingerichtet() && !tresorOffen()) {
      toast(t("ein.tresorGesperrt"), true);
      return false;
    }
    // A-12b2d: ohne eingebaute eine verbundene Wallet, die Nachrichten signiert – ohne Tresor auch ohne ihn zu verlangen
    const verbunden = verbundeneSolanaWallet();
    const kannVerbunden = !!verbunden?.provider?.signiereNachricht;
    if (!(kannVerbunden && !tresorEingerichtet()) && !(await verlangeTresor(t("kasse.wofuer")))) return false;
    const fehlt = kassenAdresseFehlt();
    const ueberVerbundene = fehlt === "ohne-wallet" && kannVerbunden;
    if (fehlt && !ueberVerbundene) {
      toast(t(fehlt === "ohne-wallet" ? "kasse.ohneWallet" : "kasse.ohneVorrat"), true);
      return false;
    }
    const offen = "adresse" in ziel;
    const ort = kassenOrt(offen ? ziel.adresse : ziel.privat.gruppe);
    const text = ueberVerbundene
      ? t(offen ? "kasse.offenTextVerbunden" : "kasse.privatTextVerbunden", { adresse: verbunden!.adresse })
      : t(offen ? "kasse.offenText" : "kasse.privatText");
    if (!(await bestaetige({ titel: t("kasse.adresseTitel"), text, ok: t("kasse.nennen") }))) return false;
    const neu = ueberVerbundene ? await nachweisDerVerbundenen(verbunden!, ort, ich) : await frischeKassenAdresse(ort, ich);
    if (!neu) {
      toast(t(ueberVerbundene ? "kasse.nachweisUngueltig" : "kasse.ohneVorrat"), true);
      return false;
    }
    const { adresse, nachweis } = neu;
    const ok = offen
      ? await (await ensurePool()).publish(await signiere(baueKassenAdresse({ autor: ich, raum: ziel.adresse, adresse, nachweis }))).then(() => true, () => false)
      : await mlsSendeEvent(ziel.privat.gruppe, raumKassenAdresse(ziel.privat.gruppe, adresse, nachweis)).catch(() => false);
    toast(ok ? t("kasse.genannt", { adresse }) : t("komm.nichtGeaendert"), !ok);
    return ok;
  } catch (e) {
    toast(fehlerText(e), true);
    return false;
  }
}

/** Darf ich hier die Kasse anlegen? Gründer des offenen, Admin des privaten Raums, als Person, noch ohne Kasse. */
function darfKasseAnlegen(ziel: AgentZiel, zustand: SpaceState | undefined): boolean {
  const ich = state.keypair?.pk;
  if (!ich || !zustand?.space || zustand.space.kasse || alsGeraet()) return false;
  return "privat" in ziel ? ziel.privat.admins.includes(ich) : zustand.ownerPubkey === ich;
}

/** Die Kasse anlegen (Devnet, eingebaute Wallet) und in die Definition schreiben – true, wenn sie dort steht. */
export async function legeKasseImRaumAn(ziel: AgentZiel, zustand: SpaceState | undefined): Promise<boolean> {
  const ich = state.keypair?.pk;
  if (!ich || !zustand || !darfKasseAnlegen(ziel, zustand)) return false;
  try {
    if (!(await verlangeTresor(t("kasse.wofuer")))) return false;
    const adressen = await genannteKassenAdressen(ziel);
    const gruender = adressen.get(ich);
    if (!gruender) {
      await hinweis(t("kasse.anlegenTitel"), t("kasse.erstAdresse"));
      return false;
    }
    const andere = mitKassenRecht(zustand).filter((pk) => pk !== ich);
    const weitere = andere.flatMap((pk) => adressen.get(pk) ?? []);
    const w = await dialog({
      titel: t("kasse.anlegenTitel"), text: t("kasse.anlegenText", { mit: weitere.length, ohne: andere.length - weitere.length }), ok: t("kasse.weiter"),
      felder: [
        { art: "wahl", name: "art", label: t("kasse.art"), wert: "gruender", optionen: [
          { wert: "gruender", text: t("kasse.artGruender") }, { wert: "mehrheit", text: t("kasse.artMehrheit") },
        ] },
        { art: "wahl", name: "zeitschloss", label: t("kasse.zeitschloss"), wert: "0", optionen: KASSEN_ZEITSCHLOSS_SEK.map((s) => ({ wert: String(s), text: zeitschlossText(s) })) },
      ],
      pruefe: (w) => (w.art === "mehrheit" && !weitere.length ? t("kasse.mehrheitAllein") : null),
    });
    if (!w) return false;
    const art = w.art === "mehrheit" ? "mehrheit" : "gruender";
    const { legeKasseAn } = await import("./zahlschienen.js");
    const kasse = await legeKasseAn({ art, gruender, weitere, zeitschlossSek: Number(w.zeitschloss) }, (k) => bestaetige({
      titel: t("kasse.anlegenTitel"), ok: t("kasse.anlegen"),
      text: [
        t("kasse.kosten", { miete: solText(k.miete), gebuehr: solText(k.gebuehr), gesamt: solText(k.gesamt), zahler: k.zahler }),
        t(art === "mehrheit" ? "kasse.ehrlichMehrheit" : "kasse.ehrlichGruender"),
        ...(k.zahler === gruender ? [] : [t("kasse.zahlerVerbunden", { gruender })]),
      ].join("\n\n"),
    }));
    // Auf der Kette steht sie jetzt – scheitert das Schreiben, nicht still aufgeben, sonst kennt der Raum sie nie
    while (!(await schreibeKasse(ziel, ich, kasse))) {
      if (!(await bestaetige({ titel: t("kasse.anlegenTitel"), text: t("kasse.nichtVermerkt", { kasse }), ok: t("kasse.nochmal") }))) return false;
    }
    toast(t("kasse.angelegt", { kasse }));
    return true;
  } catch (e) {
    toast(fehlerText(e), true);
    return false;
  }
}

/** Offen eine neue Definition des Gründers mit der Kasse, privat über `setzePrivateKasse()`. */
async function schreibeKasse(ziel: AgentZiel, ich: string, kasse: string): Promise<boolean> {
  if ("privat" in ziel) return setzePrivateKasse(ziel.privat, kasse).catch(() => false);
  const alt = await gruenderDefinition(ziel.adresse).catch(() => null);
  if (!alt) return false;
  // Nach der alten Definition, nie in derselben Sekunde – sonst entschiede die Id (Fallstrick B-20c)
  const zeit = Math.max(Math.floor(Date.now() / 1000), alt.zeit + 1);
  return (await ensurePool()).publish(await signiere(buildEvent(ich, KIND_SPACE, mitKassenTag(alt.tags, kasse), "", zeit))).then(() => true, () => false);
}

/**
 * Der Stand der Kasse von der Kette (Devnet, eigene Endpunkte) mit den Abweichungen zum Raum (V3), auf Wunsch einzahlen –
 * true, wenn eingezahlt wurde. `name` macht aus einem Schlüssel den Namen im Raum.
 */
export async function zeigeKasse(ziel: AgentZiel, zustand: SpaceState | undefined, name: (pk: string) => string): Promise<boolean> {
  const ich = state.keypair?.pk;
  const kasse = zustand?.space?.kasse;
  if (!ich || !zustand || !kasse || alsGeraet()) return false;
  const titel = t("kasse.titel");
  try {
    const rpc = await devnetRpc();
    if (!rpc) {
      await hinweis(titel, t("kasse.nurDevnet"));
      return false;
    }
    const [stand, guthaben, adressen] = await Promise.all([leseKasse(rpc, kasse), leseGuthaben(rpc, kassenTresor(kasse)), genannteKassenAdressen(ziel)]);
    if (!stand) {
      await hinweis(titel, t("kasse.nichtAufKette", { kasse }));
      return false;
    }
    const abweichungen = kassenAbweichungen({ mitglieder: stand.mitglieder, adressen, zustand });
    const text = kassenStandText({ kasse, stand, guthaben: Number(guthaben), abweichungen, name });
    const art = kassenArt(stand);
    // Eine Kasse anderer Form (etwa mit Verwalter) zeigt die App nur – einzahlen nie
    if (!art) {
      await hinweis(titel, text);
      return false;
    }
    // Auszahlungen (A-12c1): Empfänger, Betrag und Stimmen von der Kette; wählbar nur, was das Programm jetzt annimmt
    const vorgaenge = await leseVorschlaege(rpc, kasse, stand);
    const mitglied = adressen.get(ich);
    // Namen zu Adressen auf der Kette nur, wo jemand im Raum sie genannt hat (A-12d1)
    const wer = (adresse: string) => [...adressen].find(([, a]) => a === adresse)?.[0];
    const werName = (adresse: string) => (wer(adresse) ? name(wer(adresse)!) : undefined);
    // Neue Vorschläge meldet die App im Raum (A-12c2) – nur, wo ich schreiben darf
    const kanal = kassenHinweisKanal(zustand, ich);
    const melde = kanal ? (index: bigint) => meldeVorschlag(ziel, ich, kanal, index) : undefined;
    const aktion = await dialog({
      titel, text: `${text}\n\n${vorschlaegeText(stand, vorgaenge, werName)}`, ok: t("kasse.weiter"), abbrechen: t("dlg.schliessen"),
      felder: [{ art: "wahl", name: "aktion", label: t("kasse.aktion"), optionen: kassenAktionen(stand, vorgaenge, mitglied, Math.floor(Date.now() / 1000)), wert: "einzahlen" }],
    });
    if (!aktion) return false;
    if (aktion.aktion === "aendern") return await aendern(kasse, stand, abweichungen, mitglied, werName, melde);
    if (aktion.aktion !== "einzahlen") return await auszahlen(kasse, String(aktion.aktion), mitglied, werName, melde);
    const w = await dialog({
      titel, ok: t("kasse.einzahlen"),
      felder: [{ art: "text", name: "betrag", label: t("kasse.betrag"), mono: true }],
      pruefe: (w) => (solZuLamports(String(w.betrag ?? "")) ? null : t("kasse.betragFalsch")),
    });
    const lamports = w ? solZuLamports(String(w.betrag ?? "")) : undefined;
    if (!lamports || !(await verlangeTresor(t("kasse.wofuer")))) return false;
    const { zahleInKasse } = await import("./zahlschienen.js");
    await zahleInKasse({ kasse, lamports, bevorzugt: adressen.get(ich) }, (k) => bestaetige({
      titel, ok: t("kasse.einzahlen"),
      text: [
        t("kasse.einzahlenFrage", { betrag: solText(lamports), tresor: k.tresor, zahler: k.zahler }),
        // Bei „Gründer entscheidet“ bei jeder Einzahlung (Entwurf, W2)
        ...(art === "gruender" ? [t("kasse.ehrlichGruenderEinzahlen")] : []),
      ].join("\n\n"),
    }));
    toast(t("kasse.eingezahlt", { betrag: solText(lamports) }));
    return true;
  } catch (e) {
    toast(fehlerText(e), true);
    return false;
  }
}

const FRAGE: Record<KassenSchritt, string> = { // kein UI-Text
  dafuer: "kasse.dafuerFrage", dagegen: "kasse.dagegenFrage", ausfuehren: "kasse.ausfuehrenFrage", abschliessen: "kasse.abschliessenFrage",
};
const FRAGE_AENDERUNG: Record<KassenSchritt, string> = { // kein UI-Text
  dafuer: "kasse.aeDafuerFrage", dagegen: "kasse.aeDagegenFrage", ausfuehren: "kasse.aeAusfuehrenFrage", abschliessen: "kasse.abschliessenFrage",
};
const ERLEDIGT: Record<KassenSchritt | "vorschlagen", string> = { // kein UI-Text
  vorschlagen: "kasse.vorgeschlagen", dafuer: "kasse.abgestimmt", dagegen: "kasse.abgestimmt", ausfuehren: "kasse.ausgezahlt", abschliessen: "kasse.abgeschlossen",
};

type Melde = (index: bigint) => Promise<boolean>;

/**
 * Hinweis im Raum auf einen neuen Vorschlag (A-12c2, V6): eine gewöhnliche Nachricht mit seiner Nummer – offen signiert
 * an den Raum, privat nur als inneres Event der Gruppe. Was er auszahlt oder ändert, liest jedes Mitglied von der Kette.
 */
async function meldeVorschlag(ziel: AgentZiel, ich: string, kanal: string, index: bigint): Promise<boolean> {
  const text = t("kasse.hinweisRaum", { nr: String(index) });
  try {
    if ("privat" in ziel) return !!(await sendePrivat(ziel.privat.gruppe, kanal, text));
    const raum = leseRaumAdresse(ziel.adresse);
    if (!raum) return false;
    await (await ensurePool()).publish(await signiere(buildChannelMessage({ authorPubkey: ich, spaceId: raum.spaceId, channelId: kanal, content: text, mentions: [] })));
    return true;
  } catch {
    return false;
  }
}

/** Nach einem neuen Vorschlag: die Nummer, und ob der Hinweis im Raum hinausging. */
async function vorgeschlagen(text: string, index: bigint, melde: Melde | undefined): Promise<void> {
  if (!melde || (await melde(index))) toast(t(text, { nr: String(index) }));
  else toast(t("kasse.hinweisNicht", { nr: String(index) }), true);
}

/**
 * Unterschreibt die verbundene Wallet für die Kasse (A-12c3)? Dann braucht es keinen Tresor – ihre Adresse ist die für die Kasse,
 * eine Adresse der eingebauten Wallet kann sie nicht sein. Wer unterschreibt, entscheidet `kassenSchritt()` noch einmal selbst.
 */
const unterschreibtVerbundene = (mitglied: string | undefined): boolean => !!mitglied && verbundeneSolanaWallet()?.adresse === mitglied;

/** Zahlt eine andere Adresse als die für die Kasse, sagt die Rückfrage, dass sie damit auf der Kette verbunden wird. */
const zahlerHinweis = (zahler: string, mitglied: string | undefined): string[] =>
  zahler === mitglied ? [] : [mitglied ? t("kasse.zahlerVerbunden", { gruender: mitglied }) : t("kasse.zahlerVerbundenOhne")];

/**
 * Die Kasse ändern (A-12d1): dazu nur, wer im Raum das Recht „kasse“ hat und eine Adresse genannt hat (V3), weg jedes Mitglied,
 * dazu die Wartezeit (W3). Die Art bleibt (`kassenAenderungen()`), die Schwelle folgt der Mehrheit; die Rückfrage zeigt die
 * Änderungen, Zahler und Miete. Die Kasse ändert sich erst nach der Abstimmung.
 */
async function aendern(
  kasse: string, stand: KassenStand, abw: KassenAbweichungen, mitglied: string | undefined, wer: (adresse: string) => string | undefined, melde: Melde | undefined,
): Promise<boolean> {
  const mitName = (a: string) => (wer(a) ? t("kasse.aeWer", { name: wer(a)!, adresse: a }) : a);
  const dazu = abw.rechtOhneMitgliedschaft.flatMap((x) => (x.adresse ? [x.adresse] : []));
  const wunsch = (w: Record<string, string | string[]>) => ({
    dazu: (w.dazu ?? []) as string[], weg: (w.weg ?? []) as string[], zeitschlossSek: Number(w.wartezeit),
  });
  const w = await dialog({
    titel: t("kasse.aendernTitel"), ok: t("kasse.weiter"),
    text: t(kassenArt(stand) === "gruender" ? "kasse.aendernGruender" : "kasse.aendernMehrheit"),
    felder: [
      ...(dazu.length ? [{ art: "mehrfach" as const, name: "dazu", label: t("kasse.aendernDazu"), optionen: dazu.map((a) => ({ wert: a, text: mitName(a) })) }] : []),
      { art: "mehrfach", name: "weg", label: t("kasse.aendernWeg"), optionen: stand.mitglieder.map((m) => ({ wert: m.adresse, text: mitName(m.adresse) })) },
      { art: "wahl", name: "wartezeit", label: t("kasse.zeitschloss"), wert: String(stand.zeitschlossSek), optionen: KASSEN_ZEITSCHLOSS_SEK.map((sek) => ({ wert: String(sek), text: zeitschlossText(sek) })) },
    ],
    pruefe: (w) => {
      try {
        kassenAenderungen(stand, wunsch(w));
        return null;
      } catch {
        return t("kasse.aendernNicht");
      }
    },
  });
  if (!w || (!unterschreibtVerbundene(mitglied) && !(await verlangeTresor(t("kasse.wofuer"))))) return false;
  const { kassenSchritt } = await import("./zahlschienen.js");
  const index = await kassenSchritt({ kasse, mitglied, schritt: "aendern", ...wunsch(w) }, (k) => bestaetige({
    titel: t("kasse.titel"), ok: t("kasse.weiter"),
    text: [
      t("kasse.aendernFrage", { aenderungen: aenderungenText(k.konfiguration ?? [], wer), zahler: k.zahler, miete: solText(k.miete) }),
      ...zahlerHinweis(k.zahler, mitglied),
      ...(k.verbunden ? [t("kasse.verbundenUnterschreibt")] : []),
      ...(melde ? [t("kasse.hinweisFolgt")] : []),
    ].join("\n\n"),
  }));
  await vorgeschlagen("kasse.aenderungVorgeschlagen", index, melde);
  return true;
}

/**
 * Eine Auszahlung vorschlagen oder einen Schritt eines Vorschlags gehen (A-12c1, `kassenSchritt()`): „vorschlagen“ fragt
 * Empfänger und Betrag, „<schritt>:<nr>“ zeigt vor dem Senden, was auf der Kette steht – nie, was im Raum steht (V6).
 * Zahlt eine andere Adresse als die für die Kasse, sagt die Rückfrage, dass sie damit verbunden wird.
 */
async function auszahlen(
  kasse: string, aktion: string, mitglied: string | undefined, wer: (adresse: string) => string | undefined, melde: Melde | undefined,
): Promise<boolean> {
  const titel = t("kasse.titel");
  let neu: Auszahlung | undefined;
  if (aktion === "vorschlagen") {
    const w = await dialog({
      titel: t("kasse.vorschlagTitel"), ok: t("kasse.weiter"),
      felder: [
        { art: "text", name: "empfaenger", label: t("kasse.empfaenger"), mono: true, scannen: true },
        { art: "text", name: "betrag", label: t("kasse.betrag"), mono: true },
      ],
      pruefe: (w) => {
        const an = String(w.empfaenger ?? "").trim();
        if (!istSolAdresse(an) || an === kassenTresor(kasse)) return t("kasse.empfaengerFalsch");
        return solZuLamports(String(w.betrag ?? "")) ? null : t("kasse.betragFalsch");
      },
    });
    if (!w) return false;
    neu = { empfaenger: String(w.empfaenger).trim(), lamports: BigInt(solZuLamports(String(w.betrag))!) };
  }
  const [schritt, nr] = aktion.split(":") as [KassenSchritt | "vorschlagen", string | undefined];
  if (!unterschreibtVerbundene(mitglied) && !(await verlangeTresor(t("kasse.wofuer")))) return false;
  const { kassenSchritt } = await import("./zahlschienen.js");
  let aenderung = false;
  const index = await kassenSchritt(
    neu ? { kasse, mitglied, schritt: "vorschlagen", auszahlung: neu } : { kasse, mitglied, schritt: schritt as KassenSchritt, index: BigInt(nr ?? "") },
    (k) => {
      // Eine Änderung der Kasse (A-12d1): die Rückfrage nennt, was sich laut Kette ändert, statt Betrag und Empfänger
      aenderung = !!k.konfiguration;
      const werte = {
        nr: nr ?? "", zahler: k.zahler, miete: solText(k.miete), betrag: solText(Number(k.auszahlung?.lamports ?? 0n)), empfaenger: k.auszahlung?.empfaenger ?? "",
        aenderungen: k.konfiguration ? aenderungenText(k.konfiguration, wer) : "",
      };
      return bestaetige({
        titel, ok: t("kasse.weiter"),
        text: [
          t(schritt === "vorschlagen" ? "kasse.vorschlagenFrage" : (aenderung ? FRAGE_AENDERUNG : FRAGE)[schritt], werte),
          ...zahlerHinweis(k.zahler, mitglied),
          ...(k.verbunden ? [t("kasse.verbundenUnterschreibt")] : []),
          ...(schritt === "vorschlagen" && melde ? [t("kasse.hinweisFolgt")] : []),
        ].join("\n\n"),
      });
    },
  );
  if (schritt === "vorschlagen") await vorgeschlagen(ERLEDIGT.vorschlagen, index, melde);
  else toast(t(aenderung && schritt === "ausfuehren" ? "kasse.geaendert" : ERLEDIGT[schritt], { nr: String(index) }));
  return true;
}
