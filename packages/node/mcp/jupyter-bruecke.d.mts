// Typen der Jupyter-Brücke (VKk2a) – die Brücke selbst ist reines JavaScript, damit sie in der Sandbox ohne tsx läuft.
export declare const NB_GRENZEN: {
  pfadZeichen: number; dateiBytes: number; quelleZeichen: number; zellen: number; textZeichen: number; zelleZeichen: number; ausgabeZeichen: number;
};
export declare const KERNEL: Record<string, unknown>;
export declare const WERKZEUGE: ReadonlyArray<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
export declare function notebookTeile(wurzel: string, p: unknown): string[] | null;
export declare function zeilen(text: string): string[];
export declare function alsJson(nb: unknown): string;
export declare function neuesNotebook(): Record<string, unknown> & { cells: unknown[] };
export declare function neueZelle(art: "code" | "markdown" | "raw", quelle: string, id?: string): Record<string, unknown>;
export declare function istNotebook(nb: unknown): boolean;
export declare function ausgabenText(ausgaben: unknown): string;
export declare function notebookText(nb: unknown, start?: number): string;
export declare function werkzeuge(ausfuehren?: string | null): ReadonlyArray<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
export declare function rufe(wurzel: string, name: unknown, args: unknown): { text: string; fehler: boolean };
