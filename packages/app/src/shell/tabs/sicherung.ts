/**
 * Settings › Sicherheit und Geräte: verschlüsselte Sicherung des Zustands,
 * Datenexport, Schlüsselwechsel und Widerruf, Geräte mit Vollmacht, Meldung
 * für andere.
 *
 * Aus tabs/settings.ts verschoben (C-5c) – wörtlich, ohne Logikänderung.
 */
import { gebietsschema, t } from "../../i18n.js";
import { fliesstext, pkShort, schluesselAusEingabe } from "../../shell-logic.js";
import { alsGeraet, ensurePool, mitBunker, mitRohemSchluessel, signiere, state } from "../state.js";
import { fehlerText, geraetWarnung, rechtName, sicherungGebaut, sicherungInfo, wechselWarnung, widerrufAnleitung, wiederherstellungText } from "../../protokoll-texte.js";
import { geheim, istGeheimnis } from "../tresor.js";
import { MIN_PASSPHRASE } from "../../vault.js";
import { fuehreZusammen, type ZusammenfuehrBericht } from "../../zustand-zusammenfuehren.js";
import { $, el, toast } from "../ui.js";
import { bestaetige, dialog } from "../dialog.js";
import { geraeteBuch } from "./posteingang.js";
import { aktualisiereSicherheitsStand, nurHauptidentitaet, richteNachfolgeEin } from "./settings.js";


/** Was das Zusammenfuehren (B-5) tut – vor dem Schreiben gezeigt. */
function zusammenfuehrText(b: ZusammenfuehrBericht): string {
  return [t("set.zusammenfuehren"), b.erhalten > 0 ? t("set.zusammenErhalten", { n: b.erhalten }) : "", b.konflikte > 0 ? t("set.zusammenKonflikte", { n: b.konflikte }) : ""]
    .filter(Boolean).join(" ");
}

// -------------------------------------- Sicherung, Wechsel, Geraete

/**
 * Knoepfe unter Settings → Sicherheit und Geraete. Bis 1.3f wurden sie erst
 * am Ende von `richteNachfolgeEin()` verdrahtet – ohne eingerichtete Nachfolge
 * taten „jetzt sichern“, „wiederherstellen“, „Diebstahl vorbeugen“ usw. nichts.
 * Mit Bunker gibt es keinen rohen Schluessel: Zustandssicherung und Nachfolge
 * sind dann gesperrt.
 */
export function wireSicherheitsKnoepfe(): void {
  const bn = $("#backup-now");
  if (bn) bn.onclick = () => void sichereZustand();
  const br = $("#backup-restore");
  if (br) br.onclick = () => void stelleZustandWieder();
  // Datenexport (B-6): als Datei mitnehmen und wieder einlesen
  const ex = $("#export-datei");
  if (ex) ex.onclick = () => void exportiereDaten();
  const ei = $("#export-einlesen");
  const ef = document.getElementById("export-file") as HTMLInputElement | null;
  if (ei && ef) {
    ei.onclick = () => ef.click();
    ef.onchange = () => {
      const datei = ef.files?.[0];
      ef.value = "";
      if (datei) void leseExportDatei(datei);
    };
  }
  const rp = $("#rotation-prepare");
  if (rp) rp.onclick = () => void bereiteWechselVor();
  const rr = $("#rotation-revoke");
  if (rr) rr.onclick = () => void widerrufeSchluessel();
  const da = $("#device-add");
  if (da) da.onclick = () => void fuegeGeraetHinzu();
  const sc = $("#succ-claim");
  if (sc) sc.onclick = () => void meldeFuerAnderen();
  if (!mitBunker()) return;
  for (const id of ["backup-now", "backup-restore", "succ-setup"]) {
    const k = document.getElementById(id) as HTMLButtonElement | null;
    if (!k) continue;
    k.disabled = true;
    k.title = t("set.mitBunkerNicht");
  }
}

