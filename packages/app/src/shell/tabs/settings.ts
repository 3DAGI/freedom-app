/**
 * Tab Settings: Sicherheitsstand, Nachfolge, verschlüsselte Sicherung,
 * Schlüsselwechsel, Geräte, Mesh, Gebühren, Weitergeben und Echtheitsprüfung.
 *
 * Aus app.ts verschoben (Schritt 1.0) – wörtlich, ohne Logikänderung.
 */
import { zahle } from "@freedomstack/protocol";
import { gebietsschema, t } from "../../i18n.js";
import { escapeHtml, pkShort } from "../../shell-logic.js";
import { zeigeDatenschutz } from "../datenschutz.js";
import { LS_ONION_PRUEFRELAY, onionRelay } from "../../onion-pruefung.js";
import { zeigeVertraute } from "../nachfolge-ui.js";
import { alsGeraet, ensurePool, mitBunker, mitRohemSchluessel, nimmInPool, signiere, state, veroeffentlicheWeit } from "../state.js";
import { ladeEigeneRelays, pruefeRelayEingabe, setzeEigeneRelays } from "../../relay-satz.js";
import { kaufeRelayZugang, leseRelayPreise, merkeZugang, pruefeBeimRelay, zugaenge, type RelayPreise, type Schiene } from "../../relay-kauf.js";
import { satsText, solText } from "../../preis-anzeige.js";
import { echtheitText, fehlerText, fixierungText, geraetWarnung, rechtName, nachfolgeStand, nachfolgeWarnung, offlineFaehigkeiten, sicherungGebaut, sicherungInfo, torText, wechselWarnung, wegName, weitergabeText, widerrufAnleitung, wiederherstellungText } from "../../protokoll-texte.js";
import { LS_VERSAND_VERZOEGERUNG, maxVerzoegerungSek } from "../versand.js";
import { rufStand, rufTeilenAn, setzeRufTeilen } from "../ruf.js";
import { geheim, istGeheimnis, tresorEingerichtet, wireTresorKarte } from "../tresor.js";
import { $, ganzeZahl, toast } from "../ui.js";
import { bestaetige, dialog } from "../dialog.js";
import { ladeAbdeckung, nutzeStandort, trageAbdeckungEin, vergissStandort, widerrufeAbdeckung } from "./earn.js";
import { LS_KONTAKTE_SICHERN, geraeteBuch, kontakteEinschalten, kontakteSichernAn, sichereKontakte } from "./kommunikation.js";
import { LS_STANDARD_SCHIENE, standardSchiene } from "../../standard-schiene.js";

// ------------------------------------------------- Nachfolge & Modelle

/** Als Geraet (8.6c) nicht: Nachfolge, Schluesselwechsel und Vollmachten gehoeren der Hauptidentitaet. */
function nurHauptidentitaet(was: string): boolean {
  if (!alsGeraet()) return true;
  toast(t("set.nurHaupt", { was }), true);
  return false;
}

/** Stand der Nachfolge anzeigen. */
export async function zeigeNachfolge(): Promise<void> {
  const box = $("#succession-status");
  if (!box || !state.keypair) return;
  // Fuer wen ich selbst Vertrauter bin (8.11b)
  void zeigeVertraute();
  try {
    const { parseSuccessionPlan, evaluateSuccession, KIND_SUCCESSION_PLAN, KIND_HEARTBEAT, KIND_RECOVERY_CLAIM } =
      await import("@freedomstack/protocol");
    const pool = await ensurePool();
    const evs = await pool.query({
      kinds: [KIND_SUCCESSION_PLAN, KIND_HEARTBEAT, KIND_RECOVERY_CLAIM],
      authors: undefined,
      "#p": [state.keypair.pk],
      limit: 200,
    });
    const eigene = await pool.query({
      kinds: [KIND_SUCCESSION_PLAN, KIND_HEARTBEAT],
      authors: [state.keypair.pk],
      limit: 200,
    });
    const planEv = eigene.find((e) => e.kind === KIND_SUCCESSION_PLAN);
    if (!planEv) {
      box.innerHTML = `<span class="muted">${escapeHtml(t("set.nfNicht"))}</span>`;
      return;
    }
    const plan = parseSuccessionPlan(planEv);
    const st = evaluateSuccession(plan, [...evs, ...eigene]);
    const cls = st.status === "aktiv" ? "ok" : st.status === "freigegeben" ? "err" : "warn";
    box.innerHTML =
      `<span class="${cls}">${escapeHtml(nachfolgeStand(st, plan))}</span><br>` +
      `<span class="muted">${escapeHtml(t("set.nfPlan", { schwelle: plan.threshold, von: plan.guardians.length, frist: plan.inactivityDays, warte: plan.graceDays }))}</span>`;
  } catch (e) {
    box.textContent = t("agent.nichtAbrufbar", { fehler: fehlerText(e) });
  }
}

