/**
 * Tab Settings: Sicherheitsstand, Nachfolge, verschlüsselte Sicherung,
 * Schlüsselwechsel, Geräte, Mesh, Gebühren, Weitergeben und Echtheitsprüfung.
 *
 * Aus app.ts verschoben (Schritt 1.0) – wörtlich, ohne Logikänderung.
 */
import { DEFAULT_CLIENT_FEE_PERCENT, MAX_CLIENT_FEE_PERCENT } from "@freedomstack/protocol";
import { escapeHtml, pkShort } from "../../shell-logic.js";
import { zeigeDatenschutz } from "../datenschutz.js";
import { zeigeVertraute } from "../nachfolge-ui.js";
import { alsGeraet, ensurePool, mitBunker, mitRohemSchluessel, signiere, state } from "../state.js";
import { geheim, istGeheimnis, tresorEingerichtet, wireTresorKarte } from "../tresor.js";
import { $, ganzeZahl, toast } from "../ui.js";
import { ladeAbdeckung, trageAbdeckungEin } from "./earn.js";
import { LS_KONTAKTE_SICHERN, geraeteBuch, kontakteEinschalten, kontakteSichernAn, sichereKontakte } from "./kommunikation.js";
import { LS_STANDARD_SCHIENE, standardSchiene } from "../../standard-schiene.js";

// ------------------------------------------------- Nachfolge & Modelle

/** Als Geraet (8.6c) nicht: Nachfolge, Schluesselwechsel und Vollmachten gehoeren der Hauptidentitaet. */
function nurHauptidentitaet(was: string): boolean {
  if (!alsGeraet()) return true;
  toast(`${was} geht nur mit der Hauptidentität, nicht auf einem Gerät`, true);
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
      box.innerHTML = `<span class="muted">Nicht eingerichtet. Ohne Nachfolge ist dein Zugang bei Geräteverlust endgültig weg.</span>`;
      return;
    }
    const plan = parseSuccessionPlan(planEv);
    const st = evaluateSuccession(plan, [...evs, ...eigene]);
    const cls = st.status === "aktiv" ? "ok" : st.status === "freigegeben" ? "err" : "warn";
    box.innerHTML =
      `<span class="${cls}">${escapeHtml(st.message)}</span><br>` +
      `<span class="muted">${ganzeZahl(plan.threshold)} von ${ganzeZahl(plan.guardians.length)} Vertrauten, ` +
      `Frist ${ganzeZahl(plan.inactivityDays)} Tage, Wartezeit ${ganzeZahl(plan.graceDays)} Tage.</span>`;
  } catch (e) {
    box.textContent = `Nicht abrufbar: ${(e as Error).message}`;
  }
}