/** Alles, was lokal liegt und bei Datenverlust verschwinden wuerde. */
/**
 * Was gesichert wird: nur die feste Liste aus `waehleSicherung()` (8.12) –
 * bis dahin ging jeder `freedom.*`-Eintrag mit, auch `freedom.nsec`, und mit
 * Tresor fehlten die Unterhaltungen. Jeder Wert kommt aus seinem Speicher.
 */
async function sammleZustand(): Promise<Record<string, string>> {
  const { waehleSicherung } = await import("@freedomstack/protocol");
  const alle = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) ?? "");
  return waehleSicherung(alle, (k) => (istGeheimnis(k) ? geheim.getItem(k) : localStorage.getItem(k)));
}

export async function zeigeSicherung(): Promise<void> {
  const box = $("#backup-status");
  if (!box || !state.keypair) return;
  const at = Number(localStorage.getItem("freedom.backupAt") ?? "0");
  const groesse = Number(localStorage.getItem("freedom.backupSize") ?? "0");
  try {
    box.textContent = sicherungInfo(groesse, at || undefined);
    box.className = at ? "mono-sm muted" : "mono-sm warn";
  } catch { /* Anzeige bleibt leer */ }
}

/** Zustand verschluesselt sichern. */
async function sichereZustand(): Promise<void> {
  if (!state.keypair) return;
  try {
    const { deriveBackupKey, buildStateBackup } =
      await import("@freedomstack/protocol");
    const key = mitRohemSchluessel(t("set.fuerSicherung"), deriveBackupKey);
    const r = await buildStateBackup(state.keypair.pk, key, await sammleZustand());
    await (await ensurePool()).publish(await signiere(r.event as never));

    localStorage.setItem("freedom.backupAt", String(Math.floor(Date.now() / 1000)));
    localStorage.setItem("freedom.backupSize", String(r.sizeBytes));
    toast(sicherungGebaut(r.sizeBytes));
    void zeigeSicherung();
    void aktualisiereSicherheitsStand();
  } catch (e) {
    toast(fehlerText(e), true);
  }
}

async function stelleZustandWieder(): Promise<void> {
  if (!state.keypair) return;
  try {
    const { deriveBackupKey, restoreStateBackup, latestBackup, filtereWiederherstellung, KIND_STATE_BACKUP } =
      await import("@freedomstack/protocol");
    const pool = await ensurePool();
    const evs = await pool.query({
      kinds: [KIND_STATE_BACKUP], authors: [state.keypair.pk], limit: 10,
    });
    const neueste = latestBackup(evs);
    if (!neueste) {
      toast(t("set.keineSicherung"), true);
      return;
    }
    const r = await restoreStateBackup(neueste, mitRohemSchluessel(t("set.fuerWiederherstellung"), deriveBackupKey));
    if (!r.ok || !r.data) {
      toast(wiederherstellungText(r), true);
      return;
    }
    // Nur, was in eine Sicherung gehoert – auch eine alte mit Schluessel stellt ihn nicht her
    const daten = filtereWiederherstellung(r.data);
    // Zusammenfuehren statt ueberschreiben (B-5): was nur hier steht, bleibt
    const { werte, bericht } = fuehreZusammen(daten, (k) => (istGeheimnis(k) ? geheim.getItem(k) : localStorage.getItem(k)));
    if (!(await bestaetige({ titel: t("set.wiederherstellen"), text: `${wiederherstellungText(r)}\n\n${zusammenfuehrText(bericht)}`, ok: t("set.zusammenfuehrenOk") }))) return;
    for (const [k, v] of Object.entries(werte)) {
      if (istGeheimnis(k)) await geheim.setItem(k, v);
      else localStorage.setItem(k, v);
    }
    toast(t("set.wiederhergestellt"));
    setTimeout(() => location.reload(), 900);
  } catch (e) {
    toast(fehlerText(e), true);
  }
}

