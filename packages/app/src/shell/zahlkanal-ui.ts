/**
 * Zahlkanal öffnen und anzeigen (Schritt 4.3d2). Logik in `zahlkanal.ts`,
 * die Gutschrift je Anfrage in `ki-zahlung.ts` (seit 4.3d1).
 *
 * Reihenfolge beim Öffnen:
 * 1. Liegt das Kanal-Programm auf dieser Kette? Nennt der Provider einen Kanal
 *    bei genau diesem Programm?
 * 2. Tresor – der Sitzungsschlüssel ist ein Geld-Geheimnis.
 * 3. Merken: Kanal-Buch und Sperre für den Rückhol-Wächter.
 * 4. Erst dann einzahlen.
 *
 * Bricht die App nach dem Merken ab, holt der Wächter nach Ablauf zurück;
 * einen nie angelegten Kanal schließt er ohne Transaktion ab. Scheitert die
 * Einzahlung und zeigt die Kette keinen Kanal, fliegt er aus dem Kanal-Buch –
 * sonst trügen weitere Anfragen Gutschriften für einen Kanal, den es nicht gibt.
 * Fremde Angaben (Schlüssel, Beträge) nur über textContent.
 */
import { KANAL_PROGRAMM_ID, kanalEmpfaenger, stockeKanalAufIx } from "@freedomstack/protocol";
import { gebietsschema, t } from "../i18n.js";
import { fehlerText } from "../protokoll-texte.js";
import { solText } from "../preis-anzeige.js";
import { pkShort } from "../shell-logic.js";
import { solZuLamports } from "../zahlungs-anforderung.js";
import { KANAL_NUTZBAR_SEK, kanalAufKette, planeKanal, programmBereit, sendeMitWallet } from "../zahlkanal.js";
import { empfaengerFuer, kanalBuch } from "./ki-zahlung.js";
import { angebotVon, solRpcUrl, state } from "./state.js";
import { htlcSigner } from "./tabs/waehrung.js";
import { setzeKanalEinzahlung } from "./tabs/hinterlegen.js";
import { sperren, starteRueckholWaechter } from "./tabs/tausch.js";
import { verlangeTresor } from "./tresor.js";
import { bestaetige, dialog } from "./dialog.js";
import { $, el } from "./ui.js";

/** Läuft gerade eine Einzahlung? `geldVorgangLaeuft()` kennt sie – der Tresor sperrt dann nicht. */
let oeffnet = false;

export async function oeffneZahlkanal(): Promise<void> {
  const statusEl = $("#kanal-status");
  const melde = (text: string, art = ""): void => { statusEl.textContent = text; statusEl.className = `mono-sm ${art}`; };
  if (oeffnet) return;
  const signer = htlcSigner();
  if (!signer) return melde(t("waehr.erstSolanaVerbinden"), "warn");
  const sol = Number(($("#kanal-betrag") as HTMLInputElement).value);
  if (!(sol > 0)) return melde(t("waehr.ungueltigerBetrag"), "err");
  const tage = Number(($("#kanal-laufzeit") as HTMLSelectElement).value);
  const providerPk = ($("#dep-provider") as HTMLInputElement | null)?.value.trim() || state.lastProvider;
  if (!providerPk) return melde(t("waehr.keinProvider"), "warn");
  oeffnet = true;
  setzeKanalEinzahlung(true);
  let gemerkt: string | undefined;
  const { Connection } = await import("@solana/web3.js");
  const conn = new Connection(await solRpcUrl(), "confirmed");
  try {
    const angebot = await angebotVon(providerPk).catch(() => undefined);
    if (!angebot?.kanal) return melde(t("waehr.kanalNichtAngeboten"), "warn");
    if (angebot.kanal.programm !== KANAL_PROGRAMM_ID) return melde(t("waehr.kanalAnderesProgramm"), "err");
    if (!(await programmBereit(conn))) return melde(t("waehr.kanalProgrammFehlt"), "warn");
    if (!(await verlangeTresor(t("waehr.fuerKanal")))) return;
    const kunde = signer.publicKey.toBase58();
    // Anteile nach A+ mit SOL-Adresse – Provider und Kunde selbst nie
    const empfaenger = kanalEmpfaenger(await empfaengerFuer(providerPk), [angebot.kanal.adresse, kunde]);
    const jetzt = Math.floor(Date.now() / 1000);
    const lamports = BigInt(Math.round(sol * 1e9));
    const plan = planeKanal({
      provider: providerPk, providerSol: angebot.kanal.adresse, kunde, lamports, laufzeitSek: tage * 86_400, empfaenger, jetzt,
    });
    const bis = new Date(plan.eintrag.ablauf * 1000).toLocaleString(gebietsschema());
    if (!(await bestaetige({ titel: t("waehr.kanalTitel"), text: t("waehr.kanalFrage", { betrag: solText(Number(lamports)), provider: pkShort(providerPk), bis, anteile: empfaenger.length }), ok: t("waehr.kanalEinzahlen") }))) return;
    // Erst merken (Kanal-Buch mit Sitzungsschlüssel, Sperre für den Wächter), dann einzahlen
    await kanalBuch.merke(plan.eintrag);
    gemerkt = plan.eintrag.kanal;
    const { rememberLock } = await sperren();
    await rememberLock({
      kind: "kanal", reference: plan.eintrag.kanal, swapIds: [plan.eintrag.kanal], timelockUnix: plan.eintrag.ablauf,
      amountLamports: Number(lamports), createdAt: jetzt,
    });
    void starteRueckholWaechter();
    await sendeMitWallet(conn, signer, [plan.ix], (schritt) => melde(schritt));
    gemerkt = undefined;
    melde(t("waehr.kanalOffen", { betrag: solText(Number(lamports)), bis }), "ok");
  } catch (e) {
    melde(t("waehr.fehler", { fehler: fehlerText(e) }), "err");
    // Nicht angelegt? Dann weg aus dem Kanal-Buch. Unklar (Kette nicht erreichbar): bleibt – der Wächter klärt es nach Ablauf.
    if (gemerkt) {
      const kanal = gemerkt;
      if ((await kanalAufKette(conn, kanal).catch(() => "unklar" as const)) === null) await kanalBuch.entferne(kanal).catch(() => {});
    }
  } finally {
    oeffnet = false;
    setzeKanalEinzahlung(false);
    await zeigeKanaele();
  }
}

