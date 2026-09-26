/**
 * freedom App-Shell: Einstiegspunkt der PWA.
 *
 * Laueft komplett im Browser: Identitaet (nsec), Nostr ueber WebSocket-Relays,
 * DVM-Marktplatz, Swap-Orderbook, Chat. Kein Server, keine Custody —
 * die App ist ein dummer Client des Protokolls.
 *
 * Wird per esbuild zu einer einzigen dist/freedom.html gebuendelt.
 */
import { fromHex, toHex } from "@freedomstack/protocol";
import { startHero } from "../hero.js";
import { LANGS, Lang, detectLang, getLang, setLang, t } from "../i18n.js";
import { escapeHtml, pkShort } from "../shell-logic.js";
import { nimmBunkerAuf, wireBunkerKarte } from "./bunker.js";
import { wireEingebauteWallet } from "./eingebaute-wallet.js";
import { zeigeDatenschutz } from "./datenschutz.js";
import { nachNotfallLoeschung, wireNotfallLoeschung } from "./notfall.js";
import { LS_GERAET_PERSON, leseGeraeteCode } from "../geraete-modus.js";
import { einrichtungOffen, merkphraseNochZeigen } from "../einrichtung.js";
import { zeigeEinrichtung } from "./einrichtung-ui.js";
import {
  LS_MERKPHRASE,
  ensurePool,
  getOwnProviderFromUrl,
  mitBunker,
  mitRohemSchluessel,
  setOwnProvider,
  setzeIdentitaet,
  signiere,
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
  captureReferral,
  loadEarnings,
  loadLeaderboard,
  loadTrust,
  publishReferralClaim,
  refreshClaimSummary,
  setupReferral,
  submitRewardClaim,
  updateReferralLink,
  zeigeMitwirkende,
} from "./tabs/earn.js";
import {
  activeConversation,
  conversations,
  handleChatFiles,
  loadChatList,
  loadChatMessages,
  newCommunity,
  newDm,
  sendChatMessage,
  setzeAblauf,
  posteingangAbgleichen,
  wireKommunikation,
  wireSpacesTab,
  zeigeRaumLeiste,
} from "./tabs/kommunikation.js";
import { vergebeAbzeichen, wireProfil, zeigeAbzeichen, zeigeProfilVorschau } from "./tabs/profil.js";
import {
  aktualisiereSicherheitsStand,
  exportiereApp,
  pruefeEigeneEchtheit,
  pruefeFixierungBeimStart,
  richteNachfolgeEin,
  wireClientFeeSetting,
  wireMeshTab,
  wireSicherheitsKnoepfe,
  zeigeGeraete,
  zeigeNachfolge,
  zeigeSicherung,
} from "./tabs/settings.js";
import {
  claimActiveSwap,
  connectNwc,
  connectSolana,
  disconnectNwc,
  exportSwapBackup,
  geldVorgangLaeuft,
  loadWallet,
  nwc,
  refundDeposit,
  startDeposit,
} from "./tabs/waehrung.js";
import {
  entsperreBeimStart,
  geheim,
  ladeSchluessel,
  richteTresorEin,
  speichereSchluessel,
  starteAutoSperre,
  tresorEingerichtet,
} from "./tresor.js";
import {
  $,
  aktualisiereNavStatus,
  escrowIdent,
  refreshQuota,
  setzeLogo,
  toast,
  updateSidebarBalances,
  wireOfflineHinweis,
} from "./ui.js";
export { activateCodeBlocks } from "./ui.js";

// ------------------------------------------------------------- Identitaet

