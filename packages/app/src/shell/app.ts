/**
 * freedom App-Shell: Einstiegspunkt der PWA.
 *
 * Laueft komplett im Browser: Identitaet (nsec), Nostr ueber WebSocket-Relays,
 * DVM-Marktplatz, Swap-Orderbook, Chat. Kein Server, keine Custody —
 * die App ist ein dummer Client des Protokolls.
 *
 * Wird per esbuild zu einer einzigen dist/freedom.html gebuendelt.
 */
import {
  DEFAULT_CLIENT_FEE_PERCENT,
  KIND_LP_OFFER,
  KIND_PERFORMANCE,
  MAX_CLIENT_FEE_PERCENT,
  NostrEvent,
  buildEvent,
  fromHex,
  generatePreimage,
  hashlock,
  parseLpOffer,
  signEvent,
  toHex,
} from "@freedomstack/protocol";
import { schnorr } from "@noble/curves/secp256k1.js";
import { startHero } from "../hero.js";
import { LANGS, Lang, detectLang, getLang, setLang, t } from "../i18n.js";
import { icon } from "../icons.js";
import { discoverProviders } from "../matchmaking.js";
import { escapeHtml, pkShort } from "../shell-logic.js";
import {
  KIND_SWAP_REQUEST,
  KIND_SWAP_RESPONSE,
  LS_KEY,
  ensurePool,
  getOwnProviderFromUrl,
  setOwnProvider,
  solRpcUrl,
  state,
  wireRpcSetting,
} from "./state.js";
import { haltevorModell, kuendigeModellAn, loadGitRepos, setGitStatus, zeigeModelle } from "./tabs/agent-netz.js";
import {
  askAi,
  neueAufgabe,
  refreshModelDropdown,
  setupAttach,
  setupEmptyState,
  setupModelPicker,
  setupToolChips,
  updateBudgetBar,
  updateFeePreview,
  updateTokenEstimate,
  zeigeVerlaeufe,
} from "./tabs/agent.js";
import {
  activeConversation,
  conversations,
  handleChatFiles,
  loadChatList,
  loadChatMessages,
  newCommunity,
  newDm,
  sendChatMessage,
  wireKommunikation,
  wireSpacesTab,
  zeigeRaumLeiste,
} from "./tabs/kommunikation.js";
import {
  $,
  aktualisiereNavStatus,
  escrowIdent,
  ganzeZahl,
  refreshQuota,
  setzeLogo,
  timeAgo,
  toast,
  updateSidebarBalances,
} from "./ui.js";
export { activateCodeBlocks } from "./ui.js";

// ------------------------------------------------------------- Identitaet

function loadOrCreateIdentity(): void {
  const stored = localStorage.getItem(LS_KEY);
  if (stored) {
    const sk = fromHex(stored);
    state.keypair = { sk, pk: toHex(schnorr.getPublicKey(sk)) };
  } else {
    // Neue Identitaeten bekommen eine Merkphrase. Frueher wurde hier still ein
    // Schluessel erzeugt — wer seine Browserdaten loeschte, verlor Identitaet,
    // Reputation und gesperrte Betraege ohne jede Vorwarnung.
    void erzeugeIdentitaetMitPhrase();
    return;
  }
  $("#ident").textContent = escrowIdent();
  void zeigeBackupWarnung();
}

/** Erzeugt eine Identitaet und fuehrt durch die Sicherung. */
async function erzeugeIdentitaetMitPhrase(): Promise<void> {
  const { createIdentity, markHasMnemonic } = await import("../identity.js");
  const id = createIdentity();
  state.keypair = { sk: id.sk, pk: id.pk };
  localStorage.setItem(LS_KEY, toHex(id.sk));
  markHasMnemonic();
  $("#ident").textContent = escrowIdent();
  await zeigeSicherungsDialog(id.mnemonic!);
}

/**
 * Sicherungsdialog mit Bestaetigung.
 *
 * Der Nutzer tippt drei Woerter nach. Ein Haekchen "ich habe gesichert" wuerde
 * nur belegen, dass er das Haekchen gefunden hat.
 */