/** Nachfolge einrichten — mit Aufklaerung ueber die Grenze. */
export async function richteNachfolgeEin(): Promise<void> {
  if (!state.keypair || !nurHauptidentitaet(t("set.wasNachfolge"))) return;
  const {
    splitSecret, secretHashOf, buildSuccessionPlan, baueAnteilUmschlag, neueTeilung,
  } = await import("@freedomstack/protocol");
  const { decodeNpub } = await import("../../identity.js");

  const eingabe = prompt(t("set.vertrauteFrage"));
  if (!eingabe) return;
  const guardians = [...new Set(eingabe.split(",").map((x) => x.trim()).map((x) => {
    try {
      return x.startsWith("npub1") ? decodeNpub(x) : x.toLowerCase();
    } catch {
      return "";
    }
  }).filter((x) => /^[0-9a-f]{64}$/.test(x) && x !== state.keypair!.pk))];
  if (guardians.length < 3) {
    toast(t("set.mindestensDrei"), true);
    return;
  }
  const threshold = Math.max(2, Math.ceil(guardians.length / 2));

  if (!confirm(nachfolgeWarnung({ guardians: guardians.length, threshold, graceDays: 30 }))) return;

  try {
    // Die Teile entstehen LOKAL; jeder geht versiegelt (NIP-59) an genau
    // seinen Vertrauten (8.11). Bis 8.11 gab es eine Datei mit allen Teilen –
    // wer sie hatte, hatte alles.
    const { teile, hash } = mitRohemSchluessel(t("set.fuerNachfolge"), (sk) => ({
      teile: splitSecret(sk, guardians.length, threshold), hash: secretHashOf(sk),
    }));
    const teilung = neueTeilung();
    const { veroeffentlicheDm } = await import("./kommunikation.js");
    try {
      for (const [i, t] of teile.entries()) {
        const wrap = await baueAnteilUmschlag({
          von: state.signer!, an: guardians[i]!, anteil: t, schwelle: threshold, anzahl: guardians.length, secretHash: hash, teilung,
        });
        await veroeffentlicheDm(wrap, guardians[i]!);
      }
    } finally {
      for (const t of teile) t.data.fill(0);
    }
    const pool = await ensurePool();
    await pool.publish(await signiere(buildSuccessionPlan({
      ownerPubkey: state.keypair.pk,
      guardians,
      threshold,
      inactivityDays: 180,
      graceDays: 30,
      secretHash: hash,
    })));

    localStorage.setItem("freedom.successionSet", "1");
    void aktualisiereSicherheitsStand();
    toast(t("set.nfEingerichtet", { n: guardians.length }));
    void zeigeSicherung();
    void zeigeGeraete();
    void zeigeNachfolge();
  } catch (e) {
    toast(fehlerText(e), true);
  }
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
    if (!confirm(`${wiederherstellungText(r)}\n\n${t("set.ueberschreibenFrage")}`)) return;
    for (const [k, v] of Object.entries(daten)) {
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

  if (!confirm(wechselWarnung())) return;
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
  if (!confirm(widerrufAnleitung())) return;

  let alt = prompt(t("set.welcherGestohlen"), state.keypair?.pk ?? "")?.trim() ?? "";
  if (!alt) return;
  if (alt.startsWith("npub1")) {
    try {
      const { decodeNpub } = await import("../../identity.js");
      alt = decodeNpub(alt);
    } catch { alt = ""; }
  }
  alt = alt.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(alt)) { toast(t("set.keinPubkey"), true); return; }
  const ersatzHex = prompt(t("set.ersatzFrage"))?.trim().toLowerCase() ?? "";
  if (!ersatzHex) return;
  if (!/^[0-9a-f]{64}$/.test(ersatzHex)) { toast(t("set.ersatzHex"), true); return; }
  const seit = prompt(t("set.seitWann"));
  const seitUnix = seit?.trim() ? Math.floor(new Date(seit.trim()).getTime() / 1000) : undefined;
  if (seit?.trim() && !Number.isFinite(seitUnix)) { toast(t("set.datumUnlesbar"), true); return; }

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

    box.innerHTML = d.length === 0
      ? `<span class="muted">${escapeHtml(t("set.nurDiesesGeraet"))}</span>`
      : d.map((x) => {
          const cls = x.status === "aktiv" ? "ok" : x.status === "abgelaufen" ? "warn" : "muted";
          return `<div class="usage-row"><span>${escapeHtml(x.label)}</span>` +
            `<span class="${cls}">${escapeHtml(t(GERAET_STATUS[x.status]))}` +
            (x.status === "aktiv"
              ? ` · <button class="ghost dev-revoke" data-pk="${escapeHtml(x.devicePubkey)}"
                   style="width:auto;padding:1px 6px;font-size:10px">${escapeHtml(t("set.entziehen"))}</button>`
              : "") + `</span></div>`;
        }).join("");

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
  if (!confirm(t("set.entziehenFrage"))) return;
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
  const wen = prompt(t("set.fuerWen"));
  if (!wen?.trim()) return;
  const grund = prompt(t("set.warum"));
  if (!grund?.trim()) return;

  try {
    const { buildRecoveryClaim } = await import("@freedomstack/protocol");
    await (await ensurePool()).publish(await signiere(buildRecoveryClaim(state.keypair.pk, wen.trim(), grund.trim())));
    toast(t("set.gemeldet"));
  } catch (e) {
    toast(fehlerText(e), true);
  }
}

// ------------------------------------------------------------- Mesh-Tab

let meshNode: import("../../mesh-radio.js").MeshNode | null = null;

/** Offline-SOL-Zahlungen, die ankamen, als dieses Geraet selbst offline war (nur im Speicher). */
const wartendeSol: Uint8Array[] = [];

/**
 * Empfangene Offline-SOL-Zahlung (7.2) einreichen – dieses Geraet ist das
 * Gateway. Ohne Netz bleibt sie im Speicher und geht raus, sobald Netz da ist;
 * weitergereicht hat der Funkknoten sie ohnehin.
 */
