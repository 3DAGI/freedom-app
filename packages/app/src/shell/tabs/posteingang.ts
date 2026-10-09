/**
 * Posteingang: Umschläge (NIP-17) öffnen und zuordnen – die Kette in
 * `oeffneUmschlag()` –, Verlauf einer Direktnachricht laden, Abgleich des
 * Posteingangs, Direktnachrichten veröffentlichen.
 *
 * Aus tabs/kommunikation.ts verschoben (C-5b) – wörtlich, ohne Logikänderung.
 */
import { NostrEvent, type PrivateDm } from "@freedomstack/protocol";
import { pkShort } from "../../shell-logic.js";
import { aktuellerKurs } from "../marktkurs.js";
import { eigeneRelayListen, ensurePool, frageBeiAutoren, posteingangVon, solRpcUrl, solTransaktion, sprichtFuer, state, veroeffentlicheAn } from "../state.js";
import { alsNachfolge } from "../nachfolge-ui.js";
import { alsPruefauftrag } from "../pruefauftraege-ui.js";
import { type DmZuordnung, GeraeteBuch, ordneDmZu } from "../../geraete-buch.js";
import { mlsAbgleichen, mlsEinladungAnnehmen, mlsGesperrt, mlsVerlauf } from "../mls-konto.js";
import { alsRaumMeldung, merkePrivatenRaum } from "../raum-mls.js";
import { alsRufZusammenfassung } from "../ruf.js";
import { geheim } from "../tresor.js";
import { $, toast } from "../ui.js";
import { t } from "../../i18n.js";
import { kontaktName, zeigeRaumLeiste } from "./raeume.js";
import { alsAnruf } from "../anruf.js";
import { activeConversation, conversations, loadChatList, loadChatMessages, markiereGelesen, saveConversations } from "./kommunikation.js";
import { LivePost, postFilter } from "../../post-live.js";
import { aktualisiereSchluessel, ladeKontakte } from "./kontakte.js";

/** Eine DM zur Anzeige: entschluesselt; legacy = altes Kind-4-Format. */
export type DmAnzeige = NostrEvent & {
  legacy?: boolean; /** Ablauf nach NIP-40 (2.5) – auch fuer den Suchindex (8.13). */ ablauf?: number;
  /** Gesendet, aber die Kopien warten noch (6.4) – nur auf diesem Geraet, bis die eigene Kopie zurueck ist. */ wartet?: boolean;
  /** Geschrieben von einem Geraet (8.6b): Hinweis mit Geraetenamen (Fremddaten). */ geraet?: { text: string; warnung: boolean };
  /** Ueber MLS empfangen (2.2b-d1) – aus dem Verlauf auf diesem Geraet. */ mls?: boolean;
};

/** Vollmachten der Geraete – eigene und die der Kontakte (8.6b). */
// Vollmachten einer Person auch an ihren Schreib-Relays (5.4b); „wer hat dieses Gerät“ (#p) im Pool
export const geraeteBuch = new GeraeteBuch(async (f) =>
  Array.isArray(f.authors) ? frageBeiAutoren(f as { authors: string[] }) : (await ensurePool()).query(f as never));

/** Bereits geoeffnete Umschlaege (ID des Umschlags -> Ergebnis), damit nichts doppelt entschluesselt wird. */
const dmCache = new Map<string, { partner: string; ev: DmAnzeige; dm: PrivateDm } | null>();

