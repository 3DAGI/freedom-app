/**
 * Zeitanker im echten Pfad der App (Schritt 5.10b, B-17b3a): vormerken, wo
 * ein Mandat veröffentlicht oder eine Quittung angelegt wird, und im Abruftakt
 * stempeln, nachreichen und den Beweis zum Mandat veröffentlichen
 * (`zeitankerTakt()`). Die Kalender (`OTS_KALENDER`) sehen IP und Zeitpunkt,
 * nie einen Wert; mit Tor nur den Ausgang. Ohne Einträge geht nichts hinaus.
 */
import { type NostrEvent, type Quittung, reicheNach, stempele } from "@freedomstack/protocol";
import { ZeitankerBuch, quittungsDigest, zeitankerTakt } from "../zeitanker.js";
import { alsGeraet, ensurePool, signiere, state } from "./state.js";
import { geheim } from "./tresor.js";

export const zeitanker = new ZeitankerBuch(geheim);
const jetzt = (): number => Math.floor(Date.now() / 1000);
const holen = (url: string, init: RequestInit) => fetch(url, init);
let laeuft = false;

/** Eigenes Mandat für den Schlüsselwechsel (K1 A) – nach dem Veröffentlichen. */
export async function ankereMandat(ev: NostrEvent): Promise<void> {
  await zeitanker.vormerken({ art: "mandat", digest: ev.id, kind: ev.kind }, jetzt()).catch(() => false);
}

/** Quittung (K1 A) – nur ihr Wert geht hinaus, der Beweis bleibt im Tresor. */
export async function ankereQuittung(q: Quittung): Promise<void> {
  await zeitanker.vormerken({ art: "quittung", digest: quittungsDigest(q) }, jetzt()).catch(() => false);
}

/** Ein Schlag im Abruftakt; ohne offene Anker kein Netz. Als Gerät veröffentlicht die App nichts für die Person. */
export async function zeitankerSchlag(): Promise<void> {
  if (laeuft || zeitanker.alle().every((a) => a.hoehe !== undefined && (a.art !== "mandat" || a.veroeffentlicht))) return;
  laeuft = true;
  try {
    const autor = state.keypair && !alsGeraet() ? state.keypair.pk : undefined;
    await zeitankerTakt(zeitanker, {
      stempele: (d) => stempele(d, { holen }),
      reicheNach: (z, h) => reicheNach(z, { holen: h }),
      holen,
      autor,
      veroeffentliche: autor ? async (ev) => { await (await ensurePool()).publish(await signiere(ev)); } : undefined,
      jetzt: jetzt(),
    });
  } finally {
    laeuft = false;
  }
}