async function reicheSolEin(roh: Uint8Array): Promise<void> {
  const { netzDa } = await import("../ui.js");
  if (!netzDa()) {
    if (wartendeSol.length < 20) wartendeSol.push(roh);
    toast(t("set.solOfflineWartet"));
    return;
  }
  try {
    const { reicheSolOfflineEin } = await import("../zahlschienen.js");
    const signatur = await reicheSolOfflineEin(roh);
    toast(t("set.solOfflineEingereicht", { sig: signatur.slice(0, 8) }));
  } catch (e) {
    toast(t("set.solOfflineFehler", { fehler: fehlerText(e) }), true);
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    for (const roh of wartendeSol.splice(0)) void reicheSolEin(roh);
  });
}

/** Ist ein Funkgeraet verbunden (USB oder Bluetooth)? Der Datei-Weg zaehlt nicht. */
export function funkGeraetVerbunden(): boolean {
  const art = meshNode?.transportArt;
  return art === "seriell" || art === "bluetooth";
}

/**
 * Ueber das verbundene Funkgeraet senden (7.2: Offline-SOL-Zahlung). false,
 * wenn keines verbunden ist – dann nimmt der Aufrufer den Datei-Weg.
 */
export async function sendeUeberFunk(
  payload: Uint8Array, kind: import("@freedomstack/protocol").MeshKind, label: string,
  /** Vorrang in der Warteschlange – Zahlungen zuerst, KI über Funk (7.4c3) wie eine Nachricht. */
  vorrang?: import("@freedomstack/protocol").MeshPriority,
): Promise<boolean> {
  if (!meshNode || !funkGeraetVerbunden()) return false;
  const { MeshPriority } = await import("@freedomstack/protocol");
  meshNode.enqueue(payload, kind, vorrang ?? MeshPriority.Zahlung, label);
  return true;
}

/**
 * Mesh-Knoten aufsetzen.
 *
 * Empfangene Nachrichten werden wie ganz normale Nostr-Events behandelt — die
 * Schicht darueber unterscheidet nicht, ob etwas ueber ein Relay oder ueber
 * Funk kam. Genau das ist der Sinn: Bei einem Netzausfall aendert sich die
 * Zustellung, nicht die Anwendung.
 */
async function ensureMeshNode(): Promise<import("../../mesh-radio.js").MeshNode> {
  // Eigener Schluessel: darf in keinem gesendeten Paket stehen (7.1).
  if (meshNode) {
    meshNode.setEigeneSchluessel(state.keypair ? [state.keypair.pk] : []);
    return meshNode;
  }
  const { MeshNode, meshToEvent } = await import("../../mesh-radio.js");

  meshNode = new MeshNode({
    onMessage: (payload, kind) => {
      void (async () => {
        // Hier kommt nur an, was pruefeMeshInhalt() durchliess (7.1):
        // gueltig signierte Umschlaege und signierte Solana-Transaktionen.
        const { MeshKind } = await import("@freedomstack/protocol");
        if (kind === MeshKind.NostrEvent) {
          try {
            const ev = meshToEvent(payload);
            // Antwort auf eine KI-Anfrage über Funk (7.4c2): zeigen – sie kam schon aus dem Netz
            const { nimmFunkAntwort } = await import("../ki-ueber-funk.js");
            if (await nimmFunkAntwort(ev as import("@freedomstack/protocol").NostrEvent)) return;
            // Ueber den Pool weiterverteilen: Eine Nachricht, die nur auf
            // diesem Geraet ankommt, hat den halben Weg umsonst gemacht.
            const pool = await ensurePool();
            await pool.publish(ev as never).catch(() => { /* offline */ });
            toast(t("set.funkEmpfangen"));
          } catch { toast(t("set.paketUnlesbar"), true); }
        } else if (kind === MeshKind.SolanaTx) {
          void reicheSolEin(payload);
        }
      })();
    },
    onProgress: (info) => {
      const el = $("#mesh-status");
      if (!el) return;
      el.textContent = info.wartetSekunden
        ? t("set.sendezeitAufgebraucht", { min: Math.ceil(info.wartetSekunden / 60), n: info.sending })
        : info.sending > 0
          ? t("set.paketeOffen", { n: info.sending, s: info.etaSeconds })
          : info.receiving > 0 ? t("set.unvollstaendig", { n: info.receiving }) : t("set.bereit");
    },
    onLog: (line) => console.log(`[mesh] ${line}`),
  });
  meshNode.setEigeneSchluessel(state.keypair ? [state.keypair.pk] : []);
  return meshNode;
}

/** Hinweis zum Weg ans Funkgerät – beim Öffnen der Settings neu, so folgt er einem Sprachwechsel (8.16g2a). */
export async function zeigeMeshWeg(): Promise<void> {
  const { detectTransports } = await import("../../mesh-radio.js");
  const info = $("#mesh-transport");
  if (info) info.textContent = detectTransports().note;
}