/** Nachfolge einrichten — mit Aufklaerung ueber die Grenze. */
export async function richteNachfolgeEin(): Promise<void> {
  if (!state.keypair || !nurHauptidentitaet("Nachfolge einrichten")) return;
  const {
    successionWarning, splitSecret, secretHashOf, buildSuccessionPlan, baueAnteilUmschlag, neueTeilung,
  } = await import("@freedomstack/protocol");
  const { decodeNpub } = await import("../../identity.js");

  const eingabe = prompt(
    "Schlüssel der Vertrauten (npub oder hex), kommagetrennt – mindestens 3 Personen, die sich NICHT kennen und FreedomStack nutzen:",
  );
  if (!eingabe) return;
  const guardians = [...new Set(eingabe.split(",").map((x) => x.trim()).map((x) => {
    try {
      return x.startsWith("npub1") ? decodeNpub(x) : x.toLowerCase();
    } catch {
      return "";
    }
  }).filter((x) => /^[0-9a-f]{64}$/.test(x) && x !== state.keypair!.pk))];
  if (guardians.length < 3) {
    toast("Mindestens drei Vertraute — bei weniger ist eine Absprache zu leicht", true);
    return;
  }
  const threshold = Math.max(2, Math.ceil(guardians.length / 2));

  if (!confirm(successionWarning({ guardians: guardians.length, threshold, graceDays: 30 }))) return;

  try {
    // Die Teile entstehen LOKAL; jeder geht versiegelt (NIP-59) an genau
    // seinen Vertrauten (8.11). Bis 8.11 gab es eine Datei mit allen Teilen –
    // wer sie hatte, hatte alles.
    const { teile, hash } = mitRohemSchluessel("Die Nachfolge", (sk) => ({
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
    toast(`Eingerichtet – ${guardians.length} Vertraute haben ihren Teil versiegelt bekommen.`);
    void zeigeSicherung();
    void zeigeGeraete();
    void zeigeNachfolge();
  } catch (e) {
    toast((e as Error).message, true);
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
    k.title = "Mit Bunker nicht möglich – das braucht den Schlüssel selbst";
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
    const { backupInfo } = await import("@freedomstack/protocol");
    box.textContent = backupInfo(groesse, at || undefined);
    box.className = at ? "mono-sm muted" : "mono-sm warn";
  } catch { /* Anzeige bleibt leer */ }
}

/** Zustand verschluesselt sichern. */
async function sichereZustand(): Promise<void> {
  if (!state.keypair) return;
  try {
    const { deriveBackupKey, buildStateBackup } =
      await import("@freedomstack/protocol");
    const key = mitRohemSchluessel("Die Sicherung", deriveBackupKey);
    const r = await buildStateBackup(state.keypair.pk, key, await sammleZustand());
    await (await ensurePool()).publish(await signiere(r.event as never));

    localStorage.setItem("freedom.backupAt", String(Math.floor(Date.now() / 1000)));
    localStorage.setItem("freedom.backupSize", String(r.sizeBytes));
    toast(r.message);
    void zeigeSicherung();
    void aktualisiereSicherheitsStand();
  } catch (e) {
    toast((e as Error).message, true);
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
      toast("Keine Sicherung gefunden", true);
      return;
    }
    const r = await restoreStateBackup(neueste, mitRohemSchluessel("Die Wiederherstellung", deriveBackupKey));
    if (!r.ok || !r.data) {
      toast(r.message, true);
      return;
    }
    // Nur, was in eine Sicherung gehoert – auch eine alte mit Schluessel stellt ihn nicht her
    const daten = filtereWiederherstellung(r.data);
    if (!confirm(`${r.message}\n\nUnterhaltungen, Räume und Namen auf diesem Gerät werden damit überschrieben. Fortfahren?`)) return;
    for (const [k, v] of Object.entries(daten)) {
      if (istGeheimnis(k)) await geheim.setItem(k, v);
      else localStorage.setItem(k, v);
    }
    toast("Wiederhergestellt — die Seite wird neu geladen");
    setTimeout(() => location.reload(), 900);
  } catch (e) {
    toast((e as Error).message, true);
  }
}

/**
 * Schluesselwechsel vorbereiten.
 *
 * Der einzige Fall, den man NUR VORHER loesen kann. Nach einem Diebstahl ist
 * nichts mehr zu machen, wenn das Mandat fehlt.
 */
async function bereiteWechselVor(): Promise<void> {
  if (!state.keypair || !nurHauptidentitaet("Den Schlüsselwechsel vorbereiten")) return;
  const { rotationWarning, buildRotationMandate, generateKeypair, toHex: th } =
    await import("@freedomstack/protocol");

  if (!confirm(rotationWarning())) return;
  try {
    const ersatz = generateKeypair();
    await (await ensurePool()).publish(
      await signiere(buildRotationMandate(state.keypair.pk, ersatz.pk)));

    // Der Ersatz darf NICHT auf diesem Geraet bleiben — wer beides hat, ist du.
    const url = URL.createObjectURL(new Blob([
      "ERSATZSCHLUESSEL — GETRENNT VON DEINEM GERAET AUFBEWAHREN\n\n" +
      `privat: ${th(ersatz.sk)}\n` +
      `oeffentlich: ${ersatz.pk}\n\n` +
      "Wer diesen Schluessel UND deinen laufenden hat, ist du.\n" +
      "Ausdrucken oder auf einen Stick, nicht in die Cloud.\n",
    ], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "freedom-ersatzschluessel.txt";
    a.click();
    URL.revokeObjectURL(url);

    localStorage.setItem("freedom.rotationPrepared", "1");
    void aktualisiereSicherheitsStand();
    toast("Vorbereitet. Bewahre den Ersatzschlüssel getrennt auf.");
  } catch (e) {
    toast((e as Error).message, true);
  }
}

/**
 * Gestohlenen Schluessel widerrufen – mit dem Ersatzschluessel aus der
 * Vorbereitung. Seit 8.6a werden die Eingaben geprueft (Hex vor fromHex) und
 * es wird nur widerrufen, wenn auf den Relays ein Mandat genau diesen Ersatz
 * nennt; sonst erkennt kein Kontakt den Widerruf an.
 */
async function widerrufeSchluessel(): Promise<void> {
  const { revocationInstructions, buildRevocation, signEvent: se, fromHex, parseRotationMandate, KIND_ROTATION_MANDATE, toHex: th } =
    await import("@freedomstack/protocol");
  if (!confirm(revocationInstructions())) return;

  let alt = prompt("Welcher Schlüssel wurde gestohlen? (öffentlicher Schlüssel, npub oder hex)", state.keypair?.pk ?? "")?.trim() ?? "";
  if (!alt) return;
  if (alt.startsWith("npub1")) {
    try {
      const { decodeNpub } = await import("../../identity.js");
      alt = decodeNpub(alt);
    } catch { alt = ""; }
  }
  alt = alt.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(alt)) { toast("Kein gültiger öffentlicher Schlüssel", true); return; }
  const ersatzHex = prompt("Privater Ersatzschlüssel aus deiner Vorbereitung (64 Zeichen hex):")?.trim().toLowerCase() ?? "";
  if (!ersatzHex) return;
  if (!/^[0-9a-f]{64}$/.test(ersatzHex)) { toast("Der Ersatzschlüssel muss 64 Zeichen hex sein", true); return; }
  const seit = prompt(
    "Seit wann vermutest du den Diebstahl? (JJJJ-MM-TT)\n" +
    "Lieber zu früh ansetzen — alles danach gilt als unglaubwürdig.",
  );
  const seitUnix = seit?.trim() ? Math.floor(new Date(seit.trim()).getTime() / 1000) : undefined;
  if (seit?.trim() && !Number.isFinite(seitUnix)) { toast("Datum nicht lesbar (JJJJ-MM-TT)", true); return; }

  const sk = fromHex(ersatzHex);
  try {
    const { schnorr } = await import("@noble/curves/secp256k1.js");
    const pk = th(schnorr.getPublicKey(sk));
    const pool = await ensurePool();
    const mandate = await pool.query({ kinds: [KIND_ROTATION_MANDATE], authors: [alt], limit: 50 });
    const passt = mandate.some((ev) => { try { return parseRotationMandate(ev).newPubkey === pk; } catch { return false; } });
    if (!passt) {
      toast("Kein Mandat nennt diesen Ersatzschlüssel – Kontakte würden den Widerruf nicht anerkennen. Nichts gesendet.", true);
      return;
    }
    await pool.publish(se(buildRevocation({
      oldPubkey: alt, newPubkey: pk, reason: "gestohlen",
      compromisedSince: seitUnix,
      note: "Schlüssel kompromittiert.",
    }), sk));

    toast("Widerrufen — melde dich mit dem Ersatzschlüssel an (Identität importieren) und sag es deinen Kontakten zusätzlich direkt");
  } catch (e) {
    toast((e as Error).message, true);
  } finally {
    sk.fill(0);
  }
}

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
      box.textContent = `Dieses Gerät spricht für ${pkShort(state.person)} · ${st.text}`;
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
      ? `<span class="muted">Nur dieses Gerät. Ein zweites einzurichten ist sicherer, als den Schlüssel zu kopieren.</span>`
      : d.map((x) => {
          const cls = x.status === "aktiv" ? "ok" : x.status === "abgelaufen" ? "warn" : "muted";
          return `<div class="usage-row"><span>${escapeHtml(x.label)}</span>` +
            `<span class="${cls}">${escapeHtml(x.status)}` +
            (x.status === "aktiv"
              ? ` · <button class="ghost dev-revoke" data-pk="${escapeHtml(x.devicePubkey)}"
                   style="width:auto;padding:1px 6px;font-size:10px">entziehen</button>`
              : "") + `</span></div>`;
        }).join("");

    box.querySelectorAll(".dev-revoke").forEach((b) => {
      b.addEventListener("click", () => void entzieheGeraet((b as HTMLElement).dataset.pk!));
    });
  } catch (e) {
    box.textContent = `Nicht abrufbar: ${(e as Error).message}`;
  }
}

async function fuegeGeraetHinzu(): Promise<void> {
  if (!state.keypair || !nurHauptidentitaet("Geräte hinzufügen")) return;
  const { defaultPermissions, deviceWarning, buildDeviceGrant, generateKeypair, toHex: th } =
    await import("@freedomstack/protocol");
  const { geraeteCode } = await import("../../geraete-modus.js");

  const name = prompt("Wie heißt das Gerät? Zum Beispiel: Handy");
  if (!name?.trim()) return;
  const umfang = prompt("Umfang: nur-chat / lesen-schreiben / vollzugriff", "lesen-schreiben");
  if (!umfang) return;

  const perms = defaultPermissions(umfang.trim() as never);
  const tage = 365;
  if (!confirm(deviceWarning(perms, tage))) return;

  try {
    const geraet = generateKeypair();
    await (await ensurePool()).publish(await signiere(buildDeviceGrant({
      ownerPubkey: state.keypair.pk, devicePubkey: geraet.pk, label: name.trim(),
      permissions: perms, expiresAt: Math.floor(Date.now() / 1000) + tage * 86400,
    })));
    geraeteBuch.vergiss(state.keypair.pk); // ab jetzt bekommt das Geraet Kopien (8.6b)

    // Geraetecode (8.6c): auf dem anderen Geraet unter „Identitaet importieren“ eingeben
    prompt(
      "Diesen Gerätecode auf dem anderen Gerät unter „Identität importieren“ eingeben.\n" +
      "Er ersetzt NICHT deine Merkphrase — das Gerät schreibt nur in deinem Namen, bis du es entziehst:",
      geraeteCode(state.keypair.pk, th(geraet.sk)),
    );
    geraet.sk.fill(0);
    void zeigeGeraete();
  } catch (e) {
    toast((e as Error).message, true);
  }
}

async function entzieheGeraet(devicePk: string): Promise<void> {
  if (!state.keypair) return;
  if (!confirm("Vollmacht entziehen?\n\nDer Entzug erreicht nur Clients, die ihn sehen – bis dahin " +
    "versiegeln sie weiter auch an dieses Gerät. Was das Gerät vorher geschrieben hat, bleibt gültig; " +
    "zurückdatierte Nachrichten zeigen Kontakte mit Warnung.")) return;
  try {
    const { buildDeviceRevoke } = await import("@freedomstack/protocol");
    await (await ensurePool()).publish(
      await signiere(buildDeviceRevoke(state.keypair.pk, devicePk, "entzogen")));
    geraeteBuch.vergiss(state.keypair.pk); // keine Kopien mehr an das Geraet (8.6b)
    toast("Entzogen");
    void zeigeGeraete();
  } catch (e) {
    toast((e as Error).message, true);
  }
}

/** Als Vertrauter fuer jemanden melden, der sich nicht meldet. */
async function meldeFuerAnderen(): Promise<void> {
  if (!state.keypair) return;
  const wen = prompt("Für wen meldest du? (öffentlicher Schlüssel)");
  if (!wen?.trim()) return;
  const grund = prompt("Warum? (wird veröffentlicht)");
  if (!grund?.trim()) return;

  try {
    const { buildRecoveryClaim } = await import("@freedomstack/protocol");
    await (await ensurePool()).publish(await signiere(buildRecoveryClaim(state.keypair.pk, wen.trim(), grund.trim())));
    toast("Gemeldet — ein Lebenszeichen der Person bricht den Vorgang ab");
  } catch (e) {
    toast((e as Error).message, true);
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
    toast("Offline-SOL-Zahlung empfangen – wird eingereicht, sobald hier Netz da ist");
    return;
  }
  try {
    const { reicheSolOfflineEin } = await import("../zahlschienen.js");
    const signatur = await reicheSolOfflineEin(roh);
    toast(`Offline-SOL-Zahlung empfangen und eingereicht: ${signatur.slice(0, 8)}…`);
  } catch (e) {
    toast(`Offline-SOL-Zahlung nicht eingereicht: ${(e as Error).message}`, true);
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    for (const roh of wartendeSol.splice(0)) void reicheSolEin(roh);
  });
}

