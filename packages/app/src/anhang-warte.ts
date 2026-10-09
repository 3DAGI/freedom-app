/**
 * Laufende Anhänge im Chat (C-29, Nutzertest C-7): „Senden“ während eines Uploads
 * schickte den Text ohne Anhang, und der Anhang hing dann an der nächsten Nachricht.
 * Jetzt wartet Senden auf die laufenden Uploads. Ohne DOM, damit es sich testen lässt.
 */
export class AnhangWarte {
  private readonly laufend = new Set<Promise<boolean>>();

  /** Einen Upload vormerken; das Versprechen liefert, ob er gelang (es darf nie scheitern). */
  merke(lauf: Promise<boolean>): void {
    this.laufend.add(lauf);
    void lauf.finally(() => this.laufend.delete(lauf));
  }

  /** Wie viele Uploads gerade laufen. */
  get anzahl(): number {
    return this.laufend.size;
  }

  /** Wartet auf alle laufenden Uploads, auch auf solche, die währenddessen dazukommen – `true`, wenn alle gelangen. */
  async alleFertig(): Promise<boolean> {
    let gut = true;
    while (this.laufend.size > 0) {
      const jetzt = [...this.laufend];
      const ergebnisse = await Promise.all(jetzt);
      for (const lauf of jetzt) this.laufend.delete(lauf);
      if (ergebnisse.some((e) => !e)) gut = false;
    }
    return gut;
  }
}