async function zeigeSicherungsDialog(mnemonic: string): Promise<void> {
  const { pickChallengePositions, verifyMnemonicChallenge, markBackupConfirmed, buildBackupFile }
    = await import("../identity.js");
  const { createIdentity: _c, importIdentity: _i } = await import("../identity.js");
  void _c; void _i;

  const box = document.createElement("div");
  box.className = "modal-backdrop";
  const woerter = mnemonic.split(" ");
  const positionen = pickChallengePositions(woerter.length, 3);

  box.innerHTML = `
    <div class="modal">
      <h3>Deine Wiederherstellungs-Phrase</h3>
      <p class="mono-sm">Diese zwölf Wörter sind deine Identität. Wer sie hat, ist du.
      Wer sie verliert, verliert Reputation, Nachrichten und gesperrte Beträge —
      es gibt niemanden, der sie zurücksetzen kann.</p>
      <ol class="mnemonic-list">${woerter.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ol>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0">
        <button id="bk-copy" class="ghost" style="width:auto;padding:6px 10px">kopieren</button>
        <button id="bk-file" class="ghost" style="width:auto;padding:6px 10px">als Datei sichern</button>
      </div>
      <p class="mono-sm">Zur Bestätigung: gib diese Wörter ein.</p>
      <div id="bk-challenge" style="display:flex;gap:6px;flex-wrap:wrap">
        ${positionen.map((p) => `<label class="mono-sm">Nr. ${p + 1}
          <input data-pos="${p}" class="mono-sm" style="width:110px" autocomplete="off" /></label>`).join("")}
      </div>
      <div id="bk-error" class="mono-sm err"></div>
      <button id="bk-done" class="send-btn" style="margin-top:8px">bestätigen</button>
    </div>`;
  document.body.appendChild(box);

  return new Promise<void>((resolve) => {
    box.querySelector("#bk-copy")!.addEventListener("click", () => {
      void navigator.clipboard.writeText(mnemonic).then(() => toast("Phrase kopiert"));
    });
    box.querySelector("#bk-file")!.addEventListener("click", async () => {
      const { createIdentity } = await import("../identity.js");
      void createIdentity;
      const { identityFromMnemonic } = await import("../identity.js");
      const blob = new Blob([buildBackupFile(identityFromMnemonic(mnemonic))], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "freedomstack-identity.json";
      a.click();
      URL.revokeObjectURL(url);
    });
    box.querySelector("#bk-done")!.addEventListener("click", () => {
      const inputs = [...box.querySelectorAll("#bk-challenge input")] as HTMLInputElement[];
      const antworten = inputs.map((i) => i.value);
      const r = verifyMnemonicChallenge(mnemonic, positionen, antworten);
      if (!r.ok) {
        // Sagen, WELCHES Wort falsch war — sonst raet der Nutzer.
        box.querySelector("#bk-error")!.textContent =
          `Falsch: Wort ${r.wrong.map((p) => p + 1).join(", ")}. Nochmal vergleichen.`;
        return;
      }
      markBackupConfirmed();
      box.remove();
      toast("Identität gesichert");
      resolve();
    });
  });
}

/** Erinnert dezent, solange die Sicherung fehlt. */
async function zeigeBackupWarnung(): Promise<void> {
  try {
    const { backupStatus } = await import("../identity.js");
    const st = backupStatus();
    const el = $("#backup-warn");
    if (!el) return;
    if (st.warning) {
      el.innerHTML = `⚠ ${escapeHtml(st.warning)} <button id="bk-now" class="ghost" style="width:auto;padding:4px 8px">jetzt sichern</button>`;
      el.classList.remove("hidden");
      el.querySelector("#bk-now")?.addEventListener("click", () => void sichereJetzt());
    } else {
      el.classList.add("hidden");
    }
  } catch { /* Anzeige ist optional */ }
}

/** Nachtraegliche Sicherung — auch fuer Identitaeten ohne Phrase. */
async function sichereJetzt(): Promise<void> {
  if (!state.keypair) return;
  const { identityFromHex, buildBackupFile, markBackupConfirmed } = await import("../identity.js");
  const id = identityFromHex(toHex(state.keypair.sk));
  const blob = new Blob([buildBackupFile(id)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "freedomstack-identity.json";
  a.click();
  URL.revokeObjectURL(url);
  markBackupConfirmed();
  void zeigeBackupWarnung();
  toast("Sicherungsdatei heruntergeladen — sicher aufbewahren");
}

function exportIdentity(): void {
  if (!state.keypair) return;
  const hex = toHex(state.keypair.sk);
  navigator.clipboard?.writeText(hex).then(
    () => toast("nsec (hex) kopiert — sicher aufbewahren!"),
    () => toast(hex),
  );
}

function importIdentity(): void {
  const hex = prompt("Merkphrase, nsec1… oder 64 Zeichen Hex einfuegen:");
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    if (hex !== null) toast("ungueltiger key", true);
    return;
  }
  const sk = fromHex(hex);
  state.keypair = { sk, pk: toHex(schnorr.getPublicKey(sk)) };
  localStorage.setItem(LS_KEY, hex.toLowerCase());
  $("#ident").textContent = escrowIdent();
  toast("Identitaet importiert");
  updateFeePreview();
  loadChatList();
  loadWallet();
  loadEarnings();
}

// ------------------------------------------------- Nachfolge & Modelle

/** Stand der Nachfolge anzeigen. */
export async function zeigeNachfolge(): Promise<void> {
  const box = $("#succession-status");
  if (!box || !state.keypair) return;
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
  if (!state.keypair) return;
  const {
    successionWarning, splitSecret, secretHashOf, buildSuccessionPlan, signEvent: se, toHex: th,
  } = await import("@freedomstack/protocol");

  const eingabe = prompt(
    "Pubkeys der Vertrauten, kommagetrennt (mindestens 3 Personen, die sich NICHT kennen):",
  );
  if (!eingabe) return;
  const guardians = eingabe.split(",").map((x) => x.trim()).filter((x) => /^[0-9a-f]{64}$/.test(x));
  if (guardians.length < 3) {
    toast("Mindestens drei Vertraute — bei weniger ist eine Absprache zu leicht", true);
    return;
  }
  const threshold = Math.max(2, Math.ceil(guardians.length / 2));

  if (!confirm(successionWarning({ guardians: guardians.length, threshold, graceDays: 30 }))) return;

  try {
    // Die Teile werden LOKAL erzeugt und muessen von Hand uebergeben werden.
    // Sie ueber das Netz zu schicken waere bequemer und wuerde den ganzen
    // Zweck aufheben: Wer die Uebertragung mitliest, hat sie alle.
    const teile = splitSecret(state.keypair.sk, guardians.length, threshold);
    const pool = await ensurePool();
    await pool.publish(se(buildSuccessionPlan({
      ownerPubkey: state.keypair.pk,
      guardians,
      threshold,
      inactivityDays: 180,
      graceDays: 30,
      secretHash: secretHashOf(state.keypair.sk),
    }), state.keypair.sk));

    const text = teile.map((t, i) =>
      `Teil ${t.index} — fuer ${guardians[i]}\n${th(t.data)}\n`,
    ).join("\n");
    const url = URL.createObjectURL(new Blob([
      "WICHTIG: Jeden Teil EINZELN und ueber einen SICHEREN Kanal uebergeben.\n" +
      "Wer mehrere Teile in einer Hand hat, braucht die anderen nicht mehr.\n" +
      `Schwelle: ${threshold} von ${guardians.length}.\n\n` + text,
    ], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "freedom-nachfolge-teile.txt";
    a.click();
    URL.revokeObjectURL(url);

    localStorage.setItem("freedom.successionSet", "1");
    void aktualisiereSicherheitsStand();
    toast("Eingerichtet. Übergib die Teile einzeln.");
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

  void zeigeSicherung();
  void zeigeGeraete();
  void zeigeNachfolge();
  } catch (e) {
    toast((e as Error).message, true);
  }
}

/**
 * Ein Abzeichen definieren und verleihen.
 *
 * Bewusst in einem Schritt: Eine Definition ohne Verleihung ist nutzlos, und
 * zwei getrennte Dialoge waeren zwei Gelegenheiten zum Abbrechen.
 */
export async function vergebeAbzeichen(): Promise<void> {
  if (!state.keypair) return;
  const name = prompt("Name des Abzeichens:");
  if (!name?.trim()) return;
  const empfaenger = prompt("An wen? (Pubkeys, kommagetrennt)");
  if (!empfaenger?.trim()) return;

  const pks = empfaenger.split(",").map((x) => x.trim()).filter((x) => /^[0-9a-f]{64}$/.test(x));
  if (pks.length === 0) {
    toast("Keine gültige Pubkey dabei", true);
    return;
  }

  try {
    const { buildBadgeDefinition, buildBadgeAward, signEvent: se } =
      await import("@freedomstack/protocol");
    const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24);
    const pool = await ensurePool();

    await pool.publish(se(buildBadgeDefinition({
      id, name: name.trim(),
      description: prompt("Wofür? (erscheint bei jedem Träger)") ?? "",
      issuerPubkey: state.keypair.pk,
    }), state.keypair.sk));
    await pool.publish(se(buildBadgeAward(id, state.keypair.pk, pks), state.keypair.sk));

    // Die ehrliche Einordnung gehoert dazu, sonst ueberschaetzt der Vergeber
    // die Wirkung.
    toast(`An ${pks.length} vergeben — wert so viel wie dein Ruf`);
    void zeigeAbzeichen();
  } catch (e) {
    toast((e as Error).message, true);
  }
}

/** Mitwirkende am Projekt anzeigen. */
export async function zeigeMitwirkende(): Promise<void> {
  const box = $("#contrib-list");
  if (!box) return;
  try {
    const { buildRepoOverview, busFactor, KIND_GIT_CONTRIBUTION } = await import("@freedomstack/protocol");
    const pool = await ensurePool();
    const evs = await pool.query({ kinds: [KIND_GIT_CONTRIBUTION], limit: 1000 });
    const repo = (window as unknown as { FREEDOM_REPO_ID?: string }).FREEDOM_REPO_ID ?? "freedomstack";
    const o = buildRepoOverview(repo, evs);
    const bf = busFactor(o.contributors);

    box.innerHTML = o.contributors.length === 0
      ? `<span class="muted">${escapeHtml(o.healthNote)}</span>`
      : `<div class="mono-sm">${escapeHtml(o.healthNote)}</div>` +
        `<div class="mono-sm muted" style="margin-bottom:6px">${escapeHtml(bf.note)}</div>` +
        o.contributors.slice(0, 15).map((c) =>
          `<div class="usage-row"><span>${escapeHtml(pkShort(c.pubkey))}</span>` +
          `<span>${c.activeDays} aktive Tage · ${c.contributions} Beiträge</span></div>`,
        ).join("");
  } catch (e) {
    box.textContent = `Nicht abrufbar: ${(e as Error).message}`;
  }
}

// ------------------------------------------------------------- Profil

/** Vorschau aufbauen. Das Aussehen kommt aus einer festen Auswahl. */
async function zeigeProfilVorschau(): Promise<void> {
  const box = $("#profile-preview");
  if (!box || !state.keypair) return;
  const { ACCENT_HEX, normalizeStyle } = await import("@freedomstack/protocol");

  const gespeichert = ladeProfilEntwurf();
  const stil = normalizeStyle(gespeichert.freedom_style);
  const farbe = ACCENT_HEX[stil.accent];

  const bild = gespeichert.picture;
  const avatar = bild && /^https:\/\/|^data:image\/|^freedom-blob:/.test(bild)
    ? `<img class="profile-avatar" src="${escapeHtml(bild)}" alt="" style="color:${farbe}" />`
    : `<div class="profile-avatar-fallback" style="color:${farbe}">${escapeHtml((gespeichert.name ?? "?").slice(0, 1).toUpperCase())}</div>`;

  box.innerHTML = `<div class="profile-head layout-${escapeHtml(stil.layout)}" style="color:${farbe}">
      <div class="pf-bg pattern-${escapeHtml(stil.pattern)}"></div>
      ${avatar}
      <div class="profile-text">
        <h3 style="color:#E8E8E8">${escapeHtml(gespeichert.name || pkShort(state.keypair.pk))}</h3>
        <p>${escapeHtml(gespeichert.about || "Noch keine Beschreibung.")}</p>
        ${gespeichert.lud16 ? `<p style="color:${farbe}">⚡ ${escapeHtml(gespeichert.lud16)}</p>` : ""}
      </div>
    </div>`;
}

interface ProfilEntwurf {
  name?: string; about?: string; picture?: string; lud16?: string;
  freedom_style?: { accent: string; layout: string; pattern: string };
}

function ladeProfilEntwurf(): ProfilEntwurf {
  try {
    return JSON.parse(localStorage.getItem("freedom.profile") ?? "{}") as ProfilEntwurf;
  } catch {
    return {};
  }
}

/** Formular verdrahten. */
async function wireProfil(): Promise<void> {
  const { ACCENTS, LAYOUTS, PATTERNS, normalizeStyle, profileDisclosure, inspectAbout } =
    await import("@freedomstack/protocol");

  const fuelle = (id: string, werte: readonly string[], aktiv: string): void => {
    const el = $(id) as HTMLSelectElement | null;
    if (!el) return;
    el.innerHTML = werte.map((w) =>
      `<option value="${escapeHtml(w)}"${w === aktiv ? " selected" : ""}>${escapeHtml(w)}</option>`).join("");
  };

  const e = ladeProfilEntwurf();
  const stil = normalizeStyle(e.freedom_style);
  fuelle("#pf-accent", ACCENTS, stil.accent);
  fuelle("#pf-layout", LAYOUTS, stil.layout);
  fuelle("#pf-pattern", PATTERNS, stil.pattern);

  const felder: Record<string, string | undefined> = {
    "#pf-name": e.name, "#pf-about": e.about, "#pf-picture": e.picture, "#pf-lud16": e.lud16,
  };
  for (const [id, wert] of Object.entries(felder)) {
    const el = $(id) as HTMLInputElement | null;
    if (el) el.value = wert ?? "";
  }

  const sammeln = (): ProfilEntwurf => ({
    name: ($("#pf-name") as HTMLInputElement)?.value.trim() || undefined,
    about: inspectAbout(($("#pf-about") as HTMLTextAreaElement)?.value).clean || undefined,
    picture: ($("#pf-picture") as HTMLInputElement)?.value.trim() || undefined,
    lud16: ($("#pf-lud16") as HTMLInputElement)?.value.trim() || undefined,
    freedom_style: {
      accent: ($("#pf-accent") as HTMLSelectElement)?.value ?? "messing",
      layout: ($("#pf-layout") as HTMLSelectElement)?.value ?? "schlicht",
      pattern: ($("#pf-pattern") as HTMLSelectElement)?.value ?? "keines",
    },
  });

  /**
   * Offenlegung LIVE mitschreiben.
   *
   * Der Nutzer soll sehen, was er preisgibt, waehrend er tippt — nicht
   * nachdem er gespeichert hat.
   */
  const zeigeOffenlegung = (): void => {
    const box = $("#pf-disclosure");
    if (!box) return;
    const zeilen = profileDisclosure(sammeln() as never);
    box.innerHTML = zeilen.map((z) => `<div>${escapeHtml(z)}</div>`).join("");
    box.className = zeilen.some((z) => /IP-Adresse/.test(z)) ? "mono-sm warn" : "mono-sm muted";
  };

  for (const id of ["#pf-name", "#pf-about", "#pf-picture", "#pf-lud16",
                    "#pf-accent", "#pf-layout", "#pf-pattern"]) {
    $(id)?.addEventListener("input", () => {
      localStorage.setItem("freedom.profile", JSON.stringify(sammeln()));
      zeigeOffenlegung();
      void zeigeProfilVorschau();
    });
  }
  zeigeOffenlegung();

  const save = $("#pf-save");
  if (save) save.onclick = async () => {
    if (!state.keypair) return;
    try {
      const { buildProfile, signEvent: se, inspectPicture } = await import("@freedomstack/protocol");
      const entwurf = sammeln();
      const bild = inspectPicture(entwurf.picture);
      if (!bild.ok) {
        toast(bild.warning ?? "Bildadresse nicht verwendbar", true);
        return;
      }
      localStorage.setItem("freedom.profile", JSON.stringify(entwurf));
      await (await ensurePool()).publish(se(buildProfile(state.keypair.pk, entwurf as never), state.keypair.sk));
      toast("Profil gespeichert");
      void zeigeProfilVorschau();
    } catch (err) {
      toast((err as Error).message, true);
    }
  };

  void zeigeProfilVorschau();
  void zeigeAbzeichen();
}

/** Abzeichen mit ihrer Herkunft. */
async function zeigeAbzeichen(): Promise<void> {
  const box = $("#badge-list");
  if (!box || !state.keypair) return;
  try {
    const {
      collectBadges, badgeSourceLabel, KIND_BADGE_DEFINITION, KIND_BADGE_AWARD,
      evaluateQuests, KIND_PERFORMANCE, KIND_FEE_PROOF,
    } = await import("@freedomstack/protocol");
    const pool = await ensurePool();
    const [abz, arbeit, gebuehren] = await Promise.all([
      pool.query({ kinds: [KIND_BADGE_DEFINITION, KIND_BADGE_AWARD], limit: 500 }),
      pool.query({ kinds: [KIND_PERFORMANCE], authors: [state.keypair.pk], limit: 500 }),
      pool.query({ kinds: [KIND_FEE_PROOF], limit: 500 }),
    ]);

    // Verdiente Abzeichen kommen aus dem Aufgabensystem — nachrechenbar.
    const erledigt = evaluateQuests({
      pubkey: state.keypair.pk, performances: arbeit, feeProofs: gebuehren,
    }).filter((q) => q.done).map((q) => ({
      id: q.quest.id, name: q.quest.title, description: q.quest.description, basis: q.detail,
    }));

    const alle = collectBadges(state.keypair.pk, abz, erledigt);
    box.innerHTML = alle.length === 0
      ? `<span class="muted">Noch keine. Verdiente Abzeichen entstehen aus Arbeit im Netz.</span>`
      : alle.map((b) => `<div class="badge-row">
          <span class="badge-chip ${escapeHtml(b.source)}">${escapeHtml(b.source)}</span>
          <span style="min-width:0">
            <span style="font-weight:600;font-size:12px">${escapeHtml(b.definition.name)}</span><br>
            <span class="muted" style="font-size:11px">${escapeHtml(badgeSourceLabel(b))}</span>
          </span></div>`).join("");
  } catch (e) {
    box.textContent = `Nicht abrufbar: ${(e as Error).message}`;
  }
}

// -------------------------------------- Sicherung, Wechsel, Geraete

/** Alles, was lokal liegt und bei Datenverlust verschwinden wuerde. */
function sammleZustand(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    // Schluessel NICHT mitsichern: Die Sicherung liegt oeffentlich auf
    // Relays, und ihre Verschluesselung haengt an demselben Geheimnis.
    if (!k || !k.startsWith("freedom.") || /\.(sk|identity|secret)$/.test(k)) continue;
    out[k] = localStorage.getItem(k);
  }
  return out;
}

async function zeigeSicherung(): Promise<void> {
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
    const { deriveBackupKey, buildStateBackup, signEvent: se } =
      await import("@freedomstack/protocol");
    const key = deriveBackupKey(state.keypair.sk);
    const r = await buildStateBackup(state.keypair.pk, key, sammleZustand());
    await (await ensurePool()).publish(se(r.event as never, state.keypair.sk));

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
    const { deriveBackupKey, restoreStateBackup, latestBackup, KIND_STATE_BACKUP } =
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
    const r = await restoreStateBackup(neueste, deriveBackupKey(state.keypair.sk));
    if (!r.ok || !r.data) {
      toast(r.message, true);
      return;
    }
    if (!confirm(`${r.message}\n\nLokale Daten werden damit überschrieben. Fortfahren?`)) return;

    for (const [k, v] of Object.entries(r.data)) {
      if (typeof v === "string") localStorage.setItem(k, v);
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
  if (!state.keypair) return;
  const { rotationWarning, buildRotationMandate, signEvent: se, generateKeypair, toHex: th } =
    await import("@freedomstack/protocol");

  if (!confirm(rotationWarning())) return;
  try {
    const ersatz = generateKeypair();
    await (await ensurePool()).publish(
      se(buildRotationMandate(state.keypair.pk, ersatz.pk), state.keypair.sk));

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

/** Gestohlenen Schluessel widerrufen. */
async function widerrufeSchluessel(): Promise<void> {
  const { revocationInstructions, buildRevocation, signEvent: se, fromHex } =
    await import("@freedomstack/protocol");
  if (!confirm(revocationInstructions())) return;

  const alt = prompt("Welcher Schlüssel wurde gestohlen? (öffentlicher Schlüssel)");
  if (!alt?.trim()) return;
  const ersatzHex = prompt("Privater Ersatzschlüssel aus deiner Vorbereitung:");
  if (!ersatzHex?.trim()) return;
  const seit = prompt(
    "Seit wann vermutest du den Diebstahl? (JJJJ-MM-TT)\n" +
    "Lieber zu früh ansetzen — alles danach gilt als unglaubwürdig.",
  );

  try {
    const { schnorr } = await import("@noble/curves/secp256k1.js");
    const sk = fromHex(ersatzHex.trim());
    const pk = Array.from(schnorr.getPublicKey(sk))
      .map((b) => b.toString(16).padStart(2, "0")).join("");

    const seitUnix = seit ? Math.floor(new Date(seit).getTime() / 1000) : undefined;
    await (await ensurePool()).publish(se(buildRevocation({
      oldPubkey: alt.trim(), newPubkey: pk, reason: "gestohlen",
      compromisedSince: Number.isFinite(seitUnix) ? seitUnix : undefined,
      note: "Schlüssel kompromittiert.",
    }), sk));

    toast("Widerrufen — informiere deine Kontakte zusätzlich direkt");
  } catch (e) {
    toast((e as Error).message, true);
  }
}

/** Geraete anzeigen. */
async function zeigeGeraete(): Promise<void> {
  const box = $("#device-list");
  if (!box || !state.keypair) return;
  try {
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
  if (!state.keypair) return;
  const { defaultPermissions, deviceWarning, buildDeviceGrant, signEvent: se, generateKeypair, toHex: th } =
    await import("@freedomstack/protocol");

  const name = prompt("Wie heißt das Gerät? Zum Beispiel: Handy");
  if (!name?.trim()) return;
  const umfang = prompt("Umfang: nur-chat / lesen-schreiben / vollzugriff", "lesen-schreiben");
  if (!umfang) return;

  const perms = defaultPermissions(umfang.trim() as never);
  const tage = 365;
  if (!confirm(deviceWarning(perms, tage))) return;

  try {
    const geraet = generateKeypair();
    await (await ensurePool()).publish(se(buildDeviceGrant({
      ownerPubkey: state.keypair.pk, devicePubkey: geraet.pk, label: name.trim(),
      permissions: perms, expiresAt: Math.floor(Date.now() / 1000) + tage * 86400,
    }), state.keypair.sk));

    prompt(
      "Diesen Schlüssel auf dem anderen Gerät eingeben.\n" +
      "Er ersetzt NICHT deine Merkphrase — er handelt nur in deinem Namen:",
      th(geraet.sk),
    );
    void zeigeGeraete();
  } catch (e) {
    toast((e as Error).message, true);
  }
}

async function entzieheGeraet(devicePk: string): Promise<void> {
  if (!state.keypair) return;
  if (!confirm("Vollmacht entziehen?\n\nDer Entzug erreicht nur Clients, die ihn sehen. " +
    "Was das Gerät vorher geschrieben hat, bleibt gültig.")) return;
  try {
    const { buildDeviceRevoke, signEvent: se } = await import("@freedomstack/protocol");
    await (await ensurePool()).publish(
      se(buildDeviceRevoke(state.keypair.pk, devicePk, "entzogen"), state.keypair.sk));
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
    const { buildRecoveryClaim, signEvent: se } = await import("@freedomstack/protocol");
    await (await ensurePool()).publish(se(
      buildRecoveryClaim(state.keypair.pk, wen.trim(), grund.trim()), state.keypair.sk));
    toast("Gemeldet — ein Lebenszeichen der Person bricht den Vorgang ab");
  } catch (e) {
    toast((e as Error).message, true);
  }
}

// ------------------------------------------------------------- Onboarding

/**
 * Zeigt den EINEN naechsten Schritt.
 *
 * Frueher gab es gar keine Fuehrung: Ein neuer Nutzer landete in einer App mit
 * vier Tabs und musste selbst herausfinden, dass die ersten Anfragen gratis
 * sind. Der Free-Tier war eingebaut und unsichtbar.
 *
 * Die Reihenfolge ist die eigentliche Entscheidung — erst benutzen, dann
 * einrichten. Wer zuerst nach einer Wallet fragt, verliert die Leute, die noch
 * nicht wissen, ob das Ding etwas taugt.
 */
export async function zeigeOnboarding(): Promise<void> {
  const bar = $("#onboarding-bar");
  if (!bar) return;
  try {
    const { nextStep } = await import("../onboarding.js");
    const { backupStatus } = await import("../identity.js");

    const bu = backupStatus();
    const schritt = nextStep({
      hasIdentity: !!state.keypair,
      backedUp: bu.confirmed,
      hasWallet: !!nwc || !!(window as unknown as { webln?: unknown }).webln,
      hasUsedOnce: localStorage.getItem("freedom.usedOnce") === "1",
      freeTierLeft: Number(localStorage.getItem("freedom.freeLeft") ?? "10"),
    }, (localStorage.getItem("freedom.intent") as never) ?? "unbekannt");

    if (schritt.id === "fertig") {
      bar.classList.add("hidden");
      return;
    }

    bar.className = `mono-sm urgency-${schritt.urgency}`;
    bar.innerHTML =
      `<span class="ob-title">${escapeHtml(schritt.title)}</span>` +
      `<span class="ob-body">${escapeHtml(schritt.body)}</span>` +
      (schritt.action
        ? `<button id="ob-action" class="ghost" style="width:auto;padding:6px 10px">${escapeHtml(schritt.action)}</button>`
        : "") +
      (schritt.skippable
        ? `<button id="ob-skip" class="ghost" style="width:auto;padding:4px 8px;font-size:10px">später</button>`
        : "");

    bar.querySelector("#ob-action")?.addEventListener("click", () => {
      if (schritt.id === "sichern") void sichereJetzt();
      else if (schritt.id === "wallet") document.querySelector<HTMLElement>('[data-tab="wallet"]')?.click();
      else if (schritt.id === "provider-anleitung") document.querySelector<HTMLElement>('[data-tab="earn"]')?.click();
      else document.querySelector<HTMLElement>('[data-tab="ai"]')?.click();
    });
    // "Spaeter" blendet nur diesen Schritt aus, nicht die Fuehrung: Wer
    // dauerhaft wegklickt, verliert bei geloeschten Browserdaten alles.
    bar.querySelector("#ob-skip")?.addEventListener("click", () => bar.classList.add("hidden"));
  } catch { /* Fuehrung ist optional */ }
}

// ------------------------------------------------------------- Mesh-Tab

let meshNode: import("../mesh-radio.js").MeshNode | null = null;

/**
 * Mesh-Knoten aufsetzen.
 *
 * Empfangene Nachrichten werden wie ganz normale Nostr-Events behandelt — die
 * Schicht darueber unterscheidet nicht, ob etwas ueber ein Relay oder ueber
 * Funk kam. Genau das ist der Sinn: Bei einem Netzausfall aendert sich die
 * Zustellung, nicht die Anwendung.
 */
async function ensureMeshNode(): Promise<import("../mesh-radio.js").MeshNode> {
  if (meshNode) return meshNode;
  const { MeshNode, meshToEvent } = await import("../mesh-radio.js");

  meshNode = new MeshNode({
    onMessage: (payload, kind) => {
      void (async () => {
        const { MeshKind } = await import("@freedomstack/protocol");
        if (kind === MeshKind.NostrEvent) {
          try {
            const ev = meshToEvent(payload);
            // Ueber den Pool weiterverteilen, sobald wieder Netz da ist:
            // Eine Nachricht, die nur auf diesem Geraet ankommt, hat den
            // halben Weg umsonst gemacht.
            const pool = await ensurePool();
            await pool.publish(ev as never).catch(() => { /* offline */ });
            toast("Nachricht ueber Funk empfangen");
          } catch { toast("Empfangenes Paket unlesbar", true); }
        } else if (kind === MeshKind.PlainText) {
          toast(`Funk: ${new TextDecoder().decode(payload).slice(0, 80)}`);
        } else {
          toast("Zahlung ueber Funk empfangen — wird beim naechsten Netzkontakt eingereicht");
        }
      })();
    },
    onProgress: (info) => {
      const el = $("#mesh-status");
      if (!el) return;
      el.textContent = info.sending > 0
        ? `${info.sending} Pakete offen, etwa ${info.etaSeconds}s`
        : info.receiving > 0 ? `${info.receiving} Nachricht(en) unvollstaendig` : "bereit";
    },
    onLog: (line) => console.log(`[mesh] ${line}`),
  });
  return meshNode;
}

/**
 * Datenschutzbericht anzeigen.
 *
 * Liest die TATSAECHLICHEN Einstellungen aus, statt eine Musterkonfiguration
 * zu bewerten. Ein Bericht, der nicht die eigene Lage beschreibt, wird nicht
 * gelesen.
 */
async function zeigeDatenschutz(): Promise<void> {
  const box = $("#privacy-report");
  if (!box) return;
  try {
    const { privacyReport, summarizePrivacy, auditPrivacy, DEFAULT_CONFIG } =
      await import("@freedomstack/protocol");

    const netz = (($("#net-mode") as HTMLSelectElement | null)?.value ?? "klar") as
      "klar" | "tor" | "mixnet";
    const profil = JSON.parse(localStorage.getItem("freedom.profile") ?? "{}") as
      { picture?: string };

    const cfg = {
      ...DEFAULT_CONFIG,
      // Tor oder ein Mixnetz kann eine Web-App weder herstellen noch pruefen –
      // die Einstellung bevorzugt nur .onion-Relays. Bewertet wird deshalb
      // die direkte Verbindung (Schritt 6.2 im Ausbauplan).
      network: "klar",
      // Erst wahr, wenn der Sendepfad NIP-17 nutzt (Schritt 2.1). Vorher
      // meldete der Bericht einen Wegwerfschluessel, den es nicht gab.
      giftWrap: DMS_GIFT_WRAPPED,
      ownRelay: !!localStorage.getItem("freedom.ownRelay"),
      solanaInProfile: !!localStorage.getItem("freedom.solAddress"),
      usesSwaps: !!localStorage.getItem("freedom.swapHistory"),
      externalAvatar: /^https:\/\//.test(profil.picture ?? ""),
      stateBackup: !!localStorage.getItem("freedom.backupAt"),
      expiringMessages: localStorage.getItem("freedom.expiry") !== null,
    };

    const s = summarizePrivacy(auditPrivacy(cfg as never));
    // Belegte Aussagen und bekannte Luecken kommen aus privacy-facts.ts – dort
    // erzwingen Tests, dass "belegt" nur steht, was ein Leak-Test prueft.
    const { privacyFactsText } = await import("@freedomstack/protocol");
    const hinweise: string[] = [privacyFactsText()];
    if (netz !== "klar") {
      hinweise.push(
        "Tor/Mixnetz: Die Einstellung bevorzugt nur .onion-Relays. Deine IP-Adresse ist nur verborgen, " +
        "wenn du die App selbst im Tor Browser bzw. hinter einem Mixnetz öffnest – das kann die App nicht prüfen.",
      );
    }
    box.textContent = privacyReport(cfg as never) + "\n\n" + hinweise.join("\n");
    box.className = s.critical > 0 ? "mono-sm err" : s.warnings > 0 ? "mono-sm warn" : "mono-sm ok";
  } catch (e) {
    box.textContent = `Bericht nicht erstellbar: ${(e as Error).message}`;
  }
}

async function wireMeshTab(): Promise<void> {
  const { detectTransports } = await import("../mesh-radio.js");
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
      const { connectSerial } = await import("../mesh-radio.js");
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
      const { connectBluetooth } = await import("../mesh-radio.js");
      const n = await ensureMeshNode();
      await n.attach(await connectBluetooth((raw) => n.receive(raw)));
      $("#mesh-status").textContent = `verbunden: ${n.transportName}`;
      void zeigeOfflineFaehigkeiten("bluetooth");
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

  const exp = $("#mesh-export");
  if (exp) exp.onclick = async () => {
    const { fileTransport } = await import("../mesh-radio.js");
    const n = await ensureMeshNode();
    const t = fileTransport((data, count) => {
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
    setTimeout(() => void t.close(), 500);
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

/** Abdeckung anzeigen. */
async function ladeAbdeckung(): Promise<void> {
  const liste = $("#coverage-list");
  const hier = $("#coverage-here");
  try {
    const { buildCoverage, coverageAt, KIND_COVERAGE } = await import("@freedomstack/protocol");
    const pool = await ensurePool();
    const evs = await pool.query({ kinds: [KIND_COVERAGE], limit: 2000 });
    const r = buildCoverage(evs);

    if (liste) {
      const { summarizeLayers, LAYER_LABEL } = await import("@freedomstack/protocol");
      const zusammen = summarizeLayers(r.cells, r.hiddenCells);
      const symbol: Record<string, string> = { online: "🌐", lora: "📡", bluetooth: "🔵" };

      liste.innerHTML =
        // Kopfzeile je Ebene: Was gibt es ueberhaupt, bevor es um Orte geht.
        zusammen.map((z) =>
          `<div class="usage-row"><span>${symbol[z.layer]} ${escapeHtml(z.label)}</span>` +
          `<span class="${z.cells > 0 ? "ok" : "muted"}">${z.cells} Gebiet(e)</span></div>`,
        ).join("") +
        (r.cells.length === 0
          ? `<div class="muted" style="margin-top:8px">Noch keine Eintraege. Eintragen ist freiwillig — es kann trotzdem Abdeckung geben.</div>`
          : `<div style="margin-top:8px">` + r.cells.slice(0, 15).map((c) =>
              `${symbol[c.layer] ?? "•"} ${escapeHtml(c.region || "?")} · ${escapeHtml(c.label)}`,
            ).join("<br>") + `</div>`) +
        (r.hiddenCells > 0
          ? `<div class="muted" style="margin-top:6px">${r.hiddenCells} Gebiet(e) nicht angezeigt: zu wenige Knoten, um niemanden zu verorten.</div>`
          : "");
    }

    // Standort nur auf ausdruecklichen Wunsch — nicht beim Oeffnen des Tabs.
    if (hier) {
      const gemerkt = localStorage.getItem("freedom.coverage.cell");
      hier.textContent = gemerkt
        ? coverageAt(...(JSON.parse(gemerkt) as [number, number]), r.cells).message
        : "Fuer die Anzeige, ob es hier Abdeckung gibt, wird dein Standort gebraucht — nur lokal, nichts wird gesendet.";
    }
  } catch (e) {
    if (liste) liste.textContent = `Abdeckung nicht abrufbar: ${(e as Error).message}`;
  }
}

/** Sich selbst eintragen — mit Aufklaerung vorher. */
async function trageAbdeckungEin(): Promise<void> {
  if (!state.keypair) return;
  const { coverageConsentText, toCell, buildCoverageAnnouncement, signEvent: se } =
    await import("@freedomstack/protocol");

  const art = prompt("Was trägst du ein? (funk / bluetooth)", "funk");
  if (!art) return;
  const layer = art.trim().toLowerCase().startsWith("b") ? "bluetooth" : "lora";
  if (!confirm(coverageConsentText(layer))) return;

  navigator.geolocation.getCurrentPosition(async (pos) => {
    try {
      // Runden passiert LOKAL. Die genauen Koordinaten verlassen das Geraet nie.
      // Runden passiert LOKAL, und die Zellgroesse haengt an der Ebene:
      // Bluetooth reicht nur Meter, also wird GROEBER gerundet, nicht feiner.
      const { LAYER_CELL_DEGREES } = await import("@freedomstack/protocol");
      const cell = toCell(pos.coords.latitude, pos.coords.longitude, LAYER_CELL_DEGREES[layer]);
      localStorage.setItem("freedom.coverage.cell", JSON.stringify([pos.coords.latitude, pos.coords.longitude]));
      const pool = await ensurePool();
      await pool.publish(se(buildCoverageAnnouncement({
        pubkey: state.keypair!.pk, layer, cell, region: "",
      }), state.keypair!.sk));
      toast("Eingetragen — jederzeit widerrufbar");
      void ladeAbdeckung();
    } catch (e) {
      toast((e as Error).message, true);
    }
  }, () => toast("Standort nicht verfuegbar", true));
}

/**
 * Unter-Reiter fuer Waehrung, Earn, Agent und Settings.
 *
 * Eine Gruppe haelt ihre Reiter und die zugehoerigen Bereiche ueber den
 * Gruppennamen zusammen — so braucht jede Seite nur Markup, keinen eigenen Code.
 */
function wireSubtabs(): void {
  document.querySelectorAll<HTMLElement>("[data-subtab-group]").forEach((gruppe) => {
    const name = gruppe.dataset.subtabGroup!;
    gruppe.querySelectorAll<HTMLElement>("[data-subtab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        gruppe.querySelectorAll("[data-subtab]").forEach((b) => {
          b.classList.remove("active");
          b.setAttribute("aria-selected", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-selected", "true");
        document.querySelectorAll<HTMLElement>(`[data-subpane^="${name}:"]`).forEach((p) => {
          p.classList.toggle("active", p.dataset.subpane === `${name}:${btn.dataset.subtab}`);
        });
      });
    });
  });
}


/** Stand der Sicherheit: Punktzahl neben dem Settings-Eintrag, solange etwas fehlt. */
async function aktualisiereSicherheitsStand(): Promise<void> {
  const badge = document.getElementById("settings-security-badge");
  if (!badge || !state.keypair) return;
  const { backupStatus } = await import("../identity.js");
  const schritte = [
    backupStatus().confirmed,
    !!localStorage.getItem("freedom.backupAt"),
    localStorage.getItem("freedom.rotationPrepared") === "1",
    localStorage.getItem("freedom.successionSet") === "1",
  ];
  const erledigt = schritte.filter(Boolean).length;
  badge.textContent = erledigt < 4 ? `${erledigt}/4` : "";
  badge.classList.toggle("warn", erledigt < 4);

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
}


export function switchTab(name: string): void {
  document.querySelectorAll(".tab-page").forEach((p) => p.classList.remove("active"));
  document.querySelectorAll(".app-nav button").forEach((b) => b.classList.remove("active"));
  $(`#page-${name}`).classList.add("active");
  const navBtn = document.querySelector(`.app-nav button[data-tab="${name}"]`);
  if (navBtn) navBtn.classList.add("active");
  // Kommunikation vereint die alten Seiten Chat und Raeume.
  if (name === "comm") { loadChatList(); void zeigeRaumLeiste(); }
  if (name === "profile") { loadTrust(); void zeigeAbzeichen(); void zeigeProfilVorschau(); }
  if (name === "settings") { void zeigeSicherung(); void zeigeGeraete(); void zeigeDatenschutz(); void aktualisiereSicherheitsStand(); }
  if (name === "ai") { void refreshModelDropdown(); void refreshQuota(); }
  if (name === "wallet") loadWallet();
  if (name === "earn") { loadEarnings(); loadTrust(); loadLeaderboard(); refreshClaimSummary(); updateReferralLink(); }
  updateSidebarBalances();
}

/** Trust-Level (XP) des eigenen providers — wie ein spiel-level. */
async function loadTrust(): Promise<void> {
  if (!state.keypair) return;
  try {
    const pool = await ensurePool();
    const perf = await pool.query({ kinds: [KIND_PERFORMANCE], authors: [state.keypair.pk], limit: 1000 });
    const jobs = perf.length;
    // trust = jobs * 2 (einfach; das protokoll hat eine komplexere formel)
    const xp = jobs * 2;
    const tier = xp >= 50 ? "pro" : xp >= 10 ? "classic" : "free";
    const next = xp >= 50 ? 100 : xp >= 10 ? 50 : 10;
    const pct = Math.min(100, Math.round((xp / next) * 100));
    const fill = document.getElementById("trust-fill");
    if (fill) fill.style.width = `${Math.max(pct, 2)}%`; // min 2% damit Track sichtbar
    const xpEl = document.getElementById("trust-xp");
    if (xpEl) xpEl.textContent = `${xp} XP`;
    const jobsEl = document.getElementById("trust-jobs");
    if (jobsEl) jobsEl.textContent = `${jobs} jobs`;
    const tierEl = document.getElementById("trust-tier");
    if (tierEl) tierEl.textContent = tier;
    // Tier-Marker positionieren (10 XP / 50 XP Schwellen relativ zum nächsten Ziel)
    const bar = document.getElementById("trust-bar-track");
    if (bar) {
      const m10 = bar.querySelector<HTMLElement>(".trust-marker.m10");
      const m50 = bar.querySelector<HTMLElement>(".trust-marker.m50");
      // Marker stehen im HTML statisch (10/50 XP); hier nur Aktiv-Status:
      m10?.classList.toggle("reached", xp >= 10);
      m50?.classList.toggle("reached", xp >= 50);
    }
  } catch { /* offline */ }
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
async function exportiereApp(): Promise<void> {
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

/** Prueft die eigene Datei gegen die signierten Manifeste im Netz. */
async function pruefeEigeneEchtheit(): Promise<void> {
  const box = $("#selfcheck-status");
  if (!box) return;
  try {
    const {
      hashText, parseReleaseManifest, verifyArtifact, latestRelease, allSources,
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
    const cls = r.status === "echt" ? "ok" : r.status === "abweichend" ? "err" : "warn";
    const neueste = latestRelease(manifeste, TRUSTED_SIGNERS);
    const quellen = allSources(manifeste, TRUSTED_SIGNERS);

    box.innerHTML =
      `<span class="${cls}">${escapeHtml(r.message)}</span>` +
      (neueste && neueste.version !== r.version
        ? `<br>Neuere Version verfügbar: ${escapeHtml(neueste.version)}.`
        : "") +
      (quellen.length > 0
        ? `<br><span class="muted">Bezugsquellen: ${quellen.map((q) => escapeHtml(q)).join(", ")}</span>`
        : "");
  } catch (e) {
    box.textContent = `Echtheit nicht prüfbar: ${(e as Error).message}`;
    box.className = "mono-sm warn";
  }
}

/**
 * Signierschluessel, denen die App bei Release-Manifesten vertraut.
 *
 * Ohne diese Liste koennte jeder ein Manifest fuer seine eigene manipulierte
 * Datei veroeffentlichen und sie als echt ausweisen. Die Pruefung ist genau so
 * viel wert wie diese Liste — deshalb steht sie im Quelltext und nicht in
 * einer Konfiguration, die sich unterwegs aendern laesst.
 */
const TRUSTED_SIGNERS: string[] = [
  // VOR DEM RELEASE SETZEN: Pubkey des Projekt-Signierschluessels.
];

/**
 * Werden Direktnachrichten als Gift-Wrap (NIP-59/NIP-17) verschickt?
 * Seit Schritt 2.1: ja – sendChatMessage() nutzt buildPrivateDm(). Der
 * Datenschutzbericht liest diesen Wert; test/dm-verdrahtung.test.ts prueft,
 * dass er zum Sendepfad passt.
 */
const DMS_GIFT_WRAPPED = true;

/** Einstellung der App-Gebuehr: anzeigen, aendern, abschalten. */
async function wireClientFeeSetting(): Promise<void> {
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

// ------------------------------------------------------------- Wallet-Tab

async function loadWallet(): Promise<void> {
  // Geraetegerechter Hinweis statt eines dauerhaften "—": auf dem Handy gibt
  // es keine Extension, dort ist NWC der Weg.
  try {
    const { detectPaymentCapabilities } = await import("@freedomstack/protocol");
    const caps = detectPaymentCapabilities();
    const hintEl = $("#ln-hint");
    if (hintEl) hintEl.textContent = caps.note;
  } catch { /* Hinweis ist optional */ }

  if (!nwc && localStorage.getItem(NWC_KEY)) {
    // Gespeicherte Verbindung still wiederherstellen — der Nutzer soll die URI
    // nicht bei jedem Laden neu einfuegen muessen.
    void connectNwc(undefined, true);
  } else if (!nwc) {
    $("#ln-balance").innerHTML = `— <small>sats</small>`;
  }

  // Solana still wiederverbinden, wenn die Seite schon einmal erlaubt wurde.
  if (!solWallet.connected) void connectSolana(true);

  try {
    const pool = await ensurePool();
    const offers = await pool.query({ kinds: [KIND_LP_OFFER], limit: 20 });
    const now = Math.floor(Date.now() / 1000);
    const valid = offers
      .map((ev) => {
        try {
          return { ev, offer: parseLpOffer(ev) };
        } catch {
          return null;
        }
      })
      .filter((x): x is { ev: NostrEvent; offer: ReturnType<typeof parseLpOffer> } => x !== null)
      .filter(({ offer }) => offer.expiry > now);

    const box = $("#lp-offers");
    // SICHERHEIT: offerId/pubkey kommen aus FREMDEN Relay-Events. Frueher
    // wurden sie in ein inline onclick="startSwap('...')" interpoliert — ein
    // boesartiger LP konnte damit beliebiges JS im App-Kontext ausfuehren und
    // den Nostr-Secret-Key aus localStorage abziehen. Jetzt: escapte
    // data-Attribute + addEventListener, nie Code aus fremdem Text.
    box.innerHTML = valid.length
      ? valid
          .map(
            ({ ev, offer }) => `
        <div class="stat">
          <span class="k">${escapeHtml(pkShort(ev.pubkey))} · ${Number(offer.minSats)}–${Number(offer.maxSats)} sats · ${(Number(offer.feePpm) / 100).toFixed(1)}%</span>
          <span><button class="ghost lp-swap-btn" style="width:auto;padding:6px 10px" data-lp="${escapeHtml(ev.pubkey)}" data-offer="${escapeHtml(offer.offerId)}">swap</button></span>
        </div>`,
          )
          .join("")
      : "<div class='mono-sm'>keine LP-Angebote gefunden</div>";
    box.querySelectorAll(".lp-swap-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const el = btn as HTMLElement;
        void startSwap(el.dataset.lp ?? "", el.dataset.offer ?? "");
      });
    });
  } catch (e) {
    toast(`Relay-Fehler: ${(e as Error).message}`, true);
  }
}

async function startSwap(lpPubkey: string, offerId: string): Promise<void> {
  if (!state.keypair) return;
  const amountStr = prompt("Betrag in sats:");
  const amount = Number(amountStr);
  if (!amount || amount <= 0) return;
  // Adressverlauf: Die Kette ist der Abfluss, gegen den weder Tor noch
  // Verschluesselung hilft. Deshalb VOR dem Swap pruefen, nicht danach
  // berichten.
  const verlauf = JSON.parse(localStorage.getItem("freedom.swapHistory") ?? "[]") as {
    address: string; uses: number; firstUsed: number; lastUsed: number;
  }[];
  const letzter = verlauf.length > 0 ? Math.max(...verlauf.map((v) => v.lastUsed)) : undefined;

  const { swapPrivacyCheck, deriveSwapAddress, addressFingerprint } =
    await import("@freedomstack/protocol");

  const pruefung = swapPrivacyCheck({
    usage: verlauf,
    lamports: amount * 1000,
    lastSwapAt: letzter,
  });

  if (!pruefung.ok) {
    const weiter = confirm(
      `Bevor du das machst:\n\n${pruefung.findings.join("\n\n")}\n\n` +
      `Empfohlen:\n${pruefung.actions.map((a) => `  · ${a}`).join("\n")}\n\n` +
      `Trotzdem fortfahren?`,
    );
    if (!weiter) return;
  }

  // Frische Adresse vorschlagen — abgeleitet, also ohne zusaetzliche Sicherung
  // wiederherstellbar.
  const frisch = deriveSwapAddress(state.keypair.sk, verlauf.length);
  const solAddr = prompt(
    `Deine Solana-Empfangsadresse:\n\n` +
    `Vorschlag: eine frische Adresse Nummer ${verlauf.length} ` +
    `(${addressFingerprint(frisch)}…). Deine Merkphrase bringt sie zurueck.`,
  );
  if (!solAddr) return;

  // Benutzung mitschreiben, damit die naechste Pruefung etwas weiss.
  const vorhanden = verlauf.find((v) => v.address === solAddr);
  const jetzt = Math.floor(Date.now() / 1000);
  if (vorhanden) {
    vorhanden.uses++;
    vorhanden.lastUsed = jetzt;
  } else {
    verlauf.push({ address: solAddr, uses: 1, firstUsed: jetzt, lastUsed: jetzt });
  }
  localStorage.setItem("freedom.swapHistory", JSON.stringify(verlauf));

  try {
    const pool = await ensurePool();
    const preimage = generatePreimage();
    const H = hashlock(preimage);
    // Frueher sessionStorage: beim Schliessen des Tabs weg — und mit dem
    // Preimage der Zugriff auf das Geld. Jetzt dauerhaft, mit Exportmoeglichkeit.
    const { saveSwapSecret } = await import("../swap-client.js");
    saveSwapSecret({
      hashlockHex: toHex(H),
      preimageHex: toHex(preimage),
      solAddress: solAddr,
      amountSats: amount,
      createdAt: Math.floor(Date.now() / 1000),
    });

    const ev = signEvent(
      buildEvent(
        state.keypair.pk,
        KIND_SWAP_REQUEST,
        [
          ["p", lpPubkey],
          ["offer", offerId],
          ["amount_sats", String(amount)],
          ["hashlock", toHex(H)],
          ["solana_address", solAddr],
        ],
        "",
      ),
      state.keypair.sk,
    );
    await pool.publish(ev);
    toast("Swap-Request gesendet — warte auf Invoice…");
    void pollSwapResponse(ev.id, toHex(H), solAddr, amount);
  } catch (e) {
    toast(`Fehler: ${(e as Error).message}`, true);
  }
}
// Frueher global exportiert, weil ein inline onclick es brauchte. Der ist weg
// (XSS-Fix in loadWallet), also bleibt startSwap jetzt im Modul-Scope.

async function pollSwapResponse(
  requestId: string,
  hashlockHex: string,
  solAddress: string,
  amountSats: number,
): Promise<void> {
  const pool = await ensurePool();
  const statusEl = $("#swap-status");
  const deadline = Date.now() + 90_000;

  while (Date.now() < deadline) {
    const resps = await pool.query({ kinds: [KIND_SWAP_RESPONSE], "#e": [requestId] });
    if (resps.length > 0) {
      const resp = resps[0];
      const bolt11 = resp.content;
      const swapId = resp.tags.find((t) => t[0] === "swap_id")?.[1];
      const lamports = Number(resp.tags.find((t) => t[0] === "amount_lamports")?.[1] ?? "0");
      const lnExpiry = Number(resp.tags.find((t) => t[0] === "ln_expiry")?.[1] ?? "0");

      $("#swap-invoice").classList.remove("hidden");
      $("#swap-bolt11").textContent = bolt11;

      // ---------------------------------------------------------------
      // HIER stand frueher nur "Invoice erhalten — bitte zahlen". Genau das
      // ist der Moment, in dem ein Kunde ohne Pruefung Geld verliert: er
      // zahlt fuer SOL, die niemand gesperrt hat. Der Zahl-Link bleibt daher
      // gesperrt, bis die Gegenleistung auf der Kette bestaetigt ist.
      // ---------------------------------------------------------------
      const payLink = $("#swap-pay-link") as HTMLAnchorElement;
      payLink.removeAttribute("href");
      payLink.classList.add("disabled");
      statusEl.textContent = "Rechnung erhalten. Pruefe die Sperre auf der Kette — noch nicht zahlen.";
      statusEl.className = "mono-sm warn";

      if (!swapId) {
        statusEl.textContent =
          "Der LP hat keine swap_id mitgeschickt — die Gegenleistung ist nicht pruefbar. Nicht zahlen.";
        statusEl.className = "mono-sm err";
        return;
      }

      try {
        const { Connection, PublicKey } = await import("@solana/web3.js");
        const { AnchorSolanaHtlc, fromHex: fh } = await import("@freedomstack/protocol");
        const { verifyCounterpartyLock } = await import("../swap-client.js");
        const rpcUrl = await solRpcUrl();
        void PublicKey;

        const reader = AnchorSolanaHtlc.reader(new Connection(rpcUrl, "confirmed"));
        const chainLock = await reader.get(swapId);

        const verdict = verifyCounterpartyLock({
          lock: chainLock
            ? {
                amountLamports: chainLock.amountLamports,
                timelockUnix: chainLock.timelockUnix,
                recipient: chainLock.recipient,
                hashlock: chainLock.hashlock,
                claimed: chainLock.claimed,
                refunded: chainLock.refunded,
              }
            : undefined,
          expectedHashlock: fh(hashlockHex),
          expectedRecipient: solAddress,
          expectedLamports: lamports,
          lightningExpiryUnix: lnExpiry || Math.floor(Date.now() / 1000) + 7200,
        });

        if (!verdict.ok) {
          statusEl.innerHTML =
            `<strong>Nicht zahlen.</strong><br>`
            + verdict.problems.map((p) => escapeHtml(p)).join("<br>");
          statusEl.className = "mono-sm err";
          return;
        }

        // Erst jetzt freigeben.
        payLink.href = `lightning:${bolt11}`;
        payLink.classList.remove("disabled");
        // Den Initiator merken: das Programm gibt ihm beim Einloesen die
        // Mietbefreiung zurueck, deshalb muss er in der Claim-Instruktion stehen.
        activeSwap = { swapId, hashlockHex, solAddress, amountSats, initiator: chainLock!.initiator, timelockUnix: chainLock!.timelockUnix };
        $("#swap-claim").classList.remove("hidden");
        statusEl.innerHTML =
          `<strong>Geprueft.</strong> ${escapeHtml(verdict.summary)}<br>`
          + `Nach dem Bezahlen unten einloesen — sonst laeuft der Tausch zurueck.`;
        statusEl.className = "mono-sm ok";
        toast("Gegenleistung geprueft — Rechnung kann bezahlt werden");
      } catch (e) {
        statusEl.textContent =
          `Pruefung nicht moeglich (${(e as Error).message}). Im Zweifel nicht zahlen.`;
        statusEl.className = "mono-sm err";
      }
      return;
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  toast("keine LP-Antwort in 90s", true);
}

/** Laufender Swap, fuer den das Einloesen noch aussteht. */
let activeSwap: {
  swapId: string; hashlockHex: string; solAddress: string; amountSats: number;
  /** Wer den Swap angelegt hat (der LP) — bekommt die Mietbefreiung zurueck. */
  initiator: string;
  /** Frist des SOL-HTLC – Einloesen nur mit Sicherheitsabstand davor. */
  timelockUnix: number;
} | null = null;

/** Loest den SOL-HTLC ein und legt dabei das Preimage offen. */
async function claimActiveSwap(): Promise<void> {
  const statusEl = $("#swap-status");
  if (!activeSwap) return;
  const provider = solWallet.provider;
  if (!provider?.signTransaction) {
    statusEl.textContent = "Solana-Wallet verbinden, um einzuloesen.";
    statusEl.className = "mono-sm warn";
    return;
  }
  try {
    const { loadSwapSecret, claimSwap, preimageFits, forgetSwapSecret } =
      await import("../swap-client.js");
    const secret = loadSwapSecret(activeSwap.hashlockHex);
    if (!secret || !preimageFits(secret.preimageHex, activeSwap.hashlockHex)) {
      statusEl.textContent =
        "Preimage nicht gefunden oder unpassend — ohne es ist kein Einloesen moeglich.";
      statusEl.className = "mono-sm err";
      return;
    }

    const { Connection } = await import("@solana/web3.js");
    const { fromHex: fh } = await import("@freedomstack/protocol");
    const rpcUrl = await solRpcUrl();

    const r = await claimSwap({
      connection: new Connection(rpcUrl, "confirmed"),
      wallet: provider as never,
      swapId: activeSwap.swapId,
      preimage: fh(secret.preimageHex),
      initiator: activeSwap.initiator,
      timelockUnix: activeSwap.timelockUnix,
      onProgress: (step) => { statusEl.textContent = step; },
    });

    statusEl.innerHTML =
      `<strong>Eingeloest.</strong> Die SOL sind auf deiner Adresse.<br>`
      + `<span class="mono-sm">tx ${escapeHtml(r.signature.slice(0, 16))}…</span>`;
    statusEl.className = "mono-sm ok";
    forgetSwapSecret(activeSwap.hashlockHex);
    activeSwap = null;
    $("#swap-claim").classList.add("hidden");
    updateSidebarBalances();
  } catch (e) {
    statusEl.textContent = (e as Error).message;
    statusEl.className = "mono-sm err";
  }
}

/** Sicherung aller offenen Preimages herunterladen. */
async function exportSwapBackup(): Promise<void> {
  const { exportSwapSecrets } = await import("../swap-client.js");
  const blob = new Blob([exportSwapSecrets()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `freedom-swap-backup-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast("Sicherung heruntergeladen — sicher aufbewahren");
}

// ------------------------------------------------------------- Verdienen-Tab

async function loadEarnings(): Promise<void> {
  if (!state.keypair) return;
  const box = $("#earn-events");
  box.innerHTML = "<div class='mono-sm'>lade…</div>";
  try {
    const pool = await ensurePool();
    const events = await pool.query({
      kinds: [KIND_PERFORMANCE],
      authors: [state.keypair.pk],
      limit: 20,
    });
    const sorted = events.sort((a, b) => b.created_at - a.created_at);
    box.innerHTML = sorted.length
      ? sorted
          .map((ev) => {
            const get = (n: string) => ev.tags.find((t) => t[0] === n)?.[1] ?? "—";
            return `<div class="stat"><span class="k">${escapeHtml(get("work_type"))} · ${escapeHtml(get("units"))} units</span>
              <span>${Math.floor(Number(get("volume_msat")) / 1000)} sats · ${timeAgo(ev.created_at)}</span></div>`;
          })
          .join("")
      : "<div class='mono-sm'>Noch keine Einnahmen. Sie erscheinen, sobald dein Provider-Knoten Jobs erledigt.</div>";
  } catch (e) {
    box.innerHTML = `<div class='mono-sm err'>${escapeHtml((e as Error).message)}</div>`;
  }
}

/** Provider-Leaderboard: alle Performance-Events im Netz, gruppiert nach Provider. */
async function loadLeaderboard(): Promise<void> {
  const box = $("#provider-leaderboard");
  if (!box) return;
  // Skeleton-Zeilen während des Ladens
  box.innerHTML = `<div class="lb-skeleton"></div>`.repeat(4);
  // Timeout: Relay hängt → Error-State mit Retry statt endlos „lade…"
  const timeout = new Promise<null>((res) => setTimeout(() => res(null), 12_000));
  try {
    const pool = await ensurePool();
    const work = (async () => {
      const events = await pool.query({ kinds: [KIND_PERFORMANCE], limit: 500 });
      // Gruppieren: provider -> { jobs, sats }
      const stats = new Map<string, { jobs: number; msat: number }>();
      for (const ev of events) {
        const get = (n: string) => ev.tags.find((t) => t[0] === n)?.[1] ?? "0";
        const cur = stats.get(ev.pubkey) ?? { jobs: 0, msat: 0 };
        cur.jobs += 1;
        cur.msat += Number(get("volume_msat"));
        stats.set(ev.pubkey, cur);
      }
      return [...stats.entries()].sort((a, b) => b[1].jobs - a[1].jobs).slice(0, 20);
    })();
    const ranked = await Promise.race([work, timeout]);
    if (!ranked) {
      box.innerHTML = `<div class="mono-sm err">relay-timeout — leaderboard nicht erreichbar</div>
        <button class="ghost lb-retry" style="width:auto;margin-top:6px">↻ erneut versuchen</button>`;
      box.querySelector(".lb-retry")?.addEventListener("click", () => loadLeaderboard());
      return;
    }
    // dienste-uebersicht: modelle + tools der provider aus deren caps
    const capsByPk = new Map<string, { models: string[]; tools: string[] }>();
    try {
      const providers = await discoverProviders(pool);
      for (const p of providers) {
        capsByPk.set(p.caps.pubkey, { models: p.caps.models ?? [], tools: (p.caps.tools ?? []).map((t: { name?: string } | string) => typeof t === "string" ? t : t.name ?? "") });
      }
    } catch { /* caps optional */ }
    if (ranked.length === 0) {
      box.innerHTML = `<div class="lb-empty">
          <div class="lb-empty-icon">${icon("monitor", 28)}</div>
          <div class="lb-empty-title">noch keine provider aktiv</div>
          <div class="mono-sm">starte einen freedomstack-node — er erscheint hier automatisch</div>
        </div>`;
      return;
    }
    // Tabelle: Rang | Provider | Jobs | Verdient | Tier
    const rows = ranked.map(([pk, s], i) => {
      const xp = s.jobs * 2;
      const tier = xp >= 50 ? "pro" : xp >= 10 ? "classic" : "free";
      return `<tr>
        <td class="lb-rank">${i + 1}</td>
        <td class="lb-pk">${escapeHtml(pkShort(pk))}</td>
        <td>${s.jobs}</td>
        <td>${Math.floor(s.msat / 1000)}</td>
        <td><span class="tier-badge tier-${tier}">${tier}</span></td>
      </tr>`;
    }).join("");
    box.innerHTML = `<table class="lb-table">
        <thead><tr><th>#</th><th>provider</th><th>jobs</th><th>sats</th><th>tier</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (e) {
    box.innerHTML = `<div class='mono-sm err'>${escapeHtml((e as Error).message)}</div>
      <button class="ghost lb-retry" style="width:auto;margin-top:6px">↻ erneut versuchen</button>`;
    box.querySelector(".lb-retry")?.addEventListener("click", () => loadLeaderboard());
  }
}

/** Reward-Claim: eigene Season-Summen aus Performance-Events, Claim (38013) publizieren. */
async function submitRewardClaim(): Promise<void> {
  if (!state.keypair) return;
  const chainSel = $("#claim-chain") as HTMLSelectElement;
  const addrInput = $("#claim-address") as HTMLInputElement;
  const btn = $("#claim-submit") as HTMLButtonElement;
  try {
    btn.disabled = true;
    const pool = await ensurePool();
    const events = await pool.query({ kinds: [KIND_PERFORMANCE], authors: [state.keypair.pk], limit: 1000 });
    const seasonId = "season-" + new Date().getFullYear();
    // nur events der aktuellen season zaehlen (heuristic: letzte 90 tage)
    const cutoff = Math.floor(Date.now() / 1000) - 90 * 24 * 3600;
    const mine = events.filter((ev) => ev.created_at >= cutoff);
    const volumeMsat = mine.reduce((sum, ev) => {
      const v = ev.tags.find((t) => t[0] === "volume_msat")?.[1] ?? "0";
      return sum + Number(v);
    }, 0);
    if (mine.length === 0) {
      toast("keine performance-events — erst jobs arbeiten", true);
      return;
    }
    const payoutAddress = addrInput.value.trim() || undefined;
    const { buildRewardClaim } = await import("@freedomstack/protocol");
    const claim = buildRewardClaim(
      {
        seasonId,
        jobCount: mine.length,
        volumeMsat,
        chain: chainSel.value as "lightning" | "solana",
        payoutAddress: payoutAddress ?? "",
      },
      state.keypair.pk,
    );
    await pool.publish(signEvent(claim, state.keypair.sk));
    toast(`claim eingereicht: ${mine.length} jobs · ${Math.floor(volumeMsat / 1000)} sats`);
  } catch (e) {
    toast(`claim-fehler: ${(e as Error).message}`, true);
  } finally {
    btn.disabled = false;
  }
}

/** Claim-Zusammenfassung im Earn-Tab aktualisieren. */
async function refreshClaimSummary(): Promise<void> {
  const el = $("#claim-summary");
  if (!el || !state.keypair) return;
  try {
    const pool = await ensurePool();
    const events = await pool.query({ kinds: [KIND_PERFORMANCE], authors: [state.keypair.pk], limit: 1000 });
    const cutoff = Math.floor(Date.now() / 1000) - 90 * 24 * 3600;
    const mine = events.filter((ev) => ev.created_at >= cutoff);
    const volumeMsat = mine.reduce((s, ev) => s + Number(ev.tags.find((t) => t[0] === "volume_msat")?.[1] ?? "0"), 0);
    el.textContent = `Letzte 90 Tage: ${mine.length} Jobs, ${Math.floor(volumeMsat / 1000)} Sats`;
  } catch {
    el.textContent = "—";
  }
}

// ------------------------------------------------------------- Solana-Tab

/** Solana-Wallet-State (MWA / Phantom / Solflare Detection). */
interface SolanaWalletState {
  connected: boolean;
  pubkey: string | null;
  /** Sign-Funktion des Wallets (MWA oder Browser-Extension). */
  signTransaction?: (tx: unknown) => Promise<unknown>;
  /** Der Provider selbst — noetig, um Transaktionen signieren zu lassen. */
  provider?: { publicKey: { toBase58(): string }; signTransaction?: (tx: unknown) => Promise<unknown> };
}
const solWallet: SolanaWalletState = { connected: false, pubkey: null };

async function connectSolana(silent = false): Promise<void> {
  const statusEl = $("#sol-status");
  const { connectSolanaWallet, fetchSolBalance, detectSolanaEnvironment } =
    await import("../solana-connect.js");
  try {
    // Frueher wurde hier nur window.solana geprueft. Auf jedem Handy ohne
    // Wallet-In-App-Browser war damit Schluss ("kein Wallet gefunden") — auch
    // auf dem Seeker. Jetzt: injizierter Provider, sonst Deeplink in die App.
    const conn = await connectSolanaWallet({
      silent,
      onNeedsDeeplink: (links, hint) => {
        statusEl.className = "mono-sm";
        statusEl.innerHTML =
          `${escapeHtml(hint)}<div style="display:flex;gap:6px;margin-top:6px">` +
          `<a class="ghost" style="width:auto;padding:6px 10px" href="${escapeHtml(links.phantom)}">Phantom öffnen</a>` +
          `<a class="ghost" style="width:auto;padding:6px 10px" href="${escapeHtml(links.solflare)}">Solflare öffnen</a></div>`;
      },
    });

    if (!conn) {
      if (!silent && !statusEl.textContent) {
        statusEl.textContent = detectSolanaEnvironment().hint;
        statusEl.className = "mono-sm warn";
      }
      return;
    }

    solWallet.connected = true;
    solWallet.pubkey = conn.pubkey;
    solWallet.signTransaction = conn.provider?.signTransaction?.bind(conn.provider);
    solWallet.provider = conn.provider as SolanaWalletState["provider"];

    statusEl.textContent = "verbunden";
    statusEl.className = "mono-sm ok";
    const addrEl = $("#sol-addr");
    addrEl.textContent = conn.pubkey;
    (addrEl as HTMLInputElement).value = conn.pubkey;
    addrEl.classList.remove("hidden");
    const btn = $("#sol-connect") as HTMLButtonElement;
    btn.textContent = "Verbunden";
    btn.disabled = true;

    try {
      const rpcUrl = await solRpcUrl();
      const bal = await fetchSolBalance(conn.pubkey, rpcUrl);
      localStorage.setItem("freedom.sol.balance", bal.sol.toFixed(4));
      localStorage.setItem("freedom.sol.pubkey", conn.pubkey);
    } catch { /* RPC nicht erreichbar — Sidebar bleibt bei "—" */ }
    updateSidebarBalances();
  } catch (e) {
    if (silent) return;
    statusEl.textContent = (e as Error).message;
    statusEl.className = "mono-sm err";
  }
}

// ------------------------------------------------------- Lightning via NWC

/** Aktive NWC-Verbindung (Lightning auf jedem Geraet). */
let nwc: import("@freedomstack/protocol").NwcClient | null = null;
const NWC_KEY = "freedom.nwc.uri";

async function connectNwc(uri?: string, silent = false): Promise<void> {
  const statusEl = $("#nwc-status");
  const input = $("#nwc-uri") as HTMLInputElement | null;
  const raw = (uri ?? input?.value ?? "").trim() || localStorage.getItem(NWC_KEY) || "";
  if (!raw) {
    if (!silent) {
      statusEl.textContent = "Verbindungs-URI aus der Wallet einfuegen (Alby Hub, Coinos, Mutiny …).";
      statusEl.className = "mono-sm warn";
    }
    return;
  }

  try {
    const { parseNwcUri, NwcClient, redactNwcUri, WebSocketRelay, OutboxPool } =
      await import("@freedomstack/protocol");
    const conn = parseNwcUri(raw);

    // Eigener Pool auf den Relays DER WALLET — die muessen nicht dieselben
    // sein wie die des Protokolls, sonst findet das Wallet uns nicht.
    const walletPool = new OutboxPool(
      conn.relays.map((u) => new WebSocketRelay(u)),
      { minAcks: 1 },
    );
    const client = new NwcClient(conn, walletPool, 30_000);

    statusEl.textContent = "verbinde …";
    statusEl.className = "mono-sm";
    const info = await client.init();
    const balance = await client.getBalance();

    nwc = client;
    // Das Secret liegt lokal wie der Nostr-Key auch. Es ist eine im Wallet
    // widerrufbare, budgetierbare Vollmacht — kein Kontozugang.
    localStorage.setItem(NWC_KEY, raw);
    if (input) input.value = redactNwcUri(raw);

    $("#ln-balance").innerHTML = `${Math.floor(balance / 1000).toLocaleString()} <small>sats</small>`;
    statusEl.textContent = `verbunden (${info.encryption}, ${info.methods.length || "?"} Methoden)`;
    statusEl.className = "mono-sm ok";
    $("#nwc-disconnect").classList.remove("hidden");
    updateSidebarBalances();
  } catch (e) {
    if (silent) return;
    statusEl.textContent = (e as Error).message;
    statusEl.className = "mono-sm err";
  }
}

function disconnectNwc(): void {
  nwc = null;
  localStorage.removeItem(NWC_KEY);
  const input = $("#nwc-uri") as HTMLInputElement | null;
  if (input) input.value = "";
  $("#ln-balance").innerHTML = `— <small>sats</small>`;
  $("#nwc-status").textContent = "getrennt";
  $("#nwc-status").className = "mono-sm";
  $("#nwc-disconnect").classList.add("hidden");
  updateSidebarBalances();
}

/** Zahlt eine Rechnung ueber den Weg, der auf diesem Geraet verfuegbar ist. */
async function payInvoiceAnyDevice(bolt11: string): Promise<{ preimage: string }> {
  if (nwc) return nwc.payInvoice(bolt11);
  const w = (window as unknown as { webln?: { enable(): Promise<void>; sendPayment(i: string): Promise<{ preimage: string }> } }).webln;
  if (w) {
    await w.enable();
    return w.sendPayment(bolt11);
  }
  throw new Error(
    "Keine Lightning-Wallet verbunden. Im Wallet-Tab per NWC verbinden — das " +
      "funktioniert auf Handy und Desktop gleichermassen.",
  );
}

/** Aktive Deposit-Session (RAM). */
let activeDeposit: { sessionId: string; spendSwapId: string; refundSwapId: string } | null = null;

async function startDeposit(): Promise<void> {
  if (!state.keypair) return;
  const statusEl = $("#dep-status");
  if (!solWallet.connected || !solWallet.pubkey) {
    statusEl.textContent = "erst Solana-Wallet verbinden";
    statusEl.className = "mono-sm warn";
    return;
  }
  const amountSol = Number(($("#dep-amount") as HTMLInputElement).value);
  if (!amountSol || amountSol <= 0) {
    statusEl.textContent = "ungueltiger Betrag";
    statusEl.className = "mono-sm err";
    return;
  }
  const providerPk =
    ($("#dep-provider") as HTMLInputElement).value.trim() || state.lastProvider;
  if (!providerPk) {
    statusEl.textContent = "kein Provider — erst eine KI-Anfrage stellen oder pubkey angeben";
    statusEl.className = "mono-sm warn";
    return;
  }

  const totalLamports = Math.floor(amountSol * 1e9);
  // Zwei-HTLC-Muster: 40% Verbrauch (Provider), 60% Rest (User, refundbar)
  const spendLamports = Math.floor(totalLamports * 0.4);
  const refundLamports = totalLamports - spendLamports;
  const sessionId = `sol-dep-${state.keypair.pk.slice(0, 8)}-${Math.floor(Date.now() / 1000)}`;
  const spendSwapId = `${sessionId}-spend`;
  const refundSwapId = `${sessionId}-refund`;

  try {
    // REIHENFOLGE IST WICHTIG: erst sperren, dann ankuendigen.
    //
    // Vorher wurde nur das Event veroeffentlicht und eine Zahl in localStorage
    // hochgezaehlt — es fand nie eine Transaktion statt. Provider pruefen
    // inzwischen on-chain und lehnen ein ungedecktes Deposit ab. Wuerde das
    // Event zuerst kommen, stuende eine Ankuendigung auf den Relays, der nichts
    // entspricht; scheitert die Signatur, gaebe es keinen Weg, sie
    // zurueckzunehmen.
    const provider = solWallet.provider;
    if (!provider?.signTransaction) {
      statusEl.textContent = "Diese Wallet kann keine Transaktionen signieren.";
      statusEl.className = "mono-sm err";
      return;
    }

    const providerSol = ($("#dep-provider-sol") as HTMLInputElement | null)?.value.trim()
      || state.lastProviderSolAddress;
    if (!providerSol) {
      statusEl.textContent =
        "SOL-Adresse des Providers unbekannt — erst eine KI-Anfrage stellen, "
        + "damit der Provider sie mitteilt.";
      statusEl.className = "mono-sm warn";
      return;
    }

    const { Connection } = await import("@solana/web3.js");
    const rpcUrl = await solRpcUrl();
    const conn = new Connection(rpcUrl, "confirmed");

    const { lockDeposit } = await import("../sol-htlc.js");
    statusEl.className = "mono-sm";
    const lock = await lockDeposit({
      connection: conn,
      wallet: provider as never,
      providerSolAddress: providerSol,
      spendSwapId,
      refundSwapId,
      spendLamports,
      refundLamports,
      timelockUnix: Math.floor(Date.now() / 1000) + 7200,
      onProgress: (step) => { statusEl.textContent = step; },
    });

    // Das Preimage ist der einzige Weg, vor Ablauf des Timelocks an das Geld zu
    // kommen. Frueher lag es in sessionStorage und war beim Schliessen des Tabs
    // weg. localStorage ueberlebt wenigstens einen Neustart — dauerhaft sicher
    // ist nur eine Sicherung durch den Nutzer, deshalb wird sie eingefordert.
    localStorage.setItem(`freedom.htlc.${sessionId}`, JSON.stringify({
      preimageHex: lock.preimageHex,
      hashlockHex: lock.hashlockHex,
      spendSwapId, refundSwapId, timelockUnix: Math.floor(Date.now() / 1000) + 7200,
    }));

    // Erst JETZT ankuendigen — das Geld liegt bereits auf der Kette.
    const pool = await ensurePool();
    const { buildSolDepositOpen, signEvent: se } = await import("@freedomstack/protocol");
    const ev = se(
      buildSolDepositOpen({
        customerPubkey: state.keypair.pk,
        providerPubkey: providerPk,
        sessionId,
        totalLamports,
        spendSwapId,
        refundSwapId,
        spendLamports,
        refundLamports,
        timelockUnix: Math.floor(Date.now() / 1000) + 7200,
        maxLamportsPerKToken: 1000,
      }),
      state.keypair.sk,
    );
    await pool.publish(ev);

    activeDeposit = { sessionId, spendSwapId, refundSwapId };
    statusEl.innerHTML =
      `<strong>Deposit gedeckt.</strong> ${escapeHtml(String(amountSol))} SOL auf der Kette gesperrt.<br>`
      + `<span class="mono-sm">tx ${escapeHtml(lock.signature.slice(0, 16))}…</span><br>`
      + `Rueckholbar ab ${new Date((Math.floor(Date.now() / 1000) + 7200) * 1000).toLocaleTimeString("de-DE")}.`;
    statusEl.className = "mono-sm ok";
    ($("#dep-refund") as HTMLButtonElement).classList.remove("hidden");
    toast("Deposit gesperrt und angekuendigt");
    updateBudgetBar();
    updateSidebarBalances()
  } catch (e) {
    statusEl.textContent = `Fehler: ${(e as Error).message}`;
    statusEl.className = "mono-sm err";
  }
}

async function refundDeposit(): Promise<void> {
  const statusEl = $("#dep-status");
  if (!activeDeposit) {
    statusEl.textContent = "keine aktive Deposit-Session";
    return;
  }
  const provider = solWallet.provider;
  if (!provider?.signTransaction) {
    statusEl.textContent = "Wallet verbinden, um zurueckzuholen.";
    statusEl.className = "mono-sm warn";
    return;
  }

  // Erwartungshaltung geradeziehen, BEVOR die Wallet aufgeht: Was der Provider
  // bereits eingeloest hat, ist bezahlter Verbrauch und kommt nicht zurueck.
  const stored = localStorage.getItem(`freedom.htlc.${activeDeposit.sessionId}`);
  const meta = stored ? (JSON.parse(stored) as { timelockUnix: number }) : null;
  const now = Math.floor(Date.now() / 1000);
  if (meta && now < meta.timelockUnix) {
    const restMin = Math.ceil((meta.timelockUnix - now) / 60);
    statusEl.innerHTML =
      `Der Timelock laeuft noch ${restMin} Minuten. Vorher kann die Kette nichts `
      + `freigeben — das ist die Absicherung, die den Provider ohne Vertrauen `
      + `arbeiten laesst. Danach hier erneut klicken.`;
    statusEl.className = "mono-sm warn";
    return;
  }

  try {
    const { Connection } = await import("@solana/web3.js");
    const rpcUrl = await solRpcUrl();
    const { refundDepositOnChain } = await import("../sol-htlc.js");

    statusEl.className = "mono-sm";
    const res = await refundDepositOnChain({
      connection: new Connection(rpcUrl, "confirmed"),
      wallet: provider as never,
      swapIds: [activeDeposit.refundSwapId, activeDeposit.spendSwapId],
      onProgress: (step) => { statusEl.textContent = step; },
    });

    if (res.refunded.length > 0) {
      statusEl.innerHTML =
        `<strong>Zurueckgeholt.</strong> ${res.refunded.length} HTLC(s) freigegeben.<br>`
        + `<span class="mono-sm">tx ${escapeHtml((res.signature ?? "").slice(0, 16))}…</span>`;
      statusEl.className = "mono-sm ok";
      localStorage.removeItem(`freedom.htlc.${activeDeposit.sessionId}`);
      activeDeposit = null;
      ($("#dep-refund") as HTMLButtonElement).classList.add("hidden");
    } else {
      statusEl.textContent = res.failed[0]?.reason ?? "Rueckholung nicht moeglich.";
      statusEl.className = "mono-sm err";
    }
    updateSidebarBalances();
  } catch (e) {
    statusEl.textContent = (e as Error).message;
    statusEl.className = "mono-sm err";
  }
}

// ------------------------------------------------------------- Init (v0.2)

/** Wendet die aktuelle Sprache auf alle [data-i18n]/[data-i18n-ph] an. */
function applyI18n(): void {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    // Nur reine Text-Nodes setzen — Elemente mit Kind-Elementen (z.B.
    // nav-buttons mit icon-span) bekommen ihr label aus einem dedicated span.
    if (el.children.length === 0) {
      el.textContent = t(el.getAttribute("data-i18n")!);
    } else {
      // erstes text-only child mit data-i18n-label oder letzter span
      const labelSpan = el.querySelector("[data-i18n]");
      const target = labelSpan === el ? null : labelSpan;
      if (target && target.children.length === 0) target.textContent = t(target.getAttribute("data-i18n")!);
    }
  });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
    (el as HTMLInputElement).placeholder = t(el.getAttribute("data-i18n-ph")!);
  });
}

function setupLangMenu(): void {
  // Zwei Umschalter: Landing (#lang-btn) + App-Sidebar (#lang-btn-app).
  // Beide teilen dasselbe menü-verhalten; nur DE/EN angeboten (rest = EN-fallback).
  const pairs: Array<{ btnId: string; menuId: string }> = [
    { btnId: "#lang-btn", menuId: "#lang-menu" },
    { btnId: "#lang-btn-app", menuId: "#lang-menu-app" },
  ];
  const renderMenu = (menu: HTMLElement): void => {
    menu.innerHTML = LANGS.map(
      (l) => `<button type="button" data-lang="${l.code}" class="${l.code === getLang() ? "active" : ""}">${l.code.toUpperCase()} · ${l.label}</button>`,
    ).join("");
    menu.querySelectorAll("button[data-lang]").forEach((b) => {
      b.addEventListener("click", () => {
        const code = (b as HTMLElement).dataset.lang as Lang;
        setLang(code);
        localStorage.setItem("freedom.lang", code);
        document.documentElement.lang = code;
        applyI18n();
        pairs.forEach(({ btnId, menuId }) => {
          const m2 = $(menuId);
          if (m2) renderMenu(m2);
          const b2 = $(btnId) as HTMLButtonElement | null;
          if (b2) b2.textContent = `${code.toUpperCase()} ▾`;
        });
      });
    });
  };
  pairs.forEach(({ btnId, menuId }) => {
    const btn = $(btnId);
    const menu = $(menuId);
    if (!btn || !menu) return;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      renderMenu(menu);
      menu.classList.toggle("hidden");
    });
  });
  document.addEventListener("click", () => {
    pairs.forEach(({ menuId }) => $(menuId)?.classList.add("hidden"));
  });
}

/** Landing -> Gate -> App. */
function setupFlow(): () => void {
  // Hero-Hintergrund (circuit-partikel) — läuft in der App als Ambient-Effekt
  const heroCanvas = document.getElementById("hero-gl") as HTMLCanvasElement | null;
  if (heroCanvas) startHero(heroCanvas);
  // Landing-Klick → App direkt (kein Gate; wallet später im wallet-tab)
  const landing = $("#landing");
  if (landing) {
    landing.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".lang-dropdown")) return;
      landing.classList.add("hidden");
      enter();
    });
  }
  const enter = () => {
    $("#landing")?.classList.add("hidden");
    $("#gate")?.classList.add("hidden");
    $("#app").classList.remove("hidden");
    checkOnboarding(); // Onboarding-Modal NACH dem App-Eintritt (echtes overlay)
    // App initialisieren (Tabs, etc.)
    updateFeePreview();
    updateBudgetBar();
    loadChatList();
    loadWallet();
    loadEarnings();
    switchTab("ai");
    // Modell-Katalog + Quota laden (async, sobald provider-discovery fertig)
    void refreshModelDropdown().then(() => refreshQuota());
  };
  $("#gate-lightning").onclick = () => { loadOrCreateIdentity(); checkOwnProvider(); enter(); };
  $("#gate-local").onclick = () => { loadOrCreateIdentity(); checkOwnProvider(); enter(); };
  $("#gate-solana").onclick = async () => { loadOrCreateIdentity(); await connectSolana(); checkOwnProvider(); enter(); };
  return enter;
}

/** Prueft ob ?provider= in der URL steht und setzt ihn als einzigen erlaubten. */
function checkOwnProvider(): void {
  const pk = getOwnProviderFromUrl();
  if (pk) {
    setOwnProvider(pk);
    console.log(`[provider] Eigener Provider gesetzt: ${pkShort(pk)}`);
    toast(`Eigener Provider aktiv: ${pkShort(pk)}`);
  }
}

export function boot(): void {
  captureReferral();
  void publishReferralClaim();
  // SVG-Icons: alle [data-icon]-Elemente bekommen ihr Inline-SVG (ersetzt Emojis)
  import("../icons.js").then(({ icon }) => {
    document.querySelectorAll<HTMLElement>("[data-icon]").forEach((el) => {
      el.innerHTML = icon(el.dataset.icon!);
    });
  });
  // Sprache: gespeicherte oder Browser-Default (en)
  const saved = (localStorage.getItem("freedom.lang") as Lang | null);
  setLang(saved ?? detectLang());
  const langCode = getLang().toUpperCase();
  ($("#lang-btn") as HTMLButtonElement).textContent = `${langCode} ▾`;
  const appLangBtn = $("#lang-btn-app") as HTMLButtonElement | null;
  if (appLangBtn) appLangBtn.textContent = `${langCode} ▾`;
  applyI18n();
  setupLangMenu();
  // Kein Gate mehr → Identity beim Boot laden/erzeugen (früher gate-button)
  loadOrCreateIdentity();
  checkOwnProvider();
  const enter = setupFlow();
  // Kein Gate: App öffnet direkt. Wallet-Connect/Deposit über sidebar-CTA
  // → wallet-tab. (R1 in docs/ROADMAP.md ändert das vor dem Launch.)
  enter();

  // App-Interna (werden nach Login aktiv)
  document.querySelectorAll(".app-nav button[data-tab]").forEach((b) => {
    b.addEventListener("click", () => switchTab((b as HTMLElement).dataset.tab!));
  });
  $("#ident").onclick = exportIdentity;
  $("#btn-import").onclick = importIdentity;
  // Sidebar-Balances: ident + import klonen die header-handler (desktop)
  const nbIdent = $("#nb-ident");
  const nbImport = $("#nb-import");
  if (nbIdent) nbIdent.onclick = exportIdentity;
  if (nbImport) nbImport.onclick = importIdentity;
  // Wallet-Button in der Sidebar: springt zum Wallet-Tab (verbinden/deposit)
  const nbWallet = $("#nb-wallet");
  if (nbWallet) {
    nbWallet.onclick = () => switchTab("wallet");
    // Bereits verbunden? → Button zeigt "deposit" und öffnet trotzdem wallet-tab
    if (localStorage.getItem("freedom.sol.pubkey") || localStorage.getItem("freedom.sol.balance")) {
      nbWallet.textContent = "+ SOL deposit";
    }
  }
  $("#chat-send").onclick = sendChatMessage;
  // Media-Anhaenge im Chat (frueher Feed): kleine Dateien inline, grosse ueber
  // das Chunk-/Blob-Netz mit Blossom als Fallback.
  const chatMediaBtn = $("#chat-media-btn");
  const chatFileInput = $("#chat-file-input") as HTMLInputElement | null;
  if (chatMediaBtn && chatFileInput) {
    chatMediaBtn.onclick = () => chatFileInput.click();
    chatFileInput.onchange = () => { void handleChatFiles(chatFileInput.files); chatFileInput.value = ""; };
  }
  // NEU: Zap-Button neben Eingabefeld
  const zapBtn = $("#chat-zap");
  if (zapBtn) {
    zapBtn.onclick = async () => {
      if (!activeConversation) {
        toast("waehle erst einen chat", true);
        return;
      }
      const c = conversations.find((x) => x.id === activeConversation);
      if (!c || c.type !== "dm") {
        toast("zaps nur in 1:1-chats", true);
        return;
      }
      const { openZapDialog } = await import("../chat-zap.js");
      openZapDialog(c.id, c.name);
    };
  }
  // Mesh-Transfer (USB/offline): chat-verlauf exportieren / datei importieren
  const meshExportBtn = $("#chat-mesh-export");
  const meshImportBtn = $("#chat-mesh-import");
  const meshFileInput = $("#chat-mesh-file") as HTMLInputElement | null;
  if (meshExportBtn) {
    meshExportBtn.onclick = async () => {
      if (!state.keypair || !activeConversation) { toast("waehle erst einen chat", true); return; }
      try {
        const pool = await ensurePool();
        const c = conversations.find((x) => x.id === activeConversation);
        if (!c) return;
        const kinds = c.type === "dm" ? [4] : [42];
        const filter = c.type === "dm"
          ? { kinds, authors: [state.keypair.pk, c.id], limit: 200 }
          : { kinds, "#h": [c.id], limit: 200 };
        const events = await pool.query(filter as never);
        const { exportMeshFile } = await import("../mesh-transfer.js");
        exportMeshFile(events, state.keypair.pk, c.name.replace(/[^a-z0-9]/gi, "-").slice(0, 20));
        toast(`${events.length} events exportiert — auf USB/Bluetooth senden`);
      } catch (e) {
        toast(`export-fehler: ${(e as Error).message}`, true);
      }
    };
  }
  if (meshImportBtn && meshFileInput) {
    meshImportBtn.onclick = () => meshFileInput.click();
    meshFileInput.onchange = async () => {
      const file = meshFileInput.files?.[0];
      meshFileInput.value = "";
      if (!file || !state.keypair) return;
      try {
        const { importMeshFile } = await import("../mesh-transfer.js");
        const events = await importMeshFile(file);
        // events ins netz publizieren (signaturen werden von relays geprueft)
        const pool = await ensurePool();
        let ok = 0;
        for (const ev of events) {
          try {
            await pool.publish(ev as never);
            ok++;
          } catch { /* duplikat/ungueltig */ }
        }
        toast(`${ok}/${events.length} offline-events importiert`);
        if (activeConversation) loadChatMessages(activeConversation);
      } catch (e) {
        toast(`import-fehler: ${(e as Error).message}`, true);
      }
    };
  }
  // Reward-Claim
  const claimBtn = $("#claim-submit");
  if (claimBtn) claimBtn.onclick = submitRewardClaim;
  // Freedom Git: bundle publizieren + repo-liste laden
  const gitPublishBtn = $("#git-repo-publish");
  const gitFileInput = $("#git-bundle-file") as HTMLInputElement | null;
  if (gitPublishBtn && gitFileInput) {
    gitPublishBtn.onclick = () => gitFileInput.click();
    gitFileInput.onchange = async () => {
      const file = gitFileInput.files?.[0];
      gitFileInput.value = "";
      if (!file || !state.keypair) return;
      const nameEl = $("#git-repo-name") as HTMLInputElement;
      const name = nameEl.value.trim().replace(/[^a-z0-9-_]/gi, "-") || file.name.replace(/\.bundle$/i, "");
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        // sha256 head aus bundle-name (der user macht lokal: git bundle create)
        const { uploadBlob } = await import("../blob-client.js");
        const pool = await ensurePool();
        setGitStatus(`publiziere ${file.name} (${Math.round(bytes.length / 1024)}kb)…`);
        const res = await uploadBlob(
          new File([bytes], `${name}.bundle`, { type: "application/octet-stream" }),
          pool as never, state.keypair, signEvent as never,
        );
        // repo-ref-event (38042)
        const { buildGitRepoRef } = await import("@freedomstack/protocol");
        const ref = buildGitRepoRef(
          { name, blobId: res.blobId, headSha: "local", branch: "main", message: `bundle ${file.name}`, version: Math.floor(Date.now() / 1000) },
          state.keypair.pk,
        );
        await pool.publish(signEvent(ref, state.keypair.sk));
        toast(`${name} publiziert (${res.blobId.slice(0, 8)}…)`);
        loadGitRepos();
      } catch (e) {
        toast(`git-fehler: ${(e as Error).message}`, true);
      }
    };
  }
  loadGitRepos();
  $("#ai-send").onclick = askAi;
  $("#ai-bid").oninput = updateFeePreview;
  $("#wallet-refresh").onclick = loadWallet;
  void wireClientFeeSetting();
  void wireMeshTab();
  void wireSpacesTab();
  void wireProfil();
  setzeLogo();
  wireSubtabs();
  wireKommunikation();
  zeigeVerlaeufe();
  document.getElementById("agent-new")?.addEventListener("click", neueAufgabe);
  void aktualisiereNavStatus();
  void aktualisiereSicherheitsStand();
  // Profil teilen: den oeffentlichen Schluessel kopieren — damit findet dich jeder Nostr-Client.
  document.getElementById("profile-share")?.addEventListener("click", async () => {
    if (!state.keypair) return;
    try {
      await navigator.clipboard.writeText(state.keypair.pk);
      toast("Öffentlicher Schlüssel kopiert");
    } catch {
      prompt("Öffentlicher Schlüssel:", state.keypair.pk);
    }
  });
  const ziele: Record<string, string> = { "1": "backup-now", "2": "rotation-prepare", "3": "succ-setup" };
  document.querySelectorAll<HTMLElement>(".sec-action").forEach((b) => {
    b.addEventListener("click", () => document.getElementById(ziele[b.dataset.step!] ?? "")?.click());
  });
  setInterval(() => void aktualisiereNavStatus(), 30_000);
  void zeigeOnboarding();
  const succSetup = $("#succ-setup");
  if (succSetup) succSetup.onclick = () => void richteNachfolgeEin();
  const succBeat = $("#succ-heartbeat");
  if (succBeat) succBeat.onclick = async () => {
    if (!state.keypair) return;
    const { buildHeartbeat, signEvent: se } = await import("@freedomstack/protocol");
    await (await ensurePool()).publish(se(buildHeartbeat(state.keypair.pk), state.keypair.sk));
    toast("Lebenszeichen gesendet — laufende Vorgänge sind abgebrochen");
    void zeigeNachfolge();
  };
  const modelsRefresh = $("#models-refresh");
  if (modelsRefresh) modelsRefresh.onclick = () => void zeigeModelle();
  const modelsSeed = $("#models-seed");
  if (modelsSeed) modelsSeed.onclick = () => void haltevorModell();
  const modelsPub = $("#models-publish");
  if (modelsPub) modelsPub.onclick = () => void kuendigeModellAn();
  const badgeCreate = $("#badge-create");
  if (badgeCreate) badgeCreate.onclick = () => void vergebeAbzeichen();
  void zeigeNachfolge();
  void zeigeModelle();
  void zeigeMitwirkende();
  void wireRpcSetting();
  const exportBtn = $("#selfexport-btn");
  if (exportBtn) exportBtn.onclick = () => void exportiereApp();
  const checkBtn = $("#selfcheck-btn");
  if (checkBtn) checkBtn.onclick = () => void pruefeEigeneEchtheit();
  const swapClaimBtn = $("#swap-claim");
  if (swapClaimBtn) swapClaimBtn.onclick = () => void claimActiveSwap();
  const swapBackupBtn = $("#swap-backup");
  if (swapBackupBtn) swapBackupBtn.onclick = () => void exportSwapBackup();
  $("#earn-refresh").onclick = loadEarnings;
  $("#sol-connect").onclick = () => void connectSolana();
  // NWC: Lightning ohne Browser-Extension — der einzige Weg, der auf iOS geht.
  const nwcConnectBtn = $("#nwc-connect");
  if (nwcConnectBtn) nwcConnectBtn.onclick = () => void connectNwc();
  const nwcDisconnectBtn = $("#nwc-disconnect");
  if (nwcDisconnectBtn) nwcDisconnectBtn.onclick = disconnectNwc;
  $("#dep-start").onclick = startDeposit;
  $("#dep-refund").onclick = refundDeposit;
  $("#chat-new-dm").onclick = () => void newDm();
  $("#chat-new-community").onclick = newCommunity;
  setupAttach();
  setupToolChips();
  setupModelPicker();
  setupEmptyState();
  // C7: Live-Kosten-Schätzung beim Tippen + Enter-to-Send (Shift+Enter = Zeilenumbruch)
  const aiPromptEl = $("#ai-prompt") as HTMLTextAreaElement;
  if (aiPromptEl) {
    aiPromptEl.addEventListener("input", updateTokenEstimate);
    aiPromptEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void askAi();
      }
    });
    // Auto-Resize bis max 6 rows
    aiPromptEl.addEventListener("input", () => {
      aiPromptEl.style.height = "auto";
      aiPromptEl.style.height = Math.min(aiPromptEl.scrollHeight, 160) + "px";
    });
  }
  setupReferral();
  setupCopyButtons();
}

