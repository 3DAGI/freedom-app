/**
 * Treasury-Announcement-Archivierung auf Arweave (via Turbo).
 *
 * Zweck: Ausfallsicherheit des Lightning-Fee-Flows. Wenn der Treasury-Node
 * lange offline ist, können Clients die letzte gültige Wochen-Adresse auch
 * von AR.IO-Gateways lesen statt nur vom Relay.
 *
 * Kosten: ~0.001–0.01 USD pro Announcement (winzig, <1KB). Lohnt sich nur,
 * wenn ein Threshold erreicht ist — genau wie der Sweep:
 * ARWEAVE_MIRROR_EVERY_N_WEEKS=1 (default: jede Woche, Kosten vernachlässigbar)
 * oder per Env abschaltbar (ARWEAVE_MIRROR=0).
 *
 * Zahlung: Turbo-Credits (können mit SOL aufgeladen werden — passt zum Stack).
 * Der Upload-Signer ist ein eigener Arweave-Keypair (JWK), separat vom
 * Treasury-Master — Kompromittierung des einen gibt den anderen nicht preis.
 */
import fs from "node:fs";

/**
 * Lazy turbo-import: Das SDK zieht massive Node-Builtins nach sich und darf
 * NUR im Node-Bundle landen (der Browser ruft mirrorAnnouncement nie auf —
 * der Mirror läuft exklusiv auf dem Treasury-Node). Der dynamische Import
 * hier wird vom Browser-Bundle als external markiert (siehe build.mjs).
 */
async function getTurboLazy() {
  return import("@ardrive/turbo-sdk");
}

let cachedSigner: unknown = null;

export interface ArweaveMirrorConfig {
  /** Pfad zur Arweave-JWK (JSON) des Mirror-Uploaders. */
  jwkPath?: string;
  /** Oder JWK direkt als JSON-String. */
  jwkJson?: string;
}

let cachedTurbo: unknown = null;

async function getTurbo(cfg: ArweaveMirrorConfig) {
  if (cachedTurbo) return cachedTurbo;
  const turbo = await getTurboLazy();
  let jwk: unknown;
  if (cfg.jwkJson) {
    jwk = JSON.parse(cfg.jwkJson);
  } else if (cfg.jwkPath && fs.existsSync(cfg.jwkPath)) {
    jwk = JSON.parse(fs.readFileSync(cfg.jwkPath, "utf8"));
  } else {
    throw new Error(
      "arweave-mirror: keine JWK gefunden (ARWEAVE_JWK_PATH env oder Datei fehlt)",
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const turboAny = turbo as any;
  const signer = turboAny.ArweaveSigner ? new turboAny.ArweaveSigner(jwk) : jwk;
  cachedTurbo = turboAny.TurboFactory.authenticated({ signer });
  return cachedTurbo;
}

export interface MirrorResult {
  /** Arweave Transaction-ID (für Gateway-Zugriff: https://ar.io/<id>). */
  txId: string;
  /** Größe in bytes. */
  sizeBytes: number;
}

/**
 * Spiegelt ein Payout-Announcement dauerhaft auf Arweave.
 * Tags machen es via AR.IO querybar: Freedom-Treasury, week-N.
 */
export async function mirrorAnnouncement(
  announcementEvent: {
    id?: string;
    kind: number;
    tags: string[][];
    pubkey: string;
    content?: string;
    created_at?: number;
  },
  cfg: ArweaveMirrorConfig = {},
): Promise<MirrorResult> {
  const turbo = await getTurbo(cfg);
  const dataItem = JSON.stringify({
    protocol: "freedom-treasury",
    version: 1,
    kind: announcementEvent.kind,
    week: announcementEvent.tags.find((t) => t[0] === "week")?.[1],
    address: announcementEvent.tags.find((t) => t[0] === "address")?.[1],
    chain: announcementEvent.tags.find((t) => t[0] === "chain")?.[1],
    nostrPubkey: announcementEvent.pubkey,
    nostrEventId: announcementEvent.id ?? null,
    mirroredAt: Math.floor(Date.now() / 1000),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (turbo as any).uploadService.uploadDataItem({
    dataItemStreamFactory: () => new Blob([dataItem]).stream() as unknown as ReadableStream,
    dataItemSizeFactory: () => Buffer.byteLength(dataItem),
    signal: AbortSignal.timeout(120_000),
    tags: [
      { name: "App-Name", value: "FreedomStack" },
      { name: "Content-Type", value: "application/json" },
      { name: "Protocol", value: "freedom-treasury" },
      { name: "Week", value: String(announcementEvent.tags.find((t) => t[0] === "week")?.[1] ?? "") },
    ],
  });

  return {
    txId: result.id,
    sizeBytes: Buffer.byteLength(dataItem),
  };
}

/** Liest das letzte gespiegelte Announcement von einem AR.IO-Gateway. */
export async function readLatestAnnouncementFromArweave(
  gatewayUrl = "https://arweave.net",
): Promise<{ week: number; addressHex: string } | null> {
  // Arweave GraphQL: letztes Freedom-Treasury-Announcement finden
  const query = {
    query: `query {
      transactions(
        tags: [
          { name: "Protocol", values: ["freedom-treasury"] },
          { name: "App-Name", values: ["FreedomStack"] }
        ],
        sort: HEIGHT_DESC,
        first: 1
      ) { edges { node { id } } }
    }`,
  };
  const gqlUrl = gatewayUrl.includes("arweave.net")
    ? "https://arweave.net/graphql"
    : `${gatewayUrl}/graphql`;
  const res = await fetch(gqlUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(query),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { data?: { transactions?: { edges?: Array<{ node: { id: string } }> } } };
  const txId = data.data?.transactions?.edges?.[0]?.node?.id;
  if (!txId) return null;

  const dataRes = await fetch(`${gatewayUrl}/${txId}`);
  if (!dataRes.ok) return null;
  try {
    const parsed = JSON.parse(await dataRes.text()) as { week?: number; address?: string };
    if (parsed.week && parsed.address) {
      return { week: parsed.week, addressHex: parsed.address };
    }
  } catch { /* ignore */ }
  return null;
}
