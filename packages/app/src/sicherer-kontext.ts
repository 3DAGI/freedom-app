/**
 * Sicherer Kontext (B-10b, Sammlung Neuordnung): WebCrypto (`crypto.subtle`)
 * gibt der Browser nur in sicheren Kontexten frei – https, .onion im Tor
 * Browser, localhost. Kommt die App über http im Heimnetz (vom eigenen Knoten,
 * B-10a), fehlt es: kein Tresor und damit nichts, was ihn braucht (Wallet,
 * MLS), kein Lesen von Git-Bundles. Die App sagt das, statt zu scheitern.
 * Ohne DOM, damit testbar.
 */
interface Umgebung {
  isSecureContext?: boolean;
  crypto?: { subtle?: { importKey?: unknown; digest?: unknown } };
}

export function verschluesselungMoeglich(g: Umgebung = globalThis as Umgebung): boolean {
  return g.isSecureContext !== false && typeof g.crypto?.subtle?.importKey === "function" && typeof g.crypto.subtle.digest === "function";
}
