/**
 * Zahlung im Chat anfordern und bezahlen (Sammlung A-5).
 *
 * Anfordern – im Zap-Dialog „Anfordern statt senden“: sats mit einer Rechnung
 * der eigenen Wallet (`eigeneRechnung()`, NWC), SOL mit der eigenen Adresse
 * für genau diesen Kontakt (`eigeneAdresseFuer()`, eingebaute Wallet, 4.9d).
 * Die Anforderung kommt ins Eingabefeld und geht wie jede Nachricht hinaus –
 * versiegelt. Ohne passende Wallet sagt die App das, statt auszuweichen.
 *
 * Bezahlen – „Bezahlen“ an einer Nachricht mit Anforderung: Betrag in beiden
 * Einheiten, Bestätigung, gezahlt nur über die Zahlschienen; nach SOL der
 * versiegelte Beleg an den Anfordernden (4.7).
 */
import { zahle } from "@freedomstack/protocol";
import { t } from "../i18n.js";
import { ausLamports, ausMsat } from "../preis-anzeige.js";
import { fehlerText } from "../protokoll-texte.js";
import { baueAnforderung, solZuLamports, type Anforderung } from "../zahlungs-anforderung.js";
import { bestaetige, dialog, hinweis } from "./dialog.js";
import { aktualisiereKurs, aktuellerKurs } from "./marktkurs.js";
import { ensurePool, solRpcUrl, state } from "./state.js";
import { geheim } from "./tresor.js";
import { $, toast } from "./ui.js";
import { eigeneRechnung, zahlschienen } from "./zahlschienen.js";

/** Anforderung an einen Kontakt bauen und ins Eingabefeld legen. */
export async function fordereAn(kontakt: string, name: string, vorgabe: { wert: number; einheit: "sats" | "sol" }): Promise<void> {
  const w = await dialog({
    titel: t("anf.titel", { name }),
    text: t("anf.text"),
    felder: [
      { art: "text", name: "betrag", label: t("anf.betrag"), wert: vorgabe.wert > 0 ? String(vorgabe.wert) : "", pflicht: true },
      { art: "wahl", name: "einheit", label: t("anf.einheit"), wert: vorgabe.einheit, optionen: [
        { wert: "sats", text: t("zahl.einheitSats") }, { wert: "sol", text: t("zahl.einheitSol") },
      ] },
      { art: "text", name: "notiz", label: t("anf.notiz") },
    ],
    ok: t("anf.erstellen"),
  });
  if (!w) return;
  const betrag = String(w.betrag).trim().replace(",", ".");
  const notiz = String(w.notiz ?? "");
  try {
    let text: string;
    if (w.einheit === "sol") {
      const lamports = solZuLamports(betrag);
      if (!lamports) return hinweis(t("anf.titel", { name }), t("anf.betragUngueltig"));
      const [{ eigeneAdresseFuer }, { frischeEmpfangsadresse }, { ketteAusRpc }] = await Promise.all([
        import("../trinkgeld-adresse.js"), import("./eingebaute-wallet.js"), import("../wallet-standard.js"),
      ]);
      const adresse = await eigeneAdresseFuer(geheim, kontakt, ketteAusRpc(await solRpcUrl()), frischeEmpfangsadresse);
      if (!adresse) return hinweis(t("anf.titel", { name }), t("anf.ohneSolWallet"));
      text = baueAnforderung({ solana: { adresse, lamports }, notiz });
    } else {
      if (!/^\d{1,9}$/.test(betrag) || Number(betrag) <= 0) return hinweis(t("anf.titel", { name }), t("anf.betragUngueltig"));
      const rechnung = await eigeneRechnung(Number(betrag) * 1000);
      if (!rechnung) return hinweis(t("anf.titel", { name }), t("anf.ohneLnWallet"));
      text = baueAnforderung({ rechnung, notiz });
    }
    const feld = $("#chat-input") as HTMLTextAreaElement | null;
    if (!feld) return;
    feld.value = feld.value.trim() ? `${feld.value.trim()}\n${text}` : text;
    feld.focus();
    toast(t("anf.imFeld", { name }));
  } catch (e) {
    await hinweis(t("anf.titel", { name }), fehlerText(e));
  }
}

/** Eine erkannte Anforderung bezahlen – nach Bestätigung, nur über die Zahlschienen. */
export async function bezahleAnforderung(a: Anforderung, von: string, name: string): Promise<void> {
  await aktualisiereKurs().catch(() => undefined);
  const kurs = aktuellerKurs();
  let art: "lightning" | "solana" = a.lightning ? "lightning" : "solana";
  if (a.lightning && a.solana) {
    const w = await dialog({
      titel: t("anf.bezahlenTitel", { name }),
      felder: [{ art: "wahl", name: "art", label: t("anf.womit"), wert: "lightning", optionen: [
        { wert: "lightning", text: ausMsat(a.lightning.msat, kurs) }, { wert: "solana", text: ausLamports(a.solana.lamports, kurs) },
      ] }],
      ok: t("anf.weiter"),
    });
    if (!w) return;
    art = w.art === "solana" ? "solana" : "lightning";
  }
  const betragText = art === "lightning" ? ausMsat(a.lightning!.msat, kurs) : ausLamports(a.solana!.lamports, kurs);
  if (!(await bestaetige({ titel: t("anf.bezahlenTitel", { name }), text: t("anf.bezahlenText", { betrag: betragText, name }), ok: t("anf.bezahlen") }))) return;
  try {
    if (art === "lightning") {
      await zahle(zahlschienen(), { ziel: a.lightning!.rechnung, betrag: { einheit: "msat", wert: a.lightning!.msat }, zweck: "anforderung" });
      toast(t("anf.bezahlt", { betrag: betragText }));
      return;
    }
    const s = a.solana!;
    const beleg = await zahle(zahlschienen(), { ziel: s.adresse, betrag: { einheit: "lamports", wert: s.lamports }, zweck: "anforderung" });
    toast(t("anf.bezahlt", { betrag: betragText }));
    // Beleg an den Anfordernden (4.7): versiegelt – scheitert er, ist das Geld trotzdem unterwegs
    try {
      const [{ sendeTrinkgeldBeleg }, { ketteAusRpc }] = await Promise.all([import("../trinkgeld-beleg.js"), import("../wallet-standard.js")]);
      await sendeTrinkgeldBeleg(await ensurePool(), state.signer!, {
        empfaenger: von, signatur: beleg.ref, lamports: s.lamports, an: s.adresse, kette: ketteAusRpc(await solRpcUrl()),
      }, false);
    } catch (e) {
      toast(t("zahl.belegNichtGesendet", { fehler: fehlerText(e) }), true);
    }
  } catch (e) {
    await hinweis(t("anf.bezahlenTitel", { name }), t("zahl.fehler", { fehler: fehlerText(e) }));
  }
}