/** Zap-Button: NIP-57 Lightning-Zahlung fuer eine Antwort. */
function addZapButton(providerPubkey: string, eventId: string, amountMsat: number): void {
  const el = document.createElement("div");
  el.className = "zap-bubble";
  const sats = Math.floor(amountMsat / 1000);
  el.innerHTML = `
    <button class="zap-btn" type="button">⚡ zap ${sats} sats</button>
    <span class="zap-status hidden"></span>
  `;
  const btn = el.querySelector(".zap-btn") as HTMLButtonElement;
  const status = el.querySelector(".zap-status") as HTMLElement;
  btn.onclick = async () => {
    try {
      btn.disabled = true;
      status.textContent = "verbinde wallet…";
      status.classList.remove("hidden");
      // Wallet verbinden (WebLN oder LNURL)
      const { detectWallet } = await import("../lightning-wallet.js");
      const wallet = await detectWallet();
      if (!wallet) {
        status.textContent = "keine lightning-wallet im browser — iphone: nutze solana-deposit im wallet-tab";
        return;
      }
      await wallet.connect();
      // Zap-Request bauen (NIP-57)
      const { buildZapRequest } = await import("@freedomstack/protocol");
      const zapReq = buildZapRequest({
        senderPubkey: state.keypair!.pk,
        recipientPubkey: providerPubkey,
        eventId,
        amountMsat,
        relays: ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band"],
      });
      // LNURL-Pay vom Provider holen (aus seinem Profil, kind 0)
      const { parseProfile } = await import("@freedomstack/protocol");
      const pool = await ensurePool();
      const profiles = await pool.query({ kinds: [0], authors: [providerPubkey], limit: 1 });
      let lud16 = "";
      if (profiles.length > 0) {
        try {
          const p = parseProfile(profiles[0]);
          lud16 = p.lud16 ?? "";
        } catch { /* ignore */ }
      }
      if (!lud16) {
        status.textContent = "provider hat keine lightning-adresse (lud16)";
        return;
      }
      // LNURL-Pay: fetch -> get invoice -> pay
      const lnurlRes = await fetch(`https://${lud16.split("@")[1]}/.well-known/lnurlp/${lud16.split("@")[0]}`);
      const lnurlData = await lnurlRes.json();
      if (!lnurlData.callback) throw new Error("kein callback in LNURL");
      const cb = new URL(lnurlData.callback);
      cb.searchParams.set("amount", String(amountMsat));
      cb.searchParams.set("nostr", JSON.stringify(zapReq));
      const cbRes = await fetch(cb.toString());
      const cbData = await cbRes.json();
      if (!cbData.pr) throw new Error("keine invoice in callback");
      // Bezahlen mit Wallet
      const { preimage } = await wallet.sendPayment(cbData.pr);
      status.textContent = `⚡ gezappt! ${Math.floor(amountMsat / 1000)} sats`;
      // Zap-Receipt publizieren (NIP-57)
      const { buildZapReceipt, signEvent } = await import("@freedomstack/protocol");
      const receipt = buildZapReceipt({
        zapperPubkey: state.keypair!.pk,
        recipientPubkey: providerPubkey,
        eventId,
        zapRequestJson: JSON.stringify(zapReq),
        bolt11: cbData.pr,
        preimageHex: preimage,
      });
      await pool.publish(signEvent(receipt, state.keypair!.sk));
    } catch (e) {
      status.textContent = `fehler: ${(e as Error).message}`;
    } finally {
      btn.disabled = false;
    }
  };
  $("#ai-thread").appendChild(el);
  el.scrollIntoView({ behavior: "smooth", block: "end" });
}