async function oeffneUmschlag(w: NostrEvent): Promise<{ partner: string; ev: DmAnzeige; dm: PrivateDm } | null> {
  const bekannt = dmCache.get(w.id);
  if (bekannt !== undefined) return bekannt;
  if (!state.signer) return null;
  const { openPrivateDm } = await import("@freedomstack/protocol");
  const selbst = state.signer.publicKey();
  const ich = sprichtFuer() ?? selbst;
  // Ueber den Signer (Schritt 1.3): Umschlag und Siegel entschluesselt er selbst.
  // Seit 8.6b auch Kopien, die eigene Geraete geschrieben haben; als Geraet (8.6c) fuer die Person.
  const r = await openPrivateDm(w, state.signer, undefined, { auchFuer: [ich, ...(await geraeteBuch.alle(ich).catch(() => []))] });
  const z = r.ok
    ? await ordneDmZu(r.dm, ich, geraeteBuch, (pk) => conversations.some((c) => c.type === "dm" && c.id === pk), selbst)
      .catch((): DmZuordnung => ({ partner: r.dm.partner, autor: r.dm.from, vonMir: r.dm.from === ich }))
    : null;
  const e = r.ok && z
    ? {
        partner: z.partner,
        ev: {
          // Eigene Geraete zeigen als „du“, gueltige Geraete eines Kontakts unter dessen Schluessel
          id: r.dm.id, pubkey: z.autor, created_at: r.dm.createdAt, kind: 14, tags: [], content: r.dm.content, sig: "",
          ...(r.dm.expiresAt !== undefined ? { ablauf: r.dm.expiresAt } : {}),
          ...(z.hinweis ? { geraet: { text: z.hinweis, warnung: !!z.warnung } } : {}),
        },
        // Mit Ablauf (2.5): ladeDmNachrichten() blendet danach aus.
        dm: r.dm,
      }
    // Keine DM: vielleicht ein SOL-Trinkgeld-Beleg (4.7b), eine Adress-Anfrage (4.9d), Nachfolge (8.11b), ein Pruefauftrag (5.6c),
    // eine Raum-Meldung (8.5), die Zusammenfassung eines Kontakts ueber Provider (5.5c), eine Rechnungs-Anfrage (6.3b)
    // oder ein Anruf (B-13d2, erscheint nicht im Chat).
    : (await alsTrinkgeld(w)) ?? (await alsAdressAnfrage(w)) ?? (await alsNachfolge(w)) ?? (await alsPruefauftrag(w)) ?? (await alsRaumMeldung(w)) ?? (await alsRufZusammenfassung(w)) ?? (await alsRechnungsAnfrage(w)) ?? (await alsAnruf(w));
  dmCache.set(w.id, e);
  return e;
}

/**
 * SOL-Trinkgeld-Beleg im Umschlag (Schritt 4.7b): erscheint in der
 * Unterhaltung, zuerst „wird geprueft …“; die Pruefung gegen die Kette laeuft
 * im Hintergrund und zeichnet die offene Unterhaltung danach neu.
 */
async function alsTrinkgeld(w: NostrEvent): Promise<{ partner: string; ev: DmAnzeige; dm: PrivateDm } | null> {
  const { oeffnePrivatesSolTrinkgeld } = await import("@freedomstack/protocol");
  const t = await oeffnePrivatesSolTrinkgeld(w, state.signer!);
  if (!t) return null;
  const { pruefeTrinkgeld, trinkgeldText } = await import("../../trinkgeld-beleg.js");
  const partner = t.absender === state.signer!.publicKey() ? t.empfaenger : t.absender;
  // Beide Kopien (Empfaenger und eigene) tragen dieselbe Signatur: eine Zeile.
  const ev: DmAnzeige = { id: `sol-trinkgeld:${t.signatur}`, pubkey: t.absender, created_at: t.zeit, kind: 9736, tags: [], content: trinkgeldText(t, undefined, aktuellerKurs()), sig: "" };
  void (async () => {
    const { ketteAusRpc } = await import("../../wallet-standard.js");
    const p = await pruefeTrinkgeld(t, ketteAusRpc(await solRpcUrl()), solTransaktion);
    ev.content = trinkgeldText(t, p, aktuellerKurs());
    if (activeConversation === partner) void loadChatMessages(partner);
  })();
  return { partner, ev, dm: { id: ev.id, from: t.absender, partner, createdAt: t.zeit, content: ev.content } };
}

/**
 * Adress-Anfrage fuer ein SOL-Trinkgeld (4.9d): beantworten, wenn sie von einem
 * bekannten Kontakt kommt – mit dessen eigener Adresse aus der eingebauten
 * Wallet. In der Unterhaltung erscheint nichts.
 */
async function alsAdressAnfrage(w: NostrEvent): Promise<null> {
  const [{ beantworteAdressAnfrage }, { frischeEmpfangsadresse }, { ketteAusRpc }] = await Promise.all([
    import("../../trinkgeld-adresse.js"), import("../eingebaute-wallet.js"), import("../../wallet-standard.js"),
  ]);
  await beantworteAdressAnfrage({
    wrap: w, signer: state.signer!, speicher: geheim,
    istKontakt: (pk) => conversations.some((c) => c.type === "dm" && c.id === pk),
    frischeAdresse: frischeEmpfangsadresse,
    kette: ketteAusRpc(await solRpcUrl()),
    sende: veroeffentlicheDm,
  }).catch(() => false);
  return null;
}