function loadOrCreateIdentity(): void {
  // Anmeldung per Bunker (1.3f) geht vor – dann liegt kein Schluessel in der App.
  if (nimmBunkerAuf()) {
    $("#ident").textContent = escrowIdent();
    return;
  }
  const stored = ladeSchluessel();
  if (stored) {
    // Als Geraet einer Person angemeldet (8.6c)?
    const person = localStorage.getItem(LS_GERAET_PERSON);
    setzeIdentitaet(fromHex(stored), person && /^[0-9a-f]{64}$/.test(person) ? person : null);
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
  setzeIdentitaet(id.sk);
  await speichereSchluessel(toHex(id.sk));
  // Bis zur Bestaetigung aufheben – wer „spaeter“ waehlt, soll sie spaeter noch sehen (8.1a)
  await geheim.setItem(LS_MERKPHRASE, id.mnemonic!);
  markHasMnemonic();
  $("#ident").textContent = escrowIdent();
  // Einrichtung (8.1b): zuerst die Merkphrase, dann Schutz, Schiene, private Voreinstellungen
  await starteEinrichtung(id.mnemonic!);
}

/**
 * Sicherungsdialog mit Bestaetigung.
 *
 * Der Nutzer tippt drei Woerter nach. Ein Haekchen "ich habe gesichert" wuerde
 * nur belegen, dass er das Haekchen gefunden hat.
 */
/** Der offene Sicherungsdialog – aus Einrichtung, Leiste und Erinnerung nie zweimal übereinander (8.1b). */
let offenerSicherungsDialog: Promise<void> | null = null;

function zeigeSicherungsDialog(mnemonic: string): Promise<void> {
  offenerSicherungsDialog ??= baueSicherungsDialog(mnemonic).finally(() => { offenerSicherungsDialog = null; });
  return offenerSicherungsDialog;
}

async function baueSicherungsDialog(mnemonic: string): Promise<void> {
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
      <button id="bk-later" class="ghost" style="width:auto;padding:6px 10px;margin-top:8px">später bestätigen</button>
      <p class="mono-sm muted">Bis du bestätigst, bleiben die Wörter auf diesem Gerät (im Tresor, sobald du einen einrichtest), und die App erinnert dich.</p>
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
      // Bestaetigt: Die Woerter gehoeren jetzt nur noch auf das Papier (8.1a)
      void geheim.removeItem(LS_MERKPHRASE);
      box.remove();
      toast("Identität gesichert");
      void zeigeOnboarding();
      resolve();
    });
    // Spaeter (8.1a): nichts bestaetigt, die Leiste erinnert nach der ersten Nutzung
    box.querySelector("#bk-later")!.addEventListener("click", () => {
      box.remove();
      void zeigeOnboarding();
      resolve();
    });
  });
}

/** Einrichtung (8.1b) – mit Merkphrase, solange sie noch nicht bestaetigt ist. */
function starteEinrichtung(merkphrase: string | null): Promise<void> {
  return zeigeEinrichtung({
    ...(merkphrase ? { sichern: () => zeigeSicherungsDialog(merkphrase) } : {}),
    oeffne: (tab) => switchTab(tab),
    nenneWerber: () => void publishReferralClaim(),
  }).then(() => zeigeOnboarding());
}

/** Zeigt die Onboarding-Leiste gerade den Schritt „sichern“? Dann keine zweite Mahnung (8.1a). */
let leisteZeigtSichern = false;

/** In dieser Sitzung hat ein Provider eine Gratis-Anfrage abgelehnt (8.1a) – kein erfundener Zaehler. */
let gratisAbgelehnt = false;

/** Vom KI-Tab: Eine Anfrage ohne Gebot wurde abgelehnt – jetzt ist die Frage nach der Wallet berechtigt. */
export function merkeGratisAbgelehnt(): void {
  gratisAbgelehnt = true;
  void zeigeOnboarding();
}

/**
 * Erinnert dezent, solange die Sicherung fehlt – nach der ersten Nutzung
 * (vorher hat man nichts zu verlieren) und nur, wenn die Leiste nicht schon
 * dasselbe sagt. Sie bleibt, wenn man die Leiste mit „später“ wegklickt.
 */
async function zeigeBackupWarnung(): Promise<void> {
  try {
    const { backupStatus } = await import("../identity.js");
    const st = backupStatus();
    const el = $("#backup-warn");
    if (!el) return;
    if (st.warning && localStorage.getItem("freedom.usedOnce") === "1" && !leisteZeigtSichern) {
      el.innerHTML = `⚠ ${escapeHtml(st.warning)} <button id="bk-now" class="ghost" style="width:auto;padding:4px 8px">jetzt sichern</button>`;
      el.classList.remove("hidden");
      el.querySelector("#bk-now")?.addEventListener("click", () => void sichereJetzt());
    } else {
      el.classList.add("hidden");
    }
  } catch { /* Anzeige ist optional */ }
}