export async function wireMeshTab(): Promise<void> {
  const { detectTransports } = await import("../../mesh-radio.js");
  const info = $("#mesh-transport");
  if (info) {
    const wege = detectTransports();
    info.textContent = wege.note;
    const btn = $("#mesh-connect") as HTMLButtonElement | null;
    if (btn && wege.recommendation === "datei") {
      // Keinen Knopf anbieten, der auf diesem Geraet nichts tun kann.
      btn.disabled = true;
      btn.dataset.i18n = "set.keinGeraetezugriff";
      btn.textContent = t("set.keinGeraetezugriff");
    }
  }

  const connect = $("#mesh-connect");
  if (connect) connect.onclick = async () => {
    try {
      const { connectSerial } = await import("../../mesh-radio.js");
      const n = await ensureMeshNode();
      await n.attach(await connectSerial(115200, (raw) => n.receive(raw)));
      $("#mesh-status").textContent = t("set.verbundenMit", { name: n.transportName ?? "" });
      toast(t("set.funkVerbunden"));
    } catch (e) {
      $("#mesh-status").textContent = fehlerText(e);
    }
  };

  const bt = $("#mesh-bt");
  if (bt) bt.onclick = async () => {
    try {
      const { connectBluetooth } = await import("../../mesh-radio.js");
      const n = await ensureMeshNode();
      await n.attach(await connectBluetooth((raw) => n.receive(raw)));
      $("#mesh-status").textContent = t("set.verbundenMit", { name: n.transportName ?? "" });
      // Das Bluetooth-Geraet ist ein Funkgeraet – es sendet ueber LoRa (7.1).
      void zeigeOfflineFaehigkeiten("lora");
      toast(t("set.bluetoothVerbunden"));
    } catch (e) {
      $("#mesh-status").textContent = fehlerText(e);
    }
  };

  void zeigeOfflineFaehigkeiten("lora");

  const netz = $("#net-mode") as HTMLSelectElement | null;
  if (netz) {
    netz.value = localStorage.getItem("freedom.network") ?? "klar";
    netz.onchange = async () => {
      localStorage.setItem("freedom.network", netz.value);
      // Bei Tor die .onion-Relays nach vorn holen — sonst ist die
      // Einstellung nur eine Beschriftung.
      try {
        const { sortByTorPreference } = await import("@freedomstack/protocol");
        const pool = await ensurePool();
        const bekannt = JSON.parse(
          localStorage.getItem("freedom.relays") ?? "[]",
        ) as string[];
        const r = sortByTorPreference(bekannt, {
          onionOnly: false, preferOnion: netz.value !== "klar",
        });
        // Die Reihenfolge wird gemerkt — beim naechsten Start kommen die
        // Zwiebeladressen zuerst dran.
        localStorage.setItem("freedom.relays", JSON.stringify(r.relays));
        void pool;
        if (netz.value !== "klar") toast(torText(r, { onionOnly: false, preferOnion: true }));
      } catch { /* Reihenfolge bleibt */ }
      void zeigeDatenschutz();
    };
  }
  // Ehrlicher Modus (6.2): Der Bericht prueft beim Oeffnen (switchTab), ob ein
  // .onion-Relay erreichbar ist – nicht schon beim Start.
  const pruefRelay = document.getElementById("onion-pruefrelay") as HTMLInputElement | null;
  if (pruefRelay) {
    pruefRelay.value = localStorage.getItem(LS_ONION_PRUEFRELAY) ?? "";
    pruefRelay.onchange = () => {
      const roh = pruefRelay.value.trim();
      const url = onionRelay(roh);
      if (roh && !url) {
        toast(t("set.keineOnion"), true);
        return;
      }
      if (url) localStorage.setItem(LS_ONION_PRUEFRELAY, url);
      else localStorage.removeItem(LS_ONION_PRUEFRELAY);
      pruefRelay.value = url ?? "";
      void zeigeDatenschutz();
    };
  }
  const pruefen = document.getElementById("onion-pruefen");
  if (pruefen) pruefen.onclick = () => void zeigeDatenschutz(true);

  wireRelayKarte();
  wireRelayZugang();

  // MLS-Engine (2.2b-b): erst der Selbsttest lädt sie – vorher bleibt sie gepackt.
  const mlsKnopf = document.getElementById("mls-selbsttest") as HTMLButtonElement | null;
  if (mlsKnopf) mlsKnopf.onclick = async () => {
    const aus = document.getElementById("mls-ergebnis");
    mlsKnopf.disabled = true;
    if (aus) aus.textContent = t("set.laeuft");
    const { mlsSelbsttest } = await import("../../mls-engine.js");
    const r = await mlsSelbsttest();
    if (aus) aus.textContent = t(r.ok ? "set.selbsttestOk" : "set.selbsttestFehler", { text: r.text, ms: r.ms });
    mlsKnopf.disabled = false;
  };

  // Standard-Schiene (4.1c): Vorgabe fuer Zaps und Trinkgeld
  const schiene = document.getElementById("standard-schiene") as HTMLSelectElement | null;
  if (schiene) {
    schiene.value = standardSchiene();
    schiene.onchange = () => {
      localStorage.setItem(LS_STANDARD_SCHIENE, schiene.value === "solana" ? "solana" : "lightning");
      toast(t("set.schieneGesetzt", { schiene: t(schiene.value === "solana" ? "zahl.optSolana" : "zahl.optLightning") }));
    };
  }

  // Private Kontaktliste (2.5b) – Standard aus; beim Ausschalten wird die Liste geleert.
  const kontakte = document.getElementById("kontakte-sichern") as HTMLInputElement | null;
  if (kontakte) {
    kontakte.checked = kontakteSichernAn();
    kontakte.onchange = async () => {
      try {
        if (kontakte.checked) {
          const neu = await kontakteEinschalten();
          toast(neu ? t("set.kontakteGesichertNeu", { n: neu }) : t("set.kontakteGesichert"));
        } else {
          localStorage.removeItem(LS_KONTAKTE_SICHERN);
          await sichereKontakte(true);
          toast(t("set.abgleichAus"));
        }
      } catch (e) {
        kontakte.checked = kontakteSichernAn();
        toast(t("set.kontaktlisteFehler", { fehler: fehlerText(e) }), true);
      }
    };
  }

  // Ruf mit Kontakten teilen (5.5c) – Standard aus; versiegelt, je Kontakt ein Umschlag im Abruftakt
  const ruf = document.getElementById("ruf-teilen") as HTMLInputElement | null;
  const rufZeile = document.getElementById("ruf-stand");
  const zeigeRuf = () => { if (rufZeile) rufZeile.textContent = t("set.rufStand", rufStand()); };
  if (ruf) {
    ruf.checked = rufTeilenAn();
    zeigeRuf();
    ruf.onchange = () => {
      setzeRufTeilen(ruf.checked);
      toast(t(ruf.checked ? "set.rufAn" : "set.rufAus"));
      zeigeRuf();
    };
  }

  // Versandverzoegerung (6.4): jede Kopie einer Direktnachricht mit eigener Zufallsverzoegerung
  const verzoegerung = document.getElementById("versand-verzoegerung") as HTMLSelectElement | null;
  if (verzoegerung) {
    verzoegerung.value = String(maxVerzoegerungSek());
    verzoegerung.onchange = () => {
      localStorage.setItem(LS_VERSAND_VERZOEGERUNG, verzoegerung.value);
      verzoegerung.value = String(maxVerzoegerungSek());
      toast(verzoegerung.value === "0" ? t("set.sofort") : t("set.verzoegert", { s: verzoegerung.value }));
    };
  }

  const exp = $("#mesh-export");
  if (exp) exp.onclick = async () => {
    const { fileTransport } = await import("../../mesh-radio.js");
    const n = await ensureMeshNode();
    let ausgegeben = false;
    const datei = fileTransport((data, count) => {
      ausgegeben = true;
      const url = URL.createObjectURL(new Blob([data as BlobPart], { type: "application/octet-stream" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `freedom-${Date.now()}.meshpkt`;
      a.click();
      URL.revokeObjectURL(url);
      toast(t("set.paketeAusgegeben", { n: count }));
    });
    await n.attach(datei);
    // Kurz warten, damit die Warteschlange durchlaeuft, dann buendeln.
    setTimeout(() => void datei.close().then(() => {
      if (!ausgegeben) toast(t("set.nichtsZuSendenChat"));
    }), 500);
  };

  const impBtn = $("#mesh-import");
  const impInput = $("#mesh-import-input") as HTMLInputElement | null;
  if (impBtn && impInput) {
    impBtn.onclick = () => impInput.click();
    impInput.onchange = async () => {
      const f = impInput.files?.[0];
      if (!f) return;
      const n = await ensureMeshNode();
      const anzahl = n.receiveBundle(new Uint8Array(await f.arrayBuffer()));
      toast(t("set.paketeEingelesen", { n: anzahl }));
      impInput.value = "";
    };
  }

  const refresh = $("#coverage-refresh");
  if (refresh) refresh.onclick = () => void ladeAbdeckung();
  const join = $("#coverage-join");
  if (join) join.onclick = () => void trageAbdeckungEin();
  const leave = $("#coverage-leave");
  if (leave) leave.onclick = () => void widerrufeAbdeckung();
  const hierZeigen = $("#coverage-standort");
  if (hierZeigen) hierZeigen.onclick = () => void nutzeStandort();
  const vergessen = $("#coverage-vergessen");
  if (vergessen) vergessen.onclick = () => vergissStandort();

  void ladeAbdeckung();
  setInterval(() => zeigeWarteschlange(), 2000);
}

/**
 * Was ohne Internet geht — je nach Strecke.
 *
 * Die Auskunft kommt aus dem Protokoll, damit Oberflaeche und Dokumentation
 * dasselbe sagen. Ein Versprechen, das an zwei Stellen verschieden lautet,
 * wird an der schwaecheren geglaubt.
 */
async function zeigeOfflineFaehigkeiten(link: "lora" | "bluetooth" | "datei"): Promise<void> {
  const box = $("#offline-caps");
  if (!box) return;
  box.innerHTML =
    `<div class="muted" style="margin-bottom:5px">${escapeHtml(t("set.ueber", { weg: wegName(link) }))}</div>` +
    offlineFaehigkeiten(link).map((f) =>
      `<div class="usage-row"><span>${f.works ? "✓" : "✕"} ${escapeHtml(f.feature)}</span>` +
      `<span class="muted" style="font-size:10px;max-width:58%">${escapeHtml(f.note)}</span></div>`,
    ).join("");
}

function zeigeWarteschlange(): void {
  const el = $("#mesh-queue");
  if (!el || !meshNode) return;
  const p = meshNode.pending;
  el.innerHTML = p.length === 0
    ? escapeHtml(t("set.nichtsZuSenden"))
    : p.map((m) => `${escapeHtml(m.label)} — ${escapeHtml(t("set.paketeOffenKurz", { n: m.framesLeft }))}`).join("<br>");
}

/** Stand der Sicherheit: Punktzahl neben dem Settings-Eintrag, solange etwas fehlt. */
export async function aktualisiereSicherheitsStand(): Promise<void> {
  const badge = document.getElementById("settings-security-badge");
  if (!badge || !state.keypair) return;
  const { backupStatus } = await import("../../identity.js");
  const schritte = [
    backupStatus().confirmed,
    !!localStorage.getItem("freedom.backupAt"),
    localStorage.getItem("freedom.rotationPrepared") === "1",
    localStorage.getItem("freedom.successionSet") === "1",
    tresorEingerichtet(),
  ];
  const erledigt = schritte.filter(Boolean).length;
  badge.textContent = erledigt < schritte.length ? `${erledigt}/${schritte.length}` : "";
  badge.classList.toggle("warn", erledigt < schritte.length);

  // Schrittliste oben in Sicherheit
  schritte.forEach((ok, i) => {
    const el = document.querySelector<HTMLElement>(`[data-sec-step="${i}"]`);
    if (!el) return;
    el.classList.toggle("done", ok);
    const btn = el.querySelector<HTMLElement>(".sec-action");
    if (btn) btn.hidden = ok;
  });
  document.querySelectorAll<HTMLElement>(".sec-progress span").forEach((s, i) => {
    s.classList.toggle("on", i < erledigt);
  });
  wireTresorKarte();
}

/**
 * Die App exportiert sich selbst.
 *
 * Damit wird jede Installation zu einer Bezugsquelle. Faellt die Domain aus —
 * beschlagnahmt, gekuendigt, DNS manipuliert —, kann jeder Nutzer die App
 * weitergeben, und der Empfaenger kann ihre Echtheit gegen das signierte
 * Manifest auf den Relays pruefen. Ein Bezugsweg, der an einem Domainnamen
 * haengt, war der zweite Punkt, an dem das System doch abschaltbar war.
 */
export async function exportiereApp(): Promise<void> {
  const status = $("#selfexport-status");
  try {
    if (status) status.textContent = t("set.leseDatei");
    // Die App holt sich selbst — im Einzeldatei-Build ist das genau die Datei,
    // die der Nutzer weitergeben soll.
    const res = await fetch(location.href, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const { hashText } = await import("@freedomstack/protocol");
    const hash = hashText(html);
    const version = (window as unknown as { FREEDOM_VERSION?: string }).FREEDOM_VERSION ?? "dev";

    const lade = (inhalt: BlobPart, name: string, typ: string): void => {
      const url = URL.createObjectURL(new Blob([inhalt], { type: typ }));
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    };

    lade(html, "freedom.html", "text/html");
    // Die Prueflanleitung wandert mit: Wer weitergibt, soll sie nicht selbst
    // formulieren muessen.
    lade(weitergabeText(hash, version), "freedom-pruefen.txt", "text/plain");

    if (status) {
      status.innerHTML =
        `${escapeHtml(t("set.exportiertPruefsumme"))}<br><span class="mono-sm">${escapeHtml(hash)}</span><br>` +
        escapeHtml(t("set.exportiertText"));
      status.className = "mono-sm ok";
    }
    toast(t("set.appExportiert"));
  } catch (e) {
    if (status) {
      status.textContent = t("set.exportFehler", { fehler: fehlerText(e) });
      status.className = "mono-sm warn";
    }
  }
}

/** Fixierte Version (5.2) – kein Geheimnis: nur Version und Pruefsumme. */
const LS_RELEASE_FIX = "freedom.release.fix";

function ladeFixierung(): import("@freedomstack/protocol").Fixierung | null {
  try {
    const f = JSON.parse(localStorage.getItem(LS_RELEASE_FIX) ?? "null") as { version?: unknown; sha256?: unknown } | null;
    return f && typeof f.version === "string" && typeof f.sha256 === "string" && /^[0-9a-f]{64}$/.test(f.sha256)
      ? { version: f.version, sha256: f.sha256 } : null;
  } catch {
    return null;
  }
}

/** Eigene Datei hashen und gegen die Manifeste im Netz pruefen (k von n). */
async function echtheit() {
  const {
    hashText, parseReleaseManifest, verifyArtifact, latestRelease, allSources, pruefeFixierung,
    KIND_RELEASE_MANIFEST,
  } = await import("@freedomstack/protocol");
  const res = await fetch(location.href, { cache: "no-store" });
  const hash = hashText(await res.text());
  const pool = await ensurePool();
  const evs = await pool.query({ kinds: [KIND_RELEASE_MANIFEST], limit: 50 });
  const manifeste = evs.map((e) => {
    try { return parseReleaseManifest(e); } catch { return null; }
  }).filter((m): m is NonNullable<typeof m> => m !== null);
  const r = verifyArtifact(hash, "freedom.html", manifeste, TRUSTED_SIGNERS);
  return {
    hash, r,
    neueste: latestRelease(manifeste, TRUSTED_SIGNERS),
    quellen: allSources(manifeste, TRUSTED_SIGNERS),
    fixierung: pruefeFixierung(ladeFixierung(), hash, r),
  };
}

/** Prueft die eigene Datei gegen die signierten Manifeste im Netz. */
export async function pruefeEigeneEchtheit(): Promise<void> {
  const box = $("#selfcheck-status");
  if (!box) return;
  try {
    const { hash, r, neueste, quellen, fixierung } = await echtheit();
    const cls = r.status === "echt" ? "ok" : r.status === "abweichend" ? "err" : "warn";

    box.innerHTML =
      `<span class="${cls}">${escapeHtml(echtheitText(r, "freedom.html"))}</span>` +
      (neueste && neueste.version !== r.version
        ? `<br>${escapeHtml(t("set.neuereVersion", { version: neueste.version }))}`
        : "") +
      (quellen.length > 0
        ? `<br><span class="muted">${escapeHtml(t("set.bezugsquellen", { quellen: quellen.join(", ") }))}</span>`
        : "");
    // Fixieren (5.2): Danach laeuft keine andere Version ohne Rueckfrage.
    const fix = ladeFixierung();
    const zeile = document.createElement("div");
    if (fixierung.status !== "passt") zeile.textContent = fixierungText(fixierung.status, fix?.version ?? "", r.version);
    else if (fix) zeile.textContent = t("set.fixiert", { version: fix.version });
    box.appendChild(zeile);
    const knopf = (text: string, tun: () => void) => {
      const b = document.createElement("button");
      b.className = "ghost";
      b.style.cssText = "width:auto;padding:4px 8px;margin-top:4px";
      b.textContent = text;
      b.addEventListener("click", () => { tun(); void pruefeEigeneEchtheit(); });
      box.appendChild(b);
    };
    if (r.status === "echt" && r.version && fix?.sha256 !== hash) {
      const version = r.version;
      knopf(t("set.fixieren", { version }), () => localStorage.setItem(LS_RELEASE_FIX, JSON.stringify({ version, sha256: hash })));
    }
    if (fix) knopf(t("set.fixierungAufheben"), () => localStorage.removeItem(LS_RELEASE_FIX));
  } catch (e) {
    box.textContent = t("set.echtheitFehler", { fehler: fehlerText(e) });
    box.className = "mono-sm warn";
  }
}

/**
 * Beim Start (5.2): Ist eine Version fixiert und laeuft eine andere, fragt die
 * App nach – bestaetigte neue Version uebernehmen, sonst deutliche Warnung.
 * Ohne Fixierung passiert nichts.
 */
export async function pruefeFixierungBeimStart(): Promise<void> {
  if (!ladeFixierung()) return;
  try {
    const { hash, r, fixierung } = await echtheit();
    const fixVersion = ladeFixierung()?.version ?? "";
    if (fixierung.status === "andere-echt" && r.version && confirm(fixierungText(fixierung.status, fixVersion, r.version))) {
      localStorage.setItem(LS_RELEASE_FIX, JSON.stringify({ version: r.version, sha256: hash }));
      toast(t("set.versionFixiert", { version: r.version }));
    } else if (fixierung.status !== "passt") {
      toast(fixierungText(fixierung.status, fixVersion, r.version), true);
    }
  } catch { /* ohne Netz oder als lokale Datei nicht pruefbar – beim naechsten Start erneut */ }
}

/**
 * Signierschluessel, denen die App bei Release-Manifesten vertraut.
 *
 * Ohne diese Liste koennte jeder ein Manifest fuer seine eigene manipulierte
 * Datei veroeffentlichen und sie als echt ausweisen. Die Pruefung ist genau so
 * viel wert wie diese Liste — deshalb steht sie im Quelltext und nicht in
 * einer Konfiguration, die sich unterwegs aendern laesst. Seit 5.2 muessen
 * mindestens `RELEASE_MIN_SIGNATUREN` (2) von ihnen dieselbe Version
 * bestaetigen – ein einzelner gestohlener Schluessel reicht nicht.
 */
const TRUSTED_SIGNERS: string[] = [
  // VOR DEM RELEASE SETZEN: Pubkeys der Signierschluessel (mindestens zwei Personen oder Geraete).
];

/**
 * Gebühren (A+, 5.1.3): was die App an Anteilen gesammelt hat – gezahlt ab
 * 100 sats je Empfänger. Zahlungen mit unklarem Ausgang klärt der Nutzer hier;
 * von selbst zahlt die App sie nie ein zweites Mal.
 */
export async function wireGebuehrenKarte(): Promise<void> {
  const box = document.getElementById("anteile-stand");
  const knopf = document.getElementById("anteile-zahlen") as HTMLButtonElement | null;
  if (!box || !knopf) return;
  const { kasse, zahleAnteile } = await import("../ki-zahlung.js");
  const sat = (msat: number) => `${(msat / 1000).toLocaleString(gebietsschema(), { maximumFractionDigits: 3 })} sats`;
  const zeige = (): void => {
    box.replaceChildren();
    const zeile = (text: string): HTMLElement => {
      const d = document.createElement("div");
      d.textContent = text;
      box.append(d);
      return d;
    };
    if (tresorEingerichtet() && geheim.keys().length === 0) { zeile(t("set.tresorGesperrt")); return; }
    const { offen, unklar } = kasse.stand();
    if (offen.length === 0 && unklar.length === 0) zeile(t("set.nichtsGesammelt"));
    for (const o of offen) zeile(t("set.gesammelt", { ziel: o.ziel, betrag: sat(o.msat) }));
    for (const u of unklar) {
      const d = zeile(t("set.ausgangUnklar", { ziel: u.ziel, betrag: sat(u.msat) }));
      for (const [schluessel, gezahlt] of [["set.kamAn", true], ["set.kamNichtAn", false]] as const) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "ghost";
        b.style.cssText = "width:auto;padding:2px 8px;margin-left:4px";
        b.textContent = t(schluessel);
        b.onclick = () => void kasse.klaere(u.rechnung, gezahlt).then(zeige, (e: Error) => toast(e.message, true));
        d.append(b);
      }
    }
  };
  zeige();
  knopf.onclick = async () => {
    knopf.disabled = true;
    try {
      const r = await zahleAnteile();
      toast(r.gezahltMsat > 0 ? t("set.anteileGezahlt", { betrag: sat(r.gezahltMsat) }) : t("set.nichtsFaellig"));
    } catch (e) {
      toast(fehlerText(e), true);
    } finally {
      knopf.disabled = false;
      zeige();
    }
  };
}

/**
 * Relay-Zugang kaufen (8.4c): Preis aus NIP-11, Angebot geprüft, bezahlt über
 * die Zahlschienen, bestätigt vom Relay. Bleibt die Bestätigung aus, ist das
 * Angebot gemerkt – „Zahlung erneut prüfen“. Als Gerät nicht: der Posteingang
 * gehört der Person.
 */
function wireRelayZugang(): void {
  const $e = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
  const feld = $e<HTMLInputElement>("relay-zugang-url");
  const [preisK, satsK, solK, pruefK] = ["relay-zugang-preis", "relay-zugang-sats", "relay-zugang-sol", "relay-zugang-pruefen"].map((id) => $e<HTMLButtonElement>(id));
  const status = $e("relay-zugang-status");
  if (!feld || !preisK || !satsK || !solK || !pruefK || !status) return;
  if (alsGeraet()) {
    preisK.disabled = true;
    status.textContent = t("set.geraetKauftNicht");
    return;
  }
  feld.value = ladeEigeneRelays(localStorage)[0] ?? "";
  let preise: RelayPreise | null = null;
  const relay = () => feld.value.trim();
  const zeigeStand = (mitText = true) => {
    const z = zugaenge(localStorage)[relay()];
    pruefK.classList.toggle("hidden", !z?.offen);
    if (mitText && z?.bis) status.textContent = t("set.zugangBis", { datum: new Date(z.bis * 1000).toLocaleDateString(gebietsschema()) });
  };
  feld.oninput = () => { preise = null; satsK.classList.add("hidden"); solK.classList.add("hidden"); status.textContent = ""; zeigeStand(); };
  preisK.onclick = async () => {
    status.textContent = t("set.frageRelay");
    try {
      preise = await leseRelayPreise(relay());
    } catch {
      preise = null;
    }
    satsK.classList.toggle("hidden", !preise?.msat);
    solK.classList.toggle("hidden", !preise?.lamports);
    status.textContent = !preise
      ? t("set.keinVerkauf")
      : t("set.preisZeile", { tage: preise.tage, preis: [preise.msat ? satsText(preise.msat) : "", preise.lamports ? solText(preise.lamports) : ""].filter(Boolean).join(t("set.oder")) }) +
        (preise.beschraenkt ? t("set.nurZahlende") : "") + (preise.umschlaegeGeschuetzt ? t("set.nurAngemeldete") : "");
    zeigeStand(false);
  };
  const kaufe = async (schiene: Schiene) => {
    if (!preise || !state.keypair) return;
    const url = relay();
    const hinweis = t(schiene === "solana" ? "set.hinweisSol" : "set.hinweisSats");
    if (!confirm(t("set.kaufFrage", { url, tage: preise.tage, hinweis }))) return;
    satsK.disabled = solK.disabled = true;
    status.textContent = t("set.holeUndZahle");
    try {
      const { zahlschienen } = await import("../zahlschienen.js");
      const r = await kaufeRelayZugang({
        relay: url, schiene, pubkey: state.keypair.pk, preise,
        zahle: (a) => zahle(zahlschienen(), a),
        merke: (z) => merkeZugang(localStorage, url, z),
      });
      status.textContent = r ? t("set.bezahltBis", { datum: new Date(r.bis * 1000).toLocaleDateString(gebietsschema()) }) : t("set.bezahltOffen");
    } catch (e) {
      status.textContent = t("set.nichtGekauft", { fehler: fehlerText(e) });
    } finally {
      satsK.disabled = solK.disabled = false;
      zeigeStand(false);
    }
  };
  satsK.onclick = () => void kaufe("lightning");
  solK.onclick = () => void kaufe("solana");
  pruefK.onclick = async () => {
    const offen = zugaenge(localStorage)[relay()]?.offen;
    if (!offen) return;
    status.textContent = t("set.frageRelay");
    try {
      const r = await pruefeBeimRelay(offen, { versuche: 1 });
      if (r) merkeZugang(localStorage, relay(), { bis: r.bis });
      status.textContent = r ? "" : t("set.nochNichtBestaetigt");
    } catch (e) {
      status.textContent = t("set.nichtGeprueft", { fehler: fehlerText(e) });
    }
    zeigeStand();
  };
  zeigeStand();
}

/**
 * Eigener Relay-Satz (5.4b2): sichtbar und änderbar. Veröffentlicht NIP-65-Liste
 * und Posteingang neu (weit), erst dann gilt er; neue Relays kommen gleich in
 * den Pool. Als Gerät nur sichtbar – der Satz gehört der Person (8.6c).
 */
function wireRelayKarte(): void {
  const feld = document.getElementById("eigene-relays") as HTMLTextAreaElement | null;
  const knopf = document.getElementById("eigene-relays-save") as HTMLButtonElement | null;
  const status = document.getElementById("eigene-relays-status");
  if (!feld || !knopf || !status) return;
  feld.value = ladeEigeneRelays(localStorage).join("\n");
  if (alsGeraet()) {
    feld.readOnly = true;
    knopf.disabled = true;
    status.textContent = t("set.geraetSatz");
    return;
  }
  if (!feld.value) status.textContent = t("set.keinSatz");
  knopf.onclick = async () => {
    const r = pruefeRelayEingabe(feld.value);
    if ("fehler" in r) { status.textContent = r.fehler; return; }
    if (!state.keypair) { status.textContent = t("set.keineIdentitaet"); return; }
    knopf.disabled = true;
    status.textContent = t("set.veroeffentliche");
    try {
      const ok = await setzeEigeneRelays({ relays: r.relays, pk: state.keypair.pk, signiere, weit: veroeffentlicheWeit, speicher: localStorage });
      if (ok) {
        await nimmInPool(r.relays);
        feld.value = r.relays.join("\n");
        status.textContent = t("set.veroeffentlicht", { n: r.relays.length });
      } else {
        status.textContent = t("set.nichtVeroeffentlichtKeiner");
      }
    } catch (e) {
      status.textContent = t("set.nichtVeroeffentlicht", { fehler: fehlerText(e) });
    } finally {
      knopf.disabled = false;
    }
  };
}