/** Onboarding: 3-Schritt-Wizard fuer neue Nutzer. */
function showOnboarding(): void {
  const el = document.createElement("div");
  el.className = "onboarding-overlay";
  el.innerHTML = `
    <div class="onboarding-card">
      <h2>Willkommen bei Freedom</h2>
      <p class="mono-sm">Dezentrale KI + Zahlungen. Kein Account. Kein Server.</p>
      <div class="onboarding-steps">
        <div class="step active" data-step="1">
          <div class="step-num">1</div>
          <div class="step-title">Verbinden</div>
          <div class="step-desc">Nostr-Key oder Wallet</div>
        </div>
        <div class="step" data-step="2">
          <div class="step-num">2</div>
          <div class="step-title">AI testen</div>
          <div class="step-desc">3 Gratis-Antworten</div>
        </div>
        <div class="step" data-step="3">
          <div class="step-num">3</div>
          <div class="step-title">Zap senden</div>
          <div class="step-desc">1 sat an Provider</div>
        </div>
      </div>
      <div class="onboarding-actions">
        <button class="ghost" id="onboarding-skip">Ueberspringen</button>
        <button class="cta" id="onboarding-start">Starten</button>
      </div>
    </div>
  `;
  document.body.appendChild(el);

  const closeOnboarding = (): void => {
    el.remove();
    localStorage.setItem("freedom.onboarded", "1");
  };
  $("#onboarding-skip")!.onclick = closeOnboarding;
  $("#onboarding-start")!.onclick = closeOnboarding;
  // Klick auf den dunklen Hintergrund schließt ebenfalls
  el.addEventListener("click", (e) => {
    if (e.target === el) closeOnboarding();
  });
}