/**
 * Ueber das verbundene Funkgeraet senden (7.2: Offline-SOL-Zahlung). false,
 * wenn keines verbunden ist – dann nimmt der Aufrufer den Datei-Weg.
 */
export async function sendeUeberFunk(payload: Uint8Array, kind: import("@freedomstack/protocol").MeshKind, label: string): Promise<boolean> {
  const art = meshNode?.transportArt;
  if (!meshNode || (art !== "seriell" && art !== "bluetooth")) return false;
  const { MeshPriority } = await import("@freedomstack/protocol");
  meshNode.enqueue(payload, kind, MeshPriority.Zahlung, label);
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
            // Ueber den Pool weiterverteilen: Eine Nachricht, die nur auf
            // diesem Geraet ankommt, hat den halben Weg umsonst gemacht.
            const pool = await ensurePool();
            await pool.publish(ev as never).catch(() => { /* offline */ });
            toast("Verschlüsselte Nachricht über Funk empfangen und ans Netz gegeben");
          } catch { toast("Empfangenes Paket unlesbar", true); }
        } else if (kind === MeshKind.SolanaTx) {
          void reicheSolEin(payload);
        }
      })();
    },
    onProgress: (info) => {
      const el = $("#mesh-status");
      if (!el) return;
      el.textContent = info.wartetSekunden
        ? `Sendezeit aufgebraucht (1 % je Stunde) – weiter in etwa ${Math.ceil(info.wartetSekunden / 60)} min, ${info.sending} Pakete offen`
        : info.sending > 0
          ? `${info.sending} Pakete offen, etwa ${info.etaSeconds}s`
          : info.receiving > 0 ? `${info.receiving} Nachricht(en) unvollstaendig` : "bereit";
    },
    onLog: (line) => console.log(`[mesh] ${line}`),
  });
  meshNode.setEigeneSchluessel(state.keypair ? [state.keypair.pk] : []);
  return meshNode;
}

