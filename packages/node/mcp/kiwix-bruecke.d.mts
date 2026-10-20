// Typen der Kiwix-Brücke (B-31b) – die Brücke selbst ist reines JavaScript, damit sie in der Sandbox ohne tsx läuft.
export declare const KIWIX_GRENZEN: {
  frageZeichen: number; treffer: number; textZeichen: number; antwortBytes: number; startMs: number; umleitungen: number;
};
export declare const WERKZEUGE: ReadonlyArray<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
export declare function istArtikelPfad(p: unknown): boolean;
export declare function entitaeten(s: string): string;
export declare function alsText(html: string): string;
export declare function leseTreffer(xml: string): Array<{ titel: string; auszug: string; pfad: string }>;
export declare function rufe(basis: string, name: unknown, args: unknown): Promise<{ text: string; fehler: boolean }>;