const NUR_IM_SIGNER = "Mit Bunker liegt der Schlüssel nicht in der App – sichern und exportieren geht nur im Signer";

/** Nachtraegliche Sicherung — auch fuer Identitaeten ohne Phrase. */
async function sichereJetzt(): Promise<void> {
  if (!state.keypair) return;
  if (mitBunker()) { toast(NUR_IM_SIGNER, true); return; }
  // Noch nicht bestaetigte Merkphrase (8.1a): erneut zeigen und abfragen
  const merkphrase = geheim.getItem(LS_MERKPHRASE);
  if (merkphrase) {
    await zeigeSicherungsDialog(merkphrase);
    return;
  }
  const { identityFromHex, buildBackupFile, markBackupConfirmed } = await import("../identity.js");
  const id = identityFromHex(mitRohemSchluessel("Die Sicherungsdatei", toHex));
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
  if (mitBunker()) { toast(NUR_IM_SIGNER, true); return; }
  const hex = mitRohemSchluessel("Der Export", toHex);
  navigator.clipboard?.writeText(hex).then(
    () => toast("nsec (hex) kopiert — sicher aufbewahren!"),
    () => toast(hex),
  );
}

async function importIdentity(): Promise<void> {
  if (mitBunker()) { toast("Erst vom Bunker abmelden (Settings → Geräte)", true); return; }
  const eingabe = prompt("Merkphrase, nsec1…, 64 Zeichen Hex oder Gerätecode einfuegen:");
  if (eingabe === null) return;
  // Geraetecode (8.6c): Geraeteschluessel plus die Person, fuer die er spricht
  const code = leseGeraeteCode(eingabe);
  let hex = code?.skHex ?? null;
  let mitMerkphrase = false;
  if (!hex) {
    // Seit 8.1a wirklich alle genannten Formen – bis dahin nur Hex
    try {
      const { importIdentity: leseIdentitaet } = await import("../identity.js");
      const id = leseIdentitaet(eingabe);
      hex = toHex(id.sk);
      id.sk.fill(0);
      mitMerkphrase = !!id.mnemonic;
    } catch (e) {
      toast((e as Error).message, true);
      return;
    }
  }
  setzeIdentitaet(fromHex(hex), code?.person ?? null);
  // Eine noch offene Merkphrase gehoerte zur alten Identitaet (8.1a)
  void geheim.removeItem(LS_MERKPHRASE);
  const { markBackupConfirmed, markHasMnemonic, markOhneMnemonic } = await import("../identity.js");
  if (mitMerkphrase) {
    markHasMnemonic();
    markBackupConfirmed();
  } else {
    markOhneMnemonic();
  }
  if (state.person) localStorage.setItem(LS_GERAET_PERSON, state.person);
  else localStorage.removeItem(LS_GERAET_PERSON);
  void speichereSchluessel(hex.toLowerCase()).catch((e) => toast(`nicht gespeichert: ${(e as Error).message}`, true));
  $("#ident").textContent = escrowIdent();
  toast(state.person ? `Als Gerät angemeldet – für ${pkShort(state.person)}` : "Identitaet importiert");
  updateFeePreview();
  loadChatList();
  loadWallet();
  loadEarnings();
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
      hasVault: tresorEingerichtet(),
      hasWallet: !!nwc || !!(window as unknown as { webln?: unknown }).webln,
      hasUsedOnce: localStorage.getItem("freedom.usedOnce") === "1",
      gratisErschoepft: gratisAbgelehnt,
      merkphraseDa: geheim.getItem(LS_MERKPHRASE) !== null,
    }, (localStorage.getItem("freedom.intent") as never) ?? "unbekannt");

    leisteZeigtSichern = schritt.id === "sichern";
    void zeigeBackupWarnung();
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
      else if (schritt.id === "tresor") void richteTresorEin().then(() => zeigeOnboarding());
      else if (schritt.id === "wallet") document.querySelector<HTMLElement>('[data-tab="wallet"]')?.click();
      else if (schritt.id === "provider-anleitung") document.querySelector<HTMLElement>('[data-tab="earn"]')?.click();
      else document.querySelector<HTMLElement>('[data-tab="ai"]')?.click();
    });
    // "Spaeter" blendet nur diesen Schritt aus, nicht die Fuehrung: Wer
    // dauerhaft wegklickt, verliert bei geloeschten Browserdaten alles.
    bar.querySelector("#ob-skip")?.addEventListener("click", () => {
      bar.classList.add("hidden");
      leisteZeigtSichern = false;
      void zeigeBackupWarnung();
    });
  } catch { /* Fuehrung ist optional */ }
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
    // Einrichtung fortsetzen, falls sie beim letzten Mal nicht zu Ende lief (8.1b); eine
    // neue Identitaet startet sie selbst, sobald sie angelegt ist.
    if (state.keypair && einrichtungOffen(localStorage)) {
      void starteEinrichtung(merkphraseNochZeigen(localStorage) ? geheim.getItem(LS_MERKPHRASE) : null);
    }
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