/** Prueft ob Onboarding gezeigt werden soll. */
function checkOnboarding(): void {
  const onboarded = localStorage.getItem("freedom.onboarded");
  if (!onboarded) {
    showOnboarding();
  }
}

/** Copy-Buttons: letzte antwort + ganze konversation. */
function setupCopyButtons(): void {
  const copyLast = $("#copy-last");
  const copyAll = $("#copy-all");
  const getBubbles = () => Array.from(document.querySelectorAll("#ai-thread .bubble"));
  const bubbleText = (b: Element) => {
    const who = b.querySelector(".who")?.textContent?.trim() ?? "";
    const txt = b.querySelector(".body")?.textContent?.trim() ?? "";
    return who ? `${who}: ${txt}` : txt;
  };
  copyLast?.addEventListener("click", async () => {
    const bubbles = getBubbles().filter((b) => b.classList.contains("ai"));
    const last = bubbles[bubbles.length - 1];
    if (!last) { toast("keine antwort zum kopieren", true); return; }
    await navigator.clipboard.writeText(bubbleText(last));
    toast("letzte antwort kopiert");
  });
  copyAll?.addEventListener("click", async () => {
    const bubbles = getBubbles();
    if (bubbles.length === 0) { toast("keine konversation", true); return; }
    const text = bubbles.map(bubbleText).join("\n\n");
    await navigator.clipboard.writeText(text);
    toast("konversation kopiert");
  });
}

