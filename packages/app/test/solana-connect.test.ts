/**
 * Tests fuer die geraeteuebergreifende Solana-Anbindung.
 *
 * Der Kern: auf keinem Geraet darf die Antwort "kein Wallet gefunden, Ende"
 * lauten. Genau das tat die alte Implementierung auf jedem Handy.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectSolanaEnvironment,
  buildWalletDeeplink,
  connectSolanaWallet,
  isValidSolanaAddress,
  SolanaProvider,
} from "../src/solana-connect.js";

const UA = {
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile Safari",
  androidChrome: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit Chrome/120 Mobile Safari",
  seeker: "Mozilla/5.0 (Linux; Android 13; Saga) AppleWebKit Chrome/119 Mobile",
  desktop: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit Chrome/120 Safari",
};

/** Injizierten Provider setzen/entfernen (simuliert Extension bzw. Wallet-Browser). */
function withProvider<T>(p: SolanaProvider | undefined, fn: () => T): T {
  const g = globalThis as unknown as { solana?: SolanaProvider };
  const orig = g.solana;
  if (p) g.solana = p; else delete g.solana;
  try {
    return fn();
  } finally {
    if (orig) g.solana = orig; else delete g.solana;
  }
}

const fakeProvider = (pubkey = "So11111111111111111111111111111111111111112"): SolanaProvider => ({
  connect: async () => ({ publicKey: { toBase58: () => pubkey } }),
});

test("Erkennung: iPhone-Safari bekommt einen Deeplink-Weg, kein 'geht nicht'", () => {
  const env = withProvider(undefined, () => detectSolanaEnvironment(UA.iphoneSafari));
  assert.equal(env.isIos, true);
  assert.equal(env.isMobile, true);
  assert.equal(env.hasInjected, false);
  assert.equal(env.method, "deeplink", "genau hier stand vorher nur eine Fehlermeldung");
  assert.ok(env.hint.length > 0);
});

test("Erkennung: Android und Seeker nutzen den Wallet-Adapter-Weg", () => {
  for (const ua of [UA.androidChrome, UA.seeker]) {
    const env = withProvider(undefined, () => detectSolanaEnvironment(ua));
    assert.equal(env.isAndroid, true);
    assert.equal(env.method, "mwa");
  }
});

test("Erkennung: Wallet-In-App-Browser auf dem Handy zaehlt als injected", () => {
  const env = withProvider(fakeProvider(), () => detectSolanaEnvironment(UA.iphoneSafari));
  assert.equal(env.hasInjected, true);
  assert.equal(env.inWalletBrowser, true);
  assert.equal(env.method, "injected", "nach dem Deeplink landet der Nutzer genau hier");
});

test("Erkennung: Desktop ohne Extension sagt klar, was zu tun ist", () => {
  const env = withProvider(undefined, () => detectSolanaEnvironment(UA.desktop));
  assert.equal(env.isMobile, false);
  assert.equal(env.method, "none");
  assert.match(env.hint, /Extension|Handy/);
});

test("Deeplink: enthaelt die eigene URL und ist ein https-Link", () => {
  const url = "https://freedomstack.io/freedom.html";
  const phantom = buildWalletDeeplink("phantom", url);
  const solflare = buildWalletDeeplink("solflare", url);

  for (const link of [phantom, solflare]) {
    assert.ok(link.startsWith("https://"), "Universal Link, kein custom scheme");
    assert.ok(link.includes(encodeURIComponent(url)), "Ziel-URL muss kodiert enthalten sein");
  }
  assert.match(phantom, /phantom\.app/);
  assert.match(solflare, /solflare\.com/);
});

test("Deeplink: Sonderzeichen in der URL werden korrekt kodiert", () => {
  const link = buildWalletDeeplink("phantom", "https://x.io/a?b=1&c=2");
  assert.ok(!link.includes("?b=1"), "unkodierte Parameter wuerden den Link zerreissen");
});

test("Verbinden: injizierter Provider liefert den Pubkey", async () => {
  const conn = await withProvider(fakeProvider("ABC123"), () => connectSolanaWallet({ userAgentOverride: UA.desktop }));
  assert.equal(conn!.pubkey, "ABC123");
  assert.equal(conn!.method, "injected");
});

test("Verbinden: Mobile ohne Provider ruft den Deeplink-Callback statt zu werfen", async () => {
  let got: { phantom: string; solflare: string } | undefined;
  const conn = await withProvider(undefined, () =>
    connectSolanaWallet({
      userAgentOverride: UA.iphoneSafari,
      onNeedsDeeplink: (links) => { got = links; },
    }),
  );
  assert.equal(conn, null);
  assert.ok(got !== undefined, "der Nutzer muss eine Handlungsoption bekommen");
  assert.match(got!.phantom, /phantom\.app/);
});

test("Verbinden: stiller Start wirft nie", async () => {
  const conn = await withProvider(undefined, () =>
    connectSolanaWallet({ silent: true, userAgentOverride: UA.desktop }),
  );
  assert.equal(conn, null, "beim Autostart darf nichts hochkommen");
});

test("Verbinden: abgelehnte Verbindung ergibt eine verstaendliche Meldung", async () => {
  const rejecting: SolanaProvider = { connect: async () => { throw new Error("User rejected"); } };
  await assert.rejects(
    () => withProvider(rejecting, () => connectSolanaWallet({ userAgentOverride: UA.desktop })),
    /abgelehnt/,
  );
});

test("Verbinden: Desktop ohne Wallet erklaert den Weg", async () => {
  await assert.rejects(
    () => withProvider(undefined, () => connectSolanaWallet({ userAgentOverride: UA.desktop })),
    /Extension|Handy/,
  );
});

test("Adressprüfung: base58 ja, hex nein", () => {
  assert.equal(isValidSolanaAddress("So11111111111111111111111111111111111111112"), true);
  // Der Treasury-Default im Repo war 64-stelliges Hex — genau dieser Fehler.
  assert.equal(isValidSolanaAddress("5a09dd54bfcc0a2777b8459c2595e445cc349649a73736ba8995024ef88b98a6"), false);
  assert.equal(isValidSolanaAddress(""), false);
  assert.equal(isValidSolanaAddress("0OIl"), false, "0, O, I, l gibt es in base58 nicht");
});