/** Bremse fuer Rechnungs-Anfragen (6.3b) – nur im Speicher. */
let rechnungsBremse: import("../../ln-rechnung-anfrage.js").RechnungsBremse | undefined;

/**
 * Rechnungs-Anfrage (6.3b): Ein Kontakt will zahlen, und die eigene
 * Lightning-Adresse steht nicht im Profil – beantworten mit einer Rechnung der
 * eigenen Wallet (NWC), versiegelt. In der Unterhaltung erscheint nichts.
 */
async function alsRechnungsAnfrage(w: NostrEvent): Promise<null> {
  const [{ RechnungsBremse, beantworteRechnungsAnfrage }, { eigeneRechnung }] = await Promise.all([
    import("../../ln-rechnung-anfrage.js"), import("../zahlschienen.js"),
  ]);
  rechnungsBremse ??= new RechnungsBremse();
  await beantworteRechnungsAnfrage({
    wrap: w, signer: state.signer!, bremse: rechnungsBremse,
    istKontakt: (pk) => conversations.some((c) => c.type === "dm" && c.id === pk),
    stelleAus: eigeneRechnung,
    sende: veroeffentlicheDm,
  }).catch(() => false);
  return null;
}

/** Umschlaege, die schon auf eine MLS-Einladung geprueft wurden (je Sitzung einmal). */
const mlsGeprueft = new Set<string>();

/**
 * MLS-Einladung (2.2b-d1) in einem Umschlag, der keine DM ist. Eine
 * 1:1-Gruppe gehoert dann zur Unterhaltung mit dem Partner – der Person,
 * der mit ihren Geraeten alle anderen Mitglieder gehoeren (2.2b-e2; eine
 * neuere ersetzt die alte); von Fremden wird sie – wie eine NIP-17-Nachricht
 * von ihnen – zur „Anfrage“ (seit d2, sonst ginge ihre erste Nachricht
 * verloren). In der Unterhaltung selbst erscheint nichts.
 */
async function alsMlsEinladung(w: NostrEvent): Promise<null> {
  if (mlsGesperrt() || mlsGeprueft.has(w.id)) return null;
  mlsGeprueft.add(w.id);
  const { oeffneEinladung } = await import("../../mls-nostr.js");
  const e = await oeffneEinladung(w, state.signer!).catch(() => null);
  if (!e || e.von === state.keypair?.pk) return null;
  const r = await mlsEinladungAnnehmen(e).catch(() => null);
  if (!r) return null;
  if (!r.partner) {
    // Eine Gruppe zu mehreren: ein privater Raum (2.3b)
    await merkePrivatenRaum(r.gruppe);
    void zeigeRaumLeiste();
    toast(t("komm.einladungRaum", { name: kontaktName(e.von) }));
    return null;
  }
  let c = conversations.find((x) => x.type === "dm" && x.id === r.partner);
  if (!c) {
    c = { id: r.partner, type: "dm", name: t("komm.anfrage", { pk: pkShort(r.partner) }), lastTs: Math.floor(Date.now() / 1000) };
    conversations.push(c);
  }
  c.mls = r.gruppe;
  saveConversations();
  loadChatList();
  return null;
}

/**
 * Alle Nachrichten einer 1:1-Unterhaltung: NIP-17-Umschlaege an mich (auch
 * meine eigenen Kopien) plus aeltere Kind-4-Nachrichten, die weiter lesbar
 * bleiben, aber nie mehr gesendet werden.
 */
export const entschluesselungFehlgeschlagen = () => t("komm.entschluesselungFehlgeschlagen");

