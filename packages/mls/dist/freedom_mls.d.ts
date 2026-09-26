/* tslint:disable */
/* eslint-disable */

/**
 * Ein MLS-Konto (eine Identität auf diesem Gerät).
 */
export class MlsKonto {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Einladung (Kind 1059) annehmen; gibt die Gruppen-Id zurück.
     */
    beitreten(einladung: string): Promise<any>;
    /**
     * Nach dem Senden: Relays haben angenommen.
     */
    bestaetigt(ausstehend: string): Promise<any>;
    /**
     * Kontakte einladen (KeyPackage-Events).
     */
    einladen(gruppe_id: string, key_packages: string[]): Promise<any>;
    /**
     * Ein empfangenes Event (Kind 445 oder 1059) verarbeiten.
     */
    empfangen(event: string): Promise<any>;
    /**
     * Mitglieder (Identitäten hex) entfernen – sie lesen danach nichts mehr.
     */
    entfernen(gruppe_id: string, mitglieder: string[]): Promise<any>;
    epoche(gruppe_id: string): number;
    /**
     * Gepufferte Commits übernehmen, wenn das Zeitfenster vorbei ist.
     * Ergebnis: `{ nachrichten, geaendert, events, ausstehend }`.
     */
    fortschreiten(gruppe_id: string): Promise<any>;
    /**
     * Nach dem Senden: kein Relay nahm an – die Gruppe bleibt, wie sie war.
     */
    gescheitert(ausstehend: string): Promise<any>;
    /**
     * Gruppe mit den Kontakten aus ihren KeyPackage-Events anlegen; `relays`:
     * wo die Gruppe ihre Nachrichten austauscht (steht verschlüsselt im
     * Gruppenzustand). Ergebnis: `{ gruppe, einladungen: [event] }` – die
     * Gruppe steht sofort.
     */
    gruppeAnlegen(name: string, key_packages: string[], relays: string[]): Promise<any>;
    /**
     * Alle Gruppen dieses Kontos.
     */
    gruppen(): string[];
    /**
     * Unsigniertes KeyPackage-Event (Kind 30443) als JSON; die App signiert
     * und veröffentlicht es. `platz`: d-Tag dieses Geräts.
     */
    keyPackageEvent(platz: string): Promise<any>;
    /**
     * Mitglieder (Identitäten hex).
     */
    mitglieder(gruppe_id: string): string[];
    /**
     * `identitaet`: eigener öffentlicher Schlüssel (hex); `beweis`, `signer`:
     * siehe Modulbeschreibung; `zustand`: Bytes aus `zustand()` oder leer.
     */
    constructor(identitaet: string, beweis: Function, signer: any, zustand?: Uint8Array | null);
    /**
     * Text in die Gruppe; Ergebnis wie bei `einladen` (Nachricht braucht keine Bestätigung).
     */
    senden(gruppe_id: string, text: string): Promise<any>;
    /**
     * Wie lange warten, bis `fortschreiten` sinnvoll ist (ms); `undefined` = nichts offen.
     */
    wartezeit(gruppe_id: string): number | undefined;
    /**
     * Ganzer Zustand als Bytes – für den Tresor der App.
     */
    zustand(): Uint8Array;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_mlskonto_free: (a: number, b: number) => void;
    readonly mlskonto_beitreten: (a: number, b: number, c: number) => number;
    readonly mlskonto_bestaetigt: (a: number, b: number, c: number) => number;
    readonly mlskonto_einladen: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly mlskonto_empfangen: (a: number, b: number, c: number) => number;
    readonly mlskonto_entfernen: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly mlskonto_epoche: (a: number, b: number, c: number, d: number) => void;
    readonly mlskonto_fortschreiten: (a: number, b: number, c: number) => number;
    readonly mlskonto_gescheitert: (a: number, b: number, c: number) => number;
    readonly mlskonto_gruppeAnlegen: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly mlskonto_gruppen: (a: number, b: number) => void;
    readonly mlskonto_keyPackageEvent: (a: number, b: number, c: number) => number;
    readonly mlskonto_mitglieder: (a: number, b: number, c: number, d: number) => void;
    readonly mlskonto_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly mlskonto_senden: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly mlskonto_wartezeit: (a: number, b: number, c: number, d: number) => void;
    readonly mlskonto_zustand: (a: number, b: number) => void;
    readonly rust_sqlite_wasm_abort: () => void;
    readonly rust_sqlite_wasm_assert_fail: (a: number, b: number, c: number, d: number) => void;
    readonly rust_sqlite_wasm_calloc: (a: number, b: number) => number;
    readonly rust_sqlite_wasm_malloc: (a: number) => number;
    readonly rust_sqlite_wasm_free: (a: number) => void;
    readonly rust_sqlite_wasm_getentropy: (a: number, b: number) => number;
    readonly rust_sqlite_wasm_localtime: (a: number) => number;
    readonly rust_sqlite_wasm_realloc: (a: number, b: number) => number;
    readonly sqlite3_os_end: () => number;
    readonly sqlite3_os_init: () => number;
    readonly rustsecp256k1_v0_10_0_context_create: (a: number) => number;
    readonly rustsecp256k1_v0_10_0_context_destroy: (a: number) => void;
    readonly rustsecp256k1_v0_10_0_default_error_callback_fn: (a: number, b: number) => void;
    readonly rustsecp256k1_v0_10_0_default_illegal_callback_fn: (a: number, b: number) => void;
    readonly __wasm_bindgen_func_elem_25939: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_25941: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_19698: (a: number, b: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number) => void;
    readonly __wbindgen_export4: (a: number, b: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export5: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
