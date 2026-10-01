/**
 * Ablage der Repos nur auf diesem Gerät (Sammlung B-2): die Liste in `geheim`
 * (`freedom.repos.lokal`, mit Tresor im Tresor), die Chiffrate der Bundles in
 * der IndexedDB „freedom-repos“ (steht in `WIPE_DATENBANKEN`, die
 * Notfall-Löschung nimmt sie mit). Nichts davon geht auf ein Relay oder ins
 * Blob-Netz; die Logik steht in `lokale-repos.ts`.
 */
import { type BundleSpeicher, LokaleRepos } from "../lokale-repos.js";
import { geheim } from "./tresor.js";

const DATENBANK = "freedom-repos";
const STORE = "bundles";

function mitDb<T>(modus: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DATENBANK, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onerror = () => rej(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(STORE, modus);
      const r = f(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); res(r.result); };
      tx.onerror = () => { db.close(); rej(tx.error); };
      tx.onabort = () => { db.close(); rej(tx.error); };
    };
  });
}

const bundles: BundleSpeicher = {
  lies: async (k) => {
    const v = await mitDb("readonly", (s) => s.get(k));
    return v instanceof Uint8Array ? v : null;
  },
  lege: async (k, v) => { await mitDb("readwrite", (s) => s.put(v, k)); },
  loesche: async (k) => { await mitDb("readwrite", (s) => s.delete(k)); },
};

/** Die Repos dieses Geräts – einmal für die App. */
export const lokaleRepos = new LokaleRepos(geheim, bundles);