export async function ladeDmNachrichten(partner: string): Promise<DmAnzeige[]> {
  if (!state.keypair) return [];
  const me = state.keypair;
  const pool = await ensurePool();
  const [umschlaege, alt] = await Promise.all([
    pool.query({ kinds: [1059], "#p": [me.pk], limit: 500 }),
    pool.query({ kinds: [4], authors: [me.pk, partner], limit: 50 }),
  ]);
  const ergebnis = new Map<string, DmAnzeige>();
  const { dmAbgelaufen } = await import("@freedomstack/protocol");
  for (const w of umschlaege) {
    const e = await oeffneUmschlag(w);
    // Abgelaufene Nachrichten (NIP-40) zeigt die App nicht mehr – auch wenn ein Relay sie noch hat.
    if (e && e.partner === partner && !dmAbgelaufen(e.dm)) ergebnis.set(e.ev.id, e.ev);
  }
  // MLS (2.2b-d1): aus dem Verlauf auf diesem Geraet – nur von uns beiden. Seit
  // 2.2b-e2 auch von Geraeten: zugeordnet wie NIP-17-Kopien (Vollmacht, Entzug)
  const gruppe = conversations.find((c) => c.type === "dm" && c.id === partner)?.mls;
  const ich = sprichtFuer() ?? me.pk;
  const istKontakt = (pk: string) => conversations.some((c) => c.type === "dm" && c.id === pk);
  for (const n of gruppe ? await mlsVerlauf(gruppe).catch(() => []) : []) {
    const dm = { id: n.id, from: n.von, partner, createdAt: n.zeit, content: n.text };
    const z = await ordneDmZu(dm, ich, geraeteBuch, istKontakt, me.pk).catch(() => null);
    if (!z || z.partner !== partner) continue;
    ergebnis.set(`mls:${n.id}`, {
      id: `mls:${n.id}`, pubkey: z.autor, created_at: n.zeit, kind: 445, tags: [], content: n.text, sig: "", mls: true,
      ...(z.hinweis ? { geraet: { text: z.hinweis, warnung: !!z.warnung } } : {}),
    });
  }
  for (const ev of alt) {
    // Nur Nachrichten zwischen genau uns beiden – nicht die des Partners an Dritte.
    const pTag = ev.tags.find((t) => t[0] === "p")?.[1];
    const betrifft = (ev.pubkey === me.pk && pTag === partner) || (ev.pubkey === partner && pTag === me.pk);
    if (!betrifft || ergebnis.has(ev.id)) continue;
    let text: string;
    try {
      text = await state.signer!.nip44Decrypt(ev.pubkey === me.pk ? partner : ev.pubkey, ev.content);
    } catch {
      text = entschluesselungFehlgeschlagen();
    }
    ergebnis.set(ev.id, { ...ev, content: text, legacy: true });
  }
  return [...ergebnis.values()];
}

/**
 * Umschlag nur an den Posteingang des Empfaengers (Kind 10050, NIP-17) –
 * seit 5.4 nicht mehr zusaetzlich an alle eigenen Relays: Jedes weitere Relay
 * saehe nur, wann dieser Schluessel Post bekommt. Ohne Liste oder wenn kein
 * Posteingang annimmt: an die eigenen Relays.
 */
export async function veroeffentlicheDm(wrap: NostrEvent, empfaenger: string): Promise<void> {
  const ziele = await posteingangVon(empfaenger);
  const pool = await ensurePool();
  if (ziele.length > 0 && (await veroeffentlicheAn(wrap, ziele)) > 0) return;
  await pool.publish(wrap);
}

let letzterDmAbgleich = 0;

/**
 * Posteingang abgleichen: Neue Absender erscheinen als „Anfrage“ in der Liste,
 * und die eigenen Posteingangs-Relays werden einmal als Kind 10050
 * veroeffentlicht. Hoechstens einmal pro Minute.
 */
/** Posteingang abgleichen – auch regelmaessig im Hintergrund (4.9d: Adress-Anfragen beantworten). */
export function posteingangAbgleichen(): Promise<void> {
  return syncDmInbox();
}

export async function syncDmInbox(): Promise<void> {
  if (!state.keypair || Date.now() - letzterDmAbgleich < 60_000) return;
  letzterDmAbgleich = Date.now();
  try {
    const me = state.keypair;
    const pool = await ensurePool();
    // Eigener Relay-Satz (5.4a): NIP-65-Liste und Posteingang einmal je Sitzung abgleichen
    await eigeneRelayListen().catch(() => { /* offline – beim naechsten Abgleich wieder */ });
    // Kontakte von anderen Geraeten (2.5b, nur wenn eingeschaltet)
    let neu = await ladeKontakte().catch(() => 0);
    const umschlaege = await pool.query({ kinds: [1059], "#p": [me.pk], limit: 200 });
    for (const w of umschlaege) if ((await ordneEin(w, me.pk)).neu) neu++;
    // MLS-Gruppen (2.2b-d1): nur wenn es welche gibt – sonst bleibt die Engine ungeladen
    const mitMls = conversations.filter((c) => c.type === "dm" && c.mls);
    if (mitMls.length > 0 && !mlsGesperrt()) {
      const zahlen = await mlsAbgleichen(mitMls.map((c) => c.mls!)).catch(() => new Map<string, number>());
      for (const c of mitMls) if ((zahlen.get(c.mls!) ?? 0) > 0) {
        c.lastTs = Math.max(c.lastTs ?? 0, Math.floor(Date.now() / 1000));
        // Eigene MLS-Nachrichten entschlüsselt MLS nicht zurück – was kommt, ist vom Gegenüber (C-30)
        c.eingang = c.lastTs;
        neu++;
        if (activeConversation === c.id) void loadChatMessages(c.id);
      }
    }
    if (neu > 0) {
      // Was gerade vor Augen ist, gilt als gelesen (C-30)
      markiereGelesen();
      saveConversations();
      loadChatList();
    }
    await aktualisiereSchluessel();
  } catch {
    /* offline */
  }
  // Erst nach einem Abgleich (A-15a): Was schon lag, ist dann geöffnet – das Abo bringt nur Neues
  void lauscheAufPost();
}

