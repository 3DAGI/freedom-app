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
import { LANGS, Lang, detectLang, gespeicherteSprache, getLang, setLang, t } from "../i18n.js";
import { fehlerText } from "../protokoll-texte.js";
import { pkShort } from "../shell-logic.js";
import { nimmBunkerAuf, wireBunkerKarte } from "./bunker.js";
import { wireMeinKnoten } from "./mein-knoten.js";
import { wireKnotenHalten } from "./knoten-halten-ui.js";
import { wireKnotenWeg } from "./knoten-weg-ui.js";
import { wireKnotenStatus } from "./knoten-status-ui.js";
import { wireWecken } from "./wecken-ui.js";
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
import { haltevorModell, kuendigeModellAn, veroeffentlicheKatalog, zeigeKataloge, zeigeModelle } from "./tabs/agent-netz.js";
import { starteStreitfall } from "./streitfall-ui.js";
import {
  askAi,
  neueAufgabe,
  refreshModelDropdown,
  setupAttach,
  setupEmptyState,
  setupFunkAntworten,
  setupKonsens,
  setupModelPicker,
  setupToolChips,
  updateBudgetBar,
  updateFeePreview,
  updateTokenEstimate,
  zeigeVerlaeufe,
} from "./tabs/agent.js";
import { wireFunkGateway } from "./funk-gateway-ui.js";
import { dialog } from "./dialog.js";
import { wireEigeneAdresse, wireWerbeName } from "./werben-ui.js";
import { wireBelege } from "./belege-ui.js";
import { wireSprachnachricht } from "./sprachnachricht-ui.js";
import { wireAnrufe } from "./anruf-ui.js";
import {
  captureReferral,
  ladeAbdeckung,
  loadEarnings,
  loadTrust,
  publishReferralClaim,
  setupReferral,
  updateReferralLink,
  zeigeMitwirkende,
} from "./tabs/earn.js";
import {
  activeConversation,
  conversations,
  loadChatList,
  loadChatMessages,
  newDm,
  sendChatMessage,
  setzeAblauf,
  wireKommunikation,
} from "./tabs/kommunikation.js";
import { handleChatFiles } from "./tabs/chat-anhaenge.js";
import { posteingangAbgleichen } from "./tabs/posteingang.js";
import { wireSpacesTab, zeigeRaumLeiste } from "./tabs/raeume.js";
import { vergebeAbzeichen, wireProfil, zeigeAbzeichen, zeigeProfilTexte, zeigeProfilVorschau } from "./tabs/profil.js";
import {
  aktualisiereSicherheitsStand,
  exportiereApp,
  pruefeEigeneEchtheit,
  pruefeFixierungBeimStart,
  richteNachfolgeEin,
  wireGebuehrenKarte,
  zeigeNachfolge,
} from "./tabs/settings.js";
import { wireSicherheitsKnoepfe, zeigeGeraete, zeigeSicherung } from "./tabs/sicherung.js";
import { wireMeshTab, zeigeMeshWeg } from "./tabs/mesh.js";
import {
  connectNwc,
  connectSolana,
  disconnectNwc,
  wireNwcRelays,
  loadWallet,
  nwc,
} from "./tabs/waehrung.js";
import { claimActiveSwap, exportSwapBackup } from "./tabs/tausch.js";
import { geldVorgangLaeuft, refundDeposit, startDeposit } from "./tabs/hinterlegen.js";
import { oeffneZahlkanal, zeigeKanaele } from "./zahlkanal-ui.js";
import { wireVerdienst, zeigeSolEinnahmen } from "./verdienst-ui.js";
import { seiteGezeigt, startSeite, wireNavigation } from "./navigation.js";
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
  el,
  zeigeIdent,
  refreshQuota,
  setzeLogo,
  toast,
  updateSidebarBalances,
  wireOfflineHinweis,
} from "./ui.js";
import { abrufTakt, starteVerkehr } from "./versand.js";

// ------------------------------------------------------------- Identitaet