/** Die eigenen Kanäle: Einlage, was noch frei ist, bis wann. Lange Abgelaufene fallen weg. */
export async function zeigeKanaele(): Promise<void> {
  const liste = $("#kanal-liste");
  if (!liste) return;
  const jetzt = Math.floor(Date.now() / 1000);
  await kanalBuch.raeumeAuf(jetzt).catch(() => { /* Tresor gesperrt */ });
  liste.replaceChildren();
  for (const e of kanalBuch.alle().sort((a, b) => a.ablauf - b.ablauf)) {
    const zeile = document.createElement("div");
    const bis = new Date(e.ablauf * 1000).toLocaleString(gebietsschema());
    const frei = BigInt(e.eingezahlt) - BigInt(e.letzte);
    zeile.textContent = e.ablauf > jetzt
      ? t("waehr.kanalZeile", { provider: pkShort(e.provider), betrag: solText(Number(e.eingezahlt)), frei: solText(Number(frei)), bis })
      : t("waehr.kanalAbgelaufen", { provider: pkShort(e.provider), bis });
    // Aufstocken (E8), solange der Kanal noch für Anfragen taugt – lange Sessions brechen sonst ab
    if (e.ablauf - jetzt >= KANAL_NUTZBAR_SEK) {
      const knopf = el("button", t("waehr.kanalAufstocken"), "ghost kanal-aufstocken");
      knopf.addEventListener("click", () => void stockeKanalAuf(e.kanal));
      zeile.append(" ", knopf);
    }
    liste.appendChild(zeile);
  }
}

/**
 * Kanal aufstocken (E8): nur mit der Wallet, die eingezahlt hat (`top_up` will den
 * Kunden als Unterzeichner), erst Betrag und Bestätigung, dann senden; die
 * Einlage wächst im Kanal-Buch erst, wenn die Kette bestätigt hat.
 */
export async function stockeKanalAuf(kanal: string): Promise<void> {
  const statusEl = $("#kanal-status");
  const melde = (text: string, art = ""): void => { statusEl.textContent = text; statusEl.className = `mono-sm ${art}`; };
  if (oeffnet) return;
  const e = kanalBuch.alle().find((x) => x.kanal === kanal);
  if (!e) return;
  const signer = htlcSigner();
  if (!signer) return melde(t("waehr.erstSolanaVerbinden"), "warn");
  if (signer.publicKey.toBase58() !== e.kunde) return melde(t("waehr.kanalAndereWallet", { adresse: `${e.kunde.slice(0, 6)}…` }), "warn");
  const w = await dialog({
    titel: t("waehr.kanalAufstockenTitel", { provider: pkShort(e.provider) }),
    felder: [{ name: "sol", label: t("waehr.kanalAufstockenBetrag"), art: "text", pflicht: true }],
    ok: t("waehr.kanalAufstocken"),
    pruefe: (v) => (solZuLamports(String(v.sol)) ? null : t("waehr.ungueltigerBetrag")),
  });
  const betrag = w ? solZuLamports(String(w.sol)) : undefined;
  if (!betrag) return;
  const lamports = BigInt(betrag);
  if (!(await bestaetige({ titel: t("waehr.kanalAufstockenTitel", { provider: pkShort(e.provider) }), text: t("waehr.kanalAufstockenFrage", { betrag: solText(Number(lamports)) }), ok: t("waehr.kanalAufstocken") }))) return;
  oeffnet = true;
  setzeKanalEinzahlung(true);
  try {
    const { Connection } = await import("@solana/web3.js");
    const conn = new Connection(await solRpcUrl(), "confirmed");
    await sendeMitWallet(conn, signer, [stockeKanalAufIx({ kunde: e.kunde, kanal, betrag: lamports })], (schritt) => melde(schritt));
    await kanalBuch.aufgestockt(kanal, lamports);
    melde(t("waehr.kanalAufgestockt", { betrag: solText(Number(lamports)) }), "ok");
  } catch (err) {
    melde(t("waehr.fehler", { fehler: fehlerText(err) }), "err");
  } finally {
    oeffnet = false;
    setzeKanalEinzahlung(false);
    await zeigeKanaele();
  }
}
