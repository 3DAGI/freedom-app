/**
 * Texte zu Sprachnachrichten, solange die Seite offen ist (B-38c3, gefunden im Smoke-Test „als_text_lokal“): Eine offene
 * Unterhaltung zeichnet sich neu, sobald etwas ankommt oder die eigenen Kopien hinaus sind (`loadChatMessages()`) – und mit
 * ihr jeden Abspieler. Ohne dieses Gedächtnis gingen ein fertiger Text und ein laufender Versuch dabei verloren: Der Text
 * landete in einem Element, das niemand mehr sah. Hier steht je Ton das Ergebnis (oder der laufende Versuch), damit der neue
 * Abspieler es zeigt. Nur im Speicher – nie in `localStorage` oder `geheim`, nach dem Neuladen weg; höchstens `TON_TEXTE_MAX`
 * Einträge, der älteste geht zuerst. Ohne DOM.
 */
export const TON_TEXTE_MAX = 50;

export class TonTexte<T> {
  private readonly eintraege = new Map<string, Promise<T>>();

  constructor(private readonly max = TON_TEXTE_MAX) {}

  /** Der Versuch zu diesem Ton – fertig oder noch unterwegs –, sonst undefined. */
  hole(kennung: string): Promise<T> | undefined {
    return this.eintraege.get(kennung);
  }

  /** Einen neuen Versuch merken (ersetzt einen früheren zum selben Ton); gibt ihn zurück. */
  merke(kennung: string, versuch: Promise<T>): Promise<T> {
    this.eintraege.delete(kennung);
    this.eintraege.set(kennung, versuch);
    for (const k of this.eintraege.keys()) {
      if (this.eintraege.size <= this.max) break;
      this.eintraege.delete(k);
    }
    return versuch;
  }

  get groesse(): number {
    return this.eintraege.size;
  }
}