function loadOrCreateIdentity(): void {
  // Anmeldung per Bunker (1.3f) geht vor – dann liegt kein Schluessel in der App.
  if (nimmBunkerAuf()) {
    zeigeIdent();
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
  zeigeIdent();
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
  zeigeIdent();
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

  const woerter = mnemonic.split(" ");
  const positionen = pickChallengePositions(woerter.length, 3);

  // Als DOM (Rahmen seit C-6e, Wörter und Abfragefelder seit C-6b): die Merkphrase nur als Text
  const KLEIN = "width:auto;padding:6px 10px"; // kein UI-Text
  const knopf = (id: string, text: string, klasse: string, stil: string): HTMLButtonElement => {
    const b = el("button", text, klasse);
    b.id = id;
    b.style.cssText = stil;
    return b;
  };
  const liste = el("ol", undefined, "mnemonic-list");
  liste.append(...woerter.map((w) => el("li", w)));
  const ablage = el("div");
  ablage.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin:8px 0"; // kein UI-Text
  ablage.append(knopf("bk-copy", t("ein.kopieren"), "ghost", KLEIN), knopf("bk-file", t("ein.alsDatei"), "ghost", KLEIN));
  const abfrage = el("div");
  abfrage.id = "bk-challenge";
  abfrage.style.cssText = "display:flex;gap:6px;flex-wrap:wrap"; // kein UI-Text
  abfrage.append(...positionen.map((p) => {
    const feld = el("input", undefined, "mono-sm");
    feld.dataset.pos = String(p);
    feld.style.width = "110px";
    feld.autocomplete = "off";
    const label = el("label", undefined, "mono-sm");
    label.append(`${t("ein.nummer", { n: p + 1 })} `, feld);
    return label;
  }));
  const fehler = el("div", undefined, "mono-sm");
  fehler.id = "bk-error";
  fehler.classList.add("err");
  const bisBestaetigt = el("p", t("ein.bisBestaetigt"), "mono-sm");
  bisBestaetigt.classList.add("muted");
  const modal = el("div", undefined, "modal");
  modal.append(
    el("h3", t("ein.phraseTitel")), el("p", t("ein.phraseText"), "mono-sm"), liste, ablage,
    el("p", t("ein.zurBestaetigung"), "mono-sm"), abfrage, fehler,
    knopf("bk-done", t("ein.bestaetigen"), "send-btn", "margin-top:8px"),
    knopf("bk-later", t("ein.spaeterBestaetigen"), "ghost", `${KLEIN};margin-top:8px`),
    bisBestaetigt,
  );
  const box = el("div", undefined, "modal-backdrop");
  box.append(modal);
  document.body.appendChild(box);

  return new Promise<void>((resolve) => {
    box.querySelector("#bk-copy")!.addEventListener("click", () => {
      void navigator.clipboard.writeText(mnemonic).then(() => toast(t("ein.phraseKopiert")));
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
        box.querySelector("#bk-error")!.textContent = t("ein.falschesWort", { n: r.wrong.map((p) => p + 1).join(", ") });
        return;
      }
      markBackupConfirmed();
      // Bestaetigt: Die Woerter gehoeren jetzt nur noch auf das Papier (8.1a)
      void geheim.removeItem(LS_MERKPHRASE);
      box.remove();
      toast(t("ein.identitaetGesichert"));
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
    const warn = $("#backup-warn");
    if (!warn) return;
    if (st.warning && localStorage.getItem("freedom.usedOnce") === "1" && !leisteZeigtSichern) {
      const knopf = el("button", t("set.jetztSichern"), "ghost");
      knopf.id = "bk-now";
      knopf.style.cssText = "width:auto;padding:4px 8px";
      knopf.addEventListener("click", () => void sichereJetzt());
      warn.replaceChildren(`⚠ ${st.warning} `, knopf);
      warn.classList.remove("hidden");
    } else {
      warn.classList.add("hidden");
    }
  } catch { /* Anzeige ist optional */ }
}

const NUR_IM_SIGNER = "ein.nurImSigner";

/** Nachtraegliche Sicherung — auch fuer Identitaeten ohne Phrase. */
async function sichereJetzt(): Promise<void> {
  if (!state.keypair) return;
  if (mitBunker()) { toast(t(NUR_IM_SIGNER), true); return; }
  // Noch nicht bestaetigte Merkphrase (8.1a): erneut zeigen und abfragen
  const merkphrase = geheim.getItem(LS_MERKPHRASE);
  if (merkphrase) {
    await zeigeSicherungsDialog(merkphrase);
    return;
  }
  const { identityFromHex, buildBackupFile, markBackupConfirmed } = await import("../identity.js");
  const id = identityFromHex(mitRohemSchluessel(t("ein.fuerSicherungsdatei"), toHex));
  const blob = new Blob([buildBackupFile(id)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "freedomstack-identity.json";
  a.click();
  URL.revokeObjectURL(url);
  markBackupConfirmed();
  void zeigeBackupWarnung();
  toast(t("ein.dateiGeladen"));
}

function exportIdentity(): void {
  if (!state.keypair) return;
  if (mitBunker()) { toast(t(NUR_IM_SIGNER), true); return; }
  const hex = mitRohemSchluessel(t("ein.fuerExport"), toHex);
  navigator.clipboard?.writeText(hex).then(
    () => toast(t("ein.nsecKopiert")),
    () => toast(hex),
  );
}

async function importIdentity(): Promise<void> {
  if (mitBunker()) { toast(t("ein.erstAbmelden"), true); return; }
  // Dialog mit Feld zum Einfuegen und, wo der Browser es kann, Scannen per Kamera (11.1b)
  const w = await dialog({
    titel: t("ein.importTitel"), ok: t("ein.importOk"),
    felder: [{ art: "textarea", name: "eingabe", label: t("ein.importFrage"), pflicht: true, mono: true, scannen: true }],
  });
  if (!w) return;
  const eingabe = String(w.eingabe);
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
      toast(fehlerText(e), true);
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
  void speichereSchluessel(hex.toLowerCase()).catch((e) => toast(t("ein.nichtGespeichert", { fehler: fehlerText(e) }), true));
  zeigeIdent();
  toast(state.person ? t("ein.alsGeraet", { person: pkShort(state.person) }) : t("ein.importiert"));
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
    // Seit C.5b als DOM; auf dem Handy nur Titel und Knöpfe – den Text klappt „mehr“ auf
    const knopf = (id: string, text: string) => {
      const b = document.createElement("button");
      b.id = id;
      b.type = "button";
      b.className = "ghost";
      b.textContent = text;
      return b;
    };
    const titel = document.createElement("span");
    titel.className = "ob-title";
    titel.textContent = schritt.title;
    const text = document.createElement("span");
    text.className = "ob-body";
    text.id = "ob-body";
    text.textContent = schritt.body;
    const mehr = knopf("ob-mehr", t("ein.obMehr"));
    mehr.setAttribute("aria-controls", "ob-body");
    mehr.setAttribute("aria-expanded", "false");
    mehr.addEventListener("click", () => {
      const auf = bar.classList.toggle("ob-offen");
      mehr.setAttribute("aria-expanded", String(auf));
      mehr.textContent = t(auf ? "ein.obWeniger" : "ein.obMehr");
    });
    bar.replaceChildren(titel, text, mehr,
      ...(schritt.action ? [knopf("ob-action", schritt.action)] : []),
      ...(schritt.skippable ? [knopf("ob-skip", t("ein.spaeter"))] : []));

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
  if (name === "profile") { void zeigeAbzeichen(); void zeigeProfilVorschau(); zeigeProfilTexte(); }
  if (name === "settings") { void zeigeSicherung(); void zeigeGeraete(); void zeigeDatenschutz(); void aktualisiereSicherheitsStand(); }
  // Verlauf und Budget neu zeichnen – so folgen sie auch einem Sprachwechsel (8.16d1)
  if (name === "ai") { zeigeVerlaeufe(); updateBudgetBar(); void refreshModelDropdown(); void refreshQuota(); }
  if (name === "wallet") { loadWallet(); void zeigeKanaele(); }
  if (name === "earn") { loadEarnings(); loadTrust(); updateReferralLink(); void zeigeSolEinnahmen(); }
  // Karte und Mesh stehen seit C.1b auf der Seite „Netz“
  if (name === "netz") { void ladeAbdeckung(); void zeigeMeshWeg(); }
  // Repos (C.3a): beim Öffnen frisch laden – Ankündigungen, Bundles, Patches
  if (name === "repos") void import("./tabs/repos.js").then((m) => m.ladeNip34Repos({ privat: true }));
  if (name === "mehr") void aktualisiereNavStatus();
  updateSidebarBalances();
  // Adresse (nur die Seite, nie eine Kennung) und „Mehr“ nachziehen (C.1a)
  seiteGezeigt(name);
}

// ------------------------------------------------------------- Init (v0.2)

/** Wendet die aktuelle Sprache auf alle [data-i18n]/[data-i18n-ph]/[data-i18n-title]/[data-i18n-aria] an. */
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
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.setAttribute("title", t(el.getAttribute("data-i18n-title")!));
  });
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria")!));
  });
}

