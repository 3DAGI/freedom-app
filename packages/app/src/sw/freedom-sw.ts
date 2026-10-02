/**
 * Service Worker nur zum Wecken (Sammlung B-12c, Entscheidungen W2 A, W3 A).
 * Der eigene Knoten schickt bei neuen Umschlägen einen leeren Web Push
 * (B-12b); daraus wird hier eine Meldung mit festem Text – ohne Inhalt und
 * Absender, die kennt nur die App. Ein Klick öffnet die App.
 *
 * Kein Cache, kein `fetch`-Handler, kein `importScripts`: Die App lädt nie über
 * diesen Worker, er sieht keinen Verkehr. Gebaut als zweite Datei neben
 * freedom.html (`build.mjs`), erlaubt per CSP `worker-src 'self'` – nur von
 * derselben Herkunft, aus demselben bitgleich nachgebauten Stand.
 */
import { wecken } from "../texte/wecken.js";

/** Kennung der Meldung: eine neue ersetzt die alte, statt sich zu stapeln. */
const WECK_TAG = "freedom-weck";

interface WartetEreignis extends Event { waitUntil(p: Promise<unknown>): void }
interface KlickEreignis extends WartetEreignis { notification: { close(): void } }
interface Fenster { url: string; focus(): Promise<unknown> }
interface WeckWorker {
  location: { href: string };
  navigator: { language?: string };
  registration: { scope: string; showNotification(titel: string, o: { body: string; tag: string }): Promise<void> };
  clients: { matchAll(o: { type: "window"; includeUncontrolled: boolean }): Promise<readonly Fenster[]>; openWindow(url: string): Promise<unknown> };
  skipWaiting(): Promise<void>;
  addEventListener(art: "install" | "push" | "notificationclick", f: (e: WartetEreignis & KlickEreignis) => void): void;
}

const sw = self as unknown as WeckWorker;
/** Sprache der App aus der eigenen Adresse (`freedom-sw.js?sprache=de`, gesetzt beim Anmelden) – sonst die des Browsers. */
const gewaehlt = new URL(sw.location.href).searchParams.get("sprache");
const sprache = gewaehlt === "de" || gewaehlt === "en" ? gewaehlt : (sw.navigator.language ?? "").toLowerCase().startsWith("de") ? "de" : "en";

/** Die App: ein offenes Fenster nach vorn holen, sonst freedom.html neben diesem Worker öffnen. */
async function oeffneApp(): Promise<unknown> {
  const app = new URL("freedom.html", sw.registration.scope).href;
  const offen = (await sw.clients.matchAll({ type: "window", includeUncontrolled: true })).find((f) => f.url.split("#")[0] === app);
  return offen ? offen.focus() : sw.clients.openWindow(app);
}

sw.addEventListener("install", () => void sw.skipWaiting());
// Was der Push mitbringt, wird nicht gelesen – der Knoten schickt ohnehin nichts.
sw.addEventListener("push", (e) => e.waitUntil(sw.registration.showNotification(wecken["weck.titel"][sprache], { body: wecken["weck.text"][sprache], tag: WECK_TAG })));
sw.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(oeffneApp());
});