/** Referral: link mit eigener pubkey generieren + copy. */
function setupReferral(): void {
  const link = $("#referral-link") as HTMLInputElement | null;
  const copyBtn = $("#referral-copy");
  const stats = $("#referral-stats");
  if (!link || !copyBtn) return;
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(link.value);
      toast("Referral-Link kopiert");
    } catch {
      link.select();
      document.execCommand("copy");
      toast("Referral-Link kopiert");
    }
  });

  // Rechner: der Nutzer soll die Annahme selbst verstellen koennen. Eine feste
  // Beispielzahl waere eine Verkaufszahl; eine, die er anfasst, ist eine
  // Rechnung, die er nachvollzieht.
  const n = $("#ref-calc-n") as HTMLInputElement | null;
  const satsIn = $("#ref-calc-sats") as HTMLInputElement | null;
  const out = $("#ref-calc-out");
  if (n && satsIn && out) {
    const rechne = async (): Promise<void> => {
      const { projectEarnings } = await import("@freedomstack/protocol");
      const p = projectEarnings({
        activeReferrals: Math.max(0, Number(n.value) || 0),
        avgMonthlySatsPerReferral: Math.max(0, Number(satsIn.value) || 0),
      });
      out.innerHTML =
        `<strong>${p.monthlySats.toLocaleString("de-DE")} sats/Monat</strong> ` +
        `(${p.yearlySats.toLocaleString("de-DE")} sats/Jahr), Stufe ${escapeHtml(p.tier)}.<br>` +
        `<span class="muted">${escapeHtml(p.assumption)}</span>`;
    };
    n.addEventListener("input", () => void rechne());
    satsIn.addEventListener("input", () => void rechne());
    void rechne();
  }
}