/** Ein Umschlag aus dem Abgleich oder dem Abo (A-15a): öffnen und der Liste zuordnen. */
async function ordneEin(w: NostrEvent, me: string): Promise<{ neu: boolean; spaeter: boolean; frischVon?: string }> {
  const frisch = !dmCache.has(w.id);
  const e = await oeffneUmschlag(w);
  // Keine DM: vielleicht eine MLS-Einladung eines Kontakts (2.2b-d1)
  if (!e) await alsMlsEinladung(w);
  if (!e || e.partner === me || e.partner === state.person) return { neu: false, spaeter: false };
  const frischVon = frisch ? { frischVon: e.partner } : {};
  // Ungelesen (C-30): nur, was das Gegenüber schrieb – eigene Kopien zeigen als „ich“ (ordneDmZu)
  const vomGegenueber = e.ev.pubkey !== (sprichtFuer() ?? me);
  const vorhanden = conversations.find((x) => x.id === e.partner);
  if (!vorhanden) {
    conversations.push({ id: e.partner, type: "dm", name: t("komm.anfrage", { pk: pkShort(e.partner) }), lastTs: e.ev.created_at,
      gelesen: 0, ...(vomGegenueber ? { eingang: e.ev.created_at } : {}) });
    return { neu: true, spaeter: false, ...frischVon };
  }
  const spaeter = e.ev.created_at > (vorhanden.lastTs ?? 0);
  if (spaeter) vorhanden.lastTs = e.ev.created_at;
  // Neues vom Gegenüber ändert den Lesestand (C-30) – auch, wenn es nicht die späteste Nachricht ist
  const eingang = vomGegenueber && e.ev.created_at > (vorhanden.eingang ?? 0);
  if (eingang) vorhanden.eingang = e.ev.created_at;
  return { neu: eingang, spaeter, ...frischVon };
}

let postAbo: { fuer: string; stopp?: () => void } | null = null;
const livePost = new LivePost();

/**
 * Post sofort (A-15a, Befund C-12): solange die App offen ist, ein Abo an den eigenen Schlüssel – was dort neu
 * ankommt, öffnet die App gleich (`post-live.ts`: keine Anrufe, je Umschlag einmal, Grenze je Minute). Gestartet
 * am Ende jedes Abgleichs; läuft es schon für diesen Schlüssel, bleibt es.
 */
export async function lauscheAufPost(): Promise<void> {
  const ich = state.keypair?.pk;
  if (!ich || postAbo?.fuer === ich) return;
  postAbo?.stopp?.();
  const abo: { fuer: string; stopp?: () => void } = { fuer: ich };
  postAbo = abo;
  const pool = await ensurePool();
  const stopp = await pool.subscribe(postFilter(ich), (w) => {
    if (livePost.nimm(w, (id) => dmCache.has(id))) void nimmLivePost(w, ich);
  }).catch(() => null);
  if (postAbo !== abo) stopp?.();
  else if (stopp) abo.stopp = stopp;
  else postAbo = null; // der nächste Abgleich versucht es neu
}

async function nimmLivePost(w: NostrEvent, ich: string): Promise<void> {
  if (state.keypair?.pk !== ich) return;
  const r = await ordneEin(w, ich).catch(() => null);
  if (!r) return;
  if (r.neu || r.spaeter) {
    // Was gerade vor Augen ist, gilt als gelesen (C-30)
    markiereGelesen();
    saveConversations();
    loadChatList();
  }
  if (r.frischVon && r.frischVon === activeConversation) void loadChatMessages(r.frischVon);
}
