/**
 * Privat-Schalter je Unterhaltung (D2, `docs/DATENSCHUTZ-PROVIDER.md`, Stufe 2).
 *
 * Eine private Unterhaltung geht nur an dieses Gerät (B-1) oder den eigenen
 * Knoten (B-9a) – nie an einen fremden Provider, nie über Funk (dort rechnet
 * ein fremder Provider hinter dem Gateway) und damit auch nie in eine
 * Prüfrunde. Kein stilles Ausweichen: Ist keiner der beiden gewählt, geht
 * nichts hinaus.
 */

/** Wohin eine Frage geht – in der Reihenfolge, in der `askAi()` entscheidet. */
export type KiWeg = "funk" | "geraet" | "knoten" | "netz";

export function kiWeg(p: { funk: boolean; geraet: boolean; knoten: boolean }): KiWeg {
  return p.funk ? "funk" : p.geraet ? "geraet" : p.knoten ? "knoten" : "netz";
}

/** Darf die Frage diesen Weg nehmen? Privat nur dieses Gerät und der eigene Knoten. */
export function wegErlaubt(privat: boolean, weg: KiWeg): boolean {
  return !privat || weg === "geraet" || weg === "knoten";
}