/**
 * Referral-URL mit der AKTUELLEN identity füllen. Muss NACH dem Identity-Laden
 * laufen (sonst ?ref= leer) und bei jedem Earn-Tab-Öffnen erneut — der pubkey
 * kann sich ändern (import).
 */
function updateReferralLink(): void {
  const link = $("#referral-link") as HTMLInputElement | null;
  const stats = $("#referral-stats");
  if (!link || !state.keypair) return;
  const pub = state.keypair.pk;
  // Origin-basiert (funktioniert auf jeder Domain — nicht nur localhost):
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set("ref", pub);
  link.value = url.toString();
  if (stats) stats.textContent = `dein Code: ${pkShort(pub)}`;
  void renderReferralTier();
}

/** Eigene Stufe und der Weg zur naechsten. */
async function renderReferralTier(): Promise<void> {
  const box = $("#referral-tier");
  if (!box || !state.keypair) return;
  try {
    const {
      tierFor, nextTier, buildReferralGraph, referrerOverview,
      KIND_REFERRAL_CLAIM, KIND_PERFORMANCE,
    } = await import("@freedomstack/protocol");
    const pool = await ensurePool();
    const since = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;

    // Aus SIGNIERTEN Netz-Ereignissen gerechnet, nicht aus einer lokalen Zahl.
    // Damit kann jeder dieselbe Rechnung anstellen und das Ergebnis pruefen.
    const [claims, perfs] = await Promise.all([
      pool.query({ kinds: [KIND_REFERRAL_CLAIM], limit: 2000 }),
      pool.query({ kinds: [KIND_PERFORMANCE], since, limit: 2000 }),
    ]);
    const graph = buildReferralGraph(claims, perfs);
    const u = referrerOverview(state.keypair.pk, graph);

    const t = tierFor(u.activeReferrals);
    const next = nextTier(u.activeReferrals);
    box.innerHTML =
      `Stufe <strong>${escapeHtml(t.name)}</strong> — ${escapeHtml(t.perk)}<br>` +
      `<span class="muted">${u.activeReferrals} aktiv von ${u.totalReferrals} geworben` +
      (u.level2Count > 0 ? `, ${u.level2Count} auf Ebene 2` : "") + `.</span>` +
      (next
        ? `<br><span class="muted">Noch ${next.missing} aktive Geworbene bis ${escapeHtml(next.tier.name)}.</span>`
        : `<br><span class="muted">Hoechste Stufe erreicht.</span>`);
  } catch {
    // Ohne Netz keine erfundene Zahl anzeigen.
    box.innerHTML = `<span class="muted">Stufe wird beim naechsten Netzkontakt berechnet.</span>`;
  }
}