/**
 * Einstieg. Gibt es einen Tresor (Schritt 1.2), wird zuerst entsperrt – erst
 * danach ist der Schluessel da und die App startet wie bisher.
 */
export function boot(): void {
  // Notfall-Loeschung (8.14): kommt die App aus einer, zuerst ein zweiter Durchgang
  void nachNotfallLoeschung().then(() => entsperreBeimStart()).then(starte);
}

function starte(): void {
  // Bis 4.1b legte der Zap eine eigene „Quittung“ mit Preimage im Klartext hier
  // ab – die Warteschlange ist entfallen, alte Eintraege gehoeren weg.
  localStorage.removeItem("freedom.offlineZaps");
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
  // Tresor: automatische Sperre, aber nie mitten in einen Geldvorgang oder Auftrag;
  // ebenso kein Wechsel der Identitaet (Bunker)
  const beschaeftigt = (): boolean => geldVorgangLaeuft() || $("#ai-send")?.dataset.running === "1";
  starteAutoSperre(beschaeftigt);
  wireBunkerKarte(beschaeftigt);
  wireSicherheitsKnoepfe();
  wireNotfallLoeschung(geldVorgangLaeuft);
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
  // Ablauf neuer Nachrichten je Unterhaltung (NIP-40, Schritt 2.5)
  const ablaufSel = document.getElementById("chat-ablauf") as HTMLSelectElement | null;
  if (ablaufSel) ablaufSel.onchange = () => setzeAblauf(ablaufSel.value);
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
  // Mesh-Transfer (USB/offline): Post fuer einen Kontakt mitnehmen / Datei einlesen.
  // Seit 7.1 nur Umschlaege – ohne eigenen Schluessel, ohne Klartext.
  const meshExportBtn = $("#chat-mesh-export");
  const meshImportBtn = $("#chat-mesh-import");
  const meshFileInput = $("#chat-mesh-file") as HTMLInputElement | null;
  if (meshExportBtn) {
    meshExportBtn.onclick = async () => {
      if (!state.keypair || !activeConversation) { toast("waehle erst einen chat", true); return; }
      try {
        const c = conversations.find((x) => x.id === activeConversation);
        if (!c) return;
        if (c.type !== "dm") {
          toast("Räume sind noch nicht verschlüsselt (2.3) – sie gehen nicht als Datei oder über Funk.", true);
          return;
        }
        const pool = await ensurePool();
        // Alle Umschlaege an den Kontakt, die die Relays haben – auch deine.
        const events = await pool.query({ kinds: [1059], "#p": [c.id], limit: 200 });
        const { exportMeshFile } = await import("../mesh-transfer.js");
        const r = exportMeshFile(events, [state.keypair.pk]);
        toast(r.exportiert === 0
          ? "Keine Umschläge für diesen Kontakt gefunden."
          : `${r.exportiert} verschlüsselte Umschläge als Datei – ohne deinen Schlüssel. Auf einem Gerät mit Netz einlesen.`);
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
        // Nur Umschlaege mit gueltiger Signatur (7.1); Offenes bleibt draussen.
        const { events, abgelehnt } = await importMeshFile(file);
        const pool = await ensurePool();
        let ok = 0;
        for (const ev of events) {
          try {
            await pool.publish(ev);
            ok++;
          } catch { /* duplikat/offline */ }
        }
        toast(`${ok}/${events.length} Umschläge ans Netz gegeben${abgelehnt ? ` – ${abgelehnt} unverschlüsselt abgelehnt` : ""}`);
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
        // Seit 8.9b verschluesselt, der Schluessel steht oeffentlich in der Referenz
        // (Entscheidung 26.09.2026): lesen kann jeder, Speicherknoten halten nur Chiffrat.
        const { uploadAnhang } = await import("../blob-client.js");
        const pool = await ensurePool();
        setGitStatus(`publiziere ${file.name} (${Math.round(bytes.length / 1024)}kb)…`);
        const res = await uploadAnhang(new File([bytes], "", { type: "application/octet-stream" }), pool as never, state.signer!);
        // repo-ref-event (38042)
        const { buildGitRepoRef } = await import("@freedomstack/protocol");
        const ref = buildGitRepoRef(
          { name, blobId: res.blobId, headSha: "local", branch: "main", message: `bundle ${file.name}`, version: Math.floor(Date.now() / 1000), schluessel: res.schluessel },
          state.keypair.pk,
        );
        await pool.publish(await signiere(ref));
        toast(`${name} publiziert (${res.blobId.slice(0, 8)}…)`);
        loadGitRepos();
      } catch (e) {
        toast(`git-fehler: ${(e as Error).message}`, true);
      }
    };
  }
  loadGitRepos();
  void import("./tabs/repos.js").then((m) => m.wireNip34());
  $("#ai-send").onclick = askAi;
  $("#ai-bid").oninput = updateFeePreview;
  $("#wallet-refresh").onclick = loadWallet;
  void wireClientFeeSetting();
  void pruefeFixierungBeimStart();
  void wireMeshTab();
  void wireSpacesTab();
  void wireProfil();
  setzeLogo();
  wireSubtabs();
  wireKommunikation();
  zeigeVerlaeufe();
  document.getElementById("agent-new")?.addEventListener("click", neueAufgabe);
  void aktualisiereNavStatus();
  wireOfflineHinweis();
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
    b.addEventListener("click", () => {
      // Schritt 5 (Tresor) hat keinen eigenen Knopf in den Details
      if (b.dataset.step === "4") { void richteTresorEin().then(() => aktualisiereSicherheitsStand()); return; }
      const ziel = document.getElementById(ziele[b.dataset.step!] ?? "") as HTMLButtonElement | null;
      // Gesperrt (z. B. mit Bunker): sagen, warum – statt still nichts zu tun.
      if (ziel?.disabled) toast(ziel.title, true);
      else ziel?.click();
    });
  });
  setInterval(() => void aktualisiereNavStatus(), 30_000);
  // Posteingang jede Minute – so beantwortet die App Adress-Anfragen fuer Trinkgeld (4.9d), solange sie offen ist.
  setInterval(() => void posteingangAbgleichen(), 60_000);
  void zeigeOnboarding();
  const succSetup = $("#succ-setup");
  if (succSetup) succSetup.onclick = () => void richteNachfolgeEin();
  const succBeat = $("#succ-heartbeat");
  if (succBeat) succBeat.onclick = async () => {
    if (!state.keypair) return;
    const { buildHeartbeat } = await import("@freedomstack/protocol");
    await (await ensurePool()).publish(await signiere(buildHeartbeat(state.keypair.pk)));
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
  wireEingebauteWallet();
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

/** Onboarding: 3-Schritt-Wizard fuer neue Nutzer. */
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
