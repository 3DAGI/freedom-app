/**
 * Offline-Queue fuer Zaps (falls Relay ausfaellt).
 *
 * Zaps werden in localStorage gespeichert und bei naechster Verbindung publiziert.
 */

export interface OfflineZap {
  id: string;
  receipt: unknown;
  timestamp: number;
  status: "pending" | "sent" | "failed";
}

const QUEUE_KEY = "freedom.offlineZaps";

/** Zap in Offline-Queue speichern. */
export function queueOfflineZap(receipt: unknown): void {
  const queue = getOfflineQueue();
  const zap: OfflineZap = {
    id: Math.random().toString(36).slice(2),
    receipt,
    timestamp: Date.now(),
    status: "pending",
  };
  queue.push(zap);
  saveOfflineQueue(queue);
}

/** Offline-Queue laden. */
export function getOfflineQueue(): OfflineZap[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

/** Offline-Queue speichern. */
function saveOfflineQueue(queue: OfflineZap[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

/** Offline-Queue abarbeiten (bei Verbindung). */
export async function processOfflineQueue(publish: (ev: unknown) => Promise<void>): Promise<void> {
  const queue = getOfflineQueue();
  const pending = queue.filter((z) => z.status === "pending");
  if (pending.length === 0) return;

  console.log(`[offline-queue] ${pending.length} zaps zu publizieren`);
  for (const zap of pending) {
    try {
      await publish(zap.receipt);
      zap.status = "sent";
      console.log(`[offline-queue] zap ${zap.id} gesendet`);
    } catch (e) {
      zap.status = "failed";
      console.error(`[offline-queue] zap ${zap.id} fehlgeschlagen:`, e);
    }
  }
  saveOfflineQueue(queue);
}

/** Offline-Queue-Status anzeigen. */
export function showOfflineQueueStatus(): void {
  const queue = getOfflineQueue();
  const pending = queue.filter((z) => z.status === "pending");
  if (pending.length === 0) return;

  const el = document.createElement("div");
  el.className = "offline-queue-status";
  el.innerHTML = `
    <div class="offline-queue-card">
      <span>⚡ ${pending.length} zap(s) offline gespeichert</span>
      <button class="ghost" id="offline-queue-retry">erneut versuchen</button>
    </div>
  `;
  document.body.appendChild(el);

  document.getElementById("offline-queue-retry")!.onclick = async () => {
    el.remove();
    const pool = (window as unknown as { ensurePool: () => Promise<unknown> }).ensurePool;
    await processOfflineQueue((ev) => (pool as unknown as { publish: (e: unknown) => Promise<void> }).publish(ev));
  };

  setTimeout(() => el.remove(), 5000);
}