/**
 * Datenexport (B-6): alles aus der Sicherung, dazu KI-Verläufe und Quittungen,
 * mit einer eigenen Passphrase verschlüsselt, als Datei – nie Schlüssel,
 * Zugänge oder Geld-Geheimnisse (`datenexport.ts`). Braucht keinen rohen
 * Schlüssel, geht also auch mit Bunker.
 */
async function exportiereDaten(): Promise<void> {
  const w = await dialog({
    titel: t("set.exportTitel"),
    text: t("set.exportText"),
    felder: [
      { name: "pass", label: t("set.exportPass"), art: "text", pflicht: true, verdeckt: true },
      { name: "pass2", label: t("set.exportPass2"), art: "text", pflicht: true, verdeckt: true },
    ],
    ok: t("set.exportOk"),
    pruefe: (w) => (String(w.pass).normalize("NFC").length < MIN_PASSPHRASE ? t("ein.passZuKurz", { n: MIN_PASSPHRASE })
      : w.pass !== w.pass2 ? t("set.exportPassUngleich") : null),
  });
  if (!w) return;
  try {
    const { baueExport, exportDateiname, waehleExport } = await import("../../datenexport.js");
    const alle = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) ?? "");
    const daten = waehleExport(alle, (k) => (istGeheimnis(k) ? geheim.getItem(k) : localStorage.getItem(k)));
    const url = URL.createObjectURL(new Blob([await baueExport(daten, String(w.pass))], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = exportDateiname();
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(t("set.exportFertig", { n: Object.keys(daten).length }));
  } catch (e) {
    toast(fehlerText(e), true);
  }
}

/** Eine Export-Datei einlesen – nur, was dazugehört (`filtereExport()`), erst nach Rückfrage. */
async function leseExportDatei(datei: File): Promise<void> {
  const { EXPORT_MAX_BYTES, leseExport } = await import("../../datenexport.js");
  if (datei.size > EXPORT_MAX_BYTES) return toast(t("set.exportZuGross"), true);
  const w = await dialog({
    titel: t("set.einlesenTitel"),
    felder: [{ name: "pass", label: t("set.exportPass"), art: "text", pflicht: true, verdeckt: true }],
    ok: t("set.einlesenWeiter"),
  });
  if (!w) return;
  try {
    const { daten, zeit } = await leseExport(await datei.text(), String(w.pass));
    // Zusammenfuehren statt ueberschreiben (B-5)
    const { werte, bericht } = fuehreZusammen(daten, (k) => (istGeheimnis(k) ? geheim.getItem(k) : localStorage.getItem(k)));
    const frage = `${t("set.einlesenFrage", { n: Object.keys(daten).length, datum: new Date(zeit * 1000).toLocaleString(gebietsschema()) })}\n\n${zusammenfuehrText(bericht)}`;
    if (!(await bestaetige({ titel: t("set.einlesenTitel"), text: frage, ok: t("set.einlesenOk") }))) return;
    for (const [k, v] of Object.entries(werte)) {
      if (istGeheimnis(k)) await geheim.setItem(k, v);
      else localStorage.setItem(k, v);
    }
    toast(t("set.wiederhergestellt"));
    setTimeout(() => location.reload(), 900);
  } catch (e) {
    toast(fehlerText(e), true);
  }
}

/**
 * Schluesselwechsel vorbereiten.
 *
 * Der einzige Fall, den man NUR VORHER loesen kann. Nach einem Diebstahl ist
 * nichts mehr zu machen, wenn das Mandat fehlt.
 */
