/**
 * Weck-Worker bei der Notfall-Löschung (Sammlung B-12, seit B-12d1): das
 * Push-Abo kündigen und den Service Worker abmelden – beide liegen außerhalb
 * von localStorage und IndexedDB, `loescheAllesLokal()` erreicht sie nicht.
 * Ohne Abo meldet der Push-Dienst dem Knoten 410, und der vergisst die Adresse
 * (B-12b). Ohne sicheren Kontext gibt es keine Worker. Ohne DOM, damit testbar.
 */

/** Alle Worker dieser Herkunft abmelden, ihre Abos vorher kündigen – zurück kommt, was nicht ging. */
export async function weckerAbmelden(
  sw: Pick<ServiceWorkerContainer, "getRegistrations"> | undefined = globalThis.navigator?.serviceWorker,
): Promise<string[]> {
  if (!sw) return [];
  let anmeldungen: readonly ServiceWorkerRegistration[];
  try {
    anmeldungen = await sw.getRegistrations();
  } catch {
    return ["worker"];
  }
  const offen: string[] = [];
  for (const r of anmeldungen) {
    try {
      await (await r.pushManager?.getSubscription())?.unsubscribe();
    } catch {
      offen.push("push");
    }
    try {
      if (!(await r.unregister())) offen.push("worker");
    } catch {
      offen.push("worker");
    }
  }
  return offen;
}