export async function wireMeshTab(): Promise<void> {
  const { detectTransports } = await import("../../mesh-radio.js");
  const info = $("#mesh-transport");
  if (info) {
    const t = detectTransports();
    info.textContent = t.note;
    const btn = $("#mesh-connect") as HTMLButtonElement | null;
    if (btn && t.recommendation === "datei") {
      // Keinen Knopf anbieten, der auf diesem Geraet nichts tun kann.
      btn.disabled = true;
      btn.textContent = "kein Geraetezugriff";
    }
  }

  const connect = $("#mesh-connect");
  if (connect) connect.onclick = async () => {
    try {
      const { connectSerial } = await import("../../mesh-radio.js");
      const n = await ensureMeshNode();
      await n.attach(await connectSerial());
      $("#mesh-status").textContent = `verbunden: ${n.transportName}`;
      toast("Funkgeraet verbunden");
    } catch (e) {
      $("#mesh-status").textContent = (e as Error).message;
    }
  };

  const bt = $("#mesh-bt");
  if (bt) bt.onclick = async () => {
    try {
      const { connectBluetooth } = await import("../../mesh-radio.js");
      const n = await ensureMeshNode();
      await n.attach(await connectBluetooth((raw) => n.receive(raw)));
      $("#mesh-status").textContent = `verbunden: ${n.transportName}`;
      // Das Bluetooth-Geraet ist ein Funkgeraet – es sendet ueber LoRa (7.1).
      void zeigeOfflineFaehigkeiten("lora");
      toast("Bluetooth verbunden");
    } catch (e) {
      $("#mesh-status").textContent = (e as Error).message;
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
        if (netz.value !== "klar") toast(r.message);
      } catch { /* Reihenfolge bleibt */ }
      void zeigeDatenschutz();
    };
  }
  void zeigeDatenschutz();

  // MLS-Engine (2.2b-b): erst der Selbsttest lädt sie – vorher bleibt sie gepackt.
  const mlsKnopf = document.getElementById("mls-selbsttest") as HTMLButtonElement | null;
  if (mlsKnopf) mlsKnopf.onclick = async () => {
    const aus = document.getElementById("mls-ergebnis");
    mlsKnopf.disabled = true;
    if (aus) aus.textContent = "läuft …";
    const { mlsSelbsttest } = await import("../../mls-engine.js");
    const r = await mlsSelbsttest();
    if (aus) aus.textContent = `${r.ok ? "bestanden" : "gescheitert"}: ${r.text} (${r.ms} ms)`;
    mlsKnopf.disabled = false;
  };

  // Standard-Schiene (4.1c): Vorgabe fuer Zaps und Trinkgeld
  const schiene = document.getElementById("standard-schiene") as HTMLSelectElement | null;
  if (schiene) {
    schiene.value = standardSchiene();
    schiene.onchange = () => {
      localStorage.setItem(LS_STANDARD_SCHIENE, schiene.value === "solana" ? "solana" : "lightning");
      toast(`Standard-Schiene: ${schiene.value === "solana" ? "Solana (SOL)" : "Lightning (sats)"}`);
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
          toast(`Kontakte verschlüsselt gesichert${neu ? ` – ${neu} von anderen Geräten übernommen` : ""}.`);
        } else {
          localStorage.removeItem(LS_KONTAKTE_SICHERN);
          await sichereKontakte(true);
          toast("Abgleich aus – die Liste auf den Relays ist geleert.");
        }
      } catch (e) {
        kontakte.checked = kontakteSichernAn();
        toast(`Kontaktliste: ${(e as Error).message}`, true);
      }
    };
  }

  const exp = $("#mesh-export");
  if (exp) exp.onclick = async () => {
    const { fileTransport } = await import("../../mesh-radio.js");
    const n = await ensureMeshNode();
    let ausgegeben = false;
    const t = fileTransport((data, count) => {
      ausgegeben = true;
      const url = URL.createObjectURL(new Blob([data as BlobPart], { type: "application/octet-stream" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `freedom-${Date.now()}.meshpkt`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`${count} Pakete als Datei ausgegeben`);
    });
    await n.attach(t);
    // Kurz warten, damit die Warteschlange durchlaeuft, dann buendeln.
    setTimeout(() => void t.close().then(() => {
      if (!ausgegeben) toast("Nichts zu senden – Post für einen Kontakt nimmst du im Chat mit (⇪).");
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
      toast(`${anzahl} Pakete eingelesen`);
      impInput.value = "";
    };
  }

  const refresh = $("#coverage-refresh");
  if (refresh) refresh.onclick = () => void ladeAbdeckung();
  const join = $("#coverage-join");
  if (join) join.onclick = () => void trageAbdeckungEin();

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
  const { offlineCapabilities, LINK_LABEL } = await import("@freedomstack/protocol");
  box.innerHTML =
    `<div class="muted" style="margin-bottom:5px">Über ${escapeHtml(LINK_LABEL[link])}:</div>` +
    offlineCapabilities(link).map((f) =>
      `<div class="usage-row"><span>${f.works ? "✓" : "✕"} ${escapeHtml(f.feature)}</span>` +
      `<span class="muted" style="font-size:10px;max-width:58%">${escapeHtml(f.note)}</span></div>`,
    ).join("");
}

function zeigeWarteschlange(): void {
  const el = $("#mesh-queue");
  if (!el || !meshNode) return;
  const p = meshNode.pending;
  el.innerHTML = p.length === 0
    ? "nichts zu senden"
    : p.map((m) => `${escapeHtml(m.label)} — ${m.framesLeft} Pakete offen`).join("<br>");
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
    if (status) status.textContent = "lese die eigene Datei …";
    // Die App holt sich selbst — im Einzeldatei-Build ist das genau die Datei,
    // die der Nutzer weitergeben soll.
    const res = await fetch(location.href, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const { hashText, sharingInstructions } = await import("@freedomstack/protocol");
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
    lade(sharingInstructions(hash, version), "freedom-pruefen.txt", "text/plain");

    if (status) {
      status.innerHTML =
        `Exportiert. Prüfsumme:<br><span class="mono-sm">${escapeHtml(hash)}</span><br>` +
        `Wer die Datei von dir bekommt, kann sie damit gegen das signierte ` +
        `Manifest auf den Relays prüfen.`;
      status.className = "mono-sm ok";
    }
    toast("App exportiert — jetzt bist du eine Bezugsquelle");
  } catch (e) {
    if (status) {
      status.textContent =
        `Selbst-Export nicht möglich (${(e as Error).message}). ` +
        `Im Einzeldatei-Build funktioniert er; hinter einem Server mit ` +
        `Zugriffsschutz kann die Seite sich nicht selbst lesen.`;
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
      `<span class="${cls}">${escapeHtml(r.message)}</span>` +
      (neueste && neueste.version !== r.version
        ? `<br>Neuere Version verfügbar: ${escapeHtml(neueste.version)}.`
        : "") +
      (quellen.length > 0
        ? `<br><span class="muted">Bezugsquellen: ${quellen.map((q) => escapeHtml(q)).join(", ")}</span>`
        : "");
    // Fixieren (5.2): Danach laeuft keine andere Version ohne Rueckfrage.
    const fix = ladeFixierung();
    const zeile = document.createElement("div");
    if (fixierung.status !== "passt") zeile.textContent = fixierung.meldung;
    else if (fix) zeile.textContent = `Fixiert: Version ${fix.version}.`;
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
      knopf(`Version ${version} fixieren`, () => localStorage.setItem(LS_RELEASE_FIX, JSON.stringify({ version, sha256: hash })));
    }
    if (fix) knopf("Fixierung aufheben", () => localStorage.removeItem(LS_RELEASE_FIX));
  } catch (e) {
    box.textContent = `Echtheit nicht prüfbar: ${(e as Error).message}`;
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
    if (fixierung.status === "andere-echt" && r.version && confirm(fixierung.meldung)) {
      localStorage.setItem(LS_RELEASE_FIX, JSON.stringify({ version: r.version, sha256: hash }));
      toast(`Version ${r.version} fixiert`);
    } else if (fixierung.status !== "passt") {
      toast(fixierung.meldung, true);
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

/** Einstellung der App-Gebuehr: anzeigen, aendern, abschalten. */
export async function wireClientFeeSetting(): Promise<void> {
  const input = $("#clientfee-percent") as HTMLInputElement | null;
  const save = $("#clientfee-save");
  const status = $("#clientfee-status");
  if (!input || !save || !status) return;

  const gespeichert = localStorage.getItem("freedom.clientfee.percent");
  input.value = String(gespeichert !== null ? Number(gespeichert) : DEFAULT_CLIENT_FEE_PERCENT);

  const zeige = (): void => {
    const p = Number(input.value);
    const gesamt = 2.5 + Math.max(0, Math.min(p, MAX_CLIENT_FEE_PERCENT));
    status.textContent =
      p <= 0
        ? `App-Gebühr aus. Gesamt 2,5 % — nur das Protokoll.`
        : `Gesamt ${gesamt.toFixed(1)} %: 2,0 % Pool, 0,5 % Werber, ${p.toFixed(1)} % App.`;
  };
  zeige();
  input.addEventListener("input", zeige);

  save.onclick = () => {
    const p = Math.max(0, Math.min(Number(input.value) || 0, MAX_CLIENT_FEE_PERCENT));
    localStorage.setItem("freedom.clientfee.percent", String(p));
    input.value = String(p);
    zeige();
    toast(p <= 0 ? "App-Gebühr abgeschaltet" : `App-Gebühr auf ${p} % gesetzt`);
  };
}