function setupLangMenu(): void {
  // Zwei Umschalter: Landing (#lang-btn) + App-Sidebar (#lang-btn-app).
  // Beide teilen dasselbe Menü-Verhalten; nur Deutsch und Englisch (8.16).
  const pairs: Array<{ btnId: string; menuId: string }> = [
    { btnId: "#lang-btn", menuId: "#lang-menu" },
    { btnId: "#lang-btn-app", menuId: "#lang-menu-app" },
    { btnId: "#lang-btn-mehr", menuId: "#lang-menu-mehr" },
  ];
  const renderMenu = (menu: HTMLElement): void => {
    // Knöpfe der Sprachen als DOM (C-6b)
    menu.replaceChildren(...LANGS.map((l) => {
      const b = el("button", `${l.code.toUpperCase()} · ${l.label}`, l.code === getLang() ? "active" : undefined);
      b.type = "button";
      b.dataset.lang = l.code;
      return b;
    }));
    menu.querySelectorAll("button[data-lang]").forEach((b) => {
      b.addEventListener("click", () => {
        const code = (b as HTMLElement).dataset.lang as Lang;
        setLang(code);
        localStorage.setItem("freedom.lang", code);
        document.documentElement.lang = code;
        applyI18n();
        // Was der Code zeichnet (Listen, Hinweise), folgt beim Neuzeichnen des offenen Tabs (8.16b)
        const offen = document.querySelector<HTMLElement>(".app-nav button.active")?.dataset.tab;
        if (offen) switchTab(offen);
        void zeigeOnboarding();
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

/** Landing -> App (das Wallet-Gate ist seit 8.16a entfernt – es wurde nie gezeigt). */
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
    // Mit der Seite aus der Adresse, sonst dem Agenten (C.1a)
    switchTab(startSeite());
    // Modell-Katalog + Quota laden (async, sobald provider-discovery fertig)
    void refreshModelDropdown().then(() => refreshQuota());
  };
  return enter;
}

/** Prueft ob ?provider= in der URL steht und setzt ihn als einzigen erlaubten. */
function checkOwnProvider(): void {
  const pk = getOwnProviderFromUrl();
  if (pk) {
    setOwnProvider(pk);
    console.log(`[provider] Eigener Provider gesetzt: ${pkShort(pk)}`);
    toast(t("ein.eigenerProvider", { pk: pkShort(pk) }));
  }
}

/**
 * Einstieg. Gibt es einen Tresor (Schritt 1.2), wird zuerst entsperrt – erst
 * danach ist der Schluessel da und die App startet wie bisher.
 */
export function boot(): void {
  // Sprache (8.16) zuerst: Entsperr-Dialog und Meldung nach einer Notfall-Loeschung
  // kommen vor starte() – gespeicherte Wahl, wenn es sie noch gibt, sonst die des Browsers
  setLang(gespeicherteSprache(localStorage.getItem("freedom.lang")) ?? detectLang());
  document.documentElement.lang = getLang();
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
  import("../icons.js").then(({ iconEl }) => {
    document.querySelectorAll<HTMLElement>("[data-icon]").forEach((x) => {
      x.replaceChildren(iconEl(x.dataset.icon!));
    });
  });
  // Sprache (8.16): in boot() gesetzt – hier Knöpfe und Texte der Seite
  const langCode = getLang().toUpperCase();
  ($("#lang-btn") as HTMLButtonElement).textContent = `${langCode} ▾`;
  const appLangBtn = $("#lang-btn-app") as HTMLButtonElement | null;
  if (appLangBtn) appLangBtn.textContent = `${langCode} ▾`;
  const mehrLangBtn = $("#lang-btn-mehr") as HTMLButtonElement | null;
  if (mehrLangBtn) mehrLangBtn.textContent = `${langCode} ▾`;
  applyI18n();
  setupLangMenu();
  // Kein Gate mehr → Identity beim Boot laden/erzeugen (früher gate-button)
  loadOrCreateIdentity();
  // Tresor: automatische Sperre, aber nie mitten in einen Geldvorgang oder Auftrag;
  // ebenso kein Wechsel der Identitaet (Bunker)
  const beschaeftigt = (): boolean => geldVorgangLaeuft() || $("#ai-send")?.dataset.running === "1";
  starteAutoSperre(beschaeftigt);
  wireBunkerKarte(beschaeftigt);
  wireMeinKnoten();
  wireKnotenHalten();
  wireKnotenWeg();
  wireKnotenStatus();
  wireWecken();
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
  // Kopfzeile mobil, „Mehr“, Zurück und die Unterseiten des Agenten (C.1a)
  wireNavigation((seite) => switchTab(seite));
  // Sidebar-Balances: ident + import klonen die header-handler (desktop)
  const nbIdent = $("#nb-ident");
  const nbImport = $("#nb-import");
  if (nbIdent) {
    nbIdent.onclick = exportIdentity;
    // Auch per Tastatur (C-4): die Identität ist ein Knopf, kein bloßer Text
    nbIdent.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void exportIdentity(); }
    });
  }
  if (nbImport) nbImport.onclick = importIdentity;
  // Wallet-Button in der Sidebar: springt zum Wallet-Tab (verbinden/deposit)
  const nbWallet = $("#nb-wallet");
  if (nbWallet) {
    nbWallet.onclick = () => switchTab("wallet");
    // Bereits verbunden? → Button zeigt "deposit" und öffnet trotzdem wallet-tab
    if (localStorage.getItem("freedom.sol.pubkey") || localStorage.getItem("freedom.sol.balance")) {
      nbWallet.dataset.i18n = "waehr.solDeposit";
      nbWallet.textContent = t("waehr.solDeposit");
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
  // Sprachnachrichten (C-7): Mikrofon erst auf Klick, die Aufnahme wird ein Anhang wie oben
  wireSprachnachricht();
  // Anrufe (B-13d3): nur auf Klick; eingehende kommen über den Posteingang (alsAnruf)
  wireAnrufe();
  // Ablauf neuer Nachrichten je Unterhaltung (NIP-40, Schritt 2.5)
  const ablaufSel = document.getElementById("chat-ablauf") as HTMLSelectElement | null;
  if (ablaufSel) ablaufSel.onchange = () => setzeAblauf(ablaufSel.value);
  // NEU: Zap-Button neben Eingabefeld
  const zapBtn = $("#chat-zap");
  if (zapBtn) {
    zapBtn.onclick = async () => {
      if (!activeConversation) {
        toast(t("ein.erstChat"), true);
        return;
      }
      const c = conversations.find((x) => x.id === activeConversation);
      if (!c || c.type !== "dm") {
        toast(t("ein.zapsNur11"), true);
        return;
      }
      const { openZapDialog } = await import("../chat-zap.js");
      openZapDialog(c.id, c.name);
    };
  }
  // Kontakt prüfen (B-4): Sicherheitscode vergleichen – nur in 1:1-Unterhaltungen
  const pruefBtn = $("#chat-pruefen");
  if (pruefBtn) {
    pruefBtn.onclick = async () => {
      const c = conversations.find((x) => x.id === activeConversation);
      if (!c || c.type !== "dm") return toast(t("komm.pruefNur11"), true);
      const { pruefeKontakt } = await import("./kontakt-pruefen-ui.js");
      await pruefeKontakt(c.id, c.name);
    };
  }
  // Mesh-Transfer (USB/offline): Post fuer einen Kontakt mitnehmen / Datei einlesen.
  // Seit 7.1 nur Umschlaege – ohne eigenen Schluessel, ohne Klartext.
  const meshExportBtn = $("#chat-mesh-export");
  const meshImportBtn = $("#chat-mesh-import");
  const meshFileInput = $("#chat-mesh-file") as HTMLInputElement | null;
  if (meshExportBtn) {
    meshExportBtn.onclick = async () => {
      if (!state.keypair || !activeConversation) { toast(t("ein.erstChat"), true); return; }
      try {
        const c = conversations.find((x) => x.id === activeConversation);
        if (!c) return;
        if (c.type !== "dm") {
          toast(t("ein.raeumeNichtMesh"), true);
          return;
        }
        const pool = await ensurePool();
        // Alle Umschlaege an den Kontakt, die die Relays haben – auch deine.
        const events = await pool.query({ kinds: [1059], "#p": [c.id], limit: 200 });
        const { exportMeshFile } = await import("../mesh-transfer.js");
        const r = exportMeshFile(events, [state.keypair.pk]);
        toast(r.exportiert === 0 ? t("ein.keineUmschlaege") : t("ein.umschlaegeExportiert", { n: r.exportiert }));
      } catch (e) {
        toast(t("ein.exportFehler", { fehler: fehlerText(e) }), true);
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
        toast(t("ein.umschlaegeImportiert", { ok, n: events.length }) + (abgelehnt ? t("ein.unverschluesseltAbgelehnt", { n: abgelehnt }) : ""));
        if (activeConversation) loadChatMessages(activeConversation);
      } catch (e) {
        toast(t("ein.importFehler", { fehler: fehlerText(e) }), true);
      }
    };
  }
  // Reward-Claim
  // Repos: Liste, Repo-Seite und Bundle hochladen seit C.3a2 in tabs/repos.ts
  void import("./tabs/repos.js").then((m) => m.wireNip34());
  $("#ai-send").onclick = askAi;
  $("#ai-bid").oninput = updateFeePreview;
  $("#wallet-refresh").onclick = loadWallet;
  void wireGebuehrenKarte();
  void pruefeFixierungBeimStart();
  void wireMeshTab();
  // KI über Funk (7.4c3): Gateway wählen, „über Funk“ im Agenten
  wireFunkGateway();
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
      toast(t("ein.pubkeyKopiert"));
    } catch {
      // Ohne Zwischenablage zum Markieren im Dialog (C-1e, statt prompt())
      await dialog({ titel: t("ein.pubkeyTitel"), felder: [{ art: "nurlesen", name: "pk", label: t("ein.pubkey"), wert: state.keypair.pk }], ok: t("dlg.schliessen"), abbrechen: false });
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
  // Nur der Stand im Speicher, kein Netz (C-16): oft genug, dass „verbunden“ der Lage folgt
  setInterval(() => void aktualisiereNavStatus(), 5_000);
  // Posteingang etwa jede Minute (jeder zweite Schlag des Abruftakts, 6.4: mit Zufall, gebuendelt) –
  // so beantwortet die App Adress-Anfragen fuer Trinkgeld (4.9d), solange sie offen ist.
  abrufTakt.melde("posteingang", posteingangAbgleichen, 2);
  starteVerkehr();
  // Zahlkanal-Quittungen mit der Kette auf „belegt“ heben (5.5b) – etwa alle zehn Minuten
  abrufTakt.melde("quittungen", () => import("./quittungen.js").then((q) => q.hebeKanalQuittungen()), 20);
  // Zusammenfassung an Kontakte (5.5c) – nur mit Zustimmung, je Schlag höchstens ein Umschlag
  abrufTakt.melde("ruf", () => import("./ruf.js").then((r) => r.rufTakt()), 1);
  void zeigeOnboarding();
  const succSetup = $("#succ-setup");
  if (succSetup) succSetup.onclick = () => void richteNachfolgeEin();
  const succBeat = $("#succ-heartbeat");
  if (succBeat) succBeat.onclick = async () => {
    if (!state.keypair) return;
    const { buildHeartbeat } = await import("@freedomstack/protocol");
    await (await ensurePool()).publish(await signiere(buildHeartbeat(state.keypair.pk)));
    toast(t("ein.lebenszeichenGesendet"));
    void zeigeNachfolge();
  };
  const modelsRefresh = $("#models-refresh");
  if (modelsRefresh) modelsRefresh.onclick = () => void zeigeModelle();
  const modelsSeed = $("#models-seed");
  if (modelsSeed) modelsSeed.onclick = () => void haltevorModell();
  const modelsPub = $("#models-publish");
  if (modelsPub) modelsPub.onclick = () => void kuendigeModellAn();
  // Modellkataloge (5.7): danach das Dropdown neu ordnen – abonnierte zuerst.
  const katRefresh = $("#kataloge-refresh");
  if (katRefresh) katRefresh.onclick = () => void zeigeKataloge().then(() => refreshModelDropdown());
  const katPub = $("#katalog-publish");
  if (katPub) katPub.onclick = () => void veroeffentlicheKatalog();
  const badgeCreate = $("#badge-create");
  if (badgeCreate) badgeCreate.onclick = () => void vergebeAbzeichen();
  void zeigeNachfolge();
  void zeigeModelle();
  void zeigeKataloge().then(() => refreshModelDropdown());
  starteStreitfall();
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
  wireVerdienst(loadEarnings);
  $("#sol-connect").onclick = () => void connectSolana();
  wireEingebauteWallet();
  // NWC: Lightning ohne Browser-Extension — der einzige Weg, der auf iOS geht.
  const nwcConnectBtn = $("#nwc-connect");
  if (nwcConnectBtn) nwcConnectBtn.onclick = () => void connectNwc();
  const nwcDisconnectBtn = $("#nwc-disconnect");
  if (nwcDisconnectBtn) nwcDisconnectBtn.onclick = disconnectNwc;
  wireNwcRelays();
  $("#dep-start").onclick = startDeposit;
  $("#dep-refund").onclick = refundDeposit;
  $("#kanal-start").onclick = () => void oeffneZahlkanal();
  $("#chat-new-dm").onclick = () => void newDm();
  setupAttach();
  setupToolChips();
  setupModelPicker();
  // Vergleich über mehrere Provider nur bei free, classic, pro (A-7)
  setupKonsens();
  setupEmptyState();
  // Antworten auf KI-Anfragen über Funk (7.4c2)
  setupFunkAntworten();
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
  wireEigeneAdresse();
  wireWerbeName();
  wireBelege();
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
    if (!last) { toast(t("ein.keineAntwort"), true); return; }
    await navigator.clipboard.writeText(bubbleText(last));
    toast(t("ein.antwortKopiert"));
  });
  copyAll?.addEventListener("click", async () => {
    const bubbles = getBubbles();
    if (bubbles.length === 0) { toast(t("ein.keineKonversation"), true); return; }
    const text = bubbles.map(bubbleText).join("\n\n");
    await navigator.clipboard.writeText(text);
    toast(t("ein.konversationKopiert"));
  });
}