async function bereiteWechselVor(): Promise<void> {
  if (!state.keypair || !nurHauptidentitaet(t("set.wasWechsel"))) return;
  const { buildRotationMandate, generateKeypair, toHex: th } =
    await import("@freedomstack/protocol");

  if (!(await bestaetige({ titel: t("set.schritt3"), text: fliesstext(wechselWarnung()), ok: t("set.ersatzErzeugen") }))) return;
  try {
    const ersatz = generateKeypair();
    await (await ensurePool()).publish(
      await signiere(buildRotationMandate(state.keypair.pk, ersatz.pk)));

    // Der Ersatz darf NICHT auf diesem Geraet bleiben — wer beides hat, ist du.
    const url = URL.createObjectURL(new Blob([
      t("set.ersatzDatei", { privat: th(ersatz.sk), oeffentlich: ersatz.pk }),
    ], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "freedom-ersatzschluessel.txt";
    a.click();
    URL.revokeObjectURL(url);

    localStorage.setItem("freedom.rotationPrepared", "1");
    void aktualisiereSicherheitsStand();
    toast(t("set.vorbereitet"));
  } catch (e) {
    toast(fehlerText(e), true);
  }
}

/**
 * Gestohlenen Schluessel widerrufen – mit dem Ersatzschluessel aus der
 * Vorbereitung. Seit 8.6a werden die Eingaben geprueft (Hex vor fromHex) und
 * es wird nur widerrufen, wenn auf den Relays ein Mandat genau diesen Ersatz
 * nennt; sonst erkennt kein Kontakt den Widerruf an.
 */
async function widerrufeSchluessel(): Promise<void> {
  const { buildRevocation, signEvent: se, fromHex, parseRotationMandate, KIND_ROTATION_MANDATE, toHex: th } =
    await import("@freedomstack/protocol");
  const { decodeNpub } = await import("../../identity.js");
  const pubkeyAus = (roh: unknown): string => schluesselAusEingabe(roh, decodeNpub);
  const seitAus = (roh: unknown): number | undefined => (String(roh ?? "").trim() ? Math.floor(new Date(String(roh).trim()).getTime() / 1000) : undefined);
  // Ein Dialog statt confirm() und drei prompt() (C-1c): die Anleitung darüber, der private Ersatzschlüssel verdeckt
  const w = await dialog({
    titel: t("set.widerrufen"),
    text: fliesstext(widerrufAnleitung()),
    felder: [
      { art: "text", name: "alt", label: t("set.welcherGestohlen"), wert: state.keypair?.pk ?? "", pflicht: true, mono: true },
      { art: "text", name: "ersatz", label: t("set.ersatzFrage"), pflicht: true, mono: true, verdeckt: true },
      { art: "text", name: "seit", label: t("set.seitWann"), typ: "date" },
    ],
    pruefe: (w) => {
      if (!pubkeyAus(w.alt)) return t("set.keinPubkey");
      if (!/^[0-9a-f]{64}$/.test(String(w.ersatz).trim().toLowerCase())) return t("set.ersatzHex");
      const seit = seitAus(w.seit);
      return seit !== undefined && !Number.isFinite(seit) ? t("set.datumUnlesbar") : null;
    },
    ok: t("set.widerrufenKnopf"),
    gefahr: true,
  });
  if (!w) return;
  const alt = pubkeyAus(w.alt);
  const ersatzHex = String(w.ersatz).trim().toLowerCase();
  const seitUnix = seitAus(w.seit);
  if (!alt || (seitUnix !== undefined && !Number.isFinite(seitUnix))) return;
  if (!/^[0-9a-f]{64}$/.test(ersatzHex)) return;

  const sk = fromHex(ersatzHex);
  try {
    const { schnorr } = await import("@noble/curves/secp256k1.js");
    const pk = th(schnorr.getPublicKey(sk));
    const pool = await ensurePool();
    const mandate = await pool.query({ kinds: [KIND_ROTATION_MANDATE], authors: [alt], limit: 50 });
    const passt = mandate.some((ev) => { try { return parseRotationMandate(ev).newPubkey === pk; } catch { return false; } });
    if (!passt) {
      toast(t("set.keinMandat"), true);
      return;
    }
    await pool.publish(se(buildRevocation({
      oldPubkey: alt, newPubkey: pk, reason: "gestohlen",
      compromisedSince: seitUnix,
      note: "Schlüssel kompromittiert.", // kein UI-Text
    }), sk));

    toast(t("set.widerrufenFertig"));
  } catch (e) {
    toast(fehlerText(e), true);
  } finally {
    sk.fill(0);
  }
}

/** Stand einer Vollmacht → Schlüssel des Texts (der Stand selbst kommt aus `listDevices()`). */
const GERAET_STATUS: Record<import("@freedomstack/protocol").DeviceStatus, string> = {
  aktiv: "set.geraetAktiv", abgelaufen: "set.geraetAbgelaufen", entzogen: "set.geraetEntzogen", unbekannt: "set.geraetUnbekannt",
};

/** Geraete anzeigen. */
export async function zeigeGeraete(): Promise<void> {
  const box = $("#device-list");
  if (!box || !state.keypair) return;
  $("#device-add")?.classList.toggle("hidden", alsGeraet());
  try {
    // Als Geraet (8.6c): der Stand der eigenen Vollmacht statt der Liste
    if (state.person) {
      const { geraeteStand } = await import("../../geraete-modus.js");
      geraeteBuch.vergiss(state.person);
      const st = geraeteStand(state.keypair.pk, state.person, await geraeteBuch.vonPerson(state.person));
      box.textContent = t("set.geraetSprichtFuer", { person: pkShort(state.person), stand: st.text });
      box.classList.toggle("warn", !st.darfSchreiben);
      return;
    }
    const { listDevices, KIND_DEVICE_GRANT, KIND_DEVICE_REVOKE } =
      await import("@freedomstack/protocol");
    const pool = await ensurePool();
    const evs = await pool.query({
      kinds: [KIND_DEVICE_GRANT, KIND_DEVICE_REVOKE],
      authors: [state.keypair.pk], limit: 200,
    });
    const d = listDevices(state.keypair.pk, evs);

    // Namen der Geräte stehen in Vollmachten vom Relay – nur als Text (C-6b)
    box.replaceChildren(...(d.length === 0
      ? [el("span", t("set.nurDiesesGeraet"), "muted")]
      : d.map((x) => {
          const zeile = el("div", undefined, "usage-row");
          const stand = el("span", t(GERAET_STATUS[x.status]), x.status === "aktiv" ? "ok" : x.status === "abgelaufen" ? "warn" : "muted");
          if (x.status === "aktiv") {
            const knopf = el("button", t("set.entziehen"), "ghost dev-revoke");
            knopf.dataset.pk = x.devicePubkey;
            knopf.style.cssText = "width:auto;padding:1px 6px;font-size:10px";
            stand.append(" · ", knopf);
          }
          zeile.append(el("span", x.label), stand);
          return zeile;
        })));

    box.querySelectorAll(".dev-revoke").forEach((b) => {
      b.addEventListener("click", () => void entzieheGeraet((b as HTMLElement).dataset.pk!));
    });
  } catch (e) {
    box.textContent = t("agent.nichtAbrufbar", { fehler: fehlerText(e) });
  }
}

async function fuegeGeraetHinzu(): Promise<void> {
  if (!state.keypair || !nurHauptidentitaet(t("set.wasGeraete"))) return;
  const { defaultPermissions, buildDeviceGrant, generateKeypair, toHex: th } =
    await import("@freedomstack/protocol");
  const { geraeteCode } = await import("../../geraete-modus.js");

  // Kennungen bleiben, wie das Protokoll sie liest; der Hinweis nennt die Rechte
  const umfaenge = [["nur-chat", "set.umfangNurChat"], ["lesen-schreiben", "set.umfangLesenSchreiben"], ["vollzugriff", "set.umfangVoll"]] as const;
  const w = await dialog({
    titel: t("set.geraetHinzufuegen"),
    felder: [
      { art: "text", name: "name", label: t("set.geraetName"), pflicht: true },
      { art: "wahl", name: "umfang", label: t("set.geraetUmfang"), wert: "lesen-schreiben", pflicht: true, // kein UI-Text
        optionen: umfaenge.map(([wert, text]) => ({ wert, text: t(text), hinweis: defaultPermissions(wert).map(rechtName).join(", ") })) },
    ],
  });
  if (!w) return;
  const name = String(w.name).trim();
  const perms = defaultPermissions(w.umfang as (typeof umfaenge)[number][0]);
  const tage = 365;
  if (!await bestaetige({ titel: t("set.geraetHinzufuegen"), text: geraetWarnung(perms, tage), ok: t("set.geraetAusstellen") })) return;

  try {
    const geraet = generateKeypair();
    await (await ensurePool()).publish(await signiere(buildDeviceGrant({
      ownerPubkey: state.keypair.pk, devicePubkey: geraet.pk, label: name,
      permissions: perms, expiresAt: Math.floor(Date.now() / 1000) + tage * 86400,
    })));
    geraeteBuch.vergiss(state.keypair.pk); // ab jetzt bekommt das Geraet Kopien (8.6b)

    // Geraetecode (8.6c): auf dem anderen Geraet unter „Importieren“ einfuegen oder
    // als QR scannen (11.1b) – nur in diesem Dialog, nirgends gespeichert
    const code = geraeteCode(state.keypair.pk, th(geraet.sk));
    geraet.sk.fill(0);
    void zeigeGeraete();
    await dialog({
      titel: t("set.geraetCodeTitel", { name }), text: t("set.geraetCode"), ok: t("dlg.schliessen"), abbrechen: false,
      felder: [
        { art: "nurlesen", name: "code", label: t("set.geraetCodeFeld"), wert: code },
        { art: "qr", name: "qr", label: t("set.geraetCodeQr"), wert: code, geheim: true },
      ],
    });
  } catch (e) {
    toast(fehlerText(e), true);
  }
}

async function entzieheGeraet(devicePk: string): Promise<void> {
  if (!state.keypair) return;
  if (!(await bestaetige({ titel: t("set.entziehenTitel"), text: t("set.entziehenFrage"), ok: t("set.entziehenKnopf"), gefahr: true }))) return;
  try {
    const { buildDeviceRevoke } = await import("@freedomstack/protocol");
    await (await ensurePool()).publish(
      await signiere(buildDeviceRevoke(state.keypair.pk, devicePk, "entzogen"))); // kein UI-Text
    geraeteBuch.vergiss(state.keypair.pk); // keine Kopien mehr an das Geraet (8.6b)
    toast(t("set.entzogen"));
    void zeigeGeraete();
  } catch (e) {
    toast(fehlerText(e), true);
  }
}

/** Als Vertrauter fuer jemanden melden, der sich nicht meldet. */
async function meldeFuerAnderen(): Promise<void> {
  if (!state.keypair) return;
  const { decodeNpub } = await import("../../identity.js");
  const pubkeyAus = (roh: unknown): string => schluesselAusEingabe(roh, decodeNpub);
  // Dialog statt zwei prompt() (C-1c): nur ein gültiger Schlüssel; der Grund wird veröffentlicht
  const w = await dialog({
    titel: t("set.melden"),
    felder: [
      { art: "text", name: "wen", label: t("set.fuerWen"), pflicht: true, mono: true },
      { art: "textarea", name: "grund", label: t("set.warum"), pflicht: true },
    ],
    pruefe: (w) => (pubkeyAus(w.wen) ? null : t("set.keinPubkey")),
    ok: t("set.meldenKnopf"),
  });
  const wen = w ? pubkeyAus(w.wen) : "";
  const grund = String(w?.grund ?? "");
  if (!wen || !grund.trim()) return;

  try {
    const { buildRecoveryClaim } = await import("@freedomstack/protocol");
    await (await ensurePool()).publish(await signiere(buildRecoveryClaim(state.keypair.pk, wen, grund.trim())));
    toast(t("set.gemeldet"));
  } catch (e) {
    toast(fehlerText(e), true);
  }
}
