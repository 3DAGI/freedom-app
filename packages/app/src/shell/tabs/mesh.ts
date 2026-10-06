/**
 * Settings › Mesh: Funk (LoRa), Bluetooth und Datei – Mesh-Knoten,
 * Warteschlange, SOL-Zahlungen ohne Internet einreichen, Senden über Funk.
 *
 * Aus tabs/settings.ts verschoben (C-5c) – wörtlich, ohne Logikänderung.
 */
import { t } from "../../i18n.js";
import { zeigeDatenschutz } from "../datenschutz.js";
import { LS_ONION_PRUEFRELAY, onionRelay } from "../../onion-pruefung.js";
import { ensurePool, state } from "../state.js";
import { type Schiene } from "../../relay-kauf.js";
import { fehlerText, offlineFaehigkeiten, torText, wegName } from "../../protokoll-texte.js";
import { LS_VERSAND_VERZOEGERUNG, maxVerzoegerungSek } from "../versand.js";
import { rufStand, rufTeilenAn, setzeRufTeilen } from "../ruf.js";
import { $, el, toast } from "../ui.js";
import { ladeAbdeckung, nutzeStandort, trageAbdeckungEin, vergissStandort, widerrufeAbdeckung } from "./earn.js";
import { LS_KONTAKTE_SICHERN, kontakteEinschalten, kontakteSichernAn, sichereKontakte } from "./kontakte.js";
import { LS_ANZEIGE_EINHEIT, LS_STANDARD_SCHIENE, standardSchiene } from "../../standard-schiene.js";
import { wireRelayKarte, wireRelayZugang } from "./settings.js";
import { platzhalterAn, setzePlatzhalter } from "../ki-platzhalter.js";
import { LS_VERLAUF, leseUmfang } from "../../ki-kontext.js";

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

  // Anzeigeeinheit (12.1): nur die eigene Wahl merken; „automatisch“ entfernt sie (dann gilt `anzeigeEinheit()`)
  const einheit = document.getElementById("anzeige-einheit") as HTMLSelectElement | null;
  if (einheit) {
    const wahl = localStorage.getItem(LS_ANZEIGE_EINHEIT);
    einheit.value = wahl === "sats" || wahl === "sol" ? wahl : "";
    einheit.onchange = () => {
      if (einheit.value === "sats" || einheit.value === "sol") localStorage.setItem(LS_ANZEIGE_EINHEIT, einheit.value);
      else localStorage.removeItem(LS_ANZEIGE_EINHEIT);
      const name = einheit.value === "sats" ? "set.einheitSats" : einheit.value === "sol" ? "set.einheitSol" : "set.einheitAuto";
      toast(t("set.einheitGesetzt", { einheit: t(name) }));
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

  // Platzhalter für persönliche Angaben in KI-Fragen (D1a) – Standard an
  const platzhalter = document.getElementById("ki-platzhalter") as HTMLInputElement | null;
  if (platzhalter) {
    platzhalter.checked = platzhalterAn();
    platzhalter.onchange = () => {
      setzePlatzhalter(platzhalter.checked);
      toast(t(platzhalter.checked ? "set.platzhalterAn" : "set.platzhalterAus"));
    };
  }

  // Verlauf zu KI-Fragen (D1c) – Standard „kurz“
  const verlauf = document.getElementById("ki-verlauf") as HTMLSelectElement | null;
  if (verlauf) {
    verlauf.value = leseUmfang(localStorage.getItem(LS_VERLAUF));
    verlauf.onchange = () => {
      const umfang = leseUmfang(verlauf.value);
      localStorage.setItem(LS_VERLAUF, umfang);
      verlauf.value = umfang;
      toast(t("set.verlaufGesetzt", { umfang: verlauf.selectedOptions[0]?.textContent ?? umfang }));
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
  const kopf = el("div", t("set.ueber", { weg: wegName(link) }), "muted");
  kopf.style.marginBottom = "5px";
  box.replaceChildren(kopf, ...offlineFaehigkeiten(link).map((f) => {
    const zeile = el("div", undefined, "usage-row");
    const notiz = el("span", f.note, "muted");
    notiz.style.cssText = "font-size:10px;max-width:58%";
    zeile.append(el("span", `${f.works ? "✓" : "✕"} ${f.feature}`), notiz);
    return zeile;
  }));
}

function zeigeWarteschlange(): void {
  const box = $("#mesh-queue");
  if (!box || !meshNode) return;
  const p = meshNode.pending;
  // Je Paket eine Zeile, als Text (C-6b)
  box.replaceChildren(...(p.length === 0
    ? [t("set.nichtsZuSenden")]
    : p.flatMap((m, i) => [...(i > 0 ? [document.createElement("br")] : []), `${m.label} — ${t("set.paketeOffenKurz", { n: m.framesLeft })}`])));
}