/** Referral aus URL lesen (?ref=pubkey) und speichern. */
function captureReferral(): void {
  const ref = new URLSearchParams(window.location.search).get("ref");
  if (ref && /^[0-9a-f]{64}$/.test(ref)) {
    // Nicht ueberschreiben: Es zaehlt ohnehin die frueheste Angabe im Netz.
    // Lokal dasselbe Verhalten, damit ein spaeter geoeffneter fremder Link
    // den urspruenglichen Werber nicht still verdraengt.
    if (!localStorage.getItem("freedom.referrer")) {
      localStorage.setItem("freedom.referrer", ref);
    }
  }
}

/**
 * Werbebeziehung EINMAL im Netz veroeffentlichen.
 *
 * Vorher lag der Werber nur in localStorage und war fuer das Netz unsichtbar —
 * die Stufen zeigten deshalb immer "Starter", und eine Auszahlung waere nur
 * auf Zuruf moeglich gewesen. Der Claim wird vom GEWORBENEN signiert: nur so
 * kann niemand fremde Pubkeys als eigene Geworbene eintragen.
 */
async function publishReferralClaim(): Promise<void> {
  if (!state.keypair) return;
  if (localStorage.getItem("freedom.referrer.published") === "1") return;
  const referrer = localStorage.getItem("freedom.referrer");
  if (!referrer || referrer === state.keypair.pk) return;

  try {
    const { buildReferralClaim, signEvent: se } = await import("@freedomstack/protocol");
    const pool = await ensurePool();
    await pool.publish(se(buildReferralClaim(state.keypair.pk, referrer), state.keypair.sk));
    localStorage.setItem("freedom.referrer.published", "1");
  } catch (e) {
    // Kein Abbruch: Der Claim wird beim naechsten Start erneut versucht.
    console.warn(`[referral] Claim noch nicht veroeffentlicht: ${(e as Error).message}`);
  }
}
